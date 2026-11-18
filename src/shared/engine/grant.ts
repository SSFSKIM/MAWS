// Board ticket 711: the consent sentence's opening and the one test of whether a string quotes it. A module of its own,
// importing nothing: the arrivals reader (./arrival.ts), the ask tool's guard (src/engine-host/tool-server/ask.ts) and the
// steer's writer (src/shared/maws/ask.ts, which the arrivals reader imports) all read it.

/**
 * The consent sentence's opening, the one definition (board ticket 711): the ask tool refuses an ask whose strings hold
 * it (src/engine-host/tool-server/ask.ts), so a model cannot put a grant before the person in an ask of its own.
 */
export const GRANT_OPENING = 'Permission granted for ';

/**
 * The consent sentence's next two words after the opening, for one call and for several (the engine's `Yn`; the U1c
 * review round's R1, the architect's ruling of 2026-11-17, UTC): the reader's sentence (`grantHead`, ./arrival.ts) is built
 * from them, and the writer (`neutraliseGrant`) breaks the opening only where one of them follows it, so the two cannot
 * drift apart.
 */
export const GRANT_ONE = 'this exact';
export const GRANT_SEVERAL = 'these exact';

// Board ticket 711: how a string is read. Letters and digits alone, after Unicode compatibility folding (NFKC: full-width
// letters and brackets, the no-break space) and case folding: Markdown's emphasis, code and strike marks, white space,
// zero-width characters and every other mark go. Each pair of angle brackets is read both ways by itself, whichever way
// the others are read: removed with its words (so a tag around a word does not hide the opening) and with its words
// kept (so words of the opening put inside a pair are not removed with it). A pair is a `<` that a later `>` closes,
// up to the first `>` after it: the pairs a split on /(<[^>]*>)/ cuts.
const FOLDED_GRANT = GRANT_OPENING.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// UX wave U6e (ticket 675): one pass over the string, in work linear by construction. The beginnings of the opening the
// letters read so far can end with are one bit each (bit k: the first k letters; bit 0 always), and each letter of the
// opening is the set of positions it stands at, so a letter moves every beginning at once, with nothing allocated.
const WHOLE = 1 << (FOLDED_GRANT.length - 1);
const AT = new Int32Array(128); // by ASCII code: the positions of the opening that letter stands at
for (let k = 0; k < FOLDED_GRANT.length; k += 1) {
  const code = FOLDED_GRANT.charCodeAt(k);
  AT[code] = AT[code]! | (1 << k);
}
const LETTER = /[\p{L}\p{N}]/uy; // a letter or digit beyond ASCII: it moves no beginning, and ends every one but 0
const isAsciiLetter = (c: number): boolean => (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a); // a digit or a letter, after the case folding

/**
 * Whether a string quotes the grant's opening, in any reading of it: the one test the ask tool's guard
 * (src/engine-host/tool-server/ask.ts) and the steer's writer (src/shared/maws/ask.ts) both call. One pass over the
 * string, whatever its number of bracket pairs, each character read once. What it does not claim: a paraphrase of the
 * grant, words put between the opening's words by any means other than a pair of angle brackets (an entity, a link's
 * target, a parenthesis), or letters of another script that look alike. The steer's writer is the boundary (it writes
 * no text the model wrote); this test is the second layer. `work`, when given, is charged the characters the reading
 * goes over (the folding, the search for the last `>` and the pass), the count a test pins its linearity by.
 */
export function quotesGrant(text: string, work?: { steps: number }): boolean {
  const s = text.normalize('NFKC').toLowerCase();
  const lastClose = s.lastIndexOf('>');
  let reached = 1; // the reading so far: with every pair before this point read both ways
  let before = 0; // inside a pair: the reading at its `<`, which the pair removed with its words leaves as it was
  let inPair = false;
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    let width = 1;
    if (c < 128) {
      if (inPair && c === 0x3e) {
        reached |= before; // the pair kept with its words, or removed: either reading goes on
        inPair = false;
      } else if (!inPair && c === 0x3c && i < lastClose) {
        before = reached;
        inPair = true;
      } else if (isAsciiLetter(c)) {
        const moved = reached & AT[c]!;
        if ((moved & WHOLE) !== 0) {
          if (work) work.steps += text.length + s.length + i + 1;
          return true;
        }
        reached = 1 | (moved << 1);
      }
    } else {
      const point = s.codePointAt(i)!;
      if (point > 0xffff) width = 2;
      LETTER.lastIndex = i;
      if (LETTER.test(s)) reached = 1;
    }
    i += width;
  }
  if (work) work.steps += text.length + s.length + s.length;
  return false;
}

/**
 * UX wave U1c, the one-writer rule in its neutralise form (the architect's rulings of 2026-11-16 and 2026-11-17, UTC): the
 * character `neutraliseGrant` puts inside the first word of every span that reads as the consent sentence's longer
 * opening. U+2060, the word joiner: no white space, no line break, no wrap point, and invisible; only its own removal can
 * give the opening back.
 */
export const GRANT_BREAK = '\u2060';

/**
 * The as-typed copy of a text that went on the wire (the review round's R3): every U+2060 removed, the writer's joiner
 * and one a person typed or pasted alike. The one helper every copy a person meets takes: recall, take-back, a bubble's
 * edit, the rewind's prefill, a first message handed back, the first-prompt title, a spawn's display text. For display,
 * search and prefill only: no consent reader reads its output (they read the wire or the row text).
 */
export function asTyped(text: string): string {
  return text.replaceAll(GRANT_BREAK, '');
}

/**
 * The writer's patterns, folded as `quotesGrant` folds (letters and digits only): the opening with "this exact" and with
 * "these exact" after it (the review round's R1). The refusing side keeps the short opening (`quotesGrant`); the writer
 * breaks only these, since the short one is everyday text (a file's name, an identifier, a prose line) and the reader
 * accepts no sentence without one of them.
 */
export const WRITER_OPENINGS: readonly string[] = [GRANT_ONE, GRANT_SEVERAL].map((next) => `${GRANT_OPENING}${next}`.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
// Each pattern read backwards, each letter the set of positions it stands at, as `AT` is for the opening read forwards: a
// pass from the text's end finds where each occurrence begins (its first letter), in every reading it reads. A pattern's
// positions are one bit each of a 32-bit word, so a pattern holds at most 31 letters (29 and 30 here).
const PATTERNS = WRITER_OPENINGS.map((pattern) => {
  if (pattern.length > 31) throw new Error(`a writer's pattern of ${pattern.length} letters does not fit the word`);
  const at = new Int32Array(128);
  for (let k = 0; k < pattern.length; k += 1) {
    const code = pattern.charCodeAt(pattern.length - 1 - k);
    at[code] = at[code]! | (1 << k);
  }
  return { at, whole: 1 << (pattern.length - 1) };
});
const IS_LETTER = /^[\p{L}\p{N}]$/u;
const MARK = /\p{M}/uy; // a combining mark after a span's first letter stays with it: the joiner goes after it
// the folded stream's codes beyond a letter's ASCII one
const OTHER_LETTER = -1; // a letter or digit beyond ASCII, which ends every beginning
const OPEN = -2; // `<`, or a character that folds to it
const CLOSE = -3; // `>` as typed
const FOLDED_CLOSE = -4; // a character that folds to `>` (the full-width one)

// The folded stream of a text, in one of the two case images (the review round's R2): each letter or digit (by its ASCII
// code, or OTHER_LETTER) and each angle bracket, with the end in the text of the character it came from. Each character
// is folded by itself: compatibility folding, then lower case (`lower`), or upper case then lower case (`upper`, where a
// sharp s gives "ss" and a dotless i gives "i", as a later upper-casing would). A `>` that a combining mark follows is a
// folded close, since compatibility folding of the whole text composes the two (U+0338 makes U+226F) and then the
// refusing side pairs the `<` with a later `>`.
function foldedStream(text: string, image: 'lower' | 'upper'): { codes: number[]; ends: number[] } {
  const codes: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < text.length) {
    const point = text.codePointAt(i)!;
    const end = i + (point > 0xffff ? 2 : 1);
    if (point < 128) {
      const c = point >= 0x41 && point <= 0x5a ? point + 0x20 : point;
      MARK.lastIndex = end;
      const code = isAsciiLetter(c) ? c : c === 0x3c ? OPEN : c === 0x3e ? (MARK.test(text) ? FOLDED_CLOSE : CLOSE) : null;
      if (code !== null) {
        codes.push(code);
        ends.push(end);
      }
    } else {
      const compatible = String.fromCodePoint(point).normalize('NFKC');
      for (const char of image === 'lower' ? compatible.toLowerCase() : compatible.toUpperCase().toLowerCase()) {
        const c = char.codePointAt(0)!;
        const code = c < 128 ? (isAsciiLetter(c) ? c : c === 0x3c ? OPEN : c === 0x3e ? FOLDED_CLOSE : null) : IS_LETTER.test(char) ? OTHER_LETTER : null;
        if (code !== null) {
          codes.push(code);
          ends.push(end);
        }
      }
    }
    i = end;
  }
  return { codes, ends };
}

/**
 * What MAWS sends as a person's own free text (the composer's serialised draft, its last step; the sites that send raw
 * text, theirs): the text with U+2060 (`GRANT_BREAK`) put inside the first word of every span that reads as the
 * consent sentence's longer opening (`WRITER_OPENINGS`), after its first letter (and that letter's combining marks).
 * The claim: no text the reader (`readConsents`) accepts goes out, as sent or after one of the later changes
 * test/support/later-changes.ts lists, and no wider: the whole text or each line trimmed; runs of white space, or of
 * spaces and tabs, collapsed; CRLF, a lone CR, U+2028 and U+2029 made LF; pasted tags removed; angle-bracket pairs
 * removed, before or after compatibility folding; emphasis and code marks removed; compatibility folding; upper case then
 * lower case with the opening capitalised; each line's first word upper-cased then capitalised. The reader accepts only
 * a sentence that opens with one of the two openings. The reading is `quotesGrant`'s (letters and digits, compatibility
 * and case folding), each character folded by itself in two case images (`foldedStream`), and the words from any `<` to
 * any later `>` with no `>` as typed between them (a `>` a combining mark follows is no such `>`) read both kept and
 * removed. Its limit: a precomposed letter (é for e), which only a later removal of marks would make the opening's
 * letter, is read as another letter. A span whose first letter the joiner already follows is left as it is, so a text
 * sent again does not grow; a text with no span is returned as it was. `work`, when given, is charged the characters the
 * passes go over.
 */
export function neutraliseGrant(text: string, work?: { steps: number }): string {
  // from the end, each pattern read backwards over each case image: at a `>`, the reading so far is one a `<` before it
  // may go on from, its words between removed (a `>` as typed ends what an earlier `>` saved, a folded one adds to it);
  // a first letter that ends a pattern read backwards begins a span
  const starts = new Set<number>();
  for (const image of ['lower', 'upper'] as const) {
    const { codes, ends } = foldedStream(text, image);
    for (const { at, whole } of PATTERNS) {
      let reached = 1;
      let saved = 0;
      for (let k = codes.length - 1; k >= 0; k -= 1) {
        const c = codes[k]!;
        if (c === CLOSE) saved = reached;
        else if (c === FOLDED_CLOSE) saved |= reached;
        else if (c === OPEN) reached |= saved;
        else if (c === OTHER_LETTER) reached = 1;
        else {
          const moved = reached & at[c]!;
          if ((moved & whole) !== 0) starts.add(ends[k]!);
          reached = 1 | (moved << 1);
        }
      }
    }
    if (work) work.steps += text.length + (1 + PATTERNS.length) * codes.length;
  }
  if (starts.size === 0) return text;
  let out = '';
  let from = 0;
  for (let at of [...starts].sort((a, b) => a - b)) {
    if (at <= from) continue; // one character's folding gave two first letters
    MARK.lastIndex = at;
    while (MARK.test(text)) at = MARK.lastIndex;
    if (text.startsWith(GRANT_BREAK, at)) continue;
    out += text.slice(from, at) + GRANT_BREAK;
    from = at;
  }
  if (work) work.steps += text.length;
  return from === 0 ? text : out + text.slice(from);
}
