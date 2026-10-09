// The transcript (C6 execution document, Public surface; residue *Virtualisation and anchoring*): `Transcript` attaches
// its source to the store under a key, derives nothing itself, and renders the store's rows through the virtualised
// `TranscriptList` with one component per row kind, plus the "Jump to latest" control, and says so with a Retry when
// the source's history could not be loaded (the store's failed hydration phase).
//
// TanStack Virtual in chat mode: stable X3 keys, `anchorTo: 'end'` (a change at either edge keeps the row under the
// reader where it was), `followOnAppend` (a reader at the end stays pinned as rows arrive), measured rows in normal
// DOM order, and browser scroll anchoring off because the virtualiser owns it. Follow mode is a mode: entered at the
// end, left only by a scroll upward, and while following every structural change keeps the end pinned.
import { measureElement, useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';
import type { AgentId } from '@shared/graph/ids';
import { useTranscriptStore } from '../../stores/transcript';
import { HYDRATION } from '../model/copy';
import { withQueueTail } from '../model/derive';
import type { Row, RowKind } from '../model/rows';
import type { TranscriptSource } from '../source/types';
import { DEFAULT_ACTIONS, listElementId, rowElementId, TranscriptProvider, useDisclosures, type RewindInterface, type TranscriptActions, type TranscriptContextValue } from './context';
import { WorkMotion } from './motion';
import { RowView } from './rows/Row';
import { useBrowserActivityAttachment } from './rows/BrowserActivity'; // E13
import { listBrowserActivity } from '../../tools/browser/agent/activity'; // E13
import { withBrowserActivityRows } from '../model/browser-activity'; // E13
import type { AppSessionId } from '@shared/graph/ids'; // E13
// P2-C start (2026-10-09)
import { liveMarkedRowIds, reportRows, reportViewOf } from '../../owner/report/project';
// P2-C end
import './transcript.css';

export const SCROLL_END_THRESHOLD = 80;
export const OVERSCAN = 6;

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
}

export function TranscriptList({ rows, renderRow, onFollowChange, handle, className, id }: TranscriptListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  // A row's size as last measured, by id, which stays its first guess (W8): the virtualiser keeps a measurement only
  // where it differs from the guess, so a group measured closed at exactly its closed guess would be guessed at the open
  // 280 px the moment it opens, and the rows below would jump there and back while the disclosure motion starts it
  // from its closed height.
  const measured = useRef(new Map<string, number>());
  // New functions invalidate the virtualiser's measurements, so they change only with the rows.
  const getItemKey = useCallback((index: number) => rows[index].id, [rows]);
  const estimateSize = useCallback((index: number) => measured.current.get(rows[index].id) ?? estimateRow(rows[index]), [rows]);
  const measure = useCallback((element: Element, entry: ResizeObserverEntry | undefined, instance: Parameters<typeof measureElement>[2]) => {
    const size = measureElement(element, entry, instance);
    const id = element.getAttribute('data-row-id');
    if (id !== null) measured.current.set(id, size);
    return size;
  }, []);

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
    followOnAppend: true,
    scrollEndThreshold: SCROLL_END_THRESHOLD,
    // Reaching the end (within the threshold) enters follow mode; only a scroll upward leaves it. Content changing
    // size under a follower is not a reason to stop following.
    onChange: (instance) => {
      const next = instance.isAtEnd() ? true : instance.scrollDirection === 'backward' ? false : followingRef.current;
      if (next === followingRef.current) return;
      followingRef.current = next;
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
      if (changed && followingRef.current) virtualizer.scrollToEnd({ behavior: 'instant' });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [virtualizer]);

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

export function Transcript({ source, variant, actions, rewind, renderRequest, onFollowChange, className, handle, sessionDirectory, tail = NO_TAIL, withdrawn = NOTHING_WITHDRAWN, effort = null, startAt, presentation, ownerLane }: TranscriptProps) {
  const storeKey = storeKeyOf(source);
  const derived = useTranscriptStore((state) => state.entries[storeKey]?.rows ?? NO_ROWS);
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
  const working = useTranscriptStore((state) => state.entries[storeKey]?.working ?? false);
  const jump = useTranscriptStore((state) => state.entries[storeKey]?.jump ?? null);
  const failed = useTranscriptStore((state) => (state.entries[storeKey]?.phase === 'failed' ? (state.entries[storeKey].error ?? '') : null));
  const [following, setFollowing] = useState(true);
  const listRef = useRef<TranscriptListHandle>(null);
  const disclosures = useDisclosures();
  const [motion] = useState(() => new WorkMotion());
  const idPrefix = `transcript${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    const store = useTranscriptStore.getState();
    void store.attach(storeKey, source, { agentId: variant === 'child' ? (source.agentId ?? CHILD) : null });
    return () => store.detach(storeKey);
  }, [storeKey, source, variant]);

  useImperativeHandle(handle, () => listRef.current!, []);

  // Whether the reader has scrolled, clicked, typed in the transcript or put focus elsewhere since the last jump they
  // asked for: a jump re-resolved when a staged restart installs (`reissued`) then leaves them where they are. Only
  // when this view handled that jump itself (`handledFocus`, the id it focused): a jump whose target the old rows did
  // not hold (a notification opening an item the fresh history brings) was never shown, so it is performed.
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
      handledFocus.current = jump.focus;
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
      (target ?? element)?.focus({ preventScroll: true });
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
        <TranscriptList id={listElementId(idPrefix)} rows={rows} renderRow={renderRow} onFollowChange={followChange} handle={listRef} className="h-full" />
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
