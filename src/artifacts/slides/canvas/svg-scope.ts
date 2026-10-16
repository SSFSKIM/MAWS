// P3-C final fix wave B, finding B1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas", Decision Log
// 37 (3)): an svg drawn into a page shares the page's one stylesheet scope and its one id space, so its `<style>` would
// restyle the page (the loader admits any CSS that references nothing: `body{display:none!important}` loads) and its
// `#id`s would collide with every other drawing of it (the stage and its thumbnail, a version beside the live deck).
// Each drawing is contained in place, keeping the graphic as it draws standing alone (as an image, a file of its own):
//
// - its ids are renamed into the drawing's scope (`<scope>_<id>`), with every local reference to them: `url(#id)` in any
//   attribute, `style` or stylesheet, `href`/`xlink:href`, an animated `href`'s values, SMIL timing (`id.end`), IDREF
//   lists, and `#id` in selectors;
// - its stylesheets keep their style rules (and those inside `@media` and `@supports`), each compound of each selector
//   constrained to the drawing's own elements (`:where([data-svg-scope="…"], [data-svg-scope="…"] *)`, which adds no
//   specificity), so no rule matches outside it; `@keyframes` are renamed into the scope with the `animation` names
//   that use them; every other at-rule (`@font-face`, `@property`, `@layer`, `@import`, …: each would be the page's) is
//   dropped.
//
// The stylesheet is read by a CSS Syntax §4 tokenizer (https://www.w3.org/TR/css-syntax-3/#tokenization) and its rules
// and blocks by §5's structure, so a rule ends where a browser ends it; tokens are written back as their source text but
// for the ones renamed. Portable (strings in, strings out; canvas/elements.ts walks a drawing's DOM with them): the
// export page can contain its drawings the same way.

export const SVG_SCOPE_ATTR = 'data-svg-scope';

/** One drawing's renames: its ids and its keyframes names, each to its scoped name. */
export interface SvgNames {
  scope: string;
  ids: ReadonlyMap<string, string>;
  keyframes: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------- the tokenizer (§4)

type Tok =
  | { t: 'ws' | 'cdo' | 'cdc' | 'colon' | 'semicolon' | 'comma' | 'bad-string' | 'bad-url' | 'number'; raw: string }
  | { t: '{' | '}' | '(' | ')' | '[' | ']'; raw: string }
  | { t: 'ident' | 'function' | 'at' | 'string' | 'url'; raw: string; value: string }
  | { t: 'hash'; raw: string; value: string; id: boolean }
  | { t: 'delim'; raw: string; value: string };

const isNewline = (c: string | undefined) => c === '\n';
const isWhitespace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n';
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const isIdentStart = (c: string | undefined) => c !== undefined && (/^[A-Za-z_]$/.test(c) || c.codePointAt(0)! >= 0x80);
const isIdent = (c: string | undefined) => isIdentStart(c) || isDigit(c) || c === '-';
const isNonPrintable = (c: string | undefined) => {
  const cp = c?.codePointAt(0);
  return cp !== undefined && (cp <= 0x08 || cp === 0x0b || (cp >= 0x0e && cp <= 0x1f) || cp === 0x7f);
};

function tokenize(css: string): Tok[] {
  const s = [...css.replace(/\r\n?|\f/g, '\n')].map((c) => (c === '\u0000' ? '\ufffd' : c));
  // an escape the text ends in reads as U+FFFD (§4.3.7): written so, nothing written after it can join it
  let tail = 0;
  while (s[s.length - 1 - tail] === '\\') tail++;
  if (tail % 2 === 1) s[s.length - 1] = '\ufffd';
  let i = 0;
  const out: Tok[] = [];
  const validEscape = (a: string | undefined, b: string | undefined) => a === '\\' && !isNewline(b);
  const startsIdent = (a: string | undefined, b: string | undefined, c: string | undefined) =>
    a === '-' ? isIdentStart(b) || b === '-' || validEscape(b, c) : isIdentStart(a) || validEscape(a, b);
  const startsNumber = (a: string | undefined, b: string | undefined, c: string | undefined) =>
    a === '+' || a === '-' ? isDigit(b) || (b === '.' && isDigit(c)) : a === '.' ? isDigit(b) : isDigit(a);
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
  const string = (quote: string): { t: 'string'; value: string } | { t: 'bad-string' } => {
    let value = '';
    for (;;) {
      const c = s[i];
      if (c === undefined) return { t: 'string', value };
      if (c === quote) {
        i++;
        return { t: 'string', value };
      }
      if (isNewline(c)) return { t: 'bad-string' };
      if (c === '\\') {
        i++;
        if (s[i] === undefined) continue;
        if (isNewline(s[i])) {
          i++;
          continue;
        }
        value += escape();
        continue;
      }
      value += c;
      i++;
    }
  };
  const badUrlRemnants = () => {
    for (;;) {
      const c = s[i];
      if (c === undefined) return;
      i++;
      if (c === ')') return;
      if (validEscape(c, s[i])) escape();
    }
  };
  const url = (): { t: 'url'; value: string } | { t: 'bad-url' } => {
    let value = '';
    while (isWhitespace(s[i])) i++;
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
  const number = () => {
    if (s[i] === '+' || s[i] === '-') i++;
    while (isDigit(s[i])) i++;
    if (s[i] === '.' && isDigit(s[i + 1])) {
      i++;
      while (isDigit(s[i])) i++;
    }
    if ((s[i] === 'e' || s[i] === 'E') && (isDigit(s[i + 1]) || ((s[i + 1] === '+' || s[i + 1] === '-') && isDigit(s[i + 2])))) {
      i += 2;
      while (isDigit(s[i])) i++;
    }
    if (startsIdent(s[i], s[i + 1], s[i + 2])) identSequence(); // a dimension
    else if (s[i] === '%') i++;
  };
  const SINGLE: Record<string, Tok['t']> = { ':': 'colon', ';': 'semicolon', ',': 'comma', '{': '{', '}': '}', '(': '(', ')': ')', '[': '[', ']': ']' };
  while (i < s.length) {
    const start = i;
    const c = s[i]!;
    const push = (tok: Record<string, unknown>) => out.push({ ...tok, raw: s.slice(start, i).join('') } as Tok);
    if (c === '/' && s[i + 1] === '*') {
      let j = i + 2;
      while (j < s.length && !(s[j] === '*' && s[j + 1] === '/')) j++;
      i = Math.min(s.length, j + 2);
      // a comment is no token; whitespace keeps what it separated apart
      out.push({ t: 'ws', raw: ' ' });
    } else if (isWhitespace(c)) {
      while (isWhitespace(s[i])) i++;
      push({ t: 'ws' });
    } else if (c === '"' || c === "'") {
      i++;
      push(string(c));
    } else if (c === '#' && (isIdent(s[i + 1]) || validEscape(s[i + 1], s[i + 2]))) {
      i++;
      const id = startsIdent(s[i], s[i + 1], s[i + 2]);
      push({ t: 'hash', value: identSequence(), id });
    } else if (startsNumber(c, s[i + 1], s[i + 2])) {
      number();
      push({ t: 'number' });
    } else if (c === '<' && s[i + 1] === '!' && s[i + 2] === '-' && s[i + 3] === '-') {
      i += 4;
      push({ t: 'cdo' });
    } else if (c === '-' && s[i + 1] === '-' && s[i + 2] === '>') {
      i += 3;
      push({ t: 'cdc' });
    } else if (c === '@' && startsIdent(s[i + 1], s[i + 2], s[i + 3])) {
      i++;
      push({ t: 'at', value: identSequence() });
    } else if (startsIdent(c, s[i + 1], s[i + 2])) {
      const name = identSequence();
      if (s[i] !== '(') push({ t: 'ident', value: name });
      else {
        i++;
        if (name.toLowerCase() !== 'url') push({ t: 'function', value: name });
        else {
          while (isWhitespace(s[i]) && isWhitespace(s[i + 1])) i++;
          const next = isWhitespace(s[i]) ? s[i + 1] : s[i];
          if (next === '"' || next === "'") push({ t: 'function', value: name });
          else push(url());
        }
      }
    } else if (SINGLE[c]) {
      i++;
      push({ t: SINGLE[c] });
    } else {
      i++;
      push({ t: 'delim', value: c });
    }
  }
  return out;
}

// ---------------------------------------------------------------- serialization (CSSOM §2.1)

/** An identifier as CSS reads it back (CSSOM's "serialize an identifier"). */
export function cssIdent(name: string): string {
  let out = '';
  const cps = [...name];
  cps.forEach((c, k) => {
    const cp = c.codePointAt(0)!;
    if (cp === 0) out += '\ufffd';
    else if ((cp >= 0x01 && cp <= 0x1f) || cp === 0x7f || (k === 0 && isDigit(c)) || (k === 1 && isDigit(c) && cps[0] === '-')) out += `\\${cp.toString(16)} `;
    else if (k === 0 && c === '-' && cps.length === 1) out += '\\-';
    else if (cp >= 0x80 || c === '-' || c === '_' || isDigit(c) || /[A-Za-z]/.test(c)) out += c;
    else out += `\\${c}`;
  });
  return out;
}
/** A string as CSS reads it back (CSSOM's "serialize a string"). */
const cssString = (value: string) =>
  `"${[...value]
    .map((c) => {
      const cp = c.codePointAt(0)!;
      if (cp === 0) return '\ufffd';
      if (cp <= 0x1f || cp === 0x7f) return `\\${cp.toString(16)} `;
      return c === '"' || c === '\\' ? `\\${c}` : c;
    })
    .join('')}"`;

// ---------------------------------------------------------------- structure (§5)

type Opening = '{' | '(' | '[' | 'function';
const CLOSER: Record<Opening, Tok['t']> = { '{': '}', '(': ')', '[': ']', function: ')' };
const opening = (tok: Tok): Opening | null => (tok.t === '{' || tok.t === '(' || tok.t === '[' ? tok.t : tok.t === 'function' ? 'function' : null);

/**
 * The block `toks[i]` opens: the index just past it, and whether its closer was there (an unclosed block closes at the
 * end). Inside a block only its own closer closes it; another kind of closer is a token of the block (§5.4.8).
 */
function blockSpan(toks: readonly Tok[], i: number): { past: number; closed: boolean } {
  const stack: Tok['t'][] = [CLOSER[opening(toks[i]!)!]];
  let j = i + 1;
  while (j < toks.length && stack.length) {
    const tok = toks[j]!;
    const open = opening(tok);
    if (open) stack.push(CLOSER[open]);
    else if (tok.t === stack[stack.length - 1]) stack.pop();
    j++;
  }
  return { past: j, closed: stack.length === 0 };
}
const pastBlock = (toks: readonly Tok[], i: number): number => blockSpan(toks, i).past;

/** The tokens from `i` up to (not including) the first top-level token of a kind in `stop`, and where that is. */
function until(toks: readonly Tok[], i: number, end: number, stop: ReadonlySet<Tok['t']>): number {
  let j = i;
  while (j < end && !stop.has(toks[j]!.t)) j = opening(toks[j]!) ? Math.min(end, pastBlock(toks, j)) : j + 1;
  return j;
}

interface Rule {
  kind: 'at' | 'qualified';
  name: string; // the at-rule's name, lower-cased
  prelude: Tok[];
  /** The block's inside, or null for a statement at-rule. */
  block: Tok[] | null;
}

const blockInside = (toks: readonly Tok[], open: number): Tok[] => {
  const { past, closed } = blockSpan(toks, open);
  return toks.slice(open + 1, closed ? past - 1 : past);
};

/** §5.4.1: a list of rules (a stylesheet's, or a grouping rule's inside). */
function rulesOf(toks: readonly Tok[], top: boolean): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  const end = toks.length;
  while (i < end) {
    const tok = toks[i]!;
    if (tok.t === 'ws' || tok.t === 'semicolon' || (top && (tok.t === 'cdo' || tok.t === 'cdc'))) {
      i++;
      continue;
    }
    if (tok.t === 'at') {
      const stop = until(toks, i + 1, end, new Set(['semicolon', '{']));
      const prelude = toks.slice(i + 1, stop);
      if (stop < end && toks[stop]!.t === '{') {
        rules.push({ kind: 'at', name: tok.value.toLowerCase(), prelude, block: blockInside(toks, stop) });
        i = pastBlock(toks, stop);
      } else {
        rules.push({ kind: 'at', name: tok.value.toLowerCase(), prelude, block: null });
        i = stop + 1;
      }
      continue;
    }
    const stop = until(toks, i, end, new Set(['{']));
    if (stop >= end) break; // a prelude the sheet ends in: no rule
    rules.push({ kind: 'qualified', name: '', prelude: toks.slice(i, stop), block: blockInside(toks, stop) });
    i = pastBlock(toks, stop);
  }
  return rules;
}

type Item = { kind: 'decl'; toks: Tok[] } | Rule;

/** A style block's inside: declarations, and nested rules (CSS Nesting). */
function itemsOf(toks: readonly Tok[]): Item[] {
  const items: Item[] = [];
  let i = 0;
  const end = toks.length;
  while (i < end) {
    const tok = toks[i]!;
    if (tok.t === 'ws' || tok.t === 'semicolon') {
      i++;
      continue;
    }
    const stop = until(toks, tok.t === 'at' ? i + 1 : i, end, new Set(['semicolon', '{']));
    if (stop < end && toks[stop]!.t === '{') {
      items.push(tok.t === 'at' ? { kind: 'at', name: tok.value.toLowerCase(), prelude: toks.slice(i + 1, stop), block: blockInside(toks, stop) } : { kind: 'qualified', name: '', prelude: toks.slice(i, stop), block: blockInside(toks, stop) });
      i = pastBlock(toks, stop);
    } else {
      if (tok.t !== 'at') items.push({ kind: 'decl', toks: toks.slice(i, stop) });
      i = stop + 1;
    }
  }
  return items;
}

// ---------------------------------------------------------------- renaming

const LOCAL = /^\s*#(.+?)\s*$/;
const localTarget = (ref: string, ids: ReadonlyMap<string, string>): string | null => {
  const id = LOCAL.exec(ref)?.[1];
  const to = id === undefined ? undefined : ids.get(id);
  return to === undefined ? null : `#${to}`;
};

/**
 * Tokens written back: `url(#id)`s and `url("#id")`s renamed, a lone backslash (a parse error) dropped; `rename` may
 * write another ident or string (not a url's) in place, by its value and its depth in blocks.
 */
function written(toks: readonly Tok[], names: SvgNames, rename?: (tok: { t: 'ident' | 'string'; value: string }, depth: number) => string | null): string {
  let out = '';
  let depth = 0; // inside a function or a () or [] block
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k]!;
    if (opening(tok)) depth++;
    else if (tok.t === ')' || tok.t === ']' || tok.t === '}') depth = Math.max(0, depth - 1);
    if (tok.t === 'url') {
      const to = localTarget(tok.value, names.ids);
      out += `url(${cssString(to ?? tok.value)})`;
    } else if (tok.t === 'string') {
      // a url("…") function's string; any other string as it reads
      const fn = toks[k - 1]?.t === 'ws' ? toks[k - 2] : toks[k - 1];
      const isUrl = fn?.t === 'function' && fn.value.toLowerCase() === 'url';
      const to = isUrl ? localTarget(tok.value, names.ids) : (rename?.({ t: 'string', value: tok.value }, depth) ?? null);
      out += to !== null && !isUrl ? to : cssString(to ?? tok.value);
    } else if (tok.t === 'ident' && rename) out += rename({ t: 'ident', value: tok.value }, depth) ?? tok.raw;
    else if (tok.t === 'delim' && tok.value === '\\') continue;
    else out += tok.raw;
  }
  return out;
}

const ANIMATION_PROPS = new Set(['animation', 'animation-name', '-webkit-animation', '-webkit-animation-name']);

/**
 * A declaration: its references renamed, and in an `animation` the keyframes names this drawing defines, written as
 * they were (an ident as an ident, a string as a string: `animation-name` takes either).
 */
function declaration(toks: readonly Tok[], names: SvgNames): string {
  const at = toks.findIndex((t) => t.t !== 'ws');
  const head = toks[at];
  if (head?.t !== 'ident') return written(toks, names);
  const animation = ANIMATION_PROPS.has(head.value.toLowerCase());
  const value = written(toks.slice(at + 1), names, (tok, depth) => {
    const to = animation && depth === 0 ? names.keyframes.get(tok.value) : undefined;
    return to === undefined ? null : tok.t === 'ident' ? cssIdent(to) : cssString(to);
  });
  return `${toks.slice(0, at + 1).map((t) => t.raw).join('')}${value}`;
}

/** `style="…"`: a declaration list. */
export function scopeSvgDeclarations(css: string, names: SvgNames): string {
  return itemsOf(tokenize(css))
    .flatMap((item) => (item.kind === 'decl' ? [declaration(item.toks, names)] : []))
    .join('; ');
}

/** A presentation attribute or any other attribute's value holding `url(#id)`s. */
function scopeSvgUrls(value: string, names: SvgNames): string {
  return /url|\\/i.test(value) ? written(tokenize(value), names) : value;
}

// ---------------------------------------------------------------- selectors

const ID_PREFIX_OPS = new Set(['', '~', '^', '|']); // = ~= ^= |=: a renamed id starts with the scope, the rest as written

/**
 * B1 re-review 2: an attribute selector naming the drawing's ids or local references by value (`[id="r"]`,
 * `[href="#r"]`, `[xlink|href="#r"]`) with the value renamed as the attribute is; `$=` and `*=` still match the renamed
 * value as written. Other attribute selectors as they are.
 */
function renameAttributeSelectors(toks: readonly Tok[], names: SvgNames): Tok[] {
  const out: Tok[] = [];
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k]!;
    if (tok.t !== '[') {
      out.push(tok);
      continue;
    }
    const { past, closed } = blockSpan(toks, k);
    const inner = toks.slice(k + 1, closed ? past - 1 : past);
    const eq = inner.findIndex((t) => t.t === 'delim' && t.value === '=');
    const valueAt = eq < 0 ? -1 : inner.findIndex((t, j) => j > eq && t.t !== 'ws');
    const value = inner[valueAt];
    if (eq > 0 && (value?.t === 'ident' || value?.t === 'string')) {
      const before = inner[eq - 1]!;
      const op = before.t === 'delim' && '~|^$*'.includes(before.value) ? before.value : '';
      const nameTok = inner
        .slice(0, op ? eq - 1 : eq)
        .filter((t) => t.t === 'ident')
        .pop();
      const name = nameTok?.t === 'ident' ? nameTok.value.toLowerCase() : undefined;
      let renamed: string | null = null;
      if (name === 'id' && ID_PREFIX_OPS.has(op)) renamed = `${names.scope}_${value.value}`;
      else if ((name === 'href' || name === 'xlink:href') && value.value.startsWith('#')) {
        if (op === '') renamed = localTarget(value.value, names.ids);
        else if (op === '^') renamed = `#${names.scope}_${value.value.slice(1)}`;
      }
      if (renamed !== null) {
        out.push(tok, ...inner.slice(0, valueAt), { t: 'string', raw: cssString(renamed), value: renamed }, ...inner.slice(valueAt + 1));
        if (closed) out.push(toks[past - 1]!);
        k = past - 1;
        continue;
      }
    }
    out.push(...toks.slice(k, past));
    k = past - 1;
  }
  return out;
}

const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
const COMBINATOR_DELIMS = new Set(['>', '+', '~']);

/**
 * A selector list with every compound of every complex selector constrained to the drawing (and its `#id`s renamed);
 * null when a selector is empty or malformed in a way the constraint would change (the rule is dropped). `nested`: a
 * rule nested in a style rule, whose selectors may begin with a combinator.
 */
function scopeSelectors(given: readonly Tok[], names: SvgNames, nested: boolean): string | null {
  const prelude = renameAttributeSelectors(given, names);
  const within = `:where([${SVG_SCOPE_ATTR}="${names.scope}"],[${SVG_SCOPE_ATTR}="${names.scope}"] *)`;
  const out: string[] = [];
  // split at top-level commas, each complex selector into compounds at top-level combinators
  const complexes: Tok[][] = [[]];
  for (let k = 0; k < prelude.length; k++) {
    const tok = prelude[k]!;
    if (tok.t === '}' || tok.t === ')' || tok.t === ']' || tok.t === 'semicolon') return null; // never a selector
    if (tok.t === 'comma') complexes.push([]);
    else if (opening(tok)) {
      const past = pastBlock(prelude, k);
      complexes[complexes.length - 1]!.push(...prelude.slice(k, past));
      k = past - 1;
    } else complexes[complexes.length - 1]!.push(tok);
  }
  for (const complex of complexes) {
    const parts: { compound: Tok[]; before: string }[] = [];
    let compound: Tok[] = [];
    let combinator = '';
    const flush = (next: string) => {
      parts.push({ compound, before: combinator });
      compound = [];
      combinator = next;
    };
    let k = 0;
    while (k < complex.length) {
      const tok = complex[k]!;
      const isComb = (tok.t === 'delim' && COMBINATOR_DELIMS.has(tok.value)) || (tok.t === 'delim' && tok.value === '|' && complex[k + 1]?.t === 'delim' && (complex[k + 1] as { value: string }).value === '|');
      if (tok.t === 'ws' || isComb) {
        // a run of whitespace and at most one combinator is one combinator
        let comb = '';
        while (k < complex.length) {
          const t = complex[k]!;
          if (t.t === 'ws') k++;
          else if (t.t === 'delim' && COMBINATOR_DELIMS.has(t.value) && !comb) {
            comb = t.value;
            k++;
          } else if (t.t === 'delim' && t.value === '|' && complex[k + 1]?.t === 'delim' && (complex[k + 1] as { value: string }).value === '|' && !comb) {
            comb = '||';
            k += 2;
          } else break;
        }
        if (k >= complex.length) break; // trailing whitespace
        if (!compound.length && !parts.length && !combinator) {
          // leading: whitespace is nothing; a combinator is a relative selector's (nested rules only)
          if (comb && !nested) return null;
          combinator = comb;
          continue;
        }
        if (!compound.length) return null; // two combinators in a row
        flush(comb || ' ');
        continue;
      }
      // a functional pseudo-class or an attribute selector is one unit of its compound, whatever it holds
      const past = opening(tok) ? pastBlock(complex, k) : k + 1;
      compound.push(...complex.slice(k, past));
      k = past;
    }
    if (!compound.length) return null; // empty, or ending in a combinator
    flush('');
    out.push(
      parts
        .map(({ compound: c, before }, n) => {
          // the constraint goes before a pseudo-element (which ends a compound), else at the end
          let at = c.length;
          for (let j = 0; j < c.length; j = opening(c[j]!) ? pastBlock(c, j) : j + 1) {
            if (c[j]!.t !== 'colon') continue;
            const next = c[j + 1];
            if (next?.t === 'colon' || (next?.t === 'ident' && LEGACY_PSEUDO_ELEMENTS.has(next.value.toLowerCase()))) {
              at = j;
              break;
            }
          }
          const body = (toks: Tok[]) => toks.map((tok) => (tok.t === 'hash' && tok.id && names.ids.has(tok.value) ? `#${cssIdent(names.ids.get(tok.value)!)}` : tok.t === 'delim' && tok.value === '\\' ? '' : tok.raw)).join('');
          const lead = n === 0 ? (before ? `${before} ` : '') : before === ' ' ? ' ' : ` ${before} `;
          return `${lead}${body(c.slice(0, at))}${within}${body(c.slice(at))}`;
        })
        .join(''),
    );
  }
  return out.join(', ');
}

// ---------------------------------------------------------------- the stylesheet

const GROUPING = new Set(['media', 'supports']);
const KEYFRAMES = new Set(['keyframes', '-webkit-keyframes']);

const keyframesName = (prelude: readonly Tok[]): string | null => {
  const tok = prelude.find((t) => t.t !== 'ws');
  return tok?.t === 'ident' || tok?.t === 'string' ? tok.value : null;
};

/** The `@keyframes` names a stylesheet defines (at its top level, in `@media` and `@supports`). */
export function svgKeyframesNames(css: string): string[] {
  const names: string[] = [];
  const walk = (rules: Rule[]) => {
    for (const rule of rules) {
      if (rule.kind !== 'at' || !rule.block) continue;
      if (KEYFRAMES.has(rule.name)) {
        const name = keyframesName(rule.prelude);
        if (name !== null) names.push(name);
      } else if (GROUPING.has(rule.name)) walk(rulesOf(rule.block, false));
    }
  };
  walk(rulesOf(tokenize(css), true));
  return names;
}

function styleBlock(toks: readonly Tok[], names: SvgNames): string {
  return itemsOf(toks)
    .map((item) => {
      if (item.kind === 'decl') return `${declaration(item.toks, names)};`;
      if (item.kind === 'qualified') {
        const selectors = scopeSelectors(item.prelude, names, true);
        return selectors === null ? '' : `${selectors}{${styleBlock(item.block ?? [], names)}}`;
      }
      return GROUPING.has(item.name) && item.block ? `@${item.name}${written(item.prelude, names)}{${styleBlock(item.block, names)}}` : '';
    })
    .join('');
}

function ruleList(rules: readonly Rule[], names: SvgNames): string {
  return rules
    .map((rule) => {
      if (!rule.block) return ''; // a statement at-rule (@import, @layer a, @namespace, @charset): the page's
      if (rule.kind === 'qualified') {
        const selectors = scopeSelectors(rule.prelude, names, false);
        return selectors === null ? '' : `${selectors}{${styleBlock(rule.block, names)}}`;
      }
      if (GROUPING.has(rule.name)) return `@${rule.name}${written(rule.prelude, names)}{${ruleList(rulesOf(rule.block, false), names)}}`;
      if (KEYFRAMES.has(rule.name)) {
        const name = keyframesName(rule.prelude);
        const to = name === null ? undefined : names.keyframes.get(name);
        if (to === undefined) return '';
        const frames = rulesOf(rule.block, false)
          .filter((frame) => frame.kind === 'qualified')
          .map((frame) => `${written(frame.prelude, names)}{${itemsOf(frame.block ?? []).flatMap((item) => (item.kind === 'decl' ? [`${declaration(item.toks, names)};`] : [])).join('')}}`);
        return `@${rule.name} ${cssIdent(to)}{${frames.join('')}}`;
      }
      return ''; // @font-face, @property, @layer, @page, @counter-style, @scope, …: each the page's
    })
    .filter(Boolean)
    .join('\n');
}

/** A drawing's stylesheet, contained (see the header). */
export function scopeSvgStyleSheet(css: string, names: SvgNames): string {
  return ruleList(rulesOf(tokenize(css), true), names);
}

// ---------------------------------------------------------------- attributes

const IDREF_LISTS = new Set(['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-flowto', 'aria-details', 'aria-errormessage', 'aria-activedescendant']);
const ANIMATION_VALUES = new Set(['to', 'from', 'by', 'values']);

/** SMIL timing (`begin`, `end`): a syncbase or event on an element by id (`id.end+1s`, `id.click`) names it renamed. */
function scopeTiming(value: string, ids: ReadonlyMap<string, string>): string {
  return value
    .split(';')
    .map((item) => {
      const m = /^(\s*)([^.\s]+)(\..*)$/s.exec(item);
      const to = m ? ids.get(m[2]!) : undefined;
      return m && to !== undefined ? `${m[1]}${to}${m[3]}` : item;
    })
    .join(';');
}

/** An attribute's value with the drawing's references renamed; null removes the attribute. */
export function scopeSvgAttribute(element: { tag: string; attributeName?: string | null }, name: string, value: string, names: SvgNames): string | null {
  const attr = name.toLowerCase();
  if (attr === SVG_SCOPE_ATTR) return null;
  if (attr === 'id') return names.ids.get(value) ?? value;
  if (attr === 'href' || attr === 'xlink:href') return localTarget(value, names.ids) ?? value;
  if (attr === 'style') return scopeSvgDeclarations(value, names);
  if (attr === 'begin' || attr === 'end') return scopeTiming(value, names.ids);
  if (IDREF_LISTS.has(attr)) return value.replace(/\S+/g, (id) => names.ids.get(id) ?? id);
  if (ANIMATION_VALUES.has(attr) && /^(xlink:)?href$/i.test(element.attributeName?.trim() ?? '')) {
    return value
      .split(';')
      .map((v) => localTarget(v, names.ids) ?? v)
      .join(';');
  }
  return scopeSvgUrls(value, names);
}
