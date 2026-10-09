// The comment form's logic, shared by its two presentations (P2-E1 document, D5): E3's sheet and P2-E1's card call this
// one hook, so their phases and sends cannot drift. The form takes a comment, a destination (Side thread by default;
// Send to main only while the parent's process is ready) and a producer's screenshot the person may remove; Enter sends,
// Shift+Enter breaks a line, an input method's composition keeps its Enter. While a side thread starts the form is
// disabled; a refusal stays in the form with Retry and, while the parent runs, Send to main instead; a refusal arriving
// after the presentation went (closed or replaced: `gone`) is a toast, so the comment is never lost unseen.
import { useState, type KeyboardEvent } from 'react';
import type { Anchor, AnchorScreenshot } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
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
  onSent(): void; // a send that went: the presentation closes
}

export function useCommentForm({ anchor, parent, gone, onSent }: CommentFormInput) {
  const status = useSessions((s) => s.engine.get(parent) ?? null);
  const [text, setText] = useState('');
  const [destination, setDestination] = useState<CommentDestination>('thread');
  const [screenshot, setScreenshot] = useState<AnchorScreenshot | null>(anchor.screenshot ?? null);
  const [phase, setPhase] = useState<CommentFormPhase>({ kind: 'editing' });
  const ready = status?.process === 'ready';
  const sending = phase.kind === 'sending';
  const canSend = (to: CommentDestination) => text.trim() !== '' && !sending && (to === 'thread' || ready);

  const send = async (to: CommentDestination) => {
    if (!canSend(to)) return;
    setDestination(to);
    setPhase({ kind: 'sending', destination: to });
    // Send to main's acquisition of a parent that is not ready (P2-A, A's §5.6) runs here, before sendComment's
    // `side.sendToMain`, so the sheet and the card inherit it alike.
    const result = await sendComment(to, { parent, anchor, text: text.trim(), screenshot });
    if (gone()) {
      if (!result.ok) toast({ level: 'warning', text: COPY.refusedAfterClose(result.error), actions: [], dismissible: true });
      return;
    }
    if (result.ok) onSent();
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
    sending,
    canSend,
    send,
    onKeyDown,
    submitLabel: sending ? (phase.destination === 'thread' ? COPY.starting : COPY.sending) : COPY.send,
    mainCaption: !ready ? COPY.mainNotRunning : status?.turn ? COPY.mainBusy : COPY.mainIdle,
  };
}

export type CommentForm = ReturnType<typeof useCommentForm>;
