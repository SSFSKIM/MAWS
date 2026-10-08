// E7 (M2): the inline composer under a message from another session (Reply) and under a `ListAgents` row (Message)
// (E7 execution document, Design §4). No host path reaches another session, so the box asks this session, by one
// `'next'` steer, to SendMessage the owner's text to the address (the registered `replyToPeer`, the agent tools' relay
// store); the line above the box walks that ask from the store (`peerReplies`): asked with its elapsed, the session
// sending it, sent, or failed with the reason (the text back in an empty box, as the drill-in's relay does). Closed with
// the reason when the session is not running here or the last one to this address is still asked. A plain textarea:
// ⌘↵ sends, Enter breaks the line.
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useKeyChord } from '../../../keymap/useKeyChord';
import { RELAY_LONG_WAIT_MS } from '../../../relay-wait'; // after this long asked, the long-wait clause (the drill-in relay's too)
import { displayTitle } from '../../../sessions/title';
import { useSessions } from '../../../stores/sessions';
import { peerMessageCopy } from '../../model/copy';
import { duration } from '../../model/time';
import { useActions, type PeerAddress, type PeerReply } from '../context';
import { TickingStatus, useTicker } from './parts';


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
  const live = useSessions((s) => appSessionId !== null && s.engine.has(appSessionId));
  const session = displayTitle(useSessions((s) => (appSessionId === null ? null : (s.records.get(appSessionId) ?? null))));
  // A failed ask's text stays in the relay store until the next edit, so a composer mounted again (its row virtualised
  // away and back) starts with it in the box (E11 W-D).
  const [draft, setDraft] = useState(() => (reply?.state.kind === 'failed' ? reply.text : ''));
  const [sending, setSending] = useState(false); // the steer is out and unanswered
  const reason = !live ? peerMessageCopy.disabled.notRunningHere(target.mode) : reply?.state.kind === 'asked' ? peerMessageCopy.disabled.pending(target.mode) : null;
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
      await actions.replyToPeer(appSessionId, target, draft.trim());
    } finally {
      setSending(false);
    }
    if (peerReplies.get(appSessionId, target.address)?.state.kind !== 'failed') setDraft(''); // a refused steer keeps the draft
  };

  const edit = (next: string) => {
    setDraft(next);
    const kind = reply?.state.kind;
    if (appSessionId !== null && (kind === 'sent' || kind === 'failed')) peerReplies.dismiss(appSessionId, target.address); // shown until the next edit
  };

  const root = useRef<HTMLDivElement>(null);
  useKeyChord('composer.send', () => void send(), { within: root });
  const id = useId();

  return (
    <div ref={root} data-key-sink="composer" className="transcript-peer-composer" data-part="peer-composer">
      {line !== null && (
        <TickingStatus line={line.line} elapsed={line.elapsed} data-part="peer-line" className="transcript-peer-line" data-failed={reply?.state.kind === 'failed' ? '' : undefined} />
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
