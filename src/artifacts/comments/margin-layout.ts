// P4-B1 (D2 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): where each thread's card sits in a document's
// margin, L1 to L7 of research/p4-ux-prior-art.md §1.3. The stacking loop Liveblocks' `AnchoredThreads`, Overleaf,
// Collabora, Fidus Writer and Wax share: the pinned card at its anchor, the cards after it walking down to
// max(anchor, previous bottom + gap), those before it walking up to min(anchor, next top − gap − height); with no pin,
// one downward walk from the column's top. Added to it, L5: a stack the upward walk pushes over the column's top is
// pushed back down, each card only as far as the one above it needs, so the pinned card leaves its anchor by the deficit
// and only then. The pin is Overleaf's sticky one, which Docs keeps too (docs/doperpowers/evidence/p4/lc1/lc1-docs-margin.md
// item 3): the last thread the human activated, kept past a deselect, so the stack stays where the pin left it;
// Liveblocks' relax to the plain walk on deselect is not the rule. The caller holds the pin (the display plugin, which
// clears it when its thread resolves, is orphaned or leaves the tab); this function stays pure and history-free. Docs
// also leaves cards that already sit above their moved anchors where they are after an edit above them (item 2), which
// needs the previous tops; that is not reproduced here. DOM-free: the margin measures anchors and heights, this places them.

/** The gap between consecutive cards: Docs' 10 in both walks (LC-1 item 2). */
export const MARGIN_GAP_PX = 10;
/** How far below its passage's first line box top a card's top sits: Docs' 4 (LC-1 item 1, the same for every block kind and a soft-wrap start). The cards tier's; the icon tier's dot sits on the line. */
export const MARGIN_CARD_INSET_PX = 4;
/** The gap between consecutive icons in the icon tier: Docs' Minimize stacks its 32 px icons 46 px apart (LC-1 item 7). */
export const ICON_GAP_PX = 14;

export interface MarginEntry {
  id: string;
  /** The passage's first line box top, in the column's coordinates. */
  anchor: number;
  /** The card's measured height. */
  height: number;
}

export interface MarginLayout {
  /** Each entry's top, in the entries' order. */
  tops: Map<string, number>;
  /** The column's least height: the last card's bottom plus the gap (L6); 0 with no cards. */
  height: number;
}

/**
 * `entries` in the margin's order, which is the caller's: document position of the earliest live range, ties to the
 * older thread (L7). `pinned` the last thread the human activated; one not among the entries (an orphan, another tab's
 * thread) lays out as no pin.
 */
export function layoutMargin(input: { entries: readonly MarginEntry[]; pinned: string | null; gap?: number }): MarginLayout {
  const { entries, pinned, gap = MARGIN_GAP_PX } = input;
  const n = entries.length;
  if (n === 0) return { tops: new Map(), height: 0 };
  const tops: number[] = new Array<number>(n);
  const down = (from: number) => {
    for (let i = from; i < n; i++) tops[i] = Math.max(entries[i]!.anchor, tops[i - 1]! + entries[i - 1]!.height + gap);
  };
  const k = pinned === null ? -1 : entries.findIndex((entry) => entry.id === pinned);
  if (k === -1) {
    tops[0] = Math.max(entries[0]!.anchor, 0); // L1
    down(1);
  } else {
    tops[k] = entries[k]!.anchor; // L2
    for (let i = k - 1; i >= 0; i--) tops[i] = Math.min(entries[i]!.anchor, tops[i + 1]! - gap - entries[i]!.height);
    if (tops[0]! < 0) {
      // L5: the upward walk's tops are each card's floor; from 0, each takes its floor or the bottom above plus the gap
      tops[0] = 0;
      for (let i = 1; i <= k; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + entries[i - 1]!.height + gap);
    }
    down(k + 1);
  }
  return { tops: new Map(entries.map((entry, i) => [entry.id, tops[i]!])), height: tops[n - 1]! + entries[n - 1]!.height + gap };
}
