// One transcript of a session as a view draws it — the session's main thread in the center (DC9's session view) or a
// subagent's in the depth column — as its subscription keeps it: MAWS's transcript view over the controller's source,
// the request still streaming beneath the rows, older rows paged in at the top, and the subscription's disruptions said
// in place. Each transcript has its own controller, store key, and subscription, so one's reset or end never touches
// another's view. With the owner lane on (the session view), MAWS draws its report, and the streaming rows are bridged
// into the turn the model is answering (`streaming-rows.ts`).
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useStore } from 'zustand';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import { Transcript, type TranscriptListHandle, type TranscriptProps } from '../../../../../src/renderer/src/transcript/view/Transcript';
import type { DeskSession } from '../../shell/sessions';
import type { DeskTranscript, DepthTranscriptState } from '../source/desk-transcript';
import { reachable, TranscriptKeeper } from '../source/keeper';
import type { StreamBlock } from '../stream/layer';
import { useKeepPlaceThroughOlderRows } from './keep-place';
import { useOlderPages } from './older-pages';
import { latestTurn, streamingRows } from './streaming-rows';

const NO_ROWS: readonly Row[] = [];

const ENDED: Record<NonNullable<DepthTranscriptState['ended']>['reason'], string> = {
  'machine-offline': 'The machine is offline. The transcript resumes when it is back.',
  'session-ended': 'The session has ended.',
  unsubscribed: 'The hub stopped serving this transcript.',
  discontinuity: 'The transcript lost its place.',
  error: 'The transcript could not be served.',
};

/** The word a transcript's header shows for its phase. */
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

/** A transcript's state as the pane draws it: the controller's, and when the next retry after an end is due. */
export type PaneState = DepthTranscriptState & { retryIn?: number | null };

/** The pane's state of a kept transcript: its controller's, with the keeper's next retry. */
export function useKeptTranscript(keeper: TranscriptKeeper): PaneState {
  const state = useStore(keeper.controller.state);
  const retryIn = useStore(keeper.retry, (s) => s.retryIn);
  return useMemo(() => ({ ...state, retryIn }), [state, retryIn]);
}

/**
 * A transcript one view holds alone (a subagent's in the column): kept while mounted (`keeper.ts`), its store key
 * forgotten when it goes, so reopening draws a fresh snapshot.
 */
export function useDeskTranscript(controller: DeskTranscript, session: DeskSession): PaneState {
  const [keeper] = useState(() => new TranscriptKeeper(controller, useTranscriptStore));
  const live = reachable(session);
  useEffect(() => {
    keeper.start();
    return () => keeper.stop();
  }, [keeper]);
  useEffect(() => keeper.reachable(live), [keeper, live]);
  return useKeptTranscript(keeper);
}

type PaneProps = {
  controller: DeskTranscript;
  state: PaneState;
  variant: 'session' | 'child';
  actions: Partial<TranscriptActions>;
  list: RefObject<TranscriptListHandle | null>;
  /** MAWS's report over the transcript (the session view): its streaming rows join the turn they answer. */
  ownerLane?: boolean;
  /** The session view's rows after the streaming ones (its tail sends, requests, end), drawn by `renderRequest`. */
  extraTail?: readonly Row[];
  renderRequest?: TranscriptProps['renderRequest'];
};

/** The transcript's rows and stream, and what its subscription's disruptions say. */
export function TranscriptPane({ controller, state, variant, actions, list, ownerLane, extraTail = NO_ROWS, renderRequest }: PaneProps) {
  // Older rows when the reader scrolls to the top, while the rows drawn do not fill the pane, and after a page that drew
  // nothing new (`older-pages.ts`).
  const rows = useTranscriptStore((s) => s.entries[controller.key]?.rows ?? NO_ROWS);
  const drawnRows = rows.length;
  useKeepPlaceThroughOlderRows(list, rows, state.loadingOlder);
  useOlderPages(controller, list, state);

  const since = useSince();
  const turn = ownerLane ? latestTurn(rows) : null;
  const streaming = useMemo(() => streamingRows(state.streaming, since, { turn }), [state.streaming, since, turn]);
  const tail = useMemo(() => (extraTail.length === 0 ? streaming : [...streaming, ...extraTail]), [streaming, extraTail]);

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
      <Transcript source={state.source} variant={variant} actions={actions} tail={tail} handle={list} className="min-h-0 flex-1" ownerLane={ownerLane} renderRequest={renderRequest} />
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
