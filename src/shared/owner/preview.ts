// The one line a compact summary shows of an assistant's text (E11 F2b, plan 2.6; extends the 2026-10-04 S0 owner-layer
// decision from transcripts to summaries): the sidebar's hover card, the Overview's cards, the digest main folds live,
// the summary the engine host reads off a transcript on disk and the index's digest of it, and the notifier's body.
// Chosen from the whole text before any cap, through the owner's grammar (`to-human-parser.ts`): a question first (the
// need-input's words, else its choices), then the essential text, then the to-human text, then the plain text, an
// insight last. ANSI is stripped. The owner's own marks never show in a preview, even one a cap cut from its pair (a
// summary stored before this read 200 raw characters); any other markup stays as written, and so do tags quoted in
// inline code (grammar 2, P2-C). Null when nothing is left.
import { stripAnsi } from '../wire/ansi';
import { codeRegions, insideCode, parse, type Kind, type Part } from './to-human-parser';

const OWNER_MARK = /<\/?(?:to-human|essential|need-input|insight)>|<choice(?: recommended)?>|<\/choice>/g;

// Code regions are read over the whole text, not per line: an inline span may cross a line break within its paragraph.
const firstLine = (text: string): string | null => {
  const inCode = insideCode(codeRegions(text));
  let at = 0;
  for (const line of text.split('\n')) {
    const shown = line.replace(OWNER_MARK, (tag: string, offset: number) => (inCode(at + offset) ? tag : '')).trim();
    if (shown.length > 0) return shown;
    at += line.length + 1;
  }
  return null;
};

export function previewLine(text: string, max: number): string | null {
  const parts = parse(stripAnsi(text));
  const of = (kind: Kind | 'plain'): Part[] => parts.filter((part) => part.kind === kind);
  const question = of('need-input')[0];
  const candidates = [
    question === undefined ? null : (firstLine(question.text) ?? (question.kind === 'need-input' && question.choices ? question.choices.map((c) => c.text).join(' · ') : null)),
    ...of('essential').map((part) => firstLine(part.text)),
    ...of('to-human').map((part) => firstLine(part.text)),
    // each plain run apart: joined, backticks from runs a mark separates could pair across it
    of('plain').map((part) => firstLine(part.text)).find((line) => line !== null) ?? null,
    ...of('insight').map((part) => firstLine(part.text)),
  ];
  const line = candidates.find((candidate) => candidate !== null) ?? null;
  return line === null ? null : line.slice(0, max);
}
