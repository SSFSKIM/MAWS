// The Source control tool's view state (E6 execution document, Design §5): pure transitions over a store handle.
import { describe, expect, it } from 'vitest';
import type { GitFileStatus } from '@shared/ipc/schema/git';
import { A, B, DIR, statusOf } from '../../test-support/scm';
import { groupsOf } from './groups';
import { applyRequest, createScmUi, followSelection, forSession, relativeTarget, selectFile, selectionKey, toggleCollapsed } from './view-state';

const file = (path: string, index: string, worktree: string): GitFileStatus => ({ path, oldPath: null, index, worktree, untracked: false });
const untracked = (path: string): GitFileStatus => ({ path, oldPath: null, index: '?', worktree: '?', untracked: true });

describe('source control view state', () => {
  it('starts empty, unified, with the open() params waiting as the request', () => {
    const ui = createScmUi({ session: A, params: { target: 'src/app.ts' } }).getState();
    expect(ui).toMatchObject({
      session: A,
      selected: null,
      hunk: 0,
      scrollTop: 0,
      mode: 'unified',
      message: '',
      noVerify: false,
      sheet: null,
      lastCommit: null,
      notice: null,
      request: { target: 'src/app.ts' },
    });
    expect(ui.collapsed.size).toBe(0);
    expect(createScmUi({ session: null }).getState().request).toBeNull();
  });

  it('starts over for another session under a pin, keeping each session’s commit draft', () => {
    const store = createScmUi({ session: A });
    store.setState({
      message: 'Fix the parser',
      noVerify: true,
      selected: { group: 'staged', path: 'a.ts' },
      hunk: 2,
      scrollTop: 40,
      mode: 'split',
      collapsed: new Set(['untracked'] as const),
      sheet: { kind: 'push' },
      lastCommit: { sha: 'abc', subject: 'x' },
      notice: { kind: 'git_failed', text: 'hook failed', output: 'nope' },
    });
    store.setState(forSession(store.getState(), B));
    expect(store.getState()).toMatchObject({
      session: B,
      message: '',
      noVerify: false,
      selected: null,
      hunk: 0,
      scrollTop: 0,
      sheet: null,
      lastCommit: null,
      notice: null,
      mode: 'split', // the tool's, not the session's
    });
    expect([...store.getState().collapsed]).toEqual(['untracked']);
    store.setState({ message: 'B’s draft' });
    store.setState(forSession(store.getState(), A));
    expect(store.getState()).toMatchObject({ session: A, message: 'Fix the parser', noVerify: true });
    store.setState(forSession(store.getState(), B));
    expect(store.getState()).toMatchObject({ session: B, message: 'B’s draft', noVerify: false });
  });

  it('answers no change for the session it already shows', () => {
    const store = createScmUi({ session: A });
    store.setState({ message: 'Fix', selected: { group: 'staged', path: 'a.ts' }, notice: { kind: 'changed', text: '', output: '' } });
    expect(forSession(store.getState(), A)).toEqual({});
  });

  it('forgets an empty draft rather than keeping it per session', () => {
    const store = createScmUi({ session: A });
    store.setState(forSession(store.getState(), B));
    expect(store.getState().drafts.size).toBe(0);
  });

  it('makes a target relative: a repository-relative path as it is, an absolute one under the root or the checkout', () => {
    expect(relativeTarget('src/app.ts', { repoRoot: DIR, directory: '/tmp/repo' })).toBe('src/app.ts');
    expect(relativeTarget(`${DIR}/src/app.ts`, { repoRoot: DIR, directory: '/tmp/repo' })).toBe('src/app.ts');
    expect(relativeTarget('/tmp/repo/src/app.ts', { repoRoot: DIR, directory: '/tmp/repo/' })).toBe('src/app.ts');
    expect(relativeTarget('/elsewhere/app.ts', { repoRoot: DIR, directory: '/tmp/repo' })).toBeNull();
    expect(relativeTarget(DIR, { repoRoot: DIR, directory: DIR })).toBeNull();
    expect(relativeTarget('', { repoRoot: DIR, directory: DIR })).toBeNull();
  });

  it('applies an open() with a target once the status is known, selecting it in whichever group lists it, Staged first', () => {
    const status = statusOf({ files: [file('src/app.ts', 'M', 'M'), untracked('notes.md')] });
    const store = createScmUi({ session: A, params: { target: `${DIR}/src/app.ts` } });
    expect(applyRequest(store.getState(), null, DIR)).toEqual({}); // waits for the status
    store.setState({ hunk: 3, scrollTop: 90, collapsed: new Set(['staged'] as const) });
    store.setState(applyRequest(store.getState(), status, DIR));
    expect(store.getState()).toMatchObject({ request: null, selected: { group: 'staged', path: 'src/app.ts' }, hunk: 0, scrollTop: 0 });
    expect(store.getState().collapsed.has('staged')).toBe(false); // the group opens to show it

    store.setState({ request: { target: 'notes.md' } });
    store.setState(applyRequest(store.getState(), status, DIR));
    expect(store.getState().selected).toEqual({ group: 'untracked', path: 'notes.md' });
  });

  it('consumes an open() whose target git does not list, or with no target, keeping the selection', () => {
    const status = statusOf({ files: [file('src/app.ts', '.', 'M')] });
    const store = createScmUi({ session: A });
    store.setState({ selected: { group: 'unstaged', path: 'src/app.ts' }, request: { target: 'clean.ts' } });
    store.setState(applyRequest(store.getState(), status, DIR));
    expect(store.getState()).toMatchObject({ request: null, selected: { group: 'unstaged', path: 'src/app.ts' } });
    store.setState({ request: {} });
    store.setState(applyRequest(store.getState(), null, DIR)); // no target: nothing to wait for
    expect(store.getState()).toMatchObject({ request: null, selected: { group: 'unstaged', path: 'src/app.ts' } });
  });

  it('selects a file, keys it by group and path, and collapses a group', () => {
    const store = createScmUi({ session: A });
    store.setState({ hunk: 4, scrollTop: 10 });
    store.setState(selectFile({ group: 'unstaged', path: 'a.ts' }));
    expect(store.getState()).toMatchObject({ selected: { group: 'unstaged', path: 'a.ts' }, hunk: 0, scrollTop: 0 });
    expect(selectionKey({ group: 'unstaged', path: 'a.ts' })).toBe('unstaged\0a.ts');
    expect(selectionKey({ group: 'staged', path: 'a.ts' })).not.toBe(selectionKey({ group: 'unstaged', path: 'a.ts' }));
    store.setState(toggleCollapsed(store.getState(), 'untracked'));
    expect(store.getState().collapsed.has('untracked')).toBe(true);
    store.setState(toggleCollapsed(store.getState(), 'untracked'));
    expect(store.getState().collapsed.has('untracked')).toBe(false);
  });

  it('follows a staged or unstaged file to the group that lists it next, and drops one git no longer lists', () => {
    const staged = groupsOf(statusOf({ files: [file('a.ts', 'M', '.')] }));
    const unstaged = groupsOf(statusOf({ files: [file('a.ts', '.', 'M')] }));
    const both = groupsOf(statusOf({ files: [file('a.ts', 'M', 'M')] }));
    const store = createScmUi({ session: A });
    store.setState({ selected: { group: 'unstaged', path: 'a.ts' }, hunk: 2 });
    expect(followSelection(store.getState(), both)).toEqual({}); // still listed where it was
    store.setState(followSelection(store.getState(), staged)); // Stage moved it
    expect(store.getState()).toMatchObject({ selected: { group: 'staged', path: 'a.ts' }, hunk: 0, scrollTop: 0 });
    store.setState(followSelection(store.getState(), unstaged)); // Unstage moved it back
    expect(store.getState().selected).toEqual({ group: 'unstaged', path: 'a.ts' });
    store.setState(followSelection(store.getState(), groupsOf(statusOf())));
    expect(store.getState().selected).toBeNull(); // committed or discarded
    expect(followSelection(store.getState(), staged)).toEqual({});
  });
});
