// One Review surface's view state (C8c execution document, Interfaces *Tools, slots and the open-file seam*:
// `ReviewState`): the panel tool keeps one per tab in its X5 state, a diff tab one per tab id. A zustand store handle,
// never fields read off a mutable object (C8a's React Compiler rule). Pure transitions only; the shell applies them.
//
// UX wave U5b (the execution document's Interfaces §E): the stack's state. `folds`, `places` and `reveal` are the stack's,
// `hunk` counts across it, and the marks, the folds and the place share one key, `placeKey`.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { TurnId } from '../../../transcript';
import { isFullHash, type ReviewParams, type ReviewScope } from './review-model';
import type { FoldChoice } from './stack-model';

export type ReviewMode = 'unified' | 'split';
// Where the scroller was left (§F, decision 7): the section's file, the diff row at the top edge and the pixels below
// that row's top; with no row there, the offset is from the section's top. A row is its block (the edit's index in
// Last turn, 0 elsewhere), its side and its line (Decision Log 11).
export interface StackPlace {
  path: string;
  row: { block: number; side: 'old' | 'new'; line: number } | null;
  offset: number;
}

export interface ReviewUi {
  session: AppSessionId | null; // the session the scope was decided for (a pinned tool's changes under it)
  directory: string | null; // the working folder it was decided in (UX wave U8c-2: the agent moving starts it over); null until known
  scope: ReviewScope | null; // null until decided: defaultScope once the status (and This branch's availability) is known
  turnId: TurnId | null; // Last turn's turn (a receipt's, or the latest turn with files when the chip is chosen)
  // UX wave U5b-2 (§E): the commit a chip is listed for, set by a request that names one and replaced by another; choosing
  // another chip leaves it listed; `forSession` drops it. Its subject once its read answered (the chip's title).
  commit: { sha: string; subject: string | null } | null;
  hunk: number; // the counter's hunk across the stack, 0-based
  navigate: number; // bumped by ↑ and ↓: the stack scrolls to `hunk` when it changes
  mode: ReviewMode; // the stored choice; a stack too narrow for Split draws Unified without changing it
  viewed: ReadonlyMap<string, ReadonlyMap<string, string>>; // placeKey → path → the hunks' signature when marked
  folds: ReadonlyMap<string, ReadonlyMap<string, FoldChoice>>; // placeKey → path → the person's own choice
  places: ReadonlyMap<string, StackPlace>; // placeKey → where the scroller was left
  reveal: { path: string; n: number } | null; // a request that named a file, until the stack brought it into view (`n` tells two requests apart)
  request: ReviewParams | null; // an open() not yet applied against the shown session
  redecide: { path: string | null } | null; // an open() with no scope: the default decided again, with the path it named
}

export function createReviewUi(init: { session: AppSessionId | null; directory?: string | null; params?: ReviewParams | null; mode?: ReviewMode }): StoreApi<ReviewUi> {
  return createStore<ReviewUi>()(() => ({
    session: init.session,
    directory: init.directory ?? null,
    scope: null,
    turnId: null,
    commit: null,
    hunk: 0,
    navigate: 0,
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
// (UX wave U8c-2, M4 decision 5: the agent moved): its scope is decided again and the counter starts at the first hunk.
// The mode, the viewed marks, the folds and the places (keyed by directory and scope, so a checkout's are found on
// return) stay; a reveal does not outlive the session it was asked for.
export function forSession(session: AppSessionId | null, directory: string | null): Partial<ReviewUi> {
  return { session, directory, scope: null, turnId: null, commit: null, hunk: 0, redecide: null, reveal: null };
}

// A request that names a file: the stack brings that file's section into view and unfolds it (§F).
const revealOf = (ui: ReviewUi, path: string): ReviewUi['reveal'] => ({ path, n: (ui.reveal?.n ?? 0) + 1 });

// An open() (X5 re-targeting): a receipt's `{ scope: 'turn', turnId, path }` chooses the turn and reveals the path; a
// scope with a path chooses both; no scope decides the default again, revealing the path it names, if any.
// UX wave U5b-2 (§E): `{ scope: 'commit', commit, path? }` lists that commit's chip and shows it; a request that names the
// commit Review already shows changes nothing but the file it names, which is brought into view.
export function applyRequest(ui: ReviewUi, params: ReviewParams): Partial<ReviewUi> {
  const next: Partial<ReviewUi> = { request: null };
  if (params.scope === 'turn') {
    if (!params.turnId) return next;
    return { ...next, scope: 'turn', turnId: params.turnId, redecide: null, ...moved(ui, 'turn', params.turnId, params.path) };
  }
  if (params.scope === 'commit') {
    if (!params.commit || !isFullHash(params.commit)) return next;
    const same = ui.commit?.sha === params.commit;
    const commit = same ? ui.commit : { sha: params.commit, subject: null };
    return { ...next, scope: 'commit', commit, redecide: null, ...(same ? moved(ui, 'commit', ui.turnId, params.path) : { hunk: 0, reveal: params.path ? revealOf(ui, params.path) : null }) };
  }
  if (params.scope) return { ...next, scope: params.scope, redecide: null, ...moved(ui, params.scope, ui.turnId, params.path) };
  return { ...next, redecide: { path: params.path ?? null } };
}

function moved(ui: ReviewUi, scope: ReviewScope, turnId: TurnId | null, path: string | undefined): Partial<ReviewUi> {
  const same = ui.scope === scope && ui.turnId === turnId;
  return { ...(same ? {} : { hunk: 0 }), ...(path ? { reveal: revealOf(ui, path) } : {}) };
}

// The default decided (a new tool, a pinned tool's new session), or decided again for an open() with no scope: the
// path that open() named is revealed in whichever scope is decided.
export function decide(ui: ReviewUi, scope: ReviewScope): Partial<ReviewUi> {
  const path = ui.redecide?.path ?? null;
  const reveal = path !== null ? { reveal: revealOf(ui, path) } : {};
  if (ui.scope === scope) return { redecide: null, ...reveal };
  return { scope, redecide: null, hunk: 0, reveal: null, ...reveal };
}

export function selectScope(ui: ReviewUi, scope: ReviewScope): Partial<ReviewUi> {
  if (ui.scope === scope) return {};
  return { scope, hunk: 0, redecide: null, reveal: null };
}

// The Last turn chip (l5-code-12 c): chosen with no turn set, it shows the latest turn whose divider lists files.
export function selectLastTurn(ui: ReviewUi, latest: TurnId | null): Partial<ReviewUi> {
  const turnId = ui.turnId ?? latest;
  if (turnId === null) return {};
  return { ...selectScope(ui, 'turn'), turnId };
}

// The key of a scope's marks, folds and place (§E): the folder and the scope, with the turn for Last turn and the commit's
// hash for the commit's scope, so a commit's are its own (S18). A commit named beside another scope (its chip listed) is not part of that scope's key.
export const placeKey = (directory: string, scope: ReviewScope, turnId: TurnId | null, commit: string | null): string =>
  `${directory}\0${scope}${scope === 'turn' ? `\0${turnId ?? ''}` : ''}${scope === 'commit' ? `\0${commit ?? ''}` : ''}`;

// UX wave U5b-2: the listed commit's subject, once its read answered (the chip's title); another commit's answer is not it.
export function commitSubject(ui: ReviewUi, sha: string, subject: string): Partial<ReviewUi> {
  return ui.commit?.sha === sha && ui.commit.subject !== subject ? { commit: { sha, subject } } : {};
}

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
