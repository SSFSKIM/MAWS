// The comment form's logic, shared by its two presentations (P2-E1 document, D5): E3's sheet and P2-E1's card call this
// one hook, so their phases and sends cannot drift. The form takes a comment, a destination (Side thread by default;
// Send to main while the parent is ready or, P2-A, the Send can start it) and a producer's screenshot the person may remove; Enter sends,
// Shift+Enter breaks a line, an input method's composition keeps its Enter. While a side thread starts the form is
// disabled; a refusal stays in the form with Retry and, while Send to main is offered, Send to main instead; a refusal arriving
// after the presentation went (closed or replaced: `gone`) is a toast, so the comment is never lost unseen.
import { useState, type KeyboardEvent } from 'react';
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
}

export function useCommentForm({ anchor, parent, gone, onSent, reveal, onSending }: CommentFormInput) {
  const status = useSessions((s) => s.engine.get(parent) ?? null);
  const [text, setText] = useState('');
  const [destination, setDestination] = useState<CommentDestination>('thread');
  const [screenshot, setScreenshot] = useState<AnchorScreenshot | null>(anchor.screenshot ?? null);
  const [phase, setPhase] = useState<CommentFormPhase>({ kind: 'editing' });
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
        if (gone()) toast({ level: 'warning', text: COPY.refusedAfterClose(refusal), actions: [], dismissible: true });
        else setPhase({ kind: 'refused', destination: to, error: refusal });
        return;
      }
    }
    // P2-A end
    const result = await sendComment(to, { parent, anchor, text: sent, screenshot }, reveal ? { reveal } : {});
    settled?.(result.ok); // P3-B
    if (gone()) {
      if (!result.ok) toast({ level: 'warning', text: COPY.refusedAfterClose(result.error), actions: [], dismissible: true });
      return;
    }
    if (result.ok) onSent({ ...(result.child && { child: result.child }), text: sent });
    else setPhase({ kind: 'refused', destination: to, error: result.error });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
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
