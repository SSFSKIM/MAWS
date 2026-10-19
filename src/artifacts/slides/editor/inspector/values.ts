// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Inspector", D10): the inspector's values, pure:
// the design system's colour tokens with the house system's literals as their fallbacks, the font list, and the composite
// values the panel edits in parts (a linear gradient, a box shadow, a crop) read from and written back to the dialect's
// forms. Everything written here still passes through css.ts's checks before it reaches the model.
import { TYPE_ROLES, type TypeRole } from '../../../design-system/roles';
import { borderParts, SHARED_DS_NAMES } from '../../css';
import type { DeckFace } from '../../deck';
import { ROLE_LABELS } from '../menus/TextStyle';

// ---------------------------------------------------------------- tokens

export interface ColourToken {
  name: string; // --ds-color-…
  label: string;
  /** The house (maws) system's value: what the token draws where a system lacks it. */
  fallback: string;
}

const HOUSE: Record<string, [string, string]> = {
  '--ds-color-bg': ['Background', '#faf9f6'],
  '--ds-color-bg-raised': ['Raised', '#ffffff'],
  '--ds-color-text': ['Text', '#1f1e1b'],
  '--ds-color-text-muted': ['Muted text', '#72716e'],
  '--ds-color-accent': ['Accent', '#c9663f'],
  '--ds-color-accent-text': ['Accent text', '#ffffff'],
  '--ds-color-border': ['Border', '#e3e2df'],
  '--ds-color-status-ok': ['OK', '#1f8f55'],
  '--ds-color-status-warn': ['Warning', '#b86a1a'],
  '--ds-color-status-error': ['Error', '#c93b3b'],
  '--ds-color-status-info': ['Info', '#3b6fd1'],
};

/** The system's colour roles (X28's shared names), in the roles' order. */
export const COLOUR_TOKENS: readonly ColourToken[] = [...SHARED_DS_NAMES]
  .filter((name) => name.startsWith('--ds-color-'))
  .map((name) => {
    const [label, fallback] = HOUSE[name] ?? [name.slice('--ds-color-'.length), '#808080'];
    return { name, label, fallback };
  });

export const tokenValue = (t: ColourToken): string => `var(${t.name}, ${t.fallback})`;

const VAR_NAME = /^var\(\s*(--ds-[a-z0-9-]+)\s*(?:,.*)?\)$/;
/** The `--ds-*` a value is wholly, or null. */
export const varName = (value: string | undefined): string | null => (value === undefined ? null : (VAR_NAME.exec(value.trim())?.[1] ?? null));

const SIZES: Record<string, string> = { sm: 'Small', md: 'Medium', lg: 'Large', full: 'Full' };
const FACES: Record<string, string> = { display: 'Display', body: 'Body', mono: 'Mono' };

/**
 * A `--ds-*` name as the panel shows it, the friendly name its role goes by: a colour's swatch label, a type class's as
 * the Text style menu names it, a face's as the Font list does; a name outside the shared roles as written.
 */
export function tokenLabel(name: string): string {
  const colour = COLOUR_TOKENS.find((t) => t.name === name);
  if (colour) return colour.label;
  const type = /^--ds-type-([a-z0-9]+)-(?:size|line|weight)$/.exec(name)?.[1];
  if (type !== undefined && (TYPE_ROLES as readonly string[]).includes(type)) return ROLE_LABELS[type as TypeRole];
  const face = /^--ds-font-([a-z]+)$/.exec(name)?.[1];
  if (face !== undefined && face in FACES) return `${FACES[face]} (system)`;
  const space = /^--ds-space-(\d+)$/.exec(name)?.[1];
  if (space !== undefined) return `Space ${space}`;
  const size = /^--ds-(?:radius|shadow)-([a-z]+)$/.exec(name)?.[1];
  if (size !== undefined && size in SIZES) return SIZES[size]!;
  return name;
}

/** What a hover over a token's friendly name says: the name and the token, as a swatch's title does. */
export const tokenTitle = (name: string): string => `${tokenLabel(name)} (${name})`;

/** A colour as a field shows it: a system colour by its role's name, anything else as written. */
export function showColour(value: string | undefined): string {
  if (value === undefined) return '';
  const name = varName(value);
  return name === null ? value : tokenLabel(name);
}

/** What a colour field's text means: a role's name or `--ds-*` name is its token (with its fallback); else as typed. */
export function readColour(text: string): string | null {
  const t = text.trim();
  if (t === '') return null;
  const lower = t.toLowerCase();
  const token = COLOUR_TOKENS.find((c) => c.label.toLowerCase() === lower || c.name === lower);
  return token ? tokenValue(token) : t;
}

// ---------------------------------------------------------------- numbers

const PX_RE = /^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(px)?$/i;
/** A value's px number (a bare number counts), or null. */
export function pxOf(value: string | undefined): number | null {
  const m = value === undefined ? null : PX_RE.exec(value.trim());
  return m ? Number(m[1]) : null;
}
export const bareOf = (value: string | undefined): number | null => (value !== undefined && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null);
export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const fmt = (n: number | null): string => (n === null ? '' : String(round2(n)));

/** A placeholder for a value the number field cannot show (a token's name, which the field shows friendly; a %), else ''. */
export function rawHint(value: string | undefined): string {
  if (value === undefined) return '';
  return varName(value) ?? value;
}

// ---------------------------------------------------------------- top-level splitting

/** Splits on `sep` outside parentheses and quotes. */
export function splitTop(value: string, sep: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const c of value) {
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && (sep === ',' ? c === ',' : /\s/.test(c))) {
      if (cur.trim() !== '') out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

// ---------------------------------------------------------------- fill

export interface Stop {
  color: string;
  at: number | null; // %
}
export interface Gradient {
  angle: number; // deg
  stops: Stop[];
}
export const MAX_STOPS = 8;
export const MIN_STOPS = 2;
const SIDES: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };

/** A `linear-gradient()` the panel edits (angle or one side, stops with one % position or none); null for anything else. */
export function parseGradient(value: string | undefined): Gradient | null {
  if (value === undefined || splitTop(value, ',').length !== 1) return null; // one gradient, no colour under it
  const m = /^linear-gradient\((.*)\)$/s.exec(value.trim());
  if (!m) return null;
  const parts = splitTop(m[1]!, ',');
  let angle = 180;
  const head = parts[0]!.toLowerCase();
  const deg = /^(-?\d+(?:\.\d+)?)deg$/.exec(head);
  if (deg) {
    angle = Number(deg[1]);
    parts.shift();
  } else if (head in SIDES) {
    angle = SIDES[head]!;
    parts.shift();
  } else if (head.startsWith('to ') || /^-?[\d.]+(turn|rad)$/.test(head)) return null;
  const stops: Stop[] = [];
  for (const part of parts) {
    const [color, at, ...more] = splitTop(part, ' ');
    if (!color || more.length) return null;
    if (at === undefined) stops.push({ color, at: null });
    else {
      const pct = /^(-?\d+(?:\.\d+)?)%$/.exec(at);
      if (!pct) return null;
      stops.push({ color, at: Number(pct[1]) });
    }
  }
  return stops.length >= MIN_STOPS && stops.length <= MAX_STOPS ? { angle, stops } : null;
}

export function gradientValue(g: Gradient): string {
  return `linear-gradient(${round2(g.angle)}deg, ${g.stops.map((s) => (s.at === null ? s.color : `${s.color} ${round2(s.at)}%`)).join(', ')})`;
}

/** Each stop's position, the unset ones spread between their set neighbours (CSS's rule), for placing a new stop. */
function positions(stops: readonly Stop[]): number[] {
  const at = stops.map((s) => s.at);
  if (at[0] === null) at[0] = 0;
  if (at[at.length - 1] === null) at[at.length - 1] = 100;
  for (let i = 1; i < at.length; i++) {
    if (at[i] !== null) continue;
    let j = i;
    while (at[j] === null) j++;
    const [from, to] = [at[i - 1]!, at[j]!];
    for (let k = i; k < j; k++) at[k] = from + ((to - from) * (k - i + 1)) / (j - i + 1);
  }
  return at as number[];
}

/** A stop added in the middle of the widest gap, its colour the stop before it. */
export function addStop(g: Gradient): Gradient {
  const at = positions(g.stops);
  let best = 0;
  for (let i = 1; i < at.length - 1; i++) if (at[i + 1]! - at[i]! > at[best + 1]! - at[best]!) best = i;
  const stops = g.stops.map((s, i) => ({ ...s, at: at[i]! }));
  stops.splice(best + 1, 0, { color: g.stops[best]!.color, at: round2((at[best]! + at[best + 1]!) / 2) });
  return { ...g, stops };
}

export type FillKind = 'none' | 'colour' | 'gradient' | 'other';
export function fillKind(value: string | undefined): FillKind {
  if (value === undefined || value === 'none') return 'none';
  if (parseGradient(value)) return 'gradient';
  return splitTop(value, ',').length === 1 && splitTop(value, ' ').length === 1 && !/gradient\(|url\(/.test(value) ? 'colour' : 'other';
}

/** The fill's first colour (a gradient's first stop), for switching kinds. */
export function firstColour(value: string | undefined): string | null {
  const kind = fillKind(value);
  if (kind === 'colour') return value!;
  if (kind === 'gradient') return parseGradient(value)!.stops[0]!.color;
  return null;
}

// ---------------------------------------------------------------- border

export const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'none'] as const;
/** What a border gains a part from when it has none: a stroke in the system's text colour. */
export const BORDER_DEFAULT = { width: '1px', style: 'solid', color: 'var(--ds-color-text, #1f1e1b)' };

export function parseBorder(value: string | undefined): { width: string | null; style: string | null; color: string | null } {
  if (value === undefined) return { width: null, style: null, color: null };
  if (value.trim() === 'none') return { width: null, style: 'none', color: null };
  return borderParts(value) ?? { width: null, style: null, color: null };
}

/** The border with one part changed (the others kept, or the default); null when its style becomes none. */
export function borderWith(value: string | undefined, part: Partial<Record<'width' | 'style' | 'color', string>>): string | null {
  const now = parseBorder(value);
  const style = part.style ?? (now.style && now.style !== 'none' ? now.style : BORDER_DEFAULT.style);
  if (style === 'none') return null;
  return `${part.width ?? now.width ?? BORDER_DEFAULT.width} ${style} ${part.color ?? now.color ?? BORDER_DEFAULT.color}`;
}

// ---------------------------------------------------------------- shadow

export interface Shadow {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number | null;
  color: string;
}
export const SHADOW_DEFAULT: Shadow = { inset: false, x: 0, y: 8, blur: 24, spread: null, color: 'rgba(0, 0, 0, 0.2)' };

/** The first shadow of a box-shadow list in px parts, and the rest of the list kept as written; null parts when not px. */
export function parseShadow(value: string | undefined): { first: Shadow | null; rest: string[] } {
  if (value === undefined) return { first: null, rest: [] };
  const [head = '', ...rest] = splitTop(value, ',');
  const words = splitTop(head, ' ');
  const inset = words.includes('inset');
  const parts = words.filter((w) => w !== 'inset');
  const lens: number[] = [];
  let color: string | null = null;
  for (const w of parts) {
    const n = pxOf(w);
    if (n !== null) lens.push(n);
    else if (color === null) color = w;
    else return { first: null, rest };
  }
  if (color === null || lens.length < 2 || lens.length > 4) return { first: null, rest };
  return { first: { inset, x: lens[0]!, y: lens[1]!, blur: lens[2] ?? 0, spread: lens[3] ?? null, color }, rest };
}

export function shadowValue(first: Shadow, rest: readonly string[]): string {
  const s = `${first.inset ? 'inset ' : ''}${round2(first.x)}px ${round2(first.y)}px ${round2(first.blur)}px${first.spread !== null ? ` ${round2(first.spread)}px` : ''} ${first.color}`;
  return [s, ...rest].join(', ');
}

// ---------------------------------------------------------------- crop

export interface Crop {
  zoom: number;
  x: number;
  y: number;
}
export function parseCrop(value: string | undefined): Crop | null {
  const m = value === undefined ? null : /^(\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)% (-?\d+(?:\.\d+)?)%$/.exec(value.trim());
  return m ? { zoom: Number(m[1]), x: Number(m[2]), y: Number(m[3]) } : null;
}
/** A crop as the loader writes it, or the reason it would not load. */
export function cropValue(c: Crop): { ok: true; value: string } | { ok: false; reason: string } {
  if (!(c.zoom >= 1 && c.zoom <= 50)) return { ok: false, reason: 'The crop’s zoom is 1 to 50' };
  if (!(c.x >= 0 && c.x <= 100 && c.y >= 0 && c.y <= 100)) return { ok: false, reason: 'The crop’s focus is 0 to 100 %' };
  return { ok: true, value: `${round2(c.zoom)} ${round2(c.x)}% ${round2(c.y)}%` };
}

// ---------------------------------------------------------------- fonts

export interface FontOption {
  label: string;
  value: string; // as written; the panel compares it in the dialect's normal form
}

/** Claude's basic faces with their generic (its fonts reference). */
const BASIC_FACES: readonly [string, string][] = [
  ['Arial', 'sans-serif'],
  ['Verdana', 'sans-serif'],
  ['Tahoma', 'sans-serif'],
  ['Trebuchet MS', 'sans-serif'],
  ['Georgia', 'serif'],
  ['Times New Roman', 'serif'],
  ['Courier New', 'monospace'],
  ['Brush Script MT', 'cursive'],
];
const quoteFamily = (family: string) => (/^[A-Za-z][A-Za-z-]*$/.test(family) ? family : `'${family.replace(/'/g, "\\'")}'`);

/** The font list in groups: the deck's faces, the system's roles, the basic faces. */
export function fontGroups(faces: Readonly<Record<string, DeckFace>>): { label: string; options: FontOption[] }[] {
  const families = [...new Set(Object.values(faces).map((f) => f.family).filter((f): f is string => typeof f === 'string' && f.trim() !== ''))];
  return [
    { label: 'This deck', options: families.map((family) => ({ label: family, value: `${quoteFamily(family)}, sans-serif` })) },
    {
      label: 'Design system',
      options: [
        { label: tokenLabel('--ds-font-display'), value: 'var(--ds-font-display, system-ui, sans-serif)' },
        { label: tokenLabel('--ds-font-body'), value: 'var(--ds-font-body, system-ui, sans-serif)' },
      ],
    },
    { label: 'Basic', options: BASIC_FACES.map(([family, generic]) => ({ label: family, value: `${quoteFamily(family)}, ${generic}` })) },
  ].filter((g) => g.options.length > 0);
}

/** A family value's name to show when it is in no list: a token's friendly name, else its first family, unquoted. */
export function familyLabel(value: string): string {
  const name = varName(value);
  if (name) return tokenLabel(name);
  return (splitTop(value, ',')[0] ?? value).replace(/^['"]|['"]$/g, '');
}
