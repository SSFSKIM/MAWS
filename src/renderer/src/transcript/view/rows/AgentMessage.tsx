// A message between the parent and a subagent (or between agents): one muted line with a bubble mark.
// E7 (M2): a message between sessions draws its sender (`@ name`, the address as its tooltip) or its recipient and the
// send's state, the preview, and the whole message behind a disclosure when the preview hides some of it; one from
// another session that can be answered offers Reply, which opens the composer under it. A subagent's hand-back reads
// `Report from <title>` with the report behind a disclosure (E7 execution document, Design §4).
import { peerLabel } from '@shared/engine/peer-envelope'; // E7
import { peerMessageCopy } from '../../model/copy'; // E7
import { previewHidesBody, type PeerMessage, type Row } from '../../model/rows';
import { useDisclosure, useRowSession } from '../context'; // E7
import { MessageIcon } from './icons';
import { PeerComposer } from './PeerComposer'; // E7

type AgentMessageData = Extract<Row, { kind: 'agent_message' }>;

export function AgentMessageRow({ row }: { row: AgentMessageData }) {
  if (row.peer) return <PeerMessageRow row={row} peer={row.peer} />; // E7
  if (row.report !== undefined) return <ReportRow row={row} report={row.report} />; // E7
  if (row.body !== undefined) return <AgentBodyRow row={row} body={row.body} />; // E7
  return (
    <div className="transcript-lifecycle" data-direction={row.direction}>
      <MessageIcon />
      <span>{row.text}</span>
    </div>
  );
}

// E7 start
function PeerMessageRow({ row, peer }: { row: AgentMessageData; peer: PeerMessage }) {
  const appSessionId = useRowSession();
  const [open, toggle] = useDisclosure(`peer-body:${row.id}`);
  const [replying, toggleReply] = useDisclosure(`peer-reply:${row.id}`);
  const inbound = peer.sender !== null;
  const party = peer.sender ?? peer.recipient; // one of the two is set
  const who = party ? peerLabel(party.address, party.name) : '';
  const address = party?.address ?? null;
  const hidden = previewHidesBody(peer.body, peer.preview); // the whole of it behind the disclosure
  return (
    <div className="transcript-peer" data-direction={row.direction} data-peer={inbound ? 'inbound' : 'outbound'}>
      <div className="transcript-lifecycle">
        <MessageIcon />
        <span className="transcript-peer-text">
          <span className="transcript-peer-who" title={address ?? undefined}>
            {inbound ? peerMessageCopy.sender(who) : peerMessageCopy.recipient(who)}
          </span>{' '}
          <span title={peer.summary ?? undefined}>{peer.preview}</span>
        </span>
        {peer.result !== null && (
          <span className="transcript-peer-state" data-result={peer.result} title={peer.resultText ?? undefined}>
            {peerMessageCopy.result[peer.result]}
          </span>
        )}
        {hidden && (
          <button type="button" className="transcript-quiet-button transcript-peer-toggle" aria-expanded={open} onClick={toggle}>
            {open ? peerMessageCopy.hide : peerMessageCopy.showMessage}
          </button>
        )}
        {peer.replyTo !== null && (
          <button type="button" className="transcript-quiet-button transcript-peer-toggle" aria-expanded={replying} onClick={toggleReply}>
            {peerMessageCopy.reply}
          </button>
        )}
      </div>
      {peer.result === 'failed' && peer.resultText !== null && <p className="transcript-peer-error">{peer.resultText}</p>}
      {hidden && open && <p className="transcript-peer-body">{peer.body}</p>}
      {peer.replyTo !== null && replying && <PeerComposer appSessionId={appSessionId} target={{ address: peer.replyTo, name: peer.sender?.name ?? null, mode: 'reply' }} label={who} />}
    </div>
  );
}

// A hand-back's report, or an agent's message whose line shows only its first line: the line, then the rest behind the
// disclosure the message between sessions uses.
function FoldedBody({ row, folded, show, part }: { row: AgentMessageData; folded: string; show: string; part: 'report' | 'body' }) {
  const [open, toggle] = useDisclosure(`${part}:${row.id}`);
  return (
    <div className="transcript-peer" data-direction={row.direction} data-part={part}>
      <div className="transcript-lifecycle">
        <MessageIcon />
        <span className="transcript-peer-text">{row.text}</span>
        <button type="button" className="transcript-quiet-button transcript-peer-toggle" aria-expanded={open} onClick={toggle}>
          {open ? peerMessageCopy.hide : show}
        </button>
      </div>
      {open && <p className="transcript-peer-body">{folded}</p>}
    </div>
  );
}

const ReportRow = ({ row, report }: { row: AgentMessageData; report: string }) => <FoldedBody row={row} folded={report} show={peerMessageCopy.showReport} part="report" />;
const AgentBodyRow = ({ row, body }: { row: AgentMessageData; body: string }) => <FoldedBody row={row} folded={body} show={peerMessageCopy.showMessage} part="body" />;
// E7 end
