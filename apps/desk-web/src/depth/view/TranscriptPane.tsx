// One transcript of the session in the depth column — the main thread's (M1) or a subagent's (M2) — as its own
// subscription keeps it: MAWS's transcript view over the controller's source, the request still streaming beneath the
// rows, older rows paged in at the top, and the subscription's disruptions said in place. Each transcript has its own
// controller, store key, and subscription, so one's reset or end never touches another's view.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useStore } from 'zustand';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import { Transcript, type TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import type { DeskSession } from '../../shell/sessions';
import type { DeskTranscript, DepthTranscriptState } from '../source/desk-transcript';
import type { StreamBlock } from '../stream/layer';
import { useKeepPlaceThroughOlderRows } from './keep-place';
import { streamingRows } from './streaming-rows';

/** Within this many pixels of the top the reader has reached it, and older rows are asked for. */
const TOP = 160;
const NO_ROWS: readonly Row[] = [];

/** A transcript is live while its session has a live process and its machine's lease holds (DX8). */
export const reachable = (session: DeskSession) => session.presence?.record != null && session.machineOnline !== false;

const ENDED: Record<NonNullable<DepthTranscriptState['ended']>['reason'], string> = {
  'machine-offline': 'The machine is offline. The transcript resumes when it is back.',
  'session-ended': 'The session has ended.',
  unsubscribed: 'The hub stopped serving this transcript.',
  discontinuity: 'The transcript lost its place.',
  error: 'The transcript could not be served.',
};

/** The word a pane's header shows for its transcript's phase. */
export function transcriptStatus(state: DepthTranscriptState): string {
  switch (state.phase) {
    case 'loading':
      return 'Loading…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'live':
      return state.loadingOlder ? 'Loading older…' : '';
    case 'ended':
      return 'Unavailable';
  }
}

/**
 * The controller's life in the column: subscribed while mounted, its store key forgotten when it goes (reopening draws
 * a fresh snapshot), told the session's liveness, and subscribed again after an end once the session is reachable.
 */
export function useDeskTranscript(controller: DeskTranscript, session: DeskSession): PaneState {
  const state = useStore(controller.state);
  const live = reachable(session);

  useEffect(() => {
    controller.open();
    return () => {
      controller.close();
      useTranscriptStore.getState().drop(controller.key);
    };
  }, [controller]);

  // MAWS's store ticks a working turn from the wall clock only while the process is live (DX8's `setLive`).
  useEffect(() => {
    useTranscriptStore.getState().setLive(controller.key, live);
    return () => useTranscriptStore.getState().setLive(controller.key, null);
  }, [controller.key, live]);

  // After an end (other than a discontinuity, which the hub client recovers from itself) the transcript is taken up
  // again: at once when the session becomes reachable again (it was unreachable at some moment since its last snapshot
  // and is reachable now); while it stays reachable, after a backoff of 1 s doubling to 60 s, so a machine replaced while
  // its lease was fresh (its old subscriptions ended `machine-offline`, no offline presence between) is taken up, and
  // repeated failures (an agent's transcript the machine cannot serve) are spaced retries, never a tight loop. A snapshot
  // resets the backoff; while the session is unreachable nothing is retried.
  const unreachableSince = useRef(!live);
  const attempts = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  useEffect(() => {
    if (!live) unreachableSince.current = true;
  }, [live]);
  useEffect(() => {
    const cancel = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setRetryIn(null);
    };
    if (state.phase === 'live') {
      unreachableSince.current = !live;
      attempts.current = 0;
    }
    if (state.phase !== 'ended' || !live) return cancel();
    if (unreachableSince.current) {
      cancel();
      unreachableSince.current = false;
      controller.resubscribe();
      return;
    }
    if (timer.current !== null) return;
    const delay = Math.min(RETRY_FIRST_MS * 2 ** attempts.current, RETRY_MAX_MS);
    attempts.current += 1;
    setRetryIn(delay);
    timer.current = setTimeout(() => {
      timer.current = null;
      setRetryIn(null);
      controller.resubscribe();
    }, delay);
  }, [controller, state.phase, live]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return useMemo(() => ({ ...state, retryIn }), [state, retryIn]);
}

/** The first retry after an end while the session stays reachable, doubling up to the cap. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 60_000;

/** A transcript's state as the pane draws it: the controller's, and when the next retry after an end is due. */
export type PaneState = DepthTranscriptState & { retryIn?: number | null };

type PaneProps = {
  controller: DeskTranscript;
  state: PaneState;
  variant: 'session' | 'child';
  actions: Partial<TranscriptActions>;
  list: RefObject<TranscriptListHandle | null>;
};

/** The transcript's rows and stream, and what its subscription's disruptions say. */
export function TranscriptPane({ controller, state, variant, actions, list }: PaneProps) {
  // Older rows when the reader scrolls to the top, or while the rows drawn do not fill the pane (its top is in view).
  const rows = useTranscriptStore((s) => s.entries[controller.key]?.rows ?? NO_ROWS);
  const drawnRows = rows.length;
  useKeepPlaceThroughOlderRows(list, rows, state.loadingOlder);
  useEffect(() => {
    const element = list.current?.scrollElement;
    if (!element) return;
    const scrolled = () => {
      if (element.scrollTop <= TOP) controller.loadOlder();
    };
    element.addEventListener('scroll', scrolled, { passive: true });
    return () => element.removeEventListener('scroll', scrolled);
  }, [controller, list]);
  useEffect(() => {
    const element = list.current?.scrollElement;
    if (element && drawnRows > 0 && element.scrollHeight - element.clientHeight <= TOP) controller.loadOlder();
  }, [controller, list, drawnRows, state.more]);

  const since = useSince();
  const tail = useMemo(() => streamingRows(state.streaming, since), [state.streaming, since]);

  return (
    <>
      {state.phase === 'reconnecting' && drawnRows === 0 && (
        // A transcript between a reset and its fresh snapshot (or one the hub ended before its first) is not empty.
        <p className="m-0 px-4 py-3 text-ui-sm text-fg-muted" role="status" data-testid="depth-reconnecting">
          Reconnecting to the session…
        </p>
      )}
      {state.ended && (
        <p className="m-0 border-b border-border px-4 py-1.5 text-ui-sm text-fg-muted" role="status" data-testid="depth-unavailable">
          {ENDED[state.ended.reason]}
          {state.ended.message ? ` ${state.ended.message}` : ''}
          {state.retryIn != null ? ` Trying again in ${Math.round(state.retryIn / 1000)} s.` : ''}
        </p>
      )}
      <Transcript source={state.source} variant={variant} actions={actions} tail={tail} handle={list} className="min-h-0 flex-1" />
    </>
  );
}

/** When each streaming block was first drawn, for its live label's clock. */
function useSince(): (block: StreamBlock) => string {
  const [seen] = useState(() => new WeakMap<StreamBlock, string>());
  return useMemo(
    () => (block: StreamBlock) => {
      let at = seen.get(block);
      if (!at) seen.set(block, (at = new Date().toISOString()));
      return at;
    },
    [seen],
  );
}
