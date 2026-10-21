// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the prior art's V15, Penpot's rule): pins closer
// than 32 screen px merge into one count badge at their centroid. Pure, in screen px, so a zoom-out merges and a zoom-in
// splits with no state.
import { describe, expect, it } from 'vitest';
import { CLUSTER_PX, clusterPins } from './pin-clusters';

const pin = (id: string, x: number, y: number) => ({ id, x, y });

describe('clusterPins', () => {
  it('leaves pins 32 px or more apart alone, each its own cluster at its own point, in the order given', () => {
    expect(CLUSTER_PX).toBe(32);
    expect(clusterPins([])).toEqual([]);
    expect(clusterPins([pin('a', 0, 0), pin('b', 32, 0), pin('c', 0, 40)])).toEqual([
      { ids: ['a'], x: 0, y: 0 },
      { ids: ['b'], x: 32, y: 0 },
      { ids: ['c'], x: 0, y: 40 },
    ]);
  });

  it('merges pins under 32 px apart into one cluster at their centroid, its members in the order given', () => {
    expect(clusterPins([pin('a', 0, 0), pin('far', 500, 500), pin('b', 20, 10)])).toEqual([
      { ids: ['a', 'b'], x: 10, y: 5 },
      { ids: ['far'], x: 500, y: 500 },
    ]);
    // the distance, not each axis: 24 and 24 are 33.9 apart
    expect(clusterPins([pin('a', 0, 0), pin('b', 24, 24)])).toHaveLength(2);
  });

  it('takes a chain whole: each pin near the next joins one cluster, so a zoom-out never leaves overlapping badges', () => {
    const clusters = clusterPins([pin('a', 0, 0), pin('b', 20, 0), pin('c', 40, 0), pin('d', 60, 0)]);
    expect(clusters).toEqual([{ ids: ['a', 'b', 'c', 'd'], x: 30, y: 0 }]);
  });

  it('reads a zoom from the points alone: the same pins merge zoomed out and split zoomed in', () => {
    const at = (zoom: number) => [pin('a', 100 * zoom, 0), pin('b', 140 * zoom, 0)];
    expect(clusterPins(at(0.5)).map((c) => c.ids)).toEqual([['a', 'b']]);
    expect(clusterPins(at(1)).map((c) => c.ids)).toEqual([['a'], ['b']]);
  });

  it('takes another radius', () => {
    expect(clusterPins([pin('a', 0, 0), pin('b', 40, 0)], 48).map((c) => c.ids)).toEqual([['a', 'b']]);
  });
});
