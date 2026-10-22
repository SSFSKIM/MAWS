// One transcript of a session as a view draws it — the session's main thread in the center (DC9's session view) or a
// subagent's in the depth column — as its subscription keeps it: MAWS's transcript view over the controller's source,
// the request still streaming beneath the rows, older rows paged in at the top, and the subscription's disruptions said
// in place once they outlast the keeper's quiet window (`keeper.ts`: a reconnect of a second or two keeps the rows drawn
// and says nothing). Each transcript has its own controller, store key, and subscription, so one's disruption or end
// never touches another's view. With the owner lane on (the session view), MAWS draws its report, and the streaming rows
// are bridged into the turn the model is answering (`streaming-rows.ts`).
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type RefObject } from 'react';
import { useStore } from 'zustand';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import { Transcript, type TranscriptListHandle, type TranscriptProps } from '../../../../../src/renderer/src/transcript/view/Transcript';
import { useAccess } from '../../hub/access';
import type { DeskSession } from '../../shell/sessions';
import type { DeskTranscript, DepthTranscriptState } from '../source/desk-transcript';
import { reachOf, TranscriptKeeper } from '../source/keeper';
import type { StreamBlock } from '../stream/layer';
import { drawnRows } from './drawn-rows';
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

/** The word a transcript's header shows for its phase: none while a disruption is quiet. */
export function transcriptStatus(state: PaneState): string {
  if (state.quiet) return '';
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
 * A transcript's state as the pane draws it: the controller's, when the next retry after an end is due, and whether a
 * disruption is still quiet (`keeper.ts`).
 */
export type PaneState = DepthTranscriptState & { retryIn?: number | null; quiet?: boolean };

/** The pane's state of a kept transcript: its controller's, with the keeper's notice. */
export function useKeptTranscript(keeper: TranscriptKeeper): PaneState {
  const state = useStore(keeper.controller.state);
  const notice = useStore(keeper.notice);
  return useMemo(() => ({ ...state, ...notice }), [state, notice]);
}

/**
 * A transcript one view holds alone (a subagent's in the column): kept while mounted (`keeper.ts`), its store key
 * forgotten when it goes, so reopening draws a fresh snapshot.
 */
export function useDeskTranscript(controller: DeskTranscript, session: DeskSession): PaneState {
  const [keeper] = useState(() => new TranscriptKeeper(controller, useTranscriptStore));
  const reach = reachOf(session);
  useEffect(() => {
    keeper.start();
    return () => keeper.stop();
  }, [keeper]);
  useEffect(() => keeper.reachable(reach), [keeper, reach]);
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
  /** Given a row's id, its index among the rows the list draws now (-1 for none): what the list's `scrollToIndex` takes. */
  rowIndex?: Ref<RowIndex>;
  /** The session runs no turn, as its machine reports it: MAWS draws the turn its rows left open closed (the session view). */
  atRest?: boolean;
};

/** A row's index among the rows MAWS's list draws, by its id; -1 when it draws none by that id. */
export type RowIndex = (id: string) => number;

/** The transcript's rows and stream, and what its subscription's disruptions say. */
export function TranscriptPane({ controller, state, variant, actions, list, ownerLane, extraTail = NO_ROWS, renderRequest, rowIndex, atRest = false }: PaneProps) {
  const rows = useTranscriptStore((s) => s.entries[controller.key]?.rows ?? NO_ROWS);
  const lapsed = useAccess((s) => s.lapsed);
  const since = useSince();
  const turn = ownerLane ? latestTurn(rows) : null;
  const streaming = useMemo(() => streamingRows(state.streaming, since, { turn }), [state.streaming, since, turn]);
  const tail = useMemo(() => (extraTail.length === 0 ? streaming : [...streaming, ...extraTail]), [streaming, extraTail]);

  // Where a row is among the rows the list draws (in the report, its projection of the held rows and this tail), read
  // when asked: the list's indices are those, never the held rows'.
  const drawnTail = useRef(tail);
  useLayoutEffect(() => {
    drawnTail.current = tail;
  }, [tail]);
  const indexOf = useCallback<RowIndex>((id) => drawnRows(controller.key, drawnTail.current, atRest).findIndex((row) => row.id === id), [controller.key, atRest]);
  useImperativeHandle(rowIndex, () => indexOf, [indexOf]);

  // Older rows when the reader scrolls to the top, while the rows drawn do not fill the pane, and after a page that drew
  // nothing new (`older-pages.ts`); the reader's place kept through each (`keep-place.ts`).
  useKeepPlaceThroughOlderRows(list, rows, state.loadingOlder, indexOf);
  useOlderPages(controller, list, state, atRest);

  return (
    <>
      {state.phase === 'reconnecting' && rows.length === 0 && !state.quiet && (
        // A transcript awaiting a fresh snapshot with nothing drawn (one the hub ended before its first) is not empty.
        <p className="m-0 px-4 py-3 text-ui-sm text-fg-muted" role="status" data-testid="depth-reconnecting">
          {lapsed !== null ? 'Signed out: the session reconnects once you sign in again.' : 'Reconnecting to the session…'}
        </p>
      )}
      {state.ended && !state.quiet && (
        <p className="m-0 border-b border-border px-4 py-1.5 text-ui-sm text-fg-muted" role="status" data-testid="depth-unavailable">
          {ENDED[state.ended.reason]}
          {state.ended.message ? ` ${state.ended.message}` : ''}
          {state.retryIn != null ? ` Trying again in ${Math.round(state.retryIn / 1000)} s.` : ''}
        </p>
      )}
      <Transcript source={state.source} variant={variant} actions={actions} tail={tail} handle={list} className="min-h-0 flex-1" ownerLane={ownerLane} renderRequest={renderRequest} atRest={atRest} />
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
