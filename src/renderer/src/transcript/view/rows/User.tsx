// The user's message: a bubble with the text through the shared markdown pipeline, its attachments (images inline from
// their data URLs, files as chips, pasted blocks as chips that expand to their text), a collapse past 19 rendered
// lines, and copy and edit affordances (residues *Images and attachments*, *Bounded surfaces and truncation*, *Copy and
// export*; *Pasted content* under Derivation). A dropped prompt carries a quiet `Not sent`. W1: a message waiting for
// the engine (a `next` steer, or one held in MAWS's queue) is dimmed with what it waits for, and a steer the engine took
// says it was sent during the turn it sits in. W2 (B2, Codex's bubble): the time, Copy and Edit overlay beside the
// bubble on hover or focus instead of reserving a line under it, and the collapse follows the rendered height (a long
// paragraph folds as a long list does), measured while folded and again whenever the content's size changes. W3 (B6):
// Edit edits the bubble in place: C7's registered editor stands in the bubble's place while its session edits it.
import { useLayoutEffect, useRef, useState } from 'react';
import { NOT_SENT, PENDING_CAPTION, STEERED_CAPTION } from '../../model/copy';
import type { Attachment, Row } from '../../model/rows';
import { placeholdersOf, untaggedUserText } from '../../model/user-text';
import { useActions, useDisclosure, useTranscriptContext } from '../context';
import { useRegisteredBubbleEditor } from '../registry';
import { Markdown } from '../markdown/Markdown';
import { Chevron, clockTime, copyText } from './parts';

type UserRowData = Extract<Row, { kind: 'user' }>;
type Segment = { kind: 'text'; text: string } | { kind: 'pasted'; n: number; lines: number; attachment: Attachment };


// The text split at the placeholders the model put in place of pasted blocks (the places it recorded); a
// placeholder-shaped string the human typed stays text.
function segmentsOf(row: UserRowData): Segment[] {
  const segments: Segment[] = [];
  let from = 0;
  for (const placeholder of placeholdersOf(row.text, row.attachments, row.placeholders)) {
    segments.push({ kind: 'text', text: row.text.slice(from, placeholder.from) });
    segments.push({ kind: 'pasted', n: placeholder.n, lines: placeholder.lines, attachment: placeholder.attachment });
    from = placeholder.to;
  }
  segments.push({ kind: 'text', text: row.text.slice(from) });
  return segments.filter((segment) => segment.kind === 'pasted' || segment.text.trim().length > 0);
}

export function UserRow({ row }: { row: UserRowData }) {
  const actions = useActions();
  const { storeKey, variant } = useTranscriptContext();
  const renderEditor = useRegisteredBubbleEditor();
  const [open, toggle] = useDisclosure(`bubble:${row.id}`);
  const content = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const files = row.attachments.filter((a) => a.kind !== 'text');
  const caption = row.pending ? PENDING_CAPTION[row.pending] : row.steer ? STEERED_CAPTION : null;

  // Measured while folded only: an open bubble has no bound. Open stays in the transcript-wide disclosures while the
  // measurement is this mount's, so an open bubble always offers Show less (a virtualiser remount resets the
  // measurement), and folding measures again.
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || open) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined' || !element.firstElementChild) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [open, row.text, row.attachments]);

  const body = (
    <div className="transcript-user-body">
      <div className="transcript-user-bubble" data-bubble="" data-open={open ? '' : undefined} data-collapsed={overflows && !open ? '' : undefined}>
        <div ref={content} className="transcript-user-content" data-user-content="">
          <div>
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
        </div>
        {(open || overflows) && (
          <button type="button" className="transcript-quiet-button" aria-expanded={open} onClick={toggle}>
            {open ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      <div className="transcript-user-actions">
        <span>{clockTime(row.at)}</span>
        <button type="button" onClick={() => copyText(untaggedUserText(row.text, row.attachments, row.placeholders))}>
          Copy
        </button>
        {row.editable && !row.pending && (
          <button type="button" title="Edit here · Send rewinds this session to this message" onClick={() => actions.editAndResubmit(row)}>
            Edit
          </button>
        )}
      </div>
    </div>
  );
  return (
    <section className="transcript-user" aria-label="Your message" data-pending={row.pending} data-steer={row.steer ? '' : undefined}>
      {renderEditor && variant === 'session' ? renderEditor({ storeKey, row, children: body }) : body}
      {(row.dropped || caption !== null) && (
        <div className="transcript-user-meta">
          {row.dropped && <span className="transcript-not-sent">{NOT_SENT}</span>}
          {caption !== null && <span className="transcript-user-caption">{caption}</span>}
        </div>
      )}
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
