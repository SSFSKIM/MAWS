import { describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { project, record } from '../../../../test/support/builders';
import { NO_TOGGLES, resumeCandidates, sessionBranch, TOGGLE_KEYS, type ResumeInput } from './resume';

// W11 (I7): the Resume… picker's list, as `claude --resume` scopes it.
const P = project('p', 0, { name: 'maws' });
const Q = project('q', 1, { name: 'usage' });
const H = project('h', 2, { name: 'gone', hidden: true });
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 12, minutes)).toISOString();
const recs: SessionRecord[] = [
  record('main-old', { projectId: P.id, branch: 'master', updatedAt: at(1), title: { text: 'Fix the drag handle', source: 'none' } }),
  record('main-new', { projectId: P.id, branch: 'master', updatedAt: at(9), title: { text: 'Sidebar pass', source: 'none' } }),
  record('main-feature', { projectId: P.id, branch: 'feature', updatedAt: at(5) }),
  record('worktree', { projectId: P.id, worktree: { path: '/work/p/.claude/worktrees/w', branch: 'master' }, branch: 'stale', updatedAt: at(7) }),
  record('archived', { projectId: P.id, branch: 'master', archived: true, updatedAt: at(20) }),
  record('other-project', { projectId: Q.id, branch: 'master', updatedAt: at(8) }),
  record('no-project', { projectId: null, updatedAt: at(3) }),
  record('hidden-project', { projectId: H.id, updatedAt: at(30) }),
];
const input = (over: Partial<ResumeInput> = {}): ResumeInput => ({
  records: new Map(recs.map((r) => [r.appId, r])),
  digests: new Map(),
  projects: new Map([P, Q, H].map((p) => [p.id, p])),
  projectId: P.id as ProjectId,
  toggles: NO_TOGGLES,
  branch: 'master',
  query: '',
  ...over,
});
const ids = (list: { appId: AppSessionId }[]) => list.map((r) => r.appId);

describe('the Resume… picker’s list', () => {
  it('is the project’s main-checkout sessions, newest first, never archived', () => {
    expect(ids(resumeCandidates(input()))).toEqual(['main-new', 'main-feature', 'main-old']);
  });

  it('All worktrees adds the project’s worktree sessions; Current branch keeps the checkout’s branch, a worktree’s by its own', () => {
    expect(ids(resumeCandidates(input({ toggles: { ...NO_TOGGLES, allWorktrees: true } })))).toEqual(['main-new', 'worktree', 'main-feature', 'main-old']);
    expect(ids(resumeCandidates(input({ toggles: { ...NO_TOGGLES, currentBranch: true } })))).toEqual(['main-new', 'main-old']);
    expect(ids(resumeCandidates(input({ toggles: { ...NO_TOGGLES, currentBranch: true, allWorktrees: true } })))).toEqual(['main-new', 'worktree', 'main-old']);
    expect(ids(resumeCandidates(input({ toggles: { ...NO_TOGGLES, currentBranch: true }, branch: null }))), 'a branch not known keeps nothing').toEqual([]);
    expect(sessionBranch(recs[3])).toBe('master');
  });

  it('All projects widens to every project and Other sessions, never a hidden project’s', () => {
    expect(ids(resumeCandidates(input({ toggles: { ...NO_TOGGLES, allProjects: true } })))).toEqual(['main-new', 'other-project', 'main-feature', 'no-project', 'main-old']);
  });

  it('the search narrows by title, project name and directory, as the sidebar’s does', () => {
    expect(ids(resumeCandidates(input({ query: 'DRAG' })))).toEqual(['main-old']);
    expect(ids(resumeCandidates(input({ query: 'usage', toggles: { ...NO_TOGGLES, allProjects: true } })))).toEqual(['other-project']);
  });

  it('flips its toggles on ⌃ and the CLI’s letters', () => {
    expect(TOGGLE_KEYS).toEqual({ a: 'allProjects', b: 'currentBranch', w: 'allWorktrees' });
  });
});
