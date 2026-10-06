// The Tasks panel (E7 execution document, Design §6 as superseded by P-20, Decision Log 21; G4): the session's task
// checklist as its own X5 tool, the one `show_pane 'tasks'` opens (E1's `PANES.tasks`). Read-only: MAWS never opts the
// engine's task tools in, so there is nothing to edit through; the body is Background work's checklist (its read, its
// order, its notes), every task shown, the completed under the same fold. A `target` (a task id, what `show_pane`
// passes) selects that task and scrolls it into view, opening the fold when the task is completed; a target naming no
// task selects nothing. Its state is a small handle outside React, as the other agent tools' are; it holds no watch of
// its own (the list is a TanStack query whose observer is the body, invalidated app-wide on `fs.tasksChanged`).
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { Icon } from '../../../app/IconButton';
import type { PanelTool, PanelToolContext } from '../../../panel/tool';
import { ChecklistBody, useChecklist } from '../background/TaskChecklist';
import { TASKS_COPY } from '../copy';
import { AGENT_TOOL_IDS } from '../tool-ids';

// `appSessionId`: the session the target belongs to, so a pinned tab still on another session follows it before
// selecting (as Background work's and Subagents' params do). E1's bridge passes `{ target }` alone; see `carry`.
export interface TasksParams {
  appSessionId?: AppSessionId;
  target?: string;
}

// The snapshot. `appSessionId`: the session the view state belongs to. `reveal` grows with each target, so the body
// selects and scrolls to it again even when it is the same task.
export interface TasksState {
  appSessionId: AppSessionId | null;
  selected: string | null;
  showCompleted: boolean;
  scrollTop: number;
  reveal: number;
}

export class TasksHandle {
  private state: TasksState;
  private readonly listeners = new Set<() => void>();
  // The last target came without a session (E1's `{ target }`): it belongs to the session the tab is shown for next,
  // which for a pinned tab still on another session is the one `show_pane` named, brought on screen by the same call.
  // That relies on the host's `retarget` calling `open` then `activateIn` in one synchronous call (`panel/host.ts`).
  private carry = false;
  private revealed = 0; // the last reveal the body acted on, kept here so a remount does not scroll to it again

  constructor(appSessionId: AppSessionId | null, params: TasksParams | undefined) {
    this.state = { appSessionId, selected: null, showCompleted: false, scrollTop: 0, reveal: 0 };
    this.open(params);
    if (appSessionId !== null) this.carry = false; // a new tab's target is its own session's
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  snapshot = () => this.state;

  private update(patch: Partial<TasksState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  // X5's `open`: a target selects that task and asks the body to reveal it; no target leaves the selection as it is.
  open = (params: TasksParams | undefined) => {
    if (params?.appSessionId !== undefined) this.follow(params.appSessionId);
    if (params?.target === undefined) return;
    this.carry = params.appSessionId === undefined;
    this.update({ selected: params.target, reveal: this.state.reveal + 1 });
  };

  setShowCompleted = (showCompleted: boolean) => {
    if (showCompleted !== this.state.showCompleted) this.update({ showCompleted });
  };

  revealPending = (reveal: number) => reveal > this.revealed;
  revealDone = (reveal: number) => void (this.revealed = Math.max(this.revealed, reveal));

  setScrollTop = (scrollTop: number) => {
    this.state = { ...this.state, scrollTop }; // kept for the next mount; nothing renders from it meanwhile
  };

  // The session the body shows, on every render. Another session than the state's: that session's list, with the
  // selection, fold and scroll reset, unless the last target was carried to it. No session shown (the Overview)
  // changes nothing.
  follow = (appSessionId: AppSessionId | null) => {
    if (appSessionId === null) return;
    const carry = this.carry;
    this.carry = false;
    if (appSessionId === this.state.appSessionId) return;
    if (carry) return this.update({ appSessionId, showCompleted: false, scrollTop: 0 });
    this.update({ appSessionId, selected: null, showCompleted: false, scrollTop: 0 });
  };

  dispose = () => this.listeners.clear();
}

function TasksBody({ state, ctx }: { state: TasksHandle; ctx: PanelToolContext }) {
  const snapshot = useSyncExternalStore(state.subscribe, state.snapshot);
  useEffect(() => state.follow(ctx.appSessionId)); // every render: it also settles a carried target (see `carry`)
  const { appSessionId } = ctx;
  if (appSessionId === null) {
    return (
      <p data-tool="tasks" className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">
        {TASKS_COPY.noSession}
      </p>
    );
  }
  // Until the follow lands, another session's selection, fold and scroll are not shown over this one.
  const own = snapshot.appSessionId === appSessionId;
  return <TaskList key={appSessionId} handle={state} snapshot={snapshot} own={own} ctx={ctx} />;
}

function TaskList({ handle, snapshot, own, ctx }: { handle: TasksHandle; snapshot: TasksState; own: boolean; ctx: PanelToolContext }) {
  const checklist = useChecklist(ctx.status, ctx.session);
  const { list, label } = checklist;
  const selected = own ? snapshot.selected : null;
  const showCompleted = own && snapshot.showCompleted;

  const scroller = useRef<HTMLDivElement>(null);
  const [restoreTo] = useState(own ? snapshot.scrollTop : 0);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = restoreTo;
  }, [restoreTo]);

  // The target, once the list has it: a completed one opens the fold first (this runs again once its row renders),
  // then the row scrolls into view and the reveal is spent, so closing the fold by hand keeps it closed.
  const where = selected === null || list === null ? null : list.open.some((t) => t.id === selected) ? 'open' : list.earlier.some((t) => t.id === selected) ? 'earlier' : null;
  const reveal = own ? snapshot.reveal : 0;
  useEffect(() => {
    if (where === null || !handle.revealPending(reveal)) return;
    if (where === 'earlier' && !showCompleted) return handle.setShowCompleted(true);
    scroller.current?.querySelector(`[data-task="${CSS.escape(selected!)}"]`)?.closest('li')?.scrollIntoView?.({ block: 'nearest' });
    handle.revealDone(reveal);
  }, [where, reveal, showCompleted, selected, handle]);

  const progress = list !== null && list.total > 0 ? TASKS_COPY.progress(list.completed, list.total) : null;
  return (
    <div ref={scroller} data-tool="tasks" onScroll={(e) => handle.setScrollTop(e.currentTarget.scrollTop)} className="flex h-full min-h-0 flex-col overflow-auto py-2">
      {(progress !== null || label !== null) && (
        <p className="flex shrink-0 items-baseline gap-1.5 px-3.5 pb-1.5 text-ui-sm text-fg-muted">
          {progress !== null && <span data-part="progress">{progress}</span>}
          {label !== null && <span data-part="label">{label}</span>}
        </p>
      )}
      <ChecklistBody checklist={checklist} showEarlier={showCompleted} onToggleEarlier={() => handle.setShowCompleted(!showCompleted)} selected={selected} />
    </div>
  );
}

export function TasksIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M2.5 4.5l1.2 1.2 2-2.2M2.5 10.5l1.2 1.2 2-2.2M8 4.5h5.5M8 10.5h5.5" />
    </Icon>
  );
}

export const tasksTool: PanelTool<TasksHandle, TasksParams> = {
  id: AGENT_TOOL_IDS.tasks,
  title: TASKS_COPY.title,
  icon: TasksIcon,
  pinnable: true,
  multiInstance: false,
  createState: (init) => new TasksHandle(init.appSessionId, init.params),
  open: (state, params) => state.open(params),
  beforeClose: () => Promise.resolve(true),
  dispose: (state) => state.dispose(),
  render: TasksBody,
};
