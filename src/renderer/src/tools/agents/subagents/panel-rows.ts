// The Subagents panel's Running and Done rows (the UX wave's U8b document, M7 decision 4; Interfaces §E), from the
// graph's readings and nothing else: the first-level agents (`firstLevelAgents`), and under a row the person opened
// (`useOpenAgents`, the set the card shares) its direct child agents (`nestedOf`), one level at a time, the active
// first. Under an opened parent that runs, its finished children stay folded into today's `Done · N` line
// (`expandedFolds`); a parent that does not run lists them, as a fold would hide why it is listed. Pure.
import type { TaskId } from '@shared/graph/ids';
import { firstLevelAgents, nestedOf, type TaskGraph, type TreeRow } from '../model/task-graph';

export function panelRows(graph: TaskGraph, open: ReadonlySet<TaskId>, expandedFolds: ReadonlySet<TaskId>): { running: TreeRow[]; done: TreeRow[] } {
  const parentOf = (taskId: TaskId) => (graph.tasks.get(taskId)?.agent?.parentAgentId ?? null) as unknown as TaskId | null;
  const seen = new Set<TaskId>(); // a parent cycle the engine cannot make lists nobody twice
  const visit = (out: TreeRow[], taskId: TaskId, depth: number, foldedUnder: TaskId | null) => {
    if (seen.has(taskId)) return;
    seen.add(taskId);
    const parent = parentOf(taskId);
    out.push({ kind: 'agent', taskId, depth, parentTaskId: parent, orphan: depth === 0 && parent !== null, foldedUnder });
    if (!open.has(taskId)) return;
    const { active, done } = nestedOf(graph, taskId);
    for (const child of active) visit(out, child, depth + 1, foldedUnder);
    if (graph.tasks.get(taskId)?.status !== 'running' || done.length === 0) {
      for (const child of done) visit(out, child, depth + 1, foldedUnder);
      return;
    }
    const expanded = expandedFolds.has(taskId);
    out.push({ kind: 'done-fold', parentTaskId: taskId, count: done.length, depth: depth + 1, expanded });
    if (expanded) for (const child of done) visit(out, child, depth + 1, taskId);
  };
  const { running, done } = firstLevelAgents(graph);
  const rows = { running: [] as TreeRow[], done: [] as TreeRow[] };
  for (const taskId of running) visit(rows.running, taskId, 0, null);
  for (const taskId of done) visit(rows.done, taskId, 0, null);
  return rows;
}

// Whether a row has agents under it to show: its disclosure is drawn while it does.
export const hasAgentsUnder = (graph: TaskGraph, taskId: TaskId): boolean => {
  const { active, done } = nestedOf(graph, taskId);
  return active.length + done.length > 0;
};
