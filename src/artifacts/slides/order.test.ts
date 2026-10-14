// P3-C M1 (D1): S6's fractional order keys, the paint and flow order the model keeps (D2).
import { describe, expect, it } from 'vitest';
import { byKey, FLOW_LAYER, keyAfter, keyBefore, OVER, rekey, repairCollisions, UNDER, ANY } from './order';

const sortIds = (items: { id: string; k?: string }[]) => [...items].sort(byKey((t) => t.k)).map((t) => t.id);

describe('order keys', () => {
  it('sorts by key, ties by id, a missing key last', () => {
    expect(sortIds([{ id: 'b', k: 'a1' }, { id: 'c' }, { id: 'a', k: 'a1' }, { id: 'd', k: 'Zz' }])).toEqual(['d', 'a', 'b', 'c']);
  });

  it('re-keys toward a wanted order changing only what the longest kept run does not hold', () => {
    const current = new Map([['a', 'a1'], ['b', 'a2'], ['c', 'a3'], ['d', 'a4']]);
    const next = rekey(['a', 'c', 'd', 'b'], current, ANY);
    expect([...next.keys()]).toEqual(['b']);
    const merged = new Map([...current, ...next]);
    expect(sortIds([...merged].map(([id, k]) => ({ id, k })))).toEqual(['a', 'c', 'd', 'b']);
  });

  it('keeps pinned keys under or over the flow layer', () => {
    const under = keyBefore([], UNDER);
    const over = keyAfter([], OVER);
    expect(under < FLOW_LAYER && FLOW_LAYER < over).toBe(true);
    expect(keyBefore([under], UNDER) < under).toBe(true);
    expect(keyAfter([over], OVER) > over).toBe(true);
  });

  it('separates equal keys the same way on every replica', () => {
    const items = [{ id: 'x', k: 'a1' }, { id: 'y', k: 'a1' }, { id: 'z', k: 'a2' }];
    const once = repairCollisions(items, (t) => t.k, ANY);
    expect([...once.keys()]).toEqual(['y']);
    expect(repairCollisions([...items].reverse(), (t) => t.k, ANY)).toEqual(once);
    const k = once.get('y')!;
    expect(k > 'a1' && k < 'a2').toBe(true);
  });
});
