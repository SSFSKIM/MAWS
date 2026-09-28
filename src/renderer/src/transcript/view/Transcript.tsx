// The transcript's virtualised list and follow mode (residue *Virtualisation and anchoring*). M1 lands the list over
// X3 rows with a caller-supplied row renderer (the spike's prototype rows); M3 builds `Transcript` (TranscriptProps)
// on it with the real row components and the store.
//
// TanStack Virtual in chat mode: stable X3 keys, `anchorTo: 'end'` (a change at either edge keeps the row under the
// reader where it was), `followOnAppend` (a reader at the end stays pinned as rows arrive), measured rows in normal
// DOM order, and browser scroll anchoring off because the virtualiser owns it. Follow mode is `isAtEnd()` within the
// threshold; any upward scroll past it breaks follow, and "Jump to latest" restores it.
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';
import type { Row, RowKind } from '../model/rows';

export const SCROLL_END_THRESHOLD = 80;
export const OVERSCAN = 6;

// Per-kind first guesses, replaced by measurement as rows render.
const ESTIMATES: Record<RowKind, number> = {
  time: 56, user: 96, assistant_text: 140, divider: 40, group: 32, cell: 28, receipt: 150, subagent: 32, agent_message: 32,
  thinking: 32, plan: 260, question: 220, request_slot: 48, error: 36, boundary: 36, bash: 120, local_command: 48,
};
export function estimateRow(row: Row): number {
  if (row.kind === 'group' && row.expanded) return 280;
  if (row.kind === 'cell' && row.expanded) return 220;
  return ESTIMATES[row.kind];
}

export interface TranscriptListHandle {
  scrollToIndex(index: number, align: 'start' | 'center' | 'end'): void;
  scrollToEnd(): void;
  readonly following: boolean;
  readonly scrollElement: HTMLDivElement | null;
}

export interface TranscriptListProps {
  rows: Row[];
  renderRow: (row: Row) => ReactNode;
  onFollowChange?: (following: boolean) => void;
  handle?: Ref<TranscriptListHandle>;
  className?: string;
}

export function TranscriptList({ rows, renderRow, onFollowChange, handle, className }: TranscriptListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  // New functions invalidate the virtualiser's measurements, so they change only with the rows.
  const getItemKey = useCallback((index: number) => rows[index].id, [rows]);
  const estimateSize = useCallback((index: number) => estimateRow(rows[index]), [rows]);

  // React Compiler skips this component (the hook returns functions it cannot memoise); the list memoises by hand.
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey, // stable X3 ids; index keys are what breaks prepend and re-derivation
    estimateSize,
    overscan: OVERSCAN,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: SCROLL_END_THRESHOLD,
    // Reaching the end (within the threshold) enters follow mode; only a scroll upward leaves it. Content changing
    // size under a follower is not a reason to stop following.
    onChange: (instance) => {
      const next = instance.isAtEnd() ? true : instance.scrollDirection === 'backward' ? false : followingRef.current;
      if (next === followingRef.current) return;
      followingRef.current = next;
      setFollowing(next);
      onFollowChange?.(next);
    },
  });

  // A transcript opens at its end, and a following reader stays there through every structural change. The
  // virtualiser's own followOnAppend covers a new last row only; a row inserted above the last one (the live answer
  // above its turn's receipt) would otherwise be anchored from the top and push the end away.
  useLayoutEffect(() => {
    if (followingRef.current) virtualizer.scrollToEnd({ behavior: 'instant' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per row list, reading the follow mode of the moment
  }, [rows]);

  useImperativeHandle(handle, () => ({
    scrollToIndex: (index, align) => virtualizer.scrollToIndex(index, { align, behavior: 'instant' }),
    scrollToEnd: () => virtualizer.scrollToEnd({ behavior: 'instant' }),
    get following() {
      return followingRef.current;
    },
    get scrollElement() {
      return scrollRef.current;
    },
  }));

  return (
    <div className={`relative min-h-0 ${className ?? ''}`}>
      <div ref={scrollRef} className="h-full overflow-y-auto [overflow-anchor:none]" data-transcript-scroller="">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                data-row-id={row.id}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <RowSlot row={row} renderRow={renderRow} />
              </div>
            );
          })}
        </div>
      </div>
      {!following && (
        <button
          type="button"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-border-strong bg-bg-overlay px-3 py-1 text-ui text-fg hover:bg-bg-hover"
          onClick={() => virtualizer.scrollToEnd({ behavior: 'instant' })}
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}

// A row re-renders only when its X3 row object changes (per-turn derivation keeps unchanged rows by reference).
const RowSlot = memo(function RowSlot({ row, renderRow }: { row: Row; renderRow: (row: Row) => ReactNode }) {
  return renderRow(row);
});
