// One transcript of the session in the depth column — the main thread's (M1) or a subagent's (M2) — as its own
// subscription keeps it: MAWS's transcript view over the controller's source, the request still streaming beneath the
// rows, older rows paged in at the top, and the subscription's disruptions said in place. Each transcript has its own
// controller, store key, and subscription, so one's reset or end never touches another's view.
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useStore } from 'zustand';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import { Transcript, type TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import type { DeskSession } from '../../shell/sessions';
import type { DeskTranscript, DepthTranscriptState } from '../source/desk-transcript';
import type { StreamBlock } from '../stream/layer';
import { streamingRows } from './streaming-rows';

/** Within this many pixels of the top the reader has reached it, and older rows are asked for. */
const TOP = 160;

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
export function useDeskTranscript(controller: DeskTranscript, session: DeskSession): DepthTranscriptState {
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

  useEffect(() => {
    if (state.phase === 'ended' && live) controller.resubscribe();
  }, [controller, state.phase, live]);

  return state;
}

type PaneProps = {
  controller: DeskTranscript;
  state: DepthTranscriptState;
  variant: 'session' | 'child';
  actions: Partial<TranscriptActions>;
  list: RefObject<TranscriptListHandle | null>;
};

/** The transcript's rows and stream, and what its subscription's disruptions say. */
export function TranscriptPane({ controller, state, variant, actions, list }: PaneProps) {
  // Older rows when the reader scrolls to the top, or while the rows drawn do not fill the pane (its top is in view).
  const drawnRows = useTranscriptStore((s) => s.entries[controller.key]?.rows.length ?? 0);
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
