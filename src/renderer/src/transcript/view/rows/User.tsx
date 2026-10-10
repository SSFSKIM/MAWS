// The user's message: a bubble with the text through the shared markdown pipeline, its attachments (images inline from
// their data URLs, files as chips, pasted blocks as chips that expand to their text), a collapse past 19 rendered
// lines, and copy and edit affordances (residues *Images and attachments*, *Bounded surfaces and truncation*, *Copy and
// export*; *Pasted content* under Derivation). A dropped prompt carries a quiet `Not sent`. W1: a message waiting for
// the engine (a `next` steer, or one held in MAWS's queue) is dimmed with what it waits for, and a steer the engine took
// says it was sent during the turn it sits in. W2 (B2, Codex's bubble): the time, Copy and Edit overlay beside the
// bubble on hover or focus instead of reserving a line under it, and the collapse follows the rendered height (a long
// paragraph folds as a long list does), measured while folded and again whenever the content's size changes. W3 (B6):
// Edit edits the bubble in place: C7's registered editor stands in the bubble's place while its session edits it.
// E3: an anchored comment opens with a chip naming what it is about (its kind's glyph and label; a chip with a path
// opens the file at the line), above the comment, its screenshot drawn as the image attachment it is.
import { useLayoutEffect, useRef, useState } from 'react';
import type { Anchor } from '@shared/anchor/anchor'; // E3
import { NOT_SENT, PENDING_CAPTION, STEERED_CAPTION } from '../../model/copy';
import type { Attachment, Row } from '../../model/rows';
import { copiedUserText, placeholdersOf } from '../../model/user-text';
import { useActions, useDisclosure, useTranscriptContext } from '../context';
// E4d start
import { useRowSession } from '../context';
// E4d end
import { useRegisteredBubbleEditor } from '../registry';
import { Markdown } from '../markdown/Markdown';
import { formatClock } from '../../../app/date-format';
import { Chevron, copyText } from './parts';
import { AnchorIcon } from './icons'; // E3

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
  // P2-F L121: the mount's own mark (the card's "Sent to Claude") stands where no caption already says the row's state
  const caption = row.pending ? PENDING_CAPTION[row.pending] : row.steer ? STEERED_CAPTION : row.dropped ? null : (actions.userRowMark?.(row) ?? null);

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
            {row.anchor && <AnchorChip anchor={row.anchor} /> /* E3 */}
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
        <span>{formatClock(Date.parse(row.at))}</span>
        <button type="button" onClick={() => copyText(copiedUserText(row))}>
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

// E3: what an anchored comment is about. A file or PR line opens the file at its line (C5's file tab through the
// transcript's `openFile`); a page element opens its page in the browser (E4d's branch below); any other anchor, and
// a page element outside a session's transcript, is a label.
function AnchorChip({ anchor }: { anchor: Anchor }) {
  const actions = useActions();
  const content = (
    <>
      <AnchorIcon kind={anchor.kind} />
      {anchor.label}
    </>
  );
  const { path } = anchor;
  // E4d start: a page element's chip opens its page in the in-app browser (E4d execution document, Design §10): the
  // row's session's browser, or a side thread's parent's (`openBrowserUrl` decides); a label outside a session's transcript
  const session = useRowSession();
  const pageUrl = anchor.kind === 'browser-element' ? anchor.pageUrl : undefined;
  if (path === undefined && pageUrl !== undefined && session !== null) {
    return (
      <div className="transcript-user-anchor">
        <button type="button" className="transcript-chip" data-chip="anchor" data-anchor-kind={anchor.kind} title={anchor.locator} onClick={() => actions.openBrowserUrl(session, pageUrl)}>
          {content}
        </button>
      </div>
    );
  }
  // E4d end
  return (
    <div className="transcript-user-anchor">
      {path !== undefined ? (
        <button type="button" className="transcript-chip" data-chip="anchor" data-anchor-kind={anchor.kind} title={anchor.locator} onClick={() => actions.openFile(path, anchor.line)}>
          {content}
        </button>
      ) : (
        <span className="transcript-chip" data-chip="anchor" data-anchor-kind={anchor.kind} title={anchor.locator}>
          {content}
        </span>
      )}
    </div>
  );
}
