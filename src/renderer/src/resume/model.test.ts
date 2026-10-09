// P2-D (the P2 spec, child P2-D, G2, G3, G5; owner decision 5): the resume chooser's list, scope, search and groups.
import { describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';
import { project, record } from '../../../../test/support/builders';
import { chooserGroups, chooserRows, folderBadge, groupOf, initialToggles, NO_TOGGLES, rowTime, sessionBranch, shortBranch, TOGGLE_KEYS, type ChooserInput } from './model';

const P = project('p', 0, { name: 'maws' });
const Q = project('q', 1, { name: 'usage' });
const H = project('h', 2, { name: 'gone', hidden: true });
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 12, minutes)).toISOString();
const recs: SessionRecord[] = [
  record('main-old', { projectId: P.id, branch: 'master', updatedAt: at(1), title: { text: 'Fix the drag handle', source: 'none' } }),
  record('main-new', { projectId: P.id, branch: 'master', updatedAt: at(9), title: { text: 'Sidebar pass', source: 'none' } }),
  record('main-feature', { projectId: P.id, branch: 'feature/resume-chooser', updatedAt: at(5) }),
  record('worktree', { projectId: P.id, worktree: { path: '/work/p/.claude/worktrees/w', branch: 'master' }, branch: 'stale', updatedAt: at(7) }),
  record('archived', { projectId: P.id, branch: 'master', archived: true, updatedAt: at(20) }),
  record('other-project', { projectId: Q.id, branch: 'master', updatedAt: at(8) }),
  record('no-project', { projectId: null, updatedAt: at(3) }),
  record('hidden-project', { projectId: H.id, updatedAt: at(30) }),
];
const input = (over: Partial<ChooserInput> = {}): ChooserInput => ({
  records: new Map(recs.map((r) => [r.appId, r])),
  digests: new Map(),
  projects: new Map([P, Q, H].map((p) => [p.id, p])),
  context: { projectId: P.id as ProjectId, exclude: null },
  toggles: NO_TOGGLES,
  branch: 'master',
  query: '',
  ...over,
});
const ids = (rows: { record: { appId: AppSessionId } }[]) => rows.map((r) => r.record.appId);

describe('the chooser’s rows', () => {
  it('are the project’s main-checkout sessions, newest first, never archived, never the session it opened from', () => {
    expect(ids(chooserRows(input()))).toEqual(['main-new', 'main-feature', 'main-old']);
    expect(ids(chooserRows(input({ context: { projectId: P.id as ProjectId, exclude: 'main-new' as AppSessionId } })))).toEqual(['main-feature', 'main-old']);
  });

  it('All worktrees adds the worktree sessions; Current branch keeps the checkout’s branch, a worktree’s by its own', () => {
    expect(ids(chooserRows(input({ toggles: { ...NO_TOGGLES, allWorktrees: true } })))).toEqual(['main-new', 'worktree', 'main-feature', 'main-old']);
    expect(ids(chooserRows(input({ toggles: { ...NO_TOGGLES, currentBranch: true } })))).toEqual(['main-new', 'main-old']);
    expect(ids(chooserRows(input({ toggles: { ...NO_TOGGLES, currentBranch: true, allWorktrees: true } })))).toEqual(['main-new', 'worktree', 'main-old']);
    expect(ids(chooserRows(input({ toggles: { ...NO_TOGGLES, currentBranch: true }, branch: null }))), 'a branch not known keeps nothing').toEqual([]);
    expect(sessionBranch(recs[3])).toBe('master');
  });

  it('All projects widens to every project and Other sessions; Archived adds archived and hidden projects’ sessions', () => {
    expect(ids(chooserRows(input({ toggles: { ...NO_TOGGLES, allProjects: true } })))).toEqual(['main-new', 'other-project', 'main-feature', 'no-project', 'main-old']);
    expect(ids(chooserRows(input({ toggles: { ...NO_TOGGLES, allProjects: true, archived: true } })))).toEqual(['hidden-project', 'archived', 'main-new', 'other-project', 'main-feature', 'no-project', 'main-old']);
  });

  it('a session with no project opens on every project (owner decision 5: the current project, else all)', () => {
    expect(initialToggles({ projectId: null, exclude: null }).allProjects).toBe(true);
    expect(initialToggles({ projectId: P.id as ProjectId, exclude: null })).toEqual(NO_TOGGLES);
    expect(ids(chooserRows(input({ context: { projectId: null, exclude: null } }))), 'All projects off: Other sessions').toEqual(['no-project']);
  });

  it('the search narrows by title, project name, folder and branch (G2: the branch joins the sidebar’s matcher)', () => {
    expect(ids(chooserRows(input({ query: 'DRAG' })))).toEqual(['main-old']);
    expect(ids(chooserRows(input({ query: 'usage', toggles: { ...NO_TOGGLES, allProjects: true } })))).toEqual(['other-project']);
    expect(ids(chooserRows(input({ query: 'resume-chooser' })))).toEqual(['main-feature']);
    expect(ids(chooserRows(input({ query: '/work/main-old' })))).toEqual(['main-old']);
  });

  it('orders by the one activity time, a latest turn over the record’s update; ties by title', () => {
    const digests = new Map([['main-old' as AppSessionId, { lastTurnEndedAt: at(40), turnStartedAt: null } as unknown as SessionDigest]]);
    const rows = chooserRows(input({ digests }));
    expect(ids(rows)).toEqual(['main-old', 'main-new', 'main-feature']);
    expect(rows[0].at).toBe(Date.parse(at(40)));
    const tied = [record('b', { projectId: P.id, updatedAt: at(1), title: { text: 'Beta', source: 'user' } }), record('a', { projectId: P.id, updatedAt: at(1), title: { text: 'Alpha', source: 'user' } })];
    expect(ids(chooserRows(input({ records: new Map(tied.map((r) => [r.appId, r])) })))).toEqual(['a', 'b']);
  });

  it('flips its toggles on ⌃ and the CLI’s letters', () => {
    expect(TOGGLE_KEYS).toEqual({ a: 'allProjects', b: 'currentBranch', w: 'allWorktrees' });
  });
});

describe('the chooser’s groups', () => {
  // Thursday 2026-10-08, 15:00 local
  const now = new Date(2026, 9, 8, 15, 0).getTime();
  const local = (day: number, hour = 10, month = 9, year = 2026) => new Date(year, month, day, hour, 0).getTime();

  it('Today, Yesterday, the rest of this week, last week, then one group per week', () => {
    expect(groupOf(local(8, 9), now)).toMatchObject({ kind: 'today', label: 'Today' });
    expect(groupOf(local(8, 23), now), 'a time ahead of the clock is today').toMatchObject({ kind: 'today' });
    expect(groupOf(local(7, 23), now)).toMatchObject({ kind: 'yesterday', label: 'Yesterday' });
    expect(groupOf(local(5, 0), now)).toMatchObject({ kind: 'thisWeek', label: 'Earlier this week' }); // Monday
    expect(groupOf(local(4, 23), now)).toMatchObject({ kind: 'lastWeek', label: 'Last week' }); // Sunday
    expect(groupOf(local(28, 9, 8), now)).toMatchObject({ kind: 'lastWeek' }); // Monday 2026-09-28
    expect(groupOf(local(27, 9, 8), now)).toMatchObject({ kind: 'week', key: `week:${local(21, 0, 8)}` });
    expect(groupOf(local(27, 9, 8), now).label).toBe(`Week of ${new Date(local(21, 0, 8)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
    expect(groupOf(local(30, 9, 11, 2025), now).label, 'another year names it').toContain('2025');
  });

  it('groups rows in order and gives each its time', () => {
    const row = (id: string, ms: number) => ({ record: record(id), at: ms });
    const groups = chooserGroups([row('a', local(8, 14)), row('b', local(8, 9)), row('c', local(7)), row('d', local(1)), row('e', local(20, 10, 8))], now);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.record.appId)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Last week', ['d']],
      [`Week of ${new Date(local(14, 0, 8)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, ['e']],
    ]);
    expect(rowTime(local(8, 14), 'today', now)).toBe(new Date(local(8, 14)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    expect(rowTime(local(6, 14), 'thisWeek', now)).toMatch(/^\S+ /);
    expect(rowTime(local(1), 'lastWeek', now)).toBe(new Date(local(1)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  });
});

describe('row badges', () => {
  it('names a worktree’s folder, another project, or a projectless session’s folder; nothing for the opened project', () => {
    const context = { projectId: P.id as ProjectId, exclude: null };
    const projects = new Map([P, Q].map((p) => [p.id, p]));
    expect(folderBadge(recs[0], projects, context)).toBeNull();
    expect(folderBadge(recs[3], projects, context)).toBe('w');
    expect(folderBadge(recs[5], projects, context)).toBe('usage');
    expect(folderBadge(recs[6], projects, context)).toBe('no-project');
    expect(shortBranch('feature/resume-chooser')).toBe('resume-chooser');
    expect(shortBranch('master')).toBe('master');
  });
});
