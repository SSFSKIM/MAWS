// Review (C8c execution document, M3): the patch split per file, the pure model (scopes, the ref grammar, the first
// changed line, the caps, the file lists), and the tool over C8a's host with a fake X2 client and a seeded transcript
// store.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { GitStatus } from '@shared/ipc/schema/git';
import { record } from '../../../../../../test/support/builders';
import { loadSyntheticJournal } from '../../../../../../test/support/fixtures';
import { connectPanelEvents } from '../../../ipc/events';
import { panelHost, registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { fail, installFakeMain, ok } from '../../../test-support/code';
import { A, B, panelOf, resetPanelStores, TestHost } from '../../../test-support/panel';
import { useTranscriptStore, type TranscriptSource, type TurnActivity, type TurnId } from '../../../transcript';
import { journalToEvents } from '../../../transcript/dev/journal';
import { api, builder, parent, task, tool, uuid } from '../../../transcript/model/test-events';
import { codeTranscriptActions } from '../open-file';
import { useViewer } from '../viewer/viewer-store';
import { DiffTab, resetDiffTabs } from './DiffTab';
import { baseOf, createReviewStore, diffOf, fileDiffOf, REVIEW_REFRESH_MS, useReview, useReviewData } from './review-store';
import { reviewTool } from './ReviewTool';
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
    expect(parseRef('uncommitted @ src/app.ts')).toEqual({ scope: 'uncommitted', turnId: null, path: 'src/app.ts' });
    expect(parseRef('staged')).toEqual({ scope: 'staged', turnId: null, path: null });
    expect(parseRef(formatRef('branch'))).toEqual({ scope: 'branch', turnId: null, path: null });
    expect(parseRef(formatRef(T, 'a @ b.ts'))).toEqual({ scope: 'turn', turnId: T, path: 'a @ b.ts' });
    expect(parseRef(formatRef(T))).toEqual({ scope: 'turn', turnId: T, path: null });
    for (const bad of ['', 'turn', 'turn:', 'everything', 'uncommitted @ ', 'Uncommitted']) expect(parseRef(bad), bad).toBeNull();
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
    expect(gitScopeFiles({ scope: 'branch', repoRoot: '/repo', files, patch: null, status }).map((r) => r.hunks)).toEqual([null, null, null]);
  });

  it('lists Last turn from the receipt, each file’s hunks from its edited entries joined on the edit’s own path', () => {
    const receipt: ChangedFile[] = [
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
    const rows = turnScopeFiles(receipt, activity);
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
    const store = createReviewStore(main.bridge);
    const offs = [
      store.getState().hold({ directory: DIR, scope: 'uncommitted', base: null }),
      store.getState().hold({ directory: DIR, scope: 'uncommitted', base: null }),
      store.getState().hold({ directory: DIR, scope: 'staged', base: null }),
      store.getState().hold({ directory: DIR, scope: 'branch', base: 'main' }),
    ];
    await tick();
    expect(main.callsOf('git.diff')).toEqual([
      { directory: DIR, scope: 'all' },
      { directory: DIR, scope: 'staged' },
      { directory: DIR, scope: 'all', base: 'main' },
    ]);
    const slice = diffOf(store.getState(), { directory: DIR, scope: 'uncommitted', base: null });
    expect(slice?.status).toBe('ok');
    expect(slice?.status === 'ok' && [...slice.patch!.keys()]).toEqual(['src/app.ts']);
    offs.forEach((off) => off());
    expect(diffOf(store.getState(), { directory: DIR, scope: 'uncommitted', base: null })).toBeUndefined();
  });

  it('re-reads a held scope once, 250 ms after the last new status for its directory, and once more for a change during a read', async () => {
    vi.useFakeTimers();
    const gate: { held: boolean; release: (() => void) | null } = { held: false, release: null };
    const main = installFakeMain(async (name) => {
      if (name !== 'git.diff') return ok();
      if (gate.held) await new Promise<void>((resolve) => (gate.release = resolve));
      return ok({ patch: APP_PATCH, files: APP_FILES });
    });
    const store = createReviewStore(main.bridge);
    const off = store.getState().hold({ directory: DIR, scope: 'uncommitted', base: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.diff')).toHaveLength(1);
    store.getState().statusChanged(DIR);
    await vi.advanceTimersByTimeAsync(100);
    store.getState().statusChanged(DIR);
    await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_MS - 1);
    expect(main.callsOf('git.diff')).toHaveLength(1); // trailing: the second change restarted the wait
    gate.held = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(main.callsOf('git.diff')).toHaveLength(2);
    store.getState().statusChanged(DIR); // during the read
    await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_MS);
    expect(main.callsOf('git.diff')).toHaveLength(2); // one in flight per (directory, scope)
    gate.held = false;
    gate.release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('git.diff')).toHaveLength(3);
    off();
    store.getState().statusChanged(DIR);
    await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_MS * 2);
    expect(main.callsOf('git.diff')).toHaveLength(3); // released: nothing more
  });

  it('keeps the last answer while a re-read runs, and says why a read failed', async () => {
    let fails = false;
    const main = installFakeMain((name) => (name === 'git.diff' ? (fails ? fail('unknown revision') : ok({ patch: APP_PATCH, files: APP_FILES })) : ok()));
    const store = createReviewStore(main.bridge);
    const target = { directory: DIR, scope: 'uncommitted', base: null } as const;
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
    const store = createReviewStore(main.bridge);
    const target = { directory: DIR, scope: 'uncommitted', base: null } as const;
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
    const store = createReviewStore(main.bridge);
    const target = { directory: DIR, scope: 'uncommitted', base: null } as const;
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

  it('says why This branch is unavailable when C10 answers no branch (null) or a detached main worktree (HEAD)', async () => {
    const main = installFakeMain((name, input) =>
      name === 'git.worktree.branch'
        ? ok(input.branch === 'unborn' ? null : { repoRoot: input.repoRoot, branch: input.branch, head: 'abc', checkedOutAt: null, base: 'HEAD', ahead: 0, merged: true })
        : ok(),
    );
    const store = createReviewStore(main.bridge);
    store.getState().lookupBase('/repo', 'unborn'); // HEAD's branch with no commits: `rev-parse --verify refs/heads/unborn` fails
    store.getState().lookupBase('/repo', 'feature');
    await tick();
    expect(baseOf(store.getState(), '/repo', 'unborn')).toEqual({ status: 'unavailable', reason: 'No commits on unborn yet' });
    expect(baseOf(store.getState(), '/repo', 'feature')).toEqual({ status: 'unavailable', reason: 'The main worktree has no branch' });
  });

  it('asks git.worktree.branch again after a failed lookup, rather than keeping the failure', async () => {
    let fails = true;
    const main = installFakeMain((name, input) =>
      name === 'git.worktree.branch' ? (fails ? fail('git busy') : ok({ repoRoot: input.repoRoot, branch: input.branch, head: 'abc', checkedOutAt: null, base: 'main', ahead: 1, merged: false })) : ok(),
    );
    const store = createReviewStore(main.bridge);
    store.getState().lookupBase('/repo', 'feature');
    await tick();
    expect(baseOf(store.getState(), '/repo', 'feature')).toEqual({ status: 'unavailable', reason: 'git busy', failed: true });
    fails = false;
    store.getState().lookupBase('/repo', 'feature');
    await tick();
    expect(main.calls).toHaveLength(2);
    expect(baseOf(store.getState(), '/repo', 'feature')).toEqual({ status: 'ok', base: 'main' });
  });

  it('asks git.worktree.branch for the base once the command exists, and refuses the main worktree’s own branch', async () => {
    const main = installFakeMain((name, input) =>
      name === 'git.worktree.branch' ? ok({ repoRoot: input.repoRoot, branch: input.branch, head: 'abc', checkedOutAt: null, base: 'main', ahead: 2, merged: false }) : ok(),
    );
    const store = createReviewStore(main.bridge);
    store.getState().lookupBase('/repo', 'feature');
    store.getState().lookupBase('/repo', 'feature');
    store.getState().lookupBase('/repo', 'main');
    expect(baseOf(store.getState(), '/repo', 'feature')).toEqual({ status: 'loading' });
    await tick();
    expect(main.calls.map((c) => [c.name, c.input])).toEqual([
      ['git.worktree.branch', { repoRoot: '/repo', branch: 'feature' }],
      ['git.worktree.branch', { repoRoot: '/repo', branch: 'main' }],
    ]);
    expect(baseOf(store.getState(), '/repo', 'feature')).toEqual({ status: 'ok', base: 'main' });
    expect(baseOf(store.getState(), '/repo', 'main')).toEqual({ status: 'unavailable', reason: "Session runs on main, the main worktree's branch" });
  });
});

// ---- the tool over C8a's host --------------------------------------------------------------------------------------

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

interface ReviewMainOptions {
  status?: GitStatus;
  uncommitted?: { patch: string; files: typeof APP_FILES };
}
type DiffAnswer = { patch: string; files: typeof APP_FILES };
function reviewMain(options: ReviewMainOptions = {}) {
  const state: { status: GitStatus; uncommitted: DiffAnswer; perFile: Record<string, DiffAnswer> } = {
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
      case 'git.diff':
        if (typeof input.path === 'string') return ok(state.perFile[input.path] ?? { patch: '', files: [] });
        return ok(input.scope === 'staged' ? { patch: STAGED_PATCH, files: [{ path: 'src/staged.ts', oldPath: null, insertions: 1, deletions: 0, binary: false }] } : state.uncommitted);
      case 'layout.get':
        return ok({ value: null });
      case 'fs.workflows':
        return ok({ runs: [] });
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
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"] button')].map((b) => [b.dataset.path, b.dataset.kind, b.textContent]);
const row = (path: string) => document.querySelector<HTMLButtonElement>(`[role="option"] button[data-path="${path}"]`)!;
const selectedPath = () => document.querySelector('[role="option"][aria-selected="true"] button')?.getAttribute('data-path') ?? null;
const bodyText = () => document.querySelector('[data-review-body]')?.textContent ?? null;
const hunkLabel = () => document.querySelector('[data-review-hunk]')?.textContent ?? null;

// happy-dom lays nothing out: the diff body gets a clamped scroller of a given height whose rows stand `rowHeight`
// apart, and a scroll event on every change of its offset, as a browser gives.
function layOut(body: Element, { rowHeight, clientHeight }: { rowHeight: number; clientHeight: number }): () => void {
  const el = body as HTMLElement;
  const rowsOf = () => [...el.querySelectorAll('tr')];
  let top = 0;
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => rowsOf().length * rowHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      const next = Math.max(0, Math.min(value, el.scrollHeight - clientHeight));
      if (next === top) return;
      top = next;
      el.dispatchEvent(new Event('scroll'));
    },
  });
  const original = Element.prototype.getBoundingClientRect;
  const box = (y: number) => ({ top: y, bottom: y + rowHeight, left: 0, right: 0, width: 0, height: rowHeight, x: 0, y, toJSON: () => ({}) }) as DOMRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this === el) return box(0);
    const index = this.tagName === 'TR' ? rowsOf().indexOf(this as HTMLTableRowElement) : -1;
    return index >= 0 ? box(index * rowHeight - top) : original.call(this);
  };
  return () => void (Element.prototype.getBoundingClientRect = original);
}
const openReview = (params?: ReviewParams) => act(() => void panelHost.addTool('review', { appSessionId: A, params }));

async function attachTranscript(events: SessionEvent[]) {
  const source: TranscriptSource = { subscribe: () => () => {}, snapshot: () => Promise.resolve(events) };
  await act(() => useTranscriptStore.getState().attach(A, source));
}
const receiptRow = () => useTranscriptStore.getState().rows(A).find((row) => row.kind === 'receipt');

describe('review tool', () => {
  const offs: (() => void)[] = [];
  let main: ReturnType<typeof reviewMain>;
  // E11 W-E: the diff view's lazy chunk (`@git-diff-view/react` under the React Compiler) is loaded once here, so no
  // case waits on its import, whose transform is the step that grows with the machine's load.
  beforeAll(async () => {
    await import('./ReviewView');
  });
  beforeEach(() => {
    resetPanelStores();
    useReview.getState().reset();
    resetDiffTabs();
    useViewer.getState().reset();
    main = reviewMain();
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/repo' })) }));
    offs.push(connectPanelEvents(), registerPanelTool(reviewTool));
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
    vi.useRealTimers();
  });

  it('opens on Uncommitted for a dirty tree: the chips the status allows, the header, the rows, the footer, one git.diff', async () => {
    openReview(); // before the page renders, so the resting summary never mounts
    render(<TestHost />);
    await waitFor(() => expect(header()).toBe('3 files changed · +3 −0 · Uncommitted'));
    expect(chips()).toEqual([
      ['uncommitted', false, 'true', ''],
      ['branch', true, 'false', "Session runs on main, the main worktree's branch"],
      ['staged', false, 'false', ''],
    ]);
    expect(rows()).toEqual([
      ['src/app.ts', 'modified', 'app.tssrc+2 −0'],
      ['src/staged.ts', 'added', 'staged.tssrc+1 −0'],
      ['scratch.txt', 'untracked', 'scratch.txtUntracked'],
    ]);
    expect(selectedPath()).toBe('src/app.ts');
    expect(document.querySelector('[data-review-footer]')?.textContent).toBe('main · Working tree against HEAD');
    // C8a's git store reads the same diff once for Environment's change line; Review reads it once.
    expect(main.callsOf('git.diff')).toEqual([
      { directory: '/repo', scope: 'all' },
      { directory: '/repo', scope: 'all' },
    ]);
  });

  it('shows Staged only while the index differs, and says why This branch is unavailable on a detached head', async () => {
    main.state.status = statusOf({ dirty: false, branch: null, head: 'fedcba9876543210' });
    main.state.uncommitted = { patch: '', files: [] };
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(chipOf('uncommitted')?.getAttribute('aria-pressed')).toBe('true'));
    expect(chips()).toEqual([
      ['uncommitted', false, 'true', ''],
      ['branch', true, 'false', 'Detached HEAD'],
    ]);
    await waitFor(() => expect(document.querySelector('[data-review-empty]')?.textContent).toBe('No uncommitted changes'));
    expect(document.querySelector('[data-review-footer]')?.textContent).toBe('detached at fedcba9 · Working tree against HEAD');
  });

  it('keeps Staged selected but disabled once the index matches HEAD again, reading Nothing staged', async () => {
    render(<TestHost />);
    openReview({ scope: 'staged' });
    await waitFor(() => expect(header()).toBe('1 file changed · +1 −0 · Staged'));
    const clean = statusOf({ dirty: true, files: [DIRTY.files[0], DIRTY.files[2]] });
    main.state.status = clean;
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: clean, reason: 'index' }));
    await waitFor(() => expect(chips().find((c) => c[0] === 'staged')).toEqual(['staged', true, 'true', 'Index matches HEAD']));
  });

  it('re-reads once 250 ms after git.changed and keeps the selected file', async () => {
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(main.callsOf('git.diff')).toHaveLength(2); // C8a's git store's and Review's
    fireEvent.click(row('src/staged.ts'));
    expect(selectedPath()).toBe('src/staged.ts');
    main.state.uncommitted = { patch: APP_PATCH + STAGED_PATCH, files: [{ ...APP_FILES[0], insertions: 5 }, { path: 'src/staged.ts', oldPath: null, insertions: 1, deletions: 0, binary: false }] };
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(header()).toBe('3 files changed · +6 −0 · Uncommitted'));
    expect(main.callsOf('git.diff')).toHaveLength(4); // one more each, the two events coalesced
    expect(selectedPath()).toBe('src/staged.ts');
  });

  it('reads the scope afresh when the tab is selected again, and not on its first mount', async () => {
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    await act(() => new Promise((resolve) => setTimeout(resolve, REVIEW_REFRESH_MS + 50)));
    expect(main.callsOf('git.diff')).toHaveLength(2); // C8a's git store's and Review's own: the mount's focus request read nothing more
    act(() => panelHost.selectTab(panelOf(A)!.tabs[0].id)); // the host's focus request for the selected tab
    await waitFor(() => expect(main.callsOf('git.diff')).toHaveLength(3));
  });

  it('says a file past the cap is too large and offers it at its first changed line', async () => {
    const lines = Array.from({ length: REVIEW_FILE_LINES_CAP + 1 }, (_, i) => `+line ${i}`);
    const big = ['diff --git a/big.ts b/big.ts', 'index 1..2 100644', '--- a/big.ts', '+++ b/big.ts', `@@ -3,0 +4,${lines.length} @@`, ...lines, ''].join('\n');
    main.state.uncommitted = { patch: big, files: [{ path: 'big.ts', oldPath: null, insertions: lines.length, deletions: 0, binary: false }] };
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(document.querySelector('[data-review-too-large]')?.textContent).toBe('Diff too large to display. Open the file'));
    expect(document.querySelector('[data-review-body]')).toBeNull();
    fireEvent.click(screen.getByText('Open the file'));
    expect(currentSet(useLayout.getState().main).panes.flatMap((p) => p.tabs)).toContainEqual(expect.objectContaining({ kind: 'file', path: '/repo/big.ts', line: 4 }));
  });

  it('selects the first file when the selected one leaves the list', async () => {
    render(<TestHost />);
    openReview({ path: 'scratch.txt' });
    await waitFor(() => expect(selectedPath()).toBe('scratch.txt'));
    expect(document.querySelector('[data-review-note]')?.textContent).toBe('Untracked file · not in the diff');
    expect(screen.queryByText('Split')).toBeNull(); // no diff, no mode
    expect(screen.getByText('Open file ↗')).toBeTruthy();
    const tracked = statusOf({ dirty: true, files: DIRTY.files.slice(0, 2) });
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: tracked, reason: 'worktree' }));
    await waitFor(() => expect(selectedPath()).toBe('src/app.ts'));
  });

  it('counts and moves through hunks, and Open file ↗ opens the current hunk’s first changed line, moving the same tab', async () => {
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(document.querySelector('[data-review-hunk]')?.textContent).toBe('Showing hunk 1 of 2'));
    expect(screen.getByLabelText('Previous hunk')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByText('Open file ↗'));
    const fileTabs = () => currentSet(useLayout.getState().main).panes.flatMap((p) => p.tabs).filter((t) => t.kind === 'file');
    expect(fileTabs()).toEqual([expect.objectContaining({ path: '/repo/src/app.ts', line: 5, appSessionId: A })]);
    fireEvent.click(screen.getByLabelText('Next hunk'));
    expect(document.querySelector('[data-review-hunk]')?.textContent).toBe('Showing hunk 2 of 2');
    expect(screen.getByLabelText('Next hunk')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByText('Open file ↗'));
    expect(fileTabs()).toEqual([expect.objectContaining({ path: '/repo/src/app.ts', line: 14 })]);
    fireEvent.click(screen.getByLabelText('Next file'));
    expect(selectedPath()).toBe('src/staged.ts');
    expect(document.querySelector('[data-review-hunk]')?.textContent).toBe('Showing hunk 1 of 1');
  });

  // E11 W-E: load-independent (it timed out under load in `waitFor`'s one second before the body painted): the body is
  // awaited over turns of the event loop, which the fake main's answers and React's work need, not over a time budget.
  it('draws the same hunks unified and split, and Wrap is the viewer’s one flag', async () => {
    render(<TestHost />);
    openReview();
    for (let turn = 0; turn < 50 && !bodyText()?.includes('@@ -12,3 +13,4 @@'); turn++) await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
    expect(bodyText()).toContain('@@ -12,3 +13,4 @@');
    const hunkRows = () => document.querySelectorAll('[data-review-body] tr[data-state="hunk"]:not([data-side="new"])').length;
    expect(hunkRows()).toBe(2);
    fireEvent.click(screen.getByText('Split')); // the chunk is loaded: the click renders the split view within its act
    expect(document.querySelector('[data-review-body] .split-diff-view')).not.toBeNull();
    expect(hunkRows()).toBe(2);
    expect(useViewer.getState().wrap).toBe(false);
    expect(document.querySelector('[data-review-body] [class*="-diff-view-wrap"]')).toBeNull();
    fireEvent.click(screen.getByText('Wrap'));
    expect(useViewer.getState().wrap).toBe(true);
    await act(async () => {}); // DiffView applies the flag on a commit after the click's
    expect(document.querySelector('[data-review-body] [class*="-diff-view-wrap"]')).not.toBeNull(); // DiffView received it
  });

  it('keeps a hunk it jumped to when the hunk cannot reach the top of the scroller', async () => {
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(bodyText()).toContain('@@ -12,3 +13,4 @@'));
    const body = document.querySelector('[data-review-body]')!;
    const restore = layOut(body, { rowHeight: 20, clientHeight: 150 }); // the second hunk's row lies below the last offset
    try {
      fireEvent.click(screen.getByLabelText('Next hunk'));
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      const el = body as HTMLElement;
      expect(el.scrollTop).toBeGreaterThan(0);
      expect(el.scrollTop).toBe(el.scrollHeight - el.clientHeight); // clamped short of the second hunk's row
      expect(hunkLabel()).toBe('Showing hunk 2 of 2');
      expect(screen.getByLabelText('Next hunk')).toHaveProperty('disabled', true);
      fireEvent.click(screen.getByText('Open file ↗'));
      expect(currentSet(useLayout.getState().main).panes.flatMap((p) => p.tabs)).toContainEqual(expect.objectContaining({ kind: 'file', path: '/repo/src/app.ts', line: 14 }));
      act(() => void ((body as HTMLElement).scrollTop = 0)); // scrolling by hand still moves the counter
      expect(hunkLabel()).toBe('Showing hunk 1 of 2');
    } finally {
      restore();
    }
  });

  it('past the scope cap, fetches the selected file again after a refresh, and ticks it viewed in the list', async () => {
    main.state.uncommitted = { patch: APP_PATCH + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files: APP_FILES };
    main.state.perFile = { 'src/app.ts': { patch: APP_PATCH, files: APP_FILES } };
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(hunkLabel()).toBe('Showing hunk 1 of 2'));
    fireEvent.click(screen.getByText('Mark viewed'));
    expect(row('src/app.ts').dataset.viewed).toBe('true');
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(main.callsOf('git.diff').filter((input) => input.path === 'src/app.ts')).toHaveLength(2));
    await waitFor(() => expect(hunkLabel()).toBe('Showing hunk 1 of 2'));
    expect(row('src/app.ts').dataset.viewed).toBe('true');
  });

  it('marks a binary file viewed over its header, and drops the mark when the header changes', async () => {
    const binary = (index: string) => ({
      patch: `diff --git a/logo.png b/logo.png\nindex ${index} 100644\nBinary files a/logo.png and b/logo.png differ\n`,
      files: [{ path: 'logo.png', oldPath: null, insertions: 0, deletions: 0, binary: true }],
    });
    main.state.uncommitted = binary('1..2');
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(document.querySelector('[data-review-file-header]')?.textContent).toBe('logo.png · Binary'));
    fireEvent.click(screen.getByText('Mark viewed'));
    expect(row('logo.png').dataset.viewed).toBe('true');
    main.state.uncommitted = binary('1..3');
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(row('logo.png').dataset.viewed).toBeUndefined());
  });

  it('past the scope cap, signs a binary’s mark over the header its own fetch reads, and drops it when the blob changes', async () => {
    const binary = (index: string) => ({
      patch: `diff --git a/logo.png b/logo.png\nindex ${index} 100644\nBinary files a/logo.png and b/logo.png differ\n`,
      files: [{ path: 'logo.png', oldPath: null, insertions: 0, deletions: 0, binary: true }],
    });
    const past = (index: string) => ({ patch: binary(index).patch + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files: binary(index).files });
    main.state.uncommitted = past('1..2');
    main.state.perFile = { 'logo.png': binary('1..2') };
    openReview();
    render(<TestHost />);
    await waitFor(() => expect(screen.getByText('Mark viewed')).toBeTruthy()); // offered once the header is read
    expect(main.callsOf('git.diff').filter((input) => input.path === 'logo.png')).toHaveLength(1);
    fireEvent.click(screen.getByText('Mark viewed'));
    expect(row('logo.png').dataset.viewed).toBe('true');
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(main.callsOf('git.diff').filter((input) => input.path === 'logo.png')).toHaveLength(2));
    await waitFor(() => expect(row('logo.png').dataset.viewed).toBe('true')); // the same blob: the mark stands
    main.state.uncommitted = past('1..3');
    main.state.perFile = { 'logo.png': binary('1..3') };
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(main.callsOf('git.diff').filter((input) => input.path === 'logo.png')).toHaveLength(3));
    await waitFor(() => expect(screen.getByText('Mark viewed')).toBeTruthy());
    expect(row('logo.png').dataset.viewed).toBeUndefined();
  });

  it('keeps viewed marks across unmounts and drops a mark when the file’s hunks change', async () => {
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(screen.getByText('Mark viewed')).toBeTruthy());
    fireEvent.click(screen.getByText('Mark viewed'));
    expect(row('src/app.ts').dataset.viewed).toBe('true');
    act(() => panelHost.showSummary());
    expect(document.querySelector('[data-review]')).toBeNull();
    act(() => panelHost.selectTab(panelOf(A)!.tabs[0].id));
    await waitFor(() => expect(row('src/app.ts')?.dataset.viewed).toBe('true'));
    expect(screen.getByText('Viewed').getAttribute('aria-pressed')).toBe('true');
    main.state.uncommitted = { patch: APP_PATCH.replace('+n', '+changed'), files: APP_FILES };
    act(() => main.emit('git.changed', { repoRoot: '/repo', status: statusOf({ ...DIRTY }), reason: 'worktree' }));
    await waitFor(() => expect(row('src/app.ts').dataset.viewed).toBeUndefined());
  });

  it('keeps the mode and a viewed mark under a pin across a session switch', async () => {
    useSessions.setState((s) => ({ records: new Map(s.records).set(B, record(B, { directory: '/repo-b' })) }));
    render(<TestHost />);
    act(() => void panelHost.addTool('review', { appSessionId: A, pin: true }));
    await waitFor(() => expect(screen.getByText('Mark viewed')).toBeTruthy());
    fireEvent.click(screen.getByText('Mark viewed'));
    fireEvent.click(screen.getByText('Split'));
    act(() => useLayout.getState().openSession(B));
    act(() => panelHost.selectTab(useLayout.getState().panelPinned[0].id)); // B's own selection starts on the summary
    await waitFor(() => expect(main.callsOf('git.watch')).toContainEqual({ directory: '/repo-b' }));
    await waitFor(() => expect(header()).toBe('3 files changed · +3 −0 · Uncommitted'));
    expect(row('src/app.ts').dataset.viewed).toBeUndefined(); // marks are per directory and scope
    act(() => useLayout.getState().openSession(A));
    await waitFor(() => expect(row('src/app.ts')?.dataset.viewed).toBe('true'));
    expect(screen.getByText('Split').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows Last turn from the receipt and C6’s activity, the same with the turn collapsed and expanded', async () => {
    main.state.status = statusOf({ dirty: false }); // a clean tree: C8a's git store reads no diff either
    await attachTranscript(journalToEvents(loadSyntheticJournal('edit-and-receipt')));
    const receipt = receiptRow();
    if (receipt?.kind !== 'receipt') throw new Error('no receipt');
    expect(useTranscriptStore.getState().rows(A).some((row) => row.kind === 'group' || row.kind === 'cell')).toBe(false); // a closed turn collapses
    render(<TestHost />);
    openReview({ scope: 'turn', turnId: receipt.turnId!, path: receipt.files[1].path });
    await waitFor(() => expect(bodyText()).not.toBeNull());
    expect(chips().map((c) => [c[0], c[2]])).toEqual([
      ['uncommitted', 'false'],
      ['branch', 'false'],
      ['turn', 'true'],
    ]);
    expect(selectedPath()).toBe(receipt.files[1].path);
    expect(header()).toBe(`3 files changed · +${receipt.added} −${receipt.removed} · Last turn`);
    expect(rows().map((r) => r[0])).toEqual(receipt.files.map((f) => f.path));
    const collapsed = { rows: rows(), body: bodyText() };
    expect(collapsed.body).toContain('+'); // an edit's added lines
    act(() => useTranscriptStore.getState().expandAll(A, { cells: true }));
    expect(useTranscriptStore.getState().rows(A).some((row) => row.kind === 'group' || row.kind === 'cell')).toBe(true);
    expect({ rows: rows(), body: bodyText() }).toEqual(collapsed);
    expect(main.callsOf('git.diff')).toEqual([]); // Last turn reads no git
  });

  it('draws a Last turn file whose hunks carry unprefixed context lines (M4: edit-and-receipt’s src/app.ts)', async () => {
    main.state.status = statusOf({ dirty: false });
    await attachTranscript(journalToEvents(loadSyntheticJournal('edit-and-receipt')));
    const receipt = receiptRow();
    if (receipt?.kind !== 'receipt') throw new Error('no receipt');
    render(<TestHost />);
    openReview({ scope: 'turn', turnId: receipt.turnId!, path: receipt.files[0].path });
    await waitFor(() => expect(bodyText()).toContain("import { store } from './store';"));
    expect(bodyText()).toContain('measureRows');
  });

  it('keeps the app standing when the diff view cannot parse a block, saying so in the block (M4)', async () => {
    const { default: ReviewView } = await import('./ReviewView');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ReviewView
        file={{ path: 'a.ts', oldPath: null, blocks: [['@@ -1,1 +1,1 @@\nnot a diff line'], ['@@ -1 +1 @@\n-a\n+b']] }}
        mode="unified"
        wrap={false}
        hunk={0}
        navigate={0}
        initialScrollTop={0}
        onHunk={() => {}}
        onLeave={() => {}}
      />,
    );
    await waitFor(() => expect(bodyText()).toContain('Diff unavailable: Malformed diff, empty hunk'));
    expect(document.querySelectorAll('[data-review-block]')).toHaveLength(2); // the other block still draws
    errors.mockRestore();
  });

  it('draws a block again once its diff changes after the diff view could not parse it', async () => {
    const { default: ReviewView } = await import('./ReviewView');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = (blocks: string[][]) => (
      <ReviewView file={{ path: 'a.ts', oldPath: null, blocks }} mode="unified" wrap={false} hunk={0} navigate={0} initialScrollTop={0} onHunk={() => {}} onLeave={() => {}} />
    );
    const { rerender } = render(view([['@@ -1,1 +1,1 @@\nnot a diff line']]));
    await waitFor(() => expect(bodyText()).toContain('Diff unavailable: Malformed diff, empty hunk'));
    rerender(view([['@@ -1 +1 @@\n-before\n+after']]));
    await waitFor(() => expect(bodyText()).toContain('after'));
    expect(bodyText()).not.toContain('Diff unavailable');
    errors.mockRestore();
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
    const receipt = receiptRow();
    if (receipt?.kind !== 'receipt') throw new Error('no receipt');
    render(<TestHost />);
    openReview({ scope: 'turn', turnId: receipt.turnId! });
    await waitFor(() => expect(bodyText()).toContain('omega'));
    expect(rows()).toEqual([['/repo/child.ts', 'modified', 'child.ts/repo+1 −1']]);
    expect(bodyText()).toContain('alpha');
    fireEvent.click(screen.getByText('Open file ↗'));
    expect(currentSet(useLayout.getState().main).panes.flatMap((p) => p.tabs)).toContainEqual(expect.objectContaining({ kind: 'file', path: '/repo/child.ts', line: 3 }));
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
    main.state.status = statusOf({ dirty: false });
    await attachTranscript(b.events);
    const receipt = receiptRow();
    if (receipt?.kind !== 'receipt') throw new Error('no receipt');
    render(<TestHost />);
    openReview({ scope: 'turn', turnId: receipt.turnId! });
    await waitFor(() => expect(document.querySelectorAll('[data-review-block]')).toHaveLength(3));
    await waitFor(() => expect(hunkLabel()).toBe('Showing hunk 1 of 3'));
    for (const text of ['+l12', '+EIGHT', '+ABOVE']) expect(bodyText()).toContain(text); // every edit's hunk drawn
    fireEvent.click(screen.getByLabelText('Next hunk'));
    fireEvent.click(screen.getByLabelText('Next hunk'));
    expect(hunkLabel()).toBe('Showing hunk 3 of 3');
    fireEvent.click(screen.getByText('Open file ↗'));
    expect(currentSet(useLayout.getState().main).panes.flatMap((p) => p.tabs)).toContainEqual(expect.objectContaining({ kind: 'file', path: file, line: 4 })); // the third block's own numbers
    // No warning from the diff view, save the store library's own timing note, which a loaded machine triggers.
    const warned = warn.mock.calls.filter(([first]) => !(typeof first === 'string' && first.startsWith('[reactivity-store]')));
    expect(warned).toEqual([]);
    warn.mockRestore();
  });

  it('recomputes Last turn only when the turn itself changes', async () => {
    let push: (batch: SessionEvent[]) => void = () => {};
    const events = journalToEvents(loadSyntheticJournal('edit-and-receipt'));
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: (listener) => ((push = listener), () => {}), snapshot: () => Promise.resolve(events) }));
    const receipt = receiptRow();
    if (receipt?.kind !== 'receipt') throw new Error('no receipt');
    const { result } = renderHook(() => useReviewData({ appSessionId: A, directory: '/repo', scope: 'turn', turnId: receipt.turnId! }));
    const before = result.current.list;
    expect(before.phase).toBe('ready');
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

  it('open re-targets: a receipt’s turn and path select both, and an open with no params leaves a selected file alone', async () => {
    await attachTranscript(journalToEvents(loadSyntheticJournal('edit-and-receipt')));
    const receipt = receiptRow();
    if (receipt?.kind !== 'receipt') throw new Error('no receipt');
    render(<TestHost />);
    openReview();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(row('src/staged.ts'));
    const shell = document.querySelector('[data-review]');
    openReview();
    await waitFor(() => expect(chipOf('uncommitted')?.getAttribute('aria-pressed')).toBe('true'));
    expect(selectedPath()).toBe('src/staged.ts');
    expect(document.querySelector('[data-review]')).toBe(shell); // re-targeted in place, never unmounted
    expect(panelOf(A)?.tabs).toHaveLength(1);
    act(() => codeTranscriptActions.reviewChanges(receipt.turnId!, receipt.files[2].path));
    await waitFor(() => expect(chipOf('turn')?.getAttribute('aria-pressed')).toBe('true'));
    expect(selectedPath()).toBe(receipt.files[2].path);
    expect(panelOf(A)?.tabs).toHaveLength(1);
  });

  it('fills Environment’s change line with the staged count, and opens Review from it', async () => {
    render(<TestHost />);
    await waitFor(() => expect(screen.getByTestId('change-line').textContent).toBe('+3 −0 across 3 files · 1 untracked · 1 staged'));
    fireEvent.click(screen.getByTestId('change-line'));
    await waitFor(() => expect(header()).toBe('3 files changed · +3 −0 · Uncommitted'));
    expect(rows().map((r) => r[0])).toEqual(['src/app.ts', 'src/staged.ts', 'scratch.txt']);
  });
});

describe('review diff tab', () => {
  const offs: (() => void)[] = [];
  beforeEach(() => {
    resetPanelStores();
    useReview.getState().reset();
    resetDiffTabs();
    reviewMain();
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/repo' })) }));
    offs.push(connectPanelEvents());
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
  });
  const diffTab = (ref: string) => ({ id: `diff:${A}:${ref}`, kind: 'diff' as const, appSessionId: A, ref, pinned: false });

  it('renders Review for a ref with its file selected and no chips', async () => {
    render(<DiffTab tab={diffTab('uncommitted @ src/staged.ts')} />);
    await waitFor(() => expect(selectedPath()).toBe('src/staged.ts'));
    expect(header()).toBe('3 files changed · +3 −0 · Uncommitted');
    expect(chips()).toEqual([]);
  });

  it('refuses a path outside the repository and offers no Open file', async () => {
    render(<DiffTab tab={diffTab('uncommitted @ /etc/hosts')} />);
    await waitFor(() => expect(document.querySelector('[data-review-refused]')?.textContent).toBe("Refused: path outside the session's directories/etc/hosts"));
    expect(screen.queryByText('Open file ↗')).toBeNull();
  });

  it('forgets a closed tab’s view: reopened, it starts again from its ref', async () => {
    const ref = 'uncommitted @ src/staged.ts';
    act(() => useLayout.getState().openTab({ kind: 'diff', appSessionId: A, ref }));
    const tab = currentSet(useLayout.getState().main).panes[0].tabs.find((t) => t.kind === 'diff')!;
    const { unmount } = render(<DiffTab tab={tab as ReturnType<typeof diffTab>} />);
    await waitFor(() => expect(selectedPath()).toBe('src/staged.ts'));
    fireEvent.click(row('src/app.ts'));
    unmount();
    act(() => useLayout.getState().closeTab(tab.id));
    act(() => useLayout.getState().openTab({ kind: 'diff', appSessionId: A, ref }));
    render(<DiffTab tab={tab as ReturnType<typeof diffTab>} />);
    await waitFor(() => expect(selectedPath()).toBe('src/staged.ts'));
  });

  it('says why a ref does not parse or names a turn not loaded', async () => {
    const { unmount } = render(<DiffTab tab={diffTab('everything')} />);
    expect(document.querySelector('[data-review-unavailable]')?.textContent).toBe('Diff unavailable: unknown refeverything');
    unmount();
    render(<DiffTab tab={diffTab(formatRef(T))} />);
    await waitFor(() => expect(document.querySelector('[data-review-unavailable]')?.textContent).toBe('Diff unavailable: the turn is not loaded · Open the session'));
  });
});
