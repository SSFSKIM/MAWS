// The Source control tool's view state (E6 execution document, Design §5): the X5 state is this zustand store handle,
// never fields read off a mutable object (C8a's React Compiler rule). The selection, the diff body's place, the
// collapsed groups, the commit draft and Skip hooks, the open sheet, the last commit and the last refusal or error.
// The commit draft is kept per session, so a pinned tool shown for another session and back finds it again; it is
// gone at restart (a draft commit message is not worth a persisted file). Pure transitions only; the body applies
// them, and the store's mutation actions write the notice and the last commit.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmRefusalCode } from '@shared/ipc/schema/scm';
import { findTarget, groupsOf, isListed, type ScmGroupName, type ScmGroups, type ScmSelection } from './groups';

// The tool's params (X5): the file to select, repository-relative or absolute inside the checkout. E1's
// `show_pane { pane: 'source-control', target }` passes `{ target }` through unchanged.
export interface ScmParams {
  target?: string;
}

export type ScmMode = 'unified' | 'split';
export type ScmSheet = null | { kind: 'discard'; entries: { path: string; group: 'unstaged' | 'untracked' }[] } | { kind: 'push' } | { kind: 'pr' };
// The last refusal (its code, main's detail and what git printed) or a failed call (`error`, the envelope's message).
export interface ScmNotice {
  kind: ScmRefusalCode | 'error';
  text: string;
  output: string;
}
export interface ScmDraft {
  message: string;
  noVerify: boolean;
}

export interface ScmUi {
  session: AppSessionId | null; // the session the state below is for (a pinned tool's changes under it)
  selected: ScmSelection | null;
  hunk: number; // the selected file's current hunk, 0-based
  navigate: number; // bumped by the hunk buttons: the body scrolls to `hunk` when it changes
  scrollTop: number; // the diff body's
  mode: ScmMode;
  collapsed: ReadonlySet<ScmGroupName>;
  message: string; // the commit draft of `session`
  noVerify: boolean; // Skip hooks, for the next commit of `session`
  drafts: ReadonlyMap<AppSessionId, ScmDraft>; // the other sessions' drafts, while a pinned tool shows this one
  sheet: ScmSheet;
  lastCommit: { sha: string; subject: string } | null;
  notice: ScmNotice | null;
  request: ScmParams | null; // an open() not yet applied against the shown session's status
}

export function createScmUi(init: { session: AppSessionId | null; params?: ScmParams | null; mode?: ScmMode }): StoreApi<ScmUi> {
  return createStore<ScmUi>()(() => ({
    session: init.session,
    selected: null,
    hunk: 0,
    navigate: 0,
    scrollTop: 0,
    mode: init.mode ?? 'unified',
    collapsed: new Set(),
    message: '',
    noVerify: false,
    drafts: new Map(),
    sheet: null,
    lastCommit: null,
    notice: null,
    request: init.params ?? null,
  }));
}

// A pinned tool shown for another session starts over there, as Review does: the selection, the sheet, the last commit
// and the notice were the other checkout's. The draft is put aside for the session it was written in and the new
// session's own draft comes back; the mode and the collapsed groups are the tool's.
export function forSession(ui: ScmUi, session: AppSessionId | null): Partial<ScmUi> {
  if (ui.session === session) return {};
  const drafts = new Map(ui.drafts);
  if (ui.session !== null) {
    if (ui.message !== '' || ui.noVerify) drafts.set(ui.session, { message: ui.message, noVerify: ui.noVerify });
    else drafts.delete(ui.session);
  }
  const draft = session !== null ? drafts.get(session) : undefined;
  if (session !== null) drafts.delete(session);
  return {
    session,
    selected: null,
    hunk: 0,
    scrollTop: 0,
    sheet: null,
    lastCommit: null,
    notice: null,
    message: draft?.message ?? '',
    noVerify: draft?.noVerify ?? false,
    drafts,
  };
}

const trimSlash = (path: string) => path.replace(/\/+$/, '');

// A target as the repository-relative path git lists: a relative one as it is; an absolute one under the repository's
// root (git's spelling) or, failing that, under the session's checkout (the record's spelling, which may differ: a
// `/tmp` checkout whose root git reports as `/private/tmp`); null for anything else.
export function relativeTarget(target: string, where: { repoRoot: string; directory: string }): string | null {
  if (target === '') return null;
  if (!target.startsWith('/')) return target;
  for (const root of [trimSlash(where.repoRoot), trimSlash(where.directory)]) {
    if (target.startsWith(`${root}/`) && target.length > root.length + 1) return target.slice(root.length + 1);
  }
  return null;
}

// An open() (X5 re-targeting): `{ target }` selects the file in whichever group lists it, Staged first, once the
// status is known; a target git does not list (or no target) is consumed and the selection kept.
export function applyRequest(ui: ScmUi, status: GitStatus | null, directory: string): Partial<ScmUi> {
  const target = ui.request?.target;
  if (target === undefined) return ui.request === null ? {} : { request: null };
  if (status === null) return {};
  const path = relativeTarget(target, { repoRoot: status.repoRoot, directory });
  const found = path === null ? null : findTarget(groupsOf(status), path);
  if (!found) return { request: null };
  return { request: null, ...selectFile(found), ...(ui.collapsed.has(found.group) ? { collapsed: without(ui.collapsed, found.group) } : {}) };
}

export function selectFile(selection: ScmSelection): Partial<ScmUi> {
  return { selected: selection, hunk: 0, scrollTop: 0 };
}

// The selected row and the diff body are keyed by group and path, so the same file in Staged and in Unstaged is two
// rows with two diff bodies.
export const selectionKey = (selection: ScmSelection) => `${selection.group}\0${selection.path}`;

// A new status: a selection its group no longer lists follows the file to the group that lists it now (Stage moves it
// to Staged, Unstage back), or is dropped once git lists it nowhere (committed, discarded).
export function followSelection(ui: ScmUi, groups: ScmGroups): Partial<ScmUi> {
  if (ui.selected === null || isListed(groups, ui.selected)) return {};
  const found = findTarget(groups, ui.selected.path);
  return found ? selectFile(found) : { selected: null, hunk: 0, scrollTop: 0 };
}

export function toggleCollapsed(ui: ScmUi, group: ScmGroupName): Partial<ScmUi> {
  return { collapsed: ui.collapsed.has(group) ? without(ui.collapsed, group) : new Set(ui.collapsed).add(group) };
}

function without<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  next.delete(value);
  return next;
}
