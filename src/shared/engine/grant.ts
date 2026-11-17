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

// The folded stream's codes beyond a letter's ASCII one, and the classes of a character the two readings below and the
// composer writer's (`foldedStream`) share
const IS_LETTER = /^[\p{L}\p{N}]$/u;
const MARK = /\p{M}/uy; // a combining mark: after a span's first letter it stays with it (the joiner goes after it); after a `>` it composes
const OTHER_LETTER = -1; // a letter or digit beyond ASCII, which ends every beginning
const OPEN = -2; // `<`, or a character that folds to it
const CLOSE = -3; // `>` as typed
const FOLDED_CLOSE = -4; // a character that folds to `>` (the full-width one)

// The reading at board ticket 711 and ticket 675: the whole text folded at once (NFKC, then lower case), each pair a `<`
// up to the first `>` after it, read both ways. Ticket 733a keeps it whole beside the wider reading, so that every text
// it answered true for is answered true by construction.
function readsWhole(text: string, work?: { steps: number }): boolean {
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

// Ticket 733a (its document, Design 1): the composer writer's reading (`neutraliseGrant`'s, below), read forwards for the
// opening. Each character folded by itself, in one case image; a pair is any `<` (or a character that folds to it) up to
// any later `>` with no typed `>` between them, so a `>` a combining mark follows, or one that folds to `>`, closes
// without ending the `<`s before it. When `spans` is given, each partly read beginning carries the place its first
// letter began (the earliest, where readings meet), and each place a reading ends adds its range; else the first such
// place answers. Charged a step a code unit, one for each code a character beyond ASCII folds to, and, when it tells
// places, one for each beginning a letter moves on or a bracket carries. It also answers whether it read a character
// beyond ASCII: when it read none, the other case image is the same stream and need not be read.
// Given an allowance, it stops before a character whose work could pass it (`spent`), so it never charges more.
// The most one character can cost a pass: its code units (2), and for each code its fold gives (at most 18, U+FDFA) a
// step and, telling places, the beginnings it moves on or carries (at most 19, every one but the empty one).
const CHAR_PASS_WORK_MAX = 2 + 18 * 20;
// The most compatibility folding and lower-casing together lengthen a text, a code unit: 18 (U+FDFA). Folding the whole
// text is no longer than its full decomposition, which U+FDFA lengthens most, and lower-casing lengthens no decomposed
// letter (U+0130, the one it lengthens, decomposes to I and a mark). The whole-text reading charges at most the text's
// length and twice its fold's.
const FOLD_GROWTH_MAX = 18;
const BEGAN = new Int32Array(FOLDED_GRANT.length); // the reading so far: by its count of letters, where it began
const SAVED_BEGAN = new Int32Array(FOLDED_GRANT.length); // the same, for the readings the `<`s since the last typed `>` saved
type Spans = [from: number, to: number][];
function readsOpening(text: string, image: 'lower' | 'upper', spans: Spans | null, work?: { steps: number }, allowance = Infinity): { found: boolean; wide: boolean; spent: boolean } {
  let reached = 1;
  let saved = 0;
  let wide = false;
  let steps = 0;
  let found = false;
  let spent = false;
  // the readings `from` holds join `into`, each beginning at the earlier of the two places
  const join = (into: number, intoBegan: Int32Array, from: number, fromBegan: Int32Array): number => {
    if (spans !== null) {
      for (let bits = from & ~1; bits !== 0; bits &= bits - 1) {
        const k = 31 - Math.clz32(bits & -bits);
        intoBegan[k] = (into & (1 << k)) !== 0 ? Math.min(intoBegan[k]!, fromBegan[k]!) : fromBegan[k]!;
        steps += 1;
      }
    }
    return into | from;
  };
  // one code of the folded stream, from the character at [at, end)
  const read = (code: number, at: number, end: number): boolean => {
    if (code === OPEN) saved = join(saved, SAVED_BEGAN, reached, BEGAN);
    else if (code === CLOSE) {
      reached = join(reached, BEGAN, saved, SAVED_BEGAN);
      saved = 0;
    } else if (code === FOLDED_CLOSE) reached = join(reached, BEGAN, saved, SAVED_BEGAN);
    else if (code === OTHER_LETTER) reached = 1;
    else {
      const moved = reached & AT[code]!;
      if ((moved & WHOLE) !== 0) {
        found = true;
        if (spans === null) return true;
        spans.push([BEGAN[FOLDED_GRANT.length - 1]!, end]);
      }
      if (spans !== null) {
        // from the longest down, so each beginning moves on before the one below it takes its place
        for (let bits = moved & ~WHOLE; bits !== 0; ) {
          const k = 31 - Math.clz32(bits);
          BEGAN[k + 1] = k === 0 ? at : BEGAN[k]!;
          bits &= ~(1 << k);
          steps += 1;
        }
      }
      reached = 1 | ((moved & ~WHOLE) << 1);
    }
    return false;
  };
  let i = 0;
  while (i < text.length) {
    if (steps + CHAR_PASS_WORK_MAX > allowance) {
      spent = true; // the next character could pass the allowance: stop before it
      break;
    }
    const point = text.codePointAt(i)!;
    const end = i + (point > 0xffff ? 2 : 1);
    steps += end - i;
    if (point < 128) {
      const c = point >= 0x41 && point <= 0x5a ? point + 0x20 : point;
      let code: number | null = null;
      if (isAsciiLetter(c)) code = c;
      else if (c === 0x3c) code = OPEN;
      else if (c === 0x3e) {
        MARK.lastIndex = end;
        code = MARK.test(text) ? FOLDED_CLOSE : CLOSE;
      }
      if (code !== null && read(code, i, end)) break;
    } else {
      wide = true;
      const compatible = String.fromCodePoint(point).normalize('NFKC');
      let stop = false;
      for (const char of image === 'lower' ? compatible.toLowerCase() : compatible.toUpperCase().toLowerCase()) {
        steps += 1;
        const c = char.codePointAt(0)!;
        const code = c < 128 ? (isAsciiLetter(c) ? c : c === 0x3c ? OPEN : c === 0x3e ? FOLDED_CLOSE : null) : IS_LETTER.test(char) ? OTHER_LETTER : null;
        if (code !== null && read(code, i, end)) {
          stop = true;
          break;
        }
      }
      if (stop) break;
    }
    i = end;
  }
  if (work) work.steps += steps;
  return { found, wide, spent };
}

/**
 * The most `quotesGrant` charges, a character of the longer of a text and its compatibility fold (NFKC): the bound the
 * own-text rule plans each call of the forms' list by (src/shared/files/named.ts). Counted over every code point, each
 * repeated (the landing's M1, fix wave 1): U+0130 costs 11, its fold one character that lower-casing makes two (the
 * whole-text reading 5, each case image's pass 3); the Greek letters an upper-casing makes three cost 9; the sharp s 8;
 * every other character less; the count is a sum over the text's characters.
 */
export const GRANT_TEST_WORK_PER_CHAR = 11;

/**
 * Whether a string quotes the grant's opening, in any reading of it: the one test the ask tool's guard
 * (src/engine-host/tool-server/ask.ts), the steer's writer (src/shared/maws/ask.ts), the save rule's list of forms
 * (./composed-forms.ts), `nameSlot` and the leave-out of content (./composed-content.ts) all call. Two readings, either
 * of which answers: the whole text folded at once (board ticket 711), and, since ticket 733a, the composer writer's
 * reading (`neutraliseGrant`'s: each character folded by itself in both case images, any `<` to any later `>` with no
 * typed `>` between, a `>` a combining mark follows closing without ending). Each is one pass over the string, whatever
 * its number of bracket pairs. What it does not claim: a paraphrase of the grant, words put between the opening's words
 * by any means other than a pair of angle brackets (an entity, a link's target, a parenthesis), or letters of another
 * script that look alike. The steer's writer is the boundary (it writes no text the model wrote); this test is the second
 * layer. `work`, when given, is charged the characters the readings go over, the count a test pins its linearity by.
 */
export function quotesGrant(text: string, work?: { steps: number }): boolean {
  if (readsWhole(text, work)) return true;
  const lower = readsOpening(text, 'lower', null, work);
  return lower.found || (lower.wide && readsOpening(text, 'upper', null, work).found);
}

// Two lists of ranges, each in order of their ends, merged into one in order of the ends, one range for each end from
// its earliest beginning
function byEnds(one: Spans, other: Spans): Spans {
  const out: Spans = [];
  let i = 0;
  let k = 0;
  while (i < one.length || k < other.length) {
    const next = k >= other.length || (i < one.length && one[i]![1] <= other[k]![1]) ? one[i++]! : other[k++]!;
    const last = out[out.length - 1];
    if (last !== undefined && last[1] === next[1]) last[0] = Math.min(last[0], next[0]);
    else out.push([next[0], next[1]]);
  }
  return out;
}

/**
 * Where `quotesGrant`'s reading stands (ticket 733a, Design 1): for each place a reading of the opening ends, the range
 * of the text from the earliest place a reading that ends there begins (its first letter) to that end, in the text's own
 * offsets, in order of their ends. Empty exactly when `quotesGrant` is false: one pass forward per case image, the two
 * lists merged by their ends, and, should only the whole-text reading find the opening (whose offsets are the folded
 * text's), the whole text as the one range.
 */
export function grantSpans(text: string, work?: { steps: number }): (readonly [from: number, to: number])[] {
  return grantSpansWithin(text, Infinity, work)!;
}

/**
 * `grantSpans` within an allowance of work: null, having charged at most the allowance, where the reading could pass it
 * (each pass stops before a character that could; the whole-text reading and the merge are begun only when their bound
 * fits what is left). The leave-out of content reads by it (./composed-content.ts).
 */
export function grantSpansWithin(text: string, allowance: number, work?: { steps: number }): (readonly [from: number, to: number])[] | null {
  const meter = { steps: 0 };
  const done = <T>(value: T): T => {
    if (work) work.steps += meter.steps;
    return value;
  };
  const lower: Spans = [];
  const read = readsOpening(text, 'lower', lower, meter, allowance);
  if (read.spent) return done(null);
  const upper: Spans = [];
  if (read.wide && readsOpening(text, 'upper', upper, meter, allowance - meter.steps).spent) return done(null);
  if (lower.length + upper.length === 0) {
    const bound = read.wide ? text.length * (1 + 2 * FOLD_GROWTH_MAX) : 3 * text.length;
    if (meter.steps + bound > allowance) return done(null);
    return done(readsWhole(text, meter) ? [[0, text.length]] : []);
  }
  if (meter.steps + lower.length + upper.length > allowance) return done(null);
  meter.steps += lower.length + upper.length;
  return done(byEnds(lower, upper));
}

/**
 * The characters that would break a name's one line (ticket 733a; the class U1c gave a mention): C0 (LF, CR and tab
 * among them), DEL, C1 (NEL among them), the line and paragraph separators. The one copy: the mention's writer
 * (renderer composer/editor/mention-text.ts) and `nameSlot` read it.
 */
export const LINE_OR_CONTROL = /[\p{Cc}\u2028\u2029]/u;
const LINES_OR_CONTROLS = new RegExp(LINE_OR_CONTROL.source, 'gu');

/** What stands where a name MAWS writes quotes the grant's opening (ticket 733a, §E). */
export const NAME_LEFT_OUT = '(a name left out by MAWS)';

/**
 * A name MAWS writes inside a sentence of its own (an agent's name, an anchor's label, a title, a path; ticket 733a,
 * Design 1): one line, every control character and line or paragraph separator made U+FFFD; and a name that quotes the
 * grant's opening left out whole, `NAME_LEFT_OUT` in its place. A name already slotted comes back as it is.
 */
export function nameSlot(name: string, work?: { steps: number }): string {
  const line = name.replace(LINES_OR_CONTROLS, '\ufffd');
  if (work) work.steps += name.length + 1;
  return quotesGrant(line, work) ? NAME_LEFT_OUT : line;
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
