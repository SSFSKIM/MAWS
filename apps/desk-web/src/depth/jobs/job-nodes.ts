// The jobs view's adapter (DC9; the composite's §9.4): DX4's `Job`s — the loop's background shells and monitors, read
// from its rows by the machine — as the task nodes MAWS's `ShellRow` and `MonitorRow` (`tools/agents/background/
// TaskRows.tsx`) draw, in MAWS's order (running first, then newest end first; `shells` and `monitors` of its task
// graph). A job is always a background one, and its status DX4's, never `unknown`. Its `startedAt` and `endedAt` are the
// rows' times, so the row's elapsed and its `<status> <ago>` read as MAWS's do.
import type { TaskId, ToolUseId } from '@shared/graph/ids';
import type { Job } from 'desk-hub/protocol';
import { emptyGraph, monitors, shells, type TaskGraph, type TaskNode } from '../../../../../src/renderer/src/tools/agents/model/task-graph';

/** One job as MAWS's task node: a shell is a `local_bash` task, a monitor a `monitor` one. */
export function taskNodeOf(job: Job): TaskNode {
  return {
    taskId: job.taskId as TaskId,
    kind: job.kind,
    taskType: job.kind === 'shell' ? 'local_bash' : 'monitor',
    toolUseId: job.toolUseId as ToolUseId,
    description: job.description || job.command || job.taskId,
    status: job.status,
    stopping: false,
    startedAt: job.startedAt,
    endedAt: job.endedAt ?? null,
    usage: null,
    lastToolName: null,
    activity: null,
    summary: job.summary ?? null,
    report: null,
    reason: null,
    outputFile: job.outputFile,
    isBackground: true,
    agent: null,
    workflow: null,
    provenance: { wire: false, disk: false, snapshot: false },
  };
}

/** The jobs as MAWS's lists order them: the shells and the monitors, each running first, then newest end first. */
export function jobLists(jobs: readonly Job[]): { shells: TaskNode[]; monitors: TaskNode[] } {
  const graph: TaskGraph = emptyGraph();
  for (const job of jobs) {
    const node = taskNodeOf(job);
    if (!graph.tasks.has(node.taskId)) graph.order.push(node.taskId);
    graph.tasks.set(node.taskId, node);
  }
  return { shells: shells(graph), monitors: monitors(graph) };
}
