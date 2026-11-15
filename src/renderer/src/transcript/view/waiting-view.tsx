// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §C and §D; decisions
// 1, 5, 6, 13, 19 and 20): what one mounted transcript knows of its session's waiting requests, and its one operation
// on them. The list with each request's place (`placed`: in its call's waiting row, or at the transcript's end), which
// request's card is open at the end (`open`), the element each request is drawn in (`track`), and `show`, the one way to
// a waiting request: every "Also waiting" line, and every caller from outside through `waitingViewsOf`, goes through it.
// `Transcript` builds it (`useTranscriptWaiting`) and provides it to its rows, so the host's drawing reads it from inside
// a row (the end region, `request-card/EndRegion.tsx`). The end row is one row with no turn, appended after every other
// row while a request is placed at the end or a settling receipt is held there (§G), so the virtual list measures,
// follows and anchors it as any row. A transcript whose store key names no session lists nothing.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AgentId, AppSessionId, AttentionId, ToolUseId } from '@shared/graph/ids';
import { placeWaiting, type Placed } from '@shared/attention/waiting';
import { selectWaitingForms, selectWaitingRequests, useAttention, type Settling } from '../../stores/attention';
import { useTranscriptStore } from '../../stores/transcript';
import { END_ROW, endRequestId } from '../model/keys';
import type { Row, RowId } from '../model/rows';
import { rowElementId } from './context';

export interface WaitingView {
  placed: readonly Placed[]; // this transcript's list with places (§A)
  open: AttentionId | null; // the request whose card is open at the end; null: none is placed there
  track(id: AttentionId, element: HTMLElement | null): void; // the element a request is drawn in; null when it unmounts
  show(id: AttentionId): 'shown' | 'gone'; // show this waiting request
}

const NOTHING: WaitingView = { placed: [], open: null, track: () => {}, show: () => 'gone' };
const WaitingContext = createContext<WaitingView>(NOTHING);
const NO_SETTLING: readonly Settling[] = [];
const EndSettlingContext = createContext<readonly Settling[]>(NO_SETTLING);

/** The transcript's waiting view; outside a transcript nothing is placed and `show` answers 'gone'. */
export const useWaitingView = (): WaitingView => useContext(WaitingContext);
/** The settling receipts this transcript draws at its end (§G): its own agent's, but for a call it draws a question or plan row for. */
export const useEndSettling = (): readonly Settling[] => useContext(EndSettlingContext);

export function WaitingViewProvider({ view, settling, children }: { view: WaitingView; settling: readonly Settling[]; children: ReactNode }) {
  return (
    <WaitingContext value={view}>
      <EndSettlingContext value={settling}>{children}</EndSettlingContext>
    </WaitingContext>
  );
}

/** A settling receipt as one status line, with no control and bound to no key: at the end (`EndRegion`), or in the row of
 * the plan it settled (§G, "that row's receipt says it"). */
export function SettlingLine({ entry, className = '' }: { entry: Settling; className?: string }) {
  return (
    <p role="status" data-settling={entry.id} className={`m-0 text-ui-sm text-fg-muted ${className}`}>
      {entry.summary} · {entry.words}
    </p>
  );
}

const mounted = new Map<string, Set<Pick<WaitingView, 'show'>>>();
/** The mounted transcripts of a store key, for a caller outside the tree (`showWaiting`, §E). */
export function waitingViewsOf(key: string): readonly Pick<WaitingView, 'show'>[] {
  return [...(mounted.get(key) ?? [])];
}

// The session a store key names: the key is the session's id, or `<appSessionId>:<agentId>` for a child's transcript
// (the rows' own rule, `useRowSession`).
const sessionOf = (key: string): AppSessionId | null => (key === '' ? null : ((key.includes(':') ? key.slice(0, key.indexOf(':')) : key) as AppSessionId));

type FormRow = Extract<Row, { kind: 'question' | 'plan' | 'ask' }>;
const isFormRow = (row: Row): row is FormRow => row.kind === 'question' || row.kind === 'plan' || row.kind === 'ask';
const isWaitingRow = (row: Row, call: ToolUseId | null): boolean => isFormRow(row) && row.waiting === true && row.toolUseId === call;

const NO_ITEMS: AttentionItem[] = [];
const NO_CALLS: ReadonlySet<ToolUseId> = new Set();
const LAND_FRAMES = 10; // how many frames `show` waits for the row it scrolled to to mount before it gives up the focus

interface ListHandle {
  scrollToIndex(index: number, align: 'start' | 'center' | 'end'): void;
  scrollToEnd(): void;
}

/**
 * The waiting view of one mounted transcript, and its rows with the end row appended when one is due. `rows` are the
 * rows the transcript draws (after its tail, its view's projection and its first-row cut); `agent` is null for a session's
 * own transcript and the agent's id for a child's.
 */
export function useTranscriptWaiting({ storeKey, agent, rows, list, idPrefix }: { storeKey: string; agent: AgentId | null; rows: Row[]; list: RefObject<ListHandle | null>; idPrefix: string }): {
  view: WaitingView;
  settling: readonly Settling[];
  rows: Row[];
} {
  const session = sessionOf(storeKey);
  const requests = useAttention((s) => (session === null ? NO_ITEMS : selectWaitingRequests(s, session)));
  const forms = useAttention((s) => (session === null ? NO_CALLS : selectWaitingForms(s, session)));
  const deliveries = useAttention((s) => s.deliveries);
  const held = useAttention((s) => (session === null ? undefined : s.settling.get(session)));

  // §B: the calls that hold a waiting form, told to the store before paint, and again whenever the key's state starts
  // over (its ui is then a new object); an equal set changes nothing there.
  const ui = useTranscriptStore((s) => s.entries[storeKey]?.state.ui);
  useLayoutEffect(() => {
    if (session !== null && ui !== undefined) useTranscriptStore.getState().setWaitingForms(storeKey, forms);
  }, [storeKey, session, forms, ui]);

  const drawn = useMemo(() => new Set(rows.filter(isFormRow).filter((row) => row.waiting === true).map((row) => row.toolUseId)), [rows]);
  const answeredHere = useMemo(() => new Set(rows.flatMap((row) => (row.kind === 'question' || row.kind === 'plan' ? [row.toolUseId] : []))), [rows]);
  const placed = useMemo(() => placeWaiting(requests, drawn, agent), [requests, drawn, agent]);
  // decision 8a (5): a card answered elsewhere and closed is nothing to draw at the end
  const atEnd = useMemo(() => placed.filter((p) => p.place === 'end' && deliveries.get(p.item.id)?.phase !== 'closed'), [placed, deliveries]);
  const [chosen, setChosen] = useState<AttentionId | null>(null);
  // decision 13: the oldest by default; a request shown or chosen stays open until it leaves; then the oldest remaining
  const open = (chosen !== null && atEnd.some((p) => p.item.id === chosen) ? chosen : atEnd[0]?.item.id) ?? null;
  const settling = useMemo(() => (held ?? NO_SETTLING).filter((entry) => (agent === null || entry.agentId === agent) && !(entry.call !== null && answeredHere.has(entry.call))), [held, agent, answeredHere]);

  const endRow = useMemo<Row | null>(
    () => (session === null ? null : { id: END_ROW, kind: 'request_slot', turnId: null, at: '', requestId: endRequestId(session, agent), toolUseId: null, requestKind: 'permission', toolName: null, requestedAt: '' }),
    [session, agent],
  );
  const ends = atEnd.length > 0 || settling.length > 0;
  const withEnd = useMemo(() => (endRow !== null && ends ? [...rows, endRow] : rows), [rows, endRow, ends]);

  // What `show` reads at its call and again once its row has mounted: the view as last committed.
  const latest = useRef({ placed: placed as readonly Placed[], open, rows: withEnd });
  useLayoutEffect(() => {
    latest.current = { placed, open, rows: withEnd };
  });
  const elements = useRef(new Map<AttentionId, HTMLElement>());
  const track = useCallback((id: AttentionId, element: HTMLElement | null) => {
    if (element !== null) elements.current.set(id, element);
    else elements.current.delete(id);
  }, []);

  // decision 19, in this order and synchronously up to the scroll: the request as placed now, else 'gone' and nothing
  // else; at the end, it is the open one; the scroll; once its row is mounted, the keyboard on that row, when it still
  // waits (and at the end is still the open one).
  const show = useCallback(
    (id: AttentionId): 'shown' | 'gone' => {
      const found = latest.current.placed.find((p) => p.item.id === id);
      if (found === undefined || useAttention.getState().deliveries.get(id)?.phase === 'closed') return 'gone';
      let target: RowId;
      if (found.place === 'end') {
        setChosen(id);
        latest.current = { ...latest.current, open: id };
        list.current?.scrollToEnd();
        target = END_ROW;
      } else {
        const index = latest.current.rows.findIndex((row) => isWaitingRow(row, found.item.request.toolUseId));
        if (index < 0) return 'gone';
        list.current?.scrollToIndex(index, 'center');
        target = latest.current.rows[index].id;
      }
      let frames = 0;
      const land = () => {
        const now = latest.current;
        if (!now.placed.some((p) => p.item.id === id) || (found.place === 'end' && now.open !== id)) return;
        const element = document.getElementById(rowElementId(idPrefix, target));
        if (element !== null) element.focus({ preventScroll: true });
        else if (++frames < LAND_FRAMES) requestAnimationFrame(land);
      };
      requestAnimationFrame(land);
      return 'shown';
    },
    [list, idPrefix],
  );

  useEffect(() => {
    if (session === null) return;
    const view = { show };
    let views = mounted.get(storeKey);
    if (views === undefined) mounted.set(storeKey, (views = new Set()));
    views.add(view);
    return () => {
      views.delete(view);
      if (views.size === 0) mounted.delete(storeKey);
    };
  }, [storeKey, session, show]);

  const view = useMemo<WaitingView>(() => ({ placed, open, track, show }), [placed, open, track, show]);
  return { view, settling, rows: withEnd };
}
