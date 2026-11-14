// UX wave U2 (the U2a document, M3): Claude Desktop's secret scanner, ported whole for the short command's rule
// (short-command.ts), which imports two of its functions: `Vy` (exported as `Yy`, imported there as `c`) and `rb`
// (imported as `f`). App 5.1231.2, `web/app/v1/shared-192-w2LFB3Va.js:4565-5262`; each piece below names the one it
// ports by line. Its passes: the list of service tokens; a token behind a lone `-`; a token glued into a word behind a
// digit, `_`, `-` or an escape; a JWT behind a `.`; and the same passes again over the text with its invisible and
// unassigned characters taken out. A token found is hidden as bullets after its first eight characters.
//
// One substitution: Desktop tests for an invisible character through a cache of per-block tables (`xy` with `by`,
// :4752-4805); this tests the same expression directly, which answers the same for every text.

export const once = <T>(make: () => T): (() => T) => { // shared-0-Do3lTMSe.js:4797 (`F`, imported as `Un`)
  let value: T;
  let made = false;
  return () => {
    if (!made) { value = make(); made = true; }
    return value;
  };
};

// The characters Desktop treats as invisible or unsafe (shared-0-Do3lTMSe.js:25521 `z8`, imported as `Jn`)
// eslint-disable-next-line no-misleading-character-class -- Desktop's class as written: with the `u` flag each mark is a code point of its own
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\uFFFC\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}\uFDD0-\uFDEF\uFFFE\uFFFF\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}]/u;

// ---------------------------------------------------------------------------------------------------------------------
// The patterns

const NOT_AFTER = '(?<![A-Za-z0-9_-])'; // :4565 `Bv`
const ESCAPES = [String.raw`\\[bfnrt]`, String.raw`\\x[0-9A-Fa-f]{2}`, String.raw`\\u[0-9A-Fa-f]{4}`, '%[0-9A-Fa-f]{2}', '%25[0-9A-Fa-f]{2}']; // :4566 `Vv`
const SPACES = '\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000'; // :4573 `Hv`
const BLANKS = `\\t\\v\\f\\r\\n\\u2028\\u2029 ${SPACES}`; // :4574 `Uv`
const ANY_BLANKS = `[${BLANKS}]*`; // :4575 `Wv`
const DASHES = '-{4,5}'; // :4576 `Gv`
const LINE_SPACES = `[ \\t${SPACES}]*`; // :4577 `Kv`
const KEY_TAIL = RegExp(`PRIVATE${ANY_BLANKS}KEY(?:${ANY_BLANKS}BLOCK)?${LINE_SPACES}${DASHES}`); // :4578 `qv`
const KEY_BEGIN = RegExp(`${DASHES}${LINE_SPACES}BEGIN[A-Z0-9${BLANKS}]*${KEY_TAIL.source}`); // :4579 `Jv`
const KEY_END = RegExp(`${DASHES}${LINE_SPACES}END[A-Z0-9${BLANKS}]*${KEY_TAIL.source}`); // :4580 `Yv`
const NO_BEGIN = '(?![A-Za-z0-9_-]*----BEGIN)'; // :4581 `Xv`
const JWT = `eyJ[A-Za-z0-9_-]{10,}\\.(?:${NO_BEGIN}[A-Za-z0-9_-]*\\.(?!-?eyJ)${NO_BEGIN}[A-Za-z0-9_-]{10,}\\.(?!-?eyJ)${NO_BEGIN}[A-Za-z0-9_-]{10,}\\.(?!-?eyJ)(?:[A-Za-z0-9_]|-(?!---)){10,64}(?:(?![A-Za-z0-9_-]*----)[A-Za-z0-9_-]*)?|eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,})`; // :4582 `Zv`

interface Pattern { id: string; inWord?: true; regex: RegExp; trigger: string }
const PATTERNS: readonly Pattern[] = [ // :4583 `Qv`
  { id: 'anthropic', inWord: true, regex: RegExp(`${NOT_AFTER}sk-ant-[A-Za-z0-9_-]{20,}`), trigger: 'sk-ant-' },
  { id: 'openai_proj', inWord: true, regex: RegExp(`${NOT_AFTER}sk-(?:proj|svcacct|admin|None)-[A-Za-z0-9_-]{20,}`), trigger: 'sk-(?:proj|svcacct|admin|None)-' },
  { id: 'openai', regex: RegExp(`${NOT_AFTER}sk-[A-Za-z0-9]{20,}`), trigger: 'sk-[A-Za-z0-9]{20}' },
  { id: 'github', inWord: true, regex: RegExp(`${NOT_AFTER}(?:(?:gh[opsu]_|github_pat_)[A-Za-z0-9_]{20,}|ghr_[A-Za-z0-9]{20,})`), trigger: 'gh[oprsu]_|github_pat_' },
  { id: 'aws', inWord: true, regex: RegExp(`${NOT_AFTER}AKIA[A-Z0-9]{16}`), trigger: 'AKIA' },
  { id: 'slack', inWord: true, regex: RegExp(`${NOT_AFTER}(?:xox[abceprs]-[A-Za-z0-9-]{10,}|xapp-[0-9]-[A-Z0-9]{1,20}-[0-9]{1,20}-[A-Za-z0-9]{10,})`), trigger: 'xox[abceprs]-|xapp-[0-9]-' },
  { id: 'google', inWord: true, regex: RegExp(`${NOT_AFTER}AIza[A-Za-z0-9_-]{35}`), trigger: 'AIza' },
  { id: 'stripe', inWord: true, regex: RegExp(`${NOT_AFTER}(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}`), trigger: '[sr]k_(?:live|test)_[A-Za-z0-9]{20}' },
  { id: 'stripe_webhook', inWord: true, regex: RegExp(`${NOT_AFTER}whsec_[A-Za-z0-9]{20,}`), trigger: 'whsec_[A-Za-z0-9]{20}' },
  { id: 'age', inWord: true, regex: RegExp(`${NOT_AFTER}AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}`), trigger: 'AGE-SECRET-KEY-1' },
  { id: 'gitlab', inWord: true, regex: RegExp(`${NOT_AFTER}gl(?:pat|dt)-[A-Za-z0-9_-]{20,}`), trigger: 'gl(?:pat|dt)-' },
  { id: 'jwt', regex: RegExp(`${NOT_AFTER}${JWT}`), trigger: '\\.eyJ|(?:^|[^A-Za-z0-9_-])-?eyJ[A-Za-z0-9_-]{10,}\\.' },
  { id: 'private_key', regex: RegExp(`${KEY_BEGIN.source}[A-Za-z0-9+/=$\\\\\\r\\n\\u2028\\u2029${SPACES}]{0,5000}?${KEY_END.source}`), trigger: KEY_TAIL.source },
];
const ANY_PATTERN = PATTERNS.map((pattern) => `(?:${pattern.regex.source})`).join('|'); // :4662 `$v`
const afterGuard = (pattern: Pattern) => pattern.regex.source.slice(NOT_AFTER.length);
const GUARDED = PATTERNS.filter(({ regex }) => regex.source.startsWith(NOT_AFTER)).map((pattern) => `(?:${afterGuard(pattern)})`); // :4663 `ey`
const AFTER_DASH = `(?<=${NOT_AFTER}-)(?:${GUARDED.join('|')})`; // :4666 `ty`
const AFTER_DOT_JWT = `(?<=\\.)(?=(${JWT}))`; // :4667 `ny`
const KEY_MARK = /(?<!-)-{4,}(?=BEGIN|END|$)|PRIVATE/; // :4668 `ry`
const IN_WORD = `(?<![^0-9_-]${ESCAPES.map((escape) => `(?<!${escape})`).join('')})(?:${PATTERNS.filter( // :4669 `iy`
  (pattern) => pattern.inWord === true && pattern.regex.source.startsWith(NOT_AFTER),
).map(afterGuard).join('|')})|(?:${ESCAPES.join('|')})(?<jwt>${JWT})`;
const TRIGGER = new RegExp(PATTERNS.map((pattern) => `(?:${pattern.trigger})`).join('|')); // :4674 `ay`
const ESCAPED_JWT = once(() => RegExp(`(?:${ESCAPES.join('|')})eyJ[A-Za-z0-9_-]{10,}\\.`)); // :4675 `oy`
const mayHoldToken = (text: string) => TRIGGER.test(text) || (text.includes('eyJ') && ESCAPED_JWT().test(text)); // :4676 `sy`
const MAX_SCAN = 262144; // :4744 `dy`
// eslint-disable-next-line no-misleading-character-class -- Desktop's class as written: with the `u` flag each mark is a code point of its own
const INVISIBLE = once(() => new RegExp(String.raw`(?![\t\n\r])${UNSAFE.source}|[\p{M}\p{Co}\p{Cn}]`, 'u')); // :4745 `fy`
const invisible = (char: string) => INVISIBLE().test(char); // :4746 `py`
const INVISIBLE_RUN = once(() => RegExp(`(?:${INVISIBLE().source}){1,65536}`, 'gu')); // :4749 `my`
const NOT_PRINTABLE = /[^\t\n\r\x20-\x7E]/; // :4750 `hy`
const TOKEN_START = RegExp(`^(?:${GUARDED.concat(KEY_BEGIN.source).join('|')})`); // :4806 `Sy`
const LOOKAHEAD = 512; // :4807 `Cy`
const JWT_START = /^eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){0,2}$/; // :4808 `wy`
const WORD_CHAR = /[A-Za-z0-9_-]/; // :4809 `Ty`
const WORD_REST = /(?:[A-Za-z0-9_]|(?<=[A-Za-z0-9_])-(?=[A-Za-z0-9_]))*/y; // :4810 `Ey`
const BLANK = RegExp(`[${BLANKS}]`); // :4811 `Dy`
const KEY_REST = RegExp(`^[${BLANKS}]*KEY(?:[${BLANKS}]*BLOCK)?${LINE_SPACES}-{4}`); // :4852 `Ay`
const KEY_REST_CUT = RegExp(`^[${BLANKS}]*(?:K|KE|KEY[${BLANKS}]*(?:B|BL|BLO|BLOC|BLOCK)?${LINE_SPACES}-{0,3})?$`); // :4853 `jy`
const KEY_WINDOW = 64; // :4854 `My`
const BACK_REACH = 6; // :4855 `Ny`
const GLUED_PREFIX = 15; // :4865 `Iy`
const SEPARATOR = '\0'; // :4903 `zy`

const patternOf = (value: string) => PATTERNS.find((pattern) => pattern.regex.test(value)); // :4741 `uy`

// ---------------------------------------------------------------------------------------------------------------------
// The passes' helpers

// Past a glued token's end: capitals and digits, and lower case, `_` and `-` while only invisible characters came between;
// invisible characters and blanks are crossed (:4812 `Oy`)
function tokenReach(text: string, from: number): number {
  let onlyInvisible = true;
  let at = from;
  while (at < text.length) {
    const code = text.codePointAt(at) ?? 0;
    if ((code >= 65 && code <= 90) || (code >= 48 && code <= 57) || (onlyInvisible && ((code >= 97 && code <= 122) || code === 95 || code === 45))) {
      at += 1;
      continue;
    }
    const char = String.fromCodePoint(code);
    const isInvisible = invisible(char);
    if (!isInvisible && !BLANK.test(char)) break;
    onlyInvisible &&= isInvisible;
    at += char.length;
  }
  return at;
}
// Where `word` ends when it is spelt at `from`, invisible characters allowed between its letters; -1 when it is not (:4835 `ky`)
function spelt(text: string, from: number, word: string): number {
  let at = from;
  for (let i = 0; i < word.length; i += 1) {
    while (i > 0 && at < text.length) {
      const char = String.fromCodePoint(text.codePointAt(at) ?? 0);
      if (!NOT_PRINTABLE.test(char) || !invisible(char)) break;
      at += char.length;
    }
    if (text[at] !== word[i]) return -1;
    at += 1;
  }
  return at;
}
function wordEnd(text: string, from: number): number { // :4856 `Py`
  WORD_REST.lastIndex = from;
  WORD_REST.exec(text);
  return WORD_REST.lastIndex;
}
// Whether `PRIVATE` ending at `at` goes on into a key's header, or may when the text is cut (:4861 `Fy`)
function keyHeaderAt(text: string, at: number, final: boolean): boolean {
  const rest = text.slice(at, at + KEY_WINDOW).replace(INVISIBLE_RUN(), '');
  return KEY_REST.test(rest) || ((!final || at + KEY_WINDOW < text.length) && KEY_REST_CUT.test(rest));
}
// Whether the token at `start` is glued to fifteen characters of word before it (:4866 `Ly`)
function longGlued(text: string, start: number, first: boolean): boolean {
  let at = start;
  while (at > 0 && start - at < GLUED_PREFIX) {
    if ((text.charCodeAt(at - 1) !== 45 || text[at - 2] === '-' || text[at] === '-') && !/[A-Za-z0-9_]/.test(text[at - 1]) && !NOT_PRINTABLE.test(text[at - 1])) {
      return false;
    }
    at -= 1;
  }
  return start - at >= GLUED_PREFIX || !first;
}
// A glued token's end: before a run of four dashes that closes it (any run, when `anyRun`), else `end` (:4880 `Ry`)
function gluedEnd(text: string, start: number, end: number, anyRun = false): number {
  for (let i = start; i < end; i += 1) {
    if (text[i] !== '-') continue;
    let dashes = 0;
    let at = i;
    while (at < text.length) {
      const code = text.codePointAt(at) ?? 0;
      if (text[at] === '-') dashes += 1;
      else if (!invisible(String.fromCodePoint(code))) break;
      at += code > 65535 ? 2 : 1;
    }
    if (dashes >= 4 && (anyRun || !WORD_CHAR.test(text[at] ?? '') || spelt(text, at, 'BEGIN') >= 0 || spelt(text, at, 'END') >= 0)) return i;
    i = at - 1;
  }
  return end;
}

interface Found { index: number; value: string; added?: boolean }
// The passes over one text (:4680 `ly`); `final` is whether the text runs to the end, `first` whether it starts at the beginning
function* passes(text: string, final: boolean, first: boolean): Generator<Found> {
  for (const match of text.matchAll(new RegExp(ANY_PATTERN, 'g'))) yield { index: match.index, value: match[0] }; // `cy`
  for (const match of text.matchAll(new RegExp(AFTER_DASH, 'g'))) {
    const run = match[0].search(/(?<!-)-{4,}(?=BEGIN|END|$)/);
    yield { index: match.index, value: run < 0 ? match[0] : match[0].slice(0, run) };
  }
  let reach = -1;
  let keyAt = -1;
  let wordStop = -1;
  for (const match of text.matchAll(new RegExp(IN_WORD, 'g'))) {
    const token = match.groups?.jwt ?? match[0];
    const start = match.index + match[0].length - token.length;
    const end = match.index + match[0].length;
    if (end > reach) {
      reach = tokenReach(text, end);
      keyAt = -1;
      for (let at = start; at < reach; at += 1) {
        const after = text.charCodeAt(at) === 80 ? spelt(text, at, 'PRIVATE') : -1;
        if (after >= 0 && after <= reach && keyHeaderAt(text, after, final)) keyAt = at;
      }
    }
    let mayGoOn = false;
    if (!final && reach >= text.length) {
      if (end > wordStop) wordStop = wordEnd(text, end);
      mayGoOn = match.index - BACK_REACH >= text.length - 8192 || wordStop >= text.length;
    }
    if (keyAt >= start || mayGoOn) continue;
    yield { index: start, value: text.slice(start, gluedEnd(text, start, end, longGlued(text, start, first))), added: true };
  }
  if (text.includes('.eyJ')) {
    for (const match of text.matchAll(new RegExp(AFTER_DOT_JWT, 'g'))) {
      const code = text.codePointAt(match.index + match[1].length);
      const next = code === undefined ? '' : String.fromCodePoint(code);
      if ((next === '' ? final : !WORD_CHAR.test(next) && (!NOT_PRINTABLE.test(next) || !invisible(next))) && !KEY_MARK.test(match[1])) {
        yield { index: match.index, value: match[1] };
      }
    }
  }
}

// The text with its invisible runs taken out, a separator left where one sat between a word and a token's start in
// `shadow`; and the way back from an index in it to one in the text (:4904 `By`)
function withoutInvisible(text: string, shadow?: string) {
  let removedBefore = 0;
  const ends: number[] = [];
  const shifts: number[] = [];
  let shift = 0;
  let edges = 0;
  return {
    shadow: text.replace(INVISIBLE_RUN(), (run: string, at: number) => {
      const inShadow = at - removedBefore;
      removedBefore += run.length;
      const ahead = shadow !== undefined && at > 0 && WORD_CHAR.test(text[at - 1]) ? shadow.slice(inShadow, inShadow + LOOKAHEAD) : undefined;
      const kept = ahead !== undefined && (TOKEN_START.test(ahead) || (ahead.length === LOOKAHEAD && JWT_START.test(ahead))) ? SEPARATOR : '';
      edges += kept.length;
      ends.push(at - shift + kept.length);
      shift += run.length - kept.length;
      shifts.push(shift);
      return kept;
    }),
    edges,
    toRaw: (index: number) => {
      let low = 0;
      let high = ends.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (ends[mid] <= index) low = mid + 1;
        else high = mid;
      }
      return low === 0 ? index : index + shifts[low - 1];
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The scanner

interface Span { start: number; end: number; value: string; patternId: string; added: boolean; keep?: number }
interface Raw { start: number; end: number; patternId: string; added: boolean; inner?: number }

function scan(text: string, final: boolean, first = true): Span[] { // :4983 `Uy`
  if (text.length > MAX_SCAN) return [];
  const found: Raw[] = [];
  const add = (start: number, end: number, value: string, added = false) => {
    found.push({ start, end, patternId: patternOf(value)?.id ?? 'unknown', added });
  };
  if (mayHoldToken(text)) {
    for (const hit of passes(text, final, first)) add(hit.index, hit.index + hit.value.length, hit.value, hit.added);
  }
  if (INVISIBLE().test(text)) { // `xy`
    const again = (shadow?: string) => {
      const { shadow: bare, edges, toRaw } = withoutInvisible(text, shadow);
      if ((shadow === undefined || edges !== 0) && mayHoldToken(bare)) {
        for (const hit of passes(bare, final, first)) add(toRaw(hit.index), toRaw(hit.index + hit.value.length - 1) + 1, hit.value, hit.added);
      }
      return bare;
    };
    again(again());
  }
  found.sort((a, b) => a.start - b.start);
  const narrow = (span: Raw, at: number) => {
    if (span.added && at > span.start) span.inner = Math.min(span.inner ?? at, at);
  };
  const merged: Raw[] = [];
  for (const span of found) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start < last.end) {
      narrow(last, span.start);
      last.end = Math.max(last.end, span.end);
    } else merged.push({ ...span });
  }
  const spans: Raw[] = [];
  let covered = 0;
  for (const span of merged) {
    const last = spans[spans.length - 1];
    if (last !== undefined && span.start < covered) {
      narrow(last, span.start);
      last.end = span.end;
    } else {
      if (last !== undefined) last.end = Math.max(last.end, covered);
      spans.push(span);
    }
    const current = spans[spans.length - 1];
    if (current.patternId === 'private_key') covered = current.end;
    else if (current.end >= covered) {
      WORD_REST.lastIndex = current.end;
      covered = current.end + (WORD_REST.exec(text)?.[0].length ?? 0);
    }
  }
  const tail = spans[spans.length - 1];
  if (tail !== undefined) tail.end = Math.max(tail.end, covered);
  return spans.map(({ start, end, patternId, added, inner }) => ({
    start, end, value: text.slice(start, end), patternId, added, ...(inner === undefined ? {} : { keep: inner - start }),
  }));
}

// Every token in a text (:4942 `Vy`, which also drops each span's `added`; nothing reads it after the scan)
export function secretSpans(text: string): Span[] {
  return scan(text, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// Hiding what it finds

const SHOWN_PREFIX = 8; // :5069 `Wy`
const BEGIN = '-----BEGIN'; // :5070 `Gy`
const END = '-----END'; // :5071 `Ky`
const END_TAIL = /^[^-]*(?:-[^A-Za-z0-9]*)?$/; // :5072 `qy`
function headerEnd(key: string): number { // :5073 `Jy`
  const unseen = INVISIBLE();
  let dashes = 0;
  for (let at = 10; at < key.length;) {
    const char = String.fromCodePoint(key.codePointAt(at) ?? 0);
    if (char === '-') {
      dashes += 1;
      if (dashes === 5) return at + 1;
    } else if (!unseen.test(char)) {
      if (dashes === 4) return at;
      dashes = 0;
    }
    at += char.length;
  }
  return -1;
}
const bullets = (text: string) => text.split('\n').map((line) => '•'.repeat(line.length)).join('\n'); // :5093 `Yy`
// One token hidden: a key but for its header and footer, else all but its first eight visible characters, all of a short
// one; never past `keep` (:5103 `Xy`)
function hidden(token: string, keep = Infinity): string {
  const limit = Math.max(0, keep);
  if (token.startsWith(BEGIN)) {
    const footer = token.lastIndexOf(END);
    const bodyEnd = footer >= 0 && END_TAIL.test(token.slice(footer + 8)) ? footer : token.length;
    const header = headerEnd(token);
    const bodyStart = header >= 0 && header <= bodyEnd ? header : 10;
    return withSecretsHidden(token.slice(0, bodyStart)) + bullets(token.slice(bodyStart, bodyEnd)) + withSecretsHidden(token.slice(bodyEnd));
  }
  if (!INVISIBLE().test(token)) {
    if (token.length <= 12) return bullets(token);
    const shown = Math.min(SHOWN_PREFIX, limit);
    return token.slice(0, shown) + bullets(token.slice(shown));
  }
  const unseen = INVISIBLE();
  let visible = 0;
  let afterPrefix = 0;
  let withinKeep = 0;
  for (let at = 0; at < token.length;) {
    const char = String.fromCodePoint(token.codePointAt(at) ?? 0);
    at += char.length;
    if (!unseen.test(char)) {
      visible += 1;
      if (visible === SHOWN_PREFIX) afterPrefix = at;
    }
    if (at <= limit) withinKeep = at;
  }
  if (visible <= 12) return bullets(token);
  const shown = Math.min(afterPrefix, withinKeep);
  return token.slice(0, shown) + bullets(token.slice(shown));
}
function replaced(text: string, spans: readonly Span[]): string { // :5209 `eb` (with `Xy`, as `rb` passes it)
  if (spans.length === 0) return text;
  let out = '';
  let at = 0;
  for (const span of spans) {
    out += text.slice(at, span.start) + hidden(span.value, span.keep);
    at = span.end;
  }
  return out + text.slice(at);
}
const CHUNK = 253952; // :5227, the step of `nb`'s chunks (`dy` less `tb`, :5221)

// A text with every token it holds hidden (:5261 `rb`, through `nb` :5222): a long one scanned in overlapping chunks
export function withSecretsHidden(text: string): string {
  if (text.length <= MAX_SCAN) return replaced(text, secretSpans(text));
  const found: Span[] = [];
  for (let from = 0; from < text.length; from += CHUNK) {
    for (const span of scan(text.slice(from, from + MAX_SCAN), from + MAX_SCAN >= text.length, from === 0)) {
      found.push({ ...span, start: from + span.start, end: from + span.end });
    }
  }
  found.sort((a, b) => a.start - b.start || Number(a.added) - Number(b.added) || a.end - b.end);
  const spans: Span[] = [];
  for (const span of found) {
    const last = spans[spans.length - 1];
    const afterKey = span.added && span.start === last?.end && last.patternId === 'private_key';
    if (last !== undefined && span.start <= last.end && !afterKey) {
      if (span.end > last.end) {
        last.end = span.end;
        last.value = text.slice(last.start, last.end);
      }
    } else spans.push({ ...span });
  }
  return replaced(text, spans);
}
