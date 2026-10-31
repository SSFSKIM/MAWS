// P3-H H3b: which live sessions may run an artifact's connector call through route E (P3 Decision Log 24, 83 and 85,
// X16): the artifact's own session preferred, then any live session in exactly the directory the artifact's own
// durable context names; never another worktree, never another project, never a guess.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { eligibleSessions, ownSessionOf, type EligibilityFacts, type LiveSession } from './eligibility';

const PROJECT = 'proj-1';
const ROOT = '/repo';
const WORKTREE = '/repo/.claude/worktrees/feature';
const session = (appSessionId: string, cwd: string, patch: Partial<LiveSession> = {}): LiveSession => ({ appSessionId, launchId: `L-${appSessionId}`, cwd, process: 'ready', lastUsedAt: '2026-10-16T10:00:00.000Z', ...patch });
const creator = (appSessionId: string): Actor => ({ kind: 'session', appSessionId: appSessionId as never });
// realpath: `/link` is a symlink to `/repo`; `/gone` no longer exists
const realpath = (path: string): string | null => (path.startsWith('/gone') ? null : path.replace(/^\/link(?=\/|$)/, ROOT));

function facts(patch: Partial<EligibilityFacts>): EligibilityFacts {
  return {
    artifact: { createdBy: creator('own'), projectId: PROJECT },
    links: [],
    space: null,
    creator: { projectId: PROJECT, directory: ROOT },
    project: { directory: ROOT },
    live: [],
    realpath,
    ...patch,
  };
}
const ids = (input: EligibilityFacts) => eligibleSessions(input).map((s) => s.appSessionId);

describe('ownSessionOf', () => {
  it('is the creating session, else the created-role link of an import, else none', () => {
    expect(ownSessionOf({ createdBy: creator('own') }, [{ appSessionId: 'other' as never, role: 'created' }])).toBe('own');
    expect(ownSessionOf({ createdBy: { kind: 'human' } }, [{ appSessionId: 'viewer' as never, role: 'viewed' }, { appSessionId: 'importer' as never, role: 'created' }])).toBe('importer');
    expect(ownSessionOf({ createdBy: { kind: 'human' } }, [{ appSessionId: 'editor' as never, role: 'edited' }])).toBeNull();
  });
});

describe('eligibleSessions (route E)', () => {
  it('prefers the own live session, then others in the same directory, most recently used first', () => {
    const live = [session('a', ROOT, { lastUsedAt: '2026-10-16T09:00:00.000Z' }), session('own', ROOT), session('b', ROOT, { lastUsedAt: '2026-10-16T11:00:00.000Z' })];
    expect(ids(facts({ live }))).toEqual(['own', 'b', 'a']);
    expect(eligibleSessions(facts({ live }))[0]).toEqual({ appSessionId: 'own', launchId: 'L-own', cwd: ROOT, own: true });
  });

  it('compares canonical directories: a symlinked cwd is the same directory', () => {
    expect(ids(facts({ live: [session('a', '/link')] }))).toEqual(['a']);
    expect(ids(facts({ creator: { projectId: PROJECT, directory: '/link' }, live: [session('a', ROOT)] }))).toEqual(['a']);
  });

  it('never takes another worktree of the same project, another project, a subdirectory, or a session not ready', () => {
    const live = [session('w', WORKTREE), session('p', '/elsewhere'), session('s', `${ROOT}/src`), session('x', ROOT, { process: 'exited' }), session('i', ROOT, { process: 'initializing' })];
    expect(ids(facts({ live }))).toEqual([]);
  });

  it('a creator working in a worktree makes that worktree the directory, not the project root', () => {
    const live = [session('own', WORKTREE), session('root', ROOT), session('twin', WORKTREE)];
    expect(ids(facts({ creator: { projectId: PROJECT, directory: WORKTREE }, live }))).toEqual(['own', 'twin']);
  });

  it('a creator moved to another directory loses access, while sessions in its context directory keep it', () => {
    const live = [session('own', '/elsewhere'), session('a', ROOT)];
    expect(ids(facts({ live }))).toEqual(['a']);
  });

  it('a creator now filed in another project is no context: the artifact row’s own project directory is', () => {
    const live = [session('own', '/other-project'), session('a', ROOT), session('b', '/other-project')];
    expect(ids(facts({ creator: { projectId: 'proj-2', directory: '/other-project' }, live }))).toEqual(['a']);
    expect(ids(facts({ creator: { projectId: 'proj-2', directory: '/other-project' }, project: null, live }))).toEqual([]);
  });

  it('with the creator’s record gone: the Space’s linked directory or the row’s project directory, else nothing (no guess)', () => {
    const live = [session('a', ROOT), session('d', '/docs')];
    expect(ids(facts({ creator: null, live }))).toEqual(['a']); // the row's projectId
    expect(ids(facts({ creator: null, artifact: { createdBy: creator('own') }, project: null, live }))).toEqual([]); // nothing names a directory
    expect(ids(facts({ creator: null, artifact: { createdBy: creator('own') }, project: null, space: { linkedDir: '/docs' }, live }))).toEqual(['d']);
    expect(ids(facts({ creator: null, artifact: { createdBy: creator('own') }, project: null, space: {}, live }))).toEqual([]); // a Space with no directory
  });

  it('a Space’s linked directory is eligible beside the own context', () => {
    const live = [session('own', ROOT), session('d', '/docs'), session('w', WORKTREE)];
    expect(ids(facts({ space: { linkedDir: '/docs' }, live }))).toEqual(['own', 'd']);
  });

  it('an owner-created artifact in a project takes the indexed project’s directory; with none, nothing', () => {
    const owner = { createdBy: { kind: 'human' } as Actor, projectId: PROJECT };
    expect(ids(facts({ artifact: owner, creator: null, live: [session('a', ROOT), session('w', WORKTREE)] }))).toEqual(['a']);
    expect(ids(facts({ artifact: { createdBy: { kind: 'human' } }, creator: null, project: null, live: [session('a', ROOT)] }))).toEqual([]);
    // an import's created link is its own session, its record the context
    expect(eligibleSessions(facts({ artifact: owner, links: [{ appSessionId: 'imp' as never, role: 'created' }], creator: { projectId: PROJECT, directory: WORKTREE }, live: [session('imp', WORKTREE), session('a', ROOT)] }))).toEqual([{ appSessionId: 'imp', launchId: 'L-imp', cwd: WORKTREE, own: true }]);
  });

  it('drops a directory that no longer exists, and a live cwd that does not', () => {
    expect(ids(facts({ creator: { projectId: PROJECT, directory: '/gone/x' }, project: null, live: [session('a', '/gone/x')] }))).toEqual([]);
    expect(ids(facts({ live: [session('a', '/gone/y')] }))).toEqual([]);
  });
});
