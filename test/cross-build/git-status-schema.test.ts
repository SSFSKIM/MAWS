// The two older builds a peer can be, at the schema of a git status (UX wave U6b-3a,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, M1 decision 9; Interfaces §B): build F (`f1852de3a`)
// and build M (`2c7044231`). Both hold the same `GitFileStatusSchema`, `GitStatusSchema` and `GitChangedSchema`
// (`git show <build>:src/shared/ipc/schema/git.ts`), copied below as they stand there, so this suite needs no git
// history and never skips. A peer's main reads a daemon's answers and events with the tolerant reader.
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { readTolerant } from '@shared/ipc/tolerant';
import { commands as built, events as builtEvents, GitChangedSchema, GitStatusSchema } from '@shared/ipc/schema/git';

// As both builds have them, unchanged but for the names
const PeerFileStatusSchema = z.strictObject({
  path: z.string(), // relative to repoRoot
  oldPath: z.string().nullable(), // the rename or copy source of a `2` record
  index: z.string(),
  worktree: z.string(),
  untracked: z.boolean(),
});
const PeerStatusSchema = z.strictObject({
  repoRoot: z.string(), // the worktree's top level (a linked worktree's own root, not the main repository's)
  gitDir: z.string(),
  commonDir: z.string(),
  isWorktree: z.boolean(), // a linked worktree: gitDir !== commonDir
  branch: z.string().nullable(), // null when HEAD is detached
  head: z.string(), // the commit HEAD names; '' in a repository with no commit yet
  upstream: z.string().nullable(),
  remoteUrl: z.string().nullable(), // the upstream remote's URL (`git remote get-url`), else `origin`'s (or the sole remote's) when no upstream is set; null for a local upstream or without a URL (C8's ask)
  ahead: z.number().int(),
  behind: z.number().int(),
  dirty: z.boolean(),
  files: z.array(PeerFileStatusSchema),
  stashCount: z.number().int(),
  checkedAt: z.string(), // ISO time the status was read
});
const PeerChangeReasonSchema = z.enum(['worktree', 'index', 'head', 'refs', 'initial']);
const PeerChangedSchema = z.strictObject({ repoRoot: z.string(), status: PeerStatusSchema, reason: PeerChangeReasonSchema });

const PEERS = [{ build: 'f1852de3a' }, { build: '2c7044231' }];

const STATUS = {
  repoRoot: '/work/harbor',
  gitDir: '/work/harbor/.git',
  commonDir: '/work/harbor/.git',
  isWorktree: false,
  branch: 'main',
  head: '1'.repeat(40),
  upstream: null,
  remoteUrl: null,
  ahead: 0,
  behind: 0,
  dirty: true,
  files: [
    { path: 'src/cart.ts', oldPath: null, index: '.', worktree: 'M', untracked: false },
    { path: 'lib/gauges', oldPath: null, index: '.', worktree: 'M', untracked: false },
    { path: 'notes/', oldPath: null, index: '?', worktree: '?', untracked: true },
    { path: 'src/old.ts', oldPath: null, index: '.', worktree: 'D', untracked: false },
  ],
  stashCount: 0,
  checkedAt: '2026-11-17T09:00:00.000Z',
};
// The same status as this build answers it: the second entry is a submodule, and the work tree holds nothing at the fourth
const WITH_SUBMODULE = { ...STATUS, files: STATUS.files.map((file, i) => (i === 1 ? { ...file, submodule: true } : i === 3 ? { ...file, worktreeKind: 'none' } : file)) };
const droppedBy = (read: ReturnType<typeof readTolerant>) => (read.ok ? [...read.dropped].sort() : null);

describe.each(PEERS)('a peer of build $build', () => {
  it('reads this build’s git.status and git.watch answers less exactly the submodule and worktreeKind keys', () => {
    expect(built['git.status'].output).toBe(GitStatusSchema);
    expect(built['git.watch'].output).toBe(GitStatusSchema);
    expect(GitStatusSchema.safeParse(WITH_SUBMODULE).success).toBe(true);
    expect(PeerStatusSchema.safeParse(WITH_SUBMODULE).success).toBe(false); // the peer's schema is strict: the reader is what passes it
    const read = readTolerant(PeerStatusSchema, WITH_SUBMODULE);
    expect(droppedBy(read)).toEqual(['files.1.submodule', 'files.3.worktreeKind']);
    expect(read.ok && read.value).toEqual(STATUS);
  });

  it('reads this build’s git.changed less exactly the submodule and worktreeKind keys', () => {
    expect(builtEvents['git.changed']).toBe(GitChangedSchema);
    const event = { repoRoot: STATUS.repoRoot, status: WITH_SUBMODULE, reason: 'worktree' as const };
    expect(GitChangedSchema.safeParse(event).success).toBe(true);
    const read = readTolerant(PeerChangedSchema, event);
    expect(droppedBy(read)).toEqual(['status.files.1.submodule', 'status.files.3.worktreeKind']);
    expect(read.ok && read.value).toEqual({ ...event, status: STATUS });
  });

  it('answers a status and sends a git.changed this build’s schemas parse unchanged', () => {
    expect(PeerStatusSchema.safeParse(STATUS).success).toBe(true);
    const parsed = GitStatusSchema.safeParse(STATUS);
    expect(parsed.success && parsed.data).toEqual(STATUS);
    expect(parsed.success && parsed.data.files.some((file) => 'submodule' in file || 'worktreeKind' in file)).toBe(false);
    const event = { repoRoot: STATUS.repoRoot, status: STATUS, reason: 'index' as const };
    const changed = GitChangedSchema.safeParse(event);
    expect(changed.success && changed.data).toEqual(event);
  });
});
