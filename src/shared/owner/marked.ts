// The one reading of a text's marks for every reader the renderer has (UX wave U2b; the architect's direction of
// 2026-11-15): which words are a message and which are the record's. The presenter's gate and its full drawing
// (`owner/to-human/message-ink.ts`, `Presenter.tsx`), a closed stretch's head (`HeadMessages`) and the mirror
// (`transcript/model/owner-marks.ts`'s `marksOfText`, read by `owner/view/mirror.ts`, `derive.ts` and the store) all
// derive from it; the modes differ only in how a message is drawn, never in which words are one.
//
// The tags are the shared grammar's (`markTagsOf`: what `parse` pairs, or `parseLive` while a block streams, under the
// strict-then-glued code regions), so main's marks, previews and channel, which `parse` serves, read the same tags; a
// tag after a backslash is text here, as Markdown shows it, and a tag there (a known difference, §E). So a mark left
// open in a completed text, a stray closer and crossing marks are text, as on master and in what main stores; the mod's
// `parseMarked` reads them otherwise (the second pull request's item). The messages are split as `parseMarked` splits
// them (`to-human/hooks/mods/to-human.tsx` 144, read at 0.8.2): marks nest, and each contiguous run of text under one
// mark is a span of its own, in the order written; a mark the stream has not closed yet is open.
import { arrived, markTagsOf } from './to-human-parser';

export interface MarkedSpan { text: string; isOpen: boolean; start: number; end: number } // [start, end): the trimmed run in the text
export interface MarkedReading {
  spans: readonly MarkedSpan[];
  tags: readonly number[]; // where each tag the reading takes stands: they are out of sight in every drawing
  hasRecord: boolean; // some text outside every mark is not blank
}

const KEPT = 512;
const kept = new Map<string, MarkedReading>();

export function readMarked(text: string, live = false): MarkedReading {
  const key = `${live ? 'l' : 'f'}${text}`;
  const known = kept.get(key);
  if (known) return known;
  const reading = readingOf(text, live);
  if (kept.size >= KEPT) kept.delete(kept.keys().next().value!);
  kept.set(key, reading);
  return reading;
}

export const markedSpans = (text: string, live = false): readonly MarkedSpan[] => readMarked(text, live).spans;

function readingOf(whole: string, live: boolean): MarkedReading {
  const text = live ? arrived(whole) : whole; // a prefix: every offset holds in the whole text
  const tags = markTagsOf(whole, { live, escapes: true });
  const spans: MarkedSpan[] = [];
  // One entry per open mark, innermost last; `span` is its current run, or null once an inner mark interrupted it.
  const open: { span: MarkedSpan | null }[] = [];
  let outside = '';
  const take = (from: number, to: number) => {
    const top = open.at(-1);
    const piece = text.slice(from, to);
    if (!top) outside += piece;
    else if (top.span) top.span.end = to;
    else if (piece.trim() !== '') spans.push((top.span = { text: '', isOpen: true, start: from, end: to }));
  };
  const close = (entry: { span: MarkedSpan | null }) => {
    if (entry.span) entry.span.isOpen = false;
    entry.span = null;
  };
  let last = 0;
  for (const tag of tags) {
    take(last, tag.index);
    last = tag.index + tag.length;
    if (!tag.close) {
      const top = open.at(-1);
      if (top) close(top);
      const span: MarkedSpan = { text: '', isOpen: true, start: last, end: last };
      spans.push(span);
      open.push({ span });
    } else close(open.pop()!); // the grammar pairs every tag it takes, innermost first
  }
  take(last, text.length);
  const trimmed = spans.flatMap((span) => {
    const raw = text.slice(span.start, span.end);
    const words = raw.trim();
    if (words === '' && !span.isOpen) return [];
    const start = span.start + (raw.length - raw.trimStart().length);
    return [{ text: words, isOpen: span.isOpen, start, end: start + words.length }];
  });
  return { spans: trimmed, tags: tags.map((tag) => tag.index), hasRecord: outside.trim() !== '' };
}
