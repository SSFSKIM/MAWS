// Claude's `tokens.json` grammar (U1: research/p3-claude-type-formats.md §"Design System"), as one reader: it takes a
// `tokens.json` apart into what Claude's page reads, and names what that page would drop and why. The import reads
// through it (claude.ts), and `validateClaudeTokens` is the same reader's drops, which the export is held to. The rules
// are restated from Claude's format reference, never copied: list-shaped families (`{note?, tokens: [{name, value,
// usage?}]}`), `color` with `themes`, `type` as `{fonts, families, groups}`, one name namespace for every family but
// `type`, hex or plain-argument colour functions or `{alias}`, lengths, plain values. Portable (§4.10).
import { isNamedColor, parseCssColor, splitTopLevel } from './css-read';

export interface ClaudeColor {
  name: string;
  /** The first theme's value: a colour literal or an `{alias}` of another colour that resolves. */
  value: string;
  usage?: string;
}
export interface ClaudeStyle {
  name: string;
  group: string;
  /** A key of `type.families` (the style's own, else its group's), or null. */
  family: string | null;
  fontSize: string | number;
  lineHeight?: string | number;
  fontWeight?: string | number;
  letterSpacing?: string | number;
  usage?: string;
}
export interface ClaudeEntry {
  name: string;
  /** The first theme's value, for a shadow given per theme. */
  value: string | number;
  usage?: string;
}
export interface ClaudeList {
  key: string;
  note?: string;
  tokens: ClaudeEntry[];
}
/** One finding: `drop` when Claude's page would drop the value, otherwise a note of what a MAWS import does with it. */
export interface ClaudeIssue {
  drop: boolean;
  message: string;
}
export interface ClaudeReading {
  name: string | null;
  colorNote?: string;
  /** Theme ids, lower-cased, the first being the one read. */
  themes: string[];
  colors: ClaudeColor[];
  /** Family key to its CSS stack. */
  families: Record<string, string>;
  /** How many `type.fonts` entries (font files) the system lists. */
  fonts: number;
  styles: ClaudeStyle[];
  /** `spacing`, `radius`, `shadow` and the further families, in the order written. */
  lists: ClaudeList[];
  issues: ClaudeIssue[];
}

export const CLAUDE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const CLAUDE_KEY = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%)?$/;
const PLAIN = /^[A-Za-z0-9 #%(),./+_-]{1,200}$/;
const ALIAS = /^\{([^{}]+)\}$/;
const CAPS = { themes: 8, colors: 600, families: 12, groups: 12, styles: 80, otherFamilies: 12, otherTokens: 60 } as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const shown = (v: unknown) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

/** A length: a number (px), or `12px | 0.75rem | 1em | 50% | 0`. */
export const isClaudeLength = (v: unknown): boolean => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && LENGTH.test(v.trim()));
/** A line height: a length, or a unitless number below 10. */
const isLineHeight = (v: unknown): boolean =>
  typeof v === 'number' ? v >= 0 && v < 10 : typeof v === 'string' && (/^\d*\.?\d+$/.test(v.trim()) ? Number(v) < 10 : LENGTH.test(v.trim()));
const isWeight = (v: unknown): boolean => {
  if (typeof v === 'number') return v >= 1 && v <= 1000;
  if (typeof v !== 'string') return false;
  if (/^(normal|bold)$/i.test(v.trim())) return true;
  const parts = v.trim().split(/\s+/).map(Number);
  return parts.length <= 2 && parts.every((n) => Number.isFinite(n) && n >= 1 && n <= 1000);
};

/** Why a colour value would drop, or null when Claude reads it (an alias is checked against the set separately). */
export function claudeColorProblem(value: string): string | null {
  const v = value.trim();
  if (ALIAS.test(v)) return null;
  if (/^[a-z]+$/i.test(v) && (isNamedColor(v) || /^(transparent|currentcolor)$/i.test(v))) return `${shown(value)} is not a colour Claude reads (named colours drop)`;
  const plain = v.startsWith('#') || /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)$/i.test(v);
  return plain && parseCssColor(v) ? null : `${shown(value)} is not a colour Claude reads`;
}

/** A `box-shadow` Claude reads: layers of lengths, `inset`, hex or function colours, or `none`; no `var()` or `url()`. */
export function isClaudeShadow(value: string): boolean {
  if (value.length > 400 || /var\(|url\(/i.test(value)) return false;
  if (value.trim().toLowerCase() === 'none') return true;
  return splitTopLevel(value, ',').every((layer) => {
    const parts = splitTopLevel(layer, ' ');
    const lengths = parts.filter((p) => LENGTH.test(p)).length;
    return lengths >= 2 && lengths <= 4 && parts.every((p) => LENGTH.test(p) || p.toLowerCase() === 'inset' || (!/^[a-z]+$/i.test(p) && claudeColorProblem(p) === null && !ALIAS.test(p)));
  });
}

const balanced = (v: string) => {
  let depth = 0;
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
};
const isPlainValue = (v: unknown): boolean => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && PLAIN.test(v) && balanced(v) && !/url\(|var\(/i.test(v));

function stackProblem(stack: unknown): string | null {
  if (typeof stack !== 'string' || !stack.trim()) return 'a stack is a CSS font-family string';
  if (stack.length > 200) return 'a stack holds at most 200 characters';
  if (/[;{}<>\\()]/.test(stack)) return 'a stack holds no ; { } < > \\ ( )';
  if ((stack.match(/"/g)?.length ?? 0) % 2 || (stack.match(/'/g)?.length ?? 0) % 2) return 'a stack’s quotes are balanced';
  return null;
}

/** A token name as Claude reads it (a leading `--` or `.` stripped), or null. */
function nameOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/^(--|\.)/, '');
  return CLAUDE_NAME.test(name) ? name : null;
}

/** The value a theme map gives the first theme (borrowing a later theme's when the first has none), with a note. */
function firstTheme(value: unknown, themes: string[], label: string, valid: (v: string) => boolean, issues: ClaudeIssue[]): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!isObject(value)) return undefined;
  const order = themes.length ? [...themes, ...Object.keys(value).filter((k) => !themes.includes(k.toLowerCase()))] : Object.keys(value);
  const first = order[0];
  const at = (key: string) => text(Object.entries(value).find(([k]) => k === key)?.[1]) ?? text(Object.entries(value).find(([k]) => k.toLowerCase() === key)?.[1]);
  const own = first === undefined ? undefined : at(first);
  if (own !== undefined && valid(own)) return own;
  for (const key of order.slice(1)) {
    const borrowed = at(key);
    if (borrowed !== undefined && valid(borrowed)) {
      issues.push({ drop: false, message: `${label}: no ${first} value; the ${key} value is used` });
      return borrowed;
    }
  }
  return own;
}

/** Reads a `tokens.json` (parsed) as Claude's page would, naming every drop. */
export function readClaudeTokens(json: unknown): ClaudeReading {
  const reading: ClaudeReading = { name: null, themes: [], colors: [], families: Object.create(null) as Record<string, string>, fonts: 0, styles: [], lists: [], issues: [] };
  const issues = reading.issues;
  const drop = (message: string) => issues.push({ drop: true, message });
  if (!isObject(json)) {
    drop('tokens.json is not a JSON object');
    return reading;
  }
  reading.name = text(json.name)?.trim() || null;
  const names = new Set<string>(); // one namespace for every family but type; the first claimant keeps a name
  const claimName = (label: string, raw: unknown): { name: string } | { refusal: string } => {
    const name = nameOf(raw);
    if (!name) return { refusal: `${label} ${shown(raw)}: not a token name Claude reads` };
    if (names.has(name)) return { refusal: `${label} "${name}": the name is already used by another token` };
    names.add(name);
    return { name };
  };
  const claim = (label: string, raw: unknown): string | null => {
    const claimed = claimName(label, raw);
    if ('refusal' in claimed) {
      drop(claimed.refusal);
      return null;
    }
    return claimed.name;
  };
  let others = 0;
  for (const [key, family] of Object.entries(json)) {
    if (key === 'name' || key === 'version') continue;
    if (key === 'type') {
      readType(family, reading, drop);
      continue;
    }
    if (!isObject(family) || !Array.isArray(family.tokens)) {
      drop(`${key}: a name-to-value map (DTCG); Claude reads only {"tokens": [...]} lists`);
      continue;
    }
    if (key === 'color') {
      readColors(family, reading, claimName, drop);
      continue;
    }
    const kind = key === 'spacing' || key === 'radius' ? 'length' : key === 'shadow' ? 'shadow' : 'plain';
    if (kind === 'plain' && ++others > CAPS.otherFamilies) {
      drop(`${key}: a system holds at most ${CAPS.otherFamilies} further families`);
      continue;
    }
    const list: ClaudeList = { key, tokens: [] };
    if (text(family.note)) list.note = text(family.note);
    for (const entry of family.tokens) {
      if (!isObject(entry)) continue;
      const name = claim(key, entry.name);
      if (!name) continue;
      if (kind === 'plain' && list.tokens.length >= CAPS.otherTokens) {
        drop(`${key} "${name}": a further family holds at most ${CAPS.otherTokens} tokens`);
        continue;
      }
      const valid = (v: string) => (kind === 'length' ? isClaudeLength(v) : kind === 'shadow' ? isClaudeShadow(v) : isPlainValue(v));
      const raw = kind === 'shadow' ? firstTheme(entry.value, reading.themes, `${key} "${name}"`, valid, issues) : entry.value;
      const ok = kind === 'length' ? isClaudeLength(raw) : kind === 'shadow' ? typeof raw === 'string' && isClaudeShadow(raw) : isPlainValue(raw);
      if (!ok) {
        const what = kind === 'length' ? 'a length' : kind === 'shadow' ? 'a box-shadow Claude reads' : 'a plain CSS value';
        drop(`${key} "${name}": ${shown(raw)} is not ${what}`);
        continue;
      }
      const out: ClaudeEntry = { name, value: raw as string | number };
      if (text(entry.usage)) out.usage = text(entry.usage);
      list.tokens.push(out);
    }
    reading.lists.push(list);
  }
  return reading;
}

function readColors(family: Record<string, unknown>, reading: ClaudeReading, claimName: (label: string, raw: unknown) => { name: string } | { refusal: string }, drop: (m: string) => void) {
  if (text(family.note)) reading.colorNote = text(family.note);
  if (Array.isArray(family.themes)) {
    for (const theme of family.themes.slice(0, CAPS.themes)) {
      const id = isObject(theme) ? text(theme.id)?.toLowerCase() : undefined;
      if (id && CLAUDE_KEY.test(id)) reading.themes.push(id);
    }
  }
  if (reading.themes.length > 1) {
    reading.issues.push({ drop: false, message: `color: themes after the first (${reading.themes.slice(1).join(', ')}) are kept only in sources/claude/tokens.json; a MAWS system has one theme` });
  }
  // First every name is claimed (the first claimant keeps it) and every value read; then the aliases are resolved
  // against the namespace that survived, so a later duplicate can never stand in for the token an alias reaches. Each
  // finding is reported in token order.
  type Entry = { name: string | null; value?: string; usage?: string; refusal?: string; notes: ClaudeIssue[] };
  const entries: Entry[] = [];
  for (const token of (family.tokens as unknown[]).slice(0, CAPS.colors)) {
    if (!isObject(token)) continue;
    const notes: ClaudeIssue[] = [];
    const claimed = claimName('color', token.name);
    if ('refusal' in claimed) {
      entries.push({ name: null, refusal: claimed.refusal, notes });
      continue;
    }
    const name = claimed.name;
    const value = firstTheme(token.value, reading.themes, `color "${name}"`, (v) => claudeColorProblem(v) === null, notes);
    const problem = value === undefined ? 'has no value' : claudeColorProblem(value);
    entries.push({ name, value: value?.trim(), usage: text(token.usage), refusal: problem ? `color "${name}": ${problem}` : undefined, notes });
  }
  const survivors = new Map(entries.filter((e) => e.name !== null && !e.refusal).map((e) => [e.name!, e.value!]));
  /** Where a token's alias chain ends: a colour, a target that is missing or itself drops, or a loop back to the token. */
  const chain = (name: string): 'colour' | 'missing' | 'circular' => {
    const seen = [name];
    let value = survivors.get(name)!;
    for (;;) {
      const alias = ALIAS.exec(value);
      if (!alias) return 'colour';
      const target = alias[1]!.trim();
      if (target === name || seen.length > 16) return 'circular';
      if (seen.includes(target) || !survivors.has(target)) return 'missing';
      seen.push(target);
      value = survivors.get(target)!;
    }
  };
  for (const entry of entries) {
    reading.issues.push(...entry.notes);
    if (entry.refusal) {
      drop(entry.refusal);
      continue;
    }
    const name = entry.name!;
    const end = chain(name);
    if (end !== 'colour') {
      const target = ALIAS.exec(entry.value!)![1]!.trim();
      drop(end === 'circular' ? `color "${name}": the alias {${target}} is circular or deeper than 16` : `color "${name}": the alias {${target}} names no colour`);
      continue;
    }
    const color: ClaudeColor = { name, value: entry.value! };
    if (entry.usage) color.usage = entry.usage;
    reading.colors.push(color);
  }
}

function readType(type: unknown, reading: ClaudeReading, drop: (m: string) => void) {
  if (!isObject(type)) return drop('type: must be {"fonts": [...], "families": {...}, "groups": [...]}');
  if (Array.isArray(type.fonts)) reading.fonts = type.fonts.length;
  if (isObject(type.families)) {
    const keys = Object.keys(type.families);
    if (keys.length > CAPS.families) {
      drop(`type.families: ${keys.length} families; a system holds at most ${CAPS.families} (${keys.slice(CAPS.families).join(', ')} ${keys.length - CAPS.families === 1 ? 'is' : 'are'} not read)`);
    }
    for (const [key, stack] of Object.entries(type.families).slice(0, CAPS.families)) {
      let ok = true;
      if (!CLAUDE_KEY.test(key)) {
        drop(`type.families "${key}": a family key is lower-case`);
        ok = false;
      }
      const problem = stackProblem(stack);
      if (problem) {
        drop(`type.families "${key}": ${problem}`);
        ok = false;
      }
      if (ok) reading.families[key] = (stack as string).trim();
    }
  }
  const styleNames = new Set<string>();
  for (const group of (Array.isArray(type.groups) ? type.groups : []).slice(0, CAPS.groups)) {
    if (!isObject(group)) continue;
    const groupName = text(group.name) ?? '';
    let groupFamily = text(group.family) ?? null;
    if (groupFamily !== null && !Object.hasOwn(reading.families, groupFamily)) {
      drop(`type group "${groupName}": family "${groupFamily}" is not in type.families`);
      groupFamily = null;
    }
    for (const style of Array.isArray(group.styles) ? group.styles : []) {
      if (!isObject(style)) continue;
      const name = nameOf(style.name);
      if (!name || styleNames.has(name)) {
        drop(`type style ${shown(style.name)}: ${name ? 'the name is already used by another style' : 'not a style name Claude reads'}`);
        continue;
      }
      if (reading.styles.length >= CAPS.styles) {
        drop(`type style "${name}": a system holds at most ${CAPS.styles} styles`);
        continue;
      }
      if (!isClaudeLength(style.fontSize)) {
        drop(`type style "${name}": fontSize ${shown(style.fontSize)} is not a length`);
        continue;
      }
      const out: ClaudeStyle = { name, group: groupName, family: groupFamily, fontSize: style.fontSize as string | number };
      const own = text(style.family);
      if (own !== undefined) {
        if (Object.hasOwn(reading.families, own)) out.family = own;
        else drop(`type style "${name}": family "${own}" is not in type.families`);
      }
      if (style.lineHeight !== undefined) {
        if (isLineHeight(style.lineHeight)) out.lineHeight = style.lineHeight as string | number;
        else drop(`type style "${name}": lineHeight ${shown(style.lineHeight)} is not a length or a number below 10`);
      }
      if (style.fontWeight !== undefined) {
        if (isWeight(style.fontWeight)) out.fontWeight = style.fontWeight as string | number;
        else drop(`type style "${name}": fontWeight ${shown(style.fontWeight)} is not 1 to 1000, a range or normal/bold`);
      }
      if (style.letterSpacing !== undefined) {
        if (isClaudeLength(style.letterSpacing)) out.letterSpacing = style.letterSpacing as string | number;
        else drop(`type style "${name}": letterSpacing ${shown(style.letterSpacing)} is not a length`);
      }
      if (text(style.usage)) out.usage = text(style.usage);
      styleNames.add(name);
      reading.styles.push(out);
    }
  }
}

/** What Claude's page would drop from a `tokens.json`, each with its reason; empty when every value reads. */
export function validateClaudeTokens(json: unknown): string[] {
  return readClaudeTokens(json)
    .issues.filter((issue) => issue.drop)
    .map((issue) => issue.message);
}
