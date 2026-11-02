import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { item, record, remoteRow } from '../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../test/support/machine';
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

// P5 O7 M6 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M6 "Counting without a record"): another machine's
// session with no record is listed; its row stands in, so its item counts and is drawn under it. A greyed machine's items
// are drawn after every live row and marked, for the selectors to keep out of every count.
describe('needs-you across machines', () => {
  const rs = (...list: SessionRecord[]) => new Map(list.map((r) => [r.appId, r]));
  const listedOf = (...ids: string[]) => new Map(ids.map((id) => [id as AppSessionId, { ...remoteRow(OTHER_MACHINE, id, { title: id === 'blank' ? ' ' : `Remote ${id}` }), appId: id as AppSessionId }]));

  it('counts an item of a session with no record when a listed row stands in, and still none with neither', () => {
    const rows = needsYou(
      new Map([
        ['local' as AppSessionId, [item('local', 'permission', '2026-09-28T10:00:00Z')]],
        ['listed' as AppSessionId, [item('listed', 'permission', '2026-09-28T09:00:00Z')]],
        ['nowhere' as AppSessionId, [item('nowhere', 'permission', '2026-09-28T08:00:00Z')]],
      ]),
      rs(record('local')),
      { listed: listedOf('listed') },
    );
    expect(rows.map((r) => r.appSessionId)).toEqual(['listed', 'local']);
    expect(rows.every((r) => r.greyed === undefined)).toBe(true);
  });

  it('a record wins over its listed row: an archived record has no row even while listed', () => {
    const rows = needsYou(new Map([['x' as AppSessionId, [item('x', 'permission', '2026-09-28T10:00:00Z')]]]), rs(record('x', { archived: true })), { listed: listedOf('x') });
    expect(rows).toEqual([]);
  });

  it('breaks a tie on wait by the listed row’s title, “New chat” for an empty one', () => {
    const at = '2026-09-28T10:00:00Z';
    const rows = needsYou(
      new Map([
        ['b' as AppSessionId, [item('b', 'permission', at)]],
        ['blank' as AppSessionId, [item('blank', 'permission', at)]],
        ['a' as AppSessionId, [item('a', 'permission', at)]],
      ]),
      new Map(),
      { listed: listedOf('a', 'b', 'blank') },
    );
    expect(rows.map((r) => r.appSessionId)).toEqual(['blank', 'a', 'b']); // "New chat" < "Remote a" < "Remote b"
  });

  it('marks a greyed session’s row and puts it after every live row, the oldest wait included', () => {
    const rows = needsYou(
      new Map([
        ['grey' as AppSessionId, [item('grey', 'permission', '2026-09-28T06:00:00Z')]],
        ['peer' as AppSessionId, [item('peer', 'held_peer_message', '2026-09-28T07:00:00Z')]],
        ['live' as AppSessionId, [item('live', 'permission', '2026-09-28T10:00:00Z')]],
      ]),
      rs(record('peer'), record('live')),
      { listed: listedOf('grey'), greyed: new Set(['grey' as AppSessionId]) },
    );
    expect(rows.map((r) => [r.appSessionId, r.greyed ?? false])).toEqual([['live', false], ['peer', false], ['grey', true]]);
  });

  it('⌘⇧J never lands on a greyed row', () => {
    const rows = needsYou(
      new Map([
        ['grey' as AppSessionId, [item('grey', 'permission', '2026-09-28T06:00:00Z')]],
        ['live' as AppSessionId, [item('live', 'permission', '2026-09-28T10:00:00Z')]],
      ]),
      rs(record('live')),
      { listed: listedOf('grey'), greyed: new Set(['grey' as AppSessionId]) },
    );
    expect(nextNeedsYou(rows, 'live' as AppSessionId)?.appSessionId).toBe('live');
    expect(nextNeedsYou(rows.filter((r) => r.greyed), null)).toBeNull();
  });
});
