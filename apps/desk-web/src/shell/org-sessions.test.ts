// The org view's sessions (smns org directory §8): every live session of every project, each project's own grouping
// (`useDeskSessions`) merged — waiting on the owner first, then working, then idle, ended ones left out — and each group
// ordered newest join first by the `joined` event's time, which means the same in every project's log.
import { describe, expect, it } from 'vitest';
import type { SessionGroup } from '../log/projection';
import { mergeOrgGroups } from './org-sessions';
import type { DeskSession } from './sessions';

const session = (project: string, alias: string, group: SessionGroup, joinedTs: string): DeskSession => ({
  project,
  session: `${alias}-uuid`,
  alias,
  machine: 'mini',
  cwd: null,
  worktree: null,
  seat: '',
  title: null,
  member: group !== 'ended',
  ended: group === 'ended' ? { by: '', reason: 'ended' } : null,
  charge: null,
  status: null,
  state: null,
  joinedAt: 1,
  joinedTs,
  group,
  presence: null,
  machineOnline: true,
});
const groups = (...sessions: DeskSession[]): Record<SessionGroup, DeskSession[]> => {
  const g: Record<SessionGroup, DeskSession[]> = { waiting: [], working: [], idle: [], ended: [] };
  for (const s of sessions) g[s.group].push(s);
  return g;
};

describe('mergeOrgGroups', () => {
  it("merges every project's groups, newest join first in each, by the joined event's time and not a log offset", () => {
    const merged = mergeOrgGroups([
      { project: 'p1', name: 'MAWS', groups: groups(session('p1', 'maws-45', 'waiting', '2026-10-18T08:00:00.000Z'), session('p1', 'maws-fe', 'working', '2026-10-18T10:00:00.000Z'), session('p1', 'maws-1e', 'ended', '2026-10-18T11:00:00.000Z')) },
      { project: 'p2', name: 'mini', groups: groups(session('p2', 'mini-7c', 'waiting', '2026-10-18T09:00:00.000Z'), session('p2', 'mini-02', 'idle', '2026-10-18T07:00:00.000Z')) },
    ]);
    expect(Object.keys(merged)).toEqual(['waiting', 'working', 'idle']);
    expect(merged.waiting.map((s) => [s.alias, s.projectName])).toEqual([
      ['mini-7c', 'mini'],
      ['maws-45', 'MAWS'],
    ]);
    expect(merged.working.map((s) => s.alias)).toEqual(['maws-fe']);
    expect(merged.idle.map((s) => s.alias)).toEqual(['mini-02']);
    expect(Object.values(merged).flat().some((s) => s.alias === 'maws-1e')).toBe(false); // ended: not drawn
  });

  it('orders sessions that joined at the same time by project, then alias, so the list holds still', () => {
    const ts = '2026-10-18T08:00:00.000Z';
    const merged = mergeOrgGroups([
      { project: 'p2', name: 'mini', groups: groups(session('p2', 'b', 'idle', ts)) },
      { project: 'p1', name: 'MAWS', groups: groups(session('p1', 'z', 'idle', ts), session('p1', 'a', 'idle', ts)) },
    ]);
    expect(merged.idle.map((s) => `${s.projectName}/${s.alias}`)).toEqual(['MAWS/a', 'MAWS/z', 'mini/b']);
  });
});
