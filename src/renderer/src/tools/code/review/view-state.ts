// One Review surface's view state (C8c execution document, Interfaces *Tools, slots and the open-file seam*:
// `ReviewState`): the panel tool keeps one per tab in its X5 state, a diff tab one per tab id. A zustand store handle,
// never fields read off a mutable object (C8a's React Compiler rule). Pure transitions only; the shell applies them.
//
// UX wave U5b (M2; the execution document's Interfaces §E): the stack's state stands beside the one-file fields it
// replaces. `folds`, `places` and `reveal` are the stack's, and `hunk` counts across the stack from M3; `selected`,
// `scrollTop` and `viewedKey` stay while today's shell reads them, and leave with it in M3.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { TurnId } from '../../../transcript';
import type { ReviewParams, ReviewScope } from './review-model';
import type { FoldChoice } from './stack-model';

export type ReviewMode = 'unified' | 'split';
// Where the scroller was left (§F, decision 7): the section's file, the diff row at the top edge and the pixels below
// that row's top; with no row there, the offset is from the section's top.
export interface StackPlace {
  path: string;
  row: { side: 'old' | 'new'; line: number } | null;
  offset: number;
}

export interface ReviewUi {
  session: AppSessionId | null; // the session the scope was decided for (a pinned tool's changes under it)
  directory: string | null; // the working folder it was decided in (UX wave U8c-2: the agent moving starts it over); null until known
  scope: ReviewScope | null; // null until decided: defaultScope once the status (and This branch's availability) is known
  turnId: TurnId | null; // Last turn's turn; the chip shows while it is set
  selected: string | null; // a file's identity in its scope (ReviewFile.path), or a requested path not in the list
  hunk: number; // the selected file's current hunk, 0-based (across the stack from M3)
  navigate: number; // bumped by the hunk and file buttons: the body scrolls to `hunk` when it changes
  scrollTop: number; // the diff body's
  mode: ReviewMode;
  viewed: ReadonlyMap<string, ReadonlyMap<string, string>>; // viewedKey → path → the hunks' signature when marked
  folds: ReadonlyMap<string, ReadonlyMap<string, FoldChoice>>; // placeKey → path → the person's own choice
  places: ReadonlyMap<string, StackPlace>; // placeKey → where the scroller was left
  reveal: { path: string; n: number } | null; // a request that named a file (`n` tells two requests for one file apart)
  request: ReviewParams | null; // an open() not yet applied against the shown session
  redecide: { path: string | null } | null; // an open() with no scope: the default decided again, with the path it named
}

export function createReviewUi(init: { session: AppSessionId | null; directory?: string | null; params?: ReviewParams | null; mode?: ReviewMode }): StoreApi<ReviewUi> {
  return createStore<ReviewUi>()(() => ({
    session: init.session,
    directory: init.directory ?? null,
    scope: null,
    turnId: null,
    selected: null,
    hunk: 0,
    navigate: 0,
    scrollTop: 0,
    mode: init.mode ?? 'unified',
    viewed: new Map(),
    folds: new Map(),
    places: new Map(),
    reveal: null,
    request: init.params ?? null,
    redecide: null,
  }));
}

// A pinned tool shown for another session starts over there, and so does a tool whose session's working folder changed
// (UX wave U8c-2, M4 decision 5: the agent moved): its scope is decided again, its selection dropped, the scroll at the
// top. The mode, the viewed marks, the folds and the places (keyed by directory and scope, so a checkout's are found on
// return) stay; a reveal does not outlive the session it was asked for.
export function forSession(session: AppSessionId | null, directory: string | null): Partial<ReviewUi> {
  return { session, directory, scope: null, turnId: null, selected: null, hunk: 0, scrollTop: 0, redecide: null, reveal: null };
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

// The key of a scope's marks, folds and place (§E): `viewedKey`'s, with the commit's hash for the commit's scope, so a
// commit's are its own (S18). A commit named beside another scope (its chip listed) is not part of that scope's key.
const COMMIT_SCOPE: string = 'commit'; // a ReviewScope from M9
export const placeKey = (directory: string, scope: ReviewScope, turnId: TurnId | null, commit: string | null): string =>
  `${directory}\0${scope}${scope === 'turn' ? `\0${turnId ?? ''}` : ''}${scope === COMMIT_SCOPE ? `\0${commit ?? ''}` : ''}`;

// Marked, and the file is what it was when marked (`viewedSignature`; a stale mark is worse than none).
export function isViewed(viewed: ReviewUi['viewed'], key: string, path: string, signature: string): boolean {
  return viewed.get(key)?.get(path) === signature;
}

// Marking a file Viewed also removes the person's fold choice for it, so the mark folds the file (§F); a mark that
// later drops because the file changed then unfolds it, unless the person folded it again since.
export function toggleViewed(ui: ReviewUi, key: string, path: string, signature: string): Partial<ReviewUi> {
  const marks = new Map(ui.viewed.get(key) ?? []);
  if (isViewed(ui.viewed, key, path, signature)) {
    marks.delete(path);
    return { viewed: new Map(ui.viewed).set(key, marks) };
  }
  marks.set(path, signature);
  const choices = ui.folds.get(key);
  if (!choices?.has(path)) return { viewed: new Map(ui.viewed).set(key, marks) };
  const kept = new Map(choices);
  kept.delete(path);
  return { viewed: new Map(ui.viewed).set(key, marks), folds: new Map(ui.folds).set(key, kept) };
}

// A click on a section's header or its fold mark: the person's own choice for that file.
export function setFold(ui: ReviewUi, key: string, path: string, choice: FoldChoice): Partial<ReviewUi> {
  return { folds: new Map(ui.folds).set(key, new Map(ui.folds.get(key) ?? []).set(path, choice)) };
}

// "Collapse all" (`closed`) and "Expand all" (`open`): the same choice for every file of the scope.
export function foldAll(ui: ReviewUi, key: string, paths: readonly string[], choice: FoldChoice): Partial<ReviewUi> {
  const choices = new Map(ui.folds.get(key) ?? []);
  for (const path of paths) choices.set(path, choice);
  return { folds: new Map(ui.folds).set(key, choices) };
}

// The place in force for a key: the live place after the person's scroll, or a reveal once it was reached.
export function savePlace(ui: ReviewUi, key: string, place: StackPlace): Partial<ReviewUi> {
  return { places: new Map(ui.places).set(key, place) };
}
