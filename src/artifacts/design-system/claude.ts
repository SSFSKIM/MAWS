// The converter between a design system in Claude's shape and MAWS's (D12; U1, research/p3-claude-type-formats.md
// §"Design System"). `fromClaude` reads Claude's files (`design-system.json`, the list-shaped `tokens.json`,
// `README.md`, components, fonts) into a token file that validates: every value Claude's page reads becomes a token
// under its family's group with Claude's name, each role aliases the token that plays it (matched by name, else filled
// and named in a warning), and Claude's files are kept untouched under `sources/claude/`. No law is written (Decision
// Log 22): the page offers the adopt route. `toClaude` writes a system back as Claude's `tokens.json` (lists only, colours
// as hex, type as `fonts`, `families` and `groups`), `README.md` from the law, and the assets. Portable (§4.10).
import { readClaudeTokens, validateClaudeTokens, type ClaudeReading, type ClaudeStyle } from './claude-grammar';
import { contrastRatio, relativeLuminance, rgbToHex, round4, toSrgb, type ColorValue } from './color';
import { parseBoxShadow, parseCssColor, parseFontStack, parseLength } from './css-read';
import { DECK_KEY } from './extensions';
import { resolveTokens, resolveValueAgainst, type ResolvedToken } from './resolve';
import { cssNamesOf, ROLES, splitPath, TYPE_ROLES, type TypeRole } from './roles';
import { LIMITS, validateTokenFile, type Token, type TokenSet } from './tokens';
import { aliasPath, isAlias, type DimensionValue, type FontFamilyValue, type ShadowLayer, type TokenType, type TypographyValue } from './values';

/** Where an import keeps Claude's files, read-only. */
export const CLAUDE_SOURCES = 'sources/claude/';

/** A conversion refused: the import would not make a valid token file, or Claude's grammar cannot hold the export. */
export class ClaudeShapeError extends Error {
  constructor(
    what: string,
    readonly reasons: readonly string[],
  ) {
    super(`${what}: ${reasons.join('; ')}`);
    this.name = 'ClaudeShapeError';
  }
}

const unproject = (path: string) => (path.startsWith('project/') ? path.slice('project/'.length) : path);

/** Whether a file map is a system in Claude's shape (its index or list-shaped tokens, and no law or DTCG file). */
export function isClaudeShape(files: Readonly<Record<string, string>>): boolean {
  const paths = new Set(Object.keys(files).map(unproject));
  if (paths.has('DESIGN.md') || paths.has('tokens.tokens.json')) return false;
  return paths.has('design-system.json') || paths.has('tokens.json');
}

export interface ClaudeImport {
  /** The system's title: `design-system.json`'s, else `tokens.json`'s `name`. */
  title: string | null;
  tokens: TokenSet;
  /** Claude's files, unchanged, under `sources/claude/`. */
  sources: Record<string, string>;
  /** What was dropped, renamed, borrowed or filled, one sentence each. */
  warnings: string[];
}

// --- The draft token file --------------------------------------------------------------------------------------------

// The groups the roles open; an extra token cannot take one of these paths.
const ROLE_GROUPS = new Set(ROLES.flatMap((role) => splitPath(role.path).slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('.'))));
const parentOf = (path: string) => splitPath(path).slice(0, -1).join('.');

/** A dictionary with no prototype: a key such as `__proto__` from imported JSON is an ordinary entry. */
const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

class Draft {
  readonly root: Record<string, unknown> = dict();
  private readonly tokens = new Map<string, Token & Record<string, unknown>>();
  private readonly names = new Map<string, string>(); // a --ds-* name to the path that writes it
  private readonly perGroup = new Map<string, number>();
  private count = ROLES.length;
  readonly overflow = new Map<string, number>();

  constructor() {
    for (const role of ROLES) {
      for (const name of cssNamesOf(role.path, role.type)) this.names.set(name, role.path);
      const parent = parentOf(role.path);
      this.perGroup.set(parent, (this.perGroup.get(parent) ?? 0) + 1);
    }
  }

  private node(segments: readonly string[]): Record<string, unknown> {
    let node = this.root;
    for (const segment of segments) {
      if (!Object.hasOwn(node, segment)) node[segment] = dict();
      node = node[segment] as Record<string, unknown>;
    }
    return node;
  }

  describe(group: string, description: string | undefined) {
    if (description) this.node(splitPath(group)).$description = description;
  }

  /** Writes a token at a path already chosen (a role, or what `place` returned). */
  put(path: string, token: Token) {
    const segments = splitPath(path);
    const written = Object.assign(dict(), token) as Token & Record<string, unknown>;
    this.node(segments.slice(0, -1))[segments.at(-1)!] = written;
    this.tokens.set(path, written);
  }

  token(path: string) {
    return this.tokens.get(path);
  }

  /**
   * The path an extra token takes: `<group>.<name>` (a `.` in the name written as `_`), with a numeric suffix when the
   * path or its CSS names are taken; null when its group or the file is full (counted in `overflow`).
   */
  place(group: string, name: string, type: TokenType, warnings: string[], label: string): string | null {
    if ((this.perGroup.get(group) ?? 0) >= LIMITS.tokensPerGroup || this.count >= LIMITS.tokens) {
      this.overflow.set(group, (this.overflow.get(group) ?? 0) + 1);
      return null;
    }
    const base = `${group}.${name.replace(/\./g, '_')}`;
    let path = base;
    for (let n = 2; this.tokens.has(path) || ROLE_GROUPS.has(path) || cssNamesOf(path, type).some((css) => this.names.has(css)); n++) path = `${base}-${n}`;
    for (const css of cssNamesOf(path, type)) this.names.set(css, path);
    this.perGroup.set(group, (this.perGroup.get(group) ?? 0) + 1);
    this.count++;
    if (path !== base) warnings.push(`${label} is written as ${path} (its name was taken)`);
    else if (name.includes('.')) warnings.push(`${label} is written as ${path} (a token name holds no ".")`);
    return path;
  }
}

// --- Matching names to roles -----------------------------------------------------------------------------------------

const NOISE = new Set(['color', 'colour', 'status', 'state', 'semantic', 'sys', 'ref', 'palette', 'theme']);

interface Candidate {
  name: string;
  stem: string;
  qualifiers: string[];
  step: number | null;
}

function candidate(name: string): Candidate {
  const segments = name.toLowerCase().split(/[-_.\s]+/).filter(Boolean);
  while (segments.length > 1 && NOISE.has(segments[0]!)) segments.shift();
  const numeric = (s: string) => /^\d+$/.test(s);
  const last = segments.at(-1)!;
  return { name, stem: segments[0] ?? '', qualifiers: segments.slice(1).filter((s) => !numeric(s)), step: segments.length > 1 && numeric(last) ? Number(last) : null };
}

/** The best candidate passing `test`: an unnumbered one first, then the lowest step (or the one nearest 500). */
function best(candidates: readonly Candidate[], test: (c: Candidate) => boolean, prefer: 'lowest' | 'middle' = 'lowest'): Candidate | undefined {
  const rank = (c: Candidate) => (c.step === null ? -1 : prefer === 'middle' ? Math.abs(c.step - 500) : c.step);
  return candidates.filter(test).sort((a, b) => rank(a) - rank(b))[0];
}

const has = (list: readonly string[], set: readonly string[]) => list.some((q) => set.includes(q));

const BG = ['bg', 'background', 'surface', 'canvas', 'paper', 'page', 'base', 'backdrop'];
const RAISED = ['raised', 'elevated', 'card', 'panel', 'container', 'alt', 'secondary', 'subtle', 'overlay', 'sunken'];
const TEXT = ['text', 'ink', 'fg', 'foreground', 'content', 'body', 'copy'];
const MUTED = ['muted', 'secondary', 'subtle', 'tertiary', 'dim', 'soft', 'faint', 'weak', 'quiet', 'light', 'disabled', 'placeholder'];
const ACCENT = ['accent', 'primary', 'brand', 'action', 'interactive', 'cta', 'key'];
const ON = ['text', 'fg', 'foreground', 'contrast', 'on', 'ink', 'label'];
const BORDER = ['border', 'line', 'divider', 'rule', 'stroke', 'outline', 'hairline', 'separator', 'edge', 'keyline'];
const NOT_BASE = ['on', 'text', 'fg', 'foreground', 'contrast', 'hover', 'pressed', 'active', 'focus', 'subtle', 'muted', 'light', 'dark', 'bg', 'background', 'surface', 'border', 'weak', 'strong', 'soft', 'tint', 'inverse', 'disabled', 'container'];
const STATUS: Record<'ok' | 'warn' | 'error' | 'info', string[]> = {
  ok: ['success', 'ok', 'positive', 'good', 'valid', 'confirm', 'green'],
  warn: ['warning', 'warn', 'caution', 'attention', 'alert', 'amber'],
  error: ['error', 'danger', 'negative', 'critical', 'destructive', 'invalid', 'fail', 'failure', 'red'],
  info: ['info', 'informative', 'information', 'notice', 'note'],
};

/** For each colour role Claude's names do not fill exactly, the name that plays it, if any. */
function colorRoleMatches(candidates: readonly Candidate[], used: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  const free = (test: (c: Candidate) => boolean) => (c: Candidate) => !used.has(c.name) && test(c);
  const take = (role: string, ...tries: (Candidate | undefined)[]) => {
    const found = tries.find(Boolean);
    if (found) {
      out.set(role, found.name);
      used.add(found.name);
    }
  };
  const bgStem = (c: Candidate) => BG.includes(c.stem);
  const textStem = (c: Candidate) => TEXT.includes(c.stem) || (c.stem === 'on' && BG.includes(c.qualifiers[0] ?? ''));
  take('color.bg.$root', best(candidates, free((c) => bgStem(c) && c.qualifiers.length === 0)));
  take('color.bg.raised', best(candidates, free((c) => bgStem(c) && has(c.qualifiers, RAISED))), best(candidates, free((c) => bgStem(c) && c.step !== null)));
  take('color.text.$root', best(candidates, free((c) => textStem(c) && (c.qualifiers.length === 0 || c.stem === 'on'))));
  take('color.text.muted', best(candidates, free((c) => textStem(c) && has(c.qualifiers, MUTED))), best(candidates, free((c) => textStem(c) && c.step !== null)));
  take('color.accent.$root', best(candidates, free((c) => ACCENT.includes(c.stem) && c.qualifiers.length === 0), 'middle'));
  take('color.accent.text', best(candidates, free((c) => (c.stem === 'on' && ACCENT.includes(c.qualifiers[0] ?? '')) || (ACCENT.includes(c.stem) && has(c.qualifiers, ON)))));
  take('color.border', best(candidates, free((c) => BORDER.includes(c.stem) && c.qualifiers.length === 0)), best(candidates, free((c) => BORDER.includes(c.stem))));
  for (const [status, stems] of Object.entries(STATUS)) {
    take(`color.status.${status}`, best(candidates, free((c) => stems.includes(c.stem) && !has(c.qualifiers, NOT_BASE)), 'middle'));
  }
  return out;
}

// --- Values ----------------------------------------------------------------------------------------------------------

const REM = 16;
const toPx = (d: DimensionValue) => (d.unit === 'rem' ? d.value * REM : d.value);

/** A Claude length as a DTCG dimension (em and % taken against 16px); null for what a dimension cannot hold. */
function dimensionOf(value: string | number, base = REM): DimensionValue | null {
  if (typeof value === 'number') return { value: round4(value), unit: 'px' };
  const length = parseLength(value);
  if (!length) return null;
  if (length.unit === 'px' || length.unit === 'rem') return { value: round4(length.value), unit: length.unit };
  if (length.unit === '') return { value: round4(length.value), unit: 'px' };
  if (length.unit === 'em') return { value: round4(length.value * base), unit: 'px' };
  return null;
}

const familyValue = (stack: string): FontFamilyValue => {
  const names = parseFontStack(stack) ?? [stack];
  return names.length === 1 ? names[0]! : names;
};

function weightOf(value: string | number | undefined): number {
  if (value === undefined) return 400;
  if (typeof value === 'number') return value;
  if (/^normal$/i.test(value.trim())) return 400;
  if (/^bold$/i.test(value.trim())) return 700;
  const [low, high] = value.trim().split(/\s+/).map(Number);
  return high !== undefined && low! <= 400 && 400 <= high ? 400 : low!;
}

/** A style's composite, its family a reference to the font token that holds it. */
function compositeOf(style: ClaudeStyle, familyRef: (key: string | null) => string | FontFamilyValue): Record<string, unknown> | null {
  const fontSize = dimensionOf(style.fontSize) ?? (typeof style.fontSize === 'string' && /%$/.test(style.fontSize) ? { value: round4((parseFloat(style.fontSize) / 100) * REM), unit: 'px' as const } : null);
  if (!fontSize) return null;
  const px = toPx(fontSize);
  let lineHeight = 1.4;
  if (style.lineHeight !== undefined) {
    const length = typeof style.lineHeight === 'number' ? { value: style.lineHeight, unit: '' } : parseLength(style.lineHeight);
    if (length) {
      const ratio = { '': 1, em: 1, '%': 0.01, px: 1 / px, rem: REM / px }[length.unit];
      if (ratio !== undefined) lineHeight = round4(length.value * ratio);
    }
  }
  let letterSpacing: DimensionValue = { value: 0, unit: 'px' };
  if (style.letterSpacing !== undefined) letterSpacing = dimensionOf(style.letterSpacing, px) ?? letterSpacing;
  return { fontFamily: familyRef(style.family), fontSize, fontWeight: weightOf(style.fontWeight), lineHeight, letterSpacing };
}

// Neutral values for a role the source has nothing for.
const NEUTRAL = {
  bg: '#ffffff',
  accent: '#2f5fd0',
  status: { ok: '#1f7a4d', warn: '#a35c00', error: '#b3261e' } as Record<string, string>,
  body: ['system-ui', 'sans-serif'],
  mono: ['ui-monospace', 'Menlo', 'monospace'],
  space: [4, 8, 12, 16, 24, 32, 48, 64],
  radius: { sm: 4, md: 8, lg: 12, full: 9999 } as Record<string, number>,
  shadow: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.08)',
    md: '0 4px 12px rgba(0, 0, 0, 0.1)',
    lg: '0 12px 32px rgba(0, 0, 0, 0.14)',
  } as Record<string, string>,
  // [size px, line height, weight, display face]
  type: {
    title: [40, 1.15, 700, true],
    subtitle: [22, 1.35, 400, false],
    h1: [32, 1.2, 700, true],
    h2: [24, 1.25, 600, true],
    h3: [18, 1.3, 600, false],
    body: [16, 1.5, 400, false],
    caption: [13, 1.4, 400, false],
    quote: [20, 1.5, 400, true],
  } as Record<TypeRole, [number, number, number, boolean]>,
};

const withAlpha = (color: ColorValue, alpha: number): ColorValue => ({ ...color, alpha: round4((color.alpha ?? 1) * alpha) });

// --- The import ------------------------------------------------------------------------------------------------------

function importColors(reading: ClaudeReading, d: Draft, warnings: string[]) {
  d.describe('color', reading.colorNote);
  const exact = new Map<string, string>(
    ['bg', 'bg-raised', 'text', 'text-muted', 'accent', 'accent-text', 'border', 'status-ok', 'status-warn', 'status-error', 'status-info'].map((key) => [
      key,
      key === 'border' ? 'color.border' : `color.${key.replace('-', '.')}${key.includes('-') ? '' : '.$root'}`,
    ]),
  );
  const pathOf = new Map<string, string>(); // a Claude name to its token path
  const roleOf = new Map<string, string>(); // a role path to the token path that fills it (itself when written there)
  for (const color of reading.colors) {
    const role = exact.get(color.name.toLowerCase());
    if (role && !roleOf.has(role)) {
      pathOf.set(color.name, role);
      roleOf.set(role, role);
    } else {
      const path = d.place('color', color.name, 'color', warnings, `color "${color.name}"`);
      if (path) pathOf.set(color.name, path);
    }
  }
  const byName = new Map(reading.colors.map((c) => [c.name, c]));
  const literal = (name: string, depth = 0): ColorValue | null => {
    const value = byName.get(name)?.value;
    if (value === undefined || depth > 16) return null;
    const alias = /^\{([^{}]+)\}$/.exec(value);
    return alias ? literal(alias[1]!.trim(), depth + 1) : parseCssColor(value);
  };
  const values = new Map<string, ColorValue>(); // a token path to its colour, for the derivations
  for (const color of reading.colors) {
    const path = pathOf.get(color.name);
    if (!path) continue;
    const alias = /^\{([^{}]+)\}$/.exec(color.value);
    const target = alias ? pathOf.get(alias[1]!.trim()) : undefined;
    const value = literal(color.name)!;
    values.set(path, value);
    d.put(path, { $type: 'color', $value: target ? `{${target}}` : value, ...(color.usage ? { $description: color.usage } : {}) });
  }

  const used = new Set([...pathOf].filter(([, path]) => roleOf.has(path)).map(([name]) => name));
  for (const [role, name] of colorRoleMatches(reading.colors.map((c) => candidate(c.name)), used)) {
    if (roleOf.has(role)) continue;
    const path = pathOf.get(name);
    if (!path) continue;
    d.put(role, { $type: 'color', $value: `{${path}}` });
    roleOf.set(role, path);
    values.set(role, values.get(path)!);
  }

  // What the source leaves open: derived from what it has, else neutral, each named.
  const fill = (role: string, value: ColorValue | string, how: string) => {
    d.put(role, { $type: 'color', $value: typeof value === 'string' && isAlias(value) ? value : typeof value === 'string' ? parseCssColor(value)! : value });
    const resolved = typeof value === 'string' && isAlias(value) ? values.get(aliasPath(value))! : typeof value === 'string' ? parseCssColor(value)! : value;
    values.set(role, resolved);
    roleOf.set(role, role);
    warnings.push(`${role}: no colour for it; ${how}`);
  };
  const missing = (role: string) => !roleOf.has(role);
  if (missing('color.bg.$root')) fill('color.bg.$root', NEUTRAL.bg, 'it takes a neutral default');
  const bg = values.get('color.bg.$root')!;
  if (missing('color.text.$root')) fill('color.text.$root', relativeLuminance(bg) > 0.4 ? '#1a1a1a' : '#f2f2f2', 'it takes a neutral default against the ground');
  const text = values.get('color.text.$root')!;
  if (missing('color.bg.raised')) fill('color.bg.raised', '{color.bg.$root}', 'it follows color.bg.$root');
  if (missing('color.text.muted')) fill('color.text.muted', withAlpha(text, 0.62), 'it takes the text colour at 62%');
  if (missing('color.accent.$root')) fill('color.accent.$root', NEUTRAL.accent, 'it takes a neutral default');
  const accent = values.get('color.accent.$root')!;
  if (missing('color.accent.text')) {
    const onBg = contrastRatio(bg, accent) >= contrastRatio(text, accent);
    fill('color.accent.text', onBg ? '{color.bg.$root}' : '{color.text.$root}', `it follows ${onBg ? 'color.bg.$root' : 'color.text.$root'}, the better contrast on the accent`);
  }
  if (missing('color.border')) fill('color.border', withAlpha(text, 0.15), 'it takes the text colour at 15%');
  for (const status of ['ok', 'warn', 'error'] as const) {
    if (missing(`color.status.${status}`)) fill(`color.status.${status}`, NEUTRAL.status[status]!, 'it takes a neutral default');
  }
  if (missing('color.status.info')) fill('color.status.info', '{color.accent.$root}', 'it follows color.accent.$root');
}

/** Places the families; returns how a style's family key is referenced. */
function importFonts(reading: ClaudeReading, d: Draft, warnings: string[]): (key: string | null) => string | FontFamilyValue {
  const keyPath = new Map<string, string>();
  const roleOfKey = new Map<string, string>();
  const assigned = new Set<string>();
  for (const [key, stack] of Object.entries(reading.families)) {
    const role = `font.${key}`;
    let path: string | null = role;
    if (['display', 'body', 'mono'].includes(key) && !assigned.has(role)) {
      assigned.add(role);
      roleOfKey.set(key, role);
    } else path = d.place('font', key, 'fontFamily', warnings, `type.families "${key}"`);
    if (!path) continue;
    keyPath.set(key, path);
    d.put(path, { $type: 'fontFamily', $value: familyValue(stack) });
  }
  const stems: Record<string, string[]> = {
    body: ['body', 'text', 'sans', 'base', 'ui', 'default', 'primary', 'main', 'copy', 'regular', 'sans-serif'],
    display: ['display', 'heading', 'headings', 'headline', 'title', 'serif', 'brand', 'secondary'],
    mono: ['mono', 'code', 'monospace', 'fixed', 'tabular'],
  };
  const keys = [...keyPath.keys()];
  for (const role of ['body', 'display', 'mono']) {
    const path = `font.${role}`;
    if (assigned.has(path)) continue;
    const key = stems[role]!.map((stem) => keys.find((k) => !roleOfKey.has(k) && (k === stem || k.split(/[-_.]/)[0] === stem))).find(Boolean);
    if (key) {
      d.put(path, { $type: 'fontFamily', $value: `{${keyPath.get(key)}}` });
      roleOfKey.set(key, path);
    } else if (role === 'body') {
      const first = keys.find((k) => !roleOfKey.has(k));
      d.put(path, { $type: 'fontFamily', $value: first ? `{${keyPath.get(first)}}` : NEUTRAL.body });
      if (first) roleOfKey.set(first, path);
      warnings.push(`font.body: no family named for it; ${first ? `it follows the first family, ${first}` : 'it takes the system face'}`);
    } else if (role === 'display') {
      d.put(path, { $type: 'fontFamily', $value: '{font.body}' });
      warnings.push('font.display: no family for it; it follows font.body');
    } else {
      d.put(path, { $type: 'fontFamily', $value: NEUTRAL.mono });
      warnings.push('font.mono: no family for it; it takes the system monospace');
    }
    assigned.add(path);
  }
  if (reading.fonts > 0) {
    warnings.push(
      reading.fonts === 1
        ? `type.fonts: 1 font file is kept in ${CLAUDE_SOURCES}fonts/ but not loaded; upload it as an asset to use it`
        : `type.fonts: ${reading.fonts} font files are kept in ${CLAUDE_SOURCES}fonts/ but not loaded; upload them as assets to use them`,
    );
  }
  return (key) => {
    if (key === null) return '{font.body}';
    const path = roleOfKey.get(key) ?? keyPath.get(key);
    return path ? `{${path}}` : familyValue(own(reading.families, key) ?? 'sans-serif');
  };
}

const TYPE_SYNONYMS: Record<TypeRole, string[]> = {
  title: ['display', 'hero', 'headline', 'display-1', 'display-lg', 'jumbo', 'h0'],
  subtitle: ['lead', 'lede', 'subheading', 'subhead', 'intro', 'standfirst', 'deck'],
  h1: ['heading-1', 'heading1', 'h-1', 'heading', 'heading-lg', 'title-lg'],
  h2: ['heading-2', 'heading2', 'h-2', 'heading-md', 'title-md'],
  h3: ['heading-3', 'heading3', 'h-3', 'heading-sm', 'title-sm'],
  body: ['body-md', 'body-1', 'body-m', 'text', 'paragraph', 'base', 'default', 'regular', 'copy', 'p'],
  caption: ['small', 'footnote', 'meta', 'fine', 'micro', 'body-sm', 'overline', 'tiny', 'label'],
  quote: ['blockquote', 'pullquote', 'pull-quote', 'quotation'],
};
const TYPE_FALLBACK: Record<TypeRole, TypeRole[]> = {
  title: ['h1', 'h2'],
  subtitle: ['h3', 'body'],
  h1: ['title', 'h2'],
  h2: ['h1', 'h3'],
  h3: ['h2', 'body'],
  body: [],
  caption: ['body'],
  quote: ['body'],
};

function importType(reading: ClaudeReading, d: Draft, warnings: string[], familyRef: (key: string | null) => string | FontFamilyValue) {
  const roles = new Set<string>();
  const deckStyles: ClaudeStyle[] = [];
  const extras = new Map<string, string>(); // a lower-cased style name to its token path
  const sizeOf = new Map<string, number>(); // a lower-cased style name to its size in px
  for (const style of reading.styles) {
    const lower = style.name.toLowerCase();
    if (/^deck-/.test(lower) && (TYPE_ROLES as readonly string[]).includes(lower.slice(5))) {
      deckStyles.push(style);
      continue;
    }
    const composite = compositeOf(style, familyRef);
    if (!composite) continue;
    const isRole = (TYPE_ROLES as readonly string[]).includes(lower) && !roles.has(lower);
    const path = isRole ? `type.${lower}` : d.place('type', style.name, 'typography', warnings, `type style "${style.name}"`);
    if (!path) continue;
    if (isRole) roles.add(lower);
    else {
      extras.set(lower, path);
      sizeOf.set(lower, toPx(composite.fontSize as DimensionValue));
    }
    d.put(path, { $type: 'typography', $value: composite, ...(style.usage ? { $description: style.usage } : {}) });
  }

  if (reading.styles.length === 0) {
    for (const role of TYPE_ROLES) {
      const [size, line, weight, display] = NEUTRAL.type[role];
      d.put(`type.${role}`, {
        $type: 'typography',
        $value: { fontFamily: display ? '{font.display}' : '{font.body}', fontSize: { value: size, unit: 'px' }, fontWeight: weight, lineHeight: line, letterSpacing: { value: 0, unit: 'px' } },
      });
    }
    warnings.push('type: no styles in the source; the roles take a neutral scale');
    return;
  }
  const taken = new Set<string>();
  for (const role of TYPE_ROLES) {
    if (roles.has(role)) continue;
    const name = TYPE_SYNONYMS[role].find((s) => extras.has(s) && !taken.has(s));
    if (!name) continue;
    taken.add(name);
    roles.add(role);
    d.put(`type.${role}`, { $type: 'typography', $value: `{${extras.get(name)}}` });
  }
  if (!roles.has('body')) {
    // The style nearest a 16px body, else a neutral one.
    const nearest = [...extras].sort(([a], [b]) => Math.abs(sizeOf.get(a)! - 16) - Math.abs(sizeOf.get(b)! - 16))[0];
    if (nearest) d.put('type.body', { $type: 'typography', $value: `{${nearest[1]}}` });
    else {
      const [size, line, weight] = NEUTRAL.type.body;
      d.put('type.body', { $type: 'typography', $value: { fontFamily: '{font.body}', fontSize: { value: size, unit: 'px' }, fontWeight: weight, lineHeight: line, letterSpacing: { value: 0, unit: 'px' } } });
    }
    roles.add('body');
    warnings.push(`type.body: no style for it; ${nearest ? `it follows ${nearest[1]}, the nearest to 16px` : 'it takes a neutral body'}`);
  }
  for (const role of TYPE_ROLES) {
    if (roles.has(role)) continue;
    const to = TYPE_FALLBACK[role].find((r) => roles.has(r)) ?? 'body';
    d.put(`type.${role}`, { $type: 'typography', $value: `{type.${to}}` });
    roles.add(role);
    warnings.push(`type.${role}: no style for it; it follows type.${to}`);
  }
  // A `deck-<role>` style is that role's deck scale (D2), as the export writes it.
  for (const style of deckStyles) {
    const token = d.token(`type.${style.name.toLowerCase().slice(5)}`)!;
    const fontSize = dimensionOf(style.fontSize);
    if (!fontSize) continue;
    const deck: Record<string, unknown> = { fontSize };
    const line = typeof style.lineHeight === 'number' ? style.lineHeight : style.lineHeight !== undefined && /^\d*\.?\d+$/.test(style.lineHeight) ? Number(style.lineHeight) : null;
    if (line !== null) deck.lineHeight = line;
    token.$extensions = { [DECK_KEY]: deck };
  }
}

/**
 * An ordinal scale (space 1 to 8, radius sm/md/lg/full, shadow sm/md/lg): Claude's names stripped of the family's
 * prefix fill the roles they name, synonyms fill what is left, and the rest stay extra tokens.
 */
interface ScaleSpec<V> {
  claudeKey: string;
  group: string;
  type: 'dimension' | 'shadow';
  prefix: RegExp;
  roles: string[];
  synonyms?: Record<string, string[]>;
  read(value: string | number, name: string): V | null;
  fill(roles: Map<string, V>, missing: string[]): { values: Map<string, V>; how: string };
}

function importScale<V>(reading: ClaudeReading, d: Draft, warnings: string[], spec: ScaleSpec<V>) {
  const list = reading.lists.find((l) => l.key === spec.claudeKey);
  d.describe(spec.group, list?.note);
  const filled = new Map<string, V>(); // role to its value
  const extras: { key: string; path: string; value: V }[] = [];
  for (const entry of list?.tokens ?? []) {
    const value = spec.read(entry.value, entry.name);
    if (value === null) {
      warnings.push(`${spec.claudeKey} "${entry.name}": ${JSON.stringify(entry.value)} has no DTCG ${spec.type} MAWS writes; it stays in ${CLAUDE_SOURCES}tokens.json`);
      continue;
    }
    const key = entry.name.replace(spec.prefix, '') || entry.name;
    const token: Token = { $type: spec.type, $value: value, ...(entry.usage ? { $description: entry.usage } : {}) };
    if (spec.roles.includes(key.toLowerCase()) && !filled.has(key.toLowerCase())) {
      filled.set(key.toLowerCase(), value);
      d.put(`${spec.group}.${key.toLowerCase()}`, token);
      continue;
    }
    const path = d.place(spec.group, key, spec.type, warnings, `${spec.claudeKey} "${entry.name}"`);
    if (!path) continue;
    d.put(path, token);
    extras.push({ key: key.toLowerCase(), path, value });
  }
  const free = [...extras];
  const assign = (role: string, extra: (typeof extras)[number]) => {
    d.put(`${spec.group}.${role}`, { $type: spec.type, $value: `{${extra.path}}` });
    filled.set(role, extra.value);
    free.splice(free.indexOf(extra), 1);
  };
  for (const [role, names] of Object.entries(spec.synonyms ?? {})) {
    if (filled.has(role)) continue;
    const extra = names.map((n) => free.find((e) => e.key === n)).find(Boolean);
    if (extra) assign(role, extra);
  }
  if (filled.size === 0 && free.length > 0) {
    // Nothing named a role: the scale's steps in order of size (a dimension), or as written (a shadow).
    const size = (e: (typeof extras)[number]) => toPx(e.value as DimensionValue);
    const ordered = spec.type === 'dimension' ? free.filter((e) => size(e) > 0).sort((a, b) => size(a) - size(b)) : [...free];
    spec.roles.filter((r) => r !== 'full').forEach((role, i) => {
      if (ordered[i]) assign(role, ordered[i]!);
    });
  }
  const missing = spec.roles.filter((r) => !filled.has(r));
  if (missing.length === 0) return;
  const { values, how } = spec.fill(filled, missing);
  for (const role of missing) d.put(`${spec.group}.${role}`, { $type: spec.type, $value: values.get(role) });
  warnings.push(`${missing.map((r) => `${spec.group}.${r}`).join(', ')}: ${how}`);
}

const px = (value: number): DimensionValue => ({ value: round4(value), unit: 'px' });

const SPACE: ScaleSpec<DimensionValue> = {
  claudeKey: 'spacing',
  group: 'space',
  type: 'dimension',
  prefix: /^(?:(?:spacing|spacer|space|gap|gutter)[-_.]?|s[-_.])(?=.)/i,
  roles: ['1', '2', '3', '4', '5', '6', '7', '8'],
  read: (value) => dimensionOf(value),
  fill(known, missing) {
    const values = new Map<string, DimensionValue>();
    if (known.size === 0) {
      missing.forEach((role) => values.set(role, px(NEUTRAL.space[Number(role) - 1]!)));
      return { values, how: 'no spacing in the source; a neutral scale' };
    }
    const steps = [...known].map(([role, d]) => [Number(role), toPx(d)] as const).sort((a, b) => a[0] - b[0]);
    for (const role of missing) {
      const n = Number(role);
      const below = [...steps].reverse().find(([s]) => s < n);
      const above = steps.find(([s]) => s > n);
      let value: number;
      if (below && above) value = below[1] + ((above[1] - below[1]) * (n - below[0])) / (above[0] - below[0]);
      else if (above) value = (above[1] * n) / above[0];
      else {
        const [a, b] = steps.slice(-2);
        const step = a && b ? (b[1] - a[1]) / (b[0] - a[0]) : below![1] / below![0];
        value = below![1] + step * (n - below![0]);
      }
      values.set(role, px(value));
    }
    return { values, how: 'not in the source; filled from their neighbours' };
  },
};

const RADIUS: ScaleSpec<DimensionValue> = {
  claudeKey: 'radius',
  group: 'radius',
  type: 'dimension',
  prefix: /^(?:(?:radius|radii|rounded|corner)[-_.]?|r[-_.])(?=.)/i,
  roles: ['sm', 'md', 'lg', 'full'],
  synonyms: { full: ['pill', 'round', 'circle', 'max', 'capsule'], sm: ['small', 's', 'xs'], md: ['medium', 'm', 'base', 'default'], lg: ['large', 'l', 'xl'] },
  read(value) {
    if (typeof value === 'string' && /^\d+(\.\d+)?%$/.test(value.trim())) return parseFloat(value) >= 50 ? px(9999) : null;
    return dimensionOf(value);
  },
  fill(known, missing) {
    const values = new Map<string, DimensionValue>();
    const at = (role: string) => (known.has(role) ? toPx(known.get(role)!) : values.has(role) ? toPx(values.get(role)!) : undefined);
    for (const role of ['md', 'sm', 'lg', 'full']) {
      if (!missing.includes(role)) continue;
      const md = at('md');
      const value = role === 'full' ? 9999 : role === 'md' ? (at('sm') !== undefined && at('lg') !== undefined ? (at('sm')! + at('lg')!) / 2 : at('sm') !== undefined ? at('sm')! * 2 : at('lg') !== undefined ? at('lg')! / 1.5 : NEUTRAL.radius.md!) : role === 'sm' ? (md !== undefined ? md / 2 : NEUTRAL.radius.sm!) : md !== undefined ? md * 1.5 : NEUTRAL.radius.lg!;
      values.set(role, px(value));
    }
    return { values, how: 'not in the source; derived from the other radii' };
  },
};

const SHADOW: ScaleSpec<ShadowLayer | ShadowLayer[]> = {
  claudeKey: 'shadow',
  group: 'shadow',
  type: 'shadow',
  prefix: /^(?:(?:shadows?|elevation|elev)[-_.]?|e[-_.])(?=.)/i,
  roles: ['sm', 'md', 'lg'],
  synonyms: { sm: ['small', 's', 'xs', '1', 'low', 'subtle', 'raised'], md: ['medium', 'm', '2', 'base', 'default', 'mid', 'card'], lg: ['large', 'l', '3', 'high', 'xl', 'overlay', 'modal', 'popover'] },
  read(value) {
    const layers = typeof value === 'string' ? parseBoxShadow(value) : null;
    if (!layers) return null;
    if (layers.length === 0) return { color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0 }, offsetX: px(0), offsetY: px(0), blur: px(0), spread: px(0) };
    return layers.length === 1 ? layers[0]! : layers;
  },
  fill(_known, missing) {
    const values = new Map(missing.map((role) => [role, SHADOW.read(NEUTRAL.shadow[role]!, role)!]));
    return { values, how: 'not in the source; a neutral shadow' };
  },
};

function importOthers(reading: ClaudeReading, d: Draft, warnings: string[]) {
  const ours = new Set(['color', 'font', 'type', 'space', 'radius', 'shadow']);
  for (const list of reading.lists) {
    if (['spacing', 'radius', 'shadow'].includes(list.key)) continue;
    const base = list.key.replace(/\./g, '_');
    const group = ours.has(base) ? `claude-${base}` : base;
    d.describe(group, list.note);
    for (const entry of list.tokens) {
      const numeric = typeof entry.value === 'number' ? entry.value : /^-?(\d+\.?\d*|\.\d+)$/.test(entry.value.trim()) ? Number(entry.value) : null;
      const dimension = numeric === null ? dimensionOf(entry.value) : null;
      if (numeric === null && (!dimension || /em$/i.test(String(entry.value)))) {
        warnings.push(`${list.key} "${entry.name}": ${JSON.stringify(entry.value)} has no DTCG type MAWS writes; it stays in ${CLAUDE_SOURCES}tokens.json`);
        continue;
      }
      const type: TokenType = numeric === null ? 'dimension' : 'number';
      const path = d.place(group, entry.name, type, warnings, `${list.key} "${entry.name}"`);
      if (!path) continue;
      d.put(path, { $type: type, $value: numeric ?? dimension, ...(entry.usage ? { $description: entry.usage } : {}) });
    }
  }
}

/** Reads a system in Claude's shape into a token file that validates, keeping its files as sources. */
export function fromClaude(files: Readonly<Record<string, string>>): ClaudeImport {
  const sources: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) sources[`${CLAUDE_SOURCES}${unproject(path)}`] = content;
  const file = (name: string) => Object.entries(files).find(([path]) => unproject(path) === name)?.[1];
  const json = (text: string | undefined): unknown => {
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const warnings: string[] = [];
  const index = json(file('design-system.json'));
  const raw = json(file('tokens.json'));
  if (raw === undefined) warnings.push('tokens.json is missing; every role takes a neutral default');
  else if (raw === null) warnings.push('tokens.json does not parse as JSON; every role takes a neutral default');
  const reading = readClaudeTokens(raw ?? {});
  if (raw !== undefined && raw !== null) warnings.push(...reading.issues.map((issue) => issue.message));
  const indexTitle = typeof index === 'object' && index !== null && typeof (index as { title?: unknown }).title === 'string' ? (index as { title: string }).title.trim() : '';
  const title = indexTitle || reading.name;

  const d = new Draft();
  d.root.$description = title ? `Imported from the design system "${title}" in Claude's shape.` : "Imported from a design system in Claude's shape.";
  importColors(reading, d, warnings);
  const familyRef = importFonts(reading, d, warnings);
  importType(reading, d, warnings, familyRef);
  importScale(reading, d, warnings, SPACE);
  importScale(reading, d, warnings, RADIUS);
  importScale(reading, d, warnings, SHADOW);
  importOthers(reading, d, warnings);
  for (const [group, n] of d.overflow) warnings.push(`${group}: ${n} tokens beyond a group's ${LIMITS.tokensPerGroup} or the file's ${LIMITS.tokens} stay only in ${CLAUDE_SOURCES}tokens.json`);

  // The guarantee: a token file that validates, or a refusal naming why.
  const checked = validateTokenFile(d.root);
  if (!checked.ok) throw new ClaudeShapeError('the import does not make a valid token file', checked.problems.map((p) => `${p.path || 'tokens'}: ${p.message}`));
  return { title: title || null, tokens: checked.tokens!, sources, warnings };
}

// --- The export ------------------------------------------------------------------------------------------------------

export interface ClaudeExportSource {
  name: string;
  /** `DESIGN.md`, written as `README.md`. */
  law: string;
  tokens: TokenSet;
  /** The system's `assets/<name>` files, copied as they are. */
  assets?: Readonly<Record<string, string>>;
}

const COLOR_USAGE: Record<string, string> = {
  'color.bg.$root': 'Page ground.',
  'color.bg.raised': 'Raised surfaces: cards and panels.',
  'color.text.$root': 'Body text.',
  'color.text.muted': 'Secondary text.',
  'color.accent.$root': 'The accent: the one emphasis.',
  'color.accent.text': 'Text on the accent.',
  'color.border': 'Borders and rules.',
  'color.status.ok': 'Success.',
  'color.status.warn': 'Warning.',
  'color.status.error': 'Error.',
  'color.status.info': 'Information.',
};

/** A Claude name from path segments: `-` joined, outside `[A-Za-z0-9_.-]` replaced, at most 64. */
const claudeName = (segments: readonly string[]): string =>
  segments
    .join('-')
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64) || 'token';

const measure = (d: DimensionValue) => `${round4(d.value)}${d.unit}`;
const hex = (c: ColorValue) => rgbToHex(toSrgb(c), true);
/** A shadow's colour: hex when opaque, else `rgb()` with the alpha kept to four places (a hex byte would round it). */
function shadowColor(c: ColorValue): string {
  const rgb = toSrgb(c);
  if (rgb.alpha >= 1) return rgbToHex(rgb);
  const byte = (v: number) => Math.round(v * 255);
  return `rgb(${byte(rgb.r)} ${byte(rgb.g)} ${byte(rgb.b)} / ${round4(rgb.alpha)})`;
}
const shadowCss = (value: ShadowLayer | ShadowLayer[]) =>
  (Array.isArray(value) ? value : [value]).map((l) => `${l.inset ? 'inset ' : ''}${[l.offsetX, l.offsetY, l.blur, l.spread].map(measure).join(' ')} ${shadowColor(l.color)}`).join(', ');

/** A family list as a CSS stack Claude reads: names that are not one identifier quoted; a name it cannot hold left out. */
function stackOf(value: FontFamilyValue): string {
  const names = (typeof value === 'string' ? [value] : value).filter((name) => !/[;{}<>\\()"']/.test(name));
  const parts = names.map((name) => (/^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(name) ? name : `"${name}"`));
  while (parts.join(', ').length > 200) parts.pop();
  return parts.join(', ');
}

/** The composite a typography token is written as, followed through whole-token aliases. */
function writtenComposite(token: ResolvedToken, resolved: ReadonlyMap<string, ResolvedToken>): Record<string, unknown> {
  let value = token.token.$value;
  for (let i = 0; isAlias(value) && i < 32; i++) value = resolved.get(aliasPath(value))?.token.$value;
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// Claude's caps on what its page reads (U1's grammar); an export over one is refused, not cut.
const EXPORT_CAPS = { colors: 600, families: 12, otherFamilies: 12, otherTokens: 60, styles: 80 } as const;

/**
 * A system as Claude's files: `tokens.json` in Claude's list grammar, `README.md` from the law, and the assets. Throws
 * `ClaudeShapeError` when Claude's grammar cannot hold the system (its caps), naming each reason.
 */
export function toClaude(system: ClaudeExportSource): Record<string, string> {
  const resolved = resolveTokens(system.tokens);
  // One namespace for every token family but type, one for styles, one for family keys; each name unique in its own.
  const unique = (taken: Set<string>, base: string) => {
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base.slice(0, 60)}-${n}`;
    taken.add(name);
    return name;
  };
  const tokenNames = new Set<string>();
  const claim = (segments: readonly string[]) => unique(tokenNames, claudeName(segments));
  type Entry = { name: string; value: string; usage?: string };
  const entry = (name: string, value: string, usage?: string): Entry => (usage ? { name, value, usage } : { name, value });
  const colors: Entry[] = [];
  const spacing: Entry[] = [];
  const radius: Entry[] = [];
  const shadow: Entry[] = [];
  const others = new Map<string, Entry[]>();
  const families = dict<string>();
  const familyKeyOf = new Map<string, string>(); // a fontFamily token's path to its family key
  const typography: Extract<ResolvedToken, { type: 'typography' }>[] = [];
  const familyKey = (segments: readonly string[]) => {
    const base = claudeName(segments).toLowerCase();
    let key = base;
    for (let n = 2; Object.hasOwn(families, key); n++) key = `${base.slice(0, 60)}-${n}`;
    return key;
  };

  for (const token of resolved.tokens.values()) {
    const segments = splitPath(token.path).filter((s) => s !== '$root');
    const usage = token.token.$description;
    const other = (value: string) => {
      const key = claudeName([segments[0]!]).toLowerCase();
      const family = ['name', 'version', 'color', 'type', 'spacing', 'radius', 'shadow'].includes(key) ? `ds-${key}` : key;
      const list = others.get(family) ?? others.set(family, []).get(family)!;
      list.push(entry(claim(segments.slice(1).length ? segments.slice(1) : segments), value, usage));
    };
    switch (token.type) {
      case 'color':
        colors.push(entry(claim(segments[0] === 'color' ? segments.slice(1) : segments), hex(token.value), usage ?? own(COLOR_USAGE, token.path)));
        break;
      case 'fontFamily': {
        const key = familyKey(segments[0] === 'font' ? segments.slice(1) : segments);
        families[key] = stackOf(token.value);
        familyKeyOf.set(token.path, key);
        break;
      }
      case 'typography':
        typography.push(token);
        break;
      case 'dimension':
        if (segments[0] === 'space') spacing.push(entry(claim(segments), measure(token.value), usage));
        else if (segments[0] === 'radius') radius.push(entry(claim(segments), measure(token.value), usage));
        else other(measure(token.value));
        break;
      case 'shadow':
        shadow.push(entry(claim(segments), shadowCss(token.value), usage));
        break;
      case 'number':
      case 'fontWeight':
        other(String(round4(token.value)));
        break;
      default:
        break; // durations, curves, transitions, borders, strokes and gradients: Claude has no family for them
    }
  }

  // Styles: the roles' names and their deck styles' names are reserved first, so an extra style never takes one.
  const deckScale = (token: (typeof typography)[number]) => {
    const scale = token.token.$extensions?.[DECK_KEY] as { fontSize?: unknown; lineHeight?: unknown } | undefined;
    const size = scale?.fontSize === undefined ? null : resolveValueAgainst(resolved, 'dimension', scale.fontSize, 'fontSize').value;
    if (!size) return null;
    const line = scale?.lineHeight === undefined ? null : resolveValueAgainst(resolved, 'number', scale.lineHeight, 'lineHeight').value;
    return { size, line };
  };
  const styleNames = new Set<string>();
  const isRole = (token: (typeof typography)[number]) => (TYPE_ROLES as readonly string[]).includes(token.path.replace(/^type\./, '')) && token.path.startsWith('type.');
  for (const token of typography.filter(isRole)) {
    const role = token.path.slice('type.'.length);
    styleNames.add(role);
    if (deckScale(token)) styleNames.add(`deck-${role}`);
  }
  const style = (name: string, key: string, value: TypographyValue, size: DimensionValue, line: number) => {
    const lineHeight = line < 10 ? round4(line) : measure({ value: line * toPx(size), unit: 'px' });
    return { name, family: key, fontSize: measure(size), lineHeight, fontWeight: value.fontWeight, letterSpacing: measure(value.letterSpacing) };
  };
  const text: ReturnType<typeof style>[] = [];
  const deck: ReturnType<typeof style>[] = [];
  for (const token of typography) {
    const segments = splitPath(token.path).filter((s) => s !== '$root');
    const raw = writtenComposite(token, resolved.tokens).fontFamily;
    let key = isAlias(raw) ? familyKeyOf.get(aliasPath(raw)) : undefined;
    const role = isRole(token);
    const name = role ? token.path.slice('type.'.length) : unique(styleNames, claudeName(segments[0] === 'type' ? segments.slice(1) : segments));
    if (!key) {
      key = familyKey([name]);
      families[key] = stackOf(token.value.fontFamily);
    }
    text.push(style(name, key, token.value, token.value.fontSize, token.value.lineHeight));
    const scale = role ? deckScale(token) : null;
    if (scale) deck.push(style(`deck-${name}`, key, token.value, scale.size, scale.line ?? token.value.lineHeight));
  }

  const reasons: string[] = [];
  if (colors.length > EXPORT_CAPS.colors) reasons.push(`${colors.length} colours; Claude reads at most ${EXPORT_CAPS.colors}`);
  if (text.length + deck.length > EXPORT_CAPS.styles) reasons.push(`${text.length + deck.length} type styles; Claude reads at most ${EXPORT_CAPS.styles}`);
  const familyCount = Object.keys(families).length;
  if (familyCount > EXPORT_CAPS.families) reasons.push(`${familyCount} type families; Claude reads at most ${EXPORT_CAPS.families}`);
  if (others.size > EXPORT_CAPS.otherFamilies) reasons.push(`${others.size} further families; Claude reads at most ${EXPORT_CAPS.otherFamilies} (${[...others.keys()].join(', ')})`);
  for (const [key, list] of others) if (list.length > EXPORT_CAPS.otherTokens) reasons.push(`${key}: ${list.length} tokens; Claude reads at most ${EXPORT_CAPS.otherTokens} in a further family`);
  if (reasons.length) throw new ClaudeShapeError('Claude’s shape cannot hold this system', reasons);

  const bg = resolved.tokens.get('color.bg.$root');
  const light = !bg || bg.type !== 'color' || relativeLuminance(bg.value) > 0.4;
  const json = dict<unknown>();
  Object.assign(json, {
    name: system.name,
    version: 1,
    color: { themes: [light ? { id: 'light', name: 'Light' } : { id: 'dark', name: 'Dark' }], tokens: colors },
    type: { fonts: [], families, groups: [{ name: 'Text', styles: text }, ...(deck.length ? [{ name: 'Deck', styles: deck }] : [])] },
    spacing: { tokens: spacing },
    radius: { tokens: radius },
    shadow: { tokens: shadow },
  });
  for (const [key, list] of others) json[key] = { tokens: list };
  // The guarantee: what is written is what Claude's page reads.
  const dropped = validateClaudeTokens(json);
  if (dropped.length) throw new ClaudeShapeError('the export does not satisfy Claude’s grammar', dropped);

  const files = dict<string>();
  files['tokens.json'] = `${JSON.stringify(json, null, 2)}\n`;
  files['README.md'] = system.law.trim() ? system.law : `# ${system.name}\n`;
  for (const [path, content] of Object.entries(system.assets ?? {})) if (path.startsWith('assets/')) files[path] = content;
  return files;
}
