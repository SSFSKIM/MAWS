// Which parents are open in the Subagents card and panel (the UX wave's U8b document, M5 decision 4; Interfaces §E): per
// session, the task ids of the rows whose agents under them are shown. One set for the card and the panel, so a row
// opened in one is open in the other; a pinned panel that follows another session reads that session's set. Held for
// the run: nothing is stored.
import { create } from 'zustand';
import type { AppSessionId, TaskId } from '@shared/graph/ids';

export interface OpenAgents {
  open: ReadonlyMap<AppSessionId, ReadonlySet<TaskId>>;
  toggle(appSessionId: AppSessionId, taskId: TaskId): void;
}

export const useOpenAgents = create<OpenAgents>()((set, get) => ({
  open: new Map(),
  toggle(appSessionId, taskId) {
    const next = new Set(get().open.get(appSessionId));
    if (!next.delete(taskId)) next.add(taskId);
    set({ open: new Map(get().open).set(appSessionId, next) });
  },
}));

const NONE: ReadonlySet<TaskId> = new Set();
// A session's open parents; one empty set for a session with none, so a selector's answer stays the same object.
export const openOf = (state: Pick<OpenAgents, 'open'>, appSessionId: AppSessionId): ReadonlySet<TaskId> => state.open.get(appSessionId) ?? NONE;
