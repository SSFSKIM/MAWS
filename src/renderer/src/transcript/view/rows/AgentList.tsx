// E7 (M2): a `ListAgents` result as the lists it names (E7 execution document, Design §4). The self line, then each
// section (`Subagents`, `Teammates`, `Peer sessions` with the engine's count) as a compact list: the name, its short ref
// in a chip, its extras muted, and a Message button that opens the composer under that row, addressed to the name (the
// listing's own advice: the name is what other sessions message it by). What the parser did not read stays as notes.
import { agentListCopy } from '../../model/copy';
import type { ListingRow } from '../../model/agent-listing';
import type { Row } from '../../model/rows';
import { useDisclosure, useRowSession } from '../context';
import { MessageIcon } from './icons';
import { PeerComposer } from './PeerComposer';

type AgentListData = Extract<Row, { kind: 'agent_list' }>;

// An entry's identity within its listing: its section and its ref when it has one, else its place (two agents may
// share a name; a ref is the engine's own short id).
const entryKey = (section: string, entry: ListingRow, index: number) => `${section}:${entry.ref ?? `#${index}`}`;

function ListingLine({ rowId, entryId, entry }: { rowId: string; entryId: string; entry: ListingRow }) {
  const appSessionId = useRowSession();
  const [messaging, toggle] = useDisclosure(`listing-message:${rowId}:${entryId}`);
  return (
    <li className="transcript-listing-entry" data-name={entry.name}>
      <div className="transcript-listing-line">
        <strong className="transcript-listing-name">{entry.name}</strong>
        {entry.ref !== null && <code className="transcript-listing-ref">{entry.ref}</code>}
        {entry.extras.length > 0 && <span className="transcript-listing-extras">{entry.extras.join(' · ')}</span>}
        <button type="button" className="transcript-quiet-button transcript-peer-toggle" aria-expanded={messaging} aria-label={agentListCopy.messageLabel(entry.name)} onClick={toggle}>
          {agentListCopy.message}
        </button>
      </div>
      {messaging && <PeerComposer appSessionId={appSessionId} target={{ address: entry.name, name: entry.name, mode: 'message' }} label={entry.name} />}
    </li>
  );
}

export function AgentListRow({ row }: { row: AgentListData }) {
  return (
    <section className="transcript-listing" aria-busy={row.pending || undefined}>
      <div className="transcript-lifecycle">
        <MessageIcon />
        <span>{row.pending ? agentListCopy.pending : row.self !== null ? agentListCopy.self(row.self) : row.notes[0] ?? ''}</span>
      </div>
      {row.sections.map((section) => (
        <div key={section.title} className="transcript-listing-section" data-section={section.title}>
          <div className="transcript-listing-heading">{agentListCopy.section(section.title, section.count)}</div>
          <ul className="transcript-listing-rows">
            {section.rows.map((entry, index) => {
              const entryId = entryKey(section.title, entry, index);
              return <ListingLine key={entryId} rowId={row.id} entryId={entryId} entry={entry} />;
            })}
          </ul>
        </div>
      ))}
      {(row.self !== null ? row.notes : row.notes.slice(1)).map((note, i) => (
        <p key={i} className="transcript-listing-note">
          {note}
        </p>
      ))}
    </section>
  );
}
