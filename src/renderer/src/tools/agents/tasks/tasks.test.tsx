// The Tasks panel (E7 execution document, Design §6 as superseded by P-20; G4): the read-only checklist registered as the
// X5 tool `tasks`. Its body is the Background work checklist's data and order over the client's `tasks`, every task
// shown (open first, the completed under the fold); a `target` selects that task and scrolls it into view, opening the
// fold when the task is completed; `open` re-targets an open tab, through the real panel host and through E1's
// `show_pane` bridge alike, a pinned tab on another session included. No edit control exists.
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId, RequestId, SessionId } from '@shared/graph/ids';
import type { EventPayload } from '@shared/ipc/schema';
import type { PersistedTask } from '@shared/wire/store';
import { record, status } from '../../../../../../test/support/builders';
import { connectAgentWorkEvents } from '../../../ipc/events';
import { instanceOf, panelHost } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { A, B, panelOf, pinIds, resetPanelStores, TestHost } from '../../../test-support/panel';
import { showPane } from '../../maws/panes/connect';
import { setAgentWorkClient } from '../client';
import { fakeAgentWorkClient } from '../fake-work-client';
import { registerAgentTools } from '../index';
import { useTaskGraph } from '../store';
import type { TasksHandle, TasksParams } from './TasksTool';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../../../ipc/query';
import type { PanelToolContext } from '../../../panel/tool';

const task = (id: string, taskStatus: PersistedTask['status'], subject: string, activeForm?: string): PersistedTask => ({
  id, subject, description: '', status: taskStatus, blocks: [], blockedBy: [], ...(activeForm ? { activeForm } : {}),
});

let lists: Record<string, PersistedTask[] | Error>;
const tasksCalls: string[] = [];
const tasksChanged = new Set<(payload: EventPayload<'fs.tasksChanged'>) => void>();
let disconnect: (() => void) | null = null;
let scrolled: string[] = [];
const originalScroll = HTMLElement.prototype.scrollIntoView;

const live = (id: AppSessionId, taskListId: string | null): EngineSessionStatus => ({ ...status(id), taskListId });

function seedEngine(entries: [AppSessionId, EngineSessionStatus][]): void {
  useSessions.setState({ engine: new Map(entries) });
}

beforeEach(() => {
  resetPanelStores();
  registerAgentTools();
  lists = {
    'list-a': [task('1', 'completed', 'Map handlers'), task('2', 'pending', 'Run tests'), task('3', 'in_progress', 'Check reorder', 'Checking keyboard reorder'), task('4', 'completed', 'Reproduce')],
    'list-b': [task('1', 'pending', 'Write the parser'), task('2', 'completed', 'Wire up the CLI')],
  };
  tasksCalls.splice(0);
  tasksChanged.clear();
  const fake = fakeAgentWorkClient();
  const client = {
    ...fake.client,
    tasks: async (listId: string) => {
      tasksCalls.push(listId);
      const answer = lists[listId] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    onTasksChanged: (listener: (payload: EventPayload<'fs.tasksChanged'>) => void) => {
      tasksChanged.add(listener);
      return () => void tasksChanged.delete(listener);
    },
  };
  setAgentWorkClient(client);
  disconnect = connectAgentWorkEvents(client);
  useTaskGraph.setState({ entries: new Map() });
  seedEngine([[A, live(A, 'list-a')], [B, live(B, 'list-b')]]);
  scrolled = [];
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.querySelector<HTMLElement>('[data-task]')?.dataset.task ?? this.dataset.task ?? '');
  };
});

afterEach(() => {
  cleanup();
  disconnect?.();
  setAgentWorkClient(null);
  HTMLElement.prototype.scrollIntoView = originalScroll;
});

const body = () => document.querySelector<HTMLElement>('[data-tool="tasks"]');
const rows = () => Array.from(body()!.querySelectorAll<HTMLElement>('[data-task]')).map((el) => el.textContent);
const selectedRows = () => Array.from(body()!.querySelectorAll<HTMLElement>('li[aria-current="true"] [data-task]')).map((el) => el.dataset.task);
const tasksTab = (id: AppSessionId) => panelOf(id)?.tabs.find((t) => t.toolId === 'tasks');
const handleOf = (tabId: string) => instanceOf(tabId)!.state as TasksHandle;
const addTasks = (appSessionId: AppSessionId, params?: Record<string, string>, pin = false) =>
  act(() => void panelHost.addTool('tasks', { appSessionId, ...(params ? { params } : {}), ...(pin ? { pin } : {}) }));
const show = (appSessionId: AppSessionId, target: string | null) => {
  let answer: ReturnType<typeof showPane> | null = null;
  act(() => void (answer = showPane({ appSessionId, requestId: 'r1' as RequestId, pane: 'tasks', target, line: null })));
  return answer!;
};

describe('the Tasks tool', () => {
  it('registers as tool tasks: Tasks, pinnable, single-instance, with open', () => {
    const tool = panelHost.tools().find((t) => t.id === 'tasks');
    expect(tool).toMatchObject({ id: 'tasks', title: 'Tasks', pinnable: true, multiInstance: false });
    expect(tool?.open).toBeTypeOf('function');
  });

  it('shows every task in the checklist’s order, the completed under the fold, with no edit control', async () => {
    render(<TestHost />);
    addTasks(A);
    await waitFor(() => expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests']));
    expect(body()!.querySelector('[data-part="progress"]')?.textContent).toBe('2 of 4 completed');
    expect(tasksCalls).toEqual(['list-a']);
    const fold = within(body()!).getByRole('button', { name: '2 earlier tasks completed' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests', 'Map handlers', 'Reproduce']);
    // read-only (P-20): the fold is the one control; nothing to type in, nothing to drag
    expect(within(body()!).getAllByRole('button').map((b) => b.textContent)).toEqual(['2 earlier tasks completed']);
    expect(body()!.querySelector('input, textarea, select, [draggable="true"], [role="menu"]')).toBeNull();
  });

  it('labels a disk-only session’s list session list and says why when the list cannot be read', async () => {
    seedEngine([]);
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { engineSessionId: 'list-a' as SessionId })) }));
    render(<TestHost />);
    addTasks(A);
    await waitFor(() => expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests']));
    expect(body()!.querySelector('[data-part="label"]')?.textContent).toBe('session list');
    lists['list-a'] = new Error('permission denied');
    act(() => tasksChanged.forEach((l) => l({ listId: 'list-a' })));
    await waitFor(() => expect(within(body()!).getByText('Tasks unavailable: permission denied')).toBeTruthy());
  });

  it('reads unavailable until the engine reports its list, and reads nothing', () => {
    seedEngine([[A, live(A, null)]]);
    render(<TestHost />);
    addTasks(A);
    expect(within(body()!).getByText('Tasks unavailable until the engine reports its list')).toBeTruthy();
    expect(tasksCalls).toEqual([]);
  });

  it('follows the list on fs.tasksChanged', async () => {
    render(<TestHost />);
    addTasks(A);
    await waitFor(() => expect(rows()).toHaveLength(2));
    lists['list-a'] = [...(lists['list-a'] as PersistedTask[]), task('5', 'pending', 'New one')];
    act(() => tasksChanged.forEach((l) => l({ listId: 'list-a' })));
    await waitFor(() => expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests', 'New one']));
    expect(body()!.querySelector('[data-part="progress"]')?.textContent).toBe('2 of 5 completed');
  });
});

describe('the target', () => {
  it('selects an open task and scrolls it into view once the list arrives', async () => {
    render(<TestHost />);
    addTasks(A, { target: '2' });
    await waitFor(() => expect(selectedRows()).toEqual(['2']));
    expect(scrolled).toEqual(['2']);
  });

  it('a completed target opens the fold, then is selected and scrolled to', async () => {
    render(<TestHost />);
    addTasks(A, { target: '4' });
    await waitFor(() => expect(selectedRows()).toEqual(['4']));
    expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests', 'Map handlers', 'Reproduce']);
    expect(scrolled).toEqual(['4']);
    // the reveal is spent: closing the fold by hand keeps it closed
    fireEvent.click(within(body()!).getByRole('button', { name: '2 earlier tasks completed' }));
    await act(async () => {});
    expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests']);
    expect(scrolled).toEqual(['4']);
  });

  it('a target naming no task selects nothing and leaves the fold closed', async () => {
    render(<TestHost />);
    addTasks(A, { target: '99' });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(selectedRows()).toEqual([]);
    expect(scrolled).toEqual([]);
  });

  it('addTool twice re-targets the one open tab through open', async () => {
    render(<TestHost />);
    addTasks(A, { target: '2' });
    await waitFor(() => expect(selectedRows()).toEqual(['2']));
    addTasks(A, { target: '1' });
    expect(panelOf(A)!.tabs.filter((t) => t.toolId === 'tasks')).toHaveLength(1);
    await waitFor(() => expect(selectedRows()).toEqual(['1']));
    expect(rows()).toContain('Map handlers'); // the completed fold opened for it
    expect(scrolled).toEqual(['2', '1']);
    // the same target again scrolls to it again
    addTasks(A, { target: '1' });
    await waitFor(() => expect(scrolled).toEqual(['2', '1', '1']));
  });

  it('an open with no target keeps the selection', async () => {
    render(<TestHost />);
    addTasks(A, { target: '2' });
    await waitFor(() => expect(selectedRows()).toEqual(['2']));
    addTasks(A);
    await act(async () => {});
    expect(selectedRows()).toEqual(['2']);
  });

  it('show_pane tasks with a target opens this tool with the task selected (E1’s bridge needs only the registration)', async () => {
    render(<TestHost />);
    const answer = show(A, '3');
    const tab = tasksTab(A)!;
    expect(answer).toEqual({ ok: true, opened: { kind: 'panel-tool', toolId: 'tasks', tabId: tab.id, title: 'Tasks' } });
    await waitFor(() => expect(selectedRows()).toEqual(['3']));
    show(A, '2');
    await waitFor(() => expect(selectedRows()).toEqual(['2']));
    expect(panelOf(A)!.tabs.filter((t) => t.toolId === 'tasks')).toHaveLength(1);
  });

  it('a pinned tab on another session carries show_pane’s target to the session it is shown for, and only there', async () => {
    render(<TestHost />);
    addTasks(A, undefined, true);
    const [pinned] = pinIds();
    await waitFor(() => expect(rows()).toHaveLength(2));
    show(B, '2');
    await waitFor(() => expect(selectedRows()).toEqual(['2']));
    expect(rows()).toEqual(['Write the parser', 'Wire up the CLI']);
    expect(handleOf(pinned!).snapshot()).toMatchObject({ appSessionId: B, selected: '2' });
    // the owner moves to A: that session's list, nothing selected in it
    act(() => useLayout.getState().openSession(A));
    await waitFor(() => expect(rows()).toEqual(['Checking keyboard reorder', 'Run tests']));
    expect(selectedRows()).toEqual([]);
    expect(handleOf(pinned!).snapshot()).toMatchObject({ appSessionId: A, selected: null, showCompleted: false });
  });

  it('params naming the session follow it before selecting', () => {
    const handle = panelHost.tools().find((t) => t.id === 'tasks')!.createState({ appSessionId: A, session: null, instanceId: 'tasks:test', params: undefined }) as TasksHandle;
    handle.open({ appSessionId: B, target: '1' });
    expect(handle.snapshot()).toMatchObject({ appSessionId: B, selected: '1' });
    handle.follow(A); // a session the params did not name: the selection was B's
    expect(handle.snapshot()).toMatchObject({ appSessionId: A, selected: null });
  });
});

// The body as the host renders it, with a context the test sets (M5 review follow-up): the view with no session shown,
// and the `own` gate that keeps one session's selection, fold and scroll off another's list until the follow lands.
describe('the body', () => {
  const tasksTool = () => panelHost.tools().find((t) => t.id === 'tasks')!;
  const createHandle = (appSessionId: AppSessionId | null, params?: TasksParams) =>
    tasksTool().createState({ appSessionId, session: null, instanceId: 'tasks:body', params }) as TasksHandle;
  function Body({ handle, appSessionId }: { handle: TasksHandle; appSessionId: AppSessionId | null }) {
    const session = useSessions((s) => (appSessionId === null ? null : (s.records.get(appSessionId) ?? null)));
    const engine = useSessions((s) => (appSessionId === null ? null : (s.engine.get(appSessionId) ?? null)));
    const ctx: PanelToolContext = { appSessionId, session, status: engine, pinned: true, visible: true, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: () => '', editorHost: { surface: 'panel', tabId: 'tasks:body' } };
    const Render = tasksTool().render;
    return (
      <QueryClientProvider client={queryClient}>
        <Render state={handle} ctx={ctx} />
      </QueryClientProvider>
    );
  }

  it('with no session shown (a pinned tab over the Overview) says to open one and reads nothing', () => {
    render(<Body handle={createHandle(null)} appSessionId={null} />);
    expect(body()!.textContent).toBe('Open a session to see its tasks');
    expect(body()!.querySelector('[data-task], button')).toBeNull();
    expect(tasksCalls).toEqual([]);
  });

  it('shows another session’s list with nothing of the state’s own session over it until the follow lands', async () => {
    const handle = createHandle(A, { target: '4' });
    handle.setShowCompleted(true);
    expect(handle.snapshot()).toMatchObject({ appSessionId: A, selected: '4', showCompleted: true });
    handle.follow = () => {}; // the follow has not landed yet
    render(<Body handle={handle} appSessionId={B} />);
    await waitFor(() => expect(rows()).toEqual(['Write the parser'])); // B's list, its completed fold closed
    expect(within(body()!).getByRole('button', { name: '1 earlier task completed' }).getAttribute('aria-expanded')).toBe('false');
    expect(selectedRows()).toEqual([]);
    expect(scrolled).toEqual([]); // A's pending reveal is not spent on B's list
    expect(handle.snapshot()).toMatchObject({ appSessionId: A, selected: '4', showCompleted: true });
  });
});
