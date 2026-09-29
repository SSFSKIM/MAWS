// The session's task checklist (C8b execution document, Interfaces *Background work's data*): which TaskCreate list a
// session reads and how its tasks are ordered. A live session's list is C3's `EngineSessionStatus.taskListId` (the
// launch's CLAUDE_CODE_TASK_LIST_ID, else the engine session id once known), never a guess; a disk-only session reads
// its record's engine session id, labelled "session list".
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { PersistedTask } from '@shared/wire/store';

// SPEC 20 §20.2.2: the engine makes a list id a path segment this way, and C4's reader applies the same rule.
export function sanitiseListId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-');
}

export type ListIdAnswer = { listId: string; label: 'list' | 'session list' } | { listId: null; reason: 'no id yet' | 'no session' };

export function listIdFor(status: EngineSessionStatus | null, record: SessionRecord | null): ListIdAnswer {
  if (status) return status.taskListId === null ? { listId: null, reason: 'no id yet' } : { listId: sanitiseListId(status.taskListId), label: 'list' };
  const engineSessionId = record?.engineSessionId ?? null;
  return engineSessionId === null ? { listId: null, reason: 'no session' } : { listId: sanitiseListId(engineSessionId), label: 'session list' };
}

// Numeric ids in numeric order (the engine numbers its tasks), anything else after them as text.
const byId = (a: PersistedTask, b: PersistedTask) => {
  const na = /^\d+$/.test(a.id) ? Number(a.id) : NaN;
  const nb = /^\d+$/.test(b.id) ? Number(b.id) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  if (!Number.isNaN(na)) return -1;
  if (!Number.isNaN(nb)) return 1;
  return a.id.localeCompare(b.id);
};

// open: the in_progress tasks first, then the pending ones, each group in id order (the one ordering rule, used by the
// view as given); earlier: the completed ones.
export function checklistOf(tasks: PersistedTask[]): { total: number; completed: number; open: PersistedTask[]; earlier: PersistedTask[] } {
  const of = (status: PersistedTask['status']) => tasks.filter((t) => t.status === status).sort(byId);
  const earlier = of('completed');
  return { total: tasks.length, completed: earlier.length, open: [...of('in_progress'), ...of('pending')], earlier };
}
