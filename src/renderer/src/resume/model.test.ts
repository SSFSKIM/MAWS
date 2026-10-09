// P2-D (the P2 spec, child P2-D, G2, G3, G5; owner decision 5): the resume chooser's list, scope, search and groups.
import { describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';
import { project, record } from '../../../../test/support/builders';
import { formatClock, formatShortDate, formatWeekdayClock } from '../app/date-format';
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
    expect(groupOf(local(27, 9, 8), now).label).toBe(`Week of ${formatShortDate(local(21, 0, 8), now)}`);
    expect(groupOf(local(30, 9, 11, 2025), now).label, 'another year names it').toContain('2025');
  });

  it('groups rows in order and gives each its time', () => {
    const row = (id: string, ms: number) => ({ record: record(id), at: ms });
    const groups = chooserGroups([row('a', local(8, 14)), row('b', local(8, 9)), row('c', local(7)), row('d', local(1)), row('e', local(20, 10, 8))], now);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.record.appId)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Last week', ['d']],
      [`Week of ${formatShortDate(local(14, 0, 8), now)}`, ['e']],
    ]);
    expect(rowTime(local(8, 14), 'today', now)).toBe(formatClock(local(8, 14)));
    expect(rowTime(local(6, 14), 'thisWeek', now)).toBe(formatWeekdayClock(local(6, 14)));
    expect(rowTime(local(1), 'lastWeek', now)).toBe(formatShortDate(local(1), now));
  });

  it('a Monday week runs across New Year (Mon 2026-12-28 to Sun 2027-01-03)', () => {
    const at = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month, day, hour, minute).getTime();
    const saturday = at(2027, 0, 2, 10);
    expect(groupOf(at(2027, 0, 1, 9), saturday)).toMatchObject({ kind: 'yesterday' });
    expect(groupOf(at(2026, 11, 28), saturday)).toMatchObject({ kind: 'thisWeek' });
    expect(groupOf(at(2026, 11, 27, 23, 59), saturday)).toMatchObject({ kind: 'lastWeek' });
    expect(groupOf(at(2026, 11, 20, 12), saturday)).toMatchObject({ kind: 'week', key: `week:${at(2026, 11, 14)}` });
    const monday = at(2027, 0, 4, 9);
    expect(groupOf(at(2026, 11, 31, 23, 59), monday)).toMatchObject({ kind: 'lastWeek' });
    expect(groupOf(at(2026, 11, 28), monday)).toMatchObject({ kind: 'lastWeek' });
    expect(groupOf(at(2026, 11, 27, 23, 59), monday)).toMatchObject({ kind: 'week', key: `week:${at(2026, 11, 21)}` });
    const newYearsDay = groupOf(at(2027, 0, 1, 9), at(2027, 0, 20, 9));
    expect(newYearsDay, 'a week starting in the year before names that year').toMatchObject({ kind: 'week', key: `week:${at(2026, 11, 28)}` });
    expect(newYearsDay.label).toContain('2026');
    const row = (id: string, ms: number) => ({ record: record(id), at: ms });
    const groups = chooserGroups([row('a', at(2027, 0, 2, 8)), row('b', at(2027, 0, 1, 9)), row('c', at(2026, 11, 29, 9)), row('d', at(2026, 11, 27, 9))], saturday);
    expect(groups.map((g) => [g.kind, g.rows.map((r) => r.record.appId)])).toEqual([['today', ['a']], ['yesterday', ['b']], ['thisWeek', ['c']], ['lastWeek', ['d']]]);
  });

  // The local days of 2026 on which the clock moves (the UTC offset at noon differs from the day before's); a zone
  // without daylight saving time has none, and these cases have nothing to prove there. A change at midnight (a day
  // with no 00:00, as in America/Santiago) counts too: its day starts at the first hour it has.
  const clockChanges: { day: Date; forward: boolean }[] = [];
  for (let d = new Date(2026, 0, 2, 12); d.getFullYear() === 2026; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12)) {
    const before = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTimezoneOffset();
    if (d.getTimezoneOffset() !== before) clockChanges.push({ day: d, forward: d.getTimezoneOffset() < before });
  }
  // Around a clock change: the days stay calendar days (23 or 25 hours long) and the weeks start at local Monday midnight.
  const acrossChange = (change: { day: Date }) => {
    // the first Monday after the change: the change falls in the week before it
    const monday = new Date(change.day.getFullYear(), change.day.getMonth(), change.day.getDate() + ((8 - change.day.getDay()) % 7 || 7));
    const at = (days: number, hour = 0, minute = 0) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + days, hour, minute).getTime();
    const mondayMorning = at(0, 9);
    expect(groupOf(at(-1, 0, 30), mondayMorning)).toMatchObject({ kind: 'yesterday' });
    expect(groupOf(at(-1, 23, 30), mondayMorning)).toMatchObject({ kind: 'yesterday' });
    expect(groupOf(at(-2, 23, 30), mondayMorning)).toMatchObject({ kind: 'lastWeek' });
    expect(groupOf(at(-7, 0, 30), mondayMorning)).toMatchObject({ kind: 'lastWeek' });
    expect(groupOf(at(-8, 23, 30), mondayMorning)).toMatchObject({ kind: 'week', key: `week:${at(-14)}` });
    const sundayNight = at(-1, 23, 30);
    expect(groupOf(at(-2, 0, 30), sundayNight)).toMatchObject({ kind: 'yesterday' });
    expect(groupOf(at(-7, 0, 30), sundayNight)).toMatchObject({ kind: 'thisWeek' });
    expect(groupOf(at(-8, 23, 30), sundayNight)).toMatchObject({ kind: 'lastWeek' });
    const row = (id: string, ms: number) => ({ record: record(id), at: ms });
    expect(chooserGroups([row('a', at(-1, 12)), row('b', at(-7, 0, 30)), row('c', at(-8, 23, 30))], mondayMorning).map((g) => g.kind)).toEqual(['yesterday', 'lastWeek', 'week']);
  };
  const springForward = clockChanges.find((change) => change.forward);
  const fallBack = clockChanges.find((change) => !change.forward);
  it.skipIf(springForward === undefined)('across a spring-forward day (23 hours)', () => acrossChange(springForward!));
  it.skipIf(fallBack === undefined)('across a fall-back day (25 hours)', () => acrossChange(fallBack!));
});

describe('row badges', () => {
  it('names a worktree’s folder, another project, or a projectless session’s folder; nothing for the project scoped to', () => {
    const projects = new Map([P, Q].map((p) => [p.id, p]));
    expect(folderBadge(recs[0], projects, P.id as ProjectId)).toBeNull();
    expect(folderBadge(recs[3], projects, P.id as ProjectId)).toBe('w');
    expect(folderBadge(recs[5], projects, P.id as ProjectId)).toBe('usage');
    expect(folderBadge(recs[6], projects, P.id as ProjectId)).toBe('no-project');
    // under All projects the list is scoped to no one project, so the opened project's rows name it too
    expect(folderBadge(recs[0], projects, null)).toBe('maws');
    expect(folderBadge(recs[6], projects, null)).toBe('no-project');
    expect(shortBranch('feature/resume-chooser')).toBe('resume-chooser');
    expect(shortBranch('master')).toBe('master');
  });
});
