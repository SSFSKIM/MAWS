// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D1), from S6's `spikes/p3-store/s6/src/css.ts`,
// completed per S6's copy list. The inline-style half of the dialect: Claude's closed property list adopted property for
// property (`T/slides/artifact-type/reference/format.md:9-67`; parent Decision Log 21) with each line's grammar, ranges
// and applies-to column, plus the owner's `var(--ds-*)` superset (Decision Log 12). A value outside its line, or a
// property on an element that does not take it, is dropped with a warning naming the property; a heal to an equivalent
// is a note. Values normalize to one canonical form (S6). Pure; no DOM, no Yjs.
//
// `CSS_GRAMMAR` is the format reference's CSS block (`src/artifacts/types/presentation/format.md`), line for line; a
// test holds the two equal, so the agent reads exactly the table this module enforces.
import { cssNamesOf, ROLES } from '../design-system/roles';
import { isPinned, type Attrs, type Style, type Tag } from './ir';

// ---------------------------------------------------------------- the table's shape

/** How a property's value normalizes (S6). `len*` kinds turn bare numbers into px; `num` kinds keep them bare. */
type Kind =
  | 'len' // one LEN | PCT | keyword | calc() | var(--ds-*)
  | 'lens' // 1-4 LENs (padding, border-radius), compressed to the shortest equal form
  | 'num' // a bare number
  | 'weight' // 100-900 | normal | bold
  | 'color'
  | 'family'
  | 'lineheight' // N stays bare, PCT, LEN
  | 'kw' // one keyword from a closed set
  | 'border' // [LEN] style [COLOR], defaults filled per Claude's grammar
  | 'lenvalue' // a generic value whose bare numbers are lengths (shadows, text-stroke)
  | 'flex' // N [N] [LEN]: factors bare, the basis a length
  | 'tracks' // track lists: lengths px, fr and repeat counts as they are
  | 'value'; // a generic value whose bare numbers stay numbers (flex, transform, filter, background, tracks)

/**
 * Where a property applies, the table's applies-to column: `text` is h1-h3, p, ul, ol; `inherits` is the section and a
 * div on the inheritable typography rows only (Claude: "text rows set on body, section, or div inherit down"; colour,
 * font, line, spacing, alignment, case, wrapping, numerals, stroke, text shadow); `div child` and `grid child` are flow
 * children of a div (the section counts as one) or of a grid; `flex box`, `row div` and `grid box` are the element's own
 * effective display, where a section or div without `display` is a flex column (Claude: "no display = column").
 */
type Target =
  | 'any' | 'not-connector' | 'pinned' | 'div-child' | 'grid-child' | 'flex-box' | 'row-div' | 'grid-box'
  | 'section' | 'div' | 'text' | 'inherits' | 'table' | 'cell' | 'th' | 'tr' | 'img' | 'hr' | 'x-icon' | 'x-shape' | 'rect-shape' | 'x-connector';

interface Prop {
  kind: Kind;
  kw?: readonly string[];
  on: readonly Target[];
  /** The value's grammar and ranges, over tokens whose `var(--ds-*)` are expanded (their fallback, else a wildcard). */
  check: (ts: Tok[]) => boolean;
}
interface Row {
  line: string;
  props: Record<string, Prop>;
}


/** A shorthand declared after its longhands resets them (the CSS cascade inside one style attribute). */
const RESETS: Record<string, readonly string[]> = {
  border: ['border-top', 'border-right', 'border-bottom', 'border-left', 'border-width', 'border-style'],
  background: ['background-clip'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
};
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

/** Accepted as no-ops only (Claude): dropped with a note at these values, with a warning otherwise. */
const NOOPS: Record<string, (v: string) => boolean> = {
  margin: (v) => v.split(/\s+/).every((p) => /^0(px)?$/.test(p)),
  'margin-top': (v) => /^0(px)?$/.test(v),
  'margin-right': (v) => /^0(px)?$/.test(v),
  'margin-bottom': (v) => /^0(px)?$/.test(v),
  'margin-left': (v) => /^0(px)?$/.test(v),
  'box-sizing': (v) => v === 'border-box',
  'grid-template': (v) => v === 'none',
};

const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
  'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
  'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise ' +
  'darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod ' +
  'gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral ' +
  'lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey ' +
  'lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
  'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
  'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
  'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow ' +
  'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'system-ui']);

/** The `--ds-*` names every design system defines (X28's shared list, from D's roles). */
export const SHARED_DS_NAMES: ReadonlySet<string> = new Set(ROLES.flatMap((role) => cssNamesOf(role.path, role.type)));

// ---------------------------------------------------------------- tokens

type Tok =
  | { t: 'word'; v: string } // identifiers, numbers with units, hashes, operators like + -
  | { t: 'str'; v: string } // a quoted string, unquoted content
  | { t: 'fn'; name: string; args: Tok[] }
  | { t: 'comma' }
  | { t: 'slash' };
type Fn = Extract<Tok, { t: 'fn' }>;

function tokenize(src: string): Tok[] {
  let i = 0;
  const read = (stopAtParen: boolean): Tok[] => {
    const out: Tok[] = [];
    while (i < src.length) {
      const c = src[i]!;
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === ')') {
        i++;
        if (stopAtParen) return out;
        continue;
      }
      if (c === ',') {
        out.push({ t: 'comma' });
        i++;
        continue;
      }
      if (c === '/') {
        out.push({ t: 'slash' });
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        let v = '';
        while (j < src.length && src[j] !== c) {
          if (src[j] === '\\' && j + 1 < src.length) j++;
          v += src[j];
          j++;
        }
        out.push({ t: 'str', v });
        i = j + 1;
        continue;
      }
      let j = i;
      while (j < src.length && !/[\s,/()"']/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if (src[j] === '(') {
        i = j + 1;
        const name = word.toLowerCase();
        if (name === 'url') {
          // keep url() content verbatim
          let k = i;
          while (k < src.length && src[k] !== ')') k++;
          out.push({ t: 'fn', name, args: [{ t: 'str', v: src.slice(i, k).trim().replace(/^['"]|['"]$/g, '') }] });
          i = k + 1;
          continue;
        }
        out.push({ t: 'fn', name, args: read(true) });
        continue;
      }
      if (word === '') {
        i++;
        continue;
      }
      out.push({ t: 'word', v: word });
      i = j;
    }
    return out;
  };
  return read(false);
}

function splitCommas(ts: Tok[]): Tok[][] {
  const out: Tok[][] = [[]];
  for (const t of ts) {
    if (t.t === 'comma') out.push([]);
    else out[out.length - 1]!.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- var(--ds-*): expansion for the grammar checks

/** What a `var(--ds-*)` without a fallback stands for in a grammar check: any one component. */
const WILD = '\u0000var';
const isWild = (t: Tok | undefined): boolean => t?.t === 'word' && t.v === WILD;
const DS_NAME = /^--ds-[a-z0-9-]+$/;

/** A `var(--ds-*)`'s name and fallback tokens, or null for any other var(). */
function varParts(fn: Fn): { name: string; fallback: Tok[] | null } | null {
  const [name, ...rest] = fn.args;
  if (!name || name.t !== 'word' || !DS_NAME.test(name.v)) return null;
  if (rest.length === 0) return { name: name.v, fallback: null };
  if (rest[0]!.t !== 'comma' || rest.length === 1) return null;
  return { name: name.v, fallback: rest.slice(1) };
}

/** Each `var(--ds-*)` replaced by its fallback (checked by the property's grammar), else by the wildcard. */
function expandVars(ts: Tok[]): Tok[] {
  return ts.flatMap((t): Tok[] => {
    if (t.t !== 'fn') return [t];
    if (t.name === 'var') {
      const parts = varParts(t)!;
      return parts.fallback ? expandVars(parts.fallback) : [{ t: 'word', v: WILD }];
    }
    return [{ ...t, args: expandVars(t.args) }];
  });
}

function hasInvalidVar(ts: Tok[]): boolean {
  return ts.some((t) => t.t === 'fn' && ((t.name === 'var' && varParts(t) === null) || hasInvalidVar(t.args)));
}
function hasCurrentColor(ts: Tok[]): boolean {
  return ts.some((t) => (t.t === 'word' && t.v.toLowerCase() === 'currentcolor') || (t.t === 'fn' && hasCurrentColor(t.args)));
}
/** The `--ds-*` names a value references with no fallback. */
function bareVarNames(ts: Tok[]): string[] {
  return ts.flatMap((t) => {
    if (t.t !== 'fn') return [];
    if (t.name === 'var') {
      const parts = varParts(t);
      return parts && parts.fallback === null ? [parts.name] : parts?.fallback ? bareVarNames(parts.fallback) : [];
    }
    return bareVarNames(t.args);
  });
}

// ---------------------------------------------------------------- grammar predicates (over expanded tokens)

const NUM_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i;
function numOf(t: Tok | undefined): { n: number; unit: string } | null {
  if (!t || t.t !== 'word') return null;
  const m = NUM_RE.exec(t.v);
  return m ? { n: Number(m[1]), unit: m[2]!.toLowerCase() } : null;
}
const unitOf = (t: Tok | undefined): string | null => numOf(t)?.unit ?? null;
const between = (n: number, min = -Infinity, max = Infinity) => n >= min && n <= max;
const one = (f: (t: Tok) => boolean) => (ts: Tok[]) => ts.length === 1 && f(ts[0]!);

/** LEN: Npx, a bare N (px) or Npt (converts at 1px = 0.5pt), within [min, max] px. */
function isLen(t: Tok | undefined, min?: number, max?: number): boolean {
  if (isWild(t)) return true;
  const v = numOf(t);
  if (!v) return false;
  const px = v.unit === 'px' || v.unit === '' ? v.n : v.unit === 'pt' ? v.n * 2 : NaN;
  return !Number.isNaN(px) && between(px, min, max);
}
function isPct(t: Tok | undefined, min?: number, max?: number): boolean {
  if (isWild(t)) return true;
  const v = numOf(t);
  return v !== null && v.unit === '%' && between(v.n, min, max);
}
function isBare(t: Tok | undefined, min?: number, max?: number): boolean {
  if (isWild(t)) return true;
  const v = numOf(t);
  return v !== null && v.unit === '' && between(v.n, min, max);
}
const isInt = (t: Tok | undefined, min?: number, max?: number) => isWild(t) || (isBare(t, min, max) && Number.isInteger(numOf(t)!.n));
const ANGLE_TO_DEG: Record<string, number> = { deg: 1, turn: 360, rad: 180 / Math.PI };
function isAngle(t: Tok | undefined, maxAbsDeg = Infinity): boolean {
  if (isWild(t)) return true;
  const v = numOf(t);
  if (!v) return false;
  if (v.unit === '') return v.n === 0;
  const k = ANGLE_TO_DEG[v.unit];
  return k !== undefined && Math.abs(v.n * k) <= maxAbsDeg + 1e-9;
}
function isKw(t: Tok | undefined, words: readonly string[]): boolean {
  return isWild(t) || (t?.t === 'word' && words.includes(t.v.toLowerCase()));
}
function isColor(t: Tok | undefined): boolean {
  if (!t || isWild(t)) return t !== undefined;
  if (t.t === 'word') return normColor(t.v) !== null;
  return t.t === 'fn' && COLOR_FNS.has(t.name) && normColor(`${t.name}(${serTokens(t.args, false)})`) !== null;
}
/** IMG (and a face's src): MAWS's asset ref, Claude's upload path or an installed design system's file; never a URL or `data:`. */
export function isAssetRef(src: string): boolean {
  if (src.includes('..') || src.includes('\\')) return false;
  return /^assets\/[^/?#\s]+$/.test(src) || /^\/_blob\/\S+$/.test(src) || /^project\/ds\/[a-z0-9][a-z0-9_-]{0,63}\/\S+$/.test(src);
}

const isOffset = (t: Tok) => isLen(t) || isPct(t) || isKw(t, ['auto']);
const isSize = (t: Tok) => isLen(t, 0) || isPct(t, 0) || isKw(t, ['auto']);
function isCalcOffset(t: Tok): boolean {
  if (t.t !== 'fn' || t.name !== 'calc' || t.args.length !== 3) return false;
  const [a, op, b] = t.args;
  return isPct(a) && op?.t === 'word' && (op.v === '+' || op.v === '-') && isLen(b);
}

function isFlex(ts: Tok[]): boolean {
  if (ts.length === 1 && isKw(ts[0], ['none', 'auto'])) return true;
  let i = 0;
  if (!isBare(ts[i], 0)) return false;
  i++;
  if (i < ts.length && isBare(ts[i], 0)) i++;
  if (i < ts.length && (isLen(ts[i], 0) || (isPct(ts[i]) && numOf(ts[i])?.n === 0) || isKw(ts[i], ['auto']))) i++;
  return i === ts.length;
}

/** The number of tracks a track list makes, or null when it is outside the grammar. */
function trackCount(ts: Tok[]): number | null {
  let n = 0;
  for (const t of ts) {
    if (isLen(t, 0) || isKw(t, ['auto']) || (unitOf(t) === 'fr' && numOf(t)!.n >= 0)) {
      n++;
      continue;
    }
    if (t.t !== 'fn' || t.name !== 'repeat') return null;
    const [count, tracks, ...more] = splitCommas(t.args);
    if (!count || !tracks || more.length || count.length !== 1 || !isInt(count[0], 1)) return null;
    const inner = trackCount(tracks);
    if (inner === null || inner === 0) return null;
    n += (isWild(count[0]) ? 1 : numOf(count[0])!.n) * inner;
  }
  return n;
}
function isTracks(ts: Tok[]): boolean {
  const n = trackCount(ts);
  return n !== null && n >= 1 && n <= 24;
}
const isSpan = (ts: Tok[]) => ts.length === 2 && isKw(ts[0], ['span']) && isInt(ts[1], 1);
const isRatio = (ts: Tok[]) => (ts.length === 1 && isBare(ts[0], 0)) || (ts.length === 3 && isBare(ts[0], 0) && ts[1]!.t === 'slash' && isBare(ts[2], 0));

function isFamily(ts: Tok[]): boolean {
  const parts = splitCommas(ts);
  return parts.every((p) => p.length > 0 && p.every((t) => t.t === 'word' || t.t === 'str'));
}

function isDecoration(ts: Tok[]): boolean {
  if (ts.length === 1 && isKw(ts[0], ['none'])) return true;
  if (!isKw(ts[0], ['underline', 'line-through'])) return false;
  let i = 1;
  if (i < ts.length && isKw(ts[i], ['solid', 'double', 'dotted', 'dashed', 'wavy']) && !isWild(ts[i])) i++;
  if (i < ts.length && isColor(ts[i])) i++;
  return i === ts.length;
}

const isStroke = (ts: Tok[]) => ts.length === 2 && ((isLen(ts[0], 0, 8) && isColor(ts[1])) || (isColor(ts[0]) && isLen(ts[1], 0, 8)));

const SIDE_WORDS = ['left', 'right', 'top', 'bottom'];
function isGradient(t: Tok): boolean {
  if (t.t !== 'fn') return false;
  const linear = t.name === 'linear-gradient' || t.name === 'repeating-linear-gradient';
  if (!linear && t.name !== 'radial-gradient') return false;
  const repeating = t.name.startsWith('repeating-');
  let parts = splitCommas(t.args);
  const head = parts[0]!;
  if (linear) {
    if (head.length === 1 && !isWild(head[0]) && isAngle(head[0]) && !isColor(head[0])) parts = parts.slice(1);
    else if (isKw(head[0], ['to']) && !isWild(head[0])) {
      const sides = head.slice(1);
      if (sides.length < 1 || sides.length > 2 || !sides.every((s) => isKw(s, SIDE_WORDS))) return false;
      parts = parts.slice(1);
    }
  } else if (head.length > 0 && !isColor(head[0])) {
    let i = 0;
    if (isKw(head[i], ['circle', 'ellipse'])) i++;
    if (isKw(head[i], ['at'])) {
      if (!isPct(head[i + 1]) || !isPct(head[i + 2])) return false;
      i += 3;
    }
    if (i !== head.length || i === 0) return false;
    parts = parts.slice(1);
  }
  if (parts.length < 2 || parts.length > 8) return false;
  const isStop = repeating ? (s: Tok) => isLen(s) : (s: Tok) => isPct(s);
  return parts.every((stop) => stop.length >= 1 && stop.length <= 3 && isColor(stop[0]) && stop.slice(1).every(isStop));
}
function isBackground(ts: Tok[]): boolean {
  const parts = splitCommas(ts);
  if (parts.length > 2) return false;
  const [fill, under] = parts as [Tok[], Tok[] | undefined];
  if (under && !(under.length === 1 && isColor(under[0]))) return false;
  if (fill.length === 1 && isColor(fill[0])) return !under;
  if (fill.length === 1 && isGradient(fill[0]!)) return true;
  // url(IMG) [center / cover|contain], the picture fill background-clip:text draws glyphs with
  const [url, ...pos] = fill;
  if (url?.t !== 'fn' || url.name !== 'url' || !isAssetRef((url.args[0] as { v: string }).v)) return false;
  return pos.length === 0 || (pos.length === 3 && isKw(pos[0], ['center']) && pos[1]!.t === 'slash' && isKw(pos[2], ['cover', 'contain']));
}

type BorderSlot = 'width' | 'style' | 'color';
const BORDER_SLOTS: readonly BorderSlot[] = ['width', 'style', 'color'];

/** A border token's slot by its grammar (a token's by its fallback's); 'any' for a token with no fallback; null when none. */
function borderSlot(t: Tok): BorderSlot | 'any' | null {
  if (isWild(t)) return 'any';
  if (t.t === 'fn' && t.name === 'var') {
    const parts = varParts(t);
    if (!parts) return null;
    if (!parts.fallback) return 'any';
    const fallback = expandVars(parts.fallback);
    return fallback.length === 1 ? borderSlot(fallback[0]!) : null;
  }
  if (t.t === 'word' && BORDER_STYLES.includes(t.v.toLowerCase())) return 'style';
  if (isLen(t)) return 'width';
  if (isColor(t)) return 'color';
  return null;
}

/**
 * A border's tokens in its three slots, `[LEN] style [COLOR]`. A token with no fallback takes its slot by position:
 * before the style word the width, after it the colour; with no style word it is the style (which is required), then
 * the colour, then the width. Null when a slot is taken twice or a token fits none.
 */
function placeBorder(ts: Tok[]): Partial<Record<BorderSlot, Tok>> | null {
  const placed: Partial<Record<BorderSlot, Tok>> = {};
  const open: { t: Tok; i: number }[] = [];
  let styleAt = -1;
  for (const [i, t] of ts.entries()) {
    const slot = borderSlot(t);
    if (slot === null) return null;
    if (slot === 'any') open.push({ t, i });
    else if (placed[slot]) return null;
    else {
      placed[slot] = t;
      if (slot === 'style') styleAt = i;
    }
  }
  if (styleAt !== -1) {
    for (const { t, i } of open) {
      const slot = (i < styleAt ? (['width', 'color'] as const) : (['color', 'width'] as const)).find((s) => !placed[s]);
      if (!slot) return null;
      placed[slot] = t;
    }
    return placed;
  }
  const free = BORDER_SLOTS.filter((s) => !placed[s]);
  if (open.length > free.length) return null;
  const chosen = (['style', 'color', 'width'] as const).filter((s) => free.includes(s)).slice(0, open.length);
  BORDER_SLOTS.filter((s) => chosen.includes(s)).forEach((slot, k) => {
    placed[slot] = open[k]!.t;
  });
  return placed;
}

/**
 * P3-C M4 fix wave 1: a border value's three parts as the loader places them (a token by its fallback's grammar, else by
 * its place around the style word; Decision Log 9a), each serialized as written; null when it is not a border. What the
 * canvas strokes an x-shape with.
 */
export function borderParts(value: string): { width: string | null; style: string; color: string | null } | null {
  const placed = placeBorder(tokenize(value));
  if (!placed?.style) return null;
  return {
    width: placed.width ? serTok(placed.width, true) : null,
    style: serTok(placed.style, false),
    color: placed.color ? serTok(placed.color, false) : null,
  };
}

function isBorder(ts: Tok[]): boolean {
  const placed = placeBorder(ts);
  if (!placed?.style) return false;
  return placed.width === undefined || isWild(placed.width) || isLen(placed.width, 0, 32);
}

/** One shadow list: ≤8 shadows, each [inset] x y [blur [spread]] COLOR (box) or x y [blur] COLOR (text). */
function isShadows(ts: Tok[], box: boolean): boolean {
  const shadows = splitCommas(ts);
  if (shadows.length > 8) return false;
  if (shadows.length === 1 && shadows[0]!.length === 1 && isWild(shadows[0]![0])) return true;
  return shadows.every((s) => {
    let parts = s;
    if (box && isKw(parts[0], ['inset']) && !isWild(parts[0])) parts = parts.slice(1);
    else if (box && isKw(parts[parts.length - 1], ['inset']) && !isWild(parts[parts.length - 1])) parts = parts.slice(0, -1);
    let lens: Tok[];
    if (isColor(parts[parts.length - 1])) lens = parts.slice(0, -1);
    else if (isColor(parts[0])) lens = parts.slice(1);
    else return false;
    const [x, y, blur, spread] = lens;
    if (lens.length < 2 || lens.length > (box ? 4 : 3)) return false;
    return isLen(x, -64, 64) && isLen(y, -64, 64) && (blur === undefined || isLen(blur, 0, box ? 160 : 64)) && (spread === undefined || isLen(spread, -32, 32));
  });
}

const TRANSFORM_RANK: Record<string, number> = { translate: 0, translatex: 0, translatey: 0, rotate: 1, scale: 2, skew: 3, skewx: 3, skewy: 3 };
function isTransform(ts: Tok[]): boolean {
  if (ts.length === 1 && isWild(ts[0])) return true;
  const seen = new Set<string>();
  let rank = 0;
  for (const t of ts) {
    if (t.t !== 'fn' || TRANSFORM_RANK[t.name] === undefined || seen.has(t.name) || TRANSFORM_RANK[t.name]! < rank) return false;
    seen.add(t.name);
    rank = TRANSFORM_RANK[t.name]!;
    const args = splitCommas(t.args);
    const single = args.every((a) => a.length === 1);
    const shift = (a: Tok[]) => isLen(a[0]) || (isPct(a[0]) && numOf(a[0])?.n === -50);
    const ok =
      t.name === 'translate' ? single && args.length <= 2 && args.every(shift)
      : t.name === 'translatex' || t.name === 'translatey' ? single && args.length === 1 && shift(args[0]!)
      : t.name === 'rotate' ? single && args.length === 1 && isAngle(args[0]![0])
      : t.name === 'scale' ? single && args.length === 1 && isBare(args[0]![0], 0.5, 2)
      : t.name === 'skew' ? single && args.length <= 2 && args.every((a) => isAngle(a[0], 60))
      : single && args.length === 1 && isAngle(args[0]![0], 60);
    if (!ok) return false;
  }
  return ts.length > 0;
}

const FILTER_ARG: Record<string, (t: Tok | undefined) => boolean> = {
  blur: (t) => isLen(t, 0, 20),
  brightness: (t) => isBare(t, 0, 2),
  contrast: (t) => isBare(t, 0, 2),
  saturate: (t) => isBare(t, 0, 3),
  grayscale: (t) => isBare(t, 0, 1),
  sepia: (t) => isBare(t, 0, 1),
  invert: (t) => isBare(t, 0, 1),
  'hue-rotate': (t) => isAngle(t),
};
function isFilter(ts: Tok[]): boolean {
  if (ts.length === 1 && isWild(ts[0])) return true;
  const seen = new Set<string>();
  return ts.length > 0 && ts.every((t) => {
    if (t.t !== 'fn' || !FILTER_ARG[t.name] || seen.has(t.name) || t.args.length !== 1) return false;
    seen.add(t.name);
    return FILTER_ARG[t.name]!(t.args[0]);
  });
}

// ---------------------------------------------------------------- the table's lines

const ALIGN = ['start', 'center', 'end', 'stretch', 'baseline', 'flex-start', 'flex-end'];
const JUSTIFY = ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly', 'flex-start', 'flex-end'];
const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'none'];
const kwProp = (kw: readonly string[], on: readonly Target[]): Prop => ({ kind: 'kw', kw, on, check: one((t) => isKw(t, kw)) });

/** The definitions that open the CSS block: Claude's, with MAWS's FAMILY wording (deck.json's faces), IMG and VAR. */
const DEFINITIONS = [
  'LEN = Npx or bare N (px) — no em rem vw vh %',
  'PCT = N%',
  'N, INT = number, whole number',
  'COLOR = #hex | rgb[a]() | hsl[a]() | named | transparent — no currentcolor',
  'ANGLE = Ndeg | Nturn | Nrad',
  'ALIGN = start | center | end | stretch | baseline (flex-* forms ok)',
  "FAMILY = 'Declared Face', Basic, generic — a family of deck.json's faces, a basic face, then serif | sans-serif | monospace | cursive | system-ui",
  'IMG = assets/NAME (an uploaded asset) | /_blob/ID | project/ds/FOLDER/PATH — never a URL or data:',
  "VAR = var(--ds-NAME[, FALLBACK]) — a design-system token in any value position (MAWS); FALLBACK follows the property's grammar; no other var()",
];

/**
 * Claude's table in its own order, line for line. The canonical serializer writes properties in this order, which also
 * puts every shorthand before its longhands (border before border-top, background before background-clip, flex before
 * flex-grow), so the exploded map serializes back with the cascade meaning it was parsed with. Two lines are MAWS's:
 * `border-width` and `border-style`, which format.md's connector paragraph styles `x-connector` with (S6, A6); two
 * lines carry what Claude's own prose adds to its column (`color` on a table, from its Tables paragraph; an `hr`'s
 * `border-top`, from its Shapes paragraph); the no-op line adds `position:static`.
 */
const ROWS: readonly Row[] = [
  { line: 'position: absolute | relative · any; absolute pins to the slide or a position:relative div', props: { position: kwProp(['absolute', 'relative'], ['any']) } },
  {
    line: 'left top right bottom: LEN | PCT | auto; left/top also calc(PCT ± LEN) · pinned only (relative does not offset)',
    props: {
      left: { kind: 'len', on: ['pinned'], check: one((t) => isOffset(t) || isCalcOffset(t)) },
      top: { kind: 'len', on: ['pinned'], check: one((t) => isOffset(t) || isCalcOffset(t)) },
      right: { kind: 'len', on: ['pinned'], check: one(isOffset) },
      bottom: { kind: 'len', on: ['pinned'], check: one(isOffset) },
    },
  },
  {
    line: 'width height: LEN | auto | PCT (pinned, td/th, or along a flex row/column = that share) · any',
    props: { width: { kind: 'len', on: ['any'], check: one(isSize) }, height: { kind: 'len', on: ['any'], check: one(isSize) } },
  },
  { line: 'min-width: LEN | min-content | max-content · div child', props: { 'min-width': { kind: 'len', on: ['div-child'], check: one((t) => isLen(t, 0) || isKw(t, ['min-content', 'max-content'])) } } },
  {
    line: 'min-height max-width max-height: LEN · div child',
    props: Object.fromEntries(['min-height', 'max-width', 'max-height'].map((p) => [p, { kind: 'len', on: ['div-child'], check: one((t) => isLen(t, 0)) } satisfies Prop])),
  },
  { line: 'display: flex | grid | none (no display = column) · section div', props: { display: kwProp(['flex', 'grid', 'none'], ['section', 'div']) } },
  { line: 'flex-direction: row | column [-reverse] · flex box', props: { 'flex-direction': kwProp(['row', 'column', 'row-reverse', 'column-reverse'], ['flex-box']) } },
  { line: 'flex-wrap: wrap | nowrap · row div', props: { 'flex-wrap': kwProp(['wrap', 'nowrap'], ['row-div']) } },
  { line: 'gap: LEN 0–512, one value · section div', props: { gap: { kind: 'len', on: ['section', 'div'], check: one((t) => isLen(t, 0, 512)) } } },
  { line: 'align-items: ALIGN · section div', props: { 'align-items': kwProp(ALIGN, ['section', 'div']) } },
  { line: 'justify-content: start | center | end | space-between | space-around | space-evenly · flex box, not grid', props: { 'justify-content': kwProp(JUSTIFY, ['flex-box']) } },
  { line: 'justify-items: ALIGN, no baseline · grid box', props: { 'justify-items': kwProp(ALIGN.filter((a) => a !== 'baseline'), ['grid-box']) } },
  { line: 'align-self: ALIGN | auto · div child', props: { 'align-self': kwProp([...ALIGN, 'auto'], ['div-child']) } },
  { line: 'justify-self: ALIGN | auto, no baseline · grid child', props: { 'justify-self': kwProp([...ALIGN.filter((a) => a !== 'baseline'), 'auto'], ['grid-child']) } },
  { line: 'flex: none | auto | N [N] [LEN | 0% | auto] (flex:1 = equal share; empty div + flex:1 = spacer) · div child', props: { flex: { kind: 'flex', on: ['div-child'], check: isFlex } } },
  {
    line: 'flex-grow flex-shrink: N · div child',
    props: { 'flex-grow': { kind: 'num', on: ['div-child'], check: one((t) => isBare(t, 0)) }, 'flex-shrink': { kind: 'num', on: ['div-child'], check: one((t) => isBare(t, 0)) } },
  },
  { line: 'flex-basis: LEN | auto · div child', props: { 'flex-basis': { kind: 'len', on: ['div-child'], check: one((t) => isLen(t, 0) || isKw(t, ['auto'])) } } },
  {
    line: 'grid-template-columns grid-template-rows: (LEN | Nfr | auto | repeat(INT, …))+ ≤24 tracks — no minmax, auto-fill, names, areas · grid box',
    props: { 'grid-template-columns': { kind: 'tracks', on: ['grid-box'], check: isTracks }, 'grid-template-rows': { kind: 'tracks', on: ['grid-box'], check: isTracks } },
  },
  {
    line: 'grid-column grid-row: span INT only (cells fill in source order) · grid child',
    props: { 'grid-column': { kind: 'value', on: ['grid-child'], check: isSpan }, 'grid-row': { kind: 'value', on: ['grid-child'], check: isSpan } },
  },
  { line: 'aspect-ratio: N | N / N · div child', props: { 'aspect-ratio': { kind: 'value', on: ['div-child'], check: isRatio } } },
  { line: 'padding: LEN 0–256 ×1–4 · section div text table; td/th: one per table, ≤64', props: { padding: { kind: 'lens', on: ['section', 'div', 'text', 'table', 'cell'], check: (ts) => ts.length >= 1 && ts.length <= 4 && ts.every((t) => isLen(t, 0, 256)) } } },
  { line: 'overflow: hidden | visible · div', props: { overflow: kwProp(['hidden', 'visible'], ['div']) } },
  { line: 'font-family: FAMILY · text table; on body/section/div it inherits', props: { 'font-family': { kind: 'family', on: ['text', 'inherits', 'table'], check: isFamily } } },
  { line: 'font-size: LEN 8–400 (Npt converts) · text table; inherits into p/li, not h1–h3', props: { 'font-size': { kind: 'len', on: ['text', 'inherits', 'table'], check: one((t) => isLen(t, 8, 400)) } } },
  { line: 'font-weight: 100–900 (whole hundreds) | normal | bold · text th; span (≥600 = bold)', props: { 'font-weight': { kind: 'weight', on: ['text', 'inherits', 'th'], check: one((t) => isWild(t) || normWeight([t]) !== null) } } },
  { line: 'font-style: normal | italic · text span', props: { 'font-style': kwProp(['normal', 'italic'], ['text', 'inherits']) } },
  { line: 'font: [italic] [weight] LEN[/N] FAMILY · text', props: {} },
  { line: 'line-height: N | PCT | LEN (0.5–4× the font-size) · text', props: { 'line-height': { kind: 'lineheight', on: ['text', 'inherits'], check: one((t) => isBare(t, 0.5, 4) || isPct(t, 50, 400) || ((unitOf(t) === 'px' || unitOf(t) === 'pt') && isLen(t, 0))) } } },
  { line: 'letter-spacing: LEN | Nem (−24–32px) | normal · text', props: { 'letter-spacing': { kind: 'len', on: ['text', 'inherits'], check: one((t) => isLen(t, -24, 32) || unitOf(t) === 'em' || isKw(t, ['normal'])) } } },
  { line: 'text-align: left | center | right | justify (not td) · text td/th', props: { 'text-align': kwProp(['left', 'center', 'right', 'justify'], ['text', 'inherits', 'cell']) } },
  { line: 'text-transform: none | uppercase | lowercase | capitalize · text', props: { 'text-transform': kwProp(['none', 'uppercase', 'lowercase', 'capitalize'], ['text', 'inherits']) } },
  { line: 'white-space: normal | nowrap · text', props: { 'white-space': kwProp(['normal', 'nowrap'], ['text', 'inherits']) } },
  { line: 'text-decoration: none | underline | line-through [solid | double | dotted | dashed | wavy] [COLOR] · text; span: underline only', props: { 'text-decoration': { kind: 'value', on: ['text'], check: isDecoration } } },
  { line: 'font-variant-numeric: normal | tabular-nums · text', props: { 'font-variant-numeric': kwProp(['normal', 'tabular-nums'], ['text', 'inherits']) } },
  { line: '-webkit-text-stroke: LEN 0–8 COLOR · text', props: { '-webkit-text-stroke': { kind: 'lenvalue', on: ['text', 'inherits'], check: isStroke } } },
  { line: 'color: COLOR · text span td/th x-icon x-connector hr; table (it inherits, as the Tables paragraph says)', props: { color: { kind: 'color', on: ['text', 'inherits', 'table', 'cell', 'x-icon', 'x-connector', 'hr'], check: one(isColor) } } },
  {
    line: 'background: COLOR | [repeating-]linear-gradient(ANGLE | to SIDE, COLOR [PCT [PCT]], … 2–8 stops; repeating: px stops) | radial-gradient([circle|ellipse] [at X% Y%], …); one gradient[, COLOR under it] · section div text img table x-icon; tr: COLOR; x-shape/hr = flat fill',
    props: { background: { kind: 'value', on: ['section', 'div', 'text', 'img', 'table', 'x-icon', 'tr', 'x-shape', 'hr'], check: isBackground } },
  },
  {
    line: 'background-clip: text (+ -webkit-text-fill-color: transparent): glyphs take the gradient | url(IMG) [center / cover|contain]; color = fallback; span: -webkit-text-fill-color: currentcolor · text',
    props: {
      'background-clip': kwProp(['text'], ['text']),
      '-webkit-text-fill-color': { kind: 'color', on: ['text', 'inherits'], check: one((t) => isColor(t) || isKw(t, ['currentcolor'])) },
    },
  },
  { line: 'border: [LEN 0–16, else 1] solid | dashed | dotted | double | none [COLOR, else black] — one stroke; the style word is required · div text img table x-icon; = the stroke on x-shape hr x-connector (≤32)', props: { border: { kind: 'border', on: ['div', 'text', 'img', 'table', 'x-icon', 'x-shape', 'hr', 'x-connector'], check: isBorder } } },
  {
    line: 'border-top -right -bottom -left: as border | none; one style+color, any widths · div text img table x-icon; hr: border-top = its stroke',
    props: Object.fromEntries(['top', 'right', 'bottom', 'left'].map((side) => [`border-${side}`, { kind: 'border', on: ['div', 'text', 'img', 'table', 'x-icon', ...(side === 'top' ? ['hr' as const] : [])], check: isBorder } satisfies Prop])),
  },
  { line: 'border-width: LEN 0–32 · x-connector (MAWS: its stroke, 2px default)', props: { 'border-width': { kind: 'len', on: ['x-connector'], check: one((t) => isLen(t, 0, 32)) } } },
  { line: 'border-style: solid | dashed | dotted | double | none · x-connector (MAWS)', props: { 'border-style': kwProp(BORDER_STYLES, ['x-connector']) } },
  { line: 'border-radius: LEN | PCT ×1–4 (TL TR BR BL); 50%=pill · div text img table; rect x-shape', props: { 'border-radius': { kind: 'lens', on: ['div', 'text', 'img', 'table', 'rect-shape'], check: (ts) => ts.length >= 1 && ts.length <= 4 && ts.every((t) => isLen(t, 0) || isPct(t, 0)) } } },
  { line: 'box-shadow: [inset] LEN LEN [LEN [LEN]] COLOR, … ≤8 (x y ±64, blur ≤160, spread ±32) · div text img table x-icon x-shape', props: { 'box-shadow': { kind: 'lenvalue', on: ['div', 'text', 'img', 'table', 'x-icon', 'x-shape'], check: (ts) => isShadows(ts, true) } } },
  { line: 'text-shadow: LEN LEN [LEN] COLOR, … ≤8 (blur ≤64) · text table', props: { 'text-shadow': { kind: 'lenvalue', on: ['text', 'inherits', 'table'], check: (ts) => isShadows(ts, false) } } },
  { line: 'opacity: N 0–1 · any', props: { opacity: { kind: 'num', on: ['any'], check: one((t) => isBare(t, 0, 1)) } } },
  { line: 'transform: translate(LEN[, LEN]) | translateX|Y(LEN | -50%), rotate(ANGLE), scale(N 0.5–2), skew[X|Y](ANGLE ±60) — any subset in that order, each once · any but x-connector; x-shape: rotate only', props: { transform: { kind: 'value', on: ['not-connector'], check: isTransform } } },
  {
    line: 'filter backdrop-filter: blur(LEN ≤20) brightness|contrast(N 0–2) saturate(N 0–3) grayscale|sepia|invert(N 0–1) hue-rotate(ANGLE) — any subset · div text img x-shape',
    props: { filter: { kind: 'value', on: ['div', 'text', 'img', 'x-shape'], check: isFilter }, 'backdrop-filter': { kind: 'value', on: ['div', 'text', 'img', 'x-shape'], check: isFilter } },
  },
  { line: 'mix-blend-mode: normal | multiply | screen | overlay | darken | lighten · div text img x-shape', props: { 'mix-blend-mode': kwProp(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'], ['div', 'text', 'img', 'x-shape']) } },
  { line: 'object-fit: cover | contain · img', props: { 'object-fit': kwProp(['cover', 'contain'], ['img']) } },
  { line: 'accepted as no-ops only: margin | box-sizing | grid-template | position (0, border-box, none, static)', props: {} },
];

/** The format reference's CSS block, line for line (format.md's ```css block; a test holds them equal). */
export const CSS_GRAMMAR: readonly string[] = [...DEFINITIONS, '', ...ROWS.map((r) => r.line)];

export const PROPS: ReadonlyMap<string, Prop> = new Map(ROWS.flatMap((r) => Object.entries(r.props)));
const LINE_OF = new Map(ROWS.flatMap((r) => Object.keys(r.props).map((p) => [p, r.line] as const)));
/** A property's grammar (its line before ` · `) and its applies-to column (after), for diagnostics. */
const grammarOf = (prop: string): string => (LINE_OF.get(prop) ?? prop).split(' · ')[0]!;
const appliesOf = (prop: string): string => (LINE_OF.get(prop) ?? '').split(' · ')[1] ?? '';
const PROP_RANK = new Map([...PROPS.keys()].map((k, i) => [k, i]));

// ---------------------------------------------------------------- scalar normalizers (S6)

export function fmtNum(n: number): string {
  const s = String(n);
  return s === '-0' ? '0' : s;
}

/** A number with an optional unit; bare numbers become px when `bareIsPx`; pt converts at the slide scale (1px = 0.5pt). */
function normNumber(w: string, bareIsPx: boolean): string | null {
  const m = NUM_RE.exec(w);
  if (!m) return null;
  let n = Number(m[1]);
  let unit = m[2]!.toLowerCase();
  if (unit === 'pt') {
    n = n * 2;
    unit = 'px';
  }
  if (unit === '' && bareIsPx) unit = 'px';
  return fmtNum(n) + unit;
}

function hex2(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0');
}

/** Canonical colour: lowercase 6/8-digit hex for exact sRGB values, normalized rgba()/hsl[a]() otherwise, lowercase names. */
export function normColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === 'transparent') return v;
  if (NAMED.has(v)) return v;
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    if (h.length === 8 && h.endsWith('ff')) h = h.slice(0, 6);
    return '#' + h;
  }
  m = /^(rgba?|hsla?)\((.*)\)$/.exec(v);
  if (!m) return null;
  const parts = m[2]!.replace(/\s*\/\s*/, ',').split(/\s*,\s*|\s+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const alphaRaw = parts[3];
  let alpha = 1;
  if (alphaRaw !== undefined) {
    const am = NUM_RE.exec(alphaRaw);
    if (!am) return null;
    alpha = am[2] === '%' ? Number(am[1]) / 100 : Number(am[1]);
  }
  if (m[1]!.startsWith('rgb')) {
    const ch = parts.slice(0, 3).map((p) => {
      const pm = NUM_RE.exec(p);
      if (!pm) return NaN;
      return pm[2] === '%' ? Number(pm[1]) * 2.55 : Number(pm[1]);
    });
    if (ch.some((c) => Number.isNaN(c))) return null;
    const exact = ch.every((c) => Number.isInteger(c) && c >= 0 && c <= 255);
    if (exact && alpha === 1) return '#' + ch.map(hex2).join('');
    return `rgba(${ch.map(fmtNum).join(', ')}, ${fmtNum(alpha)})`;
  }
  const [h, s, l] = parts as [string, string, string];
  const hn = normNumber(h, false);
  const sn = normNumber(s, false);
  const ln = normNumber(l, false);
  if (!hn || !sn || !ln) return null;
  return alpha === 1 ? `hsl(${hn.replace(/deg$/, '')}, ${sn}, ${ln})` : `hsla(${hn.replace(/deg$/, '')}, ${sn}, ${ln}, ${fmtNum(alpha)})`;
}

/** var(--ds-*) is the one var() the dialect allows (Decision Log 12), optionally with a fallback. */
function normVar(fn: Fn, bareIsPx: boolean): string | null {
  const parts = varParts(fn);
  if (!parts) return null;
  return parts.fallback === null ? `var(${parts.name})` : `var(${parts.name}, ${serTokens(parts.fallback, bareIsPx)})`;
}

// ---------------------------------------------------------------- generic value serialization (S6)

/** Functions whose bare numeric arguments are lengths; every other function keeps bare numbers bare. */
const LEN_FNS = new Set(['translate', 'translatex', 'translatey', 'blur', 'calc']);
const COLOR_FNS = new Set(['rgb', 'rgba', 'hsl', 'hsla']);

function serTok(t: Tok, bareIsPx: boolean): string {
  switch (t.t) {
    case 'comma':
      return ',';
    case 'slash':
      return '/';
    case 'str':
      return `'${t.v.replace(/'/g, "\\'")}'`;
    case 'fn': {
      if (COLOR_FNS.has(t.name)) return normColor(`${t.name}(${serTokens(t.args, false)})`) ?? `${t.name}(${serTokens(t.args, false)})`;
      if (t.name === 'var') return normVar(t, bareIsPx) ?? 'var(INVALID)';
      if (t.name === 'url') return `url(${(t.args[0] as { v: string }).v})`;
      if (t.name.startsWith('repeating-')) {
        // a repeating gradient's stops are lengths (bare = px); its direction is not
        const parts = splitCommas(t.args).map((part) => serTokens(part, isColor(expandVars(part)[0])));
        return `${t.name}(${parts.join(', ')})`;
      }
      const inner = t.name === 'calc' ? serCalc(t.args) : serTokens(t.args, LEN_FNS.has(t.name));
      return `${t.name}(${inner})`;
    }
    case 'word': {
      const v = t.v;
      if (v.startsWith('#')) return normColor(v) ?? v.toLowerCase();
      const n = normNumber(v, bareIsPx);
      if (n !== null) return n;
      return v.toLowerCase();
    }
  }
}
function serTokens(ts: Tok[], bareIsPx: boolean): string {
  let s = '';
  ts.forEach((t, i) => {
    const part = serTok(t, bareIsPx);
    if (t.t === 'comma') s += ', ';
    else if (t.t === 'slash') s += ' / ';
    else s += (i === 0 || ts[i - 1]!.t === 'comma' || ts[i - 1]!.t === 'slash' ? '' : ' ') + part;
  });
  return s.replace(/ {2,}/g, ' ').replace(/ ,/g, ',');
}
function serCalc(ts: Tok[]): string {
  return ts.map((t) => serTok(t, true)).join(' ');
}

// ---------------------------------------------------------------- per-kind normalizers (S6)

function normLen(ts: Tok[]): string | null {
  if (ts.length !== 1) return null;
  const t = ts[0]!;
  if (t.t === 'fn' && (t.name === 'var' || t.name === 'calc')) return serTok(t, true);
  if (t.t !== 'word') return null;
  const n = normNumber(t.v, true);
  if (n !== null) return /^-?[\d.e+-]+(px|%|em)$/.test(n) ? n : null;
  const k = t.v.toLowerCase();
  return ['auto', 'normal', 'min-content', 'max-content'].includes(k) ? k : null;
}

function compress4(v: string[]): string[] {
  const [a, b = a, c = a, d = b] = v as [string, ...string[]];
  if (d === b) {
    if (c === a) {
      if (b === a) return [a];
      return [a, b];
    }
    return [a, b, c];
  }
  return [a, b, c, d];
}
function expand4(v: string): string[] {
  const [a, b = a, c = a, d = b] = v.split(' ') as [string, ...string[]];
  return [a, b, c, d];
}

function normLens(ts: Tok[]): string | null {
  const parts: string[] = [];
  for (const t of ts) {
    const n = normLen([t]);
    if (n === null) return null;
    parts.push(n);
  }
  if (parts.length < 1 || parts.length > 4) return null;
  return compress4(parts).join(' ');
}

function normFamily(ts: Tok[]): string | null {
  const names: string[] = [];
  let cur: Tok[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    if (cur.length === 1 && cur[0]!.t === 'fn' && cur[0]!.name === 'var') {
      names.push(serTok(cur[0]!, false));
      cur = [];
      return;
    }
    const name = cur.map((t) => (t.t === 'str' || t.t === 'word' ? t.v : '')).join(' ').trim();
    const lower = name.toLowerCase();
    if (cur.length === 1 && cur[0]!.t === 'word' && GENERIC_FAMILIES.has(lower)) names.push(lower);
    else names.push(/^[A-Za-z][A-Za-z-]*$/.test(name) ? name : `'${name.replace(/'/g, "\\'")}'`);
    cur = [];
  };
  for (const t of ts) {
    if (t.t === 'comma') flush();
    else cur.push(t);
  }
  flush();
  return names.length ? names.join(', ') : null;
}

function normWeight(ts: Tok[]): string | null {
  if (ts.length !== 1 || ts[0]!.t !== 'word') return null;
  const v = ts[0]!.v.toLowerCase();
  if (v === 'normal') return '400';
  if (v === 'bold') return '700';
  return /^[1-9]00$/.test(v) ? v : null;
}

/**
 * `[LEN] style [COLOR]` with Claude's defaults (1px, black) made explicit, so the file means the same in any CSS
 * engine. Tokens take their slots as placeBorder places them (by fallback, else by position).
 */
function normBorder(ts: Tok[]): string | null {
  const placed = placeBorder(ts);
  if (!placed?.style) return null;
  const { width, style, color } = placed;
  const isVar = (t: Tok) => t.t === 'fn' && t.name === 'var';
  if (style.t === 'word' && style.v.toLowerCase() === 'none') return 'none';
  const w = width === undefined ? '1px' : isVar(width) ? serTok(width, true) : normLen([width]);
  const c = color === undefined ? 'black' : isVar(color) ? serTok(color, false) : normColor(color.t === 'word' ? color.v : serTok(color, false));
  return w === null || c === null ? null : `${w} ${serTok(style, false)} ${c}`;
}

function normLineHeight(ts: Tok[]): string | null {
  if (ts.length !== 1 || ts[0]!.t !== 'word') return ts.length === 1 && ts[0]!.t === 'fn' && ts[0]!.name === 'var' ? serTok(ts[0]!, false) : null;
  const n = normNumber(ts[0]!.v, false); // bare stays a multiplier
  return n !== null && /^[\d.-]+(px|%)?$/.test(n) ? n : null;
}

// ---------------------------------------------------------------- one value

const LEN_KINDS = new Set<Kind>(['len', 'lens', 'border', 'lenvalue']);

export type ValueCheck = { ok: true; value: string } | { ok: false; reason: string };

/** A value checked against its property's line and normalized; the reason names what is wrong when it is not. */
export function checkValue(prop: string, value: string): ValueCheck {
  const spec = PROPS.get(prop);
  if (!spec) return { ok: false, reason: `${prop} is not in the dialect` };
  const v = value.replace(/\s*!important\s*$/i, '');
  const ts = tokenize(v);
  if (ts.length === 0) return { ok: false, reason: `${prop} has no value` };
  if (hasInvalidVar(ts)) return { ok: false, reason: `${prop}:${value} uses a var() other than var(--ds-*) (the design system's tokens)` };
  if (hasCurrentColor(ts) && prop !== '-webkit-text-fill-color') return { ok: false, reason: `${prop}:${value} uses currentcolor` };
  const outside = { ok: false, reason: `${prop}:${value} is outside its grammar (${grammarOf(prop)})` } as const;
  if (!spec.check(expandVars(ts))) return outside;
  const out = ts.length === 1 && ts[0]!.t === 'fn' && ts[0]!.name === 'var' ? serTok(ts[0]!, LEN_KINDS.has(spec.kind)) : normalize(spec, ts, v);
  return out === null ? outside : { ok: true, value: out };
}

/** Normalize one value for a property in the table; null = outside its line. */
export function normValue(prop: string, value: string): string | null {
  const r = checkValue(prop, value);
  return r.ok ? r.value : null;
}

function normalize(spec: Prop, ts: Tok[], v: string): string | null {
  switch (spec.kind) {
    case 'len':
      return normLen(ts);
    case 'lens':
      return normLens(ts);
    case 'num': {
      if (ts.length !== 1 || ts[0]!.t !== 'word') return null;
      const n = normNumber(ts[0]!.v, false);
      return n !== null && /^[\d.e+-]+$/.test(n) ? n : null;
    }
    case 'weight':
      return normWeight(ts);
    case 'color':
      return ts.length === 1 ? normColor(v) : null;
    case 'family':
      return normFamily(ts);
    case 'lineheight':
      return normLineHeight(ts);
    case 'kw':
      return ts.length === 1 && ts[0]!.t === 'word' ? ts[0]!.v.toLowerCase() : null;
    case 'border':
      return normBorder(ts);
    case 'lenvalue':
      return serTokens(ts, true);
    case 'value':
      return serTokens(ts, false);
    case 'flex':
      return normFlex(ts);
    case 'tracks':
      return normTracks(ts);
  }
}

/**
 * `flex`: grow, then shrink, then the basis, each position read as isFlex reads it (a token by its fallback): a factor
 * stays a number (its fallback too), the basis is a length.
 */
function normFlex(ts: Tok[]): string {
  const isFactor = (t: Tok, i: number) => {
    const expanded = expandVars([t]);
    return i === 0 || (i === 1 && expanded.length === 1 && isBare(expanded[0], 0));
  };
  return ts.map((t, i) => (isFactor(t, i) ? serTok(t, false) : t.t === 'word' ? (normLen([t]) ?? serTok(t, false)) : serTok(t, true))).join(' ');
}

/** A track list: a bare length is px, `fr` and `auto` stay, a `repeat()` keeps its count and normalizes its tracks. */
function normTracks(ts: Tok[]): string {
  return ts
    .map((t) => {
      if (t.t !== 'fn' || t.name !== 'repeat') return serTok(t, true);
      const [count, tracks] = splitCommas(t.args) as [Tok[], Tok[]];
      return `repeat(${serTokens(count, false)}, ${normTracks(tracks)})`;
    })
    .join(' ');
}

// ---------------------------------------------------------------- applies-to

/** Where a style attribute sits: the element (the section is `'section'`), its attributes and its parent. */
export interface StyleSite {
  tag: Tag | 'section';
  attrs: Attrs;
  parent: { tag: Tag | 'section'; style: Style } | null;
}

const TEXT_ELEMENTS = new Set<string>(['h1', 'h2', 'h3', 'p', 'ul', 'ol']);

function hits(target: Target, site: StyleSite, style: Style): boolean {
  const { tag, parent } = site;
  const pinned = tag !== 'section' && isPinned(tag, style, site.attrs);
  const container = tag === 'section' || tag === 'div';
  // a section or div without display is a flex column; with display:flex and no direction, a row (CSS)
  const flex = container && (style.display ?? 'flex') === 'flex';
  const direction = style['flex-direction'] ?? (style.display === undefined ? 'column' : 'row');
  switch (target) {
    case 'any':
      return true;
    case 'not-connector':
      return tag !== 'x-connector';
    case 'pinned':
      return pinned;
    case 'div-child':
      return !pinned && (parent?.tag === 'div' || parent?.tag === 'section');
    case 'grid-child':
      return !pinned && parent?.style.display === 'grid';
    case 'flex-box':
      return flex;
    case 'row-div':
      return flex && direction.startsWith('row');
    case 'grid-box':
      return container && style.display === 'grid';
    case 'text':
      return TEXT_ELEMENTS.has(tag);
    case 'inherits':
      return container;
    case 'cell':
      return tag === 'td' || tag === 'th';
    case 'rect-shape':
      return tag === 'x-shape' && site.attrs.kind === 'rect';
    default:
      return tag === target;
  }
}

/** Whether a property (in the table) applies to the element at `site` whose style is `style`. */
export function appliesTo(prop: string, site: StyleSite, style: Style): boolean {
  const spec = PROPS.get(prop);
  return spec !== undefined && spec.on.some((target) => hits(target, site, style));
}

/** The per-element limits on a value the table states beside its applies-to column; a reason, or null when it is fine. */
function restriction(prop: string, value: string, site: StyleSite): string | null {
  const { tag } = site;
  // checked on the value as its fallbacks make it; a token with no fallback stands for any one component
  const ts = expandVars(tokenize(value));
  if (prop === 'background' && (tag === 'tr' || tag === 'x-shape' || tag === 'hr') && (ts.length !== 1 || !isColor(ts[0]))) return `background on <${tag}> is a flat colour`;
  if (/^border(-top|-right|-bottom|-left)?$/.test(prop) && tag !== 'x-shape' && tag !== 'hr' && tag !== 'x-connector') {
    const width = placeBorder(ts)?.width;
    if (width !== undefined && !isLen(width, 0, 16)) return `a border on <${tag}> is at most 16px wide (32px on x-shape, hr and x-connector)`;
  }
  if (prop === 'padding' && (tag === 'td' || tag === 'th') && !ts.every((t) => isLen(t, 0, 64))) return 'a cell’s padding is at most 64px';
  if (prop === 'transform' && tag === 'x-shape' && !ts.every((t) => isWild(t) || (t.t === 'fn' && t.name === 'rotate'))) return 'an x-shape takes rotate only';
  if (tag === 'x-connector' && site.attrs.x1 !== undefined && ['left', 'top', 'right', 'bottom', 'width', 'height'].includes(prop)) {
    return 'a connector with coordinates takes no left, top, right, bottom, width or height';
  }
  return null;
}

// ---------------------------------------------------------------- the style attribute

/** Split a style attribute into declarations, respecting parentheses and quotes (`url(a;b)`, `'a;b'`). */
export function splitDecls(style: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const push = (end: number) => {
    const d = style.slice(start, end);
    const i = d.indexOf(':');
    if (i > 0) out.push([d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()]);
    start = end + 1;
  };
  for (let i = 0; i < style.length; i++) {
    const c = style[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) push(i);
  }
  push(style.length);
  return out;
}

/** A style diagnostic before the loader adds the slide and the element. */
export interface StyleDiagnostic {
  severity: 'warning' | 'note';
  property: string;
  message: string;
}

/**
 * Parse a style attribute into the canonical property map. Applies the cascade inside the attribute (a later
 * declaration wins; a shorthand resets its earlier longhands), folds longhands Claude's list lacks into the
 * shorthands it has (padding-*, border-*-radius, background-color, font), drops no-ops with a note and everything
 * else outside the table — an unknown property, a value outside its line, a property the element does not take —
 * with a warning.
 */
export function parseStyle(style: string, site: StyleSite, report: (d: StyleDiagnostic) => void): Style {
  const out: Style = {};
  const warn = (property: string, message: string) => report({ severity: 'warning', property, message });
  const note = (property: string, message: string) => report({ severity: 'note', property, message });
  const set = (prop: string, val: string) => {
    for (const lh of RESETS[prop] ?? []) delete out[lh];
    delete out[prop];
    out[prop] = val; // re-insert so the cascade's last writer is last
  };
  const accept = (prop: string, raw: string) => {
    if (!PROPS.has(prop)) return warn(prop, `${prop} is not in the dialect; dropped`);
    const r = checkValue(prop, raw);
    if (!r.ok) return warn(prop, `${r.reason}; dropped`);
    set(prop, r.value);
  };
  for (const [prop, raw] of splitDecls(style)) {
    const lower = raw.trim().toLowerCase();
    if (prop === 'position' && lower === 'static') {
      note(prop, 'position:static dropped (a no-op)');
      continue;
    }
    if (prop in NOOPS) {
      if (NOOPS[prop]!(lower)) note(prop, `${prop}:${raw} dropped (a no-op)`);
      else warn(prop, `${prop}:${raw} dropped (only accepted as a no-op: margin:0, box-sizing:border-box, grid-template:none)`);
      continue;
    }
    if (prop === 'background-color') {
      const r = checkValue('color', raw);
      if (!r.ok) warn(prop, `background-color:${raw} is not a colour; dropped`);
      else if (out.background === undefined) {
        set('background', r.value);
        note(prop, 'background-color folded into background');
      } else warn(prop, 'background-color dropped (background already set)');
      continue;
    }
    const side = /^padding-(top|right|bottom|left)$/.exec(prop);
    const corner = /^border-(top-left|top-right|bottom-right|bottom-left)-radius$/.exec(prop);
    if (side || corner) {
      const target = side ? 'padding' : 'border-radius';
      const idx = side ? SIDES.indexOf(side[1] as (typeof SIDES)[number]) : CORNERS.indexOf(corner![1] as (typeof CORNERS)[number]);
      const part = checkValue(target, raw);
      if (!part.ok || part.value.includes(' ')) {
        warn(prop, `${prop}:${raw} is outside its grammar (${grammarOf(target)}); dropped`);
        continue;
      }
      const four = expand4(out[target] ?? '0px');
      four[idx] = part.value;
      set(target, compress4(four).join(' '));
      note(prop, `${prop} folded into ${target}`);
      continue;
    }
    if (prop === 'font') {
      const parts = expandFont(raw);
      if (parts === null) warn(prop, `font:${raw} is outside its grammar (font: [italic] [weight] LEN[/N] FAMILY); dropped`);
      else {
        note(prop, 'font shorthand expanded into longhands');
        for (const [p, v] of parts) accept(p, v);
      }
      continue;
    }
    accept(prop, raw);
  }
  return applies(out, site, warn, note);
}

/** The applies-to column and the per-element limits, then the notes on tokens a system may not define. */
function applies(style: Style, site: StyleSite, warn: (p: string, m: string) => void, note: (p: string, m: string) => void): Style {
  const where = site.tag === 'section' ? 'the section' : `<${site.tag}>`;
  // position and display decide what the rest applies to; both depend on the element alone
  for (const prop of ['position', 'display']) {
    if (style[prop] !== undefined && !appliesTo(prop, site, style)) {
      warn(prop, `${prop} does not apply to ${where} (it applies to: ${appliesOf(prop)}); dropped`);
      delete style[prop];
    }
  }
  for (const prop of Object.keys(style)) {
    const value = style[prop]!;
    if (!appliesTo(prop, site, style)) {
      warn(prop, `${prop} does not apply to ${where} (it applies to: ${appliesOf(prop)}); dropped`);
      delete style[prop];
      continue;
    }
    const limit = restriction(prop, value, site);
    if (limit !== null) {
      warn(prop, `${prop}:${value} dropped: ${limit}`);
      delete style[prop];
      continue;
    }
  }
  const lh = /^([\d.]+)px$/.exec(style['line-height'] ?? '');
  const fs = /^([\d.]+)px$/.exec(style['font-size'] ?? '');
  if (lh && fs && !between(Number(lh[1]) / Number(fs[1]), 0.5, 4)) {
    warn('line-height', `line-height:${style['line-height']} is outside 0.5–4× the font-size (${style['font-size']}); dropped`);
    delete style['line-height'];
  }
  for (const [prop, value] of Object.entries(style)) {
    for (const name of bareVarNames(tokenize(value))) {
      if (!SHARED_DS_NAMES.has(name)) note(prop, `${name} is not one every design system defines; give a fallback: var(${name}, <value>)`);
    }
  }
  return style;
}

/** `font: [italic] [weight] LEN[/N] FAMILY` as longhands (only the parts given; S6's pitfall on inheritance). */
function expandFont(raw: string): [string, string][] | null {
  const ts = tokenize(raw);
  const out: [string, string][] = [];
  let i = 0;
  while (i < ts.length) {
    const t = ts[i]!;
    if (t.t !== 'word') break;
    const w = t.v.toLowerCase();
    if (w === 'italic' || w === 'normal') {
      if (w === 'italic') out.push(['font-style', 'italic']);
      i++;
      continue;
    }
    if (normWeight([t]) !== null && !/px|pt/.test(w)) {
      out.push(['font-weight', t.v]);
      i++;
      continue;
    }
    break;
  }
  const size = ts[i] ? normLen([ts[i]!]) : null;
  if (size === null) return null;
  out.push(['font-size', size]);
  i++;
  if (ts[i]?.t === 'slash') {
    const lh = ts[i + 1] ? normLineHeight([ts[i + 1]!]) : null;
    if (lh === null) return null;
    out.push(['line-height', lh]);
    i += 2;
  }
  const family = normFamily(ts.slice(i));
  if (family !== null) out.push(['font-family', family]);
  return out;
}

/** Canonical style attribute: Claude's table order, `prop:value` joined by `; `. */
export function serializeStyle(style: Style, resolveVar?: (name: string) => string | undefined): string {
  return Object.keys(style)
    .sort((a, b) => (PROP_RANK.get(a) ?? 999) - (PROP_RANK.get(b) ?? 999) || (a < b ? -1 : 1))
    .map((k) => [k, resolveVar ? resolveVars(style[k]!, resolveVar) : style[k]!] as const)
    .filter(([, v]) => v !== null) // a token the resolver lacks, with no fallback: the property is left out
    .map(([k, v]) => `${k}:${v}`)
    .join('; ');
}

/**
 * For the mirror and the Claude-compatible export (Decision Log 21): every `var(--ds-x[, fb])` to its literal value, the
 * fallback (itself resolved) when the system does not define the name, and null when neither gives one, since the
 * output carries no `var()` (D's `resolveDsVars` keeps such a var; Claude's grammar has none).
 */
export function resolveVars(value: string, resolveVar: (name: string) => string | undefined): string | null {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at === -1) return out + value.slice(i);
    out += value.slice(i, at);
    let depth = 0;
    let end = at + 3;
    for (; end < value.length; end++) {
      if (value[end] === '(') depth++;
      else if (value[end] === ')' && --depth === 0) break;
    }
    const inner = value.slice(at + 4, end);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const literal = resolveVar(name) ?? (comma === -1 ? null : resolveVars(inner.slice(comma + 1).trim(), resolveVar));
    if (literal === null) return null;
    out += literal;
    i = end + 1;
  }
  return out;
}

/** Inline colour on a `span` mark: the colour alone (Claude: "no sizes or fonts on spans"). */
export function spanStyle(style: string, report: (d: StyleDiagnostic) => void): { color?: string; bold: boolean; italic: boolean; underline: boolean } {
  const out: { color?: string; bold: boolean; italic: boolean; underline: boolean } = { bold: false, italic: false, underline: false };
  for (const [prop, raw] of splitDecls(style)) {
    const v = raw.trim().toLowerCase();
    if (prop === 'color') {
      const c = normValue('color', raw);
      if (c) out.color = c;
      else report({ severity: 'warning', property: prop, message: `span color:${raw} is not a colour; dropped` });
    } else if (prop === 'font-weight' && (v === 'bold' || Number(v) >= 600)) {
      out.bold = true;
      report({ severity: 'note', property: prop, message: 'span font-weight became <b>' });
    } else if (prop === 'font-style' && v === 'italic') {
      out.italic = true;
      report({ severity: 'note', property: prop, message: 'span font-style became <i>' });
    } else if (prop === 'text-decoration' && v.startsWith('underline')) {
      out.underline = true;
      report({ severity: 'note', property: prop, message: 'span underline became <u>' });
    } else report({ severity: 'warning', property: prop, message: `span ${prop} dropped (spans carry colour only)` });
  }
  return out;
}
