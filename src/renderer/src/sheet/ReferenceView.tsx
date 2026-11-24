// One captured file on a card (the composite's §2.3 and §8, "The card"; the C3 plan's §G, "References"): a line with the
// path, its range and whether the file changed since asked, opening to the capture as it was when asked. The body is
// fetched through the host when first opened, never before; a text is drawn with its line numbers (EditDiff's lines,
// transcript.css), an image scaled to the card from the bytes the host supplied, as a `data:` URL, and never from a
// URL: C4's page allows no other image source. `changed` null (a reader off the session's machine) says nothing.
import { useEffect, useState } from 'react';
import type { SheetBody, SheetReference } from '@shared/sheet/model';
import { NamedGlyph } from '../ui/glyph';
import { SHEET_WORDS } from './copy';
import type { SheetHost } from './host';
import { Chevron, OpenIcon } from './icons';

export interface ReferenceViewProps {
  session: string;
  reference: SheetReference;
  host: SheetHost;
  open?: boolean; // controlled by the card, which opens a reference its Markdown links to
  onOpenChange?: (open: boolean) => void;
}

const rangeOf = (reference: SheetReference): string | null => (reference.lines ? `:${reference.lines[0]}–${reference.lines[1]}` : null);

function TextBody({ text, startLine }: { text: string; startLine: number }) {
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  return (
    <div className="transcript-diff" data-reference-body="text">
      <div className="transcript-diff-hunk">
        {lines.map((line, i) => (
          <div key={i} className="transcript-diff-line">
            <span className="transcript-diff-number" data-line-number="">
              {startLine + i}
            </span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Body({ body, reference }: { body: SheetBody | null; reference: SheetReference }) {
  if (body === null) return <p className="m-0 py-1 pl-[18px] text-ui-sm text-fg-muted">{SHEET_WORDS.loading}</p>;
  if (body.kind === 'gone') return <p className="m-0 py-1 pl-[18px] text-ui-sm text-fg-muted">{SHEET_WORDS.gone}</p>;
  if (body.kind === 'image') {
    return <img alt={reference.path} src={`data:${body.mediaType};base64,${body.data}`} data-reference-body="image" className="block h-auto max-w-full rounded-sm border border-border" />;
  }
  return <TextBody text={body.text} startLine={reference.kind === 'text' ? reference.startLine : 1} />;
}

export function ReferenceView({ session, reference, host, open: controlled, onOpenChange }: ReferenceViewProps) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const [body, setBody] = useState<SheetBody | null>(null);
  const [asked, setAsked] = useState(false);
  if (open && !asked) setAsked(true); // asked once, when first opened
  useEffect(() => {
    if (!asked) return;
    let live = true;
    host.body(session, { ref: reference.sha256 }).then(
      (answer) => live && setBody(answer),
      () => live && setBody({ kind: 'gone' }),
    );
    return () => {
      live = false;
    };
  }, [asked, host, session, reference.sha256]);
  const toggle = () => {
    setOwn(!open);
    onOpenChange?.(!open);
  };
  const range = rangeOf(reference);
  const startLine = reference.kind === 'text' ? reference.startLine : null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-sheet-reference={reference.sha256}>
      <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-ui-sm text-fg-muted">
        <button type="button" aria-expanded={open} onClick={toggle} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 rounded-sm text-left outline-accent focus-visible:outline-2">
          <Chevron />
          <span className="flex min-w-0 flex-[1_1_0] font-mono">
            <span className="min-w-0 truncate text-fg">{reference.path}</span>
            {range && <span className="shrink-0">{range}</span>}
          </span>
          {reference.changed === true && (
            <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
              {SHEET_WORDS.changed}
            </span>
          )}
        </button>
        {host.openFile && (
          <NamedGlyph label={SHEET_WORDS.openFile} className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2" onClick={() => host.openFile?.(reference.abs, startLine)}>
            <OpenIcon />
          </NamedGlyph>
        )}
      </div>
      {open && <Body body={body} reference={reference} />}
    </div>
  );
}
