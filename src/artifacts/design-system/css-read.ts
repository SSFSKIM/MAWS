// Reading CSS text without a DOM: declaration lists (a `style` attribute), stylesheets (`components/document.css`),
// and the values the canon check and the Claude converter compare (colours, lengths, font stacks, box shadows). Raw
// text is read rather than a browser's CSSOM, because a CSSOM rewrites what it reads (a hex becomes `rgb()`, an unknown
// property vanishes) differently in each engine, and the check must judge what the author wrote. Portable (§4.10).
import { colorFromHex, round4, type ColorSpace, type ColorValue } from './color';
import { ColorValueSchema, type DimensionValue, type ShadowLayer } from './values';

export interface Declaration {
  /** Lower-cased, except a custom property (`--Name`), whose case is its identity. */
  property: string;
  /** As written, trimmed, without `!important`. */
  value: string;
}

// --- Scanning --------------------------------------------------------------------------------------------------------

/** Removes `/* … *\/` comments outside strings. */
export function stripComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end - 1;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      out += ' ';
    } else out += ch;
  }
  return out;
}

/** The index just past the string that opens at `start` (or the text's end). */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === quote || text[i] === '\n') return i + 1;
  }
  return text.length;
}

/** Splits at `sep` (`' '` for any whitespace run) outside parentheses, brackets and strings; empty parts are dropped. */
export function splitTopLevel(text: string, sep: ',' | ';' | ' '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\') i++;
    else if (ch === '"' || ch === "'") i = stringEnd(text, i) - 1;
    else if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    else if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The index just past the parenthesis that closes the one at `open`. */
function parenEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\') i++;
    else if (ch === '"' || ch === "'") i = stringEnd(text, i) - 1;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  return text.length;
}

/** The custom properties a value reads, fallbacks included, in order. */
export const varNamesIn = (value: string): string[] => [...value.matchAll(/var\(\s*(--[^\s,)]+)/gi)].map((m) => m[1]!);

/** The targets of a value's `url()` calls. */
export const urlsIn = (value: string): string[] =>
  [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim());

/** `value` with every `var(…)`, `url(…)` and string blanked out, so what remains is literal. */
function literalPart(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === '"' || ch === "'") {
      const end = stringEnd(value, i);
      out += ' '.repeat(end - i);
      i = end - 1;
      continue;
    }
    const fn = /^(var|url)\(/i.exec(value.slice(i, i + 4));
    if (fn && (i === 0 || !/[\w-]/.test(value[i - 1]!))) {
      const end = parenEnd(value, i + fn[1]!.length);
      out += ' '.repeat(end - i);
      i = end - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

// --- Colours ---------------------------------------------------------------------------------------------------------

// CSS Color 4's named colours (148, rebeccapurple included).
const NAMED_TABLE =
  'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 ' +
  'blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 ' +
  'chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b ' +
  'darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b ' +
  'darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f ' +
  'darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 ' +
  'deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 ' +
  'fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f ' +
  'grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa ' +
  'lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff ' +
  'lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a ' +
  'lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de ' +
  'lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa ' +
  'mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee ' +
  'mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa ' +
  'mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 ' +
  'orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee ' +
  'palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 ' +
  'purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 ' +
  'sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd ' +
  'slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 ' +
  'tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32';
const NAMED = new Map(NAMED_TABLE.split(' ').map((entry) => entry.split(':') as [string, string]));
const COLOR_FUNCTIONS = ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'];
const PREDEFINED: Record<string, ColorSpace> = {
  srgb: 'srgb',
  'srgb-linear': 'srgb-linear',
  'display-p3': 'display-p3',
  'a98-rgb': 'a98-rgb',
  'prophoto-rgb': 'prophoto-rgb',
  rec2020: 'rec2020',
  xyz: 'xyz-d65',
  'xyz-d65': 'xyz-d65',
  'xyz-d50': 'xyz-d50',
};

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;
type Component = number | 'none';

/** A number, or a percentage scaled so 100% is `full`; null otherwise. */
function component(text: string, full: number): Component | null {
  if (text.toLowerCase() === 'none') return 'none';
  const match = NUMBER.exec(text);
  if (!match) return null;
  const rest = text.slice(match[0].length);
  const n = Number(match[0]);
  if (rest === '') return n;
  if (rest === '%') return (n / 100) * full;
  return null;
}

function hue(text: string): Component | null {
  if (text.toLowerCase() === 'none') return 'none';
  const match = NUMBER.exec(text);
  if (!match) return null;
  const unit = text.slice(match[0].length).toLowerCase();
  const scale: Record<string, number> = { '': 1, deg: 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 };
  if (!(unit in scale)) return null;
  const degrees = (Number(match[0]) * scale[unit]!) % 360;
  return degrees < 0 ? degrees + 360 : degrees;
}

const clamp = (c: Component, min: number, max: number): Component => (c === 'none' ? c : Math.min(max, Math.max(min, c)));

/** A CSS colour (a hex, a named colour, `transparent`, or a colour function with plain arguments) as a DTCG value. */
export function parseCssColor(text: string): ColorValue | null {
  const source = text.trim();
  const lower = source.toLowerCase();
  if (lower.startsWith('#')) return colorFromHex(lower);
  if (lower === 'transparent') return { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0 };
  const named = NAMED.get(lower);
  if (named) return colorFromHex(`#${named}`);
  const fn = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(source);
  if (!fn || !COLOR_FUNCTIONS.includes(fn[1]!.toLowerCase())) return null;
  const name = fn[1]!.toLowerCase();
  const inner = fn[2]!.trim();
  if (/[a-z-]+\(/i.test(inner)) return null; // only plain arguments
  let args: string[];
  let alphaText: string | undefined;
  if (inner.includes(',')) {
    args = inner.split(',').map((s) => s.trim());
    if (args.length === 4) alphaText = args.pop();
  } else {
    const [main, alpha, extra] = inner.split('/').map((s) => s.trim());
    if (extra !== undefined || main === undefined) return null;
    args = splitTopLevel(main, ' ');
    alphaText = alpha;
  }
  let colorSpace: ColorSpace;
  let parsed: (Component | null)[];
  if (name === 'color') {
    const space = PREDEFINED[args.shift()?.toLowerCase() ?? ''];
    if (!space) return null;
    colorSpace = space;
    parsed = args.map((a) => component(a, 1));
  } else if (name === 'rgb' || name === 'rgba') {
    colorSpace = 'srgb';
    parsed = args.map((a) => {
      const c = component(a, 255);
      return c === null || c === 'none' ? c : clamp(c / 255, 0, 1);
    });
  } else if (name === 'hsl' || name === 'hsla' || name === 'hwb') {
    colorSpace = name === 'hwb' ? 'hwb' : 'hsl';
    parsed = [hue(args[0] ?? ''), ...args.slice(1).map((a) => {
      const c = component(a, 100);
      return c === null ? c : clamp(c, 0, 100);
    })];
  } else {
    colorSpace = name as ColorSpace;
    const ok = name === 'oklab' || name === 'oklch';
    const lightness = (a: string) => component(a, ok ? 1 : 100);
    const axis = (a: string) => component(a, ok ? 0.4 : name === 'lch' ? 150 : 125);
    parsed = name.endsWith('ch') ? [lightness(args[0] ?? ''), axis(args[1] ?? ''), hue(args[2] ?? '')] : [lightness(args[0] ?? ''), axis(args[1] ?? ''), axis(args[2] ?? '')];
    if (args.length !== 3) return null;
  }
  if (parsed.length !== 3 || parsed.some((c) => c === null)) return null;
  const value: ColorValue = { colorSpace, components: (parsed as Component[]).map((c) => (c === 'none' ? c : round4(c))) };
  if (alphaText !== undefined) {
    const alpha = component(alphaText, 1);
    if (alpha === null) return null;
    if (alpha !== 'none' && alpha < 1) value.alpha = round4(Math.max(0, alpha));
  }
  return ColorValueSchema.safeParse(value).success ? value : null;
}

/** Whether a word is a CSS named colour (`transparent` and `currentcolor` are not: they carry no colour of their own). */
export const isNamedColor = (word: string): boolean => NAMED.has(word.toLowerCase());

/** The colour literals a value writes (hex, named, colour functions), in order; none inside `var()`, `url()` or strings. */
export function colorLiterals(value: string): string[] {
  const text = literalPart(value);
  const found: { at: number; text: string }[] = [];
  const masked = text.replace(new RegExp(`\\b(${COLOR_FUNCTIONS.join('|')})\\(`, 'gi'), (match, _name: string, at: number) => {
    const end = parenEnd(text, at + match.length - 1);
    found.push({ at, text: text.slice(at, end) });
    return ' '.repeat(match.length);
  });
  const blank = found.reduce((acc, f) => acc.slice(0, f.at) + ' '.repeat(f.text.length) + acc.slice(f.at + f.text.length), masked);
  for (const m of blank.matchAll(/#[0-9a-f]+\b/gi)) if ([4, 5, 7, 9].includes(m[0].length)) found.push({ at: m.index, text: m[0] });
  for (const m of blank.matchAll(/(?<![\w-])[a-z]+(?![\w-])/gi)) if (isNamedColor(m[0])) found.push({ at: m.index, text: m[0] });
  return found.sort((a, b) => a.at - b.at).map((f) => f.text);
}

// --- Lengths, fonts, shadows -----------------------------------------------------------------------------------------

/** A number with its unit (`''` for a bare number), lower-cased; null for anything else (`calc()`, a keyword). */
export function parseLength(text: string): { value: number; unit: string } | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i.exec(text.trim());
  return match ? { value: Number(match[1]), unit: match[2]!.toLowerCase() } : null;
}

/** A `font-family` stack as names, unquoted; a `var()` item kept as written. Null when it names nothing. */
export function parseFontStack(text: string): string[] | null {
  const items = splitTopLevel(text, ',');
  if (items.length === 0) return null;
  return items.map((item) => {
    const quoted = /^(["'])([\s\S]*)\1$/.exec(item);
    return quoted ? quoted[2]!.replace(/\\(.)/g, '$1') : item.replace(/\s+/g, ' ');
  });
}

const dimension = (text: string): DimensionValue | null => {
  const length = parseLength(text);
  if (!length) return null;
  if (length.unit === 'px' || length.unit === 'rem') return { value: length.value, unit: length.unit };
  return length.unit === '' && length.value === 0 ? { value: 0, unit: 'px' } : null;
};

/**
 * A `box-shadow` as DTCG shadow layers; `none` is no layer. Lengths must be px, rem or 0; a layer without a colour is
 * black (CSS's own default is `currentcolor`, which a token cannot hold). Null when a layer does not read.
 */
export function parseBoxShadow(text: string): ShadowLayer[] | null {
  if (text.trim().toLowerCase() === 'none') return [];
  const layers: ShadowLayer[] = [];
  for (const layer of splitTopLevel(text, ',')) {
    let inset = false;
    let color: ColorValue | null = null;
    const lengths: DimensionValue[] = [];
    for (const part of splitTopLevel(layer, ' ')) {
      if (part.toLowerCase() === 'inset' && !inset) inset = true;
      else if (parseLength(part)) {
        const d = dimension(part);
        if (!d) return null;
        lengths.push(d);
      } else if (!color && (color = parseCssColor(part))) continue;
      else return null;
    }
    if (lengths.length < 2 || lengths.length > 4) return null;
    const zero: DimensionValue = { value: 0, unit: 'px' };
    const out: ShadowLayer = { color: color ?? colorFromHex('#000')!, offsetX: lengths[0]!, offsetY: lengths[1]!, blur: lengths[2] ?? zero, spread: lengths[3] ?? zero };
    if (inset) out.inset = true;
    layers.push(out);
  }
  return layers;
}

// --- Declarations and stylesheets ------------------------------------------------------------------------------------

/** A declaration list (a `style` attribute or a rule's block); what does not read as `property: value` is skipped. */
export function parseDeclarations(text: string): Declaration[] {
  const out: Declaration[] = [];
  for (const part of splitTopLevel(stripComments(text), ';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).replace(/\s*!\s*important\s*$/i, '').trim();
    if (!/^-{0,2}[A-Za-z_][\w-]*$/.test(name) || !value) continue;
    out.push({ property: name.startsWith('--') ? name : name.toLowerCase(), value });
  }
  return out;
}

export type StylesheetNode =
  | { kind: 'rule'; selector: string; declarations: Declaration[]; within: string[] }
  /** An at-rule: a statement (`@import …;`, `declarations` null) or a block of declarations (`@font-face`). */
  | { kind: 'at'; name: string; prelude: string; declarations: Declaration[] | null; within: string[] };

// At-rules whose block holds rules; any other block holds declarations.
const NESTING_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style']);

/** Reads a stylesheet into its rules and at-rules (rules inside `@media` and the like flattened, `within` naming them). */
export function parseStylesheet(text: string): { nodes: StylesheetNode[]; problems: string[] } {
  const nodes: StylesheetNode[] = [];
  const problems: string[] = [];
  const read = (source: string, within: string[]) => {
    let i = 0;
    while (i < source.length) {
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        const ch = source[j]!;
        if (ch === '\\') j++;
        else if (ch === '"' || ch === "'") j = stringEnd(source, j) - 1;
        else if (ch === '(' || ch === '[') depth++;
        else if ((ch === ')' || ch === ']') && depth > 0) depth--;
        else if (depth === 0 && (ch === '{' || ch === ';' || ch === '}')) break;
      }
      const prelude = source.slice(i, j).replace(/\s+/g, ' ').trim();
      const stop = source[j];
      if (stop === undefined || stop === '}') {
        if (prelude) problems.push(`text outside a rule: "${prelude}"`);
        i = j + 1;
        continue;
      }
      const at = /^@([\w-]+)\s*([\s\S]*)$/.exec(prelude);
      if (stop === ';') {
        if (at) nodes.push({ kind: 'at', name: at[1]!.toLowerCase(), prelude: at[2]!, declarations: null, within });
        else if (prelude) problems.push(`text outside a rule: "${prelude}"`);
        i = j + 1;
        continue;
      }
      // A block: find its closing brace.
      let braces = 0;
      let k = j;
      for (; k < source.length; k++) {
        const ch = source[k]!;
        if (ch === '\\') k++;
        else if (ch === '"' || ch === "'") k = stringEnd(source, k) - 1;
        else if (ch === '{') braces++;
        else if (ch === '}' && --braces === 0) break;
      }
      if (k >= source.length) {
        problems.push(`a block is not closed: "${prelude}"`);
        return;
      }
      const body = source.slice(j + 1, k);
      if (at && NESTING_AT_RULES.has(at[1]!.toLowerCase())) read(body, [...within, prelude]);
      else if (at) nodes.push({ kind: 'at', name: at[1]!.toLowerCase(), prelude: at[2]!, declarations: parseDeclarations(body), within });
      else {
        if (/\{/.test(body.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ''))) problems.push(`the rule "${prelude}" nests a rule; nested rules are not read`);
        nodes.push({ kind: 'rule', selector: prelude, declarations: parseDeclarations(body.replace(/\{[^{}]*\}/g, ';')), within });
      }
      i = k + 1;
    }
  };
  read(stripComments(text), []);
  return { nodes, problems };
}
