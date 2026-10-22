// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the prior art's V15): a design's pins, as drawn
// on screen, merged where they would crowd one another. Penpot clusters at `distance × zoom < 32 px` (the prior art's
// §1.1); here the points are already in screen px, so the rule is the distance alone and a zoom-out merges with no state.
// Pins join by chains (single linkage): a pin under the radius from any member joins its cluster, so no two badges drawn
// are ever under the radius apart. Pure.

/** Pins closer than this (screen px) merge. */
export const CLUSTER_PX = 32;

export interface PinPoint {
  id: string;
  x: number;
  y: number;
}

/** A cluster's members in the order given, and their centroid. A pin alone is a cluster of one. */
export interface PinCluster {
  ids: string[];
  x: number;
  y: number;
}

/** The clusters of `pins`, ordered by their first member's place in `pins`. */
export function clusterPins(pins: readonly PinPoint[], within = CLUSTER_PX): PinCluster[] {
  const parent = pins.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  for (let i = 0; i < pins.length; i++)
    for (let j = i + 1; j < pins.length; j++) {
      const a = pins[i]!;
      const b = pins[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) >= within) continue;
      const [ra, rb] = [root(i), root(j)];
      // the earlier pin's root stays the root, so a cluster is ordered by its first member
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  const groups = new Map<number, PinPoint[]>();
  pins.forEach((p, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  });
  return [...groups.values()].map((members) => ({
    ids: members.map((m) => m.id),
    x: members.reduce((sum, m) => sum + m.x, 0) / members.length,
    y: members.reduce((sum, m) => sum + m.y, 0) / members.length,
  }));
}
