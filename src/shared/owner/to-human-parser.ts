// The owner layer's to-human grammar (R4 S0, 2026-10-04), shared since E11 F2b so main and the engine host's
// summaries read it as the renderer's Presenter does (`preview.ts`).
// Stored-text grammar mirrors doperpowers 7.135.0's to-human mod, not an HTML/Markdown parser. S0 differs from the live
// mod: unbalanced marks stay literal. The shell hook's ANSI headers are display-only; stored messages retain the tags.
// Grammar 2 (P2-C, 2026-10-09; the P2-C document, Design §4). Tag tokens inside a code region are literal: a
// fenced block (a line opening with three or more backticks or tildes, through its closing fence or the end of the
// text) or an inline code span (a run of N backticks through the next run of exactly N in the same paragraph). The
// contract tells the model to keep marks out of code, and an agent explaining the vocabulary quotes it there; the mod
// still counts quoted tags. A mark containing a fence keeps it, since its own tags lie outside. `parseLive` is the
// display-only leniency for a streaming block.
export const TO_HUMAN_GRAMMAR_VERSION = 2;
export type Kind = 'to-human' | 'essential' | 'need-input' | 'insight';
export type Choice = { text: string; recommended: boolean };
export type Part = { kind: 'plain'; text: string } | { kind: Kind; text: string; choices?: Choice[] };

// Code regions (grammar 2): half-open [start, end) offsets into the text, in order.
export type CodeRegion = readonly [start: number, end: number];

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

export function codeRegions(text: string): CodeRegion[] {
  const regions: CodeRegion[] = [];
  let paragraph: [number, number] | null = null;
  let fence: { char: string; length: number; start: number } | null = null;
  const closeParagraph = () => {
    if (paragraph !== null) inlineSpans(text, paragraph[0], paragraph[1], regions);
    paragraph = null;
  };
  for (let at = 0; at <= text.length;) {
    const newline = text.indexOf('\n', at);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(at, end);
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line);
      if (close !== null && close[1][0] === fence.char && close[1].length >= fence.length) {
        regions.push([fence.start, end]);
        fence = null;
      }
    } else {
      const open = FENCE_OPEN.exec(line);
      // A backtick fence's info string holds no backtick; such a line is an inline span instead.
      if (open !== null && !(open[1][0] === '`' && open[2].includes('`'))) {
        closeParagraph();
        fence = { char: open[1][0], length: open[1].length, start: at };
      } else if (line.trim() === '') closeParagraph();
      else paragraph = paragraph === null ? [at, end] : [paragraph[0], end];
    }
    at = end + 1;
  }
  if (fence !== null) regions.push([fence.start, text.length]);
  closeParagraph();
  return regions.sort((a, b) => a[0] - b[0]);
}

// A run of N backticks opens a span closed by the next run of exactly N; a run with no partner is literal backticks.
function inlineSpans(text: string, start: number, end: number, regions: CodeRegion[]) {
  const runs = [...text.slice(start, end).matchAll(/`+/g)];
  for (let i = 0; i < runs.length; i++) {
    const length = runs[i][0].length;
    const close = runs.findIndex((run, j) => j > i && run[0].length === length);
    if (close === -1) continue;
    regions.push([start + runs[i].index, start + runs[close].index + length]);
    i = close;
  }
}

// Whether an offset lies in one of `codeRegions`' regions (binary search over the ordered, disjoint regions).
export const insideCode = (regions: readonly CodeRegion[]) => (offset: number): boolean => {
  let low = 0;
  let high = regions.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (offset < regions[middle][0]) high = middle - 1;
    else if (offset >= regions[middle][1]) low = middle + 1;
    else return true;
  }
  return false;
};

const STREAMING_TAGS = ['to-human', 'essential', 'need-input', 'insight', 'choice'].flatMap((name) => [`<${name}>`, `</${name}>`]).concat('<choice recommended>');

/** Display only, while a block streams: its final unclosed marks read as open, and a tag still arriving is dropped. */
export function parseLive(text: string): Part[] {
  const tail = text.lastIndexOf('<');
  const suffix = tail === -1 ? '' : text.slice(tail);
  const arriving = suffix !== '' && STREAMING_TAGS.some((tag) => tag.length > suffix.length && tag.startsWith(suffix)) && !insideCode(codeRegions(text))(tail);
  return partsOf(arriving ? text.slice(0, tail) : text, true);
}

export function parse(text: string): Part[] {
  return partsOf(text, false);
}

function partsOf(text: string, live: boolean): Part[] {
  // Grammar 2: tags inside code are literal.
  const inCode = insideCode(codeRegions(text));
  const tokens = [...text.matchAll(/<(\/?)(to-human|essential|need-input|insight)>/g)].filter((token) => !inCode(token.index));
  const stack: number[] = [];
  const paired = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i][1]) stack.push(i);
    else if (stack.length && tokens[stack.at(-1)!][2] === tokens[i][2]) {
      paired.add(stack.pop()!); paired.add(i);
    } else {
      // Crossing marks are unbalanced, not an implicit close of a different kind.
      stack.length = 0;
    }
  }
  // parseLive: a streaming block's marks still open at its end read as open.
  if (live) for (const open of stack) paired.add(open);
  const parts: Part[] = [];
  const starts: number[] = []; // each part's text is the slice of `text` from its start
  const open: Kind[] = [];
  let last = 0;
  const take = (piece: string) => {
    if (piece === '') return;
    const kind = open.at(-1) ?? 'plain';
    const previous = parts.at(-1);
    if (previous?.kind === kind) previous.text += piece;
    else { parts.push({ kind, text: piece }); starts.push(last); }
  };
  for (let i = 0; i < tokens.length; i++) {
    if (!paired.has(i)) continue;
    const token = tokens[i];
    take(text.slice(last, token.index));
    last = token.index + token[0].length;
    if (token[1]) open.pop();
    else open.push(token[2] as Kind);
    // A nested mark is a new contiguous run even when it repeats the outer kind.
    parts.push({ kind: open.at(-1) ?? 'plain', text: '' });
    starts.push(last);
  }
  take(text.slice(last));
  parts.forEach((part, index) => {
    if (part.kind === 'need-input') liftChoices(part, starts[index], inCode);
    if (part.kind !== 'plain') part.text = part.text.trim();
  });
  // Unlike the mod's empty-span filter, stored questions must not lose their only content: the options.
  return parts.filter((part) => part.text !== '' || (part.kind === 'need-input' && !!part.choices?.length));
}

function liftChoices(part: { text: string; choices?: Choice[] }, start: number, inCode: (offset: number) => boolean) {
  const choices: Choice[] = [];
  // Pair the choice tags first, so an outer opener never takes an inner closer. Only a top-level opener whose next tag
  // is its closer is an option: nested choices are not the mod's flat option grammar, and that markup stays literal.
  // Choice tags quoted in code are text (grammar 2).
  const marks = [...part.text.matchAll(/<choice(?: recommended)?>|<\/choice>/g)].filter((mark) => !inCode(start + mark.index));
  const opens: number[] = [];
  const flat: [RegExpExecArray, RegExpExecArray][] = [];
  for (let i = 0; i < marks.length; i++) {
    if (marks[i][0] !== '</choice>') opens.push(i);
    else if (opens.length) {
      const open = opens.pop()!;
      if (opens.length === 0 && i === open + 1) flat.push([marks[open], marks[i]]);
    }
  }
  let text = '';
  let from = 0;
  for (const [open, close] of flat) {
    const body = part.text.slice(open.index + open[0].length, close.index).trim();
    if (body) choices.push({ text: body, recommended: open[0] !== '<choice>' });
    text += part.text.slice(from, open.index);
    from = close.index + close[0].length;
    if (part.text[from] === '\n') from++;
  }
  part.text = text + part.text.slice(from);
  if (choices.length) part.choices = choices;
}
