// The comment card's thread phase (P2-E1 document, D6; X21): once the card's Side thread answered, the card is the
// thread. Its rows are the shell's own transcript of the thread from its anchored prompt on (none of the parent's copied
// history), the owner channel drawn by MAWS's presenter whatever the surface's attachment, a request the thread raises
// answered inline by C7's card; until the anchored prompt arrives, the comment as typed is echoed with "Starting…". A
// Reply field sends through the human send seam (X22, origin `comment`), whose answer is read in one place
// (`replyOutcomeOf`): queued and delivered are the transcript's own rows (the host queue's held bubble, the user row), so
// the card keeps no delivery state but a reply waiting on a resumed start, whose failure hands the text back here. One
// strip above Reply names what waits on the person, with one click to the Side pane or a tab. The card yields when the
// Side pane or a main tab draws the thread (one place draws a session with an input), and publishes its thread while on
// screen, so the unread rule and attention navigation count it as the Side pane's.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { tabId } from '@shared/ipc/schema/layout';
import { sendHumanPrompt, type HumanPromptResult } from '../../composer/submit/send-human-prompt';
import { holdMessageReturn } from '../../sessions/message-return';
import { failureOf, useSetup } from '../../sessions/store';
import { FIELD, PRIMARY, SECONDARY, QUIET } from '../../sessions/ui';
import { selectPendingOf, useAttention } from '../../stores/attention';
import { useLayout } from '../../stores/layout';
import { isOpen } from '../../stores/layout-model';
import { useSessions } from '../../stores/sessions';
import { deliverables, lookupKey } from '../../tools/deliverables/store';
import { TranscriptSlot, useTranscriptStore } from '../../transcript';
import type { TranscriptActions } from '../../transcript/view/context';
import { registeredActions } from '../../transcript/view/registry';
import { openSideThread } from '../actions';
import { SIDE_COPY } from '../copy';
import { hostedInSidePane, useSidePane } from '../store';
import type { CardFrame } from './CardHost';
import { closeCard, hideCardThread, showCardThread, type OpenCard } from './store';
import { needsYouOf, replyOutcomeOf, threadStartOf } from './thread';

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

  const actions = useCardActions(card, frame);
  const reply = useReply(child);

  const setupCard = useSetup((s) => s.cards.get(child));
  const setupFailed = useSetup((s) => failureOf(s, child) !== null);
  const pending = useAttention((s) => selectPendingOf(s, child));
  const holder = record?.holder ?? null;
  const needs = needsYouOf({ card: setupCard, failed: setupFailed || reply.startFailed, holder, pending });
  const held = holder !== null && (holder.kind === 'terminal' || holder.kind === 'background_job');
  const exitedUnreleased = useSessions((s) => s.engine.get(child)?.process === 'exited' && s.digests.get(child)?.released === undefined);

  // The field waits while the thread starts, while a terminal holds it, and while a started reply is pending (a failed
  // start hands that reply back into it, so nothing may compete with it); delivery, the hand-back or Close release it.
  const waiting = record === null || reply.pending !== null;
  const blocked = waiting || held;
  const placeholder = waiting ? COPY.starting : held && needs !== null ? needs.text : COPY.replyPlaceholder;
  return (
    <>
      <div className="-mx-2.5 flex min-h-0 flex-1 flex-col" data-card-thread={child}>
        {!started && echo !== null && <Bubble data="echo" text={echo} />}
        {record !== null && <TranscriptSlot appSessionId={child} startAt={startAt} presentation="local" actions={actions} className="min-h-0 flex-1" />}
        {reply.pending && <Bubble data="pending" text={reply.pending.text} />}
      </div>
      {needs !== null && (
        <div role="status" data-needs-you={needs.kind} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-warning px-2 py-1 text-ui-sm text-fg">
          <span className="min-w-0 flex-1">{needs.text}</span>
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
          disabled={blocked || reply.sending}
          onChange={(event) => reply.setText(event.target.value)}
          onKeyDown={reply.onKeyDown}
          className={`${FIELD} min-w-0 flex-1 max-h-[calc(4lh+0.5rem)] resize-none leading-snug field-sizing-content disabled:text-fg-muted`}
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

// A user bubble the card draws itself: the comment as typed while the thread starts, or a reply waiting on a resumed
// start; "Starting…" under it.
function Bubble({ data, text }: { data: 'echo' | 'pending'; text: string }) {
  return (
    <div {...{ [`data-card-${data}`]: '' }} className={`flex shrink-0 flex-col items-end gap-0.5 px-2.5 py-1 ${data === 'pending' ? 'opacity-60' : ''}`}>
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-md bg-bg-active px-2.5 py-1.5 text-ui text-fg">{text}</div>
      <span className="text-ui-sm text-fg-muted">{COPY.starting}</span>
    </div>
  );
}

// The thread's artifact row opening the card's own record shows that version in the card's viewer (null for the latest,
// so the viewer keeps following new ones); any other record goes the registered way (the panel's tool).
function useCardActions(card: OpenCard, frame: CardFrame): Partial<TranscriptActions> {
  const showVersion = useRef(frame.showVersion);
  useLayoutEffect(() => {
    showVersion.current = frame.showVersion;
  });
  const { target } = card;
  return useMemo(
    () => ({
      openDeliverable(appSessionId, id, version) {
        const show = showVersion.current;
        if (target === null || show === undefined || appSessionId !== target.appSessionId || id !== target.deliverableId) {
          registeredActions().openDeliverable(appSessionId, id, version);
          return;
        }
        const lookup = deliverables.getState().lookups.get(lookupKey(appSessionId, id));
        const latest = lookup?.status === 'ready' ? (lookup.record?.versions.length ?? null) : null;
        show(version === undefined || version === latest ? null : version);
      },
    }),
    [target],
  );
}

// The Reply field: Enter sends (Shift+Enter breaks a line, a composition keeps its Enter), through the seam; a host
// error thrown by the send reads as a refusal with its message. A started reply waits as a pending bubble until a user
// row of the thread newer than it arrives; while it waits the card claims the thread's returned message, so a failed
// start puts the text back here (with the failure in the strip), never into the thread's unseen composer draft. No
// other send is taken meanwhile.
function useReply(child: AppSessionId) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{ text: string; at: number } | null>(null);
  const [startFailed, setStartFailed] = useState(false);
  const delivered = useTranscriptStore((s) => waiting !== null && (s.entries[child]?.rows ?? []).some((row) => row.kind === 'user' && row.pending === undefined && Date.parse(row.at) >= waiting.at));
  const pending = delivered ? null : waiting;

  useEffect(() => {
    if (pending === null) return;
    const release = holdMessageReturn(child, (_appSessionId, message) => {
      release();
      setWaiting(null);
      setText(message.display);
      setStartFailed(true);
    });
    return release;
  }, [pending, child]);

  const canSend = text.trim() !== '' && !sending && pending === null;
  const send = async () => {
    if (!canSend) return;
    const content = text.trim();
    const at = Date.now();
    setSending(true);
    setRefusal(null);
    setStartFailed(false);
    let result: HumanPromptResult;
    try {
      result = await sendHumanPrompt(child, content, { origin: 'comment' });
    } catch (error) {
      result = { disposition: 'refused', reason: error instanceof Error ? error.message : String(error) };
    }
    const outcome = replyOutcomeOf(result);
    setSending(false);
    if (outcome.kind === 'refused') {
      setRefusal(outcome.reason);
      return;
    }
    setText('');
    if (outcome.kind === 'starting') setWaiting({ text: content, at });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };
  return { text, setText, sending, refusal, pending, startFailed, canSend, send, onKeyDown };
}
