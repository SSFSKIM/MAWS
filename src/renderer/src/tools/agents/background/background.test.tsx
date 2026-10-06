// Background work (C8b execution document, M3): workflow cards with phases and the per-agent table over the recorded
// pass-2 run, shells with Output from the Bash result text, monitors, Stop's two-phase state over R6's recorded
// sequence, the disk-only wording, the tool's X5 pins and its summary section; and the task checklist over the client's
// `tasks` for the status's list id. The stores are the product singletons over the fake agent-work client; C5's
// sessions store is seeded directly.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId, TaskId } from '@shared/graph/ids';
import type { EventPayload } from '@shared/ipc/schema';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import type { PersistedTask } from '@shared/wire/store';
import { record, status } from '../../../../../../test/support/builders';
import { event, replayed, sidecarsOf, upTo, workflowRunsOf } from '../../../../../../test/support/agents-events';
import { connectAgentWorkEvents } from '../../../ipc/events';
import * as query from '../../../ipc/query';
import type { PanelToolContext } from '../../../panel/tool';
import { useSessions } from '../../../stores/sessions';
import { setAgentWorkClient, type AgentWorkClient } from '../client';
import { fakeAgentWorkClient, type FakeAgentWorkClient } from '../fake-work-client';
import { openLog } from '../log/LogTool';
import { useTaskGraph } from '../store';
import { SLOW_TICK_MS } from '../subagents/shared';
import { subagentsTool, type SubagentsParams } from '../subagents/SubagentsTool';
import { BackgroundSummary } from './BackgroundSummary';
import { backgroundTool, type BackgroundHandle, type BackgroundParams } from './BackgroundTool';

vi.mock('../log/LogTool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../log/LogTool')>();
  return { ...actual, openLog: vi.fn() };
});
vi.mock('../../../ipc/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../ipc/query')>();
  return { ...actual, useCommand: vi.fn(actual.useCommand) };
});

const A = 'A' as AppSessionId;
const TITLE = 'Fix drag';
const T = '2026-09-29T10:00:00.000Z';

let fake: FakeAgentWorkClient;
let client: AgentWorkClient;
let lists: Record<string, PersistedTask[] | Error>;
const tasksCalls: string[] = [];
const tasksChanged = new Set<(payload: EventPayload<'fs.tasksChanged'>) => void>();
const handles: BackgroundHandle[] = [];
let disconnect: (() => void) | null = null;

const live = (over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status('A'), launchId: 'journal', taskListId: null, ...over });

function seedSessions(statusOfA: EngineSessionStatus | null, engineSessionId: string | null = 'eng-A'): void {
  useSessions.setState((s) => ({
    records: new Map([[A, record('A', { title: { text: TITLE, source: 'user' }, engineSessionId: engineSessionId as SessionId | null })]]),
    engine: statusOfA ? new Map([[A, statusOfA]]) : new Map(),
    digests: new Map(),
    recordsVersion: s.recordsVersion + 1,
    digestsVersion: s.digestsVersion + 1,
  }));
}

function setStatus(next: EngineSessionStatus | null): void {
  act(() =>
    useSessions.setState((s) => {
      const engine = new Map(s.engine);
      if (next) engine.set(A, next);
      else engine.delete(A);
      return { engine };
    }),
  );
}

const openTool = vi.fn();
function Mounted({ state, visible = true }: { state: BackgroundHandle; visible?: boolean }) {
  const session = useSessions((s) => s.records.get(A) ?? null);
  const engine = useSessions((s) => s.engine.get(A) ?? null);
  const ctx: PanelToolContext = { appSessionId: A, session, status: engine, pinned: false, visible, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool };
  const Body = backgroundTool.render;
  return (
    <QueryClientProvider client={query.queryClient}>
      <Body state={state} ctx={ctx} />
    </QueryClientProvider>
  );
}

function create(params: BackgroundParams | undefined): BackgroundHandle {
  const handle = backgroundTool.createState({ appSessionId: A, session: useSessions.getState().records.get(A) ?? null, instanceId: 'background:test', params: params as BackgroundParams });
  handles.push(handle);
  return handle;
}

const lastSeqOf = (events: SessionEvent[]) => Math.max(0, ...events.map((e) => e.seq ?? 0));

interface MountOptions {
  status?: EngineSessionStatus | null;
  events?: SessionEvent[];
  sidecars?: SubagentEntry[];
  runs?: WorkflowRun[];
  params?: BackgroundParams;
  engineSessionId?: string | null;
}

async function mount(opts: MountOptions = {}) {
  const engine = opts.status === undefined ? live() : opts.status;
  seedSessions(engine, opts.engineSessionId === undefined ? 'eng-A' : opts.engineSessionId);
  const handle = create(opts.params);
  const view = render(<Mounted state={handle} />);
  await act(async () => {
    if (engine) await fake.answer('events', { events: opts.events ?? [], lastSeq: lastSeqOf(opts.events ?? []), complete: true });
    await fake.answer('subagents', opts.sidecars ?? []);
    await fake.answer('workflows', opts.runs ?? []);
  });
  return { handle, ...view };
}

// A second mount in one test: the first tab's watch released and the store emptied, as a fresh session would find it.
function unmountAll(): void {
  cleanup();
  handles.splice(0).forEach((handle) => backgroundTool.dispose(handle));
  useTaskGraph.setState({ entries: new Map() });
}

const push = (events: SessionEvent[]) => act(() => fake.batch('A', events));
const section = (name: string) => document.querySelector<HTMLElement>(`[data-section="${name}"]`);
// the heading's own text: its toggle (E7: the Tasks heading also holds `Open`)
const heading = (name: string) => section(name)?.querySelector('h3 > button')?.textContent;
const card = (taskId: string) => document.querySelector<HTMLElement>(`[data-workflow="${taskId}"]`)!;
const summaryLine = (taskId: string) => card(taskId).querySelector('[data-part="summary"]')?.textContent;
// E7: the run's widget, as shown: the phase options (`<title>|<count>`, the selected one marked `*`) and the agent rows.
const widget = () => document.querySelector<HTMLElement>('[data-view="run"]');
const options = () =>
  Array.from(widget()!.querySelectorAll<HTMLElement>('[role="option"]')).map(
    (o) => `${o.getAttribute('aria-selected') === 'true' ? '*' : ''}${o.querySelector('[data-part="title"]')?.textContent}|${o.querySelector('[data-part="count"]')?.textContent}`,
  );
const tableRows = () => Array.from(widget()!.querySelectorAll<HTMLElement>('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));
const openWidget = (taskId: string) => fireEvent.click(within(card(taskId)).getByRole('button', { name: `Open ${within(card(taskId)).getByRole('heading').textContent}` }));

const workflow = replayed('pass2', 'workflow');
const stopOn = replayed('pass2', 'per-task-stop-on');
const stopTask = replayed('pass3', 'stop-task');

beforeEach(() => {
  fake = fakeAgentWorkClient();
  lists = {};
  tasksCalls.splice(0);
  tasksChanged.clear();
  client = {
    ...fake.client,
    tasks: async (listId) => {
      tasksCalls.push(listId);
      const answer = lists[listId] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    onTasksChanged: (listener) => {
      tasksChanged.add(listener);
      return () => void tasksChanged.delete(listener);
    },
  };
  setAgentWorkClient(client);
  disconnect = connectAgentWorkEvents(client);
  useTaskGraph.setState({ entries: new Map() });
  query.queryClient.clear();
  openTool.mockClear();
  vi.mocked(openLog).mockClear();
  vi.mocked(query.useCommand).mockClear();
});

afterEach(() => {
  cleanup();
  handles.splice(0).forEach((handle) => backgroundTool.dispose(handle));
  disconnect?.();
  setAgentWorkClient(null);
  vi.useRealTimers();
});

describe('background work', () => {
  it('shows a compact workflow card from pass2/workflow: its description, workflow maws-probe and one summary line per frame', async () => {
    await mount({ events: upTo(workflow, 82) });
    expect(heading('workflows')).toBe('Workflows · 1');
    const wf = card('wayue3on6');
    expect(within(wf).getByRole('heading').textContent).toBe('Two echo agents in one phase');
    const line = wf.querySelector('[data-part="line"]')?.textContent;
    expect(line).toMatch(/^workflow maws-probe · .+ · 2 agents · tokens unavailable$/); // no row has reported tokens at seq 82
    expect(summaryLine('wayue3on6')).toBe('Echo · 0/2 agents');
    expect(wf.querySelector('table, [data-phase]')).toBeNull(); // the per-phase tables live in the widget (Decision Log 1)
    push(upTo(workflow, 93).filter((e) => (e.seq ?? 0) > 82));
    expect(summaryLine('wayue3on6')).toBe('Done');
    expect(card('wayue3on6').querySelector('[data-part="line"]')?.textContent).toMatch(/ · 17\.7k tokens$/); // alpha's 8,861 + beta's 8,857
  });

  // E7 (Design §2, G1): the widget.
  it('the card’s title and chevron open the widget: phases on the left, the selected phase’s agents on the right, per frame', async () => {
    await mount({ events: upTo(workflow, 82) });
    fireEvent.click(within(card('wayue3on6')).getByRole('button', { name: 'Two echo agents in one phase' }));
    expect(widget()).not.toBeNull();
    expect(within(widget()!).getByRole('heading').textContent).toBe('Two echo agents in one phase');
    expect(widget()!.querySelector('[data-part="line"]')?.textContent).toMatch(/^workflow maws-probe · .+ · 2 agents · tokens unavailable$/);
    expect(options()).toEqual(['All phases|', '*Echo|0/2']); // the running phase by default
    expect(Array.from(widget()!.querySelectorAll('th')).map((th) => th.textContent)).toEqual(['Agent', 'Model', 'State', 'Time', 'Tokens']);
    // a row with an agent id leads with its glyph; the state is the engine's word (`start` while an agent runs)
    expect(tableRows().map((cells) => [cells[0], cells[2]])).toEqual([
      [expect.stringMatching(/^.alpha$/u), 'start'],
      ['beta', 'start'],
    ]);
    push(upTo(workflow, 93).filter((e) => (e.seq ?? 0) > 82));
    expect(options()).toEqual(['All phases|', '*Echo|2/2']); // the last phase once none runs
    expect(tableRows().map((cells) => cells.slice(2))).toEqual([
      ['done', '1s', '8.9k'],
      ['done', '1s', '8.9k'],
    ]);
    expect(tableRows().map((cells) => cells[0])).toEqual([expect.stringMatching(/alpha$/), expect.stringMatching(/beta$/)]);
    // Back returns to the list, the card still selected
    fireEvent.click(within(widget()!).getByRole('button', { name: '‹ Background work' }));
    expect(widget()).toBeNull();
    expect(card('wayue3on6').dataset.selected).toBe('true');
    openWidget('wayue3on6');
    expect(widget()).not.toBeNull();
  });

  it('a phase is chosen by click or ↑/↓ on the phase list; All phases lists every agent', async () => {
    const progress = [
      { type: 'workflow_phase', index: 1, title: 'Solve' },
      { type: 'workflow_phase', index: 2, title: 'Judge' },
      { type: 'workflow_agent', index: 1, label: 'solve:a', phaseIndex: 1, state: 'done', startedAt: Date.parse(T), durationMs: 2_000 },
      { type: 'workflow_agent', index: 2, label: 'judge', phaseIndex: 2, state: 'running', startedAt: Date.parse(T) },
    ];
    const { handle } = await mount({
      events: [
        event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'Judge panel', workflowName: 'demo' }, { seq: 1, at: T }),
        event('workflow.progress', { taskId: 'wf1', workflowName: 'demo', progress }, { seq: 2 }),
      ],
    });
    openWidget('wf1');
    expect(options()).toEqual(['All phases|', 'Solve|1/1', '*Judge|0/1']);
    expect(tableRows().map((cells) => cells[0])).toEqual(['judge']);
    fireEvent.click(within(widget()!).getByRole('option', { name: /All phases/ }));
    expect(tableRows().map((cells) => cells[0])).toEqual(['solve:a', 'judge']);
    const list = within(widget()!).getByRole('listbox', { name: 'Phases' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(options()[1]).toBe('*Solve|1/1');
    expect(list.getAttribute('aria-activedescendant')).toBe(within(widget()!).getByRole('option', { name: /Solve/ }).id);
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    fireEvent.keyDown(list, { key: 'ArrowUp' }); // stays at the first
    expect(options()[0]).toBe('*All phases|');
    expect(handle.snapshot().view).toEqual({ kind: 'run', taskId: 'wf1', phase: 'all' });
    // a picked phase a later snapshot no longer has falls back to the default, the active option one that exists
    fireEvent.click(within(widget()!).getByRole('option', { name: /Solve/ }));
    push([event('workflow.progress', { taskId: 'wf1', workflowName: 'demo', progress: progress.filter((row) => ('phaseIndex' in row ? row.phaseIndex : row.index) === 2) }, { seq: 3 })]);
    expect(options()).toEqual(['All phases|', '*Judge|0/1']);
    expect(list.getAttribute('aria-activedescendant')).toBe(within(widget()!).getByRole('option', { name: /Judge/ }).id);
  });

  it('a run that ended leaves an unfinished agent’s time blank, with no spinner', async () => {
    const progress = [
      { type: 'workflow_phase', index: 1, title: 'Wait' },
      { type: 'workflow_agent', index: 1, label: 'slow', phaseIndex: 1, state: 'running', startedAt: Date.parse(T) },
    ];
    await mount({
      events: [
        event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'One slow agent', workflowName: 'demo' }, { seq: 1, at: T }),
        event('workflow.progress', { taskId: 'wf1', workflowName: 'demo', progress }, { seq: 2 }),
        event('task.notification', { taskId: 'wf1', status: 'stopped' }, { seq: 3 }),
      ],
    });
    openWidget('wf1');
    expect(tableRows()).toEqual([['slow', '', 'running', '', '']]);
    expect(widget()!.querySelector('.animate-spin')).toBeNull();
    expect(widget()!.querySelector('[data-part="status"]')?.textContent).toBe('stopped');
  });

  it('a running agent’s time ticks once a second while the run runs', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.parse(T) + 5_000);
    const progress = [{ type: 'workflow_agent', index: 1, label: 'slow', phaseIndex: 1, phaseTitle: 'Wait', state: 'running', startedAt: Date.parse(T) }];
    await mount({
      events: [
        event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'One slow agent', workflowName: 'demo' }, { seq: 1, at: T }),
        event('workflow.progress', { taskId: 'wf1', workflowName: 'demo', progress }, { seq: 2 }),
      ],
    });
    openWidget('wf1');
    act(() => vi.advanceTimersByTime(0));
    expect(tableRows()[0][3]).toBe('5s');
    act(() => vi.advanceTimersByTime(2_000));
    expect(tableRows()[0][3]).toBe('7s');
    expect(widget()!.querySelector('tbody .animate-spin')).not.toBeNull();
  });

  it('Stop workflow in the widget stops the run, as the card’s does', async () => {
    await mount({ events: upTo(stopTask, 229) });
    openWidget('wkmzd07jp');
    await act(async () => void fireEvent.click(within(widget()!).getByRole('button', { name: 'Stop workflow' })));
    expect(fake.inputs.stopTask[0]).toEqual([A, 'wkmzd07jp']);
    expect(within(widget()!).getByRole('button', { name: 'stopping…' })).toHaveProperty('disabled', true);
    await act(async () => fake.fail('stopTask', 'engine went away'));
    expect(within(widget()!).getByText("Couldn't stop it: engine went away")).toBeTruthy();
  });

  it('a disk-only run’s widget has no Stop, and its agents open from the journal when the progress rows carry no id', async () => {
    const [run] = workflowRunsOf();
    const stripped: WorkflowRun = {
      ...run,
      snapshot: { ...run.snapshot!, workflowProgress: run.snapshot!.workflowProgress!.map((row) => ({ ...(row as Record<string, unknown>), agentId: undefined })) },
    };
    await mount({ status: null, sidecars: sidecarsOf('pass2/workflow-disk', run.runId), runs: [stripped] });
    openWidget(run.snapshot!.taskId!);
    expect(within(widget()!).queryByRole('button', { name: 'Stop workflow' })).toBeNull();
    expect(widget()!.querySelector('[data-part="status"]')?.textContent).toBe('completed');
    fireEvent.click(within(widget()!).getByRole('button', { name: /beta/ }));
    expect(openTool).toHaveBeenCalledWith('subagents', { appSessionId: A, params: { agentId: 'ae03d49e48b8ed708', appSessionId: A } });
  });

  it('an ended shell’s ago advances on the slow tick while shown, and reads the clock again when shown again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.parse('2026-09-28T10:03:00.000Z')); // five seconds after the shell's notification (seq 71)
    const { handle, rerender } = await mount({ events: upTo(stopOn, 71) });
    const line = () => document.querySelector('[data-shell="b53no4rmo"] [data-part="line"]')?.textContent;
    expect(line()).toBe('Sleep 30s then write BG_DONE to bg.txt · completed just now');
    act(() => vi.advanceTimersByTime(4 * SLOW_TICK_MS));
    expect(line()).toBe('Sleep 30s then write BG_DONE to bg.txt · completed 2m ago');
    rerender(<Mounted state={handle} visible={false} />);
    vi.setSystemTime(Date.now() + 10 * 60_000); // ten minutes pass while the tool is hidden: no timer runs
    rerender(<Mounted state={handle} visible />);
    act(() => vi.advanceTimersByTime(0));
    expect(line()).toBe('Sleep 30s then write BG_DONE to bg.txt · completed 12m ago');
  });

  it('open({ taskId }) on a fresh tab scrolls to the card once the graph shows it', async () => {
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.dataset.taskId ?? '');
    };
    try {
      await mount({ events: [], params: { taskId: 'wayue3on6' } });
      expect(scrolled).toEqual([]);
      push(upTo(workflow, 82));
      expect(scrolled).toEqual(['wayue3on6']);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('reads Phase · Queued only while no agent of the phase has started, and an untitled phase as Phase <index>', async () => {
    const queued = [
      { type: 'workflow_phase', index: 1, title: 'Solve' },
      { type: 'workflow_agent', index: 1, label: 'solve:a', phaseIndex: 1, state: 'queued', queuedAt: 1 },
      { type: 'workflow_agent', index: 2, label: 'judge', phaseIndex: 2, state: 'queued', queuedAt: 1 },
    ];
    await mount({
      events: [
        event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'Judge panel', isBackground: true, workflowName: 'demo' }, { seq: 1, at: T }),
        event('workflow.progress', { taskId: 'wf1', workflowName: 'demo', progress: queued }, { seq: 2 }),
      ],
    });
    expect(summaryLine('wf1')).toBe('Queued');
    openWidget('wf1');
    expect(options()).toEqual(['All phases|', 'Solve|Queued', '*Phase 2|Queued']); // no phase runs: the last
  });

  it('a workflow with no progress yet says phases arrive with the first frame, on the card and in the widget', async () => {
    await mount({ events: [event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'Judge panel', workflowName: 'demo' }, { seq: 1, at: T })] });
    expect(within(card('wf1')).getByText('Phases arrive with the first progress frame')).toBeTruthy();
    openWidget('wf1');
    expect(within(widget()!).getByText('Phases arrive with the first progress frame')).toBeTruthy();
  });

  it('a per-agent row with an agentId opens the drill-in through ctx.openTool; a row without one is not a button', async () => {
    await mount({ events: upTo(workflow, 93) });
    openWidget('wayue3on6');
    const alpha = within(widget()!).getByRole('button', { name: /alpha/ });
    fireEvent.click(alpha);
    expect(openTool).toHaveBeenCalledWith('subagents', { appSessionId: A, params: { agentId: expect.any(String), appSessionId: A } });
    unmountAll();
    await mount({
      events: [
        event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'Judge panel', workflowName: 'demo' }, { seq: 1, at: T }),
        event('workflow.progress', { taskId: 'wf1', progress: [{ type: 'workflow_agent', index: 1, label: 'queued-one', phaseIndex: 1, state: 'queued' }] }, { seq: 2 }),
      ],
    });
    openWidget('wf1');
    expect(within(widget()!).queryByRole('button', { name: /queued-one/ })).toBeNull();
    expect(within(widget()!).getByTitle('Not started').textContent).toBe('queued-one');
    // a started row whose id neither the row nor the journal gives is not "not started"
    unmountAll();
    await mount({
      events: [
        event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'Judge panel', workflowName: 'demo' }, { seq: 1, at: T }),
        event('workflow.progress', { taskId: 'wf1', progress: [{ type: 'workflow_agent', index: 1, label: 'done-one', phaseIndex: 1, state: 'done', startedAt: 1 }] }, { seq: 2 }),
      ],
    });
    openWidget('wf1');
    expect(within(widget()!).queryByTitle('Not started')).toBeNull();
    expect(within(widget()!).getByTitle('No transcript known for this agent').textContent).toBe('done-one');
  });

  it('a per-agent row opens its drill-in on a pinned Subagents tab still holding another session, keeping the selection', async () => {
    await mount({ events: upTo(workflow, 93) });
    openWidget('wayue3on6');
    fireEvent.click(within(widget()!).getByRole('button', { name: /alpha/ }));
    const [, options] = openTool.mock.calls.at(-1) as [string, { params: SubagentsParams }];
    const pinned = subagentsTool.createState({ appSessionId: 'X' as AppSessionId, session: null, instanceId: 'subagents:pinned', params: undefined as unknown as SubagentsParams }); // a restored tab's params
    act(() => subagentsTool.open!(pinned, options.params)); // the host's retarget of a single-instance tab passes the params alone
    expect(pinned.snapshot()).toMatchObject({ appSessionId: A, view: { kind: 'agent', agentId: 'a014f6be436bed86b' } });
    subagentsTool.dispose?.(pinned);
  });

  it('lists a background shell from per-task-stop-on with Output enabled from the result text, before the notification', async () => {
    await mount({ events: upTo(stopOn, 44) });
    expect(heading('shells')).toBe('Shells · 1 running');
    const row = document.querySelector<HTMLElement>('[data-shell="b53no4rmo"]')!;
    expect(row.querySelector('[data-part="line"]')?.textContent).toMatch(/^Sleep 30s then write BG_DONE to bg\.txt · running /);
    const output = within(row).getByRole('button', { name: 'Output' }) as HTMLButtonElement;
    expect(output.disabled).toBe(false);
    fireEvent.click(output);
    const path = useTaskGraph.getState().entries.get(A)!.graph.tasks.get('b53no4rmo' as TaskId)!.outputFile;
    expect(openLog).toHaveBeenCalledWith(A, path, 'Sleep 30s then write BG_DONE to bg.txt');
  });

  it('disables Output until the engine reports the path', async () => {
    await mount({ events: upTo(stopOn, 43) });
    const output = within(document.querySelector<HTMLElement>('[data-shell="b53no4rmo"]')!).getByRole('button', { name: 'Output' }) as HTMLButtonElement;
    expect(output.disabled).toBe(true);
    expect(output.title).toBe('Output path not reported yet');
  });

  it('lists a monitor from a task.started of type monitor_ws', async () => {
    await mount({ events: [event('task.started', { taskId: 'm1', taskType: 'monitor_ws', description: 'until tests pass' }, { seq: 1, at: T })] });
    expect(heading('monitors')).toBe('Monitors · 1');
    expect(document.querySelector('[data-monitor="m1"] [data-part="line"]')?.textContent).toMatch(/^until tests pass · running /);
  });

  it('Stop marks stopping… at once, and the row reads stopped after R6’s recorded sequence', async () => {
    await mount({ events: upTo(stopTask, 43) });
    const row = () => document.querySelector<HTMLElement>('[data-shell="ba3cr5gnx"]')!;
    await act(async () => void fireEvent.click(within(row()).getByRole('button', { name: 'Stop' })));
    expect(within(row()).getByRole('button', { name: 'stopping…' })).toHaveProperty('disabled', true);
    expect(fake.inputs.stopTask[0]).toEqual([A, 'ba3cr5gnx']);
    push(upTo(stopTask, 46).filter((e) => (e.seq ?? 0) > 43));
    await act(async () => fake.answer('stopTask'));
    expect(row().querySelector('[data-part="line"]')?.textContent).toMatch(/^Sleep then write DONE to bg\.txt · stopped /);
    expect(within(row()).queryByRole('button', { name: /Stop|stopping/ })).toBeNull();
  });

  it('Stop workflow reads stopping… and a second click is a no-op; a refused stop reads Couldn’t stop it', async () => {
    const { handle } = await mount({ events: upTo(stopTask, 229) });
    const stop = () => within(card('wkmzd07jp')).getByRole('button', { name: /Stop workflow|stopping…/ }) as HTMLButtonElement;
    await act(async () => void fireEvent.click(stop()));
    expect(stop().textContent).toBe('stopping…');
    expect(stop().disabled).toBe(true);
    await act(async () => void handle.stop('wkmzd07jp' as TaskId));
    expect(fake.pending('stopTask')).toBe(1);
    await act(async () => fake.fail('stopTask', 'engine went away'));
    expect(within(card('wkmzd07jp')).getByText("Couldn't stop it: engine went away")).toBeTruthy();
    expect(stop().textContent).toBe('Stop workflow');
  });

  it('a disk-only session reads the shells sentence and lists the runs on disk with their state and summary', async () => {
    await mount({ status: null, sidecars: sidecarsOf('pass2/workflow-disk', 'wf_7cacbb2d-902'), runs: workflowRunsOf() });
    expect(screen.getByText('Shells and monitors are known only while the session runs here')).toBeTruthy();
    expect(heading('workflows')).toBe('Workflow runs on disk · 1');
    const [run] = workflowRunsOf();
    const wf = card(run.snapshot!.taskId!);
    expect(wf.querySelector('[data-part="status"]')?.textContent).toBe('completed');
    expect(summaryLine(run.snapshot!.taskId!)).toBe('Done');
    expect(section('shells')).toBeNull();
    expect(within(wf).queryByRole('button', { name: 'Stop workflow' })).toBeNull();
    openWidget(run.snapshot!.taskId!);
    expect(tableRows()).toHaveLength(2);
  });

  // E7 (Design §2, Decision Log 18): the id a hand-off names, resolved to the run.
  it('open({ view: "run" }) resolves the task id, the Workflow call’s tool-use id and the run id; a name nothing resolves waits with a note', async () => {
    const { handle } = await mount({ events: upTo(workflow, 82) });
    const node = useTaskGraph.getState().entries.get(A)!.graph.tasks.get('wayue3on6' as TaskId)!;
    act(() => backgroundTool.open!(handle, { taskId: node.toolUseId as string, view: 'run' }));
    expect(handle.snapshot().view).toEqual({ kind: 'run', taskId: 'wayue3on6', phase: null });
    expect(widget()?.dataset.run).toBe('wayue3on6');
    act(() => backgroundTool.open!(handle, { taskId: 'wayue3on6' })); // a plain selection shows the list
    expect(widget()).toBeNull();
    act(() => backgroundTool.open!(handle, { taskId: 'not-yet', view: 'run' }));
    expect(widget()).toBeNull();
    expect(screen.getByText('Run not found yet')).toBeTruthy();
    expect(handle.snapshot()).toMatchObject({ view: { kind: 'list' }, selected: 'not-yet', pendingRun: ['not-yet'] });
    act(() => backgroundTool.open!(handle, undefined as unknown as BackgroundParams)); // the summary's Open (no params): the list, the wait dropped
    expect(screen.queryByText('Run not found yet')).toBeNull();
    expect(handle.snapshot().pendingRun).toBeNull();
  });

  it('a disk-only ref opens the widget by its run id before the snapshot names the task, and stays on it when the read folds the run', async () => {
    const [run] = workflowRunsOf();
    const taskId = run.snapshot!.taskId!;
    const { handle } = await mount({ status: null, runs: [{ runId: run.runId, snapshot: null, journal: [] }], params: { taskId, runId: run.runId, view: 'run' } });
    expect(handle.snapshot().view).toMatchObject({ kind: 'run', taskId: run.runId });
    expect(within(widget()!).getByText('Phases arrive with the first progress frame')).toBeTruthy();
    act(() => useTaskGraph.getState().applyDisk(A, { runs: [run] })); // the snapshot is read: the node is keyed by its task id now
    expect(widget()?.dataset.run).toBe(taskId);
    expect(options()).toEqual(['All phases|', '*Echo|2/2']);
  });

  it('a fresh tab opened on a run no read has brought yet opens the widget once the run arrives', async () => {
    const { handle } = await mount({ events: [], params: { taskId: 'wayue3on6', view: 'run' } });
    expect(screen.getByText('Run not found yet')).toBeTruthy();
    push(upTo(workflow, 82));
    expect(handle.snapshot()).toMatchObject({ view: { kind: 'run', taskId: 'wayue3on6' }, pendingRun: null, selected: 'wayue3on6' });
    expect(widget()?.dataset.run).toBe('wayue3on6');
  });

  it('Back keeps the list’s scroll; a pinned tab following another session leaves the widget', async () => {
    const { handle } = await mount({ events: upTo(workflow, 93) });
    const scroller = () => document.querySelector<HTMLElement>('[data-section="workflows"]')!.parentElement!;
    scroller().scrollTop = 40;
    fireEvent.scroll(scroller());
    openWidget('wayue3on6');
    fireEvent.click(within(widget()!).getByRole('button', { name: '‹ Background work' }));
    expect(handle.snapshot().scrollTop).toBe(40);
    expect(scroller().scrollTop).toBe(40);
    openWidget('wayue3on6');
    act(() => handle.follow('B' as AppSessionId));
    expect(handle.snapshot()).toMatchObject({ appSessionId: 'B', view: { kind: 'list' }, pendingRun: null });
  });

  it('reads Nothing running for a live session with no background work, the Tasks section still shown', async () => {
    await mount({ events: [] });
    expect(screen.getByText('Nothing running')).toBeTruthy();
    expect(section('workflows')).toBeNull();
    expect(section('tasks')).not.toBeNull();
  });

  it('createState with no params opens every section expanded and nothing selected; open({ taskId }) selects the card', async () => {
    const { handle } = await mount({ events: upTo(workflow, 82) });
    expect(handle.snapshot()).toMatchObject({ selected: null });
    expect([...handle.snapshot().expanded].sort()).toEqual(['monitors', 'shells', 'tasks', 'workflows']);
    fireEvent.click(within(section('workflows')!).getByRole('button', { name: 'Workflows · 1' }));
    expect(document.querySelector('[data-workflow="wayue3on6"]')).toBeNull();
    act(() => backgroundTool.open!(handle, { taskId: 'wayue3on6' }));
    expect(handle.snapshot().selected).toBe('wayue3on6');
    expect(card('wayue3on6').dataset.selected).toBe('true');
  });

  it('a pinned tab follows the shown session: selection and scroll reset, the old watch released', async () => {
    const { handle } = await mount({ events: upTo(workflow, 82), params: { taskId: 'wayue3on6' } });
    expect(handle.snapshot().selected).toBe('wayue3on6');
    act(() => handle.follow('B' as AppSessionId));
    expect(handle.snapshot()).toMatchObject({ appSessionId: 'B', selected: null, scrollTop: 0 });
    expect(fake.calls.filter((c) => c === 'off eventBatch')).toHaveLength(1);
  });

  it('no session shown (the Overview) leaves a pinned tab as it was', async () => {
    const { handle } = await mount({ events: upTo(workflow, 82), params: { taskId: 'wayue3on6' } });
    const before = handle.snapshot();
    act(() => handle.follow(null));
    expect(handle.snapshot()).toBe(before);
    expect(fake.calls).not.toContain('off eventBatch');
  });

  it('dispose releases the store’s watch', async () => {
    const { handle, unmount } = await mount({ events: [] });
    unmount();
    expect(fake.listeners()).toBe(1);
    backgroundTool.dispose(handle);
    expect(fake.listeners()).toBe(0);
  });

  it('the summary reads the graph’s counts while the workflow runs, and the runs on disk for a disk-only session', async () => {
    seedSessions(live());
    const open = vi.fn();
    render(<BackgroundSummary appSessionId={A} open={open} />);
    await act(async () => {
      await fake.answer('events', { events: upTo(workflow, 82), lastSeq: 82, complete: true });
      await fake.answer('subagents', []);
      await fake.answer('workflows', []);
    });
    const summary = () => document.querySelector<HTMLElement>('[data-summary="background"]')!;
    expect(summary().textContent).toContain('1 workflow');
    push(workflow.filter((e) => (e.seq ?? 0) > 82));
    expect(summary().textContent).toContain('Nothing running');
    fireEvent.click(within(summary()).getByRole('button', { name: 'Open' }));
    expect(open).toHaveBeenCalledWith();
    cleanup();
    useTaskGraph.setState({ entries: new Map() });
    seedSessions(null);
    render(<BackgroundSummary appSessionId={A} open={open} />);
    await act(async () => {
      await fake.answer('subagents', []);
      await fake.answer('workflows', workflowRunsOf());
    });
    expect(summary().textContent).toContain('1 workflow run on disk');
    expect(summary().textContent).toContain('Shells and monitors are known only while the session runs here');
  });

  it('the summary of a disk-only session whose runs could not be read says why', async () => {
    seedSessions(null);
    render(<BackgroundSummary appSessionId={A} open={vi.fn()} />);
    await act(async () => {
      await fake.answer('subagents', []);
      await fake.fail('workflows', 'unknown app session');
    });
    const text = document.querySelector<HTMLElement>('[data-summary="background"]')!.textContent;
    expect(text).toContain('Workflow runs unavailable: unknown app session');
    expect(text).toContain('Shells and monitors are known only while the session runs here');
  });
});

describe('task checklist', () => {
  const task = (id: string, status: PersistedTask['status'], subject: string, activeForm?: string): PersistedTask => ({ id, subject, description: '', status, blocks: [], blockedBy: [], ...(activeForm ? { activeForm } : {}) });
  const checklist = () => section('tasks')!;
  const rows = () => Array.from(checklist().querySelectorAll<HTMLElement>('[data-task]')).map((li) => li.textContent);

  beforeEach(() => {
    lists = {
      'sess-1': [task('1', 'completed', 'Map handlers'), task('2', 'pending', 'Run tests'), task('3', 'in_progress', 'Check reorder', 'Checking keyboard reorder'), task('4', 'completed', 'Reproduce')],
      'team-list': [task('1', 'pending', 'Team task')],
    };
  });

  it('reads Tasks · 2/4, the in-progress row first with its activeForm, the completed folded behind the toggle', async () => {
    await mount({ status: live({ taskListId: 'sess-1' }) });
    await waitFor(() => expect(heading('tasks')).toBe('Tasks · 2/4'));
    expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests']);
    const toggle = within(checklist()).getByRole('button', { name: '2 earlier tasks completed' });
    fireEvent.click(toggle);
    expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests', 'Map handlers', 'Reproduce']);
    expect(tasksCalls).toEqual(['sess-1']);
  });

  it('follows the status’s list id to another list', async () => {
    await mount({ status: live({ taskListId: 'sess-1' }) });
    await waitFor(() => expect(heading('tasks')).toBe('Tasks · 2/4'));
    setStatus(live({ taskListId: 'team-list' }));
    await waitFor(() => expect(heading('tasks')).toBe('Tasks · 0/1'));
    expect(rows()).toEqual(['Team task']);
  });

  it('labels a disk-only session’s list session list, read from the record’s engine session id', async () => {
    await mount({ status: null, engineSessionId: 'sess-1' });
    await waitFor(() => expect(heading('tasks')).toBe('Tasks · 2/4'));
    expect(checklist().querySelector('[data-part="label"]')?.textContent).toBe('session list');
  });

  it('reads unavailable until the engine reports its list, and reads nothing', async () => {
    await mount({ status: live({ taskListId: null }) });
    expect(within(checklist()).getByText('Tasks unavailable until the engine reports its list')).toBeTruthy();
    expect(tasksCalls).toEqual([]);
  });

  it('re-runs on the client’s tasks-changed event for its list and not another', async () => {
    await mount({ status: live({ taskListId: 'sess-1' }) });
    await waitFor(() => expect(tasksCalls).toEqual(['sess-1']));
    act(() => tasksChanged.forEach((l) => l({ listId: 'other' } as EventPayload<'fs.tasksChanged'>)));
    await act(async () => {});
    expect(tasksCalls).toEqual(['sess-1']);
    lists['sess-1'] = [...(lists['sess-1'] as PersistedTask[]), task('5', 'pending', 'New one')];
    act(() => tasksChanged.forEach((l) => l({ listId: 'sess-1' } as EventPayload<'fs.tasksChanged'>)));
    await waitFor(() => expect(heading('tasks')).toBe('Tasks · 2/5'));
    expect(tasksCalls).toEqual(['sess-1', 'sess-1']);
  });

  it('a failed read says why; an empty list says the engine is not creating task lists; useCommand is never called', async () => {
    lists['sess-1'] = new Error('permission denied');
    await mount({ status: live({ taskListId: 'sess-1' }) });
    await waitFor(() => expect(within(checklist()).getByText('Tasks unavailable: permission denied')).toBeTruthy());
    unmountAll();
    // The architect's ruling (2026-09-29): TaskCreate is off on the current models unless the launch enables TODO tools,
    // so an empty list is the engine not creating one, not an empty plan. The launch's environment is not on any renderer
    // surface, so the line that would say TODO tools are off is not shown.
    await mount({ status: live({ taskListId: 'empty' }) });
    await waitFor(() => expect(within(checklist()).getByText('The engine is not creating task lists in this session')).toBeTruthy());
    expect(within(checklist()).queryByText('No tasks')).toBeNull();
    expect(within(checklist()).queryByText('TODO tools are off in this launch')).toBeNull();
    expect(query.useCommand).not.toHaveBeenCalled();
  });

  // E7 (P-20, Design §6): the section stays and its heading opens the Tasks panel on this session.
  it('the heading’s Open opens the Tasks panel on the session', async () => {
    await mount({ status: live({ taskListId: 'sess-1' }) });
    await waitFor(() => expect(heading('tasks')).toBe('Tasks · 2/4'));
    // the action sits beside the heading, not in it: the heading's accessible name is its own text
    expect(within(checklist()).getByRole('heading', { level: 3 }).textContent).toBe('Tasks · 2/4');
    expect(within(checklist()).getByRole('heading', { name: 'Tasks · 2/4' })).toBeTruthy();
    fireEvent.click(within(checklist()).getByRole('button', { name: 'Open the Tasks panel' }));
    expect(openTool).toHaveBeenCalledWith('tasks', { appSessionId: A, params: { appSessionId: A } });
  });
});
