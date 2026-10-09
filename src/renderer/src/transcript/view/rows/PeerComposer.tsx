// E7 (M2): the inline composer under a message from another session (Reply) and under a `ListAgents` row (Message)
// (E7 execution document, Design §4). No host path reaches another session, so the box asks this session, by one
// `'next'` steer, to SendMessage the owner's text to the address (the registered `replyToPeer`, the agent tools' relay
// store); the line above the box walks that ask from the store (`peerReplies`): asked with its elapsed, the session
// sending it, sent, or failed with the reason (the text back in an empty box, as the drill-in's relay does). Closed with
// the reason when the session cannot be started here or the last one to this address is still asked. A plain textarea:
// ⌘↵ sends, Enter breaks the line. P2-A (2026-10-09; the execution document §5.6): on a session with a record and no
// ready process Send starts it first (`acquireSession(id, 'peer')`, the line reading Starting…) and then asks it by
// the same steer; a refused start says why on the line and keeps the text; a terminal or job holding it, or an
// archive, closes the box with the reason. Opening the box starts nothing.
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ARCHIVED } from '../../../composer/submit/submit-state';
import { useKeyChord } from '../../../keymap/useKeyChord';
import { RELAY_LONG_WAIT_MS } from '../../../relay-wait'; // after this long asked, the long-wait clause (the drill-in relay's too)
import { acquireSession, acquisitionWords, cardWords } from '../../../sessions/acquire';
import { useAvailability } from '../../../sessions/availability';
import { holderWords } from '../../../sessions/holder-words';
import { displayTitle } from '../../../sessions/title';
import { useSessions } from '../../../stores/sessions';
import { peerMessageCopy } from '../../model/copy';
import { duration } from '../../model/time';
import { useActions, type PeerAddress, type PeerReply } from '../context';
import { TickingStatus, useTicker } from './parts';

const PEER_STARTING = 'Starting…'; // P2-A: the box's line while the session it asks is started


// The line over the box, or null when nothing was asked of this address yet: its copy with the time it has waited as
// the argument, and that time while it ticks (an ask not yet forwarded), else null.
export function peerReplyLine(reply: PeerReply | undefined, mode: PeerAddress['mode'], session: string, now: number): { line: (elapsed: string) => string; elapsed: string | null } | null {
  const state = reply?.state;
  if (!state) return null;
  const fixed = (text: string) => ({ line: () => text, elapsed: null });
  switch (state.kind) {
    case 'asked': {
      const waited = now - Date.parse(state.sentAt);
      const copy = !state.parentTurnOpenAtSend ? peerMessageCopy.asked : waited >= RELAY_LONG_WAIT_MS ? peerMessageCopy.askedLongWait : peerMessageCopy.askedTurnOpen;
      return { line: (elapsed) => copy(mode, session, elapsed), elapsed: duration(waited) };
    }
    case 'forwarded':
      return fixed(peerMessageCopy.forwarded(mode, session));
    case 'sent':
      return fixed(state.reworded ? peerMessageCopy.sentReworded(mode, session) : peerMessageCopy.sent(mode, session));
    case 'failed':
      return fixed(peerMessageCopy.failed(mode, state.message));
  }
}

export function PeerComposer({ appSessionId, target, label }: { appSessionId: AppSessionId | null; target: PeerAddress; label: string }) {
  const actions = useActions();
  const { peerReplies } = actions;
  const reply = useSyncExternalStore(peerReplies.subscribe, () => (appSessionId === null ? undefined : peerReplies.get(appSessionId, target.address)));
  const ready = useSessions((s) => appSessionId !== null && s.engine.get(appSessionId)?.process === 'ready');
  // P2-A start: a session with a record and no ready process is started by Send; the holder or the archive closes the box
  const availability = useAvailability(appSessionId ?? ('' as AppSessionId));
  const holder = useSessions((s) => (appSessionId === null ? null : (s.records.get(appSessionId)?.holder ?? null)));
  const closed = ready ? null : availability === null ? peerMessageCopy.disabled.notRunningHere(target.mode) : availability === 'foreign_held' ? `Held by ${holder ? holderWords(holder) : 'another process'}` : availability === 'archived' ? ARCHIVED : null;
  const [start, setStart] = useState<{ kind: 'idle' } | { kind: 'starting' } | { kind: 'refused'; words: string }>({ kind: 'idle' });
  // P2-A end
  const session = displayTitle(useSessions((s) => (appSessionId === null ? null : (s.records.get(appSessionId) ?? null))));
  // A failed ask's text stays in the relay store until the next edit, so a composer mounted again (its row virtualised
  // away and back) starts with it in the box (E11 W-D).
  const [draft, setDraft] = useState(() => (reply?.state.kind === 'failed' ? reply.text : ''));
  const [sending, setSending] = useState(false); // the steer is out and unanswered
  const reason = closed ?? (reply?.state.kind === 'asked' ? peerMessageCopy.disabled.pending(target.mode) : null);
  const canSend = reason === null && !sending && draft.trim() !== '' && appSessionId !== null;
  const now = useTicker(reply?.state.kind === 'asked');
  const line = peerReplyLine(reply, target.mode, session, now);

  // A failed ask puts its text back when the box is empty, never over a draft typed since: adjusted while rendering the
  // reply that changed, so the box never shows a frame without it.
  const [shown, setShown] = useState(reply);
  if (reply !== shown) {
    setShown(reply);
    if (reply?.state.kind === 'failed' && draft.trim() === '') setDraft(reply.text);
  }

  const send = async () => {
    if (!canSend || appSessionId === null) return;
    setSending(true);
    try {
      // P2-A start (2026-10-09): the session started first when it has no ready process
      if (!ready) {
        setStart({ kind: 'starting' });
        let refusal: string | null;
        try {
          const outcome = await acquireSession(appSessionId, 'peer');
          refusal = outcome.status === 'ready' ? null : outcome.status === 'needs_trust' || outcome.status === 'relay_unreachable' ? cardWords(outcome) : (acquisitionWords(outcome) ?? 'The session could not start');
        } catch (error) {
          refusal = error instanceof Error ? error.message : String(error);
        }
        if (refusal !== null) return setStart({ kind: 'refused', words: refusal }); // the text stays
        setStart({ kind: 'idle' });
      }
      // P2-A end
      await actions.replyToPeer(appSessionId, target, draft.trim());
    } finally {
      setSending(false);
    }
    if (peerReplies.get(appSessionId, target.address)?.state.kind !== 'failed') setDraft(''); // a refused steer keeps the draft
  };

  const edit = (next: string) => {
    setDraft(next);
    if (start.kind === 'refused') setStart({ kind: 'idle' }); // P2-A: shown until the next edit, as a failed ask's line is
    const kind = reply?.state.kind;
    if (appSessionId !== null && (kind === 'sent' || kind === 'failed')) peerReplies.dismiss(appSessionId, target.address); // shown until the next edit
  };

  const root = useRef<HTMLDivElement>(null);
  useKeyChord('composer.send', () => void send(), { within: root });
  const id = useId();

  return (
    <div ref={root} data-key-sink="composer" className="transcript-peer-composer" data-part="peer-composer">
      {/* P2-A: this box's own start over the relay's line while it runs or was refused */}
      {start.kind !== 'idle' ? (
        <p role="status" data-part="peer-line" className="transcript-peer-line" data-failed={start.kind === 'refused' ? '' : undefined}>
          {start.kind === 'starting' ? PEER_STARTING : start.words}
        </p>
      ) : (
        line !== null && <TickingStatus line={line.line} elapsed={line.elapsed} data-part="peer-line" className="transcript-peer-line" data-failed={reply?.state.kind === 'failed' ? '' : undefined} />
      )}
      <label htmlFor={id} className="transcript-peer-label">
        {peerMessageCopy.label(target.mode, session)}
      </label>
      <textarea
        id={id}
        rows={2}
        value={draft}
        disabled={reason !== null || sending}
        placeholder={reason ?? peerMessageCopy.placeholder(target.mode, label)}
        onChange={(e) => edit(e.target.value)}
        className="transcript-peer-input"
      />
      {/* a kept draft hides the placeholder, so the reason the box is closed shows as a line of its own */}
      {reason !== null && draft !== '' && (
        <p data-part="peer-reason" className="transcript-peer-line">
          {reason}
        </p>
      )}
      <div className="transcript-peer-actions">
        <button type="button" className="transcript-peer-send" disabled={!canSend} onClick={() => void send()}>
          {peerMessageCopy.send}
        </button>
      </div>
    </div>
  );
}
