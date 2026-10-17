// P3-HD M2c: the artifact-directory decision route E and route D share (eligibility.ts `artifactDirectories`): the same
// canonical, exact directory membership, with no cross-worktree borrowing. H's own eligibility tests stay unchanged.
import { describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { artifactDirectories, eligibleSessions, type DirectoryFacts, type EligibilityFacts } from './eligibility';

const PROJECT = 'proj-1';
const ROOT = '/repo';
const WORKTREE = '/repo/.claude/worktrees/feature';
const creator = (appSessionId: string): Actor => ({ kind: 'session', appSessionId: appSessionId as never });
const realpath = (path: string): string | null => (path.startsWith('/gone') ? null : path.replace(/^\/link(?=\/|$)/, ROOT));

function facts(patch: Partial<DirectoryFacts>): DirectoryFacts {
  return { artifact: { createdBy: creator('own'), projectId: PROJECT }, links: [], space: null, creator: { projectId: PROJECT, directory: ROOT }, project: { directory: ROOT }, realpath, ...patch };
}
const dirs = (input: DirectoryFacts) => [...artifactDirectories(input).directories].sort();

describe('artifactDirectories (shared by route E and route D)', () => {
  it('names the creator’s directory while the record exists and is filed in the artifact’s project', () => {
    expect(dirs(facts({}))).toEqual([ROOT]);
    expect(artifactDirectories(facts({})).hasContext).toBe(true);
  });

  it('a creator working in a worktree names that worktree, never the project root or a sibling worktree', () => {
    expect(dirs(facts({ creator: { projectId: PROJECT, directory: WORKTREE } }))).toEqual([WORKTREE]);
  });

  it('canonicalizes: a symlinked creator or Space directory is the real one, and duplicates collapse', () => {
    expect(dirs(facts({ creator: { projectId: PROJECT, directory: '/link' }, space: { linkedDir: ROOT } }))).toEqual([ROOT]);
  });

  it('adds the Space’s linked directory beside the context', () => {
    expect(dirs(facts({ space: { linkedDir: '/docs' } }))).toEqual(['/docs', ROOT]);
  });

  it('a creator filed in another project is no context: the row’s project directory is the fallback', () => {
    const moved = facts({ creator: { projectId: 'proj-2', directory: '/other' } });
    expect(dirs(moved)).toEqual([ROOT]);
    expect(artifactDirectories(moved).hasContext).toBe(false);
    expect(dirs({ ...moved, project: null })).toEqual([]);
  });

  it('a deleted creator record falls back to the project directory, then to nothing', () => {
    expect(dirs(facts({ creator: null }))).toEqual([ROOT]);
    expect(dirs(facts({ creator: null, project: null }))).toEqual([]);
    expect(dirs(facts({ creator: null, artifact: { createdBy: creator('own') }, project: null, space: { linkedDir: '/docs' } }))).toEqual(['/docs']);
  });

  it('a creator directory that moved or vanished is still the context: no project fallback, only the Space', () => {
    expect(dirs(facts({ creator: { projectId: PROJECT, directory: '/gone/x' } }))).toEqual([]);
    expect(dirs(facts({ creator: { projectId: PROJECT, directory: '/gone/x' }, space: { linkedDir: '/docs' } }))).toEqual(['/docs']);
    expect(artifactDirectories(facts({ creator: { projectId: PROJECT, directory: '/gone/x' } })).hasContext).toBe(true);
  });

  it('an import’s created link is its own session; an owner-created artifact has none and takes the project directory', () => {
    const owner = { createdBy: { kind: 'human' } as Actor, projectId: PROJECT };
    expect(dirs(facts({ artifact: owner, links: [{ appSessionId: 'imp' as never, role: 'created' }], creator: { projectId: PROJECT, directory: WORKTREE } }))).toEqual([WORKTREE]);
    expect(dirs(facts({ artifact: owner, creator: null }))).toEqual([ROOT]);
    expect(dirs(facts({ artifact: { createdBy: { kind: 'human' } }, creator: null }))).toEqual([]); // no project on the row
  });

  it('never borrows another worktree: the project root is no directory of a worktree creator', () => {
    expect(dirs(facts({ creator: { projectId: PROJECT, directory: WORKTREE }, project: { directory: ROOT } }))).not.toContain(ROOT);
  });

  it('is exactly the directory set route E’s eligibility uses', () => {
    const input: DirectoryFacts = facts({ creator: { projectId: PROJECT, directory: WORKTREE }, space: { linkedDir: '/docs' } });
    const live = [WORKTREE, '/docs', ROOT, '/repo/src'].map((cwd, i) => ({ appSessionId: `s${i}`, launchId: `L${i}`, cwd, process: 'ready' as const, lastUsedAt: '2026-10-16T10:00:00.000Z' }));
    const eligibility: EligibilityFacts = { ...input, live };
    const eligibleCwds = eligibleSessions(eligibility).map((s) => s.cwd).sort();
    expect(eligibleCwds).toEqual(live.map((s) => s.cwd).filter((cwd) => artifactDirectories(input).directories.has(cwd)).sort());
  });
});
