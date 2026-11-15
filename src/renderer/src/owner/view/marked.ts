// A text's message spans as the to-human mod reads them (`parseMarked`, `to-human/hooks/mods/to-human.tsx` 144, read
// at 0.8.2), ported: what a closed stretch's head draws (UX wave U2b; the architect's direction of 2026-11-15), and
// nothing the mod assigns to the record. Every mark is a message; marks may nest, and each contiguous run of text under
// one mark is a span of its own, in the order written; a mark left unclosed runs to the end, open. The text is read
// as written, whatever Markdown container a mark sits in, so a span cut out of an emphasis, a list or a table cell
// leaves that container behind, as the terminal does. Tags are read outside code (the strict reading, else the glued
// one when it pairs every tag the strict leaves unpaired), and, as MAWS draws them literally, not after a backslash.
import { codeRegions, gluedCodeRegions, insideCode, type CodeRegion } from '@shared/owner/to-human-parser';

export interface MarkedSpan { text: string; isOpen: boolean }

const TAG = /<(\/?)(message|to-human|essential|need-input|insight)>/g;

const escaped = (text: string, at: number): boolean => {
  let backslashes = 0;
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) backslashes++;
  return backslashes % 2 === 1;
};

function readingOf(text: string, regions: readonly CodeRegion[]) {
  const inCode = insideCode(regions);
  const tokens = [...text.matchAll(TAG)].filter((token) => !inCode(token.index) && !escaped(text, token.index));
  const stack: string[] = [];
  let balanced = true;
  for (const token of tokens) {
    if (!token[1]) stack.push(token[2]);
    else if (stack.at(-1) === token[2]) stack.pop();
    else { balanced = false; stack.length = 0; }
  }
  return { tokens, balanced: balanced && stack.length === 0 };
}

export function markedSpans(text: string): MarkedSpan[] {
  let reading = readingOf(text, codeRegions(text));
  if (!reading.balanced) {
    const glued = readingOf(text, gluedCodeRegions(text));
    if (glued.balanced) reading = glued;
  }
  const spans: MarkedSpan[] = [];
  // One entry per open mark, innermost last; `span` is its current run, or null once an inner mark interrupted it.
  const open: { tag: string; span: MarkedSpan | null }[] = [];
  let last = 0;
  const take = (piece: string) => {
    const top = open.at(-1);
    if (!top) return; // the record's
    if (top.span) top.span.text += piece;
    else if (piece.trim() !== '') {
      top.span = { text: piece, isOpen: true };
      spans.push(top.span);
    }
  };
  const close = (entry: { span: MarkedSpan | null }) => {
    if (entry.span) entry.span.isOpen = false;
    entry.span = null;
  };
  for (const match of reading.tokens) {
    take(text.slice(last, match.index));
    last = match.index + match[0].length;
    if (!match[1]) {
      const top = open.at(-1);
      if (top) close(top);
      const span: MarkedSpan = { text: '', isOpen: true };
      spans.push(span);
      open.push({ tag: match[2], span });
    } else {
      const depth = open.map((entry) => entry.tag).lastIndexOf(match[2]);
      if (depth === -1) continue; // a stray closer closes nothing
      while (open.length > depth) close(open.pop()!);
    }
  }
  take(text.slice(last));
  for (const span of spans) span.text = span.text.trim();
  return spans.filter((span) => span.text !== '' || span.isOpen);
}
