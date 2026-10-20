// P4-B1 (M1; acceptance 1 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): the margin's layout, L1 to L7
// of research/p4-ux-prior-art.md §1.3, with Overleaf's and Liveblocks' stacking loops as oracles. Both are restated here
// from their sources' rules (§1.1): Overleaf's `positionItems`, the primary reading of the pin, pins the focused item
// (else the first) at its anchor and runs the two walks from it, its pin sticky across a deselect as Docs' is
// (docs/doperpowers/evidence/p4/lc1/lc1-docs-margin.md item 3); Liveblocks' `AnchoredThreads` (v3.24.3), with the pinned
// thread in place of its active one, places it at its anchor, walks down with max(anchor, offset) from it and up with
// min(anchor, offset − gap − height), and with none walks down from an offset of 0. Neither clamps the top, so they are
// the oracles wherever the top is not crossed (L5 is asserted on its own).
import { describe, expect, it } from 'vitest';
import { ICON_GAP_PX, layoutMargin, MARGIN_GAP_PX, type MarginEntry } from './margin-layout';

type Tops = Map<string, number>;

function liveblocks(entries: readonly MarginEntry[], pinned: string | null, gap: number): Tops {
  const tops: Tops = new Map();
  const k = entries.findIndex((entry) => entry.id === pinned);
  if (k === -1) {
    let offset = 0;
    for (const entry of entries) {
      const top = Math.max(entry.anchor, offset);
      tops.set(entry.id, top);
      offset = top + entry.height + gap;
    }
    return tops;
  }
  let offset = entries[k]!.anchor;
  for (let i = k; i < entries.length; i++) {
    const top = Math.max(entries[i]!.anchor, offset);
    tops.set(entries[i]!.id, top);
    offset = top + entries[i]!.height + gap;
  }
  offset = entries[k]!.anchor;
  for (let i = k - 1; i >= 0; i--) {
    const top = Math.min(entries[i]!.anchor, offset - gap - entries[i]!.height);
    tops.set(entries[i]!.id, top);
    offset = top;
  }
  return tops;
}

function overleaf(entries: readonly MarginEntry[], pinned: string | null, gap: number): Tops {
  const tops: Tops = new Map();
  if (entries.length === 0) return tops;
  const focused = Math.max(0, entries.findIndex((entry) => entry.id === pinned));
  const pin = entries[focused]!;
  tops.set(pin.id, pin.anchor);
  let topLimit = pin.anchor;
  for (let i = focused - 1; i >= 0; i--) {
    const { id, anchor, height } = entries[i]!;
    const top = Math.min(anchor, topLimit - height - gap);
    tops.set(id, top);
    topLimit = top;
  }
  let bottomLimit = pin.anchor + pin.height + gap;
  for (let i = focused + 1; i < entries.length; i++) {
    const { id, anchor, height } = entries[i]!;
    const top = Math.max(anchor, bottomLimit);
    tops.set(id, top);
    bottomLimit = top + height + gap;
  }
  return tops;
}

// mulberry32: a seeded generator, so a failing case names its seed
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A stack in document order: anchors non-decreasing with clusters (several threads on one line, as the seed's passages
// and Docs' "six comments on one line" give), heights a card's range.
function stack(next: () => number): MarginEntry[] {
  const count = Math.floor(next() * 12);
  let y = Math.floor(next() * 400);
  return Array.from({ length: count }, (_, i) => {
    if (next() > 0.4) y += Math.floor(next() * 300);
    return { id: `t${i}`, anchor: y, height: 40 + Math.floor(next() * 260) };
  });
}

const minTop = (tops: Tops) => Math.min(...tops.values());
const at = (tops: Tops, ids: string[]) => ids.map((id) => tops.get(id));

// L3: consecutive cards in order at least the gap apart, so none overlaps
function expectStacked(entries: readonly MarginEntry[], tops: Tops, gap: number) {
  for (let i = 1; i < entries.length; i++) {
    expect(tops.get(entries[i]!.id)! - (tops.get(entries[i - 1]!.id)! + entries[i - 1]!.height)).toBeGreaterThanOrEqual(gap);
  }
}

describe('layoutMargin against Overleaf and Liveblocks', () => {
  it('equals both loops on 400 seeded stacks, every thread pinned in turn and none, wherever the top is not crossed', () => {
    let compared = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const entries = stack(random(seed));
      for (const pinned of [null, ...entries.map((entry) => entry.id)]) {
        const expected = overleaf(entries, pinned, MARGIN_GAP_PX);
        if (entries.length > 0 && minTop(expected) < 0) continue; // L5's case, below
        const { tops } = layoutMargin({ entries, pinned });
        expect(tops, `seed ${seed}, pinned ${pinned}`).toEqual(expected);
        expect(tops, `seed ${seed}, pinned ${pinned}`).toEqual(liveblocks(entries, pinned, MARGIN_GAP_PX));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(1000); // the clamp skips a minority: the comparison is not vacuous
  });

  it('keeps every invariant on the same stacks, the clamped ones included: L3 stacked, the top never crossed', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const entries = stack(random(seed));
      for (const pinned of [null, ...entries.map((entry) => entry.id)]) {
        const { tops, height } = layoutMargin({ entries, pinned });
        expect([...tops.keys()]).toEqual(entries.map((entry) => entry.id));
        expectStacked(entries, tops, MARGIN_GAP_PX);
        if (entries.length > 0) expect(minTop(tops)).toBeGreaterThanOrEqual(0);
        const last = entries.at(-1);
        expect(height).toBe(last ? tops.get(last.id)! + last.height + MARGIN_GAP_PX : 0);
      }
    }
  });
});

describe('L1 to L7', () => {
  const G = 10;
  const entry = (id: string, anchor: number, height: number): MarginEntry => ({ id, anchor, height });
  const near = (tops: Tops, ids: string[], expected: number[]) => ids.forEach((id, i) => expect(tops.get(id)).toBeCloseTo(expected[i]!, 6));

  it('L1: with no pin, a plain downward stack from the top', () => {
    const entries = [entry('a', 100, 50), entry('b', 120, 30), entry('c', 130, 20), entry('d', 500, 40)];
    const { tops } = layoutMargin({ entries, pinned: null, gap: G });
    expect(at(tops, ['a', 'b', 'c', 'd'])).toEqual([100, 160, 200, 500]);
  });

  it('L1: a first anchor above the column’s top starts the stack at 0', () => {
    const { tops } = layoutMargin({ entries: [entry('a', -30, 50), entry('b', 10, 30)], pinned: null, gap: G });
    expect(at(tops, ['a', 'b'])).toEqual([0, 60]);
  });

  it('L2: the pinned thread sits at its anchor; those after it stack down, those before it stack up', () => {
    const entries = [entry('a', 100, 50), entry('b', 120, 30), entry('c', 130, 20), entry('d', 140, 40)];
    const { tops } = layoutMargin({ entries, pinned: 'c', gap: G });
    // c at 130; d below it at max(140, 130 + 20 + 10); b above at min(120, 130 − 10 − 30); a at min(100, 90 − 10 − 50)
    expect(at(tops, ['a', 'b', 'c', 'd'])).toEqual([30, 90, 130, 160]);
  });

  it('L2: Docs’ two walks (LC-1 item 2): 103 px cards on three lines walked up from the third, down from the second grown to 157', () => {
    // Alpha, Bravo, Charlie on consecutive lines 19.5 px apart, the anchors with the card's inset; the tops Docs drew
    const up = layoutMargin({ entries: [entry('alpha', 217.16, 103), entry('bravo', 236.66, 103), entry('charlie', 256.16, 103)], pinned: 'charlie' });
    near(up.tops, ['alpha', 'bravo', 'charlie'], [30.16, 143.16, 256.16]);
    const down = layoutMargin({ entries: [entry('bravo', 236.77, 157), entry('charlie', 256.27, 103)], pinned: 'bravo' });
    near(down.tops, ['bravo', 'charlie'], [236.77, 403.77]);
  });

  it('L2: the pin, not the active thread, holds the stack (Docs’ and Overleaf’s sticky pin, LC-1 item 3)', () => {
    // six threads on one passage, the last pinned: the tops Docs drew, which a plain click elsewhere (a deselect) leaves
    // as they are. The caller keeps passing the pin past the deselect; the layout keeps no history of its own.
    const six = ['s1', 's2', 's3', 's4', 's5', 's6'];
    const entries = six.map((id) => entry(id, 3868.51, 103));
    near(layoutMargin({ entries, pinned: 's6' }).tops, six, [3303.51, 3416.51, 3529.51, 3642.51, 3755.51, 3868.51]);
    // the pin cleared (its thread resolved, orphaned or off the tab): the plain walk
    near(layoutMargin({ entries, pinned: null }).tops, six, six.map((_, i) => 3868.51 + i * 113));
  });

  it('L2: a pinned id not in the entries (an orphan, another tab’s thread) lays out as no pin', () => {
    const entries = [entry('a', 100, 50), entry('b', 120, 30)];
    expect(layoutMargin({ entries, pinned: 'gone', gap: G })).toEqual(layoutMargin({ entries, pinned: null, gap: G }));
  });

  it('L3: consecutive cards are at least the gap apart, the gap defaulting to MARGIN_GAP_PX', () => {
    const entries = [entry('a', 0, 40), entry('b', 0, 40), entry('c', 0, 40)];
    expect(at(layoutMargin({ entries, pinned: null }).tops, ['a', 'b', 'c'])).toEqual([0, 40 + MARGIN_GAP_PX, 2 * (40 + MARGIN_GAP_PX)]);
    expectStacked(entries, layoutMargin({ entries, pinned: 'b' }).tops, MARGIN_GAP_PX);
  });

  it('L3: Docs’ Minimize stacks its 32 px icons ICON_GAP_PX apart on adjacent lines, unmerged (LC-1 item 7)', () => {
    const icons = [entry('alpha', 348, 32), entry('bravo', 367.5, 32), entry('charlie', 387, 32)];
    expect(at(layoutMargin({ entries: icons, pinned: null, gap: ICON_GAP_PX }).tops, ['alpha', 'bravo', 'charlie'])).toEqual([348, 394, 440]);
  });

  it('L4: a card whose anchor is clear of its neighbours sits exactly at its anchor, pinned or not', () => {
    const entries = [entry('a', 0, 50), entry('b', 300, 50), entry('c', 600, 50)];
    for (const pinned of [null, 'a', 'b', 'c']) {
      expect(at(layoutMargin({ entries, pinned, gap: G }).tops, ['a', 'b', 'c'])).toEqual([0, 300, 600]);
    }
    // in a crowded stack, the one card clear of the crowd keeps its anchor
    const crowded = [entry('a', 0, 100), entry('b', 10, 100), entry('c', 900, 50)];
    expect(layoutMargin({ entries: crowded, pinned: 'b', gap: G }).tops.get('c')).toBe(900);
  });

  it('L5: the upward pass crossing the top pins the first card at 0 and re-runs the stack down through the pinned', () => {
    // six threads on one line, the last pinned (LC-1 item 4's state): up from 10 the first lands at 10 − 5 × 60 < 0
    const entries = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => entry(id, 10, 50));
    const { tops } = layoutMargin({ entries, pinned: 'f', gap: G });
    expect(at(tops, ['a', 'b', 'c', 'd', 'e', 'f'])).toEqual([0, 60, 120, 180, 240, 300]);
    expect(minTop(overleaf(entries, 'f', G))).toBeLessThan(0); // where the oracles leave the column's top
  });

  it('L5: the re-run moves each card only as far as the deficit needs, never back down to its anchor', () => {
    // up from c at 210: b at min(200, 210 − 110) = 100, a at min(0, 100 − 110) = −10, 10 px over the top. The re-run
    // pushes a to 0, b to 110 (its upward place was 100, not its anchor 200) and c to 220: the pinned card leaves its
    // anchor by the deficit, 10 px, not by the 100 px a re-run from the anchors would give.
    const entries = [entry('a', 0, 100), entry('b', 200, 100), entry('c', 210, 100), entry('d', 300, 50)];
    const { tops } = layoutMargin({ entries, pinned: 'c', gap: G });
    expect(at(tops, ['a', 'b', 'c', 'd'])).toEqual([0, 110, 220, 330]);
  });

  it('L5: a stack whose upward pass stays at or under the top leaves the pinned card at its anchor', () => {
    const entries = [entry('a', 60, 50), entry('b', 70, 50)];
    expect(at(layoutMargin({ entries, pinned: 'b', gap: G }).tops, ['a', 'b'])).toEqual([10, 70]);
    expect(at(layoutMargin({ entries, pinned: 'b', gap: 0 }).tops, ['a', 'b'])).toEqual([20, 70]);
  });

  it('L6: the column’s height is the last card’s bottom plus the gap, so no card is lost below; 0 with no cards', () => {
    const entries = ['a', 'b', 'c'].map((id) => entry(id, 1000, 200));
    expect(layoutMargin({ entries, pinned: null, gap: G }).height).toBe(1000 + 2 * 210 + 200 + G);
    expect(layoutMargin({ entries: [], pinned: null, gap: G })).toEqual({ tops: new Map(), height: 0 });
    expect(layoutMargin({ entries: [], pinned: 'a', gap: G }).height).toBe(0);
  });

  it('L7: the order is the caller’s (document order, ties to the older thread): equal anchors stack in input order', () => {
    // overlapping passages starting at one position: the caller orders the older first; the layout never re-sorts
    const older = entry('older', 100, 40);
    const newer = entry('newer', 100, 40);
    expect(at(layoutMargin({ entries: [older, newer], pinned: null, gap: G }).tops, ['older', 'newer'])).toEqual([100, 150]);
    expect(at(layoutMargin({ entries: [newer, older], pinned: null, gap: G }).tops, ['newer', 'older'])).toEqual([100, 150]);
    // the innermost passage activated (the display plugin's choice), so pinned, stacks the others around it by that order
    expect(at(layoutMargin({ entries: [older, newer], pinned: 'newer', gap: G }).tops, ['older', 'newer'])).toEqual([50, 100]);
  });
});
