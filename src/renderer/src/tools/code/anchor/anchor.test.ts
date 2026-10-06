// The composer seam (E5 execution document, Interfaces *The comment gutter and the anchor seam*): the file-line anchor's
// fields, the registered opener (later registrations win, a disposer restores the one before), and the placeholder
// sheet's dialog when none is registered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@shared/composer/sha256';
import type { AppSessionId } from '@shared/graph/ids';
import { useEditorDialog } from '../editor/EditorDialogs';
import { fileLineAnchor, openCommentComposer, prLineAnchor, registerCommentComposer } from './anchor';

const A = 'app-a' as AppSessionId;

// E6's pr-line anchor (E6 execution document, Design §9; X10). The digests are GitHub's own: `src/index.js`'s from the
// accepted answer of github.com/orgs/community/discussions/43908, `pkg/gui/context/commit_files_context.go`'s from the
// `id` of a line cell on github.com/jesseduffield/lazygit/pull/6042/files (2026-10-06).
describe('pr-line anchor', () => {
  const PR = 'https://github.com/o/r/pull/7';

  it('names a PR line as X10’s pr-line anchor, its locator the files page’s own line address', () => {
    expect(prLineAnchor({ prUrl: PR, prNumber: 7, path: 'src/index.js', line: 42, side: 'new' })).toEqual({
      kind: 'pr-line',
      locator: `${PR}/files#diff-bfe9874d239014961b1ae4e89875a6155667db834a410aaaa2ebe3cf89820556R42`,
      label: 'src/index.js:42 · PR #7',
      pageUrl: `${PR}/files`,
      path: 'src/index.js',
      line: 42,
      side: 'new',
      prNumber: 7,
    });
  });

  it('addresses the old side with L and the new side with R', () => {
    const at = (side: 'old' | 'new') => prLineAnchor({ prUrl: PR, prNumber: 7, path: 'pkg/gui/context/commit_files_context.go', line: 3, side }).locator;
    expect(at('old')).toBe(`${PR}/files#diff-e9f2ad71825188a9316dbf6f045381b432b66e89bb961d3cc874cc297359eb45L3`);
    expect(at('new')).toBe(`${PR}/files#diff-e9f2ad71825188a9316dbf6f045381b432b66e89bb961d3cc874cc297359eb45R3`);
  });

  it('carries exactly X10’s fields for a pr-line, every one present', () => {
    const anchor = prLineAnchor({ prUrl: PR, prNumber: 7, path: 'a.ts', line: 1, side: 'old' });
    expect(Object.keys(anchor).sort()).toEqual(['kind', 'label', 'line', 'locator', 'pageUrl', 'path', 'prNumber', 'side']);
  });

  // E3's planned AnchorSchema: a label of at most 200 characters with no control characters.
  it('shows a control character in the path as U+FFFD in the label only', () => {
    const path = 'odd\nname\t.ts';
    const anchor = prLineAnchor({ prUrl: PR, prNumber: 7, path, line: 2, side: 'new' });
    expect(anchor.label).toBe('odd�name�.ts:2 · PR #7');
    expect(anchor.path).toBe(path);
  });

  it('elides a long path from its start so the label fits 200 characters and keeps the basename, line and PR number', () => {
    const path = `${'deep/'.repeat(60)}file.ts`;
    const anchor = prLineAnchor({ prUrl: PR, prNumber: 1234, path, line: 9876, side: 'new' });
    expect(anchor.label).toHaveLength(200);
    expect(anchor.label.startsWith('…')).toBe(true);
    expect(anchor.label.endsWith('/deep/file.ts:9876 · PR #1234')).toBe(true);
    expect(anchor.path).toBe(path);
    expect(anchor.locator).toBe(`${PR}/files#diff-${sha256Hex(path)}R9876`);
  });

  it('never leaves half a surrogate pair at the elision', () => {
    const tail = ':1 · PR #7';
    const path = `${'😀'.repeat(150)}`; // 300 UTF-16 code units
    const { label } = prLineAnchor({ prUrl: PR, prNumber: 7, path, line: 1, side: 'new' });
    expect(label.length).toBeLessThanOrEqual(200);
    expect(label.endsWith(tail)).toBe(true);
    expect(label.slice(1, -tail.length)).toBe('😀'.repeat((label.length - 1 - tail.length) / 2));
  });
});

describe('comment composer seam', () => {
  const offs: (() => void)[] = [];
  beforeEach(() => useEditorDialog.setState({ open: null }));
  afterEach(() => offs.splice(0).forEach((off) => off()));

  it('names a file’s line as X10’s file-line anchor', () => {
    expect(fileLineAnchor('/r/src/app.ts', 7)).toEqual({ kind: 'file-line', locator: '/r/src/app.ts#L7', label: 'app.ts:7', path: '/r/src/app.ts', line: 7 });
  });

  it('opens the latest registered composer, and the one before once it is disposed', () => {
    const first = vi.fn();
    const second = vi.fn();
    offs.push(registerCommentComposer(first));
    const offSecond = registerCommentComposer(second);
    const anchor = fileLineAnchor('/r/app.ts', 3);
    openCommentComposer(anchor, { appSessionId: A });
    expect(second).toHaveBeenCalledWith(anchor, { appSessionId: A });
    expect(first).not.toHaveBeenCalled();
    offSecond();
    offSecond(); // a second dispose changes nothing
    openCommentComposer(anchor, { appSessionId: A });
    expect(first).toHaveBeenCalledWith(anchor, { appSessionId: A });
    expect(useEditorDialog.getState().open).toBeNull();
  });

  it('opens the placeholder sheet when no composer is registered', () => {
    const anchor = fileLineAnchor('/r/app.ts', 3);
    openCommentComposer(anchor, { appSessionId: A });
    expect(useEditorDialog.getState().open).toEqual({ kind: 'anchor', anchor, appSessionId: A });
  });
});
