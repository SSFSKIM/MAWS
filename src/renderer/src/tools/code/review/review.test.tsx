// Review (C8c execution document, M3): the patch split per file, the pure model (scopes, the ref grammar, the first
// changed line, the caps, the file lists), and the tool over C8a's host with a fake X2 client and a seeded transcript
// store; from UX wave U5b's M3 the tool and the diff tab are one stack of sections.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { GitCommit, GitDiffFile, GitStatus } from '@shared/ipc/schema/git';
import { record } from '../../../../../../test/support/builders';
import { loadSyntheticJournal } from '../../../../../../test/support/fixtures';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { createClient } from '../../../ipc/client';
import { checkoutKey } from '../../../ipc/machine';
import { connectPanelEvents } from '../../../ipc/events';
import { panelHost, registerPanelTool } from '../../../panel/host';
import { filesTool } from '../files/FilesTool'; // UX wave U6b-1
import { FloatingSummary } from '../../../panel/summary/Summary';
import { queryClient } from '../../../ipc/query';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { useMachines } from '../../../stores/machines'; // UX wave U5b-2: a machine that serves the reads
import { deferred, fail, installFakeMain, ok } from '../../../test-support/code';
import { installResizeObserver } from '../../../test-support/resize';
import { fakeStackLayout } from '../../../test-support/review-layout';
import { A, B, panelOf, resetPanelStores, TestHost } from '../../../test-support/panel';
import { useTranscriptStore, type Row, type TranscriptSource, type TurnActivity, type TurnId } from '../../../transcript';
import { journalToEvents } from '../../../transcript/dev/journal';
import { api, builder, parent, task, tool, uuid } from '../../../transcript/model/test-events';
import { codeProbes } from '../../../harness/code/codeProbes';
import { codeTranscriptActions } from '../open-file';
import { useViewer } from '../viewer/viewer-store';
import { DiffTab, resetDiffTabs } from './DiffTab';
import { reviewLayout, SPLIT_MIN_WIDTH } from './measure';
import { createReviewStore, diffOf, fileDiffOf, onHeadOf, REVIEW_REFRESH_MS, useReview, useReviewData, type DiffTarget } from './review-store';
import { reviewTool } from './ReviewTool';
import { useBranchReads } from './branch-read';
import type { ReviewParams } from './review-model';
import {
  REVIEW_SCOPE_BYTES_CAP,
  defaultScope,
  diffViewHunks,
  firstChangedLine,
  formatRef,
  gitScopeFiles,
  hunksSignature,
  hunkText,
  indexDiffers,
  parseRef,
  REVIEW_FILE_BYTES_CAP,
  REVIEW_FILE_LINES_CAP,
  splitPatch,
  tooLarge,
  totals,
  turnScopeFiles,
  latestTurnWithFiles,
  uncountedFiles,
  unmerged,
  type ChangedFile,
} from './review-model';
import { currentSet } from '../../../stores/layout-model';

// The highlighter would load shiki's grammars; the diff paints plain until it is ready, which here is never.
vi.mock('@git-diff-view/shiki', () => ({ getDiffViewHighlighter: () => new Promise(() => {}) }));

const THREE_FILES = readFileSync(resolve(__dirname, '../../../../../../test/fixtures/git/three-files.patch'), 'utf8');
const T = 'turn:6f1c2e0a-0000-4000-8000-000000000001' as TurnId;

export function statusOf(over: Partial<GitStatus> = {}): GitStatus {
  return {
    repoRoot: '/repo',
    gitDir: '/repo/.git',
    commonDir: '/repo/.git',
    isWorktree: false,
    branch: 'main',
    head: '0123456789abcdef',
    upstream: null,
    remoteUrl: null,
    ahead: 0,
    behind: 0,
    dirty: false,
    files: [],
    stashCount: 0,
    checkedAt: '2026-09-29T10:00:00.000Z',
    ...over,
  };
}

describe('patch splitting', () => {
  it('splits the three-file patch: the binary with no hunks, the ten-hunk file, the rename with its old path', () => {
    const files = splitPatch(THREE_FILES);
    expect(files.map((f) => [f.path, f.oldPath, f.kind, f.hunks.length])).toEqual([
      ['assets/logo.png', null, 'binary', 0],
      ['src/big.ts', null, 'modified', 10],
      ['src/math-helpers.ts', 'src/helpers.ts', 'renamed', 1],
    ]);
    for (const file of files) for (const hunk of file.hunks) expect(hunk.startsWith('@@')).toBe(true);
    const lastLine = THREE_FILES.trimEnd().split('\n').at(-1)!;
    expect(files[2].hunks[0].split('\n').at(-1)).toBe(lastLine);
    expect(files[1].hunks[0].split('\n')).toHaveLength(9); // the header and eight lines, nothing of the next hunk
    expect(files[1].header).toBe('diff --git a/src/big.ts b/src/big.ts\nindex 858a0a6..4a55494 100644\n--- a/src/big.ts\n+++ b/src/big.ts');
  });

  it.each([
    ['my notes.md', 'my notes.md'],
    ['my notes.md ', 'my notes.md '],
    ['tab\tname.md', '"tab\\tname.md"'],
  ])('joins the patch for %s to numstat without the tab delimiter', (path, encoded) => {
    const prefixed = (prefix: string) => encoded.startsWith('"') ? `"${prefix}/${encoded.slice(1)}` : `${prefix}/${encoded}`;
    const patch = `diff --git ${prefixed('a')} ${prefixed('b')}\n--- ${prefixed('a')}\t\n+++ ${prefixed('b')}\t\n@@ -1 +1 @@\n-old\n+new\n`;
    const rows = gitScopeFiles({ scope: 'uncommitted', repoRoot: '/repo', status: null,
      files: [{ path, oldPath: null, insertions: 1, deletions: 1, binary: false }],
      patch: new Map(splitPatch(patch).map((file) => [file.path, file])),
    });
    expect(rows[0].hunks).toEqual(['@@ -1 +1 @@\n-old\n+new']);
  });

  it('reads a new and a deleted file', () => {
    const patch = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..3b18e51',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1 @@',
      '+hello',
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      'index 3b18e51..0000000',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-a',
      '-b',
      '',
    ].join('\n');
    expect(splitPatch(patch).map((f) => [f.path, f.oldPath, f.kind, f.hunks])).toEqual([
      ['src/new.ts', null, 'added', ['@@ -0,0 +1 @@\n+hello']],
      ['old.ts', null, 'deleted', ['@@ -1,2 +0,0 @@\n-a\n-b']],
    ]);
  });

  it('unquotes git’s C-style paths: a space, a UTF-8 octal escape and a quote', () => {
    const patch = [
      'diff --git "a/docs/my notes \\303\\251t\\303\\251.md" "b/docs/my notes \\303\\251t\\303\\251.md"',
      'index 1..2 100644',
      '--- "a/docs/my notes \\303\\251t\\303\\251.md"',
      '+++ "b/docs/my notes \\303\\251t\\303\\251.md"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git "a/say \\"hi\\".txt" "b/say \\"hi\\".txt"',
      'new file mode 100644',
      '--- /dev/null',
      '+++ "b/say \\"hi\\".txt"',
      '@@ -0,0 +1 @@',
      '+hi',
    ].join('\n');
    expect(splitPatch(patch).map((f) => f.path)).toEqual(['docs/my notes été.md', 'say "hi".txt']);
  });

  it('reads an unquoted path with spaces from equal halves, and a rename of one from its rename lines', () => {
    const patch = [
      'diff --git a/a b/c.ts a/a b/c.ts',
      'index 1..2 100644',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      'diff --git a/one two.ts b/three four.ts',
      'similarity index 100%',
      'rename from one two.ts',
      'rename to three four.ts',
    ].join('\n');
    expect(splitPatch(patch).map((f) => [f.path, f.oldPath, f.kind, f.hunks.length])).toEqual([
      ['a b/c.ts', null, 'modified', 1],
      ['three four.ts', 'one two.ts', 'renamed', 0],
    ]);
  });

  it('answers nothing for an empty patch', () => {
    expect(splitPatch('')).toEqual([]);
  });
});

describe('review model', () => {
  it('defaults to Uncommitted on a dirty tree, This branch on a clean one when it is available, else Uncommitted', () => {
    expect(defaultScope(statusOf({ dirty: true }), true)).toBe('uncommitted');
    expect(defaultScope(statusOf({ dirty: false }), true)).toBe('branch');
    expect(defaultScope(statusOf({ dirty: false }), false)).toBe('uncommitted');
    expect(defaultScope(null, true)).toBe('uncommitted');
  });

  it('formats and parses refs, a TurnId being its own scope word and a path free to hold " @ "', () => {
    expect(formatRef('uncommitted')).toBe('uncommitted');
    expect(formatRef('uncommitted', 'src/app.ts')).toBe('uncommitted @ src/app.ts');
    expect(parseRef('uncommitted @ src/app.ts')).toEqual({ scope: 'uncommitted', turnId: null, commit: null, path: 'src/app.ts' });
    expect(parseRef('staged')).toEqual({ scope: 'staged', turnId: null, commit: null, path: null });
    expect(parseRef(formatRef('branch'))).toEqual({ scope: 'branch', turnId: null, commit: null, path: null });
    expect(parseRef(formatRef(T, 'a @ b.ts'))).toEqual({ scope: 'turn', turnId: T, commit: null, path: 'a @ b.ts' });
    expect(parseRef(formatRef(T))).toEqual({ scope: 'turn', turnId: T, commit: null, path: null });
    for (const bad of ['', 'turn', 'turn:', 'everything', 'uncommitted @ ', 'Uncommitted']) expect(parseRef(bad), bad).toBeNull();
  });

  // UX wave U5b-2 (S20's grammar): `commit:<whole hash>`, with ` @ <path>` as for the others; a hash that is not whole is refused
  it('reads commit:<full hash> and commit:<full hash> @ <path>, and refuses a short, upper-case or missing hash', () => {
    const SHA = '3f9a1c27b84e5d60a1f2c3b4d5e6f708192a3b4c';
    const SHA256 = `${SHA}${'0'.repeat(24)}`;
    expect(formatRef(`commit:${SHA}`, 'src/app.ts')).toBe(`commit:${SHA} @ src/app.ts`);
    expect(parseRef(`commit:${SHA}`)).toEqual({ scope: 'commit', turnId: null, commit: SHA, path: null });
    expect(parseRef(formatRef(`commit:${SHA}`, 'a @ b.ts'))).toEqual({ scope: 'commit', turnId: null, commit: SHA, path: 'a @ b.ts' });
    expect(parseRef(`commit:${SHA256}`)).toEqual({ scope: 'commit', turnId: null, commit: SHA256, path: null });
    for (const bad of ['commit', 'commit:', `commit:${SHA.slice(0, 7)}`, `commit:${SHA.slice(1)}`, `commit:${SHA.toUpperCase()}`, `commit:${SHA} @ `]) expect(parseRef(bad), bad).toBeNull();
  });

  it('opens a hunk at its first added line in the new file, a pure deletion at its new start', () => {
    expect(firstChangedLine('@@ -10,3 +10,5 @@\n a\n+b\n+c\n d\n e')).toBe(11); // a modification
    expect(firstChangedLine('@@ -4,6 +4,7 @@ fn()\n a\n b\n c\n+d\n e\n f\n g')).toBe(7); // an insertion
    expect(firstChangedLine('@@ -10,2 +10,0 @@\n-a\n-b')).toBe(10); // a pure deletion
    expect(firstChangedLine('@@ -3,3 +3,3 @@\n a\n-b\n+c\n d')).toBe(4); // a replacement: the added line
    expect(firstChangedLine('@@ -1,2 +0,0 @@\n-a\n-b')).toBe(1); // the whole file deleted
    expect(firstChangedLine('@@ -0,0 +1 @@\n+a')).toBe(1);
  });

  it('calls a file too large past the changed-lines cap or the bytes cap, and not at them', () => {
    const lines = (n: number) => `@@ -1,0 +1,${n} @@\n${'+x\n'.repeat(n).slice(0, -1)}`;
    expect(tooLarge({ hunks: [lines(REVIEW_FILE_LINES_CAP)] })).toBe(false);
    expect(tooLarge({ hunks: [lines(REVIEW_FILE_LINES_CAP + 1)] })).toBe(true);
    expect(tooLarge({ hunks: [lines(1000), lines(1001)] })).toBe(true); // summed across hunks
    const wide = `@@ -1,0 +1,1 @@\n+${'x'.repeat(REVIEW_FILE_BYTES_CAP)}`;
    expect(tooLarge({ hunks: [wide] })).toBe(true);
    expect(tooLarge({ hunks: [] })).toBe(false);
  });

  it('prints C6’s hunks as git would, and feeds DiffView one string per file with its header and a trailing newline', () => {
    expect(hunkText({ oldStart: 1, oldLines: 0, newStart: 1, newLines: 2, lines: ['+a', '+b'] })).toBe('@@ -1,0 +1,2 @@\n+a\n+b');
    expect(diffViewHunks({ path: 'src/b.ts', oldPath: 'src/a.ts', hunks: ['@@ -1 +1 @@\n-a\n+b', '@@ -9 +9 @@\n-c\n+d'] })).toEqual([
      '--- a/src/a.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d\n',
    ]);
  });

  it('prints an unprefixed hunk line as a context line, as C6’s edit detail reads it (M4)', () => {
    expect(hunkText({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: ['import x', '', '-a', '+b', '\\ No newline at end of file'] })).toBe(
      '@@ -1,3 +1,3 @@\n import x\n \n-a\n+b\n\\ No newline at end of file',
    );
  });

  it('signs hunks so a changed hunk text changes the signature', () => {
    expect(hunksSignature(['@@ -1 +1 @@\n-a\n+b'])).toBe(hunksSignature(['@@ -1 +1 @@\n-a\n+b']));
    expect(hunksSignature(['@@ -1 +1 @@\n-a\n+b'])).not.toBe(hunksSignature(['@@ -1 +1 @@\n-a\n+c']));
    expect(hunksSignature(['ab', 'c'])).not.toBe(hunksSignature(['a', 'bc']));
  });

  it('lists a git scope’s files with counts and kinds, the untracked files under Uncommitted only', () => {
    const patch = new Map(splitPatch(THREE_FILES).map((file) => [file.path, file]));
    const files = [
      { path: 'assets/logo.png', oldPath: null, insertions: 0, deletions: 0, binary: true },
      { path: 'src/big.ts', oldPath: null, insertions: 10, deletions: 9, binary: false },
      { path: 'src/math-helpers.ts', oldPath: 'src/helpers.ts', insertions: 1, deletions: 1, binary: false },
    ];
    const status = statusOf({ dirty: true, files: [{ path: 'scratch.txt', oldPath: null, index: '?', worktree: '?', untracked: true }] });
    const rows = gitScopeFiles({ scope: 'uncommitted', repoRoot: '/repo', files, patch, status });
    expect(rows.map((r) => [r.path, r.kind, r.added, r.removed, r.hunks?.length ?? null, r.openPath])).toEqual([
      ['assets/logo.png', 'binary', 0, 0, null, '/repo/assets/logo.png'],
      ['src/big.ts', 'modified', 10, 9, 10, '/repo/src/big.ts'],
      ['src/math-helpers.ts', 'renamed', 1, 1, 1, '/repo/src/math-helpers.ts'],
      ['scratch.txt', 'untracked', 0, 0, null, '/repo/scratch.txt'],
    ]);
    expect(rows[2].oldPath).toBe('src/helpers.ts');
    expect(rows.map((r) => r.blocks)).toEqual([[], [10], [1], []]); // a git scope's file is one block
    expect(rows[0].header).toContain('Binary files'); // a binary is signed over its header
    expect(totals(rows)).toEqual({ files: 4, added: 11, removed: 10 });
    expect(gitScopeFiles({ scope: 'staged', repoRoot: '/repo', files, patch, status }).map((r) => r.path)).not.toContain('scratch.txt');
    // past the scope cap: the list without hunks until each file is fetched
    expect(gitScopeFiles({ scope: 'staged', repoRoot: '/repo', files, patch: null, status }).map((r) => r.hunks)).toEqual([null, null, null]);
  });

  // UX wave U5b-2 (l5-code-03, -04; §E): This branch lists the new files too, and a new file's lines are its count from
  // the working-tree read; one it did not count, or every one where it was not asked, is uncounted
  it('counts a new file’s lines from the working-tree read, in Uncommitted and in This branch, and none in a commit or Staged', () => {
    const status = statusOf({
      dirty: true,
      files: [
        { path: 'notes/berths.md', oldPath: null, index: '?', worktree: '?', untracked: true },
        { path: 'logo.png', oldPath: null, index: '?', worktree: '?', untracked: true },
        { path: 'later.md', oldPath: null, index: '?', worktree: '?', untracked: true },
        { path: 'drafts/', oldPath: null, index: '?', worktree: '?', untracked: true },
      ],
    });
    const untracked = new Map([
      ['notes/berths.md', { path: 'notes/berths.md', insertions: 12, binary: false }],
      ['logo.png', { path: 'logo.png', insertions: null, binary: true }],
    ]);
    for (const scope of ['uncommitted', 'branch'] as const) {
      const rows = gitScopeFiles({ scope, repoRoot: '/repo', files: APP_FILES, patch: null, status, untracked });
      expect(rows.map((r) => [r.path, r.kind, r.added, r.uncounted ?? false])).toEqual([
        ['src/app.ts', 'modified', 2, false],
        ['notes/berths.md', 'untracked', 12, false],
        ['logo.png', 'untracked', 0, true], // binary: no count
        ['later.md', 'untracked', 0, true], // past the count's files
        ['drafts/', 'untracked', 0, true], // a new folder is listed, not counted
      ]);
      expect(totals(rows)).toEqual({ files: 5, added: 14, removed: 0 });
      expect(uncountedFiles(rows)).toBe(2); // the folder is not a file
    }
    expect(uncountedFiles(gitScopeFiles({ scope: 'uncommitted', repoRoot: '/repo', files: [], patch: null, status, untracked: null }))).toBe(3); // not asked: every new file
    expect(gitScopeFiles({ scope: 'commit', repoRoot: '/repo', files: APP_FILES, patch: null, status, untracked }).map((r) => r.path)).toEqual(['src/app.ts']);
    expect(gitScopeFiles({ scope: 'staged', repoRoot: '/repo', files: APP_FILES, patch: null, status, untracked }).map((r) => r.path)).toEqual(['src/app.ts']);
  });

  it('lists Last turn from changed files, each file’s hunks from its edited entries joined on the edit’s own path', () => {
    const changedFiles: ChangedFile[] = [
      { path: '/p/a.ts', change: 'update', added: 3, removed: 1, cellId: 'c1' as ChangedFile['cellId'] },
      { path: '/p/new.ts', change: 'create', added: 1, removed: 0, cellId: 'c2' as ChangedFile['cellId'] },
      { path: '/p/gone.ts', change: 'delete', added: 0, removed: 2, cellId: 'c3' as ChangedFile['cellId'] },
    ];
    const edit = (filePath: string, lines: string[]) => ({ kind: 'edit' as const, filePath, change: 'update' as const, added: 0, removed: 0, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: lines.length, lines }] });
    const activity = {
      files: [
        { path: 'a.ts', use: 'edited', at: '', edit: edit('/p/a.ts', ['-x', '+y']) }, // `path` is the input's, the join is on filePath
        { path: '/p/a.ts', use: 'read', at: '', edit: null },
        { path: '/p/a.ts', use: 'edited', at: '', edit: edit('/p/a.ts', ['+z', '+w']) },
        { path: '/p/new.ts', use: 'edited', at: '', edit: edit('/p/new.ts', ['+n']) },
      ],
    } as unknown as TurnActivity;
    const rows = turnScopeFiles(changedFiles, activity);
    expect(rows.map((r) => [r.path, r.kind, r.added, r.removed, r.openPath])).toEqual([
      ['/p/a.ts', 'modified', 3, 1, '/p/a.ts'],
      ['/p/new.ts', 'added', 1, 0, '/p/new.ts'],
      ['/p/gone.ts', 'deleted', 0, 2, null],
    ]);
    expect(rows[0].hunks).toEqual(['@@ -1,1 +1,2 @@\n-x\n+y', '@@ -1,1 +1,2 @@\n+z\n+w']);
    expect(rows[0].blocks).toEqual([1, 1]); // one block per edit, each numbered against its own version
    expect(rows[1].blocks).toEqual([1]);
    expect(rows[2].hunks).toEqual([]);
    expect(rows[2].blocks).toEqual([]);
  });

  it('shows Staged while a tracked entry’s index differs from HEAD, never for an untracked one', () => {
    const entry = (index: string, untracked = false) => ({ path: 'x', oldPath: null, index, worktree: '.', untracked });
    expect(indexDiffers(statusOf({ files: [entry('.')] }))).toBe(false);
    expect(indexDiffers(statusOf({ files: [entry('?', true)] }))).toBe(false);
    expect(indexDiffers(statusOf({ files: [entry('.'), entry('A')] }))).toBe(true);
    expect(indexDiffers(null)).toBe(false);
  });

  it('shows Last turn’s file relative to the repository when inside it and absolute outside it, its identity absolute in both', () => {
    const changedFiles: ChangedFile[] = [
      { path: '/work/berth/src/a.ts', change: 'update', added: 1, removed: 1, cellId: 'c1' as ChangedFile['cellId'] },
      { path: '/work/notes/todo.md', change: 'create', added: 2, removed: 0, cellId: 'c2' as ChangedFile['cellId'] },
      { path: '/work/berth-old/b.ts', change: 'update', added: 1, removed: 0, cellId: 'c3' as ChangedFile['cellId'] }, // a sibling sharing the prefix
    ];
    const rows = turnScopeFiles(changedFiles, null, '/work/berth/');
    expect(rows.map((r) => [r.path, r.displayPath, r.openPath])).toEqual([
      ['/work/berth/src/a.ts', 'src/a.ts', '/work/berth/src/a.ts'],
      ['/work/notes/todo.md', '/work/notes/todo.md', '/work/notes/todo.md'],
      ['/work/berth-old/b.ts', '/work/berth-old/b.ts', '/work/berth-old/b.ts'],
    ]);
    expect(turnScopeFiles(changedFiles, null, null).map((r) => r.displayPath)).toEqual(changedFiles.map((f) => f.path)); // no repository known
  });

  it('shows a git scope’s file by its repository-relative path, and an unmerged one as a conflict', () => {
    const files = [
      { path: 'src/both.ts', oldPath: null, insertions: 4, deletions: 1, binary: false },
      { path: 'src/plain.ts', oldPath: null, insertions: 1, deletions: 0, binary: false },
      { path: 'src/gone.ts', oldPath: null, insertions: 0, deletions: 3, binary: false },
      { path: 'art/both.png', oldPath: null, insertions: 0, deletions: 0, binary: true },
    ];
    const entry = (path: string, index: string, worktree: string) => ({ path, oldPath: null, index, worktree, untracked: false });
    const status = statusOf({ dirty: true, files: [entry('src/both.ts', 'U', 'U'), entry('src/plain.ts', '.', 'M'), entry('src/gone.ts', 'D', 'D'), entry('art/both.png', 'A', 'A')] });
    const rows = gitScopeFiles({ scope: 'uncommitted', repoRoot: '/repo', files, patch: null, status });
    expect(rows.map((r) => [r.path, r.displayPath, r.kind, r.openPath])).toEqual([
      ['src/both.ts', 'src/both.ts', 'conflict', '/repo/src/both.ts'],
      ['src/plain.ts', 'src/plain.ts', 'modified', '/repo/src/plain.ts'],
      ['src/gone.ts', 'src/gone.ts', 'conflict', '/repo/src/gone.ts'],
      ['art/both.png', 'art/both.png', 'binary', '/repo/art/both.png'], // a binary keeps its body's kind
    ]);
    expect(unmerged(entry('x', 'U', 'D'))).toBe(true);
    expect(unmerged(entry('x', 'M', 'M'))).toBe(false);
  });

  it('finds the latest turn whose divider lists files, and none answers null', () => {
    const T2 = 'turn:6f1c2e0a-0000-4000-8000-000000000002' as TurnId;
    const T3 = 'turn:6f1c2e0a-0000-4000-8000-000000000003' as TurnId;
    const file = { path: '/repo/a.ts', change: 'update', added: 1, removed: 0, cellId: 'c1' };
    const divider = (turnId: TurnId, files?: unknown[]) => ({ kind: 'divider', turnId, files }) as unknown as Row;
    const other = { kind: 'cell', turnId: T3 } as unknown as Row;
    expect(latestTurnWithFiles([divider(T, [file]), divider(T2, [file]), divider(T3, []), other])).toBe(T2);
    expect(latestTurnWithFiles([divider(T), divider(T2, []), other])).toBeNull();
    expect(latestTurnWithFiles([])).toBeNull();
  });
});

// ---- the store over a fake X2 client ---------------------------------------------------------------------------------

const DIR = '/repo';
const APP_PATCH = ['diff --git a/src/app.ts b/src/app.ts', 'index 1..2 100644', '--- a/src/app.ts', '+++ b/src/app.ts', '@@ -4,3 +4,4 @@', ' d', '+e', ' f', ' g', '@@ -12,3 +13,4 @@', ' m', '+n', ' o', ' p', ''].join('\n');
const APP_FILES = [{ path: 'src/app.ts', oldPath: null, insertions: 2, deletions: 0, binary: false }];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function diffMain(answer: (input: Record<string, unknown>) => { patch: string; files: typeof APP_FILES } = () => ({ patch: APP_PATCH, files: APP_FILES })) {
  return installFakeMain((name, input) => {
    if (name === 'git.diff') return ok(answer(input));
    return ok();
  });
}

describe('review store', () => {
  afterEach(() => vi.useRealTimers());

  it('reads one diff per (directory, scope) however many hold it, with the input each scope takes', async () => {
    const main = diffMain();
    const store = createReviewStore(createClient(() => main.bridge));
    const offs = [
      store.getState().hold({ machine: TEST_MACHINE, directory: DIR, scope: 'uncommitted', read: 'git.diff', against: null }),
      store.getState().hold({ machine: TEST_MACHINE, directory: DIR, scope: 'uncommitted', read: 'git.diff', against: null }),
      store.getState().hold({ machine: TEST_MACHINE, directory: DIR, scope: 'staged', read: 'git.diff', against: null }),
    ];
    await tick();
    expect(main.callsOf('git.diff')).toEqual([
      { directory: DIR, scope: 'all' },
      { directory: DIR, scope: 'staged' },
    ]);
    const slice = diffOf(store.getState(), { machine: TEST_MACHINE, directory: DIR, scope: 'uncommitted', read: 'git.diff', against: null });
    expect(slice?.status).toBe('ok');
    expect(slice?.status === 'ok' && [...slice.patch!.keys()]).toEqual(['src/app.ts']);
    offs.forEach((off) => off());
    expect(diffOf(store.getState(), { machine: TEST_MACHINE, directory: DIR, scope: 'uncommitted', read: 'git.diff', against: null })).toBeUndefined();
  });

  it('re-reads a held scope once, 250 ms after the last new status for its directory, and once more for a change during a read', async () => {
    vi.useFakeTimers();
    const gate: { held: boolean; release: (() => void) | null } = { held: false, release: null };
    const main = installFakeMain(async (name) => {
      if (name !== 'git.diff') return ok();
      if (gate.held) await new Promise<void>((resolve) => (gate.release = resolve));
      return ok({ patch: APP_PATCH, files: APP_FILES });
    });
    const store = createReviewStore(createClient(() => main.bridge));
    const off = store.getState().hold({ machine: TEST_MACHINE, directory: DIR, scope: 'uncommitted', read: 'git.diff', against: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.diff')).toHaveLength(1);
    store.getState().statusChanged(checkoutKey(TEST_MACHINE, DIR));
    await vi.advanceTimersByTimeAsync(100);
    store.getState().statusChanged(checkoutKey(TEST_MACHINE, DIR));
    await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_MS - 1);
    expect(main.callsOf('git.diff')).toHaveLength(1); // trailing: the second change restarted the wait
    gate.held = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(main.callsOf('git.diff')).toHaveLength(2);
    store.getState().statusChanged(checkoutKey(TEST_MACHINE, DIR)); // during the read
    await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_MS);
    expect(main.callsOf('git.diff')).toHaveLength(2); // one in flight per (directory, scope)
    gate.held = false;
    gate.release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.diff')).toHaveLength(3);
    off();
    store.getState().statusChanged(checkoutKey(TEST_MACHINE, DIR));
    await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_MS * 2);
    expect(main.callsOf('git.diff')).toHaveLength(3); // released: nothing more
  });

  it('keeps the last answer while a re-read runs, and says why a read failed', async () => {
    let fails = false;
    const main = installFakeMain((name) => (name === 'git.diff' ? (fails ? fail('unknown revision') : ok({ patch: APP_PATCH, files: APP_FILES })) : ok()));
    const store = createReviewStore(createClient(() => main.bridge));
    const target = { machine: TEST_MACHINE, directory: DIR, scope: 'uncommitted', read: 'git.diff', against: null } as const;
    const off = store.getState().hold(target);
    await tick();
    store.getState().refresh(target);
    expect(diffOf(store.getState(), target)?.status).toBe('ok');
    await tick();
    fails = true;
    store.getState().refresh(target);
    await tick();
    expect(diffOf(store.getState(), target)).toEqual({ status: 'error', message: 'unknown revision' });
    off();
  });

  it('ignores an original file read that resolves after its refreshed replacement', async () => {
    const reads: ((patch: string) => void)[] = [];
    const main = installFakeMain(async (name, input) => {
      if (name !== 'git.diff') return ok();
      if (!input.path) return ok({ patch: 'x'.repeat(REVIEW_SCOPE_BYTES_CAP + 1), files: APP_FILES });
      const patch = await new Promise<string>((resolve) => reads.push(resolve));
      return ok({ patch, files: APP_FILES });
    });
    const store = createReviewStore(createClient(() => main.bridge));
    const target = { machine: TEST_MACHINE, directory: DIR, scope: 'uncommitted', read: 'git.diff', against: null } as const;
    const off = store.getState().hold(target);
    await tick();
    store.getState().loadFile(target, 'src/app.ts');
    store.getState().refresh(target);
    await tick();
    store.getState().loadFile(target, 'src/app.ts');
    const patch = (value: string) => `diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-before\n+${value}\n`;
    reads[1](patch('new'));
    await tick();
    expect(fileDiffOf(store.getState(), target, 'src/app.ts')).toMatchObject({ status: 'ok', file: { hunks: ['@@ -1 +1 @@\n-before\n+new'] } });
    reads[0](patch('old'));
    await tick();
    expect(fileDiffOf(store.getState(), target, 'src/app.ts')).toMatchObject({ status: 'ok', file: { hunks: ['@@ -1 +1 @@\n-before\n+new'] } });
    off();
  });

  it('past the scope cap keeps the file list only and fetches a file on selection', async () => {
    const big = APP_PATCH + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP);
    const main = diffMain((input) => (input.path ? { patch: APP_PATCH, files: APP_FILES } : { patch: big, files: APP_FILES }));
    const store = createReviewStore(createClient(() => main.bridge));
    const target = { machine: TEST_MACHINE, directory: DIR, scope: 'uncommitted', read: 'git.diff', against: null } as const;
    const off = store.getState().hold(target);
    await tick();
    const slice = diffOf(store.getState(), target);
    expect(slice?.status === 'ok' && slice.patch).toBeNull();
    expect(slice?.status === 'ok' && slice.files).toEqual(APP_FILES);
    store.getState().loadFile(target, 'src/app.ts');
    store.getState().loadFile(target, 'src/app.ts');
    await tick();
    expect(main.callsOf('git.diff').slice(1)).toEqual([{ directory: DIR, scope: 'all', path: 'src/app.ts' }]);
    expect(fileDiffOf(store.getState(), target, 'src/app.ts')).toMatchObject({ status: 'ok', file: { path: 'src/app.ts', hunks: [expect.stringMatching(/^@@ -4,3/), expect.stringMatching(/^@@ -12,3/)] } });
    off();
  });

  // P5 O7 M8 ("Untracked files"): one path for this Mac's checkout and another machine's: the read goes to the target's
  // machine, made from its session (the endpoint's `checkout` rule bounds it there)
  it('reads an untracked file in the untracked scope, on another machine’s checkout for its session', async () => {
    const asked: unknown[] = [];
    const main = installFakeMain((name, input, machine) => {
      if (name !== 'git.diff') return ok();
      asked.push([input, machine]);
      return ok(input.scope === 'untracked' ? { patch: ['diff --git a/scratch.txt b/scratch.txt', 'new file mode 100644', '--- /dev/null', '+++ b/scratch.txt', '@@ -0,0 +1 @@', '+hi', ''].join('\n'), files: [] } : { patch: APP_PATCH, files: APP_FILES });
    });
    const store = createReviewStore(createClient(() => main.bridge));
    const target = { machine: OTHER_MACHINE, directory: '/work', scope: 'uncommitted', read: 'git.diff', against: null, session: addressOf(OTHER_MACHINE, 'app-r' as AppSessionId) } as const;
    const off = store.getState().hold(target);
    await tick();
    store.getState().loadFile(target, 'scratch.txt', true);
    await tick();
    expect(asked.at(-1)).toEqual([{ directory: '/work', scope: 'untracked', path: 'scratch.txt' }, { machine: OTHER_MACHINE, session: 'app-r' }]);
    expect(fileDiffOf(store.getState(), target, 'scratch.txt')).toMatchObject({ status: 'ok', file: { path: 'scratch.txt', hunks: ['@@ -0,0 +1 @@\n+hi'] } });
    off();
  });

  // UX wave U5b-2 (§E, §G): the working-tree read and a commit's diff, each a target of its own
  const SHA = '3f9a1c27b84e5d60a1f2c3b4d5e6f708192a3b4c';
  const MERGE_BASE = '9d0c1b2a39485766a5b4c3d2e1f0a9b8c7d6e5f4';
  const COMMIT: GitCommit = { sha: SHA, shortSha: '3f9a1c2', author: 'Ada', authoredAt: '2026-11-14T10:00:00.000Z', subject: 'Quote the berth names', parents: ['0000000000000000000000000000000000000001'] };
  const commitTarget = (sha = SHA): DiffTarget => ({ machine: TEST_MACHINE, directory: DIR, scope: 'commit', read: 'git.commitDiff', against: sha });

  it('reads the working tree against HEAD or a merge base with git.changesSince, a new file’s count kept by its path, each against its own target', async () => {
    const main = installFakeMain((name) => (name === 'git.changesSince' ? ok({ patch: APP_PATCH, files: APP_FILES, untracked: [{ path: 'notes.md', insertions: 12, binary: false }] }) : ok()));
    const store = createReviewStore(createClient(() => main.bridge));
    const head: DiffTarget = { machine: TEST_MACHINE, directory: DIR, scope: 'uncommitted', read: 'git.changesSince', against: 'HEAD' };
    const since: DiffTarget = { machine: TEST_MACHINE, directory: DIR, scope: 'branch', read: 'git.changesSince', against: MERGE_BASE };
    const offs = [store.getState().hold(head), store.getState().hold(since)];
    await tick();
    expect(main.callsOf('git.changesSince')).toEqual([
      { directory: DIR, against: 'HEAD' },
      { directory: DIR, against: MERGE_BASE },
    ]);
    const answered = diffOf(store.getState(), since);
    expect(answered?.status === 'ok' && answered.untracked?.get('notes.md')).toEqual({ path: 'notes.md', insertions: 12, binary: false });
    store.getState().loadFile(since, 'src/app.ts');
    await tick();
    expect(main.callsOf('git.changesSince').at(-1)).toEqual({ directory: DIR, against: MERGE_BASE, path: 'src/app.ts' });
    offs.forEach((off) => off());
  });

  it('keeps a commit’s diff once read: neither a new status nor a refresh reads it again, while This branch re-reads as before (S16)', async () => {
    vi.useFakeTimers();
    const main = installFakeMain((name) =>
      name === 'git.commitDiff' ? ok({ commit: COMMIT, onHead: true, patch: APP_PATCH, files: APP_FILES }) : name === 'git.changesSince' ? ok({ patch: APP_PATCH, files: APP_FILES, untracked: [] }) : ok(),
    );
    const store = createReviewStore(createClient(() => main.bridge));
    const since: DiffTarget = { machine: TEST_MACHINE, directory: DIR, scope: 'branch', read: 'git.changesSince', against: MERGE_BASE };
    const offs = [store.getState().hold(commitTarget()), store.getState().hold(since)];
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.commitDiff')).toEqual([{ directory: DIR, commit: SHA }]);
    expect(diffOf(store.getState(), commitTarget())).toMatchObject({ status: 'ok', commit: { commit: COMMIT, onHead: true } });
    store.getState().statusChanged(checkoutKey(TEST_MACHINE, DIR));
    await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_MS * 2);
    store.getState().refresh(commitTarget());
    store.getState().retryFailed(commitTarget());
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.commitDiff')).toHaveLength(1);
    expect(main.callsOf('git.changesSince')).toHaveLength(2); // This branch, re-read 250 ms after the new status
    offs.forEach((off) => off());
  });

  it('asks a failed commit’s diff again by retryFailed and a refresh, and by no new status; one that answered, by none (S22)', async () => {
    vi.useFakeTimers();
    let fails = true;
    const main = installFakeMain((name) =>
      name === 'git.commitDiff' ? (fails ? { ok: false, error: { code: 'host_unavailable', message: 'the link dropped' } } : ok({ commit: COMMIT, onHead: true, patch: APP_PATCH, files: APP_FILES })) : ok(),
    );
    const store = createReviewStore(createClient(() => main.bridge));
    const off = store.getState().hold(commitTarget());
    await vi.advanceTimersByTimeAsync(0);
    expect(diffOf(store.getState(), commitTarget())).toEqual({ status: 'error', message: 'the link dropped', code: 'host_unavailable' });
    store.getState().statusChanged(checkoutKey(TEST_MACHINE, DIR));
    await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_MS * 2);
    expect(main.callsOf('git.commitDiff')).toHaveLength(1); // a new status is not one of the three
    store.getState().retryFailed(commitTarget()); // Retry, or the machine heard again
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.commitDiff')).toHaveLength(2);
    store.getState().refresh(commitTarget()); // Review shown again
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.commitDiff')).toHaveLength(3);
    fails = false;
    store.getState().retryFailed(commitTarget());
    await vi.advanceTimersByTimeAsync(0);
    expect(diffOf(store.getState(), commitTarget())?.status).toBe('ok');
    store.getState().retryFailed(commitTarget());
    store.getState().refresh(commitTarget());
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.commitDiff')).toHaveLength(4);
    off();
  });

  it('past the cap, asks a commit’s failed file again by retryFailed and leaves the files already read (S22)', async () => {
    const failing = new Set(['src/b.ts']);
    const fileOf = (path: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-x\n+y\n`;
    const main = installFakeMain((name, input) => {
      if (name !== 'git.commitDiff') return ok();
      if (typeof input.path !== 'string') return ok({ commit: COMMIT, onHead: true, patch: 'x'.repeat(REVIEW_SCOPE_BYTES_CAP + 1), files: [] });
      return failing.has(input.path) ? fail('the disk is busy') : ok({ commit: COMMIT, onHead: true, patch: fileOf(input.path), files: [] });
    });
    const store = createReviewStore(createClient(() => main.bridge));
    const off = store.getState().hold(commitTarget());
    await tick();
    store.getState().loadFile(commitTarget(), 'src/a.ts');
    store.getState().loadFile(commitTarget(), 'src/b.ts');
    await tick();
    expect(fileDiffOf(store.getState(), commitTarget(), 'src/b.ts')).toEqual({ status: 'error', message: 'the disk is busy' });
    failing.clear();
    store.getState().retryFailed(commitTarget());
    await tick();
    expect(main.callsOf('git.commitDiff').filter((input) => input.path !== undefined).map((input) => input.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/b.ts']);
    expect(fileDiffOf(store.getState(), commitTarget(), 'src/b.ts')?.status).toBe('ok');
    off();
  });

  it('checks a commit’s membership with patch: false, one more when HEAD moves twice during a check (async 3)', async () => {
    const answers: ((onHead: boolean) => void)[] = [];
    const main = installFakeMain(async (name, input) => {
      if (name !== 'git.commitDiff') return ok();
      if (input.patch !== false) return ok({ commit: COMMIT, onHead: true, patch: APP_PATCH, files: APP_FILES });
      const onHead = await new Promise<boolean>((resolve) => answers.push(resolve));
      return ok({ commit: COMMIT, onHead, patch: '', files: [] });
    });
    const store = createReviewStore(createClient(() => main.bridge));
    const off = store.getState().hold(commitTarget());
    await tick();
    store.getState().checkMembership(commitTarget());
    store.getState().checkMembership(commitTarget());
    store.getState().checkMembership(commitTarget());
    await tick();
    expect(main.callsOf('git.commitDiff').filter((input) => input.patch === false)).toHaveLength(1);
    answers[0](true);
    await tick();
    expect(main.callsOf('git.commitDiff').filter((input) => input.patch === false)).toEqual([
      { directory: DIR, commit: SHA, patch: false },
      { directory: DIR, commit: SHA, patch: false },
    ]);
    answers[1](false);
    await tick();
    expect(onHeadOf(store.getState(), commitTarget())).toBe(false);
    expect(main.callsOf('git.commitDiff').filter((input) => input.patch !== false)).toHaveLength(1); // the patch is not read again
    off();
  });
});

// ---- the stack over C8a's host ---------------------------------------------------------------------------------------
// UX wave U5b, M3 (the execution document's §F): Review is one scroller of sections, a sticky header over a body each.

// The library measures text on a canvas, which happy-dom does not draw.
HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) })) as never;

const STAGED_PATCH = ['diff --git a/src/staged.ts b/src/staged.ts', 'new file mode 100644', 'index 0000000..3b18e51', '--- /dev/null', '+++ b/src/staged.ts', '@@ -0,0 +1 @@', '+export const staged = 1;', ''].join('\n');
const DIRTY = statusOf({
  dirty: true,
  files: [
    { path: 'src/app.ts', oldPath: null, index: '.', worktree: 'M', untracked: false },
    { path: 'src/staged.ts', oldPath: null, index: 'A', worktree: '.', untracked: false },
    { path: 'scratch.txt', oldPath: null, index: '?', worktree: '?', untracked: true },
  ],
});

type DiffAnswer = { patch: string; files: GitDiffFile[] };
interface ReviewMainOptions {
  status?: GitStatus;
  uncommitted?: DiffAnswer;
}
function reviewMain(options: ReviewMainOptions = {}) {
  // `diff`: a test's own answer to a `git.diff` (a held one), else undefined for the scripted answers below
  // UX wave U5b-2: the three reads, answered where a case scripts them (`branch`, `since`, `commits`)
  const state: {
    status: GitStatus;
    uncommitted: DiffAnswer;
    perFile: Record<string, DiffAnswer>;
    diff?: (input: Record<string, unknown>) => Promise<ReturnType<typeof ok>> | undefined;
    branch?: () => ReturnType<typeof ok> | Promise<ReturnType<typeof ok>>;
    since?: (input: Record<string, unknown>) => ReturnType<typeof ok> | Promise<ReturnType<typeof ok>>;
    commits?: (input: Record<string, unknown>) => ReturnType<typeof ok> | Promise<ReturnType<typeof ok>>;
  } = {
    perFile: {},
    status: options.status ?? DIRTY,
    uncommitted: options.uncommitted ?? {
      patch: APP_PATCH + STAGED_PATCH,
      files: [...APP_FILES, { path: 'src/staged.ts', oldPath: null, insertions: 1, deletions: 0, binary: false }],
    },
  };
  const main = installFakeMain((name, input) => {
    switch (name) {
      case 'git.watch':
        return ok(state.status);
      case 'git.diff': {
        const held = state.diff?.(input);
        if (held) return held;
        if (typeof input.path === 'string') return ok(state.perFile[input.path] ?? { patch: '', files: [] });
        return ok(input.scope === 'staged' ? { patch: STAGED_PATCH, files: [{ path: 'src/staged.ts', oldPath: null, insertions: 1, deletions: 0, binary: false }] } : state.uncommitted);
      }
      case 'layout.get':
        return ok({ value: null });
      case 'fs.workflows':
        return ok({ runs: [] });
      case 'git.branchCommits':
        return state.branch?.() ?? ok();
      case 'git.changesSince':
        return state.since?.(input) ?? ok();
      case 'git.commitDiff':
        return state.commits?.(input) ?? ok();
      case 'git.worktree.branch': // C10: the main worktree is on main
        return ok({ repoRoot: input.repoRoot, branch: input.branch, head: state.status.head, checkedOutAt: input.branch === 'main' ? '/repo' : null, base: 'main', ahead: 0, merged: true });
      default:
        return ok();
    }
  });
  return { ...main, state };
}

const chipOf = (id: string) => document.querySelector<HTMLButtonElement>(`[data-chip="${id}"]`);
const chips = () => [...document.querySelectorAll<HTMLButtonElement>('[data-chip]')].map((c) => [c.dataset.chip, c.disabled, c.getAttribute('aria-pressed'), c.title]);
const header = () => document.querySelector('[data-review-header]')?.textContent ?? null;
const footer = () => document.querySelector('[data-review-footer]')?.textContent ?? null;
const stack = () => document.querySelector<HTMLElement>('[data-review-stack]');
const stackText = () => stack()?.textContent ?? null;
const sections = () => [...document.querySelectorAll<HTMLElement>('[data-review-file]')];
const paths = () => sections().map((section) => section.dataset.reviewFile);
const sectionOf = (path: string) => sections().find((section) => section.dataset.reviewFile === path) ?? null;
const inSection = <E extends HTMLElement = HTMLElement>(path: string, selector: string) => sectionOf(path)?.querySelector<E>(selector) ?? null;
const badgeOf = (path: string) => inSection(path, '[data-review-badge]')?.textContent ?? null;
const countsOf = (path: string) => inSection(path, '[data-review-counts]')?.textContent ?? null;
const pathOf = (path: string) => inSection(path, '[data-review-path]')?.textContent ?? null;
const folded = (path: string) => sectionOf(path)?.hasAttribute('data-folded') ?? null;
const viewed = (path: string) => sectionOf(path)?.hasAttribute('data-viewed') ?? null;
const bodyOf = (path: string) => inSection(path, '[data-review-body]');
const fold = (path: string) => fireEvent.click(inSection(path, '[data-review-fold]')!);
const markViewed = (path: string) => fireEvent.click(inSection(path, '[data-review-viewed]')!);
const hunkLabel = () => document.querySelector('[data-review-hunk]')?.textContent ?? null;
const reads = (path?: string) => main().callsOf('git.diff').filter((input) => input.path === path);
let current: ReturnType<typeof reviewMain> | null = null;
const main = () => current!;

// The stack's widths, by the first selector an element matches (0 for the rest: not laid out, every form wide).
function widths(table: Record<string, number>): void {
  vi.spyOn(reviewLayout, 'width').mockImplementation((element) => {
    for (const [selector, width] of Object.entries(table)) if (element.matches(selector)) return width;
    return 0;
  });
}

// The diff body is awaited over turns of the event loop, which the fake main's answers, the lazy chunk and React's work
// need, not over a time budget (E11 W-E: a `waitFor` second timed out under load before the body painted).
async function painted(check: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50 && !check(); turn++) await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
  expect(check()).toBe(true);
}

const openReview = (params?: ReviewParams) => act(() => void panelHost.addTool('review', { appSessionId: A, params }));
// UX wave U6b-1: what the session's Files tabs hold, and the main strip's file tabs (none: a file opens beside the chat)
const sideFiles = () => (panelOf(A)?.tabs ?? []).filter((tab) => tab.toolId === 'files').map((tab) => useLayout.getState().panelParams[tab.id]);
const mainFileTabs = () => currentSet(useLayout.getState().main).panes.flatMap((p) => p.tabs).filter((t) => t.kind === 'file');
// Review's tab brought back into view: its body is drawn again, and counts its hunks once it has its diff
async function showReview() {
  act(() => panelHost.selectTab(panelOf(A)!.tabs.find((tab) => tab.toolId === 'review')!.id));
  await waitFor(() => expect(document.querySelector('[data-review-hunk]')?.textContent).toMatch(/^Showing hunk \d+ of \d+$/));
}
// UX wave U8c-2: the agent in a worktree of /repo reached by `cd` (a fact on the record), or back at /repo (null)
const WT = '/repo/.claude/worktrees/w1';
const moveTo = (checkout: string | null) =>
  act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/repo', ...(checkout ? { agentFolder: { checkout, cwd: checkout, branch: 'w1', linked: true } } : {}) })) })));

async function attachTranscript(events: SessionEvent[]) {
  const source: TranscriptSource = { subscribe: () => () => {}, snapshot: () => Promise.resolve(events) };
  await act(() => useTranscriptStore.getState().attach(A, source));
}
const changedTurn = () => {
  const divider = useTranscriptStore.getState().rows(A).find((row) => row.kind === 'divider' && row.files?.length);
  if (divider?.kind !== 'divider' || !divider.files?.length) throw new Error('no changed-file divider');
  return { ...divider, files: divider.files };
};

// One file of each kind a header badges, over Uncommitted: a modified file, a new one, a deleted one, a pure rename, a
// binary, a conflict and an untracked file.
const KINDS: DiffAnswer = {
  patch: [
    APP_PATCH,
    ['diff --git a/src/new.ts b/src/new.ts', 'new file mode 100644', 'index 0000000..3b18e51', '--- /dev/null', '+++ b/src/new.ts', '@@ -0,0 +1,2 @@', '+one', '+two', ''].join('\n'),
    ['diff --git a/src/old.ts b/src/old.ts', 'deleted file mode 100644', 'index 3b18e51..0000000', '--- a/src/old.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-one', '-two', ''].join('\n'),
    ['diff --git a/src/a.ts b/src/b.ts', 'similarity index 100%', 'rename from src/a.ts', 'rename to src/b.ts', ''].join('\n'),
    ['diff --git a/logo.png b/logo.png', 'index 1..2 100644', 'Binary files a/logo.png and b/logo.png differ', ''].join('\n'),
    ['diff --git a/src/conflict.ts b/src/conflict.ts', 'index 1..2 100644', '--- a/src/conflict.ts', '+++ b/src/conflict.ts', '@@ -1 +1 @@', '-ours', '+theirs', ''].join('\n'),
  ].join(''),
  files: [
    ...APP_FILES,
    { path: 'src/new.ts', oldPath: null, insertions: 2, deletions: 0, binary: false },
    { path: 'src/old.ts', oldPath: null, insertions: 0, deletions: 2, binary: false },
    { path: 'src/b.ts', oldPath: 'src/a.ts', insertions: 0, deletions: 0, binary: false },
    { path: 'logo.png', oldPath: null, insertions: 0, deletions: 0, binary: true },
    { path: 'src/conflict.ts', oldPath: null, insertions: 1, deletions: 1, binary: false },
  ],
};
const KINDS_STATUS = statusOf({
  dirty: true,
  files: [
    { path: 'src/app.ts', oldPath: null, index: '.', worktree: 'M', untracked: false },
    { path: 'src/conflict.ts', oldPath: null, index: 'U', worktree: 'U', untracked: false },
    { path: 'scratch.txt', oldPath: null, index: '?', worktree: '?', untracked: true },
  ],
});

describe('review tool', () => {
  const offs: (() => void)[] = [];
  // E11 W-E: the diff view's lazy chunk (`@git-diff-view/react` under the React Compiler) is loaded once here, so no
  // case waits on its import, whose transform is the step that grows with the machine's load.
  beforeAll(async () => {
    await import('./FileBody');
  });
  beforeEach(() => {
    resetPanelStores();
    useReview.getState().reset();
    resetDiffTabs();
    useViewer.getState().reset();
    current = reviewMain();
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/repo' })) }));
    offs.push(connectPanelEvents(), registerPanelTool(reviewTool), registerPanelTool(filesTool)); // UX wave U6b-1: Open opens beside the chat
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens on Uncommitted for a dirty tree: the chips, the totals without the scope’s name, every file a section in the list’s order, the footer', async () => {
    openReview(); // before the page renders, so the resting summary never mounts
    render(<TestHost />);
    await waitFor(() => expect(header()).toBe('3 files changed · +3 −0'));
    expect(chips()).toEqual([
      ['uncommitted', false, 'true', ''],
      ['branch', true, 'false', ''], // UX wave U5b-2: no roster here, so whether the machine serves the reads is not known
      ['turn', true, 'false', 'No turn has changed files yet'],
      ['staged', false, 'false', ''],
    ]);
    expect(paths()).toEqual(['src/app.ts', 'src/staged.ts', 'scratch.txt']);
    expect(footer()).toBe('main · Working tree against HEAD');
    // C8a's git store reads the same diff once for Environment's change line, Review once, and the untracked file, whose
    // section is unfolded, is read on its own (as Source control reads it)
    await waitFor(() => expect(reads('scratch.txt')).toEqual([{ directory: '/repo', scope: 'untracked', path: 'scratch.txt' }]));
    expect(reads()).toEqual([
      { directory: '/repo', scope: 'all' },
      { directory: '/repo', scope: 'all' },
    ]);
  });

  it('shows Staged only while the index differs, and leaves This branch unsettled, with no reason, where the window cannot tell whether the machine serves the reads', async () => {
    main().state.status = statusOf({ dirty: false, branch: null, head: 'fedcba9876543210' });
    main().state.uncommitted = { patch: '', files: [] };
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(chipOf('uncommitted')?.getAttribute('aria-pressed')).toBe('true'));
    expect(chips()).toEqual([
      ['uncommitted', false, 'true', ''],
      ['branch', true, 'false', ''],
      ['turn', true, 'false', 'No turn has changed files yet'],
    ]);
    await waitFor(() => expect(document.querySelector('[data-review-empty]')?.textContent).toBe('No uncommitted changes'));
    expect(sections()).toEqual([]);
    expect(document.querySelector('[data-review-toolbar]')).toBeNull();
    expect(footer()).toBe('detached at fedcba9 · Working tree against HEAD');
  });

  it('keeps Staged selected but disabled once the index matches HEAD again', async () => {
    render(<TestHost />);
    openReview({ scope: 'staged' });
    await waitFor(() => expect(header()).toBe('1 file changed · +1 −0'));
    expect(paths()).toEqual(['src/staged.ts']);
    const clean = statusOf({ dirty: true, files: [DIRTY.files[0], DIRTY.files[2]] });
    main().state.status = clean;
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: clean, reason: 'index' }));
    await waitFor(() => expect(chips().find((c) => c[0] === 'staged')).toEqual(['staged', true, 'true', 'Index matches HEAD']));
    expect(document.querySelector<HTMLElement>('[data-review]')!.dataset.scope).toBe('staged');
  });

  it('heads each file with its path, a badge for every kind but Modified, its counts, Viewed and Open file ↗, and no menu and no Staged badge', async () => {
    main().state.status = KINDS_STATUS;
    main().state.uncommitted = KINDS;
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(paths()).toEqual(['src/app.ts', 'src/new.ts', 'src/old.ts', 'src/b.ts', 'logo.png', 'src/conflict.ts', 'scratch.txt']));
    expect(paths().map((path) => [path, badgeOf(path!), countsOf(path!)])).toEqual([
      ['src/app.ts', null, '+2 −0'],
      ['src/new.ts', 'Added', '+2'], // a new file shows its added lines alone
      ['src/old.ts', 'Deleted', '+0 −2'],
      ['src/b.ts', 'Renamed', null], // a pure rename: no counts
      ['logo.png', 'Binary', null],
      ['src/conflict.ts', 'Conflict', '+1 −1'],
      ['scratch.txt', 'Untracked', null], // not counted before U5b-2's working-tree read
    ]);
    expect(pathOf('src/app.ts')).toBe('src/app.ts');
    expect(pathOf('src/b.ts')).toBe('src/a.ts → src/b.ts'); // both paths fit (nothing is measured narrower)
    await waitFor(() => expect(inSection('scratch.txt', '[data-review-viewed]')).not.toBeNull());
    for (const path of paths()) {
      expect(inSection(path!, '[data-review-viewed]'), path).not.toBeNull();
      expect(inSection(path!, '[data-open-file]')?.textContent ?? null, path).toBe(path === 'src/old.ts' ? null : 'Open file ↗');
      expect(sectionOf(path!)!.querySelector('[aria-haspopup="menu"]'), path).toBeNull();
    }
    expect(stackText()).not.toContain('Staged');
    expect(bodyOf('logo.png')?.textContent).toBe('Binary file');
    expect(bodyOf('src/b.ts')).toBeNull(); // a rename with no change has no body
    expect(sectionOf('src/old.ts')!.querySelector('[data-review-open-placeholder]')).not.toBeNull(); // its column kept
  });

  it('keeps the kind’s badge and the counts whole and shortens the path, its folder first', async () => {
    main().state.status = KINDS_STATUS;
    main().state.uncommitted = KINDS;
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(badgeOf('src/new.ts')).toBe('Added'));
    const classes = (selector: string) => [...(inSection('src/new.ts', selector)?.classList ?? [])];
    expect(classes('[data-review-badge]')).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']));
    expect(classes('[data-review-counts]')).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']));
    expect(classes('[data-review-path]')).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
    expect(classes('[data-review-path-folder]')).toEqual(expect.arrayContaining(['min-w-0', 'truncate', 'shrink-[1000]']));
    expect(classes('[data-review-path-name]')).toEqual(expect.arrayContaining(['min-w-0', 'truncate']));
    expect(inSection('src/new.ts', '[data-review-path-folder]')?.textContent).toBe('src/');
    expect(inSection('src/new.ts', '[data-review-path-name]')?.textContent).toBe('new.ts');
  });

  it('reads a rename as old → new where both paths fit, else as the new path with the badge Renamed naming the old one', async () => {
    const { resize } = installResizeObserver();
    let room = 400;
    vi.spyOn(reviewLayout, 'width').mockImplementation((element) => (element.matches('[data-review-rename-measure]') ? 300 : element.matches('[data-review-path]') ? room : 0));
    main().state.status = KINDS_STATUS;
    main().state.uncommitted = KINDS;
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(pathOf('src/b.ts')).toBe('src/a.ts → src/b.ts'));
    room = 280;
    resize(inSection('src/b.ts', '[data-review-path]')!, { width: room, height: 20 });
    expect(pathOf('src/b.ts')).toBe('src/b.ts');
    expect(badgeOf('src/b.ts')).toBe('Renamed');
    expect(inSection('src/b.ts', '[data-review-badge]')?.title).toBe('Renamed from src/a.ts');
  });

  it('folds and unfolds at a click on a header; marking Viewed folds; Collapse all reads Expand all, and each acts on every file', async () => {
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(bodyOf('src/app.ts')).not.toBeNull());
    const foldButton = () => inSection('src/app.ts', '[data-review-fold]')!;
    expect(foldButton().getAttribute('aria-expanded')).toBe('true');
    fold('src/app.ts');
    expect(folded('src/app.ts')).toBe(true);
    expect(bodyOf('src/app.ts')).toBeNull();
    expect(foldButton().getAttribute('aria-expanded')).toBe('false');
    fold('src/app.ts');
    expect(folded('src/app.ts')).toBe(false);
    await waitFor(() => expect(bodyOf('src/app.ts')).not.toBeNull());
    markViewed('src/staged.ts');
    expect(viewed('src/staged.ts')).toBe(true);
    expect(folded('src/staged.ts')).toBe(true);
    expect(bodyOf('src/staged.ts')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(paths().map((path) => folded(path!))).toEqual([true, true, true]);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(paths().map((path) => folded(path!))).toEqual([false, false, false]);
    expect(viewed('src/staged.ts')).toBe(true); // unfolding keeps the mark
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeTruthy();
  });

  it('past the 8 MiB cap opens every file folded and draws no counter; unfolding one reads that file alone; counts carry the separator', async () => {
    const files = [
      { path: 'src/app.ts', oldPath: null, insertions: 21530, deletions: 4210, binary: false },
      { path: 'vendor/charts.js', oldPath: null, insertions: 18420, deletions: 0, binary: false },
    ];
    main().state.status = statusOf({ dirty: true, files: [DIRTY.files[0], { ...DIRTY.files[0], path: 'vendor/charts.js' }] });
    main().state.uncommitted = { patch: APP_PATCH + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files };
    main().state.perFile = { 'src/app.ts': { patch: APP_PATCH, files: APP_FILES } };
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(header()).toBe('2 files changed · +39,950 −4,210'));
    expect(countsOf('src/app.ts')).toBe('+21,530 −4,210');
    expect(paths().map((path) => folded(path!))).toEqual([true, true]);
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeTruthy();
    expect(hunkLabel()).toBeNull();
    expect(screen.queryByLabelText('Next hunk')).toBeNull();
    await act(tick);
    expect(main().callsOf('git.diff').filter((input) => input.path !== undefined)).toEqual([]);
    fold('src/app.ts');
    await waitFor(() => expect(hunkLabel()).toBe('Showing hunk 1 of 2'));
    expect(main().callsOf('git.diff').filter((input) => input.path !== undefined)).toEqual([{ directory: '/repo', scope: 'all', path: 'src/app.ts' }]);
  });

  it('says why a file’s own read failed, with Retry in its row, which asks that read again and nothing else', async () => {
    main().state.uncommitted = { patch: APP_PATCH + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files: APP_FILES };
    main().state.status = statusOf({ dirty: true, files: [DIRTY.files[0]] });
    let failing = true;
    main().state.diff = (input) => (input.path === 'src/app.ts' ? Promise.resolve(failing ? fail('git busy') : ok({ patch: APP_PATCH, files: APP_FILES })) : undefined);
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(sectionOf('src/app.ts')).not.toBeNull());
    fold('src/app.ts');
    await waitFor(() => expect(bodyOf('src/app.ts')?.textContent).toBe('Diff unavailable: git busyRetry'));
    const scopeReads = reads().length;
    failing = false;
    fireEvent.click(within(bodyOf('src/app.ts')!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(hunkLabel()).toBe('Showing hunk 1 of 2'));
    expect(reads('src/app.ts')).toHaveLength(2);
    expect(reads()).toHaveLength(scopeReads);
  });

  it('says why a binary file’s own read failed, with Retry, and draws it as a binary once the read answers', async () => {
    const binary = {
      patch: 'diff --git a/logo.png b/logo.png\nindex 1..2 100644\nBinary files a/logo.png and b/logo.png differ\n',
      files: [{ path: 'logo.png', oldPath: null, insertions: 0, deletions: 0, binary: true }],
    };
    main().state.uncommitted = { patch: binary.patch + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files: binary.files };
    let failing = true;
    main().state.diff = (input) => (input.path === 'logo.png' ? Promise.resolve(failing ? fail('git busy') : ok(binary)) : undefined);
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(sectionOf('logo.png')).not.toBeNull());
    fold('logo.png');
    await waitFor(() => expect(bodyOf('logo.png')?.textContent).toBe('Diff unavailable: git busyRetry'));
    failing = false;
    fireEvent.click(within(bodyOf('logo.png')!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(bodyOf('logo.png')?.textContent).toBe('Binary file'));
    expect(reads('logo.png')).toHaveLength(2);
    expect(inSection('logo.png', '[data-review-viewed]')).not.toBeNull(); // its header read: a mark can sign it
  });

  it('lets the harness read and drive each section by its path: its hunks, its fold, its mark and its Open file ↗', async () => {
    main().state.status = statusOf({ dirty: true, files: DIRTY.files.slice(0, 2) });
    openReview();
    render(
      <div data-region="panel">
        <TestHost />
      </div>,
    );
    await painted(() => (bodyOf('src/staged.ts')?.querySelector('table') ?? null) !== null);
    expect(codeProbes.section('src/staged.ts')).toEqual({ path: 'src/staged.ts', kind: 'added', added: 1, removed: 0, folded: false, viewed: false, hunks: [expect.stringContaining('+export const staged = 1;')] });
    expect(codeProbes.section('src/app.ts')?.hunks).toHaveLength(2);
    expect(codeProbes.section('gone.ts')).toBeNull();
    act(() => codeProbes.setFolded('src/staged.ts', true));
    expect(folded('src/staged.ts')).toBe(true);
    act(() => codeProbes.setFolded('src/staged.ts', true)); // folded already: nothing changes
    expect(codeProbes.section('src/staged.ts')?.folded).toBe(true);
    act(() => codeProbes.setFolded('src/staged.ts', false));
    expect(codeProbes.section('src/staged.ts')?.folded).toBe(false);
    await act(() => codeProbes.markViewed('src/staged.ts'));
    expect(codeProbes.section('src/staged.ts')).toEqual(expect.objectContaining({ viewed: true, folded: true }));
    act(() => codeProbes.openFileOf('src/app.ts'));
    expect(sideFiles()).toEqual([expect.objectContaining({ file: '/repo/src/app.ts', line: 5 })]);
    expect(mainFileTabs()).toEqual([]);
  });

  it('in a narrow column shows Viewed as a check box and Open file as ↗, each with its words as a tooltip (card 2)', async () => {
    widths({ '[data-review]': 360 });
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(inSection('src/app.ts', '[data-review-viewed]')).not.toBeNull());
    const box = inSection<HTMLInputElement>('src/app.ts', '[data-review-viewed]')!;
    expect([box.tagName, box.type, box.checked, box.title || box.closest('label')?.title]).toEqual(['INPUT', 'checkbox', false, 'Mark viewed']);
    const open = inSection('src/app.ts', '[data-open-file]')!;
    expect([open.textContent, open.title]).toEqual(['↗', 'Open file ↗']);
    fireEvent.click(box);
    expect(viewed('src/app.ts')).toBe(true);
    expect(folded('src/app.ts')).toBe(true);
    const marked = inSection<HTMLInputElement>('src/app.ts', '[data-review-viewed]')!;
    expect([marked.checked, marked.title || marked.closest('label')?.title]).toEqual([true, 'Viewed']);
  });

  it('counts hunks across the files, folded or not; ↑ and ↓ move through them; Open file ↗ opens the counter’s hunk in its file, else the file’s first', async () => {
    main().state.status = statusOf({ dirty: true, files: DIRTY.files.slice(0, 2) });
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(hunkLabel()).toBe('Showing hunk 1 of 3'));
    expect(screen.getByLabelText('Previous hunk')).toHaveProperty('disabled', true);
    fireEvent.click(inSection('src/app.ts', '[data-open-file]')!);
    expect(sideFiles()).toEqual([expect.objectContaining({ file: '/repo/src/app.ts', line: 5 })]);
    expect(mainFileTabs()).toEqual([]);
    await showReview(); // UX wave U6b-1: the file is in view in Review's place; Review comes back on its hunk
    expect(hunkLabel()).toBe('Showing hunk 1 of 3');
    fireEvent.click(screen.getByLabelText('Next hunk'));
    expect(hunkLabel()).toBe('Showing hunk 2 of 3');
    fireEvent.click(inSection('src/app.ts', '[data-open-file]')!);
    expect(sideFiles()).toEqual([expect.objectContaining({ file: '/repo/src/app.ts', line: 14 })]); // the same tab, at the new line
    await showReview();
    expect(hunkLabel()).toBe('Showing hunk 2 of 3');
    fireEvent.click(screen.getByLabelText('Next hunk'));
    expect(hunkLabel()).toBe('Showing hunk 3 of 3'); // across into the next file
    expect(screen.getByLabelText('Next hunk')).toHaveProperty('disabled', true);
    fireEvent.click(inSection('src/app.ts', '[data-open-file]')!);
    expect(sideFiles()).toEqual([expect.objectContaining({ file: '/repo/src/app.ts', line: 5 })]); // its own first hunk
    await showReview();
    fireEvent.click(inSection('src/staged.ts', '[data-open-file]')!);
    expect(sideFiles()).toContainEqual(expect.objectContaining({ file: '/repo/src/staged.ts', line: 1 }));
    expect(mainFileTabs()).toEqual([]);
    await showReview();
    expect(hunkLabel()).toBe('Showing hunk 3 of 3');
    fold('src/app.ts');
    expect(hunkLabel()).toBe('Showing hunk 3 of 3'); // a folded file's hunks are counted too (M4): a jump unfolds it
  });

  it('keeps a hunk it jumped to when the hunk cannot reach the top of the scroller; scrolling by hand moves the count', async () => {
    main().state.status = statusOf({ dirty: true, files: [DIRTY.files[0]] });
    main().state.uncommitted = { patch: APP_PATCH, files: APP_FILES };
    const page = fakeStackLayout({ viewport: 150, row: 20 }); // the second hunk's row lies below the last offset
    try {
      openReview();
      render(<TestHost />);
      await painted(() => stackText()?.includes('@@ -12,3 +13,4 @@') ?? false);
      await page.settle();
      const scroller = stack()!;
      fireEvent.click(screen.getByLabelText('Next hunk'));
      await page.settle();
      expect(scroller.scrollTop).toBeGreaterThan(0);
      expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight); // clamped short of the second hunk's row
      expect(hunkLabel()).toBe('Showing hunk 2 of 2');
      expect(screen.getByLabelText('Next hunk')).toHaveProperty('disabled', true);
      page.scrollTo(0); // scrolling by hand still moves the counter
      expect(hunkLabel()).toBe('Showing hunk 1 of 2');
    } finally {
      page.restore();
    }
  });

  it('draws every section unified or split from one View menu, and Wrap, the viewer’s one flag, in all of them', async () => {
    const user = userEvent.setup();
    main().state.status = statusOf({ dirty: true, files: DIRTY.files.slice(0, 2) });
    render(<TestHost />);
    openReview();
    await painted(() => (stackText()?.includes('@@ -12,3 +13,4 @@') ?? false) && (bodyOf('src/staged.ts')?.querySelector('table') ?? null) !== null);
    const splitViews = () => stack()!.querySelectorAll('.split-diff-view').length;
    const hunkRows = () => bodyOf('src/app.ts')!.querySelectorAll('tr[data-state="hunk"]:not([data-side="new"])').length;
    expect(splitViews()).toBe(0);
    expect(hunkRows()).toBe(2);
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect((await screen.findAllByRole('menuitemradio')).map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Unified', 'true'],
      ['Split', 'false'],
    ]);
    await user.click(screen.getByRole('menuitemradio', { name: 'Split' }));
    await waitFor(() => expect(splitViews()).toBe(2)); // both sections
    expect(hunkRows()).toBe(2); // the same hunks
    expect(useViewer.getState().wrap).toBe(false);
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Wrap' }));
    expect(useViewer.getState().wrap).toBe(true);
    await waitFor(() => expect(stack()!.querySelectorAll('[class*="-diff-view-wrap"]').length).toBeGreaterThanOrEqual(2)); // DiffView received it
  });

  it('below the width Split needs, disables Split with its reason and draws a stack set to Split unified; wide again it draws Split', async () => {
    const user = userEvent.setup();
    const { resize } = installResizeObserver();
    let width = 720;
    vi.spyOn(reviewLayout, 'width').mockImplementation((element) => (element.matches('[data-review]') ? width : 0));
    main().state.status = statusOf({ dirty: true, files: [DIRTY.files[0]] });
    main().state.uncommitted = { patch: APP_PATCH, files: APP_FILES };
    render(<TestHost />);
    openReview();
    await painted(() => stackText()?.includes('@@ -12,3 +13,4 @@') ?? false);
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Split' }));
    await waitFor(() => expect(stack()!.querySelector('.split-diff-view')).not.toBeNull());
    width = SPLIT_MIN_WIDTH - 1;
    resize(document.querySelector('[data-review]')!, { width, height: 600 });
    await waitFor(() => expect(stack()!.querySelector('.split-diff-view')).toBeNull());
    expect(document.querySelector<HTMLElement>('[data-review]')!.dataset.mode).toBe('unified');
    await user.click(screen.getByRole('button', { name: 'View' }));
    const split = await screen.findByRole('menuitemradio', { name: 'Split' });
    expect([split.getAttribute('aria-disabled'), split.title]).toEqual(['true', 'Split needs a wider column']);
    await user.keyboard('{Escape}');
    width = 720;
    resize(document.querySelector('[data-review]')!, { width, height: 600 });
    await waitFor(() => expect(stack()!.querySelector('.split-diff-view')).not.toBeNull()); // the stored choice stood
  });

  it('lists Last turn with no turn set: chosen, it shows the latest turn that changed files', async () => {
    main().state.status = statusOf({ dirty: false });
    await attachTranscript(journalToEvents(loadSyntheticJournal('edit-and-receipt')));
    const divider = changedTurn();
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(chipOf('turn')).not.toBeNull());
    expect(chipOf('turn')!.disabled).toBe(false);
    fireEvent.click(chipOf('turn')!);
    await waitFor(() => expect(paths()).toEqual(divider.files.map((file) => file.path)));
    expect(chipOf('turn')!.getAttribute('aria-pressed')).toBe('true');
    expect(header()).toBe('3 files changed · +7 −4');
  });

  it('re-reads once 250 ms after git.changed and keeps every section', async () => {
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(paths()).toHaveLength(3));
    expect(reads()).toHaveLength(2); // C8a's git store's and Review's
    fold('src/staged.ts');
    main().state.uncommitted = { patch: APP_PATCH + STAGED_PATCH, files: [{ ...APP_FILES[0], insertions: 5 }, { path: 'src/staged.ts', oldPath: null, insertions: 1, deletions: 0, binary: false }] };
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(header()).toBe('3 files changed · +6 −0'));
    expect(reads()).toHaveLength(4); // one more each, the two events coalesced
    expect(paths()).toEqual(['src/app.ts', 'src/staged.ts', 'scratch.txt']);
    expect(folded('src/staged.ts')).toBe(true); // the person's fold stands
  });

  it('keeps a file’s drawn diff when a re-read changes another file (its diff object is kept while its text is equal)', async () => {
    main().state.status = statusOf({ dirty: true, files: DIRTY.files.slice(0, 2) });
    openReview();
    render(<TestHost />);
    await painted(() => (bodyOf('src/app.ts')?.querySelector('table') ?? null) !== null && (bodyOf('src/staged.ts')?.querySelector('table') ?? null) !== null);
    const appTable = bodyOf('src/app.ts')!.querySelector('table');
    const stagedTable = bodyOf('src/staged.ts')!.querySelector('table');
    const before = reads().length;
    main().state.uncommitted = { patch: APP_PATCH + STAGED_PATCH.replace('+export const staged = 1;', '+export const staged = 2;'), files: main().state.uncommitted.files };
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(reads()).toHaveLength(before + 2)); // the re-read, 250 ms on
    await painted(() => bodyOf('src/staged.ts')?.textContent?.includes('staged = 2') ?? false);
    expect(bodyOf('src/app.ts')!.querySelector('table')).toBe(appTable); // the same rows, not drawn again
    expect(bodyOf('src/staged.ts')!.querySelector('table')).not.toBe(stagedTable);
  });

  it('reads the scope afresh when the tab is selected again, and not on its first mount', async () => {
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(paths()).toHaveLength(3));
    await act(() => new Promise((resolve) => setTimeout(resolve, REVIEW_REFRESH_MS + 50)));
    expect(reads()).toHaveLength(2); // C8a's git store's and Review's own: the mount's focus request read nothing more
    act(() => panelHost.selectTab(panelOf(A)!.tabs[0].id)); // the host's focus request for the selected tab
    await waitFor(() => expect(reads()).toHaveLength(3));
  });

  it('says a file past the cap is too large and offers it at its first changed line', async () => {
    const lines = Array.from({ length: REVIEW_FILE_LINES_CAP + 1 }, (_, i) => `+line ${i}`);
    const big = ['diff --git a/big.ts b/big.ts', 'index 1..2 100644', '--- a/big.ts', '+++ b/big.ts', `@@ -3,0 +4,${lines.length} @@`, ...lines, ''].join('\n');
    main().state.uncommitted = { patch: big, files: [{ path: 'big.ts', oldPath: null, insertions: lines.length, deletions: 0, binary: false }] };
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(document.querySelector('[data-review-too-large]')?.textContent).toBe('Diff too large to display. Open the file'));
    expect(document.querySelector('[data-review-block]')).toBeNull();
    fireEvent.click(screen.getByText('Open the file'));
    expect(sideFiles()).toEqual([expect.objectContaining({ file: '/repo/big.ts', line: 4 })]);
    expect(mainFileTabs()).toEqual([]);
  });

  // P5 O7 M8 ("Untracked files"): an untracked file is read as Source control reads it, `git.diff`'s `untracked` scope
  // (the file against /dev/null), so it shows as added; one path serves this Mac's checkout and another machine's
  it('draws an untracked file as added from its own read, opens it at its first line, and drops its section once it is tracked', async () => {
    main().state.perFile['scratch.txt'] = {
      patch: ['diff --git a/scratch.txt b/scratch.txt', 'new file mode 100644', 'index 0000000..ce01362', '--- /dev/null', '+++ b/scratch.txt', '@@ -0,0 +1,2 @@', '+hello', '+there', ''].join('\n'),
      files: [{ path: 'scratch.txt', oldPath: null, insertions: 2, deletions: 0, binary: false }],
    };
    render(<TestHost />);
    openReview({ path: 'scratch.txt' });
    await painted(() => bodyOf('scratch.txt')?.textContent?.includes('there') ?? false);
    expect(reads('scratch.txt')).toEqual([{ directory: '/repo', scope: 'untracked', path: 'scratch.txt' }]);
    expect(document.querySelector('[data-review-note]')).toBeNull();
    fireEvent.click(inSection('scratch.txt', '[data-open-file]')!);
    expect(sideFiles()).toEqual([expect.objectContaining({ file: '/repo/scratch.txt', line: 1 })]);
    await showReview(); // UX wave U6b-1: the file is in view in Review's place
    const tracked = statusOf({ dirty: true, files: DIRTY.files.slice(0, 2) });
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: tracked, reason: 'worktree' }));
    await waitFor(() => expect(paths()).toEqual(['src/app.ts', 'src/staged.ts']));
  });

  it('past the scope cap, reads an unfolded file again after a refresh, and a marked one to hold its mark', async () => {
    main().state.uncommitted = { patch: APP_PATCH + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files: APP_FILES };
    main().state.status = statusOf({ dirty: true, files: [DIRTY.files[0]] });
    main().state.perFile = { 'src/app.ts': { patch: APP_PATCH, files: APP_FILES } };
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(sectionOf('src/app.ts')).not.toBeNull());
    fold('src/app.ts');
    await waitFor(() => expect(hunkLabel()).toBe('Showing hunk 1 of 2'));
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(reads('src/app.ts')).toHaveLength(2));
    await waitFor(() => expect(hunkLabel()).toBe('Showing hunk 1 of 2'));
    markViewed('src/app.ts');
    expect([viewed('src/app.ts'), folded('src/app.ts')]).toEqual([true, true]);
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(reads('src/app.ts')).toHaveLength(3)); // folded, but read to know whether the mark holds
    await act(tick);
    expect([viewed('src/app.ts'), folded('src/app.ts')]).toEqual([true, true]);
  });

  it('past the scope cap, a marked file that changes unfolds again, and stays folded where the person folded it', async () => {
    main().state.uncommitted = { patch: APP_PATCH + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files: APP_FILES };
    main().state.status = statusOf({ dirty: true, files: [DIRTY.files[0]] });
    main().state.perFile = { 'src/app.ts': { patch: APP_PATCH, files: APP_FILES } };
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(sectionOf('src/app.ts')).not.toBeNull());
    fold('src/app.ts');
    await waitFor(() => expect(hunkLabel()).toBe('Showing hunk 1 of 2'));
    markViewed('src/app.ts');
    expect([viewed('src/app.ts'), folded('src/app.ts')]).toEqual([true, true]);
    main().state.perFile = { 'src/app.ts': { patch: APP_PATCH.replace('+n', '+changed'), files: APP_FILES } };
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(reads('src/app.ts')).toHaveLength(2));
    await waitFor(() => expect(viewed('src/app.ts')).toBe(false));
    expect(folded('src/app.ts')).toBe(false); // the mark dropped: the cap's default does not fold it again
    markViewed('src/app.ts');
    fold('src/app.ts'); // the person's own choices: open, then closed
    fold('src/app.ts');
    expect([viewed('src/app.ts'), folded('src/app.ts')]).toEqual([true, true]);
    main().state.perFile = { 'src/app.ts': { patch: APP_PATCH.replace('+n', '+again'), files: APP_FILES } };
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(reads('src/app.ts')).toHaveLength(3));
    await waitFor(() => expect(viewed('src/app.ts')).toBe(false));
    expect(folded('src/app.ts')).toBe(true); // folded by the person, it stays folded
  });

  it('marks a binary file viewed over its header, and drops the mark, unfolding it, when the header changes', async () => {
    const binary = (index: string) => ({
      patch: `diff --git a/logo.png b/logo.png\nindex ${index} 100644\nBinary files a/logo.png and b/logo.png differ\n`,
      files: [{ path: 'logo.png', oldPath: null, insertions: 0, deletions: 0, binary: true }],
    });
    main().state.uncommitted = binary('1..2');
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(bodyOf('logo.png')?.textContent).toBe('Binary file'));
    markViewed('logo.png');
    expect([viewed('logo.png'), folded('logo.png')]).toEqual([true, true]);
    main().state.uncommitted = binary('1..3');
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(viewed('logo.png')).toBe(false));
    expect(folded('logo.png')).toBe(false);
  });

  it('past the scope cap, signs a binary’s mark over the header its own read answers, and drops it when the blob changes', async () => {
    const binary = (index: string) => ({
      patch: `diff --git a/logo.png b/logo.png\nindex ${index} 100644\nBinary files a/logo.png and b/logo.png differ\n`,
      files: [{ path: 'logo.png', oldPath: null, insertions: 0, deletions: 0, binary: true }],
    });
    const past = (index: string) => ({ patch: binary(index).patch + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files: binary(index).files });
    main().state.uncommitted = past('1..2');
    main().state.perFile = { 'logo.png': binary('1..2') };
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(sectionOf('logo.png')).not.toBeNull());
    expect(inSection('logo.png', '[data-review-viewed]')).toBeNull(); // nothing to sign until its header is read
    fold('logo.png');
    await waitFor(() => expect(inSection('logo.png', '[data-review-viewed]')).not.toBeNull());
    expect(reads('logo.png')).toHaveLength(1);
    markViewed('logo.png');
    expect(viewed('logo.png')).toBe(true);
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(reads('logo.png')).toHaveLength(2));
    await act(tick);
    expect(viewed('logo.png')).toBe(true); // the same blob: the mark stands
    main().state.uncommitted = past('1..3');
    main().state.perFile = { 'logo.png': binary('1..3') };
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(reads('logo.png')).toHaveLength(3));
    await waitFor(() => expect(viewed('logo.png')).toBe(false));
    expect(folded('logo.png')).toBe(false); // a mark that dropped unfolds its file, past the cap too
  });

  // P5 O7 M8 (e2e/code-tools.spec.ts's untracked rows): an untracked symlink reads as git shows one (services/git
  // service.ts `untrackedDiff`: mode 120000, its one added line the target's path), so Review draws that line, never the
  // target's content; an untracked file whose one hunk is past the file cap says it is too large, with Open the file
  it('draws an untracked symlink as its target’s path, and an untracked file past the cap as too large', async () => {
    main().state.perFile['scratch.txt'] = {
      patch: ['diff --git a/scratch.txt b/scratch.txt', 'new file mode 120000', 'index 0000000..ce01362', '--- /dev/null', '+++ b/scratch.txt', '@@ -0,0 +1 @@', '+/outside/secret.txt', '\\ No newline at end of file', ''].join('\n'),
      files: [{ path: 'scratch.txt', oldPath: null, insertions: 1, deletions: 0, binary: false }],
    };
    render(<TestHost />);
    openReview({ path: 'scratch.txt' });
    await painted(() => bodyOf('scratch.txt')?.textContent?.includes('/outside/secret.txt') ?? false);
    expect(document.querySelector('[data-review-note]')).toBeNull();
    const lines = Array.from({ length: REVIEW_FILE_LINES_CAP + 1 }, (_, i) => `+line ${i}`);
    main().state.perFile['scratch.txt'] = {
      patch: ['diff --git a/scratch.txt b/scratch.txt', 'new file mode 100644', 'index 0000000..ce01363', '--- /dev/null', '+++ b/scratch.txt', `@@ -0,0 +1,${lines.length} @@`, ...lines, ''].join('\n'),
      files: [{ path: 'scratch.txt', oldPath: null, insertions: lines.length, deletions: 0, binary: false }],
    };
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(inSection('scratch.txt', '[data-review-too-large]')?.textContent).toBe('Diff too large to display. Open the file'));
    expect(inSection('scratch.txt', '[data-review-block]')).toBeNull();
  });

  // P5 O7 M8 review: an untracked binary is read in the untracked scope like any untracked file; its read answers a binary
  // patch, so its mark signs that header (the new blob's `index` line), and a changed blob drops it
  it('signs an untracked binary’s mark over the header its read answers, and drops it when the blob changes', async () => {
    const binary = (index: string) => ({
      patch: `diff --git a/scratch.txt b/scratch.txt\nnew file mode 100644\nindex 0000000..${index}\nBinary files /dev/null and b/scratch.txt differ\n`,
      files: [{ path: 'scratch.txt', oldPath: null, insertions: 0, deletions: 0, binary: true }],
    });
    main().state.perFile['scratch.txt'] = binary('9fc36a0');
    render(<TestHost />);
    openReview({ path: 'scratch.txt' });
    await waitFor(() => expect(bodyOf('scratch.txt')?.textContent).toBe('Binary file'));
    markViewed('scratch.txt');
    expect([viewed('scratch.txt'), folded('scratch.txt')]).toEqual([true, true]);
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(reads('scratch.txt')).toHaveLength(2)); // folded, but read to know whether the mark holds
    await act(tick);
    expect([viewed('scratch.txt'), folded('scratch.txt')]).toEqual([true, true]); // the same blob: the mark stands
    main().state.perFile['scratch.txt'] = binary('76ca49d');
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(reads('scratch.txt')).toHaveLength(3));
    await waitFor(() => expect(viewed('scratch.txt')).toBe(false));
    expect(folded('scratch.txt')).toBe(false); // a mark that dropped unfolds its file
  });

  it('keeps viewed marks across unmounts and drops a mark, unfolding the file, when its hunks change', async () => {
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(inSection('src/app.ts', '[data-review-viewed]')).not.toBeNull());
    markViewed('src/app.ts');
    expect(viewed('src/app.ts')).toBe(true);
    act(() => panelHost.showSummary());
    expect(document.querySelector('[data-review]')).toBeNull();
    act(() => panelHost.selectTab(panelOf(A)!.tabs[0].id));
    await waitFor(() => expect(viewed('src/app.ts')).toBe(true));
    expect(folded('src/app.ts')).toBe(true);
    expect(inSection('src/app.ts', '[data-review-viewed]')!.getAttribute('aria-pressed')).toBe('true');
    expect(inSection('src/app.ts', '[data-review-viewed]')!.textContent).toBe('Viewed');
    main().state.uncommitted = { patch: APP_PATCH.replace('+n', '+changed'), files: APP_FILES };
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(viewed('src/app.ts')).toBe(false));
    expect(folded('src/app.ts')).toBe(false);
  });

  it('keeps the mode, a fold and a viewed mark under a pin across a session switch', async () => {
    const user = userEvent.setup();
    useSessions.setState((s) => ({ records: new Map(s.records).set(B, record(B, { directory: '/repo-b' })) }));
    render(<TestHost />);
    act(() => void panelHost.addTool('review', { appSessionId: A, pin: true }));
    await waitFor(() => expect(inSection('src/app.ts', '[data-review-viewed]')).not.toBeNull());
    markViewed('src/app.ts');
    fold('src/staged.ts');
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Split' }));
    act(() => useLayout.getState().openSession(B));
    act(() => panelHost.selectTab(useLayout.getState().panelPinned[0].id)); // B's own selection starts on the summary
    await waitFor(() => expect(main().callsOf('git.watch')).toContainEqual({ directory: '/repo-b' }));
    await waitFor(() => expect(header()).toBe('3 files changed · +3 −0'));
    expect([viewed('src/app.ts'), folded('src/staged.ts')]).toEqual([false, false]); // marks and folds are per directory and scope
    act(() => useLayout.getState().openSession(A));
    await waitFor(() => expect(viewed('src/app.ts')).toBe(true));
    expect(folded('src/staged.ts')).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-review]')!.dataset.mode).toBe('split');
  });

  it('shows Last turn from divider metadata and C6’s activity, the same with the turn collapsed and expanded', async () => {
    main().state.status = statusOf({ dirty: false }); // a clean tree: C8a's git store reads no diff either
    await attachTranscript(journalToEvents(loadSyntheticJournal('edit-and-receipt')));
    const divider = changedTurn();
    expect(useTranscriptStore.getState().rows(A).some((row) => row.kind === 'receipt')).toBe(false);
    expect(useTranscriptStore.getState().rows(A).some((row) => row.kind === 'group' || row.kind === 'cell')).toBe(false); // a closed turn collapses
    render(<TestHost />);
    openReview({ scope: 'turn', turnId: divider.turnId!, path: divider.files[1].path });
    await painted(() => (bodyOf(divider.files[1].path)?.querySelector('table') ?? null) !== null);
    expect(chips().map((c) => [c[0], c[2]])).toEqual([
      ['uncommitted', 'false'],
      ['branch', 'false'],
      ['turn', 'true'],
    ]);
    expect(header()).toBe('3 files changed · +7 −4');
    expect(paths()).toEqual([
      '/tmp/maws-synth-edit-and-receipt/src/app.ts',
      '/tmp/maws-synth-edit-and-receipt/src/store.ts',
      '/tmp/maws-synth-edit-and-receipt/src/util/rows.ts',
    ]);
    expect(pathOf('/tmp/maws-synth-edit-and-receipt/src/app.ts')).toBe('/tmp/maws-synth-edit-and-receipt/src/app.ts'); // outside the repository: absolute
    const collapsed = { paths: paths(), body: stackText() };
    expect(collapsed.body).toContain('+'); // an edit's added lines
    act(() => useTranscriptStore.getState().expandAll(A, { cells: true }));
    expect(useTranscriptStore.getState().rows(A).some((row) => row.kind === 'group' || row.kind === 'cell')).toBe(true);
    expect({ paths: paths(), body: stackText() }).toEqual(collapsed);
    expect(main().callsOf('git.diff')).toEqual([]); // Last turn reads no git
  });

  it('draws a Last turn file whose hunks carry unprefixed context lines (M4: edit-and-receipt’s src/app.ts)', async () => {
    main().state.status = statusOf({ dirty: false });
    await attachTranscript(journalToEvents(loadSyntheticJournal('edit-and-receipt')));
    const divider = changedTurn();
    render(<TestHost />);
    openReview({ scope: 'turn', turnId: divider.turnId!, path: divider.files[0].path });
    await painted(() => bodyOf(divider.files[0].path)?.textContent?.includes("import { store } from './store';") ?? false);
    expect(bodyOf(divider.files[0].path)!.textContent).toContain('measureRows');
  });

  it('shows a child agent’s edit from its own activity entry', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('a1', 'Agent', { description: 'Fix it', prompt: 'fix' }, 'm1', 0);
    b.emit('subagent.started', { taskId: task('agent-1'), toolUseId: tool('a1'), description: 'Fix it', subagentType: 'general-purpose', isBackground: false, spawnDepth: 1, prompt: 'fix' });
    const child = { parentToolUseId: parent('a1') };
    b.emit('tool.use', { toolUseId: tool('c1'), toolName: 'Edit', input: { file_path: '/repo/child.ts', old_string: 'alpha', new_string: 'omega' }, apiMessageId: api('mc'), messageUuid: uuid('mc-u0') }, child);
    const hunk = { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-alpha', '+omega'] };
    b.emit('tool.result', { toolUseId: tool('c1'), content: 'ok' as never, isError: false, structured: { filePath: '/repo/child.ts', structuredPatch: [hunk], userModified: false }, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: uuid('c1-result') }, child);
    b.emit('subagent.finished', { taskId: task('agent-1'), status: 'completed', summary: 'done', outputFile: null, reason: null });
    b.text('m2', 0, 'Done.');
    b.end(['u1']);
    await attachTranscript(b.events);
    const divider = changedTurn();
    render(<TestHost />);
    openReview({ scope: 'turn', turnId: divider.turnId! });
    await painted(() => stackText()?.includes('omega') ?? false);
    expect(paths()).toEqual(['/repo/child.ts']);
    await waitFor(() => expect([pathOf('/repo/child.ts'), badgeOf('/repo/child.ts'), countsOf('/repo/child.ts')]).toEqual(['child.ts', null, '+1 −1'])); // inside the repository: relative, once the status answers
    expect(stackText()).toContain('alpha');
    fireEvent.click(inSection('/repo/child.ts', '[data-open-file]')!);
    expect(sideFiles()).toEqual([expect.objectContaining({ file: '/repo/child.ts', line: 3 })]);
  });

  it('draws each edit of a file as its own block: a Write, an overlapping Edit, and a later edit above', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = builder();
    b.turn('u1');
    const file = '/repo/two.ts';
    const lines = Array.from({ length: 12 }, (_, i) => `l${i + 1}`);
    const edit = (id: string, name: string, input: Record<string, unknown>, hunk: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }, extra = {}) => {
      b.toolUse(id, name, { file_path: file, ...input }, `m-${id}`, 0);
      b.result(id, 'ok', { structured: { filePath: file, structuredPatch: [hunk], userModified: false, ...extra } });
    };
    edit('w1', 'Write', { content: `${lines.join('\n')}\n` }, { oldStart: 1, oldLines: 0, newStart: 1, newLines: 12, lines: lines.map((l) => `+${l}`) }, { type: 'create', originalFile: null });
    edit('e1', 'Edit', { old_string: 'l8', new_string: 'EIGHT' }, { oldStart: 7, oldLines: 5, newStart: 7, newLines: 5, lines: [' l7', '-l8', '+EIGHT', ' l9', ' l10', ' l11'] });
    edit('e2', 'Edit', { old_string: 'l3', new_string: 'l3\nABOVE' }, { oldStart: 2, oldLines: 3, newStart: 2, newLines: 4, lines: [' l2', ' l3', '+ABOVE', ' l4'] });
    b.text('m9', 0, 'Done.');
    b.end(['u1']);
    main().state.status = statusOf({ dirty: false });
    await attachTranscript(b.events);
    const divider = changedTurn();
    render(<TestHost />);
    openReview({ scope: 'turn', turnId: divider.turnId! });
    await waitFor(() => expect(document.querySelectorAll('[data-review-block]')).toHaveLength(3));
    await waitFor(() => expect(hunkLabel()).toBe('Showing hunk 1 of 3'));
    for (const text of ['+l12', '+EIGHT', '+ABOVE']) expect(stackText()).toContain(text); // every edit's hunk drawn
    fireEvent.click(screen.getByLabelText('Next hunk'));
    fireEvent.click(screen.getByLabelText('Next hunk'));
    expect(hunkLabel()).toBe('Showing hunk 3 of 3');
    fireEvent.click(inSection(file, '[data-open-file]')!);
    expect(sideFiles()).toEqual([expect.objectContaining({ file, line: 4 })]); // the third block's own numbers
    // No warning from the diff view, save the store library's own timing note, which a loaded machine triggers.
    const warned = warn.mock.calls.filter(([first]) => !(typeof first === 'string' && first.startsWith('[reactivity-store]')));
    expect(warned).toEqual([]);
    warn.mockRestore();
  });

  it('recomputes Last turn only when the turn itself changes', async () => {
    let push: (batch: SessionEvent[]) => void = () => {};
    const events = journalToEvents(loadSyntheticJournal('edit-and-receipt'));
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: (listener) => ((push = listener), () => {}), snapshot: () => Promise.resolve(events) }));
    const divider = changedTurn();
    const { result } = renderHook(() => useReviewData({ appSessionId: A, directory: '/repo', scope: 'turn', turnId: divider.turnId! }));
    const before = result.current.list;
    expect(before).toMatchObject({ phase: 'ready', files: [
      { path: '/tmp/maws-synth-edit-and-receipt/src/app.ts', kind: 'modified', added: 1, removed: 1 },
      { path: '/tmp/maws-synth-edit-and-receipt/src/store.ts', kind: 'modified', added: 3, removed: 3 },
      { path: '/tmp/maws-synth-edit-and-receipt/src/util/rows.ts', kind: 'added', added: 3, removed: 0 },
    ] });
    const next = builder('2026-09-28T11:00:00.000Z');
    next.turn('u-next');
    act(() => push(next.events)); // another turn starts and streams
    expect(useTranscriptStore.getState().entries[A].state.order).toHaveLength(2);
    expect(result.current.list).toBe(before);
  });

  it('says the turn is not loaded when the transcript store holds no such turn', async () => {
    render(<TestHost />);
    openReview({ scope: 'turn', turnId: T });
    await waitFor(() => expect(document.querySelector('[data-review-unavailable]')?.textContent).toBe('Diff unavailable: the turn is not loaded · Open the session'));
  });

  it('brings a requested file’s section to the top and unfolds it, re-targeting the shown Review in place', async () => {
    await attachTranscript(journalToEvents(loadSyntheticJournal('edit-and-receipt')));
    const divider = changedTurn();
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(paths()).toHaveLength(3));
    fold('src/staged.ts');
    const shell = document.querySelector('[data-review]');
    const page = fakeStackLayout({ viewport: 60 });
    try {
      await page.settle();
      openReview({ scope: 'uncommitted', path: 'src/staged.ts' });
      await page.settle();
      expect(folded('src/staged.ts')).toBe(false);
      const top = page.topOf(sectionOf('src/staged.ts')!);
      expect(top).toBeGreaterThan(0);
      expect(stack()!.scrollTop).toBe(top);
      openReview(); // an open with no params decides nothing new: the scope and the place stand
      await waitFor(() => expect(chipOf('uncommitted')?.getAttribute('aria-pressed')).toBe('true'));
      await page.settle();
      expect(stack()!.scrollTop).toBe(top);
      expect(document.querySelector('[data-review]')).toBe(shell); // re-targeted in place, never unmounted
      expect(panelOf(A)?.tabs).toHaveLength(1);
    } finally {
      page.restore();
    }
    act(() => codeTranscriptActions.reviewChanges(divider.turnId!, divider.files[2].path));
    await waitFor(() => expect(chipOf('turn')?.getAttribute('aria-pressed')).toBe('true'));
    expect(paths()).toContain(divider.files[2].path);
    expect(panelOf(A)?.tabs).toHaveLength(1);
  });

  // UX wave U8c-2 (M4 decision 5, §I): a change of the session's working folder starts Review over there (the scope decided
  // again); the viewed marks and folds are the checkout's, found again on return.
  it('starts over in the agent’s new folder, and finds a checkout’s viewed marks again on return', async () => {
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(inSection('src/app.ts', '[data-review-viewed]')).not.toBeNull());
    markViewed('src/app.ts'); // in /repo
    expect(viewed('src/app.ts')).toBe(true);
    fireEvent.click(chipOf('staged')!);
    await waitFor(() => expect(paths()).toEqual(['src/staged.ts']));
    moveTo(WT);
    await waitFor(() => expect(main().callsOf('git.diff')).toContainEqual({ directory: WT, scope: 'all' }));
    await waitFor(() => expect(chipOf('uncommitted')?.getAttribute('aria-pressed')).toBe('true')); // decided again for the new folder
    await waitFor(() => expect(paths()).toEqual(['src/app.ts', 'src/staged.ts', 'scratch.txt']));
    expect(viewed('src/app.ts')).toBe(false); // marked in the other checkout
    moveTo(null);
    await waitFor(() => expect(viewed('src/app.ts')).toBe(true));
  });

  // Held open: a re-read of the folder left behind is still out when the agent moves; it lands and changes nothing shown.
  it('drops a diff still loading for the folder left behind; the new folder’s files are shown', async () => {
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(paths()).toHaveLength(3));
    const late = deferred<ReturnType<typeof ok>>();
    let held = 0;
    main().state.diff = (input) => {
      if (input.directory !== '/repo' || input.path !== undefined) return undefined;
      held += 1;
      return late.promise;
    };
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(held).toBeGreaterThan(1)); // the card's diff and Review's re-read of /repo, both out
    moveTo(WT);
    await waitFor(() => expect(main().callsOf('git.diff')).toContainEqual({ directory: WT, scope: 'all' }));
    await waitFor(() => expect(paths()).toEqual(['src/app.ts', 'src/staged.ts', 'scratch.txt']));
    late.resolve(ok({ patch: STAGED_PATCH, files: [{ path: 'src/staged.ts', oldPath: null, insertions: 1, deletions: 0, binary: false }] }));
    await act(tick);
    expect(paths()).toEqual(['src/app.ts', 'src/staged.ts', 'scratch.txt']);
    expect(header()).toBe('3 files changed · +3 −0');
  });

  // UX wave U8b (A8, l5-code-16): the line is a control named Open changes, its counts its description, and Environment is open
  it('fills the Environment card’s change line with the staged count, as a control that opens Review', async () => {
    render(<QueryClientProvider client={queryClient}><FloatingSummary appSessionId={A} /><TestHost /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId('change-line').textContent).toBe('+3 −0 across 3 files · 1 untracked · 1 staged'));
    const line = screen.getByRole('button', { name: 'Open changes', description: '+3 −0 across 3 files · 1 untracked · 1 staged' });
    expect(line.textContent).toBe('+3 −0 across 3 files · 1 untracked · 1 staged›');
    fireEvent.click(line);
    await waitFor(() => expect(header()).toBe('3 files changed · +3 −0'));
    expect(paths()).toEqual(['src/app.ts', 'src/staged.ts', 'scratch.txt']);
  });
});

// UX wave U5b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, M9; §E): "This branch" is the
// working tree against the merge base with the repository's default branch, for every session, and a new file's lines are
// counted, in its header and in the totals. The machine serves the reads (its `capabilities` list `rl2.git-reads`).
describe('This branch and the new files counted (UX wave U5b-2)', () => {
  const offs: (() => void)[] = [];
  const MERGE_BASE = '9d0c1b2a39485766a5b4c3d2e1f0a9b8c7d6e5f4';
  const FEATURE = statusOf({
    branch: 'feature/x',
    upstream: 'origin/feature/x',
    dirty: true,
    files: [
      { path: 'src/app.ts', oldPath: null, index: '.', worktree: 'M', untracked: false },
      { path: 'notes/berths.md', oldPath: null, index: '?', worktree: '?', untracked: true },
    ],
  });
  const COMMITTED = ['diff --git a/src/committed.ts b/src/committed.ts', 'index 5..6 100644', '--- a/src/committed.ts', '+++ b/src/committed.ts', '@@ -1,2 +1,3 @@', ' one', '+two', ' three', ''].join('\n');
  const COMMITTED_FILE = { path: 'src/committed.ts', oldPath: null, insertions: 1, deletions: 0, binary: false };
  const UNTRACKED = [{ path: 'notes/berths.md', insertions: 12, binary: false }];
  const branchAnswer = (over: Record<string, unknown> = {}) =>
    ok({ base: { ref: 'origin/main', mergeBase: MERGE_BASE }, upstream: 'origin/feature/x', commits: [], counts: { all: 1, notPushed: 1, pushed: 0 }, behind: 0, ...over });
  const serveReads = (capabilities: string[] = ['rl2.git-reads']) =>
    useMachines.getState().applyRoster([{ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-15T10:00:00.000Z', generation: 0, capabilities }]);

  beforeAll(async () => {
    await import('./FileBody');
  });
  beforeEach(() => {
    resetPanelStores();
    useReview.getState().reset();
    resetDiffTabs();
    useViewer.getState().reset();
    useBranchReads.getState().reset();
    current = reviewMain({ status: FEATURE, uncommitted: { patch: APP_PATCH, files: APP_FILES } }); // git.diff's answer where the reads are not served
    main().state.branch = () => branchAnswer();
    main().state.since = (input) =>
      ok(input.against === 'HEAD' ? { patch: APP_PATCH, files: APP_FILES, untracked: UNTRACKED } : { patch: COMMITTED + APP_PATCH, files: [COMMITTED_FILE, ...APP_FILES], untracked: UNTRACKED });
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/repo' })) }));
    offs.push(connectPanelEvents(), registerPanelTool(reviewTool), registerPanelTool(filesTool));
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
    useBranchReads.getState().reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows a new file of twelve lines as "+12" beside "Untracked", and counts it in the totals, in Uncommitted and in This branch', async () => {
    serveReads();
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(paths()).toEqual(['src/app.ts', 'notes/berths.md']));
    expect(main().callsOf('git.changesSince')).toContainEqual({ directory: '/repo', against: 'HEAD' });
    expect(badgeOf('notes/berths.md')).toBe('Untracked');
    expect(countsOf('notes/berths.md')).toBe('+12');
    expect(header()).toBe('2 files changed · +14 −0');
    fireEvent.click(chipOf('branch')!);
    await waitFor(() => expect(paths()).toEqual(['src/committed.ts', 'src/app.ts', 'notes/berths.md']));
    expect(countsOf('notes/berths.md')).toBe('+12');
    expect(header()).toBe('3 files changed · +15 −0');
  });

  it('for a session in the main checkout on a feature branch: This branch is enabled, measured against the merge base with the default branch, and its footer reads "feature/x · Since origin/main"', async () => {
    serveReads();
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(chipOf('branch')?.disabled).toBe(false));
    fireEvent.click(chipOf('branch')!);
    await waitFor(() => expect(footer()).toBe('feature/x · Since origin/main'));
    expect(main().callsOf('git.changesSince')).toContainEqual({ directory: '/repo', against: MERGE_BASE });
    expect(main().callsOf('git.worktree.branch')).toEqual([]);
    expect(paths()).toEqual(['src/committed.ts', 'src/app.ts', 'notes/berths.md']); // a committed change, an uncommitted edit and a new file
  });

  it('measures a worktree session against the same default branch, not what the main checkout has checked out', async () => {
    main().state.status = statusOf({ ...FEATURE, isWorktree: true, branch: 'feature/y', dirty: false, files: [] });
    serveReads();
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(footer()).toBe('feature/y · Since origin/main')); // a clean tree opens on This branch
    expect(main().callsOf('git.worktree.branch')).toEqual([]);
  });

  it('reads This branch again when the branch read answers another merge base', async () => {
    const MOVED = '1111111111111111111111111111111111111111';
    serveReads();
    openReview({ scope: 'branch' });
    render(<TestHost />);
    await waitFor(() => expect(main().callsOf('git.changesSince')).toContainEqual({ directory: '/repo', against: MERGE_BASE }));
    main().state.branch = () => branchAnswer({ base: { ref: 'origin/main', mergeBase: MOVED }, behind: 2 });
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: FEATURE, reason: 'refs' }));
    await waitFor(() => expect(main().callsOf('git.changesSince')).toContainEqual({ directory: '/repo', against: MOVED }));
  });

  it('ends the totals with the new files not counted past the caps', async () => {
    main().state.status = statusOf({ ...FEATURE, files: [...FEATURE.files, { path: 'big.csv', oldPath: null, index: '?', worktree: '?', untracked: true }, { path: 'more.md', oldPath: null, index: '?', worktree: '?', untracked: true }] });
    main().state.since = () => ok({ patch: APP_PATCH, files: APP_FILES, untracked: [...UNTRACKED, { path: 'big.csv', insertions: null, binary: false }] }); // big.csv past its byte cap, more.md past the count's files
    serveReads();
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(header()).toBe('4 files changed · +14 −0, and 2 untracked files not counted'));
    expect(countsOf('big.csv')).toBeNull();
    expect(countsOf('more.md')).toBeNull();
  });

  it('where the machine does not serve the reads, reads Uncommitted with git.diff, its new files uncounted and named in the totals, and turns This branch off with its sentence (R2)', async () => {
    serveReads(['rl2.project-acts']);
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(header()).toBe('2 files changed · +2 −0, and 1 untracked file not counted'));
    expect(chips().find((c) => c[0] === 'branch')).toEqual(['branch', true, 'false', "This branch needs this Mac's MAWS service to be updated"]);
    expect(countsOf('notes/berths.md')).toBeNull();
    expect(reads()).toContainEqual({ directory: '/repo', scope: 'all' });
    expect(main().callsOf('git.changesSince')).toEqual([]);
    expect(main().callsOf('git.branchCommits')).toEqual([]);
  });

  it('while whether the machine serves the reads is not known, asks none of them and reads Uncommitted as today, with no word of uncounted files', async () => {
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(header()).toBe('2 files changed · +2 −0'));
    expect(chips().find((c) => c[0] === 'branch')).toEqual(['branch', true, 'false', '']);
    for (const name of ['git.changesSince', 'git.branchCommits', 'git.commitDiff'] as const) expect(main().callsOf(name)).toEqual([]);
  });

  // ---- a commit in Review (S13, S14, S16 to S18, S20, S22) -----------------------------------------------------------------
  const SHA = '3f9a1c27b84e5d60a1f2c3b4d5e6f708192a3b4c';
  const OTHER_SHA = 'aa11bb22cc33dd44ee55ff6600778899aabbccdd';
  const commitOf = (sha: string, over: Record<string, unknown> = {}) => ({ sha, shortSha: sha.slice(0, 7), author: 'Ada', authoredAt: '2026-11-14T10:00:00.000Z', subject: 'Quote the berth names', parents: ['0000000000000000000000000000000000000001'], ...over });
  const commitAnswer = (sha: string, onHead = true, over: Record<string, unknown> = {}) => ok({ commit: commitOf(sha, over), onHead, patch: COMMITTED + APP_PATCH, files: [COMMITTED_FILE, ...APP_FILES] });
  const openCommitted = (commit: string, path?: string) => act(() => void panelHost.addTool('review', { appSessionId: A, params: { scope: 'commit', commit, ...(path ? { path } : {}) } }));

  it('opens a commit: its chip listed and pressed, its subject the title, the totals without a scope word, its files, and its footer; HEAD moving asks one membership check, whose answer ends the footer (S13, S17)', async () => {
    serveReads();
    main().state.commits = (input) => (input.patch === false ? ok({ commit: commitOf(SHA), onHead: false, patch: '', files: [] }) : commitAnswer(SHA));
    openCommitted(SHA, 'src/app.ts');
    render(<TestHost />);
    await waitFor(() => expect(footer()).toBe('Commit 3f9a1c2 · Quote the berth names'));
    expect(chips().find((c) => c[0] === 'commit')).toEqual(['commit', false, 'true', 'Quote the berth names']);
    expect(chipOf('commit')!.textContent).toBe('Commit 3f9a1c2');
    expect(header()).toBe('2 files changed · +3 −0');
    expect(paths()).toEqual(['src/committed.ts', 'src/app.ts']);
    expect(main().callsOf('git.commitDiff')).toEqual([{ directory: '/repo', commit: SHA }]);
    const amended = { ...FEATURE, head: 'fedcba9876543210' };
    main().state.status = amended;
    act(() => main().emit('git.changed', { repoRoot: '/repo', status: amended, reason: 'head' }));
    await waitFor(() => expect(footer()).toBe('Commit 3f9a1c2 · Quote the berth names · not on feature/x now'));
    expect(main().callsOf('git.commitDiff')).toEqual([
      { directory: '/repo', commit: SHA },
      { directory: '/repo', commit: SHA, patch: false },
    ]);
  });

  it('says a merge commit is read against its first parent, and a detached HEAD’s commit is not in HEAD now', async () => {
    serveReads();
    main().state.status = statusOf({ ...FEATURE, branch: null });
    main().state.commits = () => commitAnswer(SHA, false, { parents: ['0000000000000000000000000000000000000001', '0000000000000000000000000000000000000002'] });
    openCommitted(SHA);
    render(<TestHost />);
    await waitFor(() => expect(footer()).toBe('Commit 3f9a1c2 · Quote the berth names · against its first parent · not in HEAD now'));
  });

  it('holds the commit’s read open: This branch chosen meanwhile is shown and the chip stays listed; chosen again, the chip reads nothing more; a second commit replaces it, the first answer dropped (async 2, S14)', async () => {
    serveReads();
    const first = deferred<ReturnType<typeof ok>>();
    main().state.commits = (input) => (input.commit === SHA ? first.promise : commitAnswer(OTHER_SHA));
    openCommitted(SHA);
    render(<TestHost />);
    await waitFor(() => expect(main().callsOf('git.commitDiff')).toHaveLength(1));
    fireEvent.click(chipOf('branch')!);
    await waitFor(() => expect(footer()).toBe('feature/x · Since origin/main'));
    expect(chipOf('commit')?.getAttribute('aria-pressed')).toBe('false');
    first.resolve(commitAnswer(SHA));
    await waitFor(() => expect(chipOf('commit')?.title).toBe('Quote the berth names'));
    fireEvent.click(chipOf('commit')!);
    await waitFor(() => expect(paths()).toEqual(['src/committed.ts', 'src/app.ts']));
    expect(main().callsOf('git.commitDiff')).toHaveLength(1); // one read in all

    const THIRD_SHA = 'cc33dd44ee55ff6600778899aabbccddeeff0011';
    const late = deferred<ReturnType<typeof ok>>();
    main().state.commits = (input) => (input.commit === THIRD_SHA ? late.promise : commitAnswer(OTHER_SHA, true, { subject: 'Name the berth columns' }));
    openCommitted(THIRD_SHA); // its read held open
    await waitFor(() => expect(main().callsOf('git.commitDiff')).toHaveLength(2));
    openCommitted(OTHER_SHA);
    await waitFor(() => expect(chipOf('commit')?.textContent).toBe('Commit aa11bb2'));
    late.resolve(commitAnswer(THIRD_SHA, true, { subject: 'A late answer' }));
    await waitFor(() => expect(footer()).toBe('Commit aa11bb2 · Name the berth columns'));
    expect(chips().filter((c) => c[0] === 'commit')).toEqual([['commit', false, 'true', 'Name the berth columns']]);
  });

  it('keeps a commit’s marks its own: a file marked Viewed in one commit is not marked in another or in This branch (S18)', async () => {
    serveReads();
    main().state.commits = (input) => commitAnswer(input.commit as string);
    openCommitted(SHA);
    render(<TestHost />);
    await waitFor(() => expect(paths()).toEqual(['src/committed.ts', 'src/app.ts']));
    markViewed('src/app.ts');
    await waitFor(() => expect(viewed('src/app.ts')).toBe(true));
    openCommitted(OTHER_SHA);
    await waitFor(() => expect(chipOf('commit')?.textContent).toBe('Commit aa11bb2'));
    await waitFor(() => expect(paths()).toEqual(['src/committed.ts', 'src/app.ts']));
    expect(viewed('src/app.ts')).toBe(false);
    fireEvent.click(chipOf('branch')!);
    await waitFor(() => expect(paths()).toEqual(['src/committed.ts', 'src/app.ts', 'notes/berths.md']));
    expect(viewed('src/app.ts')).toBe(false);
  });

  it('a diff tab whose ref names a commit on a machine without the reads says so and sends nothing (S20)', async () => {
    serveReads([]);
    const tab = { kind: 'diff' as const, id: 'diff-commit', appSessionId: A, ref: `commit:${SHA}`, pinned: false };
    render(<DiffTab tab={tab} />);
    await waitFor(() => expect(document.querySelector('[data-review-unavailable]')?.textContent).toBe("Diff unavailable: this Mac's MAWS service is older than this window"));
    expect(main().callsOf('git.commitDiff')).toEqual([]);
  });

  it('a commit’s read that failed offline says so with Retry, which brings the diff; so does the machine heard again (S22)', async () => {
    serveReads();
    let fails = true;
    main().state.commits = () => (fails ? ({ ok: false, error: { code: 'host_unavailable', message: 'the link dropped' } } as never) : commitAnswer(SHA));
    openCommitted(SHA);
    render(<TestHost />);
    await waitFor(() => expect(document.querySelector('[data-review-unavailable]')?.textContent).toBe('Diff unavailable: This Mac is offlineRetry'));
    fails = false;
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-review-retry]')!);
    await waitFor(() => expect(paths()).toEqual(['src/committed.ts', 'src/app.ts']));
    expect(main().callsOf('git.commitDiff')).toHaveLength(2);

    act(() => useReview.getState().reset());
    fails = true;
    openCommitted(OTHER_SHA);
    await waitFor(() => expect(document.querySelector('[data-review-retry]')).not.toBeNull());
    const calls = main().callsOf('git.commitDiff').length;
    fails = false;
    act(() => useMachines.getState().applyRoster([{ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'down', since: '2026-11-15T10:01:00.000Z', generation: 0, capabilities: ['rl2.git-reads'] }]));
    act(() => useMachines.getState().applyRoster([{ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-15T10:02:00.000Z', generation: 1, capabilities: ['rl2.git-reads'] }]));
    await waitFor(() => expect(main().callsOf('git.commitDiff')).toHaveLength(calls + 1));
    await waitFor(() => expect(paths()).toEqual(['src/committed.ts', 'src/app.ts']));
  });

  // UX wave U5b-2 fix 1 (Decision Log 37): an empty commit's words, where Uncommitted's empty message stands
  it('says “No changes in this commit” for a commit with no change against its first parent', async () => {
    serveReads();
    main().state.commits = () => ok({ commit: commitOf(SHA), onHead: true, patch: '', files: [] });
    openCommitted(SHA);
    render(<TestHost />);
    await waitFor(() => expect(document.querySelector('[data-review-empty]')?.textContent).toBe('No changes in this commit'));
    expect(footer()).toBe('Commit 3f9a1c2 · Quote the berth names');
  });
});

describe('a file’s diff body', () => {
  afterEach(cleanup);

  it('keeps the app standing when the diff view cannot parse a block, saying so in the block (M4)', async () => {
    const { default: FileBody } = await import('./FileBody');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = (blocks: string[][]) => blocks.map((hunks) => ({ oldFile: { fileName: 'a.ts' }, newFile: { fileName: 'a.ts' }, hunks: diffViewHunks({ path: 'a.ts', oldPath: null, hunks }) }));
    render(<FileBody path="a.ts" data={data([['@@ -1,1 +1,1 @@\nnot a diff line'], ['@@ -1 +1 @@\n-a\n+b']])} mode="unified" wrap={false} />);
    await waitFor(() => expect(document.body.textContent).toContain('Diff unavailable: Malformed diff, empty hunk'));
    expect(document.querySelectorAll('[data-review-block]')).toHaveLength(2); // the other block still draws
    errors.mockRestore();
  });

  it('draws a block again once its diff changes after the diff view could not parse it', async () => {
    const { default: FileBody } = await import('./FileBody');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = (blocks: string[][]) => blocks.map((hunks) => ({ oldFile: { fileName: 'a.ts' }, newFile: { fileName: 'a.ts' }, hunks: diffViewHunks({ path: 'a.ts', oldPath: null, hunks }) }));
    const { rerender } = render(<FileBody path="a.ts" data={data([['@@ -1,1 +1,1 @@\nnot a diff line']])} mode="unified" wrap={false} />);
    await waitFor(() => expect(document.body.textContent).toContain('Diff unavailable: Malformed diff, empty hunk'));
    rerender(<FileBody path="a.ts" data={data([['@@ -1 +1 @@\n-before\n+after']])} mode="unified" wrap={false} />);
    await waitFor(() => expect(document.body.textContent).toContain('after'));
    expect(document.body.textContent).not.toContain('Diff unavailable');
    errors.mockRestore();
  });
});

describe('review diff tab', () => {
  const offs: (() => void)[] = [];
  beforeEach(() => {
    resetPanelStores();
    useReview.getState().reset();
    resetDiffTabs();
    current = reviewMain();
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/repo' })) }));
    offs.push(connectPanelEvents());
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
  });
  const diffTab = (ref: string) => ({ id: `diff:${A}:${ref}`, kind: 'diff' as const, appSessionId: A, ref, pinned: false });

  it('draws the same stack for a ref, with no chips', async () => {
    render(<DiffTab tab={diffTab('uncommitted @ src/staged.ts')} />);
    await waitFor(() => expect(paths()).toEqual(['src/app.ts', 'src/staged.ts', 'scratch.txt']));
    expect(header()).toBe('3 files changed · +3 −0');
    expect(chips()).toEqual([]);
    expect(folded('src/staged.ts')).toBe(false);
  });

  it('refuses a path outside the repository and opens nothing', async () => {
    render(<DiffTab tab={diffTab('uncommitted @ /etc/hosts')} />);
    await waitFor(() => expect(document.querySelector('[data-review-refused]')?.textContent).toBe("Refused: path outside the session's directories/etc/hosts"));
    expect(paths()).toEqual(['src/app.ts', 'src/staged.ts', 'scratch.txt']);
    expect(sideFiles()).toEqual([]);
    expect(mainFileTabs()).toEqual([]);
  });

  it('forgets a closed tab’s view: reopened, it starts again from its ref', async () => {
    const ref = 'uncommitted @ src/staged.ts';
    act(() => useLayout.getState().openTab({ kind: 'diff', appSessionId: A, ref }));
    const tab = currentSet(useLayout.getState().main).panes[0].tabs.find((t) => t.kind === 'diff')!;
    const { unmount } = render(<DiffTab tab={tab as ReturnType<typeof diffTab>} />);
    await waitFor(() => expect(paths()).toHaveLength(3));
    fold('src/app.ts');
    unmount();
    act(() => useLayout.getState().closeTab(tab.id));
    act(() => useLayout.getState().openTab({ kind: 'diff', appSessionId: A, ref }));
    render(<DiffTab tab={tab as ReturnType<typeof diffTab>} />);
    await waitFor(() => expect(paths()).toHaveLength(3));
    expect(folded('src/app.ts')).toBe(false);
  });

  // UX wave U8c-2 (M4 decision 5): a diff tab does as the tool does at a move, starting again from its ref.
  it('starts again from its ref when the agent’s working folder changes', async () => {
    main().state.diff = (input) => (input.directory === WT && input.path === undefined ? Promise.resolve(ok({ patch: STAGED_PATCH, files: [{ path: 'src/staged.ts', oldPath: null, insertions: 1, deletions: 0, binary: false }] })) : undefined);
    render(<DiffTab tab={diffTab('uncommitted @ src/staged.ts')} />);
    await waitFor(() => expect(paths()).toHaveLength(3));
    moveTo(WT);
    await waitFor(() => expect(main().callsOf('git.diff')).toContainEqual({ directory: WT, scope: 'all' }));
    await waitFor(() => expect(paths()).toEqual(['src/staged.ts', 'scratch.txt']));
    expect(document.querySelector<HTMLElement>('[data-review]')!.dataset.scope).toBe('uncommitted');
  });

  // Fix wave 1 (the architect's ruling a): the ref's file has no change in the folder the agent moved to. The tab shows
  // that folder's changes, with nothing of the old folder's file and no error.
  it('shows the new folder’s changes when its ref’s file has none there, with nothing of the old folder and no error', async () => {
    const OTHER_PATCH = APP_PATCH.replaceAll('src/app.ts', 'src/other.ts');
    main().state.diff = (input) => (input.directory === WT && input.path === undefined ? Promise.resolve(ok({ patch: OTHER_PATCH, files: [{ ...APP_FILES[0], path: 'src/other.ts' }] })) : undefined);
    render(<DiffTab tab={diffTab('uncommitted @ src/staged.ts')} />);
    await painted(() => bodyOf('src/staged.ts')?.textContent?.includes('export const staged = 1;') ?? false);
    moveTo(WT);
    await waitFor(() => expect(paths()).toEqual(['src/other.ts', 'scratch.txt'])); // the fake's status lists scratch.txt untracked in every folder
    expect(header()).toBe('2 files changed · +2 −0');
    expect(document.body.textContent).not.toContain('src/staged.ts');
    expect(document.body.textContent).not.toContain('export const staged = 1;');
    expect(document.querySelector('[data-review-refused]')).toBeNull();
    expect(document.querySelector('[data-review-unavailable]')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('says why a ref does not parse or names a turn not loaded', async () => {
    const { unmount } = render(<DiffTab tab={diffTab('everything')} />);
    expect(document.querySelector('[data-review-unavailable]')?.textContent).toBe('Diff unavailable: unknown refeverything');
    unmount();
    render(<DiffTab tab={diffTab(formatRef(T))} />);
    await waitFor(() => expect(document.querySelector('[data-review-unavailable]')?.textContent).toBe('Diff unavailable: the turn is not loaded · Open the session'));
  });
});
