// E3 M3 fix (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 12): the host's refresh and the
// editor's live controls read one query identity (src/artifacts/dashboard/query.ts). A descriptor whose arguments are
// reordered is the same query to both; a changed argument is another query to both.
import { describe, expect, it } from 'vitest';
import { queryIdentity } from '@artifacts/dashboard/query';
import { sameJson, sameQueryIdentity } from './refresh';

describe('the host’s and the editor’s query identity agree (E3 M3 fix)', () => {
  const descriptor = { server: 'fixture', tool: 'rows', args: { region: 'north', filter: { since: 3, kinds: ['a', 'b'] } } };
  const reordered = { server: 'fixture', tool: 'rows', args: { filter: { kinds: ['a', 'b'], since: 3 }, region: 'north' } };
  const changed = { server: 'fixture', tool: 'rows', args: { filter: { kinds: ['b', 'a'], since: 3 }, region: 'north' } };

  it('a reordered descriptor is one query to both; a changed one is another to both', () => {
    expect(sameQueryIdentity(descriptor, reordered)).toBe(true);
    expect(queryIdentity(reordered)).toBe(queryIdentity(descriptor));
    expect(sameQueryIdentity(descriptor, changed)).toBe(false);
    expect(queryIdentity(changed)).not.toBe(queryIdentity(descriptor));
  });

  it('sameJson keeps its meaning: key order and undefined members aside', () => {
    expect(sameJson({ a: 1, b: undefined, c: [1, { y: 1, x: 2 }] }, { c: [1, { x: 2, y: 1 }], a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
  });
});
