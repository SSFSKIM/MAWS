// The depth column (DX8's `depth` slot, DC6's M1): the selected direct channel's session in depth — its main transcript
// drawn by MAWS's transcript view over the session plane, its current request streaming per content block beneath the
// rows, older rows paged in at the top. Loaded as a chunk of its own the first time a session is selected.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { Transcript, type TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import type { DepthSlotProps } from '../../shell/slots';
import type { DeskSession } from '../../shell/sessions';
import { DeskTranscript, type DepthTranscriptState } from '../source/desk-transcript';
import type { StreamBlock } from '../stream/layer';
import { DESK_ACTIONS } from './actions';
import { streamingRows } from './streaming-rows';

/** Within this many pixels of the top the reader has reached it, and older rows are asked for. */
const TOP = 160;

export default function DepthColumn({ project, session, plane }: DepthSlotProps) {
  if (!session) {
    return (
      <div className="flex h-full flex-col gap-2 p-4 text-ui-sm text-fg-muted" data-slot="depth">
        <div className="text-ui font-medium text-fg">Session depth</div>
        <p className="m-0 leading-5">Open a session to see its transcript here.</p>
      </div>
    );
  }
  return <SessionDepth key={`${session.machine}\u0000${session.session}`} project={project} session={session} plane={plane} />;
}

/** A transcript is live while its session has a live process and its machine's lease holds (DX8). */
const reachable = (session: DeskSession) => session.presence?.record != null && session.machineOnline !== false;

const ENDED: Record<NonNullable<DepthTranscriptState['ended']>['reason'], string> = {
  'machine-offline': 'The machine is offline. The transcript resumes when it is back.',
  'session-ended': 'The session has ended.',
  unsubscribed: 'The hub stopped serving this transcript.',
  discontinuity: 'The transcript lost its place.',
  error: 'The transcript could not be served.',
};

const STATUS: Record<DepthTranscriptState['phase'], (state: DepthTranscriptState) => string> = {
  loading: () => 'Loading…',
  reconnecting: () => 'Reconnecting…',
  live: (state) => (state.loadingOlder ? 'Loading older…' : ''),
  ended: () => 'Unavailable',
};

function SessionDepth({ project, session, plane }: { project: string; session: DeskSession; plane: DepthSlotProps['plane'] }) {
  const [controller] = useState(() => new DeskTranscript({ plane, project, target: { machine: session.machine, session: session.session, agentId: null }, store: useTranscriptStore }));
  const state = useStore(controller.state);
  const live = reachable(session);
  const list = useRef<TranscriptListHandle>(null);

  // The subscription lives with the column; leaving the session forgets its rows (reopening draws a fresh snapshot).
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

  // An end other than a reset holds until the session is reachable again; then a fresh snapshot takes up.
  useEffect(() => {
    if (state.phase === 'ended' && live) controller.resubscribe();
  }, [controller, state.phase, live]);

  // Older rows when the reader scrolls to the top, or while the rows drawn do not fill the column (its top is in view).
  const drawnRows = useTranscriptStore((s) => s.entries[controller.key]?.rows.length ?? 0);
  useEffect(() => {
    const element = list.current?.scrollElement;
    if (!element) return;
    const scrolled = () => {
      if (element.scrollTop <= TOP) controller.loadOlder();
    };
    element.addEventListener('scroll', scrolled, { passive: true });
    return () => element.removeEventListener('scroll', scrolled);
  }, [controller]);
  useEffect(() => {
    const element = list.current?.scrollElement;
    if (element && drawnRows > 0 && element.scrollHeight - element.clientHeight <= TOP) controller.loadOlder();
  }, [controller, drawnRows, state.more]);

  const since = useSince();
  const tail = useMemo(() => streamingRows(state.streaming, since), [state.streaming, since]);

  return (
    <section className="flex h-full min-h-0 flex-col" data-slot="depth" data-testid="depth" data-session={session.session} aria-label={`${session.alias} in depth`}>
      <header className="flex items-baseline gap-2 border-b border-border px-4 py-2">
        <span className="truncate text-ui font-medium text-fg">{session.alias}</span>
        <span className="text-ui-sm text-fg-muted">@{session.machine}</span>
        <span className="ml-auto text-ui-sm text-fg-muted" data-testid="depth-status">
          {STATUS[state.phase](state)}
        </span>
      </header>
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
      <Transcript source={state.source} variant="session" actions={DESK_ACTIONS} tail={tail} handle={list} className="min-h-0 flex-1" />
    </section>
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
