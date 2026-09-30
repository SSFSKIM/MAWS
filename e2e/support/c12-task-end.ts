// The pre-run's proof that a background task it stopped has ended (C12 M6): a `task.notification` for the task, or a
// `task.updated` whose patch reaches a terminal status. Any other update after the start (progress, a description) is
// not an end. No imports, so it runs under plain node for its check.
export const TERMINAL_TASK_STATES: readonly string[] = ['completed', 'failed', 'killed', 'stopped'];

export interface TaskEventLike {
  kind: string;
  seq: number | null;
  taskId?: unknown;
  patch?: { status?: unknown } | null;
}

export function taskEnded(e: TaskEventLike, taskId: string, afterSeq: number): boolean {
  if (e.taskId !== taskId || e.seq === null || e.seq <= afterSeq) return false;
  if (e.kind === 'task.notification') return true;
  return e.kind === 'task.updated' && typeof e.patch?.status === 'string' && TERMINAL_TASK_STATES.includes(e.patch.status);
}
