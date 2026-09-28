import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import { digest, item, project, record } from '../../../../test/support/builders';
import { TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { loadScenario } from '../../../../test/support/scenario';
import { needsYou } from '../attention/derive';
import { orderProjects, overviewCards, overviewGroups, sortSessions } from './derive';

const scenario = loadScenario(join(TEST_FIXTURE_DIR, 'shell/nine-sessions.json'));
const records = new Map(scenario.sessions.map((r) => [r.appId, r]));
const digests = new Map(scenario.digests.map((d) => [d.appSessionId, { ...d, revision: 1 } as SessionDigest]));
const bySession = new Map(scenario.attention.map((a) => [a.appSessionId, a.items]));
const rows = needsYou(bySession, records);
const titles = (ids: AppSessionId[]) => ids.map((id) => records.get(id)?.title.text);
const input = { records, digests, projects: scenario.projects, rows };

describe('overview grouping', () => {
  it('gives a card to live, unread and waiting sessions, and none to exited read ones', () => {
    const cards = titles(overviewCards(input));
    expect(cards).toEqual(expect.arrayContaining(['Settings idle probe', 'Terminal workflow notes', 'Charter + research', 'Usage reset countdown']));
    expect(cards).not.toContain('Trace stream reconnects');
    expect(cards).not.toContain('SDK wire inventory');
    expect(cards).not.toContain('Workstation north star');
  });

  it('puts Needs you first, then the projects in sidebar order without those sessions, then other sessions', () => {
    const groups = overviewGroups(input);
    expect(groups.map((g) => [g.title, titles(g.sessions)])).toEqual([
      ['Needs you', ['Fix sidebar drag', 'Sidebar interaction pass', 'Quota reset recovery']],
      ['MAWS', ['Charter + research']],
      ['codex_somersault', ['Somersault terminal run']],
      ['claude-usage-menubar', expect.arrayContaining(['Usage reset countdown', 'Settings idle probe'])],
      ['Other sessions', ['Terminal workflow notes']],
    ]);
  });

  it('orders a project’s cards by the latest turn activity', () => {
    const p = project('p', 0);
    const recs = new Map([
      ['old' as AppSessionId, record('old', { projectId: p.id, updatedAt: '2026-09-28T01:00:00Z' })],
      ['ended' as AppSessionId, record('ended', { projectId: p.id })],
      ['started' as AppSessionId, record('started', { projectId: p.id })],
    ]);
    const ds = new Map<AppSessionId, SessionDigest>([
      ['old' as AppSessionId, digest('old', { phase: 'idle' })],
      ['ended' as AppSessionId, digest('ended', { phase: 'idle', lastTurnEndedAt: '2026-09-28T05:00:00Z' })],
      ['started' as AppSessionId, digest('started', { phase: 'working', turnStartedAt: '2026-09-28T06:00:00Z' })],
    ]);
    const [group] = overviewGroups({ records: recs, digests: ds, projects: [p], rows: [] });
    expect(group.sessions).toEqual(['started', 'ended', 'old']);
  });

  it('never shows an archived session, and shows an exited one that is unread or waiting', () => {
    const recs = new Map([
      ['a' as AppSessionId, record('a', { archived: true, unread: true })],
      ['u' as AppSessionId, record('u', { unread: true })],
      ['w' as AppSessionId, record('w')],
    ]);
    const ds = new Map<AppSessionId, SessionDigest>([...recs.keys()].map((id) => [id, digest(id, { phase: 'exited' })]));
    const waiting = needsYou(new Map([['w' as AppSessionId, [item('w', 'interrupted', '2026-09-28T10:00:00Z')]]]), recs);
    expect(overviewCards({ records: recs, digests: ds, projects: [], rows: waiting }).sort()).toEqual(['u', 'w']);
  });

  it('orders projects by their order, then name', () => {
    expect(orderProjects([project('b', 1), project('c', 0, { name: 'zeta' }), project('a', 0, { name: 'alpha' })]).map((p) => p.id)).toEqual([
      'a', 'c', 'b',
    ] as ProjectId[]);
  });
});

describe('sidebar sort', () => {
  const recs = new Map([
    ['idle-old' as AppSessionId, record('idle-old', { updatedAt: '2026-09-28T01:00:00Z' })],
    ['idle-new' as AppSessionId, record('idle-new', { updatedAt: '2026-09-28T09:30:00Z' })],
    ['working' as AppSessionId, record('working')],
    ['unread' as AppSessionId, record('unread', { unread: true })],
    ['needs' as AppSessionId, record('needs')],
  ]);
  const ds = new Map<AppSessionId, SessionDigest>([
    ['idle-old' as AppSessionId, digest('idle-old', { phase: 'idle', lastTurnEndedAt: '2026-09-28T02:00:00Z' })],
    ['idle-new' as AppSessionId, digest('idle-new', { phase: 'idle' })],
    ['working' as AppSessionId, digest('working', { phase: 'working', turnStartedAt: '2026-09-28T03:00:00Z' })],
    ['unread' as AppSessionId, digest('unread', { phase: 'idle', lastTurnEndedAt: '2026-09-28T01:00:00Z' })],
    ['needs' as AppSessionId, digest('needs', { phase: 'waiting' })],
  ]);
  const waiting = needsYou(new Map([['needs' as AppSessionId, [item('needs', 'permission', '2026-09-28T10:00:00Z')]]]), recs);

  it('priority: Needs-you rows, then unread, then working, then the rest by recency', () => {
    expect(sortSessions([...recs.values()], 'priority', { digests: ds, rows: waiting }).map((r) => r.appId)).toEqual([
      'needs', 'unread', 'working', 'idle-new', 'idle-old',
    ]);
  });

  it('recency: the latest of turn start, turn end and update, ties by title', () => {
    // needs, unread and working all last moved at T0 (their records' updatedAt); idle-new at 09:30; idle-old at 02:00.
    expect(sortSessions([...recs.values()], 'recency', { digests: ds, rows: waiting }).map((r) => r.appId)).toEqual([
      'needs', 'unread', 'working', 'idle-new', 'idle-old',
    ]);
  });
});
