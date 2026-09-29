import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { item, record } from '../../../../test/support/builders';
import { TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { loadScenario } from '../../../../test/support/scenario';
import { needsYou, nextNeedsYou } from './derive';

const scenario = loadScenario(join(TEST_FIXTURE_DIR, 'shell/nine-sessions.json'));
const records = new Map(scenario.sessions.map((r) => [r.appId, r]));
const titleOf = (id: AppSessionId) => records.get(id)?.title.text;
const atLoad = () => new Map(scenario.attention.map((a) => [a.appSessionId, a.items]));

describe('needs-you ordering', () => {
  it('lists one row per waiting session, longest wait first', () => {
    expect(needsYou(atLoad(), records).map((row) => titleOf(row.appSessionId))).toEqual([
      'Fix sidebar drag',
      'Sidebar interaction pass',
      'Quota reset recovery',
    ]);
  });

  it('puts the read-only request that arrives at 3 s last, as the newest', () => {
    const bySession = atLoad();
    const entry = scenario.timeline.find((op) => op.op === 'attention' && op.at === 3000);
    if (entry?.op !== 'attention') throw new Error('the scenario has no 3 s attention entry');
    bySession.set(entry.appSessionId, entry.items);
    const rows = needsYou(bySession, records);
    expect(rows.map((row) => titleOf(row.appSessionId))).toEqual([
      'Fix sidebar drag',
      'Sidebar interaction pass',
      'Quota reset recovery',
      'Charter + research',
    ]);
  });

  const rs = (...list: SessionRecord[]) => new Map(list.map((r) => [r.appId, r]));

  it('puts a session with only a held peer message in tier 2, after every tier-1 row', () => {
    const rows = needsYou(
      new Map<AppSessionId, AttentionItem[]>([
        ['peer' as AppSessionId, [item('peer', 'held_peer_message', '2026-09-28T08:00:00Z')]],
        ['late' as AppSessionId, [item('late', 'question', '2026-09-28T12:00:00Z')]],
      ]),
      rs(record('peer'), record('late')),
    );
    expect(rows.map((r) => [r.appSessionId, r.tier])).toEqual([['late', 1], ['peer', 2]]);
  });

  it('shows the oldest item of the row’s tier and counts every open item', () => {
    const [row] = needsYou(
      new Map([
        ['s' as AppSessionId, [
          item('s', 'held_peer_message', '2026-09-28T07:00:00Z'),
          item('s', 'permission', '2026-09-28T10:00:00Z'),
          item('s', 'question', '2026-09-28T09:00:00Z'),
          item('s', 'plan', '2026-09-28T06:00:00Z', { state: 'confirmed' }),
        ]],
      ]),
      rs(record('s')),
    );
    expect(row).toMatchObject({ tier: 1, count: 3, oldest: { kind: 'question' } });
  });

  it('counts delivered items, ignores confirmed and retired ones, and excludes archived sessions', () => {
    const rows = needsYou(
      new Map([
        ['d' as AppSessionId, [item('d', 'permission', '2026-09-28T10:00:00Z', { state: 'delivered' })]],
        ['r' as AppSessionId, [item('r', 'permission', '2026-09-28T10:00:00Z', { state: 'retired' })]],
        ['x' as AppSessionId, [item('x', 'permission', '2026-09-28T10:00:00Z')]],
      ]),
      rs(record('d'), record('r'), record('x', { archived: true })),
    );
    expect(rows.map((r) => r.appSessionId)).toEqual(['d']);
  });

  it('breaks a tie on wait by title', () => {
    const at = '2026-09-28T10:00:00Z';
    const rows = needsYou(
      new Map([
        ['b' as AppSessionId, [item('b', 'permission', at)]],
        ['a' as AppSessionId, [item('a', 'permission', at)]],
      ]),
      rs(record('b', { title: { text: 'Beta', source: 'user' } }), record('a', { title: { text: 'Alpha', source: 'user' } })),
    );
    expect(rows.map((r) => r.appSessionId)).toEqual(['a', 'b']);
  });

  it('jumps to the first row that is not the current session, wrapping', () => {
    const rows = needsYou(atLoad(), records);
    expect(nextNeedsYou(rows, null)).toBe(rows[0]);
    expect(nextNeedsYou(rows, rows[0].appSessionId)).toBe(rows[1]);
    expect(nextNeedsYou(rows, rows[1].appSessionId)).toBe(rows[0]); // a middle current row: still the oldest, not the next
    expect(nextNeedsYou(rows, rows[2].appSessionId)).toBe(rows[0]);
    expect(nextNeedsYou(rows, 'not-waiting' as AppSessionId)).toBe(rows[0]);
    expect(nextNeedsYou(rows.slice(0, 1), rows[0].appSessionId)).toBe(rows[0]);
    expect(nextNeedsYou([], null)).toBeNull();
  });
});
