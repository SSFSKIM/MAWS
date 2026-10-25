// The transcript (C6 execution document, Public surface; residue *Virtualisation and anchoring*): `Transcript` attaches
// its source to the store under a key, derives nothing itself, and renders the store's rows through the virtualised
// `TranscriptList` with one component per row kind, plus the "Jump to latest" control, and says so with a Retry when
// the source's history could not be loaded (the store's failed hydration phase).
//
// TanStack Virtual in chat mode: stable X3 keys, `anchorTo: 'end'` (a change at either edge keeps the row under the
// reader where it was), measured rows in normal DOM order, and browser scroll anchoring off because the virtualiser
// owns it. Follow mode belongs to the list: wheel/touch intent or witnessed keyboard/scrollbar movement releases it;
// only returning to the bottom or Jump to latest resumes it. While following, structural changes and measurements
// keep the end pinned.
import { elementScroll, measureElement, useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';
import type { AgentId } from '@shared/graph/ids';
import { useTranscriptStore } from '../../stores/transcript';
import { HYDRATION } from '../model/copy';
import { restingRows, withQueueTail } from '../model/derive';
import type { Row, RowKind } from '../model/rows';
import type { TranscriptSource } from '../source/types';
import { DEFAULT_ACTIONS } from './default-actions';
import { listElementId, rowElementId, TranscriptProvider, useDisclosures, type RewindInterface, type TranscriptActions, type TranscriptContextValue } from './context';
import { WorkMotion } from './motion';
import { recordTranscriptScroll, scrollSignature, takeTranscriptCarry, type TranscriptScroll } from './scroll-carry'; // P4-B3
import { RowView } from './rows/Row';
import { useBrowserActivityAttachment } from './rows/BrowserActivity'; // E13
import { listBrowserActivity } from '../../tools/browser/agent/activity'; // E13
import { withBrowserActivityRows } from '../model/browser-activity'; // E13
import type { AppSessionId } from '@shared/graph/ids'; // E13
// P2-C start (2026-10-09)
import { liveMarkedRowIds, reportRows, reportViewOf } from '../../owner/report/project';
// P2-C end
import './transcript.css';

// Fractional scroll positions can round by a pixel. A larger near-end band traps small finger/trackpad movements:
// a streamed update pins them back before successive deltas can ever leave that band.
export const SCROLL_END_THRESHOLD = 1;
export const OVERSCAN = 6;
// Native key/scrollbar motion can finish after its input event; read that tail before retiring its short witness.
const INPUT_SCROLL_SETTLE_MS = 250;

// Per-kind first guesses, replaced by measurement as rows render.
const ESTIMATES: Record<RowKind, number> = {
  time: 56, user: 96, assistant_text: 140, divider: 40, group: 32, cell: 28, receipt: 150, subagent: 32, agent_message: 32,
  thinking: 32, plan: 260, question: 64, request_slot: 48, error: 36, boundary: 36, bash: 120, local_command: 48,
  ask: 72, delivery: 88, // E1
  side_thread: 36, // E3
  agent_list: 96, // E7: the self line and one short section
  artifact: 44, // E2
  browser_action: 34, // E4c: one line and its bottom padding
  browser_activity: 34, // E13: as a browser action's
  owner_record: 32, // P2-C: one line
  to_human: 96, // P4-R7: a message card, its label and a few lines
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
  id?: string; // the scroll container's element id
  // P4-B3 (its Decision Log 14): where a card's float or dock left the reader, taken (once) as the list mounts; and
  // where this list leaves them as it unmounts
  takeCarried?: () => TranscriptScroll | null;
  onLeave?: (scroll: TranscriptScroll) => void;
}

// A nested tool/group scroller owns input it can consume. Containment blocks chaining even when its contents fit.
function nestedScrollerOwnsUp(target: EventTarget | null, scroller: HTMLElement): boolean {
  for (let element = target instanceof Element ? target : null; element && element !== scroller; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (!['auto', 'scroll'].includes(style.overflowY)) continue;
    if (element.scrollTop > 0 || ['contain', 'none'].includes(style.overscrollBehaviorY || style.overscrollBehavior)) return true;
  }
  return false;
}

export function TranscriptList({ rows, renderRow, onFollowChange, handle, className, id, takeCarried, onLeave }: TranscriptListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const scrollbarPointer = useRef<number | null>(null);
  const movementWitness = useRef(false);
  const changeFollow = useCallback((next: boolean) => {
    if (followingRef.current === next) return;
    followingRef.current = next;
    onFollowChange?.(next);
  }, [onFollowChange]);
  const restoreAt = useRef<TranscriptScroll | null>(null); // P4-B3: the carried place, until the mount applies it
  // P2-C start (2026-10-09): the geometry as the follow rule last knew it. The end can move before a queued native
  // scroll event arrives; reaching the end observed before that movement still means the reader returned to latest.
  const known = useRef({ offset: 0, end: 0 });
  const remember = useCallback(() => {
    const element = scrollRef.current;
    if (element) known.current = { offset: element.scrollTop, end: Math.max(0, element.scrollHeight - element.clientHeight) };
  }, []);
  // Explicit row navigation opts out when it lands away from the end.
  const leaveIfAway = useCallback((measuredSize: number) => {
    const element = scrollRef.current;
    // A measurement can shrink the logical list before React commits its smaller sizer. The old DOM scrollHeight
    // must not turn the browser's clamp to that new end into an apparent scroll away from it.
    const away = element !== null && Math.min(element.scrollHeight, measuredSize) - element.clientHeight - element.scrollTop > SCROLL_END_THRESHOLD;
    if (away) changeFollow(false);
    return away;
  }, [changeFollow]);
  // Movement releases only with a witness and a real gap: a key may be consumed elsewhere while this list clamps
  // to its new end. Upward wheel/touch intent releases immediately below.
  const readScroll = useCallback((measuredSize: number) => {
    const element = scrollRef.current;
    if (!element) return;
    if ((scrollbarPointer.current !== null || movementWitness.current) && element.scrollTop < known.current.offset) leaveIfAway(measuredSize);
    const movedDown = element.scrollTop > known.current.offset;
    const reachedEnd = element.scrollTop >= Math.min(known.current.end, Math.max(0, element.scrollHeight - element.clientHeight)) - SCROLL_END_THRESHOLD;
    remember();
    if (movedDown && reachedEnd) changeFollow(true);
  }, [changeFollow, leaveIfAway, remember]);
  // P2-C end
  // A row's size as last measured, by id, which stays its first guess (W8): the virtualiser keeps a measurement only
  // where it differs from the guess, so a group measured closed at exactly its closed guess would be guessed at the open
  // 280 px the moment it opens, and the rows below would jump there and back while the disclosure motion starts it
  // from its closed height.
  const measured = useRef(new Map<string, number>());
  const growthPending = useRef(false); // an observed growth whose follow runs once the observer's delivery is done
  const followGrowth = useRef<() => void>(() => undefined);
  // New functions invalidate the virtualiser's measurements, so they change only with the rows.
  const getItemKey = useCallback((index: number) => rows[index].id, [rows]);
  const estimateSize = useCallback((index: number) => measured.current.get(rows[index].id) ?? estimateRow(rows[index]), [rows]);
  const measure = useCallback((element: Element, entry: ResizeObserverEntry | undefined, instance: Parameters<typeof measureElement>[2]) => {
    // Notice a return or browser clamp to the DOM end before measurement moves it or anchoring replaces the offset.
    const scroller = scrollRef.current;
    if (scroller && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= SCROLL_END_THRESHOLD) readScroll(instance.getTotalSize());
    const size = measureElement(element, entry, instance);
    const id = element.getAttribute('data-row-id');
    const before = id === null ? undefined : measured.current.get(id);
    if (id !== null) measured.current.set(id, size);
    // A row the observer saw grow while the reader follows is followed once this observer delivery has been measured
    // whole (a microtask: before the frame paints, and after every row of the delivery is in the virtualiser's total),
    // not after the sizer's height commits on a re-render a frame or two later, while a streamed answer overflowing it
    // would sit that far from the end. A shrink is left to the browser's clamp and the content observer, as before.
    if (entry !== undefined && before !== undefined && size > before && followingRef.current && !growthPending.current) {
      growthPending.current = true;
      queueMicrotask(() => {
        growthPending.current = false;
        followGrowth.current();
      });
    }
    return size;
  }, [readScroll]);

  // React Compiler skips this component (the hook returns functions it cannot memoise); the list memoises by hand.
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey, // stable X3 ids; index keys are what breaks prepend and re-derivation
    estimateSize,
    measureElement: measure,
    overscan: OVERSCAN,
    anchorTo: 'end',
    // One follow policy: the list handles appends and insertions alike below. The virtualiser still anchors a reader
    // through prepends and measurements, but cannot decide to resume following from a stale near-end offset.
    followOnAppend: false,
    // End-follow deltas must not enter the virtualiser's iOS-deferred anchor accumulator: a later upward gesture
    // needs real above-reader compensation, but must never replay growth below the reader. The list owns end-follow.
    scrollEndThreshold: -1,
    // Anchoring and explicit row jumps remain the virtualiser's; remember their clamped DOM offset immediately.
    scrollToFn: (offset, options, instance) => {
      readScroll(instance.getTotalSize());
      elementScroll(offset, options, instance);
      remember();
    },
  });

  const releaseFollow = useCallback(() => changeFollow(false), [changeFollow]);

  // Release on intent, before the native scroll event: a streamed render can otherwise win that race. Capture the
  // scroll itself too, before the virtualiser's listener can synchronously render/measure against the old follow mode.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    remember();
    const scrolled = () => { readScroll(virtualizer.getTotalSize()); };
    // Growth before an input belongs to that input's current end, not an obsolete end from an earlier gesture.
    const observeEnd = () => { known.current.end = Math.max(0, element.scrollHeight - element.clientHeight); };
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const armMovement = () => {
      movementWitness.current = true;
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        readScroll(virtualizer.getTotalSize());
        movementWitness.current = false;
        settleTimer = undefined;
      }, INPUT_SCROLL_SETTLE_MS);
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.target === element && event.button === 0 && event.pointerType !== 'touch') {
        scrollbarPointer.current = event.pointerId;
        observeEnd();
        releaseFollow();
      }
    };
    const pointerEnd = (event: PointerEvent) => {
      if (scrollbarPointer.current !== event.pointerId) return;
      armMovement(); // pointerup can precede the final native offset, not just its scroll event
      readScroll(virtualizer.getTotalSize());
      scrollbarPointer.current = null;
    };
    const wheel = (event: WheelEvent) => {
      observeEnd();
      if (event.deltaY < 0 && !nestedScrollerOwnsUp(event.target, element)) releaseFollow();
    };
    let touchY: number | null = null;
    const touchStart = (event: TouchEvent) => { observeEnd(); touchY = event.touches.length === 1 ? event.touches[0].clientY : null; };
    const touchMove = (event: TouchEvent) => {
      observeEnd();
      const next = event.touches.length === 1 ? event.touches[0].clientY : null;
      if (next !== null && touchY !== null && next > touchY && !nestedScrollerOwnsUp(event.target, element)) releaseFollow();
      touchY = next;
    };
    const key = (event: KeyboardEvent) => {
      const editor = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]');
      const pageKey = ['PageUp', 'PageDown', 'Home', 'End'].includes(event.key);
      const navigation = !editor && (event.key.startsWith('Arrow') || event.key === ' ');
      if (!pageKey && !navigation) return;
      observeEnd();
      armMovement(); // body/editor focus and nested containment do not tell us which list the browser will scroll
    };
    const observer = new ResizeObserver(() => { readScroll(virtualizer.getTotalSize()); });
    observer.observe(element);
    element.addEventListener('scroll', scrolled, { passive: true, capture: true });
    element.addEventListener('pointerdown', pointerDown, { passive: true, capture: true });
    window.addEventListener('pointerup', pointerEnd, { passive: true, capture: true });
    window.addEventListener('pointercancel', pointerEnd, { passive: true, capture: true });
    element.addEventListener('wheel', wheel, { passive: true, capture: true });
    element.addEventListener('touchstart', touchStart, { passive: true, capture: true });
    element.addEventListener('touchmove', touchMove, { passive: true, capture: true });
    window.addEventListener('keydown', key, { capture: true });
    return () => {
      observer.disconnect();
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      movementWitness.current = false;
      element.removeEventListener('scroll', scrolled, true);
      element.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointerup', pointerEnd, true);
      window.removeEventListener('pointercancel', pointerEnd, true);
      scrollbarPointer.current = null;
      element.removeEventListener('wheel', wheel, true);
      element.removeEventListener('touchstart', touchStart, true);
      element.removeEventListener('touchmove', touchMove, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [readScroll, releaseFollow, remember, virtualizer]);

  // Follow the committed DOM end with an absolute offset, not an index target that can chase later measurements.
  // This command accounts for current sizes, retiring any anchor compensation it already absorbed. Releasing follow
  // sends no command at all, so compensation accumulated after the reader leaves is preserved for the virtualiser.
  const pinEnd = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const size = virtualizer.getTotalSize();
    const committed = Number.parseFloat((element.firstElementChild as HTMLElement).style.height);
    // A clamped command cannot absorb positive compensation before the larger extent commits. Keep it pending;
    // the content observer will follow that commit unless reader input has already released following.
    if (committed + SCROLL_END_THRESHOLD < size && element.scrollHeight + SCROLL_END_THRESHOLD < size) return;
    // A pending shrink is already reachable. Otherwise use the browser's actual end, including overflowing content
    // or rounding beyond the logical sizer (the virtualiser's last-row/end alignment does the same).
    const end = committed > size + SCROLL_END_THRESHOLD ? Math.max(0, size - element.clientHeight) : element.scrollHeight;
    virtualizer.scrollToOffset(end, { behavior: 'instant' });
  }, [virtualizer]);
  // As the content observer below: movement the reader made first (a witnessed key, a reversed scrollbar drag) is read
  // before the end is followed.
  useLayoutEffect(() => {
    followGrowth.current = () => {
      readScroll(virtualizer.getTotalSize());
      if (followingRef.current) pinEnd();
    };
  }, [pinEnd, readScroll, virtualizer]);

  // A transcript opens at its end, and a following reader stays there through every structural change, including a
  // row inserted above the last one (the live answer above its turn's receipt). P4-B3: a carried place
  // opens with its first visible row at the top instead, out of follow mode. A row, not an offset: a mount knows no row's
  // size until it measures it, and the virtualiser keeps re-aiming a scroll to a row as the rows measure, where an
  // offset would stay fixed on estimates (the width differs between a pane and a card too).
  // P4-B3: the carry is taken here, as the list mounts, not while it renders: a dock renders the pane's transcript in
  // the same commit that removes the card's, and the card's record is made by its unmount's layout cleanup, which runs
  // in that commit before any layout effect mounts (and after every render of it). A carried place restores only a
  // reader who had scrolled away from the end, over the same content (Claude's rule); a follower, or content that
  // changed, opens at the end as every mount does.
  useLayoutEffect(() => {
    const carried = takeCarried?.() ?? null;
    if (carried === null || carried.following || carried.signature !== scrollSignature(rows)) return;
    restoreAt.current = carried;
    changeFollow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the list mounts, over the rows it mounts with
  }, []);
  useLayoutEffect(() => {
    const at = restoreAt.current;
    restoreAt.current = null;
    if (at !== null) {
      const index = at.anchor === null ? -1 : rows.findIndex((row) => row.id === at.anchor);
      if (index === -1) virtualizer.scrollToOffset(at.offset, { behavior: 'instant' });
      else virtualizer.scrollToIndex(index, { align: 'start', behavior: 'instant' });
      return;
    }
    readScroll(virtualizer.getTotalSize());
    if (followingRef.current) pinEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per row list, reading the follow mode of the moment
  }, [rows]);

  // P4-B3: where the reader is as the list goes (a card's float or dock remounts it elsewhere): whether they followed,
  // the offset, the content and the first visible row. Read before the scroller is removed.
  const rowsRef = useRef(rows);
  useLayoutEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    return () => {
      if (!onLeave || !element) return;
      const offset = element.scrollTop;
      const item = virtualizer.getVirtualItemForOffset(offset);
      const row = item === undefined ? undefined : rowsRef.current[item.index];
      onLeave({ following: followingRef.current, offset, signature: scrollSignature(rowsRef.current), anchor: row?.id ?? null });
    };
  }, [onLeave, virtualizer]);

  // E11 (W-C): the viewport changing height with no scroll and no row change (the composer below growing with an
  // attention notice) moves the end out of view; a following reader is kept at the end. Only a change of height acts:
  // the observer's first report (at observe) is the height the list opened at, which the layout effect above handled,
  // and acting on it could undo a jump made since.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let height: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const next = entries.at(-1)?.contentRect.height ?? height;
      const changed = height !== null && next !== height;
      height = next;
      if (changed) {
        readScroll(virtualizer.getTotalSize());
        if (followingRef.current) pinEnd();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [pinEnd, readScroll, virtualizer]);

  // Measured growth can happen without a new rows array (disclosures, fonts, asynchronous Markdown). Follow the
  // committed sizer only while the reader follows; virtual-core keeps ordinary anchoring independent of this policy.
  useEffect(() => {
    const content = scrollRef.current?.firstElementChild;
    if (!content) return;
    let height: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const next = entries.at(-1)?.contentRect.height ?? height;
      const changed = height === null || next !== height;
      height = next;
      if (changed) {
        readScroll(virtualizer.getTotalSize());
        if (followingRef.current) pinEnd();
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [pinEnd, readScroll, virtualizer]);

  useImperativeHandle(handle, () => ({
    scrollToIndex: (index, align) => {
      remember();
      virtualizer.scrollToIndex(index, { align, behavior: 'instant' });
      leaveIfAway(virtualizer.getTotalSize()); // P2-C
    },
    scrollToEnd: () => {
      remember();
      changeFollow(true);
      pinEnd();
    },
    get following() {
      return followingRef.current;
    },
    get scrollElement() {
      return scrollRef.current;
    },
  }));

  return (
    <div className={`min-h-0 ${className ?? ''}`}>
      <div ref={scrollRef} id={id} className="h-full overflow-y-auto [overflow-anchor:none]" data-transcript-scroller="">
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
    </div>
  );
}

// A row re-renders only when its X3 row object changes (per-turn derivation keeps unchanged rows by reference).
const RowSlot = memo(function RowSlot({ row, renderRow }: { row: Row; renderRow: (row: Row) => ReactNode }) {
  return renderRow(row);
});

export interface TranscriptProps {
  source: TranscriptSource;
  variant: 'session' | 'child';
  actions?: Partial<TranscriptActions>;
  rewind?: RewindInterface;
  renderRequest?: (slot: Extract<Row, { kind: 'request_slot' }>) => ReactNode; // C7's X4 card; default placeholder
  onFollowChange?: (following: boolean) => void;
  className?: string;
  handle?: Ref<TranscriptListHandle>; // additive: the list's imperative handle (the harness and tests)
  sessionDirectory?: string | null; // additive: the session's directory, shown on a shell call whose input names no cwd
  // W1, additive: rows after the derived ones (the messages held in MAWS's queue, as dimmed bubbles), and the uuids of
  // prompts whose waiting or dropped bubble is not shown (held back into that queue)
  tail?: readonly Row[];
  withdrawn?: ReadonlySet<string>;
  effort?: string | null; // W8, additive: the effort the session runs at, which the live thinking label names
  // P2-E1, additive: the index of the first row shown, told whether the history is loaded (null: none yet); and the
  // presentation the rows' context carries ('local': the owner channel through MAWS's presenter)
  startAt?: (rows: readonly Row[], loaded: boolean) => number | null;
  presentation?: 'local';
  ownerLane?: boolean; // P2-C, additive: the session's owner-channel lane as main reports it; absent, the store's stays
  // DC9, additive (the desk): the host's word that the session runs no turn (its machine reports it idle, or no
  // process) though no row ended its turn: the turn draws closed (`restingRows`), and the jump control its arrow
  atRest?: boolean;
}

const NO_ROWS: Row[] = [];
const CHILD = 'child' as AgentId; // a child transcript's state treats its events as top-level (Derivation, *Child traffic*)

// The store key of a source: its own (`ipcSource` names the app session and agent), else one per source object.
const generatedKeys = new WeakMap<TranscriptSource, string>();
let generated = 0;
export function storeKeyOf(source: TranscriptSource): string {
  if (source.key) return source.key;
  let key = generatedKeys.get(source);
  if (!key) {
    key = `source:${++generated}`;
    generatedKeys.set(source, key);
  }
  return key;
}

const renderRow = (row: Row) => <RowView row={row} />;

// Focus is inside the transcript, or on nothing in particular (the page itself).
const focusIsHereOrNowhere = (root: HTMLElement | null) => {
  const active = document.activeElement;
  return active === null || active === document.body || (root?.contains(active) ?? false);
};

const NO_TAIL: readonly Row[] = [];
const NOTHING_WITHDRAWN: ReadonlySet<string> = new Set();

export function Transcript({ source, variant, actions, rewind, renderRequest, onFollowChange, className, handle, sessionDirectory, tail = NO_TAIL, withdrawn = NOTHING_WITHDRAWN, effort = null, startAt, presentation, ownerLane, atRest = false }: TranscriptProps) {
  const storeKey = storeKeyOf(source);
  const stored = useTranscriptStore((state) => state.entries[storeKey]?.rows ?? NO_ROWS);
  const derived = useMemo(() => {
    const state = atRest ? useTranscriptStore.getState().entries[storeKey]?.state : undefined; // read when the rows change, as the rows are
    return state ? restingRows(state, stored) : stored;
  }, [stored, atRest, storeKey]);
  // E13: a session's browser activity as rows, under the `js` call each happened in or at its time (a child's transcript
  // shows none: the session's rows carry them); what main kept is listed on mount, so a reload shows them again
  const activitySession = variant === 'session' && source.key ? (source.key as AppSessionId) : null;
  const activity = useBrowserActivityAttachment(storeKey, activitySession);
  useEffect(() => {
    if (activitySession !== null) void listBrowserActivity(activitySession);
  }, [activitySession]);
  const queued = useMemo(() => withQueueTail(withBrowserActivityRows(derived, activity), withdrawn, tail), [derived, activity, withdrawn, tail]);
  // P2-C start (2026-10-09; the P2-C document, Design §7): the session's owner-channel lane, when the mount knows it,
  // told to the store (a marked commentary then stays in view when its turn folds), and while the lane is on and the
  // reader has not chosen the transcript, the report projection of the rows: a marked turn's work in one working record
  const storedLane = useTranscriptStore((state) => (state.entries[storeKey] ? (state.entries[storeKey].state.ui.ownerLane ?? false) : null));
  useEffect(() => {
    // again whenever the key's state starts over (an attach, a source's reset), which starts its ui afresh
    if (ownerLane !== undefined && storedLane !== null && storedLane !== ownerLane) useTranscriptStore.getState().setOwnerLane(storeKey, ownerLane);
  }, [storeKey, ownerLane, storedLane]);
  const report = useTranscriptStore((state) => reportViewOf(state.entries[storeKey]?.state.ui));
  const openRecords = useTranscriptStore((state) => state.entries[storeKey]?.state.ui.reportOpenTurns);
  const liveMarked = useTranscriptStore((state) => (report ? liveMarkedRowIds(state.entries[storeKey]?.state) : ''));
  const merged = useMemo(() => {
    const state = useTranscriptStore.getState().entries[storeKey]?.state; // read when the rows change, as the rows are
    return report && state ? reportRows(queued, state, { reportOpenTurns: openRecords }, liveMarked) : queued;
  }, [queued, report, openRecords, liveMarked, storeKey]);
  // P2-C end
  // P2-E1: a mount that starts later in the session shows the rows from `startAt`'s index, none while it answers null
  const loaded = useTranscriptStore((state) => state.entries[storeKey]?.phase === 'live');
  const rows = useMemo(() => {
    if (startAt === undefined) return merged;
    const start = startAt(merged, loaded);
    return start === null ? NO_ROWS : start === 0 ? merged : merged.slice(start);
  }, [merged, startAt, loaded]);
  const working = useTranscriptStore((state) => state.entries[storeKey]?.working ?? false) && !atRest;
  const jump = useTranscriptStore((state) => state.entries[storeKey]?.jump ?? null);
  const failed = useTranscriptStore((state) => (state.entries[storeKey]?.phase === 'failed' ? (state.entries[storeKey].error ?? '') : null));
  const [following, setFollowing] = useState(true);
  const listRef = useRef<TranscriptListHandle>(null);
  // Reader movement is local to each list, even when two views share a key. Only an accepted send requests follow.
  const sendFollowRequest = useTranscriptStore((state) => state.entries[storeKey]?.sendFollowRequest ?? 0);
  const lastSendFollow = useRef({ storeKey, request: sendFollowRequest });
  useLayoutEffect(() => {
    const requested = lastSendFollow.current.storeKey === storeKey && sendFollowRequest > lastSendFollow.current.request;
    lastSendFollow.current = { storeKey, request: sendFollowRequest };
    if (requested) listRef.current?.scrollToEnd();
  }, [storeKey, sendFollowRequest]);
  const disclosures = useDisclosures();
  const [motion] = useState(() => new WorkMotion());
  useLayoutEffect(() => {
    // Restoring Report reopens its saved records in the store; retire this view's older fold intents as well.
    if (report) for (const turn of openRecords ?? []) motion.unfold(turn);
  }, [report, openRecords, motion]);
  const idPrefix = `transcript${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // P4-B3 (its Decision Log 14): the place a card's float or dock carries to this mount (once), and where it leaves
  const takeCarried = useCallback(() => takeTranscriptCarry(storeKey), [storeKey]);
  const leave = useCallback((scroll: TranscriptScroll) => recordTranscriptScroll(storeKey, scroll), [storeKey]);

  useEffect(() => {
    const store = useTranscriptStore.getState();
    void store.attach(storeKey, source, { agentId: variant === 'child' ? (source.agentId ?? CHILD) : null });
    return () => store.detach(storeKey);
  }, [storeKey, source, variant]);

  useImperativeHandle(handle, () => listRef.current!, []);

  // Whether the reader has scrolled, clicked, typed in the transcript or put focus elsewhere since the last jump they
  // asked for: a jump re-resolved when a staged restart installs (`reissued`) then leaves them where they are. Only
  // when this view handled that jump itself (`handledFocus`, the id it focused): a jump whose target the old rows did
  // not hold (a notification opening an item the fresh history brings) was never shown, so it is performed. P3-F
  // (tracker row 199, the must-read): `handledFocus` names a focus actually given for the current request, recorded
  // when its target takes focus and cleared by each new request, so a request whose frame the install cancelled (or an
  // earlier focus of the same target) does not count as shown.
  const readerMoved = useRef(false);
  const handledFocus = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const moved = useCallback(() => {
    readerMoved.current = true;
  }, []);

  // A jump (store.jumpTo): the store has already opened what holds the row; scroll it into place, then focus it once
  // the virtualiser has mounted it. A fold of its turn still running is called off (W8), or it would take the row away.
  useLayoutEffect(() => {
    if (!jump) return;
    if (!jump.reissued) {
      readerMoved.current = false;
      handledFocus.current = null;
    } else if (handledFocus.current === jump.focus && (readerMoved.current || !focusIsHereOrNowhere(rootRef.current))) {
      useTranscriptStore.getState().jumpHandled(storeKey, jump.nonce);
      return;
    }
    const index = rows.findIndex((row) => row.id === jump.rowId);
    const turn = index >= 0 ? rows[index].turnId : null;
    if (turn !== null) motion.unfold(turn);
    if (index >= 0) listRef.current?.scrollToIndex(index, jump.align);
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(rowElementId(idPrefix, jump.rowId));
      // A cell, standalone (its id is also the row id) or inside a group, takes focus itself when it is focusable
      // (M4's denied cell), else through its own disclosure button; any other row focuses its wrapper.
      const cell = element?.querySelector<HTMLElement>(`[data-cell-id="${CSS.escape(jump.focus)}"]`);
      const target = cell ? (cell.hasAttribute('tabindex') ? cell : cell.querySelector<HTMLElement>('button')) : element;
      const focused = target ?? element;
      focused?.focus({ preventScroll: true });
      if (focused && document.activeElement === focused) handledFocus.current = jump.focus;
      useTranscriptStore.getState().jumpHandled(storeKey, jump.nonce);
    });
    return () => cancelAnimationFrame(frame);
  }, [jump, rows, storeKey, idPrefix, motion]);

  const followChange = useCallback(
    (next: boolean) => {
      setFollowing(next);
      useTranscriptStore.getState().setFollowing(storeKey, next);
      onFollowChange?.(next);
    },
    [storeKey, onFollowChange],
  );

  // Every row reads this context: it changes only with the props, never with the rows.
  const context = useMemo<TranscriptContextValue>(
    () => ({ storeKey, variant, actions: { ...DEFAULT_ACTIONS, ...actions }, rewind: rewind ?? null, renderRequest: renderRequest ?? null, disclosures, idPrefix, sessionDirectory: sessionDirectory ?? null, effort, motion, ...(presentation && { presentation }) }),
    [storeKey, variant, actions, rewind, renderRequest, disclosures, idPrefix, sessionDirectory, effort, motion, presentation],
  );

  return (
    <TranscriptProvider value={context}>
      <div ref={rootRef} className={`transcript relative min-h-0 ${className ?? ''}`} onWheel={moved} onTouchMove={moved} onPointerDown={moved} onKeyDown={moved}>
        <TranscriptList id={listElementId(idPrefix)} rows={rows} renderRow={renderRow} onFollowChange={followChange} handle={listRef} className="h-full" takeCarried={takeCarried} onLeave={leave} />
        {failed !== null && (
          <div className="transcript-failed" role="alert">
            <span>{HYDRATION.failed(failed)}</span>
            <button type="button" className="transcript-button" onClick={() => void useTranscriptStore.getState().retry(storeKey)}>
              {HYDRATION.retry}
            </button>
          </div>
        )}
        {!following && (
          // W2 (B3): Codex's round scroll-to-bottom button, right of the column; its dots while the turn works
          <button type="button" className="transcript-jump" aria-label="Jump to latest" title="Jump to latest" onClick={() => listRef.current?.scrollToEnd()}>
            {working ? (
              <span className="transcript-working-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />
              </svg>
            )}
          </button>
        )}
      </div>
    </TranscriptProvider>
  );
}
