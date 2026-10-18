// E3 M3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R4): the live label's pure parts. The temporal stale
// label is computed from an explicit `now` at `snapshot.at + staleAfter`, exactly, and is supplementary: it never replaces
// the operational state or the successful fetch's provenance; a paused or permission note from the live bridge is a
// closed string beside them, never twice; a query's identity is its server, tool and arguments in any key order.
import { describe, expect, it } from 'vitest';
import type { DatasetDescriptor } from '../datasets';
import { DATASET_STATES, sourceLabel, utcTime } from '../states';
import { queryIdentity } from '../query';
import { livePauseLabel, livePauseOf, scheduleWords, type LiveQueryStatus } from './live';

const AT = Date.UTC(2026, 9, 17, 9, 0);
const fetched = (patch: Partial<DatasetDescriptor> = {}): DatasetDescriptor =>
  ({
    title: 'Live sales',
    source: { kind: 'query', server: 'fixture', tool: 'rows', args: { region: 'north' }, schedule: 30, staleAfter: 120, snapshot: { ref: 'assets/query-1.json', at: AT } },
    columns: [{ name: 'v', type: 'number' }],
    rows: 3,
    updated: { at: AT, by: { kind: 'human' } },
    state: { status: 'ok', at: AT },
    ...patch,
  }) as DatasetDescriptor;
const status = (patch: Partial<LiveQueryStatus> = {}): LiveQueryStatus => ({ identity: 'x', server: 'fixture', tool: 'rows', snapshot: null, error: null /* E3 panel */, permission: 'read', pause: null, busy: null, ...patch });

describe('the live source label (E3 M3)', () => {
  it('draws stale since snapshot.at + staleAfter exactly at the boundary, not a millisecond before', () => {
    const since = AT + 120_000;
    expect(sourceLabel(fetched(), 'You', { now: since - 1 })).toBe(`Live sales · fixture · rows · updated ${utcTime(AT)} by You`);
    expect(sourceLabel(fetched(), 'You', { now: since })).toBe(`Live sales · fixture · rows · updated ${utcTime(AT)} by You · ${DATASET_STATES.staleSince(since)}`);
  });

  it('keeps the stale label beside an error or a pause, the successful fetch time unchanged', () => {
    const errored = fetched({ state: { status: 'error', message: 'the result is not a table', at: AT + 600_000 } });
    expect(sourceLabel(errored, 'You', { now: AT + 600_000, pause: DATASET_STATES.paused })).toBe(
      `Live sales · fixture · rows · updated ${utcTime(AT)} by You · ${DATASET_STATES.staleSince(AT + 120_000)} · the result is not a table · ${DATASET_STATES.paused}`,
    );
  });

  it('never says a pause twice, and a never-fetched query is never stale', () => {
    const paused = fetched({ source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref: 'assets/q.json', at: AT } }, state: { status: 'paused', at: AT } });
    expect(sourceLabel(paused, 'You', { now: AT, pause: DATASET_STATES.paused }).split(DATASET_STATES.paused)).toHaveLength(2);
    const unfetched = { title: 'Live sales', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, staleAfter: 1, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: AT } } as DatasetDescriptor;
    expect(sourceLabel(unfetched, '', { now: AT + 10 ** 9 })).toBe(`Live sales · fixture · rows · ${DATASET_STATES.notFetched}`);
  });

  it('without a live clock is E2’s label, unchanged (exports and history previews)', () => {
    expect(sourceLabel(fetched(), 'You')).toBe(`Live sales · fixture · rows · updated ${utcTime(AT)} by You`);
  });
});

describe('the live pause (E3 M3)', () => {
  it('is the permission first (no read grant reads "not allowed"), else what the bridge last answered', () => {
    expect(livePauseOf(status({ permission: 'none', pause: 'noRoute' }))).toBe('notAllowed');
    expect(livePauseOf(status({ permission: 'unknown', pause: 'noRoute' }))).toBe('noRoute');
    expect(livePauseOf(status({ permission: 'read', pause: 'allowChanged' }))).toBe('allowChanged');
    expect(livePauseOf(status())).toBeNull();
    expect(livePauseOf(undefined)).toBeNull();
  });

  it('says a concrete refusal over a missing grant (E3 M3 fix): the tool may write, a failed refresh, the watch limit', () => {
    expect(livePauseOf(status({ permission: 'none', pause: 'mayWrite' }))).toBe('mayWrite');
    expect(livePauseOf(status({ permission: 'none', pause: 'failed' }))).toBe('failed');
    expect(livePauseOf(status({ permission: 'none', pause: 'watchLimit' }))).toBe('watchLimit');
  });

  it('says each pause in a closed string of the states module, the no-route one E2’s own', () => {
    expect(livePauseLabel('noRoute')).toBe('paused: no live session');
    for (const pause of ['notAllowed', 'allowChanged', 'mayWrite', 'watchLimit', 'failed'] as const) expect(Object.values(DATASET_STATES)).toContain(livePauseLabel(pause));
  });
});

describe('a query’s identity and schedule (E3 M3)', () => {
  it('is its server, tool and arguments in any key order, never its schedule or staleness', () => {
    const a = queryIdentity({ server: 's', tool: 't', args: { b: 1, a: { y: 2, x: [1, { q: 1, p: 2 }] } } });
    expect(queryIdentity({ server: 's', tool: 't', args: { a: { x: [1, { p: 2, q: 1 }], y: 2 }, b: 1 } })).toBe(a);
    expect(queryIdentity({ server: 's', tool: 't', args: { b: 2, a: { y: 2, x: [1, { q: 1, p: 2 }] } } })).not.toBe(a);
    expect(queryIdentity({ server: 's', tool: 'u', args: {} })).not.toBe(queryIdentity({ server: 's', tool: 't', args: {} }));
    expect(queryIdentity({ server: 'a,b', tool: 'c', args: {} })).not.toBe(queryIdentity({ server: 'a', tool: 'b,c', args: {} }));
  });

  it('words a schedule in its largest whole unit, and its absence as manual', () => {
    expect(scheduleWords(30)).toBe('Refreshes every 30 seconds while this dashboard is on screen');
    expect(scheduleWords(300)).toBe('Refreshes every 5 minutes while this dashboard is on screen');
    expect(scheduleWords(3_600)).toBe('Refreshes every hour while this dashboard is on screen');
    expect(scheduleWords(86_400)).toBe('Refreshes every day while this dashboard is on screen');
    expect(scheduleWords(90)).toBe('Refreshes every 90 seconds while this dashboard is on screen');
    expect(scheduleWords(undefined)).toBe('Refreshes only when you ask');
  });
});
