// The Background work tool (C8b execution document, Interfaces *Tools*; M3; mockup 03 study 03): one single-instance,
// pinnable tool listing a session's background work in the fixed order Workflows, Shells, Monitors, Tasks, each a
// collapsible section with a sticky heading (C8a's summary `Section` pattern, reimplemented here because C8a's is not
// exported). A section with nothing to show is omitted, except Tasks, which always says its state. Stop is the one
// action on a task (§5.6: stop only), through the task-graph store's two-phase stop. Its state is a small handle holding
// an immutable snapshot the body reads through useSyncExternalStore, plus the store watch for the session it shows.
// E7 (Design §2): its view is the list or one run's widget, as Subagents' is its lists or a drill-in (Back is a state
// change; the host sees one tab); a card's title or chevron, the transcript's workflow ref and `open({ view: 'run' })`
// open the widget.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import { Icon } from '../../../app/IconButton';
import type { PanelTool, PanelToolContext } from '../../../panel/tool';
import { BACKGROUND_COPY } from '../copy';
import { openLog } from '../log/LogTool';
import { elapsedOf } from '../model/elapsed';
import { emptyGraph, monitors, shells, workflows, type TaskNode } from '../model/task-graph';
import { resolveRun, runView, type PhaseSelection } from '../model/workflow-run'; // E7
import { useTaskGraph } from '../store';
import { SLOW_TICK_MS, useTicker } from '../subagents/shared';
import { AGENT_TOOL_IDS } from '../tool-ids';
import { BackgroundSummary } from './BackgroundSummary';
import { Group, type BackgroundSection } from './Group';
import { RunWidget } from './RunWidget'; // E7
import { TaskChecklist } from './TaskChecklist';
import { MonitorRow, ShellRow } from './TaskRows';
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
}

export type { BackgroundSection } from './Group';
const ALL_SECTIONS: readonly BackgroundSection[] = ['workflows', 'shells', 'monitors', 'tasks'];

// E7: the list, or one run's widget (`taskId` the id it was opened on; `phase` the owner's pick, null following the run).
export type BackgroundView = { kind: 'list' } | { kind: 'run'; taskId: string; phase: PhaseSelection | null };
const LIST: BackgroundView = { kind: 'list' };

// The snapshot. `appSessionId`: the session the view state belongs to. `reveal` grows with each `open({ taskId })`, so
// the body scrolls the selected card into view again. `pendingRun` (E7): the ids an `open({ view: 'run' })` named
// before any read brought the run; the widget opens once one resolves.
export interface BackgroundState {
  appSessionId: AppSessionId | null;
  view: BackgroundView;
  pendingRun: string[] | null;
  selected: string | null;
  expanded: Set<BackgroundSection>;
  showEarlierTasks: boolean;
  scrollTop: number;
  stopErrors: Map<string, string>;
  reveal: number;
}

const sectionOfNode = (node: TaskNode | undefined): BackgroundSection => (node?.kind === 'shell' ? 'shells' : node?.kind === 'monitor' ? 'monitors' : 'workflows');

export class BackgroundHandle {
  private state: BackgroundState;
  private readonly listeners = new Set<() => void>();
  private release: (() => void) | null = null;

  constructor(appSessionId: AppSessionId | null, params: BackgroundParams | undefined) {
    this.state = {
      appSessionId, view: LIST, pendingRun: null, selected: null, expanded: new Set(ALL_SECTIONS), showEarlierTasks: false, scrollTop: 0, stopErrors: new Map(), reveal: 0,
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
  // `Run not found yet` with the id selected until a read brings the run. No task id (the summary's Open) shows the list.
  open = (params: BackgroundParams | undefined) => {
    if (params?.appSessionId !== undefined) this.follow(params.appSessionId);
    if (!params?.taskId) return this.back();
    const { appSessionId } = this.state;
    const graph = appSessionId === null ? undefined : useTaskGraph.getState().entries.get(appSessionId)?.graph;
    if (params.view === 'run') {
      const ids = params.runId === undefined ? [params.taskId] : [params.taskId, params.runId];
      const taskId = graph === undefined ? null : resolveRun(graph, ids);
      if (taskId !== null) return this.openRun(taskId);
      return this.update({ view: LIST, pendingRun: ids, selected: params.taskId, expanded: new Set([...this.state.expanded, 'workflows']), reveal: this.state.reveal + 1 });
    }
    const node = graph?.tasks.get(params.taskId as TaskId);
    this.update({ view: LIST, pendingRun: null, selected: params.taskId, expanded: new Set([...this.state.expanded, sectionOfNode(node)]), reveal: this.state.reveal + 1 });
  };

  // E7 start: the widget's view. Opening a run selects its card too, so Back finds it marked.
  openRun = (taskId: string) => this.update({ view: { kind: 'run', taskId, phase: null }, pendingRun: null, selected: taskId });

  back = () => {
    if (this.state.view.kind !== 'list' || this.state.pendingRun !== null) this.update({ view: LIST, pendingRun: null });
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

  // A pinned tab's session changed under it: that session's work, with the selection, scroll and stop errors reset. No
  // session shown (the Overview) changes nothing: returning to the same session finds the tab as it was (as Subagents).
  follow = (appSessionId: AppSessionId | null) => {
    if (appSessionId === null || appSessionId === this.state.appSessionId) return;
    this.watch(appSessionId);
    this.update({ appSessionId, view: LIST, pendingRun: null, selected: null, showEarlierTasks: false, scrollTop: 0, stopErrors: new Map() });
  };

  dispose = () => {
    this.release?.();
    this.release = null;
  };
}

const EMPTY_GRAPH = emptyGraph();

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
  const live = ctx.status !== null;
  const flows = workflows(graph);
  const shellNodes = live ? shells(graph) : [];
  const monitorNodes = live ? monitors(graph) : [];
  const selected = own ? snapshot.selected : null;
  const stopErrors = own ? snapshot.stopErrors : new Map<string, string>();

  const expanded = snapshot.expanded;
  // A running task's elapsed (a running workflow's on its card's line) ticks once a second; an ended shell's or monitor's
  // `<ago>` on the slow tick. Neither ticks while its section is collapsed or the tool hidden.
  const shown = [...(expanded.has('workflows') ? flows : []), ...(expanded.has('shells') ? shellNodes : []), ...(expanded.has('monitors') ? monitorNodes : [])];
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
  // E7: an `open({ view: 'run' })` that came before its run opens the widget once a read brings the run.
  const pendingRun = own ? snapshot.pendingRun : null;
  const arrived = pendingRun === null ? null : resolveRun(graph, pendingRun);
  useEffect(() => {
    if (arrived !== null) handle.openRun(arrived);
  }, [arrived, handle]);

  const running = (nodes: TaskNode[]) => nodes.filter((n) => n.status === 'running').length;
  const nothing = live && flows.length === 0 && shellNodes.length === 0 && monitorNodes.length === 0;

  return (
    <div ref={scroller} onScroll={(e) => handle.setScrollTop(e.currentTarget.scrollTop)} className="flex h-full min-h-0 flex-col overflow-auto">
      {!live && <p className="shrink-0 px-3.5 pt-3 text-ui-sm text-fg-muted">{BACKGROUND_COPY.shellsDiskOnly}</p>}
      {runsError !== null && <p className="shrink-0 px-3.5 pt-3 text-ui-sm text-danger">{BACKGROUND_COPY.runsUnavailable(runsError)}</p>}
      {pendingRun !== null && <p className="shrink-0 px-3.5 pt-3 text-ui-sm text-fg-muted">{BACKGROUND_COPY.runNotFound}</p>}
      {nothing && <p className="shrink-0 px-3.5 pt-3 text-ui text-fg-muted">{BACKGROUND_COPY.nothingRunning}</p>}
      {flows.length > 0 && (
        <Group id="workflows" heading={live ? BACKGROUND_COPY.workflows(flows.length) : BACKGROUND_COPY.runsOnDisk(flows.length)} expanded={expanded.has('workflows')} onToggle={handle.toggle}>
          {flows.map((node) => (
            <WorkflowCard
              key={node.taskId}
              node={node}
              view={runView(node, null, now)}
              live={live}
              selected={selected === node.taskId}
              stopError={stopErrors.get(node.taskId) ?? null}
              onOpen={handle.openRun}
              onStop={handle.stop}
            />
          ))}
        </Group>
      )}
      {shellNodes.length > 0 && (
        <Group id="shells" heading={BACKGROUND_COPY.shellsRunning(running(shellNodes))} expanded={expanded.has('shells')} onToggle={handle.toggle}>
          {shellNodes.map((node) => (
            <ShellRow
              key={node.taskId}
              node={node}
              now={now}
              selected={selected === node.taskId}
              stopError={stopErrors.get(node.taskId) ?? null}
              onStop={handle.stop}
              onOutput={(path) => openLog(appSessionId, path, node.description)}
            />
          ))}
        </Group>
      )}
      {monitorNodes.length > 0 && (
        <Group id="monitors" heading={BACKGROUND_COPY.monitors(monitorNodes.length)} expanded={expanded.has('monitors')} onToggle={handle.toggle}>
          {monitorNodes.map((node) => (
            <MonitorRow key={node.taskId} node={node} now={now} selected={selected === node.taskId} stopError={stopErrors.get(node.taskId) ?? null} onStop={handle.stop} />
          ))}
        </Group>
      )}
      <TaskChecklist
        status={ctx.status}
        session={ctx.session}
        expanded={expanded.has('tasks')}
        onToggle={() => handle.toggle('tasks')}
        showEarlier={own && snapshot.showEarlierTasks}
        onToggleEarlier={handle.toggleEarlierTasks}
        onOpen={() => ctx.openTool(AGENT_TOOL_IDS.tasks, { appSessionId, params: { appSessionId } })} // E7: the Tasks panel
      />
    </div>
  );
}

export function BackgroundIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M5 6.5h6M5 9.5h3.5" />
    </Icon>
  );
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
