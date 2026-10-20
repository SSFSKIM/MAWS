// P4-B1 (D2 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): where each thread's card sits in a document's
// margin, L1 to L7 of research/p4-ux-prior-art.md §1.3. The stacking loop Liveblocks' `AnchoredThreads`, Overleaf,
// Collabora, Fidus Writer and Wax share: the active card at its anchor, the cards after it walking down to
// max(anchor, previous bottom + gap), those before it walking up to min(anchor, next top − gap − height); with no active
// card, one downward walk from the column's top. Added to it, L5: a stack the upward walk pushes over the column's top
// is pushed back down, each card only as far as the one above it needs, so the active card leaves its anchor by the
// deficit and only then. Deselecting relaxes to the plain walk (Liveblocks; Overleaf's sticky pin is not kept, so the
// layout has no history). Pure and DOM-free: the margin measures anchors and heights, this places them.

/** The gap between consecutive cards: Docs' 10 (LC-1 item 2, measured on the upward walk; the downward walk's gap pending). */
export const MARGIN_GAP_PX = 10;
/** How far left the active card stands from the column (`translateX(−S)`, beside the tops this places). LC-1 re-bases (item 2). */
export const MARGIN_ACTIVE_SHIFT_PX = 12;

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
 * older thread (L7). `active` not among them (an orphan, another tab's thread) lays out as no active thread.
 */
export function layoutMargin(input: { entries: readonly MarginEntry[]; active: string | null; gap?: number }): MarginLayout {
  const { entries, active, gap = MARGIN_GAP_PX } = input;
  const n = entries.length;
  if (n === 0) return { tops: new Map(), height: 0 };
  const tops: number[] = new Array<number>(n);
  const down = (from: number) => {
    for (let i = from; i < n; i++) tops[i] = Math.max(entries[i]!.anchor, tops[i - 1]! + entries[i - 1]!.height + gap);
  };
  const k = active === null ? -1 : entries.findIndex((entry) => entry.id === active);
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
