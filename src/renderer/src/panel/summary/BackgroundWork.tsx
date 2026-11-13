// The Background tasks card (UX wave U8b, M8; its execution document, decisions 1 to 4 and 8, Interfaces §D, §E and
// §F): drawn while a background task of the session runs, after the Subagents card. Its heading counts them and opens
// the Background tasks panel; its rows are every running workflow, shell, monitor and task of another kind, in the
// order they started, four at most and then `N more`: each its kind's mark, its description on one line and a coarse
// elapsed time, a press opening the panel at it (a workflow at its run). No Stop: Stop and Output are the panel's.
// `N finished`, the panel's Done count, opens that fold. It reads what the panel reads: the graph of a session live
// here; else the graph's workflows with the jobs a terminal's transcript gives, merged by the panel's one rule.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useDrivenJobs } from '../../lane-a/jobs/lane-jobs';
import { useSessionControls } from '../../session/controls/controls-for';
import { useSessions } from '../../stores/sessions';
import { withJobs, type BackgroundParams } from '../../tools/agents/background/BackgroundTool';
import { KindMark } from '../../tools/agents/marks';
import { backgroundDone, backgroundRunning, emptyGraph, type TaskGraph, type TaskNode } from '../../tools/agents/model/task-graph';
import { useTaskGraph } from '../../tools/agents/store';
import { AGENT_TOOL_IDS } from '../../tools/agents/tool-ids';
import { SUMMARY_COPY } from '../copy';
import { panelHost } from '../host';
import { CARD_ROWS, coarseElapsed, RunningCard, useCardClock } from './RunningCard';

const EMPTY_GRAPH = emptyGraph();
const NO_STOPS: ReadonlySet<string> = new Set();

// The graph the Background tasks panel lists (`BackgroundTool.tsx`'s list): a session a terminal drives through its
// bridge is not live here, whatever engine status MAWS kept from an earlier run of it; its jobs come from its watch.
function useBackgroundGraph(appSessionId: AppSessionId): TaskGraph {
  const graph = useTaskGraph((s) => s.entries.get(appSessionId)?.graph ?? EMPTY_GRAPH);
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const controls = useSessionControls(appSessionId);
  const driven = controls !== null && controls.turn() !== null;
  const live = !driven && status !== null;
  const jobs = useDrivenJobs(appSessionId, driven);
  return useMemo(() => (live ? graph : withJobs(graph, jobs ?? [], NO_STOPS)), [live, graph, jobs]);
}

const openPanel = (appSessionId: AppSessionId, params: Omit<BackgroundParams, 'appSessionId'> = {}) =>
  panelHost.addTool(AGENT_TOOL_IDS.background, { appSessionId, params: { ...params, appSessionId } });

export function BackgroundTasksCard({ appSessionId }: { appSessionId: AppSessionId }) {
  const source = useBackgroundGraph(appSessionId);
  const running = backgroundRunning(source);
  const shown = running.slice(0, CARD_ROWS);
  const now = useCardClock(shown);
  if (running.length === 0) return null;
  return (
    <RunningCard
      title={SUMMARY_COPY.sections.background}
      running={running.length}
      more={running.length - shown.length}
      finished={backgroundDone(source).length}
      onOpen={() => openPanel(appSessionId)}
      onFinished={() => openPanel(appSessionId, { section: 'done' })}
    >
      {shown.map((node) => (
        <TaskRow key={node.taskId} node={node} now={now} onOpen={() => openPanel(appSessionId, node.kind === 'workflow' ? { taskId: node.taskId, view: 'run' } : { taskId: node.taskId })} />
      ))}
    </RunningCard>
  );
}

function TaskRow({ node, now, onOpen }: { node: TaskNode; now: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-task-id={node.taskId}
      onClick={onOpen}
      className="flex min-h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <KindMark kind={node.kind} />
      <span data-part="description" title={node.description} className="min-w-0 flex-1 truncate">
        {node.description}
      </span>
      <span data-part="elapsed" className="shrink-0 whitespace-nowrap text-fg-muted tabular-nums">
        {coarseElapsed(node, now)}
      </span>
    </button>
  );
}
