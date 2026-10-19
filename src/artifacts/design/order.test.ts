// P3-E1 M1: the manifest's order merged board by board (order.ts), so unrelated re-orders land together and a clash
// names the board.
import { describe, expect, it } from 'vitest';
import { mergeBoardOrder, movableIn } from './order';

const base = ['a', 'b', 'c', 'd'];

describe('mergeBoardOrder', () => {
  it('keeps the live order when the agent sent none, appending what the publish creates by id', () => {
    expect(mergeBoardOrder(base, null, ['b', 'a', 'c', 'd'], ['z', 'y'], false)).toEqual({ desired: ['b', 'a', 'c', 'd', 'y', 'z'], clashes: [] });
  });

  it('applies the agent’s move of one board beside the owner’s move of another', () => {
    // the agent moves d first; the owner moved a last
    expect(mergeBoardOrder(base, ['d', 'a', 'b', 'c'], ['b', 'c', 'd', 'a'], [], false)).toEqual({ desired: ['d', 'b', 'c', 'a'], clashes: [] });
  });

  it('accepts both sides moving one board to the same place', () => {
    expect(mergeBoardOrder(base, ['c', 'a', 'b', 'd'], ['c', 'a', 'b', 'd'], [], false)).toEqual({ desired: ['c', 'a', 'b', 'd'], clashes: [] });
  });

  it('names a board both sides moved to different places; forced, the agent’s place wins', () => {
    const sent = ['a', 'b', 'd', 'c']; // the agent: c last
    const live = ['c', 'a', 'b', 'd']; // the owner: c first
    expect(mergeBoardOrder(base, sent, live, [], false).clashes).toEqual(['c']);
    expect(mergeBoardOrder(base, sent, live, [], true)).toEqual({ desired: ['a', 'b', 'd', 'c'], clashes: [] });
  });

  it('places a created board right after its predecessor in the sent order (first when it has none), and keeps a board the sent order leaves out where it is', () => {
    expect(mergeBoardOrder(base, ['a', 'n', 'b', 'c', 'd'], base, ['n'], false).desired).toEqual(['a', 'n', 'b', 'c', 'd']);
    expect(mergeBoardOrder(base, ['n', 'a', 'b', 'c', 'd'], ['b', 'a', 'c', 'd'], ['n'], false).desired).toEqual(['n', 'b', 'a', 'c', 'd']);
    expect(mergeBoardOrder(base, ['b', 'a', 'd'], base, [], false)).toEqual({ desired: ['b', 'a', 'c', 'd'], clashes: [] });
  });

  it('forced, settles a pair the agent re-ordered by its sent order, where placing its moved board after its predecessor would not (design-workbench sweep#1)', () => {
    // the agent moved a last; the owner put c first: a, after its sent predecessor c, would land before b
    const [read, sent, live] = [['a', 'b', 'c'], ['b', 'c', 'a'], ['c', 'b', 'a']];
    expect(mergeBoardOrder(read, sent, live, [], false).clashes).toEqual(['a', 'b']);
    // a after both, as the agent sent it; the owner's c before b, which the agent did not re-order, kept
    expect(mergeBoardOrder(read, sent, live, [], true)).toEqual({ desired: ['c', 'b', 'a'], clashes: [] });
  });

  it('forced, keeps every pair the agent re-ordered, whatever the owner did (every order of four boards on each side)', () => {
    const orders = (ids: string[]): string[][] => (ids.length <= 1 ? [ids] : ids.flatMap((id) => orders(ids.filter((x) => x !== id)).map((rest) => [id, ...rest])));
    const all = orders(base);
    for (const sent of all)
      for (const live of all) {
        const { desired } = mergeBoardOrder(base, sent, live, [], true);
        expect([...desired].sort(), `${sent} / ${live}`).toEqual([...base].sort());
        for (const x of base)
          for (const y of base) {
            const [s, b, d] = [sent, base, desired].map((seq) => seq.indexOf(x) < seq.indexOf(y));
            if (x !== y && s !== b) expect(d, `${sent} / ${live}: ${x} ${s ? 'before' : 'after'} ${y}`).toBe(s);
          }
      }
  });
});

describe('movableIn', () => {
  it('names the boards some longest common run of the two orders leaves out: a move, or a tie that cannot tell', () => {
    expect(movableIn(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a'])).toEqual(new Set(['a'])); // only a moved
    expect(movableIn(['a', 'b', 'c'], ['b', 'a', 'c'])).toEqual(new Set(['a', 'b'])); // a or b: a tie
    expect(movableIn(['a', 'b', 'c', 'd'], ['a', 'b', 'd', 'c'])).toEqual(new Set(['c', 'd']));
    expect(movableIn(['a', 'b'], ['a', 'x', 'b'])).toEqual(new Set());
  });
});
