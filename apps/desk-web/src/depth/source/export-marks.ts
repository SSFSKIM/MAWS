// The marks of one stored assistant text read as `sminos record` read them when it numbered the `message` events it
// exported from the row (`<row uuid>#<span index>`): doperpowers' `sminos_marks.py` (`_parse_marked`, itself the port
// of `parse` in its hooks/mods/to-human.tsx, the two pinned together by tests/sminos/marks_parity.py), ported here so a
// fold cuts a row by the same spans its bounds count. It differs from MAWS's stored grammar
// (`@shared/owner/to-human-parser`), which leaves an unbalanced mark literal: here an unclosed mark runs to the end of
// the text, a stray closing tag is skipped, marks may nest (each contiguous run under a mark is a span of its own), and
// every alias is a `<message>`. Tags inside code are literal; the glued fence reading is the recovery the strict one
// falls back to when it leaves a tag unpaired. The text comes back in order as plain runs (the working record, tag-free
// outside code) and spans, each span with its export index; a span with no text is not one, as the export drops it.
import { insideCode, type CodeRegion } from '@shared/owner/to-human-parser';

export type ExportPart = { kind: 'plain'; text: string } | { kind: 'span'; text: string; index: number };

const NAMES = 'message|to-human|essential|need-input|insight';
type Fences = { open: RegExp; close: RegExp };
const STRICT: Fences = { open: /^[ \t]*(`{3,}|~{3,})(.*)$/, close: /^[ \t]*(`{3,}|~{3,})[ \t]*()$/ };
const MARK_TAGS = `(?:</?(?:${NAMES})>[ \\t]*)*`;
const GLUED: Fences = { open: new RegExp(`^[ \\t]*${MARK_TAGS}(\`{3,}|~{3,})(.*)$`), close: new RegExp(`^[ \\t]*(\`{3,}|~{3,})[ \\t]*(${MARK_TAGS})$`) };
const TAG = new RegExp(`<(/?)(${NAMES})>`, 'g');

/** A run of N backticks opens an inline span closed by the next run of exactly N; one with no partner is literal. */
function inlineSpans(text: string, start: number, end: number, regions: CodeRegion[]): void {
  const runs = [...text.slice(start, end).matchAll(/`+/g)];
  const next = runs.map(() => -1);
  const latest = new Map<number, number>();
  runs.forEach((run, i) => {
    const previous = latest.get(run[0].length);
    if (previous !== undefined) next[previous] = i;
    latest.set(run[0].length, i);
  });
  for (let i = 0; i < runs.length; i++) {
    const close = next[i];
    if (close === -1) continue;
    regions.push([start + runs[i].index, start + runs[close].index + runs[close][0].length]);
    i = close;
  }
}

/** Half-open offsets of the text's code: fenced blocks (an unclosed fence runs to the end) and inline spans. */
function codeRegions(text: string, fences: Fences): CodeRegion[] {
  const regions: CodeRegion[] = [];
  let paragraph: [number, number] | null = null;
  let fence: { char: string; length: number; start: number } | null = null;
  const closeParagraph = () => {
    if (paragraph !== null) inlineSpans(text, paragraph[0], paragraph[1], regions);
    paragraph = null;
  };
  for (let at = 0; at <= text.length; ) {
    const newline = text.indexOf('\n', at);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(at, end);
    if (fence !== null) {
      const close = fences.close.exec(line);
      if (close !== null && close[1][0] === fence.char && close[1].length >= fence.length) {
        regions.push([fence.start, end - close[2].length]);
        fence = null;
      }
    } else {
      const open = fences.open.exec(line);
      if (open !== null && !(open[1][0] === '`' && open[2].includes('`'))) {
        closeParagraph();
        fence = { char: open[1][0], length: open[1].length, start: end - open[1].length - open[2].length };
      } else if (line.trim() === '') closeParagraph();
      else paragraph = paragraph === null ? [at, end] : [paragraph[0], end];
    }
    at = end + 1;
  }
  if (fence !== null) regions.push([fence.start, text.length]);
  closeParagraph();
  return regions.sort((a, b) => a[0] - b[0]);
}

/** The mark tags outside one reading's code, and whether they all pair (none left open). */
function reading(text: string, regions: readonly CodeRegion[]): { tokens: RegExpMatchArray[]; balanced: boolean } {
  const inCode = insideCode(regions);
  const tokens = [...text.matchAll(TAG)].filter((token) => !inCode(token.index!));
  const stack: string[] = [];
  let balanced = true;
  for (const token of tokens) {
    if (!token[1]) stack.push(token[2]);
    else if (stack.length > 0 && stack.at(-1) === token[2]) stack.pop();
    else {
      balanced = false;
      stack.length = 0;
    }
  }
  return { tokens, balanced: balanced && stack.length === 0 };
}

type Run = { kind: 'plain' | 'span'; text: string };

export function exportParts(text: string): ExportPart[] {
  const strict = reading(text, codeRegions(text, STRICT));
  const glued = strict.balanced ? null : reading(text, codeRegions(text, GLUED));
  const tokens = glued?.balanced ? glued.tokens : strict.tokens;
  const runs: Run[] = [];
  // One entry per open mark, innermost last: its tag, and its current run of text (null once an inner mark interrupted it).
  const stack: Array<{ tag: string; run: Run | null }> = [];
  const take = (piece: string) => {
    if (piece === '') return;
    const top = stack.at(-1);
    if (top === undefined) {
      const last = runs.at(-1);
      if (last?.kind === 'plain') last.text += piece;
      else runs.push({ kind: 'plain', text: piece });
    } else if (top.run !== null) top.run.text += piece;
    else if (piece.trim() !== '') {
      top.run = { kind: 'span', text: piece };
      runs.push(top.run);
    }
  };
  let last = 0;
  for (const token of tokens) {
    take(text.slice(last, token.index));
    last = token.index! + token[0].length;
    if (!token[1]) {
      const top = stack.at(-1);
      if (top) top.run = null;
      const run: Run = { kind: 'span', text: '' };
      runs.push(run);
      stack.push({ tag: token[2], run });
    } else {
      const at = stack.map((entry) => entry.tag).lastIndexOf(token[2]);
      if (at < 0) continue; // a stray closing tag: nothing to close
      stack.length = at;
    }
  }
  take(text.slice(last));
  const parts: ExportPart[] = [];
  let index = 0;
  for (const run of runs) {
    if (run.kind === 'plain') parts.push({ kind: 'plain', text: run.text });
    else if (run.text.trim() !== '') parts.push({ kind: 'span', text: run.text.trim(), index: index++ });
  }
  return parts;
}
