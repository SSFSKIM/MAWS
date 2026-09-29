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
const heading = (name: string) => section(name)?.querySelector('h3')?.textContent;
const card = (taskId: string) => document.querySelector<HTMLElement>(`[data-workflow="${taskId}"]`)!;
const phases = (taskId: string) => Array.from(card(taskId).querySelectorAll<HTMLElement>('[data-phase]')).map((p) => p.textContent);
const tableRows = (taskId: string) => Array.from(card(taskId).querySelectorAll<HTMLElement>('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));

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
  it('shows a workflow card from pass2/workflow: its description, workflow maws-probe, phases and the table filling per frame', async () => {
    await mount({ events: upTo(workflow, 82) });
    expect(heading('workflows')).toBe('Workflows · 1');
    const wf = card('wayue3on6');
    expect(within(wf).getByRole('heading').textContent).toBe('Two echo agents in one phase');
    const line = wf.querySelector('[data-part="line"]')?.textContent;
    expect(line).toMatch(/^workflow maws-probe · .+ · 2 agents · tokens unavailable$/); // no row has reported tokens at seq 82
    expect(phases('wayue3on6')).toEqual(['Echo 0/2']);
    expect(Array.from(wf.querySelectorAll('th')).map((th) => th.textContent)).toEqual(['Agent', 'Model', 'Tokens', 'Time']);
    push(upTo(workflow, 93).filter((e) => (e.seq ?? 0) > 82));
    expect(phases('wayue3on6')).toEqual(['Echo 2/2']);
    expect(tableRows('wayue3on6').map((cells) => cells[0])).toEqual(['alpha', 'beta']);
    expect(tableRows('wayue3on6').every((cells) => cells[2] !== '' && cells[3] !== '')).toBe(true); // Tokens and Time filled
    expect(card('wayue3on6').querySelector('[data-part="line"]')?.textContent).toMatch(/ · 17\.7k tokens$/); // alpha's 8,861 + beta's 8,857
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
    expect(tableRows('wf1')).toEqual([['slow', '', '', '']]);
    expect(card('wf1').querySelector('[role="img"]')).toBeNull();
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
    expect(phases('wf1')).toEqual(['Solve · Queued', 'Phase 2 · Queued']);
  });

  it('a workflow with no progress yet says phases arrive with the first frame', async () => {
    await mount({ events: [event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'Judge panel', workflowName: 'demo' }, { seq: 1, at: T })] });
    expect(within(card('wf1')).getByText('Phases arrive with the first progress frame')).toBeTruthy();
  });

  it('a per-agent row with an agentId opens the drill-in through ctx.openTool; a row without one is not a button', async () => {
    await mount({ events: upTo(workflow, 93) });
    const alpha = within(card('wayue3on6')).getByRole('button', { name: /alpha/ });
    fireEvent.click(alpha);
    expect(openTool).toHaveBeenCalledWith('subagents', { appSessionId: A, params: { agentId: expect.any(String), appSessionId: A } });
    unmountAll();
    await mount({
      events: [
        event('task.started', { taskId: 'wf1', taskType: 'local_workflow', description: 'Judge panel', workflowName: 'demo' }, { seq: 1, at: T }),
        event('workflow.progress', { taskId: 'wf1', progress: [{ type: 'workflow_agent', index: 1, label: 'queued-one', phaseIndex: 1, state: 'queued' }] }, { seq: 2 }),
      ],
    });
    expect(within(card('wf1')).queryByRole('button', { name: /queued-one/ })).toBeNull();
  });

  it('a per-agent row opens its drill-in on a pinned Subagents tab still holding another session, keeping the selection', async () => {
    await mount({ events: upTo(workflow, 93) });
    fireEvent.click(within(card('wayue3on6')).getByRole('button', { name: /alpha/ }));
    const [, options] = openTool.mock.calls.at(-1) as [string, { params: SubagentsParams }];
    const pinned = subagentsTool.createState({ appSessionId: 'X' as AppSessionId, session: null, instanceId: 'subagents:pinned', params: undefined });
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

  it('a disk-only session reads the shells sentence and lists the runs on disk with their state and table', async () => {
    await mount({ status: null, sidecars: sidecarsOf('pass2/workflow-disk', 'wf_7cacbb2d-902'), runs: workflowRunsOf() });
    expect(screen.getByText('Shells and monitors are known only while the session runs here')).toBeTruthy();
    expect(heading('workflows')).toBe('Workflow runs on disk · 1');
    const [run] = workflowRunsOf();
    const wf = card(run.snapshot!.taskId!);
    expect(wf.querySelector('[data-part="status"]')?.textContent).toBe('completed');
    expect(tableRows(run.snapshot!.taskId!)).toHaveLength(2);
    expect(section('shells')).toBeNull();
    expect(within(wf).queryByRole('button', { name: 'Stop workflow' })).toBeNull();
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
    await waitFor(() => expect(heading('tasks')).toBe('Tasks · 2/4session list'));
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
});
