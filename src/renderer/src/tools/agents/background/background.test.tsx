// Background tasks (C8b execution document, M3; the UX wave's U8b, M7: by state, Running, Scheduled, Tasks, Done): workflow cards with phases and the per-agent table over the recorded
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
import type { EventName, EventPayload } from '@shared/ipc/schema';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import type { PersistedTask } from '@shared/wire/store';
import { record, status } from '../../../../../../test/support/builders';
import { at, TEST_MACHINE } from '../../../../../../test/support/machine';
import { event, replayed, sidecarsOf, upTo, workflowRunsOf } from '../../../../../../test/support/agents-events';
import { connectAgentWorkEvents } from '../../../ipc/events';
import * as query from '../../../ipc/query';
import type { PanelToolContext } from '../../../panel/tool';
import { useSessions } from '../../../stores/sessions';
import { applyLaneAState, resetLaneAStore } from '../../../stores/lane-a'; // P5 O9 M5
import { laneAState, LIVE_OPS } from '../../../lane-a/test-support/lane-a-state'; // P5 O9 M5
import { resetLaneAWatches } from '../../../lane-a/watches'; // P5 O9 M5
import type { Job } from 'desk-hub/protocol'; // P5 O9 M5
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client'; // P5 O9 M5
import { useSetup } from '../../../sessions/store';
import { setAgentWorkClient, type AgentWorkClient } from '../client';
import { fakeAgentWorkClient, type FakeAgentWorkClient } from '../fake-work-client';
import { openLog } from '../log/LogTool';
import { useTaskGraph } from '../store';
import { SLOW_TICK_MS, STOP_DOUBT_MS } from '../subagents/shared';
import { subagentsTool, type SubagentsParams } from '../subagents/SubagentsTool';
import { BackgroundSummary } from './BackgroundSummary';
import { backgroundTool, type BackgroundHandle, type BackgroundParams } from './BackgroundTool';
import { MonitorRow, ShellRow } from './TaskRows'; // the UX wave's U8b
import type { TaskNode } from '../model/task-graph';
// E7 start: the Scheduled section
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextCronMatch, parseCron, RECURRING_MAX_AGE_MS } from '@shared/engine/cron';
import { useTranscriptStore } from '../../../transcript';
import { cellId } from '../../../transcript/model/keys';
import { flush } from '../fake-work-client';
import { formatIn } from '../model/elapsed';
import { REL } from '../../../test-support/relative-time';
import { pagedSource } from '../../../harness/paged';
// E7 end

// The spies are made once, outside the async factories (P2-F S): vitest runs an async factory again for an importer that
// arrives before it resolves, and a spy made inside it would leave the code and this file holding different ones.
const spies = vi.hoisted(() => ({ openLog: vi.fn<typeof openLog>(), useCommand: vi.fn<typeof query.useCommand>() }));
vi.mock('../log/LogTool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../log/LogTool')>();
  return { ...actual, openLog: spies.openLog };
});
vi.mock('../../../ipc/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../ipc/query')>();
  return { ...actual, useCommand: spies.useCommand.mockImplementation(actual.useCommand) };
});

const A = at('A') as AppSessionId; // the page holds addresses
const TITLE = 'Fix drag';
const T = '2026-09-29T10:00:00.000Z';

let fake: FakeAgentWorkClient;
let client: AgentWorkClient;
let lists: Record<string, PersistedTask[] | Error>;
const tasksCalls: string[] = [];
const tasksChanged = new Set<(payload: EventPayload<'fs.tasksChanged'>) => void>();
const handles: BackgroundHandle[] = [];
let disconnect: (() => void) | null = null;

const live = (over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status('A'), appSessionId: A, launchId: 'journal', taskListId: null, ...over });

function seedSessions(statusOfA: EngineSessionStatus | null, engineSessionId: string | null = 'eng-A'): void {
  useSessions.setState((s) => ({
    records: new Map([[A, record('A', { appId: A, title: { text: TITLE, source: 'user' }, engineSessionId: engineSessionId as SessionId | null })]]),
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
  const ctx: PanelToolContext = { appSessionId: A, session, status: engine, pinned: false, visible, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool, editorHost: { surface: 'panel', tabId: 'background:test' } };
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

const push = (events: SessionEvent[]) => act(() => fake.batch(A, events));
const section = (name: string) => document.querySelector<HTMLElement>(`[data-section="${name}"]`);
// the heading's own text: its toggle (E7: the Tasks heading also holds `Open`)
const heading = (name: string) => section(name)?.querySelector('h3 > button')?.textContent;
// The UX wave's U8b (M7): a section folded or unfolded by its heading (Done is folded at first)
const toggleSection = (name: string) => act(() => void fireEvent.click(section(name)!.querySelector('h3 > button')!));
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
    tasks: async (_machine, listId) => {
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
    expect(heading('running')).toBe('Running 1');
    expect(card('wayue3on6').querySelector('[data-kind-mark="workflow"]')).not.toBeNull(); // the Subagents tool's icon marks a workflow
    const wf = card('wayue3on6');
    expect(within(wf).getByRole('heading').textContent).toBe('Two echo agents in one phase');
    const line = wf.querySelector('[data-part="line"]')?.textContent;
    expect(line).toMatch(/^workflow maws-probe · .+ · 2 agents · tokens unavailable$/); // no row has reported tokens at seq 82
    expect(summaryLine('wayue3on6')).toBe('Echo · 0/2 agents');
    expect(wf.querySelector('table, [data-phase]')).toBeNull(); // the per-phase tables live in the widget (Decision Log 1)
    push(upTo(workflow, 93).filter((e) => (e.seq ?? 0) > 82));
    expect(summaryLine('wayue3on6')).toBe('Done');
    expect(card('wayue3on6').querySelector('[data-part="line"]')?.textContent).toMatch(/ · 17\.7k tokens$/); // alpha's 8,861 + beta's 8,857
    push(workflow.filter((e) => (e.seq ?? 0) > 93)); // the run's notification (seq 96): it ended, under the folded Done
    expect(section('running')).toBeNull();
    expect(heading('done')).toBe('Done 1 · 1 workflow');
    toggleSection('done');
    expect(summaryLine('wayue3on6')).toBe('Done');
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
    fireEvent.click(within(widget()!).getByRole('button', { name: '‹ Background tasks' }));
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
    toggleSection('done');
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
    toggleSection('done');
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
    toggleSection('done');
    const line = () => document.querySelector('[data-shell="b53no4rmo"] [data-part="line"]')?.textContent;
    expect(line()).toBe(`Sleep 30s then write BG_DONE to bg.txt · completed ${REL.now}`);
    act(() => vi.advanceTimersByTime(4 * SLOW_TICK_MS));
    expect(line()).toBe(`Sleep 30s then write BG_DONE to bg.txt · completed ${REL.agoNarrow(2, 'minute')}`);
    rerender(<Mounted state={handle} visible={false} />);
    vi.setSystemTime(Date.now() + 10 * 60_000); // ten minutes pass while the tool is hidden: no timer runs
    rerender(<Mounted state={handle} visible />);
    act(() => vi.advanceTimersByTime(0));
    expect(line()).toBe(`Sleep 30s then write BG_DONE to bg.txt · completed ${REL.agoNarrow(12, 'minute')}`);
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
    expect(heading('running')).toBe('Running 1');
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
    expect(heading('running')).toBe('Running 1');
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
    toggleSection('done');
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

  // P5 O9 M5: a terminal session driven through its bridge lists the jobs main derives from its transcript, which its
  // watch carries (a snapshot's `jobs`, then each `subagents`); Stop goes to its bridge; no output tail locally.
  describe('a terminal session driven through its bridge', () => {
    const job = (taskId: string, over: Partial<Job> = {}): Job => ({ taskId, kind: 'shell', toolUseId: `toolu_${taskId}`, startedAt: T, description: `run ${taskId}`, command: 'sleep 60', outputFile: `/tmp/${taskId}.output`, status: 'running', ...over });
    const holder = (held: { kind: 'terminal'; pid: number } | { kind: 'none' }) => useSessions.setState((s) => ({ records: new Map([[A, { ...s.records.get(A)!, holder: held }]]) }));
    const install = (given: Parameters<typeof fakeClient>[0]) => {
      bridge = fakeClient({ 'laneA.watch': { watch: 'w1' }, 'laneA.unwatch': null, ...given });
      const { client } = bridge;
      // the preload's bridge over it: bare ids, its events from the local machine
      (window as unknown as { maws: unknown }).maws = { localMachine: client.localMachine, invoke: client.invoke, on: (name: EventName, listener: (payload: unknown) => void) => client.on(name, (payload) => listener(payload)) };
    };
    let bridge: FakeClient;
    const plane = (kind: 'snapshot' | 'subagents', jobs: Job[]) =>
      act(() => bridge.event('laneA.plane', { appSessionId: 'A', watch: 'w1', messages: [{ project: '', machine: 'm', session: 'eng-A', kind, sub: 'w1', n: kind === 'snapshot' ? 0 : 1, body: kind === 'snapshot' ? { streaming: [], usage: null, jobs } : { subagents: [], jobs, mcp: [] } }] }));
    const ended = (reason: string) => act(() => bridge.event('laneA.plane', { appSessionId: 'A', watch: 'w1', ended: reason }));
    const row = (taskId: string) => document.querySelector<HTMLElement>(`[data-shell="${taskId}"]`);
    const watched = async () => waitFor(() => expect(bridge.invoked('laneA.watch')).toHaveLength(1));

    beforeEach(() => {
      install({ 'laneA.stopTask': { state: 'done', result: null } });
      seedSessions(null);
      holder({ kind: 'terminal', pid: 4242 });
      applyLaneAState(A, laneAState(A));
    });
    afterEach(() => {
      cleanup();
      resetLaneAWatches();
      resetLaneAStore();
      Reflect.deleteProperty(window, 'maws');
    });

    it('lists its shells and monitors from its watch, with Stop for a running one and no output tail', async () => {
      render(<Mounted state={create(undefined)} />);
      await watched();
      expect(bridge.invoked('laneA.watch')).toEqual([{ appSessionId: 'A' }]);
      expect(screen.queryByText('Shells and monitors are known only while the session runs here')).toBeNull();
      plane('snapshot', [job('bsleep01'), job('bbuild02', { status: 'failed', endedAt: T }), job('bmon0003', { kind: 'monitor', command: undefined, outputFile: null, description: 'watch the log' })]);
      expect(heading('running')).toBe('Running 2');
      expect(heading('done')).toBe('Done 1 · 1 shell');
      toggleSection('done');
      expect(within(row('bsleep01')!).getByRole('button', { name: 'Stop' })).toBeTruthy();
      expect(within(row('bsleep01')!).queryByRole('button', { name: 'Output' })).toBeNull();
      expect(within(row('bbuild02')!).queryByRole('button', { name: 'Stop' })).toBeNull();
      expect(row('bbuild02')!.textContent).toContain('failed');
      expect(document.querySelector('[data-monitor="bmon0003"]')!.textContent).toContain('watch the log');
    });

    it('stops a running shell through the bridge, reading stopping… until the transcript says it ended', async () => {
      render(<Mounted state={create(undefined)} />);
      await watched();
      plane('snapshot', [job('bsleep01')]);
      fireEvent.click(within(row('bsleep01')!).getByRole('button', { name: 'Stop' }));
      await waitFor(() => expect(bridge.invoked('laneA.stopTask')).toEqual([{ appSessionId: 'A', taskId: 'bsleep01' }]));
      expect(within(row('bsleep01')!).getByRole('button', { name: 'stopping…' })).toBeTruthy();
      plane('subagents', [job('bsleep01', { status: 'stopped', endedAt: T })]);
      toggleSection('done');
      expect(within(row('bsleep01')!).queryByRole('button')).toBeNull();
      expect(row('bsleep01')!.textContent).toContain('stopped');
    });

    it('draws Stop from the stop-task capability: disabled in place with its reason when the bridge can’t stop', async () => {
      applyLaneAState(A, laneAState(A, { ops: LIVE_OPS.filter((op) => op !== 'stop') }));
      render(<Mounted state={create(undefined)} />);
      await watched();
      plane('snapshot', [job('bsleep01')]);
      const stop = within(row('bsleep01')!).getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
      expect(stop.disabled).toBe(true);
      expect(stop.getAttribute('title')).toBe('Not in this session’s sminos (1.25.0)');
      fireEvent.click(stop);
      expect(bridge.invoked('laneA.stopTask')).toEqual([]);
    });

    it('shows a refused stop on the row, its Stop offered again', async () => {
      install({ 'laneA.stopTask': { state: 'refused', code: 'not-running', message: 'that background task is not running: it ended' } });
      render(<Mounted state={create(undefined)} />);
      await watched();
      plane('snapshot', [job('bsleep01')]);
      fireEvent.click(within(row('bsleep01')!).getByRole('button', { name: 'Stop' }));
      await waitFor(() => expect(row('bsleep01')!.textContent).toContain('that background task is not running: it ended'));
      expect(within(row('bsleep01')!).getByRole('button', { name: 'Stop' })).toBeTruthy();
    });

    it('keeps its jobs exited once its holder ends, and forgets running ones whose watch ended unsaid', async () => {
      render(<Mounted state={create(undefined)} />);
      await watched();
      plane('snapshot', [job('bsleep01')]);
      plane('subagents', [job('bsleep01', { status: 'exited' })]);
      ended('the session left the terminal');
      act(() => {
        applyLaneAState(A, null);
        holder({ kind: 'none' });
      });
      toggleSection('done');
      expect(row('bsleep01')!.textContent).toBe('run bsleep01 · ended with the session'); // exited
      expect(within(row('bsleep01')!).queryByRole('button')).toBeNull();
      expect(screen.queryByText('Shells and monitors are known only while the session runs here')).toBeNull();

      const opened = bridge.invoked('laneA.watch').length;
      act(() => {
        holder({ kind: 'terminal', pid: 4243 });
        applyLaneAState(A, laneAState(A));
      });
      await waitFor(() => expect(bridge.invoked('laneA.watch').length).toBeGreaterThan(opened));
      plane('snapshot', [job('bsleep01')]);
      ended('the session’s bridge went away');
      act(() => {
        applyLaneAState(A, null);
        holder({ kind: 'none' });
      });
      expect(row('bsleep01')).toBeNull();
      expect(screen.getByText('Shells and monitors are known only while the session runs here')).toBeTruthy();
    });

    // A session once run in MAWS keeps its exited engine status after a terminal resumes it: who holds it now decides.
    it('lists the jobs its bridge derives and stops through the bridge, though an exited engine status is kept', async () => {
      act(() => {
        seedSessions(live({ process: 'exited' }));
        holder({ kind: 'terminal', pid: 4242 });
      });
      render(<Mounted state={create(undefined)} />);
      await watched();
      plane('snapshot', [job('bsleep01')]);
      expect(heading('running')).toBe('Running 1');
      expect(within(row('bsleep01')!).queryByRole('button', { name: 'Output' })).toBeNull();
      fireEvent.click(within(row('bsleep01')!).getByRole('button', { name: 'Stop' }));
      await waitFor(() => expect(bridge.invoked('laneA.stopTask')).toEqual([{ appSessionId: 'A', taskId: 'bsleep01' }]));
      expect(fake.inputs.stopTask).toEqual([]); // never the engine's
    });

    // A run's widget follows custody too: the graph MAWS kept from its own run of the session is not live once a terminal
    // drives it, so no lane B Stop workflow is offered, as the list's card offers none.
    it('offers no Stop workflow in a run’s widget once a terminal drives the session', async () => {
      await mount({ events: upTo(stopTask, 229) });
      openWidget('wkmzd07jp');
      expect(within(widget()!).getByRole('button', { name: 'Stop workflow' })).toBeTruthy();
      act(() => holder({ kind: 'terminal', pid: 4242 }));
      expect(within(widget()!).queryByRole('button', { name: 'Stop workflow' })).toBeNull();
      expect(within(widget()!).queryByRole('button', { name: 'stopping…' })).toBeNull();
    });

    // A stop whose outcome is unknown may not have happened: said, and Stop offered again once the transcript has not
    // ended the job within the wait.
    it('says a stop with an unknown outcome may not have stopped, and offers Stop again after the wait', async () => {
      install({ 'laneA.stopTask': { state: 'unknown', why: 'timeout' } });
      render(<Mounted state={create(undefined)} />);
      await watched();
      plane('snapshot', [job('bsleep01')]);
      vi.useFakeTimers({ shouldAdvanceTime: true });
      fireEvent.click(within(row('bsleep01')!).getByRole('button', { name: 'Stop' }));
      await waitFor(() => expect(row('bsleep01')!.textContent).toContain('May not have stopped'));
      expect((within(row('bsleep01')!).getByRole('button', { name: 'stopping…' }) as HTMLButtonElement).disabled).toBe(true);
      await act(async () => vi.advanceTimersByTimeAsync(STOP_DOUBT_MS));
      const stop = within(row('bsleep01')!).getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
      expect(stop.disabled).toBe(false);
      expect(row('bsleep01')!.textContent).toContain('May not have stopped');
      fireEvent.click(stop);
      await waitFor(() => expect(bridge.invoked('laneA.stopTask')).toHaveLength(2));
    });

    it('drops the doubt once the transcript ends the job within the wait', async () => {
      install({ 'laneA.stopTask': { state: 'unknown', why: 'timeout' } });
      render(<Mounted state={create(undefined)} />);
      await watched();
      plane('snapshot', [job('bsleep01')]);
      fireEvent.click(within(row('bsleep01')!).getByRole('button', { name: 'Stop' }));
      await waitFor(() => expect(row('bsleep01')!.textContent).toContain('May not have stopped'));
      plane('subagents', [job('bsleep01', { status: 'stopped', endedAt: T })]);
      toggleSection('done');
      expect(row('bsleep01')!.textContent).not.toContain('May not have stopped');
      expect(within(row('bsleep01')!).queryByRole('button')).toBeNull();
    });

    // M7 fix round 1: a deep link is placed in the list on screen, which holds the jobs, not the engine's graph.
    it('a deep link to an ended job unfolds Done and selects its row', async () => {
      const state = create(undefined);
      render(<Mounted state={state} />);
      await watched();
      plane('snapshot', [job('bsleep01'), job('bbuild02', { status: 'completed', endedAt: T })]);
      act(() => backgroundTool.open!(state, { taskId: 'bbuild02' }));
      expect(state.snapshot().expanded.has('done')).toBe(true);
      expect(row('bbuild02')?.dataset.selected).toBe('true');
    });

    it('reads Nothing running once its jobs are read and none runs', async () => {
      render(<Mounted state={create(undefined)} />);
      await watched();
      expect(screen.queryByText('Nothing running')).toBeNull(); // not read yet
      plane('snapshot', [job('bbuild02', { status: 'completed', endedAt: T })]);
      expect(screen.getByText('Nothing running')).toBeTruthy();
      expect(heading('done')).toBe('Done 1 · 1 shell');
    });

    it('the summary counts its running jobs', async () => {
      render(<BackgroundSummary appSessionId={A} open={() => {}} />);
      await watched();
      plane('snapshot', [job('bsleep01'), job('bmon0003', { kind: 'monitor' }), job('bbuild02', { status: 'completed', endedAt: T })]);
      expect(document.querySelector('[data-summary="background"]')!.textContent).toContain('1 shell · 1 monitor');
      expect(screen.queryByText('Shells and monitors are known only while the session runs here')).toBeNull();
    });
  });

  it('a disk-only session reads the shells sentence, Nothing running, and lists the runs on disk with their state and summary', async () => {
    await mount({ status: null, sidecars: sidecarsOf('pass2/workflow-disk', 'wf_7cacbb2d-902'), runs: workflowRunsOf() });
    expect(screen.getByText('Shells and monitors are known only while the session runs here')).toBeTruthy();
    expect(section('running')).toBeNull(); // its past runs are in Done
    expect(screen.getByText('Nothing running').compareDocumentPosition(section('done')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading('done')).toBe('Done 1 · 1 workflow');
    toggleSection('done');
    const [run] = workflowRunsOf();
    const wf = card(run.snapshot!.taskId!);
    expect(wf.querySelector('[data-part="status"]')?.textContent).toBe('completed');
    expect(summaryLine(run.snapshot!.taskId!)).toBe('Done');
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
    const scroller = () => document.querySelector<HTMLElement>('[data-section="running"]')!.parentElement!;
    scroller().scrollTop = 40;
    fireEvent.scroll(scroller());
    openWidget('wayue3on6');
    fireEvent.click(within(widget()!).getByRole('button', { name: '‹ Background tasks' }));
    expect(handle.snapshot().scrollTop).toBe(40);
    expect(scroller().scrollTop).toBe(40);
    openWidget('wayue3on6');
    act(() => handle.follow('B' as AppSessionId));
    expect(handle.snapshot()).toMatchObject({ appSessionId: 'B', view: { kind: 'list' }, pendingRun: null });
  });

  // The UX wave's U8b (M7; Interfaces §F): by state, not by kind.
  describe('by state', () => {
    const later = (seconds: number) => new Date(Date.parse(T) + seconds * 1000).toISOString();
    const startedTask = (taskId: string, taskType: string, description: string, seq: number, over: Record<string, unknown> = {}) =>
      event('task.started', { taskId, toolUseId: `toolu_${taskId}`, taskType, description, isBackground: true, workflowName: taskType === 'local_workflow' ? 'demo' : null, ...over }, { seq, at: later(seq) });
    const ends = (taskId: string, status: string, n: number) => event('task.notification', { taskId, status }, { seq: 50 + n, at: later(100 + n) });
    const ids = (name: string) => Array.from(section(name)?.querySelectorAll<HTMLElement>('[data-task-id]') ?? []).map((el) => el.dataset.taskId);
    const marks = (name: string) => Array.from(section(name)?.querySelectorAll<HTMLElement>('[data-kind-mark]') ?? []).map((el) => el.dataset.kindMark);

    it('lists every running workflow, shell, monitor and other task in one Running N, in the order they started, each with its kind’s mark', async () => {
      await mount({
        events: [
          startedTask('wf1', 'local_workflow', 'Judge panel', 1),
          startedTask('sh1', 'local_bash', 'Build the site', 2),
          startedTask('m1', 'monitor_ws', 'until tests pass', 3),
          startedTask('x1', 'local_mcp', 'Index the docs', 4),
        ],
      });
      expect(heading('running')).toBe('Running 4');
      expect(section('running')!.querySelector('h3 [data-part="detail"]')?.className).toContain('text-fg-muted'); // the count muted
      expect(ids('running')).toEqual(['wf1', 'sh1', 'm1', 'x1']);
      expect(marks('running')).toEqual(['workflow', 'shell', 'monitor', 'other']);
      expect(section('done')).toBeNull();
      // a task of another kind: no Output, a Stop as a monitor has
      const other = document.querySelector<HTMLElement>('[data-other="x1"]')!;
      expect(other.querySelector('[data-part="line"]')?.textContent).toMatch(/^Index the docs · running /);
      expect(within(other).queryByRole('button', { name: 'Output' })).toBeNull();
      await act(async () => void fireEvent.click(within(other).getByRole('button', { name: 'Stop' })));
      expect(fake.inputs.stopTask[0]).toEqual([A, 'x1']);
    });

    it('folds one Done N last, newest first, its heading counting by kind with a kind of zero left out', async () => {
      await mount({
        events: [
          startedTask('wf1', 'local_workflow', 'Judge panel', 1),
          startedTask('sh1', 'local_bash', 'Build the site', 2),
          startedTask('m1', 'monitor_ws', 'until tests pass', 3),
          startedTask('x1', 'local_mcp', 'Index the docs', 4),
          ends('wf1', 'failed', 1), ends('sh1', 'completed', 2), ends('m1', 'stopped', 3), ends('x1', 'completed', 4),
          startedTask('sh2', 'local_bash', 'Serve the docs', 60),
        ],
      });
      expect(heading('running')).toBe('Running 1');
      expect(heading('done')).toBe('Done 4 · 1 workflow · 1 shell · 1 monitor · 1 task');
      expect(within(section('done')!).getByRole('button', { name: /^Done 4/ }).getAttribute('aria-expanded')).toBe('false');
      expect(ids('done')).toEqual([]);
      expect(Array.from(document.querySelectorAll<HTMLElement>('section[data-section]')).map((el) => el.dataset.section).at(-1)).toBe('done');
      toggleSection('done');
      expect(ids('done')).toEqual(['x1', 'm1', 'sh1', 'wf1']);
      expect(document.querySelector('[data-shell="sh1"] [data-part="line"]')?.textContent).toMatch(/^Build the site · completed /);
      unmountAll();
      await mount({ events: [startedTask('sh1', 'local_bash', 'Build the site', 1), startedTask('sh2', 'local_bash', 'Lint', 2), ends('sh1', 'completed', 1), ends('sh2', 'failed', 2)] });
      expect(heading('done')).toBe('Done 2 · 2 shells');
    });

    it('reads Nothing running above the folded Done; no heading reads 0', async () => {
      await mount({ events: [startedTask('sh1', 'local_bash', 'Build the site', 1), ends('sh1', 'completed', 1)] });
      expect(screen.getByText('Nothing running')).toBeTruthy();
      expect(section('running')).toBeNull();
      expect(heading('done')).toBe('Done 1 · 1 shell');
      expect(screen.getByText('Nothing running').compareDocumentPosition(section('done')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(Array.from(document.querySelectorAll('section[data-section] h3')).map((h) => h.textContent)).not.toContainEqual(expect.stringMatching(/\b0\b/));
    });

    it('open({ section: "done" }) shows the list with Done unfolded and changes no other fold', async () => {
      const { handle } = await mount({ events: [startedTask('sh1', 'local_bash', 'Build the site', 1), ends('sh1', 'completed', 1)], params: { taskId: 'wf-none', view: 'run' } });
      act(() => handle.toggle('scheduled')); // folded by the person
      act(() => backgroundTool.open!(handle, { section: 'done' }));
      expect(handle.snapshot().view).toEqual({ kind: 'list' });
      expect([...handle.snapshot().expanded].sort()).toEqual(['done', 'running', 'tasks']);
      expect(ids('done')).toEqual(['sh1']);
    });

    // M7 fix round 1: a task opened before it is listed has its section settled once it is, by where it is listed.
    it('open({ taskId }) of a task not listed yet unfolds Done once it loads ended, and selects it', async () => {
      const { handle } = await mount({ events: [] });
      act(() => backgroundTool.open!(handle, { taskId: 'sh1' }));
      expect(handle.snapshot().expanded.has('done')).toBe(false);
      push([startedTask('sh1', 'local_bash', 'Build the site', 1), ends('sh1', 'completed', 1)]);
      expect(handle.snapshot().expanded.has('done')).toBe(true);
      expect(document.querySelector<HTMLElement>('[data-shell="sh1"]')?.dataset.selected).toBe('true');
      toggleSection('done'); // settled once: the fold is the person's again
      expect(ids('done')).toEqual([]);
    });

    // M9 (M7's deferred Minor): navigation that supersedes a pending placement cancels it, so a later listing of the
    // task it named unfolds nothing.
    it.each([
      ['a run opened', (handle: BackgroundHandle) => handle.openRun('wf-other')],
      ['the list opened again', (handle: BackgroundHandle) => backgroundTool.open!(handle, {})],
      ['a run opened by its id', (handle: BackgroundHandle) => backgroundTool.open!(handle, { taskId: 'wf-other', view: 'run' })],
    ])('a placement superseded by %s does not unfold Done when its task loads ended', async (_, supersede) => {
      const { handle } = await mount({ events: [] });
      act(() => backgroundTool.open!(handle, { taskId: 'sh1' }));
      act(() => supersede(handle));
      expect(handle.snapshot().placing).toBeNull();
      act(() => handle.back());
      push([startedTask('sh1', 'local_bash', 'Build the site', 1), ends('sh1', 'completed', 1)]);
      expect(handle.snapshot().expanded.has('done')).toBe(false);
      expect(ids('done')).toEqual([]);
    });

    // The branch review's finding 7: the line clips to its box; its description is cut first (it shrinks to nothing before
    // the state gives up any width) and the state only once the row is narrower than the state alone, at most the line's
    // whole width; the buttons keep their size.
    it('a narrow row cuts a shell’s description first, then its state, and never paints past its own box', async () => {
      await mount({ events: [startedTask('sh1', 'local_bash', 'Build the site and then publish every page of it to the staging host', 1)] });
      const line = document.querySelector<HTMLElement>('[data-shell="sh1"] [data-part="line"]')!;
      expect(line.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'overflow-hidden']));
      expect(line.querySelector('[data-part="description"]')?.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'truncate']));
      const state = line.querySelector<HTMLElement>('[data-part="state"]')!;
      expect(state.className.split(' ')).toEqual(expect.arrayContaining(['shrink-0', 'max-w-full', 'overflow-hidden', 'text-ellipsis', 'whitespace-pre']));
      expect(state.textContent).toMatch(/^ · running /);
      expect(line.title).toBe(line.textContent);
      for (const button of within(document.querySelector<HTMLElement>('[data-shell="sh1"]')!).getAllByRole('button')) expect(button.className).toContain('shrink-0');
    });
  });

  // The branch review's finding 8: a row draws its kind's mark only when its caller asks (the panel does; desk web's depth
  // view, which draws the same rows, does not), and without the ask it holds no mark's element at all.
  it('a shell’s and a monitor’s rows hold their kind’s mark only when asked', () => {
    const shell: TaskNode = {
      taskId: 'sh1' as TaskId, kind: 'shell', taskType: 'local_bash', toolUseId: null, description: 'Build the site', status: 'running', stopping: false,
      startedAt: null, endedAt: null, usage: null, lastToolName: null, activity: null, summary: null, report: null, reason: null, outputFile: null,
      isBackground: true, parentTaskId: null, agent: null, workflow: null, provenance: { wire: true, disk: false, snapshot: true },
    };
    const monitor: TaskNode = { ...shell, taskId: 'm1' as TaskId, kind: 'monitor', taskType: 'monitor_ws' };
    const rows = (kindMark?: boolean) => (
      <>
        <ShellRow node={shell} now={0} selected={false} stopError={null} onStop={() => {}} onOutput={null} kindMark={kindMark} />
        <MonitorRow node={monitor} now={0} selected={false} stopError={null} onStop={() => {}} kindMark={kindMark} />
      </>
    );
    const marks = () => Array.from(document.querySelectorAll<HTMLElement>('[data-kind-mark]'), (mark) => mark.dataset.kindMark);
    const { rerender } = render(rows());
    expect(marks()).toEqual([]);
    rerender(rows(true));
    expect(marks()).toEqual(['shell', 'monitor']);
  });

  it('reads Nothing running for a live session with no background work, and no line about task lists', async () => {
    await mount({ events: [] });
    expect(screen.getByText('Nothing running')).toBeTruthy();
    expect(section('running')).toBeNull();
    expect(section('tasks')).toBeNull(); // no list: nothing about task lists here (the Tasks panel says it)
    expect(screen.queryByText('Tasks unavailable until the engine reports its list')).toBeNull();
  });

  it('createState with no params unfolds every section but Done and selects nothing; open({ taskId }) selects the card', async () => {
    const { handle } = await mount({ events: upTo(workflow, 82) });
    expect(handle.snapshot()).toMatchObject({ selected: null });
    expect([...handle.snapshot().expanded].sort()).toEqual(['running', 'scheduled', 'tasks']);
    fireEvent.click(within(section('running')!).getByRole('button', { name: 'Running 1' }));
    expect(document.querySelector('[data-workflow="wayue3on6"]')).toBeNull();
    act(() => backgroundTool.open!(handle, { taskId: 'wayue3on6' }));
    expect(handle.snapshot().selected).toBe('wayue3on6');
    expect(card('wayue3on6').dataset.selected).toBe('true');
  });

  it('a pinned tab follows the shown session: selection, scroll and folds reset (Done folded again), the old watch released', async () => {
    const { handle } = await mount({ events: upTo(workflow, 82), params: { taskId: 'wayue3on6' } });
    expect(handle.snapshot().selected).toBe('wayue3on6');
    act(() => handle.toggle('done'));
    act(() => handle.follow('B' as AppSessionId));
    expect(handle.snapshot()).toMatchObject({ appSessionId: 'B', selected: null, scrollTop: 0 });
    expect([...handle.snapshot().expanded].sort()).toEqual(['running', 'scheduled', 'tasks']);
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

  // P2-A (2026-10-09; the execution document §5.6): an exited status is not live; the summary acquires nothing
  it('the summary of a session whose process exited reads as disk-only, not as live', async () => {
    seedSessions(live({ process: 'exited' }));
    render(<BackgroundSummary appSessionId={A} open={vi.fn()} />);
    const text = () => document.querySelector<HTMLElement>('[data-summary="background"]')!.textContent;
    expect(text()).toContain('Shells and monitors are known only while the session runs here');
    expect(text()).not.toContain('Nothing running');
  });

  // P4 (the sitting's candidate 3): main refuses the runs read until it has registered the session, which a new chat's
  // start does a moment after the section asks; while the session starts that answer reads Starting…, muted
  describe('while the session starts', () => {
    afterEach(() => useSetup.setState({ invoking: new Set(), phases: new Map() }));
    const summary = () => document.querySelector<HTMLElement>('[data-summary="background"]')!;
    const unregistered = () => useSessions.setState((s) => ({ records: new Map(), engine: new Map(), digests: new Map(), recordsVersion: s.recordsVersion + 1 }));

    it('the runs read’s refusal reads Starting…, not the refusal in the danger colour, through the setup and the launch', async () => {
      unregistered();
      useSetup.setState({ invoking: new Set([A]) }); // a new chat's first send: C10's start in flight, nothing registered
      render(<BackgroundSummary appSessionId={A} open={vi.fn()} />);
      await act(async () => {
        await fake.answer('subagents', []);
        await fake.fail('workflows', 'unknown app session: A');
      });
      expect(summary().textContent).toContain('Starting…');
      expect(summary().textContent).not.toContain('unknown app session');
      expect(summary().querySelector('.text-danger')).toBeNull();
      act(() => useSetup.setState({ invoking: new Set() }));
      setStatus(live({ process: 'initializing' })); // the engine launching it
      expect(summary().textContent).toContain('Starting…');
      expect(summary().querySelector('.text-danger')).toBeNull();
      setStatus(live()); // ready: the graph's counts
      expect(summary().textContent).toContain('Nothing running');
    });

    it('the runs are read again once the session is registered, so a start that ends exited says nothing stale', async () => {
      unregistered();
      useSetup.setState({ invoking: new Set([A]) });
      render(<BackgroundSummary appSessionId={A} open={vi.fn()} />);
      await act(async () => {
        await fake.answer('subagents', []);
        await fake.fail('workflows', 'unknown app session: A');
      });
      act(() => seedSessions(null)); // main registered the record
      expect(fake.pending('workflows')).toBe(1);
      act(() => useSetup.setState({ invoking: new Set() }));
      setStatus(live({ process: 'exited' })); // the start failed into exited
      await act(() => fake.answer('workflows', workflowRunsOf()));
      expect(summary().textContent).toContain('1 workflow run on disk');
      expect(summary().textContent).not.toContain('unknown app session');
    });
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

  it('reads Tasks, the in-progress row first with its activeForm, the completed folded behind the toggle', async () => {
    await mount({ status: live({ taskListId: 'sess-1' }) });
    await waitFor(() => expect(heading('tasks')).toBe('Tasks'));
    expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests']);
    const toggle = within(checklist()).getByRole('button', { name: '2 earlier tasks completed' });
    fireEvent.click(toggle);
    expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests', 'Map handlers', 'Reproduce']);
    expect(tasksCalls).toEqual(['sess-1']);
  });

  it('follows the status’s list id to another list', async () => {
    await mount({ status: live({ taskListId: 'sess-1' }) });
    await waitFor(() => expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests']));
    setStatus(live({ taskListId: 'team-list' }));
    await waitFor(() => expect(rows()).toEqual(['Team task']));
  });

  it('labels a disk-only session’s list session list, read from the record’s engine session id', async () => {
    await mount({ status: null, engineSessionId: 'sess-1' });
    await waitFor(() => expect(heading('tasks')).toBe('Tasks'));
    expect(checklist().querySelector('[data-part="label"]')?.textContent).toBe('session list');
  });

  it('draws no Tasks section until the engine reports its list, and reads nothing', async () => {
    await mount({ status: live({ taskListId: null }) });
    expect(section('tasks')).toBeNull();
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
    await waitFor(() => expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests', 'New one']));
    expect(tasksCalls).toEqual(['sess-1', 'sess-1']);
  });

  // The UX wave's U8b (M7 decision 3): a list that cannot be read, and an empty one, draw no section here.
  it('a failed read and an empty list draw no Tasks section; useCommand is never called', async () => {
    lists['sess-1'] = new Error('permission denied');
    await mount({ status: live({ taskListId: 'sess-1' }) });
    await waitFor(() => expect(tasksCalls).toEqual(['sess-1']));
    await act(async () => {});
    expect(section('tasks')).toBeNull();
    expect(screen.queryByText('Tasks unavailable: permission denied')).toBeNull();
    unmountAll();
    // The architect's ruling (2026-09-29): TaskCreate is off on the current models unless the launch enables TODO tools,
    // so an empty list is the engine not creating one, not an empty plan. The launch's environment is not on any renderer
    // surface, so the line that would say TODO tools are off is not shown.
    await mount({ status: live({ taskListId: 'empty' }) });
    await waitFor(() => expect(tasksCalls).toContain('empty'));
    await act(async () => {});
    expect(section('tasks')).toBeNull();
    expect(screen.queryByText('The engine is not creating task lists in this session')).toBeNull();
    expect(query.useCommand).not.toHaveBeenCalled();
  });

  // E7 (P-20, Design §6): the section stays and its heading opens the Tasks panel on this session.
  it('the heading’s Open opens the Tasks panel on the session', async () => {
    await mount({ status: live({ taskListId: 'sess-1' }) });
    await waitFor(() => expect(heading('tasks')).toBe('Tasks'));
    // the action sits beside the heading, not in it: the heading's accessible name is its own text
    expect(within(checklist()).getByRole('heading', { level: 3 }).textContent).toBe('Tasks');
    expect(within(checklist()).getByRole('heading', { name: 'Tasks' })).toBeTruthy();
    fireEvent.click(within(checklist()).getByRole('button', { name: 'Open the Tasks panel' }));
    expect(openTool).toHaveBeenCalledWith('tasks', { appSessionId: A, params: { appSessionId: A } });
  });
});

// E7 (Design §7, G5): the Scheduled section over M0's recorded e7-cron run (the transcript's CronCreate and CronDelete
// pairs, attached to the transcript store as the session's own) and its durable file (e7-cron-durable) on the fake
// agent-work client's disk at the record's project root. Every time a cron names is the machine's local time, so each
// next run is computed through nextCronMatch and the clock is set from the recorded calls' times.
describe('scheduled jobs', () => {
  const CRON = replayed('pass3', 'e7-cron');
  const DURABLE = readFileSync(join(__dirname, '../../../../../../spikes/protocol-probe/fixtures/pass3/e7-cron-durable/scheduled_tasks.json'), 'utf8');
  const CREATOR = '5e8ddabd-603d-4ffb-9edd-d937c627f55d'; // the durable record's createdBySessionId
  const ROOT = '/work/A'; // the record's directory
  const FILE = `${ROOT}/.claude/scheduled_tasks.json`;
  const callOf = (prompt: string) => CRON.find((e) => e.kind === 'tool.use' && e.toolName === 'CronCreate' && (e.input as { prompt?: string }).prompt === prompt) as Extract<SessionEvent, { kind: 'tool.use' }>;
  const ONE_SHOT = callOf('E7 one-shot');
  const next = (cron: string, from: number) => nextCronMatch(parseCron(cron)!, from)!;
  const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

  const scheduled = () =>
    Array.from(section('scheduled')?.querySelectorAll<HTMLElement>('[data-scheduled]') ?? []).map((row) => ({
      id: row.dataset.scheduled,
      schedule: row.querySelector('[data-part="schedule"]')?.textContent,
      kind: row.querySelector('[data-part="kind"]')?.textContent,
      prompt: row.querySelector('[data-part="prompt"]')?.textContent,
      when: row.querySelector('[data-part="when"]')?.textContent,
      link: row.querySelector('button')?.textContent ?? null,
    }));
  const attachTranscript = (events: SessionEvent[]) => act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve(events) }));
  const withDurable = () => {
    fake.dirs.add(`${ROOT}/.claude`);
    fake.files.set(FILE, DURABLE);
  };

  afterEach(() => {
    for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  });

  it('lists the durable job first, then the session-only jobs of the transcript, each with its next run, expiry and creating turn', async () => {
    const now = Date.parse(ONE_SHOT.at) + 1; // the first launch: the recurring tick and the one-shot made, nothing fired
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    withDurable();
    await attachTranscript(CRON.filter((e) => (e.seq ?? 0) <= 166));
    const monitor = event('task.started', { taskId: 'm1', taskType: 'monitor_ws', description: 'until tests pass' }, { seq: 1, at: T });
    await mount({ engineSessionId: CREATOR, events: [monitor] });
    await waitFor(() => expect(heading('scheduled')).toBe('Scheduled 3'));
    // after Running, before Tasks and Done (Decision Log 10; the UX wave's U8b, M7: Tasks only with a list)
    expect(Array.from(document.querySelectorAll<HTMLElement>('section[data-section]')).map((s) => s.dataset.section)).toEqual(['running', 'scheduled']);
    const rows = scheduled();
    expect(rows.map(({ id, schedule, kind, prompt, link }) => ({ id, schedule, kind, prompt, link }))).toEqual([
      { id: '598b1690', schedule: '0 9 * * 1', kind: 'recurring · durable · this session', prompt: 'E7 durable weekly', link: null }, // made after this point of the transcript
      { id: '481abb0a', schedule: 'Every 2 minutes', kind: 'recurring · session-only', prompt: 'E7 cron tick', link: 'Open creating turn' },
      { id: '8d1a2582', schedule: '15 4 6 10 *', kind: 'one-shot · session-only', prompt: 'E7 one-shot', link: 'Open creating turn' },
    ]);
    const tick = next('*/2 * * * *', now);
    expect(rows[1]!.when).toBe(`Next ≈ ${TIME.format(tick)} (${formatIn(tick - now)}) · Expires ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(Date.parse(callOf('E7 cron tick').at) + RECURRING_MAX_AGE_MS)}`);
    const fire = next('15 4 6 10 *', Date.parse(ONE_SHOT.at));
    expect(rows[2]!.when).toContain(`(${formatIn(fire - now)})`); // a one-shot: its one fire, no expiry
    expect(rows[2]!.when).not.toContain('Expires');
    expect(rows[0]!.when).toContain(TIME.format(next('0 9 * * 1', now)));
    expect(section('scheduled')!.querySelector('[data-part="when"] [title]')?.getAttribute('title')).toBe(
      'The engine fires recurring jobs up to half a period late (30 min at most) and one-shots on :00 or :30 up to 90 s early',
    );
    // Open creating turn jumps the transcript to the call's cell
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-scheduled="481abb0a"]')!).getByRole('button', { name: 'Open creating turn' }));
    expect(useTranscriptStore.getState().entries[A]!.jump?.focus).toBe(cellId.tool(callOf('E7 cron tick').toolUseId));
  });

  it('follows the transcript: a delete removes its job, and the durable create links its file row', async () => {
    const created = Date.parse(callOf('E7 nightly').at);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(created + 60_000);
    withDurable();
    // the one-shot left out: whether it has fired by now depends on the machine's zone (scheduled.test.ts pins it)
    await attachTranscript(CRON.filter((e) => !('toolUseId' in e) || e.toolUseId !== ONE_SHOT.toolUseId));
    await mount({ engineSessionId: CREATOR }); // the session that recorded the run, as the file names it
    await waitFor(() => expect(heading('scheduled')).toBe('Scheduled 2'));
    expect(scheduled().map(({ id, schedule, kind, link }) => ({ id, schedule, kind, link }))).toEqual([
      { id: '598b1690', schedule: 'Every Monday at 9:00 AM', kind: 'recurring · durable · this session', link: 'Open creating turn' },
      { id: '1040f3a5', schedule: 'Every day at 3:00 AM', kind: 'recurring · session-only', link: 'Open creating turn' },
    ]);
  });

  it('a session not running here lists its session-only jobs greyed as resuming with the session, and its durable ones as the file says', async () => {
    const now = Date.parse(ONE_SHOT.at) + 1;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    withDurable();
    await attachTranscript(CRON.filter((e) => (e.seq ?? 0) <= 166));
    await mount({ status: null });
    await waitFor(() => expect(heading('scheduled')).toBe('Scheduled 3'));
    const rows = scheduled();
    expect(rows.map((r) => [r.id, r.when])).toEqual([
      ['598b1690', expect.stringMatching(/^Next ≈ /)],
      ['481abb0a', expect.stringMatching(/^Resumes with the session · Expires /)],
      ['8d1a2582', 'Resumes with the session'],
    ]);
    expect(document.querySelector('[data-scheduled="481abb0a"]')!.className).toContain('text-fg-faint');
    expect(document.querySelector('[data-scheduled="598b1690"]')!.className).not.toContain('text-fg-faint');
  });

  // The long-transcript window: a long session not running here opens on its newest window, which holds none of the
  // turn that scheduled its job; the answer's `cronHistory` lists it anyway, and its creating turn opens through the
  // pages back to it (a jump into history).
  it('a long session opened on its newest window lists the job an older page created, and opens its creating turn there', async () => {
    const now = Date.parse(ONE_SHOT.at) + 1; // before the one-shot's fire in any zone
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const history = CRON.filter((e) => (e.seq ?? 0) < 384); // turns 1 to 5: the one-shot made in 1, the tick deleted in 5
    const source = pagedSource(A, history, 0, { soft: 1, hard: 1024 * 1024 }, TEST_MACHINE); // one turn a page
    await act(() => useTranscriptStore.getState().attach(A, source));
    const seen = () => useTranscriptStore.getState().entries[A]!.state.seen;
    expect(seen().has(ONE_SHOT.id)).toBe(false); // the open: the newest window, without the turn that made the job
    expect(seen().size).toBeLessThan(history.length / 2);
    await mount({ status: null });
    await waitFor(() => expect(heading('scheduled')).toBe('Scheduled 1'));
    expect(scheduled().map(({ id, kind, link }) => ({ id, kind, link }))).toEqual([{ id: '8d1a2582', kind: 'one-shot · session-only', link: 'Open creating turn' }]);
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-scheduled="8d1a2582"]')!).getByRole('button', { name: 'Open creating turn' }));
    await waitFor(() => expect(useTranscriptStore.getState().entries[A]!.jump?.focus).toBe(cellId.tool(ONE_SHOT.toolUseId)));
    expect(seen().has(ONE_SHOT.id)).toBe(true); // the pages back to its turn are in
    expect(scheduled().map(({ id }) => id)).toEqual(['8d1a2582']); // and the list is the same
  });

  it('keeps the transcript’s rows and says why when the durable file cannot be read; a change to it is read again', async () => {
    const now = Date.parse(ONE_SHOT.at) + 1;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    fake.dirs.add(`${ROOT}/.claude`);
    fake.files.set(FILE, '{"tasks": [');
    await attachTranscript(CRON.filter((e) => (e.seq ?? 0) <= 166));
    await mount();
    await waitFor(() => expect(section('scheduled')!.querySelector(':scope > p')?.textContent).toMatch(/^Scheduled jobs unavailable: /));
    expect(scheduled().map((r) => r.id)).toEqual(['481abb0a', '8d1a2582']);
    fake.files.set(FILE, DURABLE);
    await act(async () => {
      fake.filesChanged({ appSessionId: A, path: FILE, kind: 'changed' });
      await flush();
    });
    expect(scheduled().map((r) => r.id)).toEqual(['598b1690', '481abb0a', '8d1a2582']);
    // made by another session as far as this record knows (its engine id is not the file's creator): no link to a call
    expect(scheduled()[0]).toMatchObject({ kind: 'recurring · durable · another session', link: null });
    expect(section('scheduled')!.querySelector(':scope > p')).toBeNull();
  });

  it('lists both rows of a hand-authored file that repeats an id, each its own', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.dirs.add(`${ROOT}/.claude`);
    const job = (prompt: string) => ({ id: 'same', cron: '0 9 * * *', prompt, createdAt: Date.now() });
    fake.files.set(FILE, JSON.stringify({ tasks: [job('first'), job('second')] }));
    await mount();
    await waitFor(() => expect(scheduled().map((r) => [r.id, r.prompt])).toEqual([['same', 'first'], ['same', 'second']]));
    expect(errors).not.toHaveBeenCalled(); // no duplicate-key warning
    errors.mockRestore();
  });

  // main drops a root that no longer resolves from the allowlist and refuses every path under it (allowlist.ts rootsOf)
  it('a session whose directory is gone shows no section and no error; a refusal under a root that resolves says why', async () => {
    const refusal = "path outside the session's directories";
    fake.refuse.set(FILE, refusal);
    await mount();
    await waitFor(() => expect(fake.fileCalls).toContain('roots'));
    await act(async () => flush());
    expect(section('scheduled')).toBeNull();
    unmountAll();
    fake.dirs.add(ROOT);
    await mount();
    await waitFor(() => expect(section('scheduled')?.querySelector(':scope > p')?.textContent).toBe(`Scheduled jobs unavailable: ${refusal}`));
    expect(scheduled()).toEqual([]);
  });

  it('shows no section without jobs, and none after the transcript deleted its only one', async () => {
    await mount();
    expect(fake.fileCalls).toContain(`read ${FILE}`);
    expect(section('scheduled')).toBeNull();
    unmountAll();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse(CRON.find((e) => e.kind === 'tool.result' && e.toolUseId === callOf('E7 cron tick').toolUseId)!.at));
    await attachTranscript(CRON.filter((e) => (e.seq ?? 0) <= 338 && (!('toolUseId' in e) || e.toolUseId !== ONE_SHOT.toolUseId)));
    await mount();
    expect(section('scheduled')).toBeNull(); // 481abb0a made, then cancelled (seq 335)
  });
});
