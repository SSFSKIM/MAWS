// The transcript's scroll across a card's float and dock (P4-B3, its Decision Log 14; parent §4.5, Claude's rule). A
// transcript mounts at its end, and a float or dock moves a session between a pane and a card by a remount, so the
// reader's place would be lost. Every mounted transcript records where it was as it unmounts; a float or dock (either
// card, `shell/floating.ts`) marks the session's next mount, which takes the mark as it mounts (after the unmount it
// replaces in the same commit has recorded), to come back there: a following reader at the end; else,
// when the content is unchanged (the same row count and last row), the same place; else the end. The place is the first
// visible row (the offset beside it, for a row no longer there): the pane and the card differ in width, and a new mount
// knows no row's size until it measures it, so the same offset would land on other rows. Only a mark restores, and only
// once: an ordinary tab switch opens at the end as before.

export interface TranscriptScroll {
  following: boolean; // the reader was at the end, following
  offset: number; // the scroller's scrollTop
  signature: string; // the content then: the row count and the last row's key
  anchor: string | null; // the first visible row's key
}

const recorded = new Map<string, TranscriptScroll>();
const marked = new Set<string>();

// The content's signature: unchanged while no row was added, removed or appended after the last one.
export const scrollSignature = (rows: readonly { id: string }[]): string => `${rows.length}:${rows.at(-1)?.id ?? ''}`;

// A transcript under `key` (its store key: a session's is its app session id) unmounting at `scroll`.
export function recordTranscriptScroll(key: string, scroll: TranscriptScroll): void {
  recorded.set(key, scroll);
}

// The next mount of `key`'s transcript comes back where the last one left off (a card's float or dock).
export function markTranscriptCarry(key: string): void {
  marked.add(key);
}

// What a mount of `key` restores: the last recorded place when a card transition marked it, once; else null.
export function takeTranscriptCarry(key: string): TranscriptScroll | null {
  if (!marked.delete(key)) return null;
  return recorded.get(key) ?? null;
}
