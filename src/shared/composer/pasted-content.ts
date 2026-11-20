// Pasted content on the wire (C6 execution document, *Pasted content* under Derivation; C7's contract, C6-owned by the
// ordering ruling because C6 merges first). The terminal wraps a pasted block past its threshold in these tags before
// sending; the engine's own parser (`cli.pretty.js` `vmt`) recognises exactly this grammar. C6 extracts the blocks
// into text attachments when it derives the user row; C7 frames them on send and neutralises a typed `<pasted_content`.
export const PASTED_BLOCK = /\n{0,2}<pasted_content id="([0-9a-f]{4})">\n([\s\S]*?)\n<\/pasted_content id="\1">\n{0,2}/g;

// The n-th block's place in the user row's text.
export const pastedPlaceholder = (n: number, lines: number) => `[Pasted text #${n} +${lines} lines]`;
export const PASTED_PLACEHOLDER = /\[Pasted text #(\d+) \+\d+ lines\]/g;

// Frames a body the way the terminal does, for tests and C7's send path.
export const framePasted = (id: string, body: string) => `<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">`;

/** One pasted block as `PASTED_BLOCK` finds it: where its match starts, the match (the newlines around the tags it
 *  takes included), the tags' id and the body. */
export interface PastedSegment {
  index: number;
  match: string;
  id: string;
  body: string;
}

/**
 * The pasted blocks of `text`, in order, exactly as `text.matchAll(PASTED_BLOCK)` finds them, in work linear in the
 * text's length (board ticket 734). The pattern pairs an opening tag with its closing tag through a lazy run and a
 * back-reference, so each opening tag of a text that never closes it scans to the text's end. Here every closing tag is
 * found in one pass, and each id's closing tags are passed once as the opening tags move forward. `work.steps` counts
 * the characters the searches pass and the closing tags passed.
 */
export function pastedSegments(text: string, work: { steps: number } = { steps: 0 }): PastedSegment[] {
  const OPEN = '<pasted_content id="';
  const CLOSE = '\n</pasted_content id="';
  const isId = (at: number) => /^[0-9a-f]{4}$/.test(text.slice(at, at + 4));
  const search = (needle: string, from: number): number => {
    const at = text.indexOf(needle, from);
    work.steps += (at === -1 ? text.length : at) - from;
    return at;
  };
  const closings = new Map<string, number[]>(); // the place of each closing tag's newline, by id, in order
  for (let at = search(CLOSE, 0); at !== -1; at = search(CLOSE, at + 1)) {
    const tag = at + CLOSE.length;
    if (!isId(tag) || !text.startsWith('">', tag + 4)) continue;
    const id = text.slice(tag, tag + 4);
    const ends = closings.get(id);
    if (ends === undefined) closings.set(id, [at]);
    else ends.push(at);
  }
  const passed = new Map<string, number>();
  const segments: PastedSegment[] = [];
  let from = 0; // a match starts at or after the previous one's end
  for (let at = search(OPEN, 0); at !== -1; ) {
    const tag = at + OPEN.length;
    const id = text.slice(tag, tag + 4);
    const ends = isId(tag) && text.startsWith('">\n', tag + 4) ? closings.get(id) : undefined;
    const body = tag + 7;
    let k = ends === undefined ? 0 : (passed.get(id) ?? 0);
    while (ends !== undefined && k < ends.length && ends[k]! < body) {
      work.steps += 1;
      k += 1;
    }
    if (ends !== undefined) passed.set(id, k);
    if (ends === undefined || k === ends.length) {
      at = search(OPEN, at + 1);
      continue;
    }
    const close = ends[k]!;
    let start = at;
    while (start > from && at - start < 2 && text[start - 1] === '\n') start -= 1;
    let end = close + CLOSE.length + 6;
    for (let n = 0; n < 2 && text[end] === '\n'; n += 1) end += 1;
    segments.push({ index: start, match: text.slice(start, end), id, body: text.slice(body, close) });
    from = end;
    at = search(OPEN, end);
  }
  return segments;
}

/** `text` with each pasted block (as `pastedSegments` finds them) replaced by what `replace` makes of it. */
export function replacePasted(text: string, replace: (segment: PastedSegment) => string): string {
  let out = '';
  let from = 0;
  for (const segment of pastedSegments(text)) {
    out += text.slice(from, segment.index) + replace(segment);
    from = segment.index + segment.match.length;
  }
  return out + text.slice(from);
}
