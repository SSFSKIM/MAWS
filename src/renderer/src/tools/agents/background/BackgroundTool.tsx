// The Background tasks tool (C8b execution document, Interfaces *Tools*; M3; mockup 03 study 03; the UX wave's U8b,
// M7): one single-instance, pinnable tool listing a session's background tasks by state, not by kind: Running N, every
// running workflow, shell, monitor and task of another kind in the order they started, each row its kind's (§F's mark);
// Scheduled N and Tasks only when the session has them; then one Done N, folded at first, every ended one newest first,
// its heading counting them by kind. With nothing running, `Nothing running` stands in Running's place. Each section is
// collapsible with a sticky heading (C8a's summary `Section` pattern, reimplemented here because C8a's is not
// exported). Stop is the one action on a task (§5.6: stop only), through the task-graph store's two-phase stop. Its
// state is a small handle holding an immutable snapshot the body reads through useSyncExternalStore, plus the store
// watch for the session it shows.
// E7 (Design §2): its view is the list or one run's widget, as Subagents' is its lists or a drill-in (Back is a state
// change; the host sees one tab); a card's title or chevron, the transcript's workflow ref and `open({ view: 'run' })`
// open the widget. Its Scheduled section (Design §7) lists the session's cron jobs after Running.
// P5 O9 M5: a terminal session driven through its bridge lists the shells and monitors main derives from its transcript
// (../../../lane-a/jobs/lane-jobs.ts), each stopped through its bridge, with no output tail; an ended one's stay listed
// exited. They join the graph's workflows before the sections are read (§E), so one rule orders and counts both.
// Whether it is driven is the port's to say (a non-null `turn()`), whatever engine status MAWS kept from an earlier run
// of the session: that status is not live while a terminal holds it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import type { PanelTool, PanelToolContext } from '../../../panel/tool';
import type { Job } from 'desk-hub/protocol';
import { useDrivenJobs } from '../../../lane-a/jobs/lane-jobs'; // P5 O9 M5
import { taskNodeOf } from '../../../lane-a/jobs/job-nodes'; // P5 O9 M5
import { stopSessionTask, useSessionControls } from '../../../session/controls/controls-for'; // P5 O9 M5
import { BACKGROUND_COPY } from '../copy';
import { openLog } from '../log/LogTool';
import { BackgroundIcon } from '../marks';
import { elapsedOf } from '../model/elapsed';
import { backgroundDone, backgroundRunning, doneByKind, emptyGraph, type TaskGraph, type TaskNode } from '../model/task-graph';
import { resolveRun, runView, type PhaseSelection } from '../model/workflow-run'; // E7
import { useTaskGraph } from '../store';
import { SLOW_TICK_MS, STOP_DOUBT_MS, useTicker } from '../subagents/shared';
import { AGENT_TOOL_IDS } from '../tool-ids';
import { BackgroundSummary } from './BackgroundSummary';
import { Group, type BackgroundSection } from './Group';
import { RunWidget } from './RunWidget'; // E7
import { ScheduledSection } from './ScheduledRows'; // E7
import { TaskChecklist } from '../checklist/TaskChecklist';
import { MonitorRow, OtherTaskRow, ShellRow } from './TaskRows';
import { WorkflowCard } from './WorkflowCard';

// Additive to the document's `{ taskId? }`: `appSessionId`, the session the selection belongs to, so a pinned tab still
// on another session follows it before selecting (as Subagents' params do).
export interface BackgroundParams {
  taskId?: string;
  appSessionId?: AppSessionId;
  // E7 start: `view: 'run'` opens the run's widget rather than selecting its card; `runId`, the transcript ref's run id,
  // a second name the run resolves by while no read has keyed it by its task id (Design §2)
  view?: 'run';
  runId?: string;
  // E7 end
  // The UX wave's U8b (M7 decision 8): the list with Done unfolded, no other fold changed (a card's `N finished`)
  section?: 'done';
}

export type { BackgroundSection } from './Group';
// Done is folded at first, for each session the tab shows (M7 decision 2).
const OPEN_AT_FIRST: readonly BackgroundSection[] = ['running', 'scheduled', 'tasks'];

// E7: the list, or one run's widget (`taskId` the id it was opened on; `phase` the owner's pick, null following the run).
export type BackgroundView = { kind: 'list' } | { kind: 'run'; taskId: string; phase: PhaseSelection | null };
const LIST: BackgroundView = { kind: 'list' };

// The snapshot. `appSessionId`: the session the view state belongs to. `reveal` grows with each `open({ taskId })`, so
// the body scrolls the selected card into view again. `pendingRun` (E7): the ids an `open({ view: 'run' })` named
// before any read brought the run; the widget opens once one resolves. `placing` (M7): the task an `open({ taskId })`
// selected whose section is not unfolded yet: the list on screen unfolds the one it lists the task in, once it does.
export interface BackgroundState {
  appSessionId: AppSessionId | null;
  view: BackgroundView;
  pendingRun: string[] | null;
  selected: string | null;
  placing: string | null;
  expanded: Set<BackgroundSection>;
  showEarlierTasks: boolean;
  scrollTop: number;
  stopErrors: Map<string, string>;
  reveal: number;
  stoppingJobs: ReadonlySet<string>; // P5 O9 M5: a lane A job's stop the bridge took, until its job ends
  doubtedJobs: ReadonlySet<string>; // P5 O9: a lane A job's stop whose outcome is unknown: it may not have stopped
}

export class BackgroundHandle {
  private state: BackgroundState;
  private readonly listeners = new Set<() => void>();
  private release: (() => void) | null = null;
  private readonly doubtTimers = new Map<string, ReturnType<typeof setTimeout>>(); // P5 O9: per doubted stop

  constructor(appSessionId: AppSessionId | null, params: BackgroundParams | undefined) {
    this.state = {
      appSessionId, view: LIST, pendingRun: null, selected: null, placing: null, expanded: new Set(OPEN_AT_FIRST), showEarlierTasks: false, scrollTop: 0, stopErrors: new Map(), reveal: 0, stoppingJobs: new Set(), doubtedJobs: new Set(),
    };
    this.watch(appSessionId);
    this.open(params);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  snapshot = () => this.state;

  private update(patch: Partial<BackgroundState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private watch(appSessionId: AppSessionId | null): void {
    this.release?.();
    this.release = appSessionId === null ? null : useTaskGraph.getState().watch(appSessionId);
  }

  // X5's `open`: a task id selects its card, expands its section and scrolls to it, in the list. E7: with `view: 'run'`
  // it opens the run's widget, the id resolved through the graph (Design §2); while nothing resolves, the list reads
  // `Run not found yet` with the id selected until a read brings the run. No task id (the summary's Open) shows the list;
  // with `section: 'done'`, Done unfolded.
  open = (params: BackgroundParams | undefined) => {
    if (params?.appSessionId !== undefined) this.follow(params.appSessionId);
    if (!params?.taskId) {
      this.back();
      if (params?.section === 'done' && !this.state.expanded.has('done')) this.update({ expanded: new Set([...this.state.expanded, 'done']) });
      return;
    }
    const { appSessionId } = this.state;
    const graph = appSessionId === null ? undefined : useTaskGraph.getState().entries.get(appSessionId)?.graph;
    if (params.view === 'run') {
      const ids = params.runId === undefined ? [params.taskId] : [params.taskId, params.runId];
      const taskId = graph === undefined ? null : resolveRun(graph, ids);
      if (taskId !== null) return this.openRun(taskId);
      return this.update({ view: LIST, pendingRun: ids, selected: params.taskId, placing: null, expanded: new Set([...this.state.expanded, 'running']), reveal: this.state.reveal + 1 });
    }
    this.update({ view: LIST, pendingRun: null, selected: params.taskId, placing: params.taskId, reveal: this.state.reveal + 1 });
  };

  // M7: the list on screen lists the task an open is placing: its section unfolds, once; a later fold is the person's.
  place = (taskId: string, section: BackgroundSection) => {
    if (this.state.placing !== taskId) return;
    this.update({ placing: null, expanded: new Set([...this.state.expanded, section]) });
  };

  // E7 start: the widget's view. Opening a run selects its card too, so Back finds it marked. U8b (M9): both supersede a
  // placement still pending, which must not unfold a section later.
  openRun = (taskId: string) => this.update({ view: { kind: 'run', taskId, phase: null }, pendingRun: null, selected: taskId, placing: null });

  back = () => {
    const { view, pendingRun, placing } = this.state;
    if (view.kind !== 'list' || pendingRun !== null || placing !== null) this.update({ view: LIST, pendingRun: null, placing: null });
  };

  selectPhase = (phase: PhaseSelection) => {
    const { view } = this.state;
    if (view.kind === 'run' && view.phase !== phase) this.update({ view: { ...view, phase } });
  };
  // E7 end

  toggle = (section: BackgroundSection) => {
    const expanded = new Set(this.state.expanded);
    if (!expanded.delete(section)) expanded.add(section);
    this.update({ expanded });
  };

  toggleEarlierTasks = () => this.update({ showEarlierTasks: !this.state.showEarlierTasks });

  setScrollTop = (scrollTop: number) => {
    this.state = { ...this.state, scrollTop }; // kept for the next mount; nothing renders from it meanwhile
  };

  // The store marks the node stopping at once and clears it on the engine's terminal frame; a refused call's message
  // shows on the card until the next stop (the store resolves rather than throws).
  stop = async (taskId: TaskId) => {
    const { appSessionId } = this.state;
    if (appSessionId === null) return;
    if (this.state.stopErrors.has(taskId)) {
      const stopErrors = new Map(this.state.stopErrors);
      stopErrors.delete(taskId);
      this.update({ stopErrors });
    }
    const result = await useTaskGraph.getState().stop(appSessionId, taskId);
    if (!result.ok && this.state.appSessionId === appSessionId) this.update({ stopErrors: new Map(this.state.stopErrors).set(taskId, result.message) });
  };

  // P5 O9 M5: a lane A job's stop goes to the session's bridge; the row reads stopping… until the transcript ends the job
  // (or its error, when the bridge refused it). P5 O9: a stop whose outcome is unknown says it may not have stopped, and
  // after STOP_DOUBT_MS without the transcript ending the job, Stop is offered again.
  stopJob = async (taskId: TaskId) => {
    const { appSessionId } = this.state;
    if (appSessionId === null || this.state.stoppingJobs.has(taskId)) return;
    const stopErrors = new Map(this.state.stopErrors);
    stopErrors.delete(taskId);
    this.clearDoubt(taskId);
    this.update({ stopErrors, stoppingJobs: new Set(this.state.stoppingJobs).add(taskId), doubtedJobs: without(this.state.doubtedJobs, taskId) });
    const result = await stopSessionTask(appSessionId, taskId);
    if (this.state.appSessionId !== appSessionId) return;
    if (result.state === 'refused') {
      this.update({ stoppingJobs: without(this.state.stoppingJobs, taskId), stopErrors: new Map(this.state.stopErrors).set(taskId, result.message) });
    } else if (result.state === 'unknown') {
      this.update({ doubtedJobs: new Set(this.state.doubtedJobs).add(taskId) });
      this.doubtTimers.set(
        taskId,
        setTimeout(() => {
          this.doubtTimers.delete(taskId);
          if (this.state.appSessionId === appSessionId) this.update({ stoppingJobs: without(this.state.stoppingJobs, taskId) });
        }, STOP_DOUBT_MS),
      );
    }
  };

  private clearDoubt(taskId?: string): void {
    for (const [id, timer] of this.doubtTimers) {
      if (taskId !== undefined && id !== taskId) continue;
      clearTimeout(timer);
      this.doubtTimers.delete(id);
    }
  }

  // A pinned tab's session changed under it: that session's work, with the selection, scroll, stop errors and folds
  // reset (Done folded again). No session shown (the Overview) changes nothing: returning to the same session finds the
  // tab as it was (as Subagents).
  follow = (appSessionId: AppSessionId | null) => {
    if (appSessionId === null || appSessionId === this.state.appSessionId) return;
    this.watch(appSessionId);
    this.clearDoubt();
    this.update({ appSessionId, view: LIST, pendingRun: null, selected: null, placing: null, expanded: new Set(OPEN_AT_FIRST), showEarlierTasks: false, scrollTop: 0, stopErrors: new Map(), stoppingJobs: new Set(), doubtedJobs: new Set() });
  };

  dispose = () => {
    this.clearDoubt();
    this.release?.();
    this.release = null;
  };
}

const EMPTY_GRAPH = emptyGraph();
const without = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

function BackgroundBody({ state, ctx }: { state: BackgroundHandle; ctx: PanelToolContext }) {
  const snapshot = useSyncExternalStore(state.subscribe, state.snapshot);
  useEffect(() => state.follow(ctx.appSessionId), [state, ctx.appSessionId]);
  const { appSessionId } = ctx;
  if (appSessionId === null) {
    return <p className="flex h-full items-center justify-center p-4 text-center text-ui text-fg-muted">{BACKGROUND_COPY.noSession}</p>;
  }
  // Until the follow lands, another session's selection and scroll are not shown over this one.
  const own = snapshot.appSessionId === appSessionId;
  if (own && snapshot.view.kind === 'run') {
    const { stopErrors } = snapshot;
    return <RunWidget key={appSessionId} appSessionId={appSessionId} handle={state} openedOn={snapshot.view.taskId} phase={snapshot.view.phase} stopError={(taskId) => stopErrors.get(taskId) ?? null} ctx={ctx} />;
  }
  return <ListView key={appSessionId} appSessionId={appSessionId} handle={state} snapshot={snapshot} own={own} ctx={ctx} />;
}

interface ViewProps {
  appSessionId: AppSessionId;
  handle: BackgroundHandle;
  snapshot: BackgroundState;
  own: boolean;
  ctx: PanelToolContext;
}

function ListView({ appSessionId, handle, snapshot, own, ctx }: ViewProps) {
  const graph = useTaskGraph((s) => s.entries.get(appSessionId)?.graph ?? EMPTY_GRAPH);
  const runsError = useTaskGraph((s) => s.entries.get(appSessionId)?.disk.runsError ?? null);
  const runsRead = useTaskGraph((s) => (s.entries.get(appSessionId)?.disk.runs ?? null) !== null);
  // P5 O9 M5: a terminal session driven through its bridge lists the jobs derived from its transcript; the engine status
  // MAWS kept from an earlier run of it is not live meanwhile
  const controls = useSessionControls(appSessionId);
  const driven = controls !== null && controls.turn() !== null;
  const live = !driven && ctx.status !== null;
  const jobs = useDrivenJobs(appSessionId, driven && !live);
  const listed = live || jobs !== null;
  // Whether what this session's list reads here has been read, so an empty Running can say `Nothing running`: the live
  // graph; else the terminal's jobs, or for a session read only from disk, its runs.
  const read = live || (driven ? jobs !== null : runsRead);
  const stopping = own ? snapshot.stoppingJobs : NO_JOBS;
  // What the sections read: the graph of a session live here; else its workflows (a run read from disk) with the jobs
  // its terminal's transcript gives, the graph's shells and monitors being known only while it runs here.
  const source = useMemo(() => (live ? graph : withJobs(graph, jobs ?? [], stopping)), [live, graph, jobs, stopping]);
  const running = backgroundRunning(source);
  const done = backgroundDone(source);
  const onStop = jobs !== null && !live ? handle.stopJob : handle.stop;
  const stopCapability = controls?.capability('stop-task') ?? null; // P5 O9 M5: Stop drawn from its own capability
  const stopGap = stopCapability !== null && !stopCapability.available ? stopCapability.reason : null;
  const selected = own ? snapshot.selected : null;
  const stopErrors = own ? snapshot.stopErrors : new Map<string, string>();
  const doubted = own && jobs !== null && !live ? snapshot.doubtedJobs : NO_JOBS; // P5 O9

  const expanded = snapshot.expanded;
  // A running task's elapsed (a running workflow's on its card's line) ticks once a second; an ended shell's or monitor's
  // `<ago>` on the slow tick. Neither ticks while its section is folded or the tool hidden.
  const shown = [...(expanded.has('running') ? running : []), ...(expanded.has('done') ? done : [])];
  const fast = useTicker(ctx.visible && shown.some((n) => n.status === 'running' && (n.kind === 'workflow' || elapsedOf(n, 0)?.live === true)));
  const slow = useTicker(ctx.visible && shown.some((n) => n.kind !== 'workflow' && n.status !== 'running' && n.endedAt !== null), SLOW_TICK_MS);
  const now = Math.max(fast, slow);

  const scroller = useRef<HTMLDivElement>(null);
  const [restoreTo] = useState(own ? snapshot.scrollTop : 0);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = restoreTo;
  }, [restoreTo]);
  // Scrolls to the selected card on each open, and once it appears when the open came before the graph knew it (a
  // fresh tab opened from a workflow row).
  const reveal = own ? snapshot.reveal : 0;
  const present = selected !== null && shown.some((n) => n.taskId === selected);
  useEffect(() => {
    if (!present || reveal === 0) return;
    scroller.current?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(selected!)}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, reveal, present]);
  // M7: an `open({ taskId })` unfolds the section this list holds the task in, now or once a read brings it.
  const placing = own ? snapshot.placing : null;
  const placeIn: BackgroundSection | null = placing === null ? null : running.some((n) => n.taskId === placing) ? 'running' : done.some((n) => n.taskId === placing) ? 'done' : null;
  useEffect(() => {
    if (placing !== null && placeIn !== null) handle.place(placing, placeIn);
  }, [placing, placeIn, handle]);
  // E7: an `open({ view: 'run' })` that came before its run opens the widget once a read brings the run.
  const pendingRun = own ? snapshot.pendingRun : null;
  const arrived = pendingRun === null ? null : resolveRun(graph, pendingRun);
  useEffect(() => {
    if (arrived !== null) handle.openRun(arrived);
  }, [arrived, handle]);

  // One row by its kind, as each kind's row was drawn in its own section before.
  const row = (node: TaskNode) => {
    const key = node.taskId;
    const common = { node, selected: selected === node.taskId, stopError: stopErrors.get(node.taskId) ?? null };
    if (node.kind === 'workflow') return <WorkflowCard key={key} {...common} view={runView(node, null, now)} live={live} onOpen={handle.openRun} onStop={handle.stop} />;
    const task = { ...common, now, stopDoubt: doubted.has(node.taskId), onStop, stopGap };
    if (node.kind === 'shell') return <ShellRow key={key} {...task} kindMark onOutput={live ? (path) => openLog(appSessionId, path, node.description) : null} />; // a lane A job's tail is remote-only
    if (node.kind === 'monitor') return <MonitorRow key={key} {...task} kindMark />;
    return <OtherTaskRow key={key} {...task} kindMark />;
  };

  return (
    <div ref={scroller} onScroll={(e) => handle.setScrollTop(e.currentTarget.scrollTop)} className="flex h-full min-h-0 flex-col overflow-auto">
      {!listed && !driven && <p className="shrink-0 px-3.5 pt-3 text-ui-sm text-fg-muted">{BACKGROUND_COPY.shellsDiskOnly}</p>}
      {runsError !== null && <p className="shrink-0 px-3.5 pt-3 text-ui-sm text-danger">{BACKGROUND_COPY.runsUnavailable(runsError)}</p>}
      {pendingRun !== null && <p className="shrink-0 px-3.5 pt-3 text-ui-sm text-fg-muted">{BACKGROUND_COPY.runNotFound}</p>}
      {running.length > 0 ? (
        <Group id="running" heading={BACKGROUND_COPY.running(running.length)} expanded={expanded.has('running')} onToggle={handle.toggle}>
          {running.map(row)}
        </Group>
      ) : (
        read && <p className="shrink-0 px-3.5 py-3 text-ui text-fg-muted">{BACKGROUND_COPY.nothingRunning}</p>
      )}
      {/* E7: the session's scheduled jobs (Decision Log 10) */}
      <ScheduledSection appSessionId={appSessionId} session={ctx.session} live={live} visible={ctx.visible} expanded={expanded.has('scheduled')} onToggle={handle.toggle} />
      <TaskChecklist
        status={ctx.status}
        session={ctx.session}
        expanded={expanded.has('tasks')}
        onToggle={() => handle.toggle('tasks')}
        showEarlier={own && snapshot.showEarlierTasks}
        onToggleEarlier={handle.toggleEarlierTasks}
        onOpen={() => ctx.openTool(AGENT_TOOL_IDS.tasks, { appSessionId, params: { appSessionId } })} // E7: the Tasks panel
      />
      {done.length > 0 && (
        <Group id="done" heading={BACKGROUND_COPY.done(done.length, doneByKind(done))} expanded={expanded.has('done')} onToggle={handle.toggle}>
          {done.map(row)}
        </Group>
      )}
    </div>
  );
}

// P5 O9 M5: a session not live here: the graph's workflows (its runs read from disk) and its terminal's jobs as one
// graph, in the order they started, a stop the bridge took reading stopping… while its job runs. The UX wave's U8b (M8):
// the Background tasks card lists through it too, so one rule merges and orders what the card and the panel read.
const NO_JOBS: ReadonlySet<string> = new Set();
const startMs = (n: TaskNode) => (n.startedAt === null ? Infinity : Date.parse(n.startedAt));
export function withJobs(graph: TaskGraph, jobs: readonly Job[], stopping: ReadonlySet<string>): TaskGraph {
  const flows = graph.order.map((taskId) => graph.tasks.get(taskId)!).filter((n) => n.kind === 'workflow');
  const mark = (n: TaskNode): TaskNode => (n.status === 'running' && stopping.has(n.taskId) ? { ...n, stopping: true } : n);
  const nodes = [...flows, ...jobs.map((job) => mark(taskNodeOf(job)))].sort((a, b) => startMs(a) - startMs(b) || 0);
  const merged = emptyGraph();
  for (const node of nodes) {
    if (!merged.tasks.has(node.taskId)) merged.order.push(node.taskId);
    merged.tasks.set(node.taskId, node);
  }
  return merged;
}

export const backgroundTool: PanelTool<BackgroundHandle, BackgroundParams> = {
  id: AGENT_TOOL_IDS.background,
  title: BACKGROUND_COPY.title,
  icon: BackgroundIcon,
  pinnable: true,
  multiInstance: false,
  createState: (init) => new BackgroundHandle(init.appSessionId, init.params),
  open: (state, params) => state.open(params),
  beforeClose: () => Promise.resolve(true),
  dispose: (state) => state.dispose(),
  render: BackgroundBody,
  summary: BackgroundSummary,
};
