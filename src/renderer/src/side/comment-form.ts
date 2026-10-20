// The comment form's logic, shared by its two presentations (P2-E1 document, D5): E3's sheet and P2-E1's card call this
// one hook, so their phases and sends cannot drift. The form takes a comment, a destination (Side thread by default;
// Send to main while the parent is ready or, P2-A, the Send can start it) and a producer's screenshot the person may remove; Enter sends
// (P4-B1: ⌘Enter too), Shift+Enter breaks a line, an input method's composition keeps its Enter. While a side thread starts the form is
// disabled; a refusal stays in the form with Retry and, while Send to main is offered, Send to main instead; a refusal arriving
// after the presentation went (closed or replaced: `gone`) is a toast, so the comment is never lost unseen.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { STARTS } from '../composer/submit/submit-state'; // P2-A
import { acquireSession, refusalWords } from '../sessions/acquire'; // P2-A
import { availabilityRefusal, useAvailability } from '../sessions/availability'; // P2-A
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { sendComment, type CommentDestination } from './actions';
import { SIDE_COPY } from './copy';

const COPY = SIDE_COPY.composer;

export type CommentFormPhase =
  | { kind: 'editing' }
  | { kind: 'sending'; destination: CommentDestination }
  | { kind: 'refused'; destination: CommentDestination; error: string };

export interface CommentFormInput {
  anchor: Anchor;
  parent: AppSessionId;
  gone(): boolean; // the presentation was closed or replaced while the send was on its way
  onSent(sent: { child?: AppSessionId; text: string }): void; // a send that went (the side thread it opened, the text sent)
  // asked when a side thread's fork answers: whether to reveal it in the parent's Side pane (the sheet: always; the card:
  // only once it is gone, since it shows the thread itself)
  reveal?: () => boolean;
  // P3-B (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9): told as a send sets out; the call it returns is told
  // whether the send went, whether or not the presentation is still there (a document keeps the thread the comment names)
  onSending?: (sending: { text: string; destination: CommentDestination }) => (went: boolean) => void;
  destination?: CommentDestination; // P3-F1: the one the form starts on (CommentContext's), Side thread when absent
  text?: string; // P4-B1: the text the form starts with (a remounted card's kept draft), empty when absent
  /**
   * P4-B3 (its Decision Log 37): what the form's send belongs to beyond this mount (a card's serial). A presentation can
   * remount while its send is on its way (a document moved to another pane or surface keeps its card); the send is then
   * kept here, so a form mounting under the same key starts sending (disabled: no second send), and the answer reaches
   * the form mounted when it arrives. Without one, the send is the mount's own, as before.
   */
  sendKey?: string;
}

// P4-B3: the sends on their way by `sendKey`, and their answers until a mounted form takes them.
type Answer = { ok: true; sent: { child?: AppSessionId; text: string } } | { ok: false; destination: CommentDestination; error: string };
interface Flight {
  destination: CommentDestination;
  answer: Answer | null;
}
const flights = new Map<string, Flight>();
const flightListeners = new Set<() => void>();
const changed = () => {
  for (const listener of flightListeners) listener();
};
const subscribeFlights = (listener: () => void) => {
  flightListeners.add(listener);
  return () => void flightListeners.delete(listener);
};
/** Whether a send under `key` is on its way (no answer yet). */
export const sendingUnder = (key: string): boolean => flights.get(key)?.answer === null;

export function useCommentForm({ anchor, parent, gone, onSent, reveal, onSending, destination: initial, text: initialText, sendKey /* P4-B3 */ }: CommentFormInput) { // P3-F1: initial; P4-B1: initialText
  const status = useSessions((s) => s.engine.get(parent) ?? null);
  const [text, setText] = useState(initialText ?? ''); // P4-B1: initialText
  const [destination, setDestination] = useState<CommentDestination>(initial ?? 'thread'); // P3-F1: initial
  const [screenshot, setScreenshot] = useState<AnchorScreenshot | null>(anchor.screenshot ?? null);
  const [local, setPhase] = useState<CommentFormPhase>({ kind: 'editing' });
  // P4-B3: a send kept by key outlives this mount: while it is on its way the form is sending, and its answer is taken
  // by whichever form is mounted under the key when it arrives
  const flight = useSyncExternalStore(subscribeFlights, () => (sendKey === undefined ? undefined : flights.get(sendKey)));
  const phase: CommentFormPhase = flight && flight.answer === null ? { kind: 'sending', destination: flight.destination } : local;
  const sentRef = useRef(onSent);
  useLayoutEffect(() => {
    sentRef.current = onSent;
  });
  useEffect(() => {
    if (sendKey === undefined) return;
    // the answer, once, by the form mounted when it is there (one that came while none was mounted, at the next mount)
    const take = () => {
      const kept = flights.get(sendKey);
      if (!kept?.answer) return;
      flights.delete(sendKey);
      changed();
      const { answer } = kept;
      if (answer.ok) sentRef.current(answer.sent);
      else setPhase({ kind: 'refused', destination: answer.destination, error: answer.error });
    };
    const off = subscribeFlights(take);
    queueMicrotask(take);
    return off;
  }, [sendKey]);
  const ready = status?.process === 'ready';
  // P2-A start (2026-10-09; the execution document §5.6): Send to main is offered for every parent it can start (a
  // record with no ready process starts on the Send); a terminal or job holding it, or an archive, says why
  const holder = useSessions((s) => s.records.get(parent)?.holder ?? null);
  const availability = useAvailability(parent);
  const mainBlocked = availabilityRefusal(availability, holder, COPY.mainNotRunning);
  const mainEnabled = ready || mainBlocked === null;
  // P2-A end
  const sending = phase.kind === 'sending';
  const canSend = (to: CommentDestination) => text.trim() !== '' && !sending && (to === 'thread' || mainEnabled);

  const send = async (to: CommentDestination) => {
    if (!canSend(to)) return;
    setDestination(to);
    setPhase({ kind: 'sending', destination: to });
    const sent = text.trim();
    const settled = onSending?.({ text: sent, destination: to }); // P3-B
    // P4-B3: kept by key, the answer goes to the form mounted when it comes (never to this mount's state once it went)
    const kept = sendKey === undefined ? null : { destination: to, answer: null as Answer | null };
    if (kept && sendKey !== undefined) {
      flights.set(sendKey, kept);
      changed();
    }
    const answer = (value: Answer) => {
      if (!kept || sendKey === undefined || flights.get(sendKey) !== kept) return false;
      kept.answer = value;
      flights.set(sendKey, { ...kept }); // a new object: the forms' snapshots see the change
      changed();
      return true;
    };
    const dropKept = () => {
      if (kept && sendKey !== undefined && flights.get(sendKey) === kept) {
        flights.delete(sendKey);
        changed();
      }
    };
    // Send to main's acquisition of a parent that is not ready (P2-A, A's §5.6) runs here, before sendComment's
    // `side.sendToMain`, so the sheet and the card inherit it alike.
    // P2-A start (2026-10-09; the execution document §5.6): Send to main on a parent with no ready process starts it
    // first, the Send being the gesture (`acquireSession(parent, 'side')`, then the existing `side.sendToMain` through
    // sendComment); a refused start stays in the form in its words (a card's, when one docked), the comment kept, and
    // after the presentation went it is a toast.
    if (to === 'main' && useSessions.getState().engine.get(parent)?.process !== 'ready') {
      let refusal: string | null;
      try {
        refusal = refusalWords(await acquireSession(parent, 'side'));
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      if (refusal !== null) {
        settled?.(false); // P3-B
        if (gone()) {
          dropKept(); // P4-B3
          toast({ level: 'warning', text: COPY.refusedAfterClose(refusal), actions: [], dismissible: true });
        } else if (!answer({ ok: false, destination: to, error: refusal })) setPhase({ kind: 'refused', destination: to, error: refusal });
        return;
      }
    }
    // P2-A end
    const result = await sendComment(to, { parent, anchor, text: sent, screenshot }, reveal ? { reveal } : {});
    settled?.(result.ok); // P3-B
    if (gone()) {
      dropKept(); // P4-B3
      if (!result.ok) toast({ level: 'warning', text: COPY.refusedAfterClose(result.error), actions: [], dismissible: true });
      return;
    }
    const sentAs = { ...(result.ok && result.child && { child: result.child }), text: sent };
    if (answer(result.ok ? { ok: true, sent: sentAs } : { ok: false, destination: to, error: result.error })) return; // P4-B3
    if (result.ok) onSent(sentAs);
    else setPhase({ kind: 'refused', destination: to, error: result.error });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // P4-B1 (C3): ⌘Enter (Ctrl+Enter) posts beside Enter, a Shift held with it or not
    if (event.key !== 'Enter' || (event.shiftKey && !event.metaKey && !event.ctrlKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(destination);
  };

  return {
    text,
    setText,
    destination,
    setDestination,
    screenshot,
    removeScreenshot: () => setScreenshot(null),
    phase,
    ready,
    mainEnabled, // P2-A: Send to main is offered (ready, or a parent the Send can start)
    sending,
    canSend,
    send,
    onKeyDown,
    // P2-A: Send to main reads Starting… while its parent starts
    submitLabel: sending ? (phase.destination === 'thread' || !ready ? COPY.starting : COPY.sending) : COPY.send,
    mainCaption: ready ? (status?.turn ? COPY.mainBusy : COPY.mainIdle) : (mainBlocked ?? STARTS), // P2-A
  };
}

export type CommentForm = ReturnType<typeof useCommentForm>;
