// The hard-don'ts check (D5): runs the law's tagged don'ts over an element stream (canon now, through canon.ts's
// adapters; a deck's slides and a document's DOM once C and B register) against the system's tokens. Each `[check: …]`
// tag is one rule of a fixed vocabulary; a tag MAWS does not know is reported, never ignored, and a don't no rule checks
// is listed as manual, for the owner or the agent to judge. Portable (§4.10).
import type { CanonElement, CheckUnit } from './canon';
import { contrastRatio, flatten, rgbToHex, toSrgb, type ColorValue, type Rgb } from './color';
import { colorLiterals, parseBoxShadow, parseCssColor, parseFontStack, parseLength, splitTopLevel, varNamesIn, type Declaration } from './css-read';
import { DECK_KEY } from './extensions';
import type { HardDont, Law } from './law';
import { resolveTokens, resolveValueAgainst } from './resolve';
import { cssNamesOf, splitPath, TYPE_ROLES } from './roles';
import type { TokenSet } from './tokens';
import type { DimensionValue, ShadowLayer } from './values';

/** D5's vocabulary: the rule each tag names, and its parameter. */
export const CHECK_RULES = ['literal-color', 'font-family', 'no-gradient', 'no-shadow', 'accent-max', 'radius-max', 'type-scale', 'max-words', 'contrast'] as const;
export type CheckRule = (typeof CHECK_RULES)[number];

export interface CheckViolation {
  /** The don't's index in `law.donts`. */
  dont: number;
  /** The tag as written (`accent-max:1`). */
  rule: string;
  /** The unit's name: a canon path, a slide, a document. */
  unit: string;
  /** The element's locator. */
  element: string;
  message: string;
}

export interface CheckReport {
  violations: CheckViolation[];
  /** Every rule run, with how many violations it found (0 is a pass). */
  checks: { dont: number; rule: string; violations: number }[];
  /** The don'ts no rule checks (untagged, or tagged only with what MAWS cannot run). */
  manual: HardDont[];
  /** Tags MAWS does not know, or whose parameter does not read. */
  unknown: { dont: number; tag: string; message: string }[];
}

// --- The system's values, as the rules compare them ------------------------------------------------------------------

const REM = 16;
const px = (d: DimensionValue) => (d.unit === 'rem' ? d.value * REM : d.value);
const colorKey = (c: ColorValue | Rgb) => rgbToHex('colorSpace' in c ? toSrgb(c) : c, true);
const shadowKey = (layers: readonly ShadowLayer[]) =>
  layers.map((l) => [l.inset ? 'inset' : '', ...[l.offsetX, l.offsetY, l.blur, l.spread].map(px), colorKey(l.color)].join(' ')).join(', ');

interface System {
  colors: Map<string, ColorValue>; // a --ds-* name to its colour
  colorValues: Set<string>; // every colour a token holds, alone or inside a composite, as #rrggbb[aa]
  dimensions: Map<string, number>; // a --ds-* dimension name to px
  typeSizes: number[]; // the type roles' sizes, document and deck, in px
  roleSizeNames: Set<string>;
  sizeNames: Map<string, number[]>; // every typography size name to its px values
  families: Set<string>; // lower-cased
  fontNames: Set<string>;
  shadowNames: Set<string>;
  shadowValues: Set<string>;
  accent: string | null;
  text: ColorValue | null;
  bg: Rgb | null;
}

function systemOf(tokens: TokenSet): System {
  const resolved = resolveTokens(tokens);
  const s: System = {
    colors: new Map(),
    colorValues: new Set(),
    dimensions: new Map(),
    typeSizes: [],
    roleSizeNames: new Set(),
    sizeNames: new Map(),
    families: new Set(),
    fontNames: new Set(),
    shadowNames: new Set(),
    shadowValues: new Set(),
    accent: null,
    text: null,
    bg: null,
  };
  const addFamilies = (value: string | string[]) => (typeof value === 'string' ? [value] : value).forEach((f) => s.families.add(f.toLowerCase()));
  const sizes = new Set<number>();
  for (const token of resolved.tokens.values()) {
    const names = cssNamesOf(token.path, token.type);
    switch (token.type) {
      case 'color':
        names.forEach((n) => s.colors.set(n, token.value));
        s.colorValues.add(colorKey(token.value));
        break;
      case 'dimension':
        names.forEach((n) => s.dimensions.set(n, px(token.value)));
        break;
      case 'fontFamily':
        addFamilies(token.value);
        names.forEach((n) => s.fontNames.add(n));
        break;
      case 'typography': {
        addFamilies(token.value.fontFamily);
        const values = [px(token.value.fontSize)];
        const deck = token.token.$extensions?.[DECK_KEY] as { fontSize?: unknown } | undefined;
        const deckSize = deck?.fontSize === undefined ? null : resolveValueAgainst(resolved, 'dimension', deck.fontSize, 'fontSize').value;
        if (deckSize) values.push(px(deckSize));
        s.sizeNames.set(names[0]!, values);
        if ((TYPE_ROLES as readonly string[]).includes(splitPath(token.path)[1] ?? '') && splitPath(token.path).length === 2 && token.path.startsWith('type.')) {
          s.roleSizeNames.add(names[0]!);
          values.forEach((v) => sizes.add(v));
        }
        break;
      }
      case 'shadow': {
        const layers = Array.isArray(token.value) ? token.value : [token.value];
        layers.forEach((l) => s.colorValues.add(colorKey(l.color)));
        if (token.path.startsWith('shadow.')) {
          names.forEach((n) => s.shadowNames.add(n));
          s.shadowValues.add(shadowKey(layers));
        }
        break;
      }
      case 'border':
        s.colorValues.add(colorKey(token.value.color));
        break;
      case 'gradient':
        token.value.forEach((stop) => s.colorValues.add(colorKey(stop.color)));
        break;
    }
  }
  s.typeSizes = [...sizes].sort((a, b) => a - b);
  const role = (path: string) => {
    const t = resolved.tokens.get(path);
    return t?.type === 'color' ? t.value : null;
  };
  const accent = role('color.accent.$root');
  s.accent = accent ? colorKey(accent) : null;
  s.text = role('color.text.$root');
  const bg = role('color.bg.$root');
  s.bg = bg ? flatten(bg, { r: 1, g: 1, b: 1, alpha: 1 }) : null;
  return s;
}

// --- Reading declarations --------------------------------------------------------------------------------------------

// SVG and legacy presentation attributes that paint, read as the declarations they stand for.
const PAINT_ATTRS: Record<string, string> = { fill: 'fill', stroke: 'stroke', 'stop-color': 'stop-color', 'flood-color': 'flood-color', color: 'color', bgcolor: 'background-color' };

function declarationsOf(element: CanonElement): Declaration[] {
  const fromAttrs = Object.entries(element.attrs).flatMap(([name, value]): Declaration[] => {
    const property = PAINT_ATTRS[name.toLowerCase()];
    return property ? [{ property, value }] : [];
  });
  return [...fromAttrs, ...element.style];
}

const isColorProperty = (p: string) =>
  /color$/.test(p) || /^(background|border|outline|text-decoration|column-rule|-webkit-text-stroke)/.test(p) || ['box-shadow', 'text-shadow', 'fill', 'stroke', 'filter'].includes(p);
const GRADIENT = /(?:^|[^\w-])(?:-webkit-)?(?:repeating-)?(?:linear|radial|conic)-gradient\(|-webkit-gradient\(/i;
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
  'inherit', 'initial', 'unset', 'revert', 'revert-layer',
]);
const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const SIZE_KEYWORDS = new Set(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', 'smaller', 'larger']);
const wholeVar = (value: string): string | null => /^var\(\s*(--[^\s,)]+)\s*(?:,[\s\S]*)?\)$/i.exec(value.trim())?.[1] ?? null;

/** The `font` shorthand's size and family list; null for a system font keyword or a value that does not read. */
function fontShorthand(value: string): { size: string; family: string } | null {
  const parts = splitTopLevel(value, ' ');
  for (let i = 0; i < parts.length; i++) {
    const [size] = parts[i]!.split('/');
    const isSize = !!size && (wholeVar(size) !== null || SIZE_KEYWORDS.has(size.toLowerCase()) || (parseLength(size)?.unit ?? '') !== '');
    if (!isSize) continue;
    let j = i + 1;
    if (parts[i]!.endsWith('/')) j++;
    else if (parts[j] === '/') j += 2;
    else if (parts[j]?.startsWith('/')) j++;
    const family = parts.slice(j).join(' ');
    return family ? { size: size!, family } : null;
  }
  return null;
}

/** A colour a value names: a whole `var(--ds-*)`, or a literal. Undefined when it does not read as one colour. */
function colorIn(value: string, system: System): ColorValue | undefined {
  const name = wholeVar(value);
  if (name) return system.colors.get(name);
  return parseCssColor(value) ?? undefined;
}

/** The ground a `background`/`background-color` paints: a colour, `'clear'` (none, transparent), or undefined (unknown). */
function groundIn(property: string, value: string, system: System): ColorValue | 'clear' | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'none' || v === 'transparent' || CSS_WIDE.has(v)) return 'clear';
  if (property === 'background-color') return colorIn(value, system);
  if (GRADIENT.test(value) || /url\(/i.test(value)) return undefined;
  const colours = splitTopLevel(value, ' ').map((part) => colorIn(part, system)).filter((c): c is ColorValue => !!c);
  return colours.length === 1 ? colours[0] : undefined;
}

// --- The rules -------------------------------------------------------------------------------------------------------

interface Found {
  element: string;
  message: string;
}
type Rule = (unit: CheckUnit, system: System, param: number) => Found[];

function each(unit: CheckUnit, fn: (element: CanonElement) => void) {
  const walk = (element: CanonElement) => {
    fn(element);
    element.children.forEach(walk);
  };
  unit.elements.forEach(walk);
}

function perDeclaration(fn: (d: Declaration, system: System, param: number) => string[]): Rule {
  return (unit, system, param) => {
    const out: Found[] = [];
    each(unit, (element) => {
      for (const d of declarationsOf(element)) for (const message of fn(d, system, param)) out.push({ element: element.at, message: `${d.property}: ${message}` });
    });
    return out;
  };
}

const literalColor = perDeclaration(({ property, value }, system) => {
  if (!isColorProperty(property)) return [];
  return colorLiterals(value).flatMap((literal) => {
    const color = parseCssColor(literal);
    if (color && system.colorValues.has(colorKey(color))) return [];
    return [`the colour literal ${literal} is not a token value; use a var(--ds-color-*)`];
  });
});

const fontFamily = perDeclaration(({ property, value }, system) => {
  const stack = property === 'font-family' ? value : property === 'font' ? fontShorthand(value)?.family : undefined;
  if (stack === undefined || wholeVar(stack)) return [];
  return (parseFontStack(stack) ?? []).flatMap((family) => {
    const name = wholeVar(family);
    if (name) return system.fontNames.has(name) ? [] : [`var(${name}) is not a font token (font.*)`];
    return GENERIC_FAMILIES.has(family.toLowerCase()) || system.families.has(family.toLowerCase()) ? [] : [`"${family}" is not one of the system’s families (font.*)`];
  });
});

const noGradient: Rule = (unit) => {
  const out: Found[] = [];
  each(unit, (element) => {
    if (element.tag === 'lineargradient' || element.tag === 'radialgradient') out.push({ element: element.at, message: `<${element.tag}> draws a gradient` });
    for (const d of declarationsOf(element)) if (GRADIENT.test(d.value)) out.push({ element: element.at, message: `${d.property}: a gradient` });
  });
  return out;
};

const noShadow = perDeclaration(({ property, value }, system) => {
  if (property === 'filter' || property === 'backdrop-filter') return /drop-shadow\(/i.test(value) ? ['a drop-shadow() is not a shadow token (shadow.*)'] : [];
  if (property !== 'box-shadow' && property !== 'text-shadow') return [];
  const v = value.trim().toLowerCase();
  if (v === 'none' || CSS_WIDE.has(v)) return [];
  const parts = splitTopLevel(value, ',');
  if (parts.every((part) => system.shadowNames.has(wholeVar(part) ?? ''))) return [];
  const layers = parseBoxShadow(value);
  if (layers && system.shadowValues.has(shadowKey(layers))) return [];
  return [`${value} is not a shadow token (shadow.*)`];
});

const paintsAccent = (element: CanonElement, system: System): boolean =>
  declarationsOf(element).some(({ property, value }) => {
    if (!isColorProperty(property) || !system.accent) return false;
    const viaVar = varNamesIn(value).some((name) => {
      const c = system.colors.get(name);
      return !!c && colorKey(c) === system.accent;
    });
    return viaVar || colorLiterals(value).some((literal) => {
      const c = parseCssColor(literal);
      return !!c && colorKey(c) === system.accent;
    });
  });

const accentMax: Rule = (unit, system, max) => {
  if (unit.kind !== 'slide' && unit.kind !== 'component') return [];
  const painted: string[] = [];
  each(unit, (element) => {
    if (paintsAccent(element, system)) painted.push(element.at);
  });
  if (painted.length <= max) return [];
  return [{ element: painted[max]!, message: `${painted.length} elements are painted with the accent; at most ${max} per ${unit.kind}: ${painted.join(', ')}` }];
};

/** A length or a `var(--ds-*)` dimension in px; null when it is not one (a percentage, `calc()`, a keyword). */
function lengthPx(text: string, system: System): number | null {
  const name = wholeVar(text);
  if (name) return system.dimensions.get(name) ?? null;
  const length = parseLength(text);
  if (!length) return null;
  if (length.unit === 'px' || length.unit === '') return length.value;
  if (length.unit === 'rem' || length.unit === 'em') return length.value * REM;
  return null;
}

const radiusMax = perDeclaration(({ property, value }, system, max) => {
  if (!/radius$/.test(property)) return [];
  return splitTopLevel(value.replace(/\//g, ' '), ' ').flatMap((part) => {
    const size = lengthPx(part, system);
    return size !== null && size > max + 1e-9 ? [`${part} is above ${max}px`] : [];
  });
});

const typeScale = perDeclaration(({ property, value }, system) => {
  const size = property === 'font-size' ? value.trim() : property === 'font' && !wholeVar(value) ? fontShorthand(value)?.size : undefined;
  if (size === undefined || CSS_WIDE.has(size.toLowerCase())) return [];
  const name = wholeVar(size);
  if (name && system.roleSizeNames.has(name)) return [];
  const values = name ? (system.sizeNames.get(name) ?? (system.dimensions.has(name) ? [system.dimensions.get(name)!] : null)) : null;
  const length = parseLength(size);
  const literal = length && (length.unit === 'px' || length.unit === 'rem') ? [length.unit === 'rem' ? length.value * REM : length.value] : null;
  const candidates = values ?? literal;
  if (candidates && candidates.every((v) => system.typeSizes.some((s) => Math.abs(s - v) < 0.01))) return [];
  return [`${size} is not a type role’s size (${system.typeSizes.join(', ')} px)`];
});

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const maxWords: Rule = (unit, _system, max) => {
  if (unit.kind !== 'slide' && unit.kind !== 'component') return [];
  let count = 0;
  const walk = (element: CanonElement) => {
    if (element.tag === 'aside' || element.attrs['data-ph'] === 'notes') return; // speaker notes are not on the slide
    count += element.text.match(WORD)?.length ?? 0;
    element.children.forEach(walk);
  };
  unit.elements.forEach(walk);
  return count > max ? [{ element: unit.elements[0]?.at ?? unit.name, message: `${count} words; at most ${max} per ${unit.kind}` }] : [];
};

const ratioText = (n: number) => String(Number(n.toFixed(2)));

const contrast: Rule = (unit, system, min) => {
  const out: Found[] = [];
  const test = (at: string, fg: ColorValue, ground: Rgb) => {
    const ratio = contrastRatio(fg, ground);
    if (ratio < min - 1e-9) out.push({ element: at, message: `text ${colorKey(flatten(fg, ground))} on ${colorKey(ground)} is ${ratioText(ratio)}:1, below ${min}:1` });
  };
  const last = (decls: Declaration[], props: string[]) => decls.filter((d) => props.includes(d.property)).at(-1);
  if (unit.kind === 'stylesheet') {
    // A rule is checked where it declares both sides of the pair; the cascade between rules is not known here.
    each(unit, (element) => {
      const decls = declarationsOf(element);
      const fgDecl = last(decls, ['color']);
      const groundDecl = last(decls, ['background', 'background-color']);
      if (!fgDecl || !groundDecl || !system.bg) return;
      const fg = colorIn(fgDecl.value, system);
      const ground = groundIn(groundDecl.property, groundDecl.value, system);
      if (fg && ground && ground !== 'clear') test(element.at, fg, flatten(ground, system.bg));
    });
    return out;
  }
  // Elsewhere the pair is inherited down the tree from the system's text on its ground; text is checked once a colour or
  // a ground has been declared on it or above it (the system's own pair is the token file's to keep).
  const walk = (element: CanonElement, fg: ColorValue | null, ground: Rgb | null, declared: boolean) => {
    const decls = declarationsOf(element);
    const groundDecl = last(decls, ['background', 'background-color']);
    if (groundDecl) {
      const painted = groundIn(groundDecl.property, groundDecl.value, system);
      if (painted !== 'clear') {
        ground = painted && ground ? flatten(painted, ground) : null;
        declared = true;
      }
    }
    const fgDecl = last(decls, ['color']);
    if (fgDecl && !/^(currentcolor|inherit)$/i.test(fgDecl.value.trim())) {
      fg = colorIn(fgDecl.value, system) ?? null;
      declared = true;
    }
    if (element.text && declared && fg && ground) test(element.at, fg, ground);
    element.children.forEach((child) => walk(child, fg, ground, declared));
  };
  unit.elements.forEach((element) => walk(element, system.text, system.bg, false));
  return out;
};

const RULES: Record<CheckRule, { run: Rule; param: 'none' | 'count' | 'px' | 'ratio' }> = {
  'literal-color': { run: literalColor, param: 'none' },
  'font-family': { run: fontFamily, param: 'none' },
  'no-gradient': { run: noGradient, param: 'none' },
  'no-shadow': { run: noShadow, param: 'none' },
  'accent-max': { run: accentMax, param: 'count' },
  'radius-max': { run: radiusMax, param: 'px' },
  'type-scale': { run: typeScale, param: 'none' },
  'max-words': { run: maxWords, param: 'count' },
  contrast: { run: contrast, param: 'ratio' },
};

/** A tag's parameter as the rule takes it, or why it does not read. */
function paramOf(rule: CheckRule, param: string | null): number | string {
  const kind = RULES[rule].param;
  if (kind === 'none') return param === null ? 0 : `"${rule}" takes no parameter`;
  const text = (param ?? '').replace(kind === 'px' ? /px$/i : kind === 'ratio' ? /:1$/ : /$^/, '');
  const n = Number(text);
  if (kind === 'count') return /^\d+$/.test(text) ? n : `"${rule}" takes a whole number, as ${rule}:1`;
  if (kind === 'px') return text !== '' && Number.isFinite(n) && n >= 0 ? n : `"${rule}" takes a size in px, as ${rule}:12`;
  return text !== '' && Number.isFinite(n) && n >= 1 ? n : `"${rule}" takes a ratio of at least 1, as ${rule}:4.5`;
}

/** Runs the law's tagged don'ts over `target`, against `tokens`. */
export function checkHardDonts(law: Law, tokens: TokenSet, target: readonly CheckUnit[]): CheckReport {
  const system = systemOf(tokens);
  const report: CheckReport = { violations: [], checks: [], manual: [], unknown: [] };
  for (const dont of law.donts) {
    let ran = false;
    for (const tag of dont.tags) {
      const name = tag.name.toLowerCase();
      if (!(CHECK_RULES as readonly string[]).includes(name)) {
        report.unknown.push({ dont: dont.index, tag: tag.raw, message: `MAWS does not know the check "${tag.name}"; judge this don’t by hand` });
        continue;
      }
      const rule = name as CheckRule;
      const param = paramOf(rule, tag.param);
      if (typeof param === 'string') {
        report.unknown.push({ dont: dont.index, tag: tag.raw, message: param });
        continue;
      }
      ran = true;
      const before = report.violations.length;
      for (const unit of target) {
        for (const found of RULES[rule].run(unit, system, param)) report.violations.push({ dont: dont.index, rule: tag.raw, unit: unit.name, ...found });
      }
      report.checks.push({ dont: dont.index, rule: tag.raw, violations: report.violations.length - before });
    }
    if (!ran) report.manual.push(dont);
  }
  return report;
}
