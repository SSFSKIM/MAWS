// P3-HD M3b: route D's host-only tool hints (./direct-hints.ts; docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// Decision Log 15, 18 and 21). A hint is what a live tools/list on MAWS's own connection said of a verified source:
// metadata for eligibility, never authority. These tests pin its identity, publication order, bounds and lifetimes.
import { describe, expect, it } from 'vitest';
import { DIRECT_HINT_BOUNDS, DirectToolHints } from './direct-hints';

const SOURCE = { sourceId: 'source-1', generation: 1, entryDigest: 'digest-1' };
const ROWS_READ = [{ name: 'rows', readOnly: true }];
const ROWS_WRITE = [{ name: 'rows', readOnly: false }];
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

describe('DirectToolHints: identity', () => {
  it('answers a tool only for the exact source id, generation and entry digest it was listed under', () => {
    const hints = new DirectToolHints();
    expect(hints.publish(SOURCE, [...ROWS_READ, { name: 'send', readOnly: false }], { admittedAt: hints.admit() })).toBe(true);
    expect(hints.readOnly(SOURCE, 'rows')).toBe(true);
    expect(hints.readOnly(SOURCE, 'send')).toBe(false);
    expect(hints.readOnly(SOURCE, 'absent')).toBeNull();
    expect(hints.readOnly({ ...SOURCE, generation: 2 }, 'rows')).toBeNull();
    expect(hints.readOnly({ ...SOURCE, entryDigest: 'digest-2' }, 'rows')).toBeNull();
    expect(hints.readOnly({ ...SOURCE, sourceId: 'source-2' }, 'rows')).toBeNull();
  });

  it('refuses a listing past the per-source tool bound rather than keep part of it', () => {
    const hints = new DirectToolHints();
    const tools = Array.from({ length: DIRECT_HINT_BOUNDS.toolsPerSource + 1 }, (_, index) => ({ name: `t${index}`, readOnly: true }));
    expect(hints.publish(SOURCE, tools, { admittedAt: hints.admit() })).toBe(false);
    expect(hints.readOnly(SOURCE, 't0')).toBeNull();
  });
});

describe('DirectToolHints: publication order', () => {
  it('a delayed listing admitted earlier never replaces one admitted later', () => {
    const hints = new DirectToolHints();
    const older = hints.admit();
    const newer = hints.admit();
    expect(hints.publish(SOURCE, ROWS_WRITE, { admittedAt: newer })).toBe(true);
    expect(hints.publish(SOURCE, ROWS_READ, { admittedAt: older })).toBe(false);
    expect(hints.readOnly(SOURCE, 'rows')).toBe(false);
    const latest = hints.admit();
    expect(hints.publish(SOURCE, ROWS_READ, { admittedAt: latest })).toBe(true);
    expect(hints.readOnly(SOURCE, 'rows')).toBe(true);
  });

  it('a credential-less listing never replaces a credentialed one, nor a lower epoch of the same connection a higher', () => {
    const hints = new DirectToolHints();
    expect(hints.publish(SOURCE, ROWS_READ, { admittedAt: hints.admit(), credential: { connectionId: C1, credentialEpoch: 4 } })).toBe(true);
    expect(hints.publish(SOURCE, ROWS_WRITE, { admittedAt: hints.admit() })).toBe(false);
    expect(hints.publish(SOURCE, ROWS_WRITE, { admittedAt: hints.admit(), credential: { connectionId: C1, credentialEpoch: 3 } })).toBe(false);
    expect(hints.readOnly(SOURCE, 'rows')).toBe(true);
    expect(hints.publish(SOURCE, ROWS_WRITE, { admittedAt: hints.admit(), credential: { connectionId: C1, credentialEpoch: 5 } })).toBe(true);
    expect(hints.readOnly(SOURCE, 'rows')).toBe(false);
  });
});

describe('DirectToolHints: lifetimes', () => {
  it('clear forgets every hint, and a publisher admitted before it cannot recreate one', () => {
    const hints = new DirectToolHints();
    const pending = hints.admit();
    hints.publish(SOURCE, ROWS_READ, { admittedAt: hints.admit() });
    hints.clear();
    expect(hints.readOnly(SOURCE, 'rows')).toBeNull();
    expect(hints.publish(SOURCE, ROWS_READ, { admittedAt: pending })).toBe(false);
    expect(hints.readOnly(SOURCE, 'rows')).toBeNull();
    expect(hints.publish(SOURCE, ROWS_READ, { admittedAt: hints.admit() })).toBe(true);
  });

  it('a credential withdrawal forgets its hints at or below the floor, keeps a higher epoch and other connections', () => {
    const hints = new DirectToolHints();
    const other = { ...SOURCE, sourceId: 'source-2' };
    const higher = { ...SOURCE, sourceId: 'source-3' };
    const open = { ...SOURCE, sourceId: 'source-4' };
    const pending = hints.admit();
    hints.publish(SOURCE, ROWS_READ, { admittedAt: hints.admit(), credential: { connectionId: C1, credentialEpoch: 2 } });
    hints.publish(higher, ROWS_READ, { admittedAt: hints.admit(), credential: { connectionId: C1, credentialEpoch: 3 } });
    hints.publish(other, ROWS_READ, { admittedAt: hints.admit(), credential: { connectionId: C2, credentialEpoch: 1 } });
    hints.publish(open, ROWS_READ, { admittedAt: hints.admit() });
    hints.withdraw(C1, 2);
    expect(hints.readOnly(SOURCE, 'rows')).toBeNull();
    expect(hints.readOnly(higher, 'rows')).toBe(true);
    expect(hints.readOnly(other, 'rows')).toBe(true);
    expect(hints.readOnly(open, 'rows')).toBe(true);
    // a publisher admitted before the withdrawal cannot recreate the withdrawn slot
    expect(hints.publish(SOURCE, ROWS_READ, { admittedAt: pending, credential: { connectionId: C1, credentialEpoch: 3 } })).toBe(false);
    expect(hints.readOnly(SOURCE, 'rows')).toBeNull();
    // the same demand under the new epoch, admitted after, repopulates it
    expect(hints.publish(SOURCE, ROWS_READ, { admittedAt: hints.admit(), credential: { connectionId: C1, credentialEpoch: 3 } })).toBe(true);
    expect(hints.readOnly(SOURCE, 'rows')).toBe(true);
  });

  it('holds at most its source bound, evicting the oldest; an evicted slot is not recreated by a publisher admitted before', () => {
    const hints = new DirectToolHints();
    const pending = hints.admit();
    const sources = Array.from({ length: DIRECT_HINT_BOUNDS.sources + 1 }, (_, index) => ({ ...SOURCE, sourceId: `source-${index}` }));
    for (const source of sources) expect(hints.publish(source, ROWS_READ, { admittedAt: hints.admit() })).toBe(true);
    expect(hints.readOnly(sources[0]!, 'rows')).toBeNull();
    expect(hints.readOnly(sources[1]!, 'rows')).toBe(true);
    expect(hints.readOnly(sources.at(-1)!, 'rows')).toBe(true);
    expect(hints.publish(sources[0]!, ROWS_READ, { admittedAt: pending })).toBe(false);
    expect(hints.readOnly(sources[0]!, 'rows')).toBeNull();
  });

  // P3-F L269: an invalidation reaches only the identity it concerns, so an unrelated first listing is never late.
  it('a withdrawal never suppresses an unrelated source’s pending first listing; the withdrawn credential’s pending ones stay out', () => {
    const hints = new DirectToolHints();
    const open = { ...SOURCE, sourceId: 'source-open' };
    const elsewhere = { ...SOURCE, sourceId: 'source-c2' };
    const underWithdrawn = { ...SOURCE, sourceId: 'source-c1' };
    hints.publish(SOURCE, ROWS_READ, { admittedAt: hints.admit(), credential: { connectionId: C1, credentialEpoch: 1 } });
    const pendingOpen = hints.admit(); // first listings of other sources, in flight across the withdrawal
    const pendingC2 = hints.admit();
    const pendingC1 = hints.admit();
    hints.withdraw(C1, 1);
    expect(hints.publish(open, ROWS_READ, { admittedAt: pendingOpen })).toBe(true);
    expect(hints.publish(elsewhere, ROWS_READ, { admittedAt: pendingC2, credential: { connectionId: C2, credentialEpoch: 1 } })).toBe(true);
    expect(hints.publish(underWithdrawn, ROWS_READ, { admittedAt: pendingC1, credential: { connectionId: C1, credentialEpoch: 1 } })).toBe(false);
    expect(hints.readOnly(open, 'rows')).toBe(true);
    expect(hints.readOnly(elsewhere, 'rows')).toBe(true);
    expect(hints.readOnly(underWithdrawn, 'rows')).toBeNull();
  });

  it('an eviction never suppresses an unrelated source’s pending first listing', () => {
    const hints = new DirectToolHints({ sources: 2, toolsPerSource: 8 });
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => ({ ...SOURCE, sourceId: id }));
    hints.publish(a!, ROWS_READ, { admittedAt: hints.admit() });
    const pending = hints.admit();
    hints.publish(b!, ROWS_READ, { admittedAt: hints.admit() });
    hints.publish(c!, ROWS_READ, { admittedAt: hints.admit() }); // evicts a
    expect(hints.publish(d!, ROWS_READ, { admittedAt: pending })).toBe(true);
    expect(hints.readOnly(d!, 'rows')).toBe(true);
    expect(hints.publish(a!, ROWS_READ, { admittedAt: pending })).toBe(false); // a's own pending listing stays out
  });

  it('remembers invalidations within its bound; past it, a publisher admitted before a forgotten one is refused everywhere', () => {
    const hints = new DirectToolHints({ sources: 2, toolsPerSource: 8 });
    const ancient = hints.admit();
    for (let index = 0; index < 6; index++) hints.publish({ ...SOURCE, sourceId: `s${index}` }, ROWS_READ, { admittedAt: hints.admit() }); // four evictions
    const recent = hints.admit();
    hints.publish({ ...SOURCE, sourceId: 's6' }, ROWS_READ, { admittedAt: hints.admit() }); // a fifth
    expect((hints as unknown as { sourceFences: Map<string, unknown> }).sourceFences.size).toBeLessThanOrEqual(2);
    expect(hints.publish({ ...SOURCE, sourceId: 'fresh' }, ROWS_READ, { admittedAt: ancient })).toBe(false); // fails closed
    expect(hints.publish({ ...SOURCE, sourceId: 'fresh' }, ROWS_READ, { admittedAt: recent })).toBe(true);
  });
});
