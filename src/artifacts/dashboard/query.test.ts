// E3 M3 fix (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 12): the one portable query identity
// the host's refresh and the editor's live controls share. A value is canonical JSON with its object keys sorted and
// undefined members dropped (an array's undefined reads null, as JSON does); a query's identity is its server, tool and
// arguments, never its schedule or staleness, and no separator can make two queries collide.
import { describe, expect, it } from 'vitest';
import { canonicalQueryValue, queryIdentity } from './query';

describe('canonicalQueryValue (E3 M3 fix)', () => {
  it('is the same for reordered keys at any depth, nested arrays kept in order', () => {
    const a = canonicalQueryValue({ b: 1, a: { y: [1, { q: 1, p: [2, { z: 0, w: 1 }] }], x: 'x' } });
    expect(canonicalQueryValue({ a: { x: 'x', y: [1, { p: [2, { w: 1, z: 0 }], q: 1 }] }, b: 1 })).toBe(a);
    expect(a).toBe('{"a":{"x":"x","y":[1,{"p":[2,{"w":1,"z":0}],"q":1}]},"b":1}');
    expect(canonicalQueryValue({ a: { x: 'x', y: [{ q: 1, p: [2, { w: 1, z: 0 }] }, 1] }, b: 1 })).not.toBe(a);
  });

  it('drops undefined members, reads an array’s undefined and a bare undefined as null', () => {
    expect(canonicalQueryValue({ a: 1, b: undefined })).toBe(canonicalQueryValue({ a: 1 }));
    expect(canonicalQueryValue([1, undefined])).toBe('[1,null]');
    expect(canonicalQueryValue(undefined)).toBe('null');
    expect(canonicalQueryValue(null)).toBe('null');
    expect(canonicalQueryValue('a"b')).toBe(JSON.stringify('a"b'));
  });
});

describe('queryIdentity (E3 M3 fix)', () => {
  it('is a query’s server, tool and arguments in any key order', () => {
    const a = queryIdentity({ server: 's', tool: 't', args: { b: 1, a: [{ y: 2, x: 1 }] } });
    expect(queryIdentity({ server: 's', tool: 't', args: { a: [{ x: 1, y: 2 }], b: 1 } })).toBe(a);
    expect(queryIdentity({ server: 's', tool: 't', args: { a: [{ x: 1, y: 2 }], b: 2 } })).not.toBe(a);
    expect(queryIdentity({ server: 's', tool: 'u', args: { a: [{ x: 1, y: 2 }], b: 1 } })).not.toBe(a);
    expect(queryIdentity({ server: 'a,b', tool: 'c', args: {} })).not.toBe(queryIdentity({ server: 'a', tool: 'b,c', args: {} }));
  });
});
