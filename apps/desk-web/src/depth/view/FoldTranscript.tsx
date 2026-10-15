// DX8's `transcript` slot: one fold of a direct channel's working record, unfolded in the center. The session's main
// transcript through the same adapter as the depth column (M1), drawing only the fold's `range` — the rows strictly
// between its two exchange items, the bounding rows cut at span granularity (`source/range.ts`) — under a store key of
// its own, so it never disturbs the column's view of the same transcript. Text draws through MAWS's rows, a marked
// span through the to-human Presenter as everywhere in depth. A live session's last fold (`to` null) goes on with the
// rows and the stream that arrive after its last item; a closed fold draws no stream. The reader asked to unfold the
// record, so each of its finished turns opens unfolded too. While a bound is not among the held rows older ones are
// paged in; one the whole transcript does not hold is drawn as open, and the slot says so.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import type { TranscriptSlotProps } from '../../shell/slots';
import { DeskTranscript } from '../source/desk-transcript';
import { DESK_ACTIONS } from './actions';
import { TranscriptPane, useDeskTranscript } from './TranscriptPane';

export default function FoldTranscript({ project, session, plane, range }: TranscriptSlotProps) {
  const [controller] = useState(() => new DeskTranscript({ plane, project, target: { machine: session.machine, session: session.session, agentId: null }, store: useTranscriptStore, range }));
  const state = useDeskTranscript(controller, session);
  const list = useRef<TranscriptListHandle>(null);

  // A bound not among the held rows may be in an older page: the start, or with an open start the end.
  const { bounds, more, loadingOlder, phase } = state;
  const missing = bounds !== null && (bounds.from === 'missing' || (bounds.from === 'open' && bounds.to === 'missing'));
  useEffect(() => {
    if (phase === 'live' && missing && more && !loadingOlder) controller.loadOlder();
  }, [controller, phase, missing, more, loadingOlder]);

  useUnfoldFinishedTurns(controller.key);

  // A closed fold's stream is past its end: only a live session's last fold draws one.
  const shown = useMemo(() => (range.to === null ? state : { ...state, streaming: [] }), [range.to, state]);
  const settled = phase === 'live' && !more && bounds !== null;

  return (
    <div className="flex h-[min(60vh,480px)] min-h-0 flex-col overflow-hidden rounded-md border border-border bg-bg" data-slot="transcript" data-testid="fold-transcript" data-session={session.session}>
      {settled && bounds.from === 'missing' && <Unresolved>The start of this stretch is not in the transcript; it is drawn from the transcript’s start.</Unresolved>}
      {settled && bounds.to === 'missing' && <Unresolved>The end of this stretch is not in the transcript; it is drawn through the latest row.</Unresolved>}
      <TranscriptPane controller={controller} state={shown} variant="session" actions={DESK_ACTIONS} list={list} />
    </div>
  );
}

function Unresolved({ children }: { children: string }) {
  return (
    <p className="m-0 border-b border-border px-3 py-1.5 text-ui-sm text-fg-muted" role="status" data-testid="fold-unresolved">
      {children}
    </p>
  );
}

/** Opens each finished turn of the fold once, as it is first seen; a turn the reader folds again stays folded. */
function useUnfoldFinishedTurns(key: string): void {
  useEffect(() => {
    const opened = new Set<string>();
    const unfold = () => {
      const entry = useTranscriptStore.getState().entries[key];
      if (entry?.phase !== 'live') return;
      for (const [id, turn] of entry.state.turns) {
        if (opened.has(id) || turn.state !== 'closed') continue;
        opened.add(id);
        if (!entry.state.ui.expandedTurns.has(id)) useTranscriptStore.getState().toggleTurn(key, id);
      }
    };
    unfold();
    return useTranscriptStore.subscribe(unfold);
  }, [key]);
}
