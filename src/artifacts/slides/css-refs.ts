// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M1 fix wave 3): the references CSS text makes, read
// by a tokenizer that follows CSS Syntax Level 3 §4 (https://www.w3.org/TR/css-syntax-3/#tokenization) for everything
// a reference can hide in: comments, strings with their escapes and line continuations, ident sequences and function
// names with escapes, unquoted `url(` tokens (and bad ones), at-keywords. Numbers and punctuation are passed over a
// code point at a time, which never starts any of those. The svg check (parse.ts) holds a slide on any reference that
// is not a local `#id`; matching raw spellings let escapes and continuations through.

export type CssRef =
  | { kind: 'url'; value: string } // a url( token's value, a url("…") function's string or @import's string
  | { kind: 'bad-url' } // a url( token the tokenizer could not read: nothing a browser would fetch, but not provably local
  | { kind: 'import' } // an @import, whatever it names
  | { kind: 'image-function'; name: string }; // image-set(), image(), src(): they take URLs in strings

type Tok =
  | { t: 'ws' }
  | { t: 'string'; value: string }
  | { t: 'url'; value: string }
  | { t: 'bad-url' }
  | { t: 'function'; name: string }
  | { t: 'at'; name: string }
  | { t: 'other' };

const isNewline = (c: string | undefined) => c === '\n';
const isWhitespace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n';
const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const isIdentStart = (c: string | undefined) => c !== undefined && (/^[A-Za-z_]$/.test(c) || c.codePointAt(0)! >= 0x80);
const isIdent = (c: string | undefined) => isIdentStart(c) || (c !== undefined && /^[0-9-]$/.test(c));
/** §4.2: U+0000–U+0008, U+000B, U+000E–U+001F, U+007F. */
const isNonPrintable = (c: string | undefined) => {
  const cp = c?.codePointAt(0);
  return cp !== undefined && (cp <= 0x08 || cp === 0x0b || (cp >= 0x0e && cp <= 0x1f) || cp === 0x7f);
};

/** §3.3 preprocessing: CR LF, CR and FF become LF; NUL becomes U+FFFD. */
function preprocess(css: string): string[] {
  return [...css.replace(/\r\n?|\f/g, '\n')].map((c) => (c === String.fromCharCode(0) ? '\ufffd' : c));
}

/** Every token of CSS text (§4.3.1), reduced to what references are made of. */
function tokenize(css: string): Tok[] {
  const s = preprocess(css);
  let i = 0;
  const out: Tok[] = [];
  const validEscape = (a: string | undefined, b: string | undefined) => a === '\\' && !isNewline(b) && b !== undefined;
  const startsIdent = (a: string | undefined, b: string | undefined, c: string | undefined) =>
    a === '-' ? isIdentStart(b) || b === '-' || validEscape(b, c) : isIdentStart(a) || validEscape(a, b);
  // §4.3.7, after the backslash
  const escape = (): string => {
    const c = s[i];
    if (c === undefined) return '\ufffd';
    if (!isHex(c)) {
      i++;
      return c;
    }
    let hex = '';
    while (hex.length < 6 && isHex(s[i])) hex += s[i++];
    if (isWhitespace(s[i])) i++;
    const cp = parseInt(hex, 16);
    return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\ufffd' : String.fromCodePoint(cp);
  };
  // §4.3.11
  const identSequence = (): string => {
    let name = '';
    for (;;) {
      if (isIdent(s[i])) name += s[i++];
      else if (validEscape(s[i], s[i + 1])) {
        i++;
        name += escape();
      } else return name;
    }
  };
  // §4.3.5: a bad string (an unescaped newline) ends where the newline is
  const string = (quote: string): Tok => {
    let value = '';
    for (;;) {
      const c = s[i];
      if (c === undefined) return { t: 'string', value };
      if (c === quote) {
        i++;
        return { t: 'string', value };
      }
      if (isNewline(c)) return { t: 'other' };
      if (c === '\\') {
        i++;
        if (s[i] === undefined) continue;
        if (isNewline(s[i])) {
          i++; // a line continuation: nothing
          continue;
        }
        value += escape();
        continue;
      }
      value += c;
      i++;
    }
  };
  // §4.3.14, the remnants of a bad url
  const badUrlRemnants = () => {
    for (;;) {
      const c = s[i];
      if (c === undefined) return;
      i++;
      if (c === ')') return;
      if (validEscape(c, s[i])) escape();
    }
  };
  // §4.3.6, after `url(` and its whitespace
  const url = (): Tok => {
    let value = '';
    for (;;) {
      const c = s[i];
      if (c === undefined) return { t: 'url', value };
      if (c === ')') {
        i++;
        return { t: 'url', value };
      }
      if (isWhitespace(c)) {
        while (isWhitespace(s[i])) i++;
        if (s[i] === undefined) return { t: 'url', value };
        if (s[i] === ')') {
          i++;
          return { t: 'url', value };
        }
        badUrlRemnants();
        return { t: 'bad-url' };
      }
      if (c === '"' || c === "'" || c === '(' || isNonPrintable(c)) {
        badUrlRemnants();
        return { t: 'bad-url' };
      }
      if (c === '\\') {
        if (validEscape(c, s[i + 1])) {
          i++;
          value += escape();
          continue;
        }
        badUrlRemnants();
        return { t: 'bad-url' };
      }
      value += c;
      i++;
    }
  };
  // §4.3.4
  const identLike = (): Tok => {
    const name = identSequence();
    if (s[i] !== '(') return { t: 'other' };
    i++;
    if (name.toLowerCase() !== 'url') return { t: 'function', name };
    while (isWhitespace(s[i]) && isWhitespace(s[i + 1])) i++;
    const next = isWhitespace(s[i]) ? s[i + 1] : s[i];
    if (next === '"' || next === "'") return { t: 'function', name };
    while (isWhitespace(s[i])) i++;
    return url();
  };
  while (i < s.length) {
    const c = s[i]!;
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*', i + 2);
      let j = end;
      while (j !== -1 && s[j + 1] !== '/') j = s.indexOf('*', j + 1);
      i = j === -1 ? s.length : j + 2;
    } else if (isWhitespace(c)) {
      while (isWhitespace(s[i])) i++;
      out.push({ t: 'ws' });
    } else if (c === '"' || c === "'") {
      i++;
      out.push(string(c));
    } else if (c === '@' && startsIdent(s[i + 1], s[i + 2], s[i + 3])) {
      i++;
      out.push({ t: 'at', name: identSequence() });
    } else if (startsIdent(c, s[i + 1], s[i + 2])) {
      out.push(identLike());
    } else {
      i++;
      out.push({ t: 'other' });
    }
  }
  return out;
}

const IMAGE_FUNCTIONS = new Set(['image', 'image-set', '-webkit-image-set', 'src']);

/** The references CSS text makes: every URL it names, every @import and every image function. */
export function cssRefs(css: string): CssRef[] {
  const tokens = tokenize(css);
  const refs: CssRef[] = [];
  const nextString = (from: number) => {
    let j = from;
    while (tokens[j]?.t === 'ws') j++;
    const tok = tokens[j];
    return tok?.t === 'string' ? tok.value : null;
  };
  tokens.forEach((tok, k) => {
    if (tok.t === 'url') refs.push({ kind: 'url', value: tok.value });
    else if (tok.t === 'bad-url') refs.push({ kind: 'bad-url' });
    else if (tok.t === 'function' && tok.name.toLowerCase() === 'url') refs.push({ kind: 'url', value: nextString(k + 1) ?? '' });
    else if (tok.t === 'function' && IMAGE_FUNCTIONS.has(tok.name.toLowerCase())) refs.push({ kind: 'image-function', name: tok.name.toLowerCase() });
    else if (tok.t === 'at' && tok.name.toLowerCase() === 'import') {
      refs.push({ kind: 'import' });
      const named = nextString(k + 1);
      if (named !== null) refs.push({ kind: 'url', value: named });
    }
  });
  return refs;
}
