// One Review surface's view state (C8c execution document, Interfaces *Tools, slots and the open-file seam*:
// `ReviewState`): the panel tool keeps one per tab in its X5 state, a diff tab one per tab id. A zustand store handle,
// never fields read off a mutable object (C8a's React Compiler rule). Pure transitions only; the shell applies them.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { TurnId } from '../../../transcript';
import { hunksSignature, type ReviewFile, type ReviewParams, type ReviewScope } from './review-model';

export type ReviewMode = 'unified' | 'split';

export interface ReviewUi {
  session: AppSessionId | null; // the session the scope was decided for (a pinned tool's changes under it)
  scope: ReviewScope | null; // null until decided: defaultScope once the status (and This branch's availability) is known
  turnId: TurnId | null; // Last turn's turn; the chip shows while it is set
  selected: string | null; // a file's identity in its scope (ReviewFile.path), or a requested path not in the list
  hunk: number; // the selected file's current hunk, 0-based
  navigate: number; // bumped by the hunk and file buttons: the body scrolls to `hunk` when it changes
  scrollTop: number; // the diff body's
  mode: ReviewMode;
  viewed: ReadonlyMap<string, ReadonlyMap<string, string>>; // viewedKey → path → the hunks' signature when marked
  request: ReviewParams | null; // an open() not yet applied against the shown session
  redecide: { path: string | null } | null; // an open() with no scope: the default decided again, with the path it named
}

export function createReviewUi(init: { session: AppSessionId | null; params?: ReviewParams | null; mode?: ReviewMode }): StoreApi<ReviewUi> {
  return createStore<ReviewUi>()(() => ({
    session: init.session,
    scope: null,
    turnId: null,
    selected: null,
    hunk: 0,
    navigate: 0,
    scrollTop: 0,
    mode: init.mode ?? 'unified',
    viewed: new Map(),
    request: init.params ?? null,
    redecide: null,
  }));
}

// A pinned tool shown for another session starts over there: its scope is decided again, its selection dropped. The
// mode and the viewed marks (keyed by directory and scope) stay.
export function forSession(session: AppSessionId | null): Partial<ReviewUi> {
  return { session, scope: null, turnId: null, selected: null, hunk: 0, scrollTop: 0, redecide: null };
}

// An open() (X5 re-targeting): a receipt's `{ scope: 'turn', turnId, path }` selects the turn and the path; a scope
// with a path selects both; no scope decides the default again, keeping a file of the same scope selected.
export function applyRequest(ui: ReviewUi, params: ReviewParams): Partial<ReviewUi> {
  const next: Partial<ReviewUi> = { request: null };
  if (params.scope === 'turn') {
    if (!params.turnId) return next;
    return { ...next, scope: 'turn', turnId: params.turnId, redecide: null, ...moved(ui, 'turn', params.turnId, params.path) };
  }
  if (params.scope) return { ...next, scope: params.scope, redecide: null, ...moved(ui, params.scope, ui.turnId, params.path) };
  return { ...next, redecide: { path: params.path ?? null } };
}

function moved(ui: ReviewUi, scope: ReviewScope, turnId: TurnId | null, path: string | undefined): Partial<ReviewUi> {
  if (path) return { selected: path, hunk: 0, scrollTop: 0 };
  if (ui.scope === scope && ui.turnId === turnId) return {};
  return { selected: null, hunk: 0, scrollTop: 0 };
}

// The default decided (a new tool, a pinned tool's new session), or decided again for an open() with no scope: the
// same scope keeps its selected file unless the open named another; a different one selects the named file or none.
export function decide(ui: ReviewUi, scope: ReviewScope): Partial<ReviewUi> {
  const path = ui.redecide?.path ?? null;
  if (ui.scope === scope) return { redecide: null, ...(path !== null ? selectFile(path) : {}) };
  return { scope, redecide: null, selected: path, hunk: 0, scrollTop: 0 };
}

export function selectScope(ui: ReviewUi, scope: ReviewScope): Partial<ReviewUi> {
  if (ui.scope === scope) return {};
  return { scope, selected: null, hunk: 0, scrollTop: 0, redecide: null };
}

export function selectFile(path: string): Partial<ReviewUi> {
  return { selected: path, hunk: 0, scrollTop: 0 };
}

export const viewedKey = (directory: string, scope: ReviewScope, turnId: TurnId | null) => `${directory}\0${scope}${scope === 'turn' ? `\0${turnId ?? ''}` : ''}`;

// Marked, and the hunks are what they were when marked (a stale mark is worse than none).
export function isViewed(viewed: ReviewUi['viewed'], key: string, file: ReviewFile): boolean {
  const mark = viewed.get(key)?.get(file.path);
  return mark !== undefined && mark === hunksSignature(file.hunks ?? []);
}

export function toggleViewed(ui: ReviewUi, key: string, file: ReviewFile): Partial<ReviewUi> {
  const marks = new Map(ui.viewed.get(key) ?? []);
  if (isViewed(ui.viewed, key, file)) marks.delete(file.path);
  else marks.set(file.path, hunksSignature(file.hunks ?? []));
  return { viewed: new Map(ui.viewed).set(key, marks) };
}
