// A message between the parent and a subagent, between agents, or between sessions: one dim line (UX wave U3, O-12; UC-2
// "The rows"): `← @<name>: <first line>`, `› Report from <agent>: <first line of the report>`, `→ @<name>: <first line>`
// with the send's state at its end (the word cut, T73: the arrow of its direction, its old words its accessible lead). The line never wraps; it is cut with an ellipsis at
// the column's edge, so the line is always the control that shows the whole message under it (a click, Enter or Space)
// and hides it again: a narrower column cuts any line, and no word of a message may be out of reach (the architect's
// ruling of 2026-11-13). A peer's name is followed by the owners its sminos frame names, by the sidebar's rule (P5 O15
// M2b, §J: a display of the frame, not a verification). Ticket 815: the peer's address, every owner with its email and
// the send's own summary are the line's tip, which the keyboard reaches (the words sit inside the line's one control).
// Where nothing points (the touch rule) the address stands under the line, with every owner and its email where that
// list says more than the drawn label, and a summary that is not the message itself stands over the opened message. A message
// from another session that can be answered offers Reply at the line's end, on hover or focus (always where nothing
// points, T75), and keeps it while the composer it opens is open (E7). The root keeps the class `transcript-peer` and, for a message between sessions, its
// `data-peer`, which the live e2e specs and the agents harness select by.
import { peerLabel } from '@shared/engine/peer-envelope'; // E7
import { MESSAGE_LINE, messageArrow, messageArrowWords, peerMessageCopy } from '../../model/copy'; // E7
import type { PeerMessage, Row } from '../../model/rows';
import { useSessions } from '../../../stores/sessions'; // P5 O15 M2b
import { ownerEntries, ownerIdsOf, ownersLabel } from '../../../sidebar/owners'; // P5 O15 M2b
import { useDisclosure, useRowSession } from '../context'; // E7
import { TouchFact } from '../../../ui/touch-fact'; // ticket 815
import { ArrivalBody, ArrivalLine } from './Line';
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
  const arrow = messageArrow(row);
  const owners = useSenderOwners(peer?.sender?.owners ?? null); // P5 O15 M2b
  const address = peer === null ? null : partyOf(peer).address;
  const facts = peer === null ? [] : [address, owners?.every, peer.summary].filter((part): part is string => typeof part === 'string' && part !== '');
  const fact = facts.length === 0 ? null : { content: facts.map((part, index) => <span key={index} className="block">{part}</span>), description: facts.join(' · ') };
  const atRest = [address, owners !== null && owners.every !== owners.label ? owners.every : null].filter((part) => part !== null).join('\n'); // the touch rule
  const summary = peer !== null && peer.summary !== null && peer.summary.trim() !== wholeOf(row).trim() ? peer.summary : null;
  return (
    <div
      className="transcript-peer"
      data-direction={row.direction}
      data-peer={peer === null ? undefined : peer.sender !== null ? 'inbound' : 'outbound'}
      data-part={row.report !== undefined ? 'report' : undefined}
      data-replying={replying ? '' : undefined}
    >
      <div className="transcript-line">
        <ArrivalLine mark={arrow ?? MESSAGE_LINE.mark} markWords={arrow === null ? undefined : messageArrowWords(arrow)} fact={fact} open={open} onToggle={toggle}>
          {peer === null ? row.text : <PeerWords peer={peer} who={who} owners={owners} />}
        </ArrivalLine>
        {peer !== null && peer.result !== null && (
          <span className="transcript-peer-state" data-result={peer.result} title={peer.resultText ?? undefined}>
            {peerMessageCopy.result[peer.result]}
          </span>
        )}
        {peer !== null && peer.replyTo !== null && (
          <button type="button" className="transcript-quiet-button transcript-peer-reply" data-on-hover="" aria-expanded={replying} onClick={toggleReply}>
            {peerMessageCopy.reply}
          </button>
        )}
      </div>
      <TouchFact block className="ms-6 text-ui-sm [overflow-wrap:anywhere]">{atRest}</TouchFact>
      {peer?.result === 'failed' && peer.resultText !== null && <p className="transcript-peer-error">{peer.resultText}</p>}
      <ArrivalBody open={open}>
        <TouchFact block className="ms-6 mb-1 text-ui-sm [overflow-wrap:anywhere]">{summary}</TouchFact>
        <p className="transcript-peer-body">{wholeOf(row)}</p>
      </ArrivalBody>
      {peer !== null && peer.replyTo !== null && replying && (
        <PeerComposer appSessionId={appSessionId} target={{ address: peer.replyTo, name: peer.sender?.name ?? null, mode: 'reply' }} label={who} keptAs={`peer-composer:${row.id}`} />
      )}
    </div>
  );
}

// A message between sessions on its line: the peer by name, the sender's owners, then the preview as one text node (the
// arrow before them says which way it went).
function PeerWords({ peer, who, owners }: { peer: PeerMessage; who: string; owners: { label: string; every: string } | null }) {
  return (
    <>
      <span className="transcript-peer-who">
        {peerMessageCopy.who(who)}
      </span>
      {owners !== null && (
        <>
          {' ('}
          <span data-owners>
            {owners.label}
          </span>
          {')'}
        </>
      )}
      {': '}
      <span data-part="preview">
        {peer.preview}
      </span>
    </>
  );
}

// P5 O15 M2b: the owners a peer message's frame names, labelled as the sidebar labels a session's (nothing when you
// alone own it) with `me` and `members` from the sessions store; a name the store doesn't hold is drawn as written. The
// tip lists every owner, with its email where the store has one.
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
