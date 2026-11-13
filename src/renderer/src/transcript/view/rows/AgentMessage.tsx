// A message between the parent and a subagent, between agents, or between sessions: one dim line led by `›` (UX wave U3,
// O-12; UC-2 "The rows"): `Message from @<name>: <first line>`, `Report from <agent>: <first line of the report>`,
// `Sent to @<name>: <first line>` with the send's state at its end. The line never wraps; it is cut with an ellipsis at
// the column's edge, so the line is always the control that shows the whole message under it (a click, Enter or Space)
// and hides it again: a narrower column cuts any line, and no word of a message may be out of reach (the architect's
// ruling of 2026-11-13). A peer's name has its address as its tooltip and, after it, the owners
// its sminos frame names, by the sidebar's rule (P5 O15 M2b, §J: a display of the frame, not a verification). A message
// from another session that can be answered offers Reply at the line's end, on hover or focus, and keeps it while the
// composer it opens is open (E7). The root keeps the class `transcript-peer` and, for a message between sessions, its
// `data-peer`, which the live e2e specs and the agents harness select by.
import { peerLabel } from '@shared/engine/peer-envelope'; // E7
import { MESSAGE_LINE, peerMessageCopy } from '../../model/copy'; // E7
import type { PeerMessage, Row } from '../../model/rows';
import { useSessions } from '../../../stores/sessions'; // P5 O15 M2b
import { ownerEntries, ownerIdsOf, ownersLabel } from '../../../sidebar/owners'; // P5 O15 M2b
import { useDisclosure, useRowSession } from '../context'; // E7
import { ArrivalLine } from './Line';
import { PeerComposer } from './PeerComposer'; // E7

type AgentMessageData = Extract<Row, { kind: 'agent_message' }>;

// What opens under the line: a hand-back's report, else the whole message (the line's words where no caller gave one).
const wholeOf = (row: AgentMessageData): string => row.report ?? row.peer?.body ?? row.body ?? row.text;

// The other party of a message between sessions: its sender, or for one this session sent, its recipient.
const partyOf = (peer: PeerMessage): { name: string | null; address: string } => (peer.sender ?? peer.recipient)!;

export function AgentMessageRow({ row }: { row: AgentMessageData }) {
  const appSessionId = useRowSession();
  const [open, toggle] = useDisclosure(`line:${row.id}`);
  const [replying, toggleReply] = useDisclosure(`peer-reply:${row.id}`);
  const peer = row.peer ?? null;
  const who = peer === null ? '' : peerLabel(partyOf(peer).address, partyOf(peer).name);
  return (
    <div
      className="transcript-peer"
      data-direction={row.direction}
      data-peer={peer === null ? undefined : peer.sender !== null ? 'inbound' : 'outbound'}
      data-part={row.report !== undefined ? 'report' : undefined}
      data-replying={replying ? '' : undefined}
    >
      <div className="transcript-line">
        <ArrivalLine mark={MESSAGE_LINE.mark} open={open} onToggle={toggle}>
          {peer === null ? row.text : <PeerWords peer={peer} who={who} />}
        </ArrivalLine>
        {peer !== null && peer.result !== null && (
          <span className="transcript-peer-state" data-result={peer.result} title={peer.resultText ?? undefined}>
            {peerMessageCopy.result[peer.result]}
          </span>
        )}
        {peer !== null && peer.replyTo !== null && (
          <button type="button" className="transcript-quiet-button transcript-peer-reply" aria-expanded={replying} onClick={toggleReply}>
            {peerMessageCopy.reply}
          </button>
        )}
      </div>
      {peer?.result === 'failed' && peer.resultText !== null && <p className="transcript-peer-error">{peer.resultText}</p>}
      {open && <p className="transcript-peer-body">{wholeOf(row)}</p>}
      {peer !== null && peer.replyTo !== null && replying && (
        <PeerComposer appSessionId={appSessionId} target={{ address: peer.replyTo, name: peer.sender?.name ?? null, mode: 'reply' }} label={who} />
      )}
    </div>
  );
}

// A message between sessions on its line: the lead words, the peer by name (its address the tooltip), the sender's
// owners, then the preview as one text node.
function PeerWords({ peer, who }: { peer: PeerMessage; who: string }) {
  const owners = useSenderOwners(peer.sender?.owners ?? null); // P5 O15 M2b
  return (
    <>
      {peer.sender !== null ? MESSAGE_LINE.from : MESSAGE_LINE.to}{' '}
      <span className="transcript-peer-who" title={partyOf(peer).address}>
        {peerMessageCopy.who(who)}
      </span>
      {owners !== null && (
        <>
          {' ('}
          <span data-owners title={owners.every}>
            {owners.label}
          </span>
          {')'}
        </>
      )}
      {': '}
      <span data-part="preview" title={peer.summary ?? undefined}>
        {peer.preview}
      </span>
    </>
  );
}

// P5 O15 M2b: the owners a peer message's frame names, labelled as the sidebar labels a session's (nothing when you
// alone own it) with `me` and `members` from the sessions store; a name the store doesn't hold is drawn as written. The
// title lists every owner, with its email where the store has one.
function useSenderOwners(names: string[] | null): { label: string; every: string } | null {
  const me = useSessions((s) => s.member);
  const members = useSessions((s) => s.members);
  if (names === null) return null;
  const ids = ownerIdsOf(names, members);
  const asWritten = (id: string) => id;
  const label = ownersLabel(ids, me, members, asWritten);
  if (label === null) return null;
  const every = ownerEntries(ids, me, members, asWritten).map(({ name, email }) => (email === null || email === name ? name : `${name} <${email}>`)).join(', ');
  return { label, every };
}
