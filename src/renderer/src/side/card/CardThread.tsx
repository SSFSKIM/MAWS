// The comment card's thread phase (P2-E1 document, D6; X21): once the card's Side thread answered, the card is the
// thread. Its rows are the shell's own transcript of the thread from its anchored prompt on (none of the parent's copied
// history), the owner channel drawn by MAWS's presenter whatever the surface's attachment, a request the thread raises
// answered inline by C7's card; until the anchored prompt arrives, the comment as typed is echoed with "Starting…". A
// Reply field sends through the human send seam (X22, origin `comment`), whose answer is read in one place
// (`replyOutcomeOf`): queued and delivered are the transcript's own rows (the host queue's held bubble, the user row), so
// the card keeps no delivery state of its own (since P2-A the seam starts a released thread before it sends). One
// strip above Reply names what waits on the person, with one click to the Side pane or a tab. The card yields when the
// Side pane or a main tab draws the thread (one place draws a session with an input), and publishes its thread while on
// screen, so the unread rule and attention navigation count it as the Side pane's.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { tabId } from '@shared/ipc/schema/layout';
import { editRowOf } from '../../composer/resubmit-seam'; // P2-F F-C1
import { sendHumanPrompt, type HumanPromptResult } from '../../composer/submit/send-human-prompt';
import { failureOf, useSetup } from '../../sessions/store';
import { FIELD, PRIMARY, SECONDARY, QUIET } from '../../sessions/ui';
import { selectPendingOf, useAttention } from '../../stores/attention';
import { useLayout } from '../../stores/layout';
import { toast } from '../../stores/notices';
import { isOpen } from '../../stores/layout-model';
import { useSessions } from '../../stores/sessions';
import { TranscriptSlot, useTranscriptStore } from '../../transcript';
import type { TranscriptActions } from '../../transcript/view/context';
import { registeredActions } from '../../transcript/view/registry';
import { openSideThread } from '../actions';
import { SIDE_COPY } from '../copy';
import { hostedInSidePane, useSidePane } from '../store';
import type { CardFrame } from './CardHost';
import { useDeliveredReplies } from './delivered'; // P2-F L121
import { cardGone, closeCard, hideCardThread, showCardThread, type OpenCard } from './store';
import { needsYouOf, replyOutcomeOf, threadStartOf } from './thread';
import './card.css';

const COPY = SIDE_COPY.card;

interface Props {
  card: OpenCard;
  child: AppSessionId;
  echo: string | null;
  frame: CardFrame;
  visible: boolean;
}

// The thread drawn somewhere else, or the card's own buttons sending it there: the card closes, the thread goes on.
export const openThreadAsTab = (serial: number, child: AppSessionId) => {
  useLayout.getState().openTab({ kind: 'session', appSessionId: child });
  closeCard(serial);
};
const openThreadInSidePane = (serial: number, parent: AppSessionId, child: AppSessionId) => {
  openSideThread(parent, child);
  closeCard(serial);
};

export function CardThread({ card, child, echo, frame, visible }: Props) {
  const { serial, parent } = card;
  const record = useSessions((s) => s.records.get(child) ?? null);
  const lineage = record?.lineage ?? null;
  const startAt = useMemo(() => threadStartOf(lineage), [lineage]);
  // whether the transcript has rows of the thread's own to show; until then the echo stands in
  const started = useTranscriptStore((s) => {
    const entry = s.entries[child];
    const start = entry ? startAt(entry.rows, entry.phase === 'live') : null;
    return entry !== undefined && start !== null && start < entry.rows.length;
  });

  // one place draws a session with an input: the Side pane drawing this thread, or a main tab of it, closes the card
  const inMain = useLayout((s) => isOpen(s.main, tabId({ kind: 'session', appSessionId: child })));
  const inSidePane = useSidePane((s) => hostedInSidePane(child, s));
  useEffect(() => {
    if (inMain || inSidePane) closeCard(serial);
  }, [inMain, inSidePane, serial]);

  useEffect(() => {
    if (!visible) return;
    showCardThread(parent, child);
    return () => hideCardThread(child);
  }, [visible, parent, child]);

  const replies = useDeliveredReplies(child); // P2-F L121
  const actions = useCardActions(card, child, frame, replies.delivered);
  const reply = useReply(serial, child, replies.track);

  const setupCard = useSetup((s) => s.cards.get(child));
  const setupFailed = useSetup((s) => failureOf(s, child) !== null);
  const pending = useAttention((s) => selectPendingOf(s, child));
  const holder = record?.holder ?? null;
  const needs = needsYouOf({ card: setupCard, failed: setupFailed, holder, pending });
  const held = holder !== null && (holder.kind === 'terminal' || holder.kind === 'background_job');
  const exitedUnreleased = useSessions((s) => s.engine.get(child)?.process === 'exited' && s.digests.get(child)?.released === undefined);

  // The field waits while the thread starts and while a terminal holds it.
  const waiting = record === null;
  const blocked = waiting || held;
  const placeholder = waiting ? COPY.starting : held && needs !== null ? needs.text : COPY.replyPlaceholder;
  return (
    <>
      <div className="-mx-2.5 flex min-h-0 flex-1 flex-col" data-card-thread={child}>
        {!started && echo !== null && <Echo text={echo} />}
        {record !== null && <TranscriptSlot appSessionId={child} startAt={startAt} presentation="local" actions={actions} className="min-h-0 flex-1" />}
      </div>
      {needs !== null && (
        <div role="status" data-needs-you={needs.kind} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-warning px-2 py-1 text-ui-sm text-fg">
          {/* P2-E1 M5: a 10rem basis, so at the card's width the buttons wrap under the words rather than squeeze them */}
          <span className="min-w-0 grow basis-40">{needs.text}</span>
          {!needs.tabOnly && (
            <button type="button" className={`${QUIET} text-ui-sm`} onClick={() => openThreadInSidePane(serial, parent, child)}>
              {COPY.openInSidePane}
            </button>
          )}
          <button type="button" className={`${QUIET} text-ui-sm`} onClick={() => openThreadAsTab(serial, child)}>
            {COPY.openAsTab}
          </button>
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void reply.send();
        }}
      >
        <textarea
          aria-label={COPY.replyField}
          placeholder={placeholder}
          rows={1}
          value={reply.text}
          disabled={blocked}
          readOnly={reply.sending} // P2-F F-C1: a disabled field would drop the focus that typing and the card's Escape need
          onChange={(event) => reply.setText(event.target.value)}
          onKeyDown={reply.onKeyDown}
          className={`${FIELD} min-w-0 flex-1 max-h-[calc(4lh+0.5rem)] resize-none leading-snug field-sizing-content disabled:text-fg-muted read-only:text-fg-muted`}
        />
        <button type="submit" aria-label={COPY.sendReply} disabled={!reply.canSend || blocked} className={PRIMARY}>
          {COPY.send}
        </button>
      </form>
      {reply.refusal !== null && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm border border-danger px-2 py-1 text-ui-sm text-danger">
          <span className="min-w-0 flex-1 break-words">{reply.refusal}</span>
          <button type="button" className={SECONDARY} disabled={!reply.canSend} onClick={() => void reply.send()}>
            {COPY.retry}
          </button>
          {exitedUnreleased && (
            <button type="button" className={SECONDARY} onClick={() => openThreadInSidePane(serial, parent, child)}>
              {COPY.openInSidePane}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// The comment as typed, drawn by the card while the thread starts; "Starting…" under it.
function Echo({ text }: { text: string }) {
  return (
    <div data-card-echo="" className="flex shrink-0 flex-col items-end gap-0.5 px-2.5 py-1">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-md bg-bg-active px-2.5 py-1.5 text-ui text-fg">{text}</div>
      <span className="text-ui-sm text-fg-muted">{COPY.starting}</span>
    </div>
  );
}

// The thread's artifact row opening the artifact whose page the card is on (P3-L M5b; E2's record before the cutover)
// shows that version in the card's viewer (the latest followed when it is the last); any other artifact goes the
// registered way (the panel's tool). P2-F L121: a reply of this card's the engine took is marked "Sent to Claude" on
// its row. P2-F F-C1: a bubble's Edit edits the thread's message (the registered default reads the main pane's active
// tab, which is never this thread).
function useCardActions(card: OpenCard, child: AppSessionId, frame: CardFrame, delivered: ReadonlySet<MessageUuid>): Partial<TranscriptActions> {
  const showVersion = useRef(frame.showVersion);
  useLayoutEffect(() => {
    showVersion.current = frame.showVersion;
  });
  const { target } = card;
  return useMemo(
    () => ({
      openArtifact(appSessionId, id, at) {
        const show = showVersion.current;
        // the row's id is the artifact's, and the version it asks for (by revision, else by number, else the latest) is
        // shown in this card's viewer
        if (target?.kind === 'artifact-page' && show !== undefined && id === target.artifactId) {
          show(at ?? 'latest');
          return;
        }
        registeredActions().openArtifact(appSessionId, id, at);
      },
      userRowMark: (row) => (row.messageUuid !== null && delivered.has(row.messageUuid) ? COPY.sentToClaude : null),
      editAndResubmit: (row) => editRowOf(child, row, 'edit'),
      editPrompt: (row) => editRowOf(child, row, 'blocked'),
    }),
    [target, child, delivered],
  );
}

// The Reply field: Enter sends (Shift+Enter breaks a line, a composition keeps its Enter), through the seam; a host
// error thrown by the send reads as a refusal with its message. No other send is taken while one is in flight. A reply
// the seam took is handed to `delivered` to watch (P2-F L121). A refusal arriving after the card went (closed, or its
// thread opened elsewhere) is a toast offering the reply to the clipboard, as the comment form's is, so it is never lost
// unseen (P2-F F-C1).
function useReply(serial: number, child: AppSessionId, delivered: (result: HumanPromptResult) => void) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const canSend = text.trim() !== '' && !sending;
  const send = async () => {
    if (!canSend) return;
    const content = text.trim();
    setSending(true);
    setRefusal(null);
    let result: HumanPromptResult;
    try {
      result = await sendHumanPrompt(child, content, { origin: 'comment' });
    } catch (error) {
      result = { disposition: 'refused', started: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const outcome = replyOutcomeOf(result);
    if (outcome.kind === 'refused' && cardGone(serial)) {
      toast({ level: 'warning', text: COPY.replyRefusedAfterClose(outcome.reason), actions: [{ label: COPY.copyReply, run: () => void navigator.clipboard.writeText(content) }], dismissible: true });
      return;
    }
    setSending(false);
    if (outcome.kind === 'refused') {
      setRefusal(outcome.reason);
      return;
    }
    delivered(result);
    setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };
  return { text, setText, sending, refusal, canSend, send, onKeyDown };
}
