// The user's message: a bubble with the text through the shared markdown pipeline, its attachments (images inline from
// their data URLs, files as chips, pasted blocks as chips that expand to their text), a collapse past 20 lines, and
// copy and edit affordances (residues *Images and attachments*, *Bounded surfaces and truncation*, *Copy and export*;
// *Pasted content* under Derivation). A dropped prompt carries a quiet `Not sent`.
import { PASTED_PLACEHOLDER } from '@shared/composer/pasted-content';
import { NOT_SENT } from '../../model/copy';
import type { Attachment, Row } from '../../model/rows';
import { untaggedUserText } from '../../model/user-text';
import { useActions, useDisclosure } from '../context';
import { Markdown } from '../markdown/Markdown';
import { Chevron, clockTime, copyText } from './parts';

type UserRowData = Extract<Row, { kind: 'user' }>;
type Segment = { kind: 'text'; text: string } | { kind: 'pasted'; n: number; lines: number; attachment: Attachment };

const COLLAPSE_LINES = 20;

// The text split at the placeholders the model put in place of pasted blocks; a placeholder-shaped string with no
// matching attachment stays text.
function segmentsOf(row: UserRowData): Segment[] {
  const pasted = new Map(row.attachments.filter((a) => a.kind === 'text').map((a) => [a.name, a]));
  const segments: Segment[] = [];
  let from = 0;
  for (const match of row.text.matchAll(PASTED_PLACEHOLDER)) {
    const attachment = pasted.get(`Pasted text #${match[1]}`);
    if (!attachment) continue;
    segments.push({ kind: 'text', text: row.text.slice(from, match.index) });
    segments.push({ kind: 'pasted', n: Number(match[1]), lines: Number(/\+(\d+) lines/.exec(match[0])![1]), attachment });
    from = match.index + match[0].length;
  }
  segments.push({ kind: 'text', text: row.text.slice(from) });
  return segments.filter((segment) => segment.kind === 'pasted' || segment.text.trim().length > 0);
}

export function UserRow({ row }: { row: UserRowData }) {
  const actions = useActions();
  const [open, toggle] = useDisclosure(`bubble:${row.id}`);
  const long = row.lines > COLLAPSE_LINES;
  const files = row.attachments.filter((a) => a.kind !== 'text');
  return (
    <section className="transcript-user" aria-label="Your message">
      <div className="transcript-user-bubble" data-bubble="" data-collapsed={long && !open ? '' : undefined}>
        {segmentsOf(row).map((segment, i) =>
          segment.kind === 'text' ? (
            <Markdown key={i} markdown={segment.text} live={false} />
          ) : (
            <PastedBlock key={i} rowId={row.id} n={segment.n} lines={segment.lines} attachment={segment.attachment} />
          ),
        )}
        {files.length > 0 && (
          <div className="transcript-attachments">
            {files.map((file, i) =>
              file.kind === 'image' && file.dataUrl ? (
                <img key={i} className="transcript-attachment-image" src={file.dataUrl} alt={file.name} />
              ) : (
                <span key={i} className="transcript-chip" data-chip="file" title={file.mediaType ?? undefined}>
                  {file.name}
                </span>
              ),
            )}
          </div>
        )}
      </div>
      {long && (
        <button type="button" className="transcript-quiet-button" onClick={toggle}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
      <div className="transcript-user-actions">
        {row.dropped && <span className="transcript-not-sent">{NOT_SENT}</span>}
        <span>{clockTime(row.at)}</span>
        <button type="button" onClick={() => copyText(untaggedUserText(row.text, row.attachments))}>
          Copy
        </button>
        {row.editable && (
          <button type="button" title="Edit and resubmit forks history" onClick={() => actions.editAndResubmit(row)}>
            Edit
          </button>
        )}
      </div>
    </section>
  );
}

// A pasted block: a chip in the bubble; open, its body as text in a <pre> (never markdown).
function PastedBlock({ rowId, n, lines, attachment }: { rowId: string; n: number; lines: number; attachment: Attachment }) {
  const [open, toggle] = useDisclosure(`pasted:${rowId}:${n}`);
  return (
    <div className="transcript-pasted">
      <button type="button" className="transcript-chip transcript-disclosure" aria-expanded={open} onClick={toggle}>
        <Chevron />
        {attachment.name} · {lines} lines
      </button>
      {open && <pre className="transcript-pasted-text">{attachment.text}</pre>}
    </div>
  );
}
