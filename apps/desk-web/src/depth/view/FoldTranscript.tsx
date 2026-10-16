// DX8's `transcript` slot: one fold of a direct channel's working record, unfolded in the center. The session's main
// transcript through the same adapter as the depth column (M1), drawing only the fold's `range` — the rows strictly
// between its two exchange items, the bounding rows cut at span granularity (`source/range.ts`) — under a store key of
// its own, so it never disturbs the column's view of the same transcript. Text draws through MAWS's rows, a marked
// span through the to-human Presenter as everywhere in depth. A live session's last fold (`to` null) goes on with the
// rows and the stream that arrive after its last item; a closed fold draws no stream. The reader asked to unfold the
// record, so each of its finished turns opens unfolded too (`unfold-turns.ts`). While a bound is not among the held
// rows older ones are paged in; one no older page can bring is drawn as open, and the slot says so. The fold is as
// tall as what it draws, up to `min(60vh, 480px)`, past which it scrolls.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import type { TranscriptSlotProps } from '../../shell/slots';
import { DeskTranscript } from '../source/desk-transcript';
import { unresolvedBounds } from '../source/range';
import { DESK_ACTIONS } from './actions';
import { TranscriptPane, useDeskTranscript } from './TranscriptPane';
import { unfoldFinishedTurns } from './unfold-turns';

export default function FoldTranscript({ project, session, plane, range }: TranscriptSlotProps) {
  const [controller] = useState(() => new DeskTranscript({ plane, project, target: { machine: session.machine, session: session.session, agentId: null }, store: useTranscriptStore, range }));
  const state = useDeskTranscript(controller, session);
  const list = useRef<TranscriptListHandle>(null);
  const box = useRef<HTMLDivElement>(null);

  // A bound not among the held rows may be in an older page: the start, or with an open start the end.
  const { bounds, more, loadingOlder, phase } = state;
  const missing = bounds !== null && (bounds.from === 'missing' || (bounds.from === 'open' && bounds.to === 'missing'));
  useEffect(() => {
    if (phase === 'live' && missing && more && !loadingOlder) controller.loadOlder();
  }, [controller, phase, missing, more, loadingOlder]);

  useEffect(() => unfoldFinishedTurns(useTranscriptStore, controller.key), [controller.key]);
  const height = useContentHeight(box, list);

  // A closed fold's stream is past its end: only a live session's last fold draws one.
  const shown = useMemo(() => (range.to === null ? state : { ...state, streaming: [] }), [range.to, state]);
  const unresolved = unresolvedBounds(state);

  return (
    <div
      ref={box}
      style={height === null ? undefined : { height }}
      className="flex h-[min(60vh,480px)] max-h-[min(60vh,480px)] min-h-12 flex-col overflow-hidden rounded-md border border-border bg-bg"
      data-slot="transcript"
      data-testid="fold-transcript"
      data-session={session.session}
    >
      {unresolved.start && <Unresolved>The start of this stretch is not in the transcript; it is drawn from the transcript’s start.</Unresolved>}
      {unresolved.end && <Unresolved>The end of this stretch is not in the transcript; it is drawn through the latest row.</Unresolved>}
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

/**
 * The box's height that shows all it draws: what lies above the list (the notes, the border) and the list's content,
 * which MAWS's list holds in one element as tall as its rows (measured as they render). The class's max-height caps it,
 * and past that the list scrolls. Null until measured, when the class's height holds.
 */
function useContentHeight(box: RefObject<HTMLDivElement | null>, list: RefObject<TranscriptListHandle | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  const remeasure = useRef<() => void>(() => {});
  // A note drawn above the list (an unresolved bound, a reconnect) moves it down: measured again after each render.
  useLayoutEffect(() => remeasure.current());
  useLayoutEffect(() => {
    let observer: ResizeObserver | null = null;
    let frame = 0;
    const attach = () => {
      const scroller = list.current?.scrollElement;
      const content = scroller?.firstElementChild;
      const el = box.current;
      if (!scroller || !content || !el) {
        frame = requestAnimationFrame(attach); // the list mounts once the transcript has loaded
        return;
      }
      const measure = () => {
        const above = scroller.getBoundingClientRect().top - el.getBoundingClientRect().top;
        setHeight(Math.ceil(above + content.getBoundingClientRect().height + el.offsetHeight - el.clientHeight));
      };
      observer = new ResizeObserver(measure);
      observer.observe(content);
      remeasure.current = measure;
      measure();
    };
    attach();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      remeasure.current = () => {};
    };
  }, [box, list]);
  return height;
}
