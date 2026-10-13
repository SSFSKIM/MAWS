// The token values of DTCG 2025.10 (designtokens.org/tr/2025.10/format §8, §9; the color module): their canonical
// shapes as zod schemas, and one normalizer per type that reads the lenient forms agents write (D1: a hex string for a
// colour, a bare number or "12px" for a dimension), validates, and writes the object forms. The same walk serves the
// parse (references kept as written) and the resolution (references replaced by what they name), through `RefHandler`.
import * as z from 'zod';
import { COLOR_SPACES, colorFromHex, rgbToHex, toSrgb, type ColorSpace, type ColorValue } from './color';

export const TOKEN_TYPES = [
  'color', 'dimension', 'fontFamily', 'fontWeight', 'duration', 'cubicBezier', 'number', 'strokeStyle', 'border', 'transition', 'shadow', 'gradient', 'typography',
] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];
export const isTokenType = (value: unknown): value is TokenType => (TOKEN_TYPES as readonly unknown[]).includes(value);

export const FONT_WEIGHTS: Readonly<Record<string, number>> = {
  thin: 100, hairline: 100, 'extra-light': 200, 'ultra-light': 200, light: 300, normal: 400, regular: 400, book: 400, medium: 500,
  'semi-bold': 600, 'demi-bold': 600, bold: 700, 'extra-bold': 800, 'ultra-bold': 800, black: 900, heavy: 900, 'extra-black': 950, 'ultra-black': 950,
};
export const STROKE_KEYWORDS = ['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'outset', 'inset'] as const;

export interface DimensionValue { value: number; unit: 'px' | 'rem' }
export interface DurationValue { value: number; unit: 'ms' | 's' }
export type FontFamilyValue = string | string[];
export type CubicBezierValue = [number, number, number, number];
export type StrokeStyleValue = (typeof STROKE_KEYWORDS)[number] | { dashArray: DimensionValue[]; lineCap: 'round' | 'butt' | 'square' };
export interface BorderValue { color: ColorValue; width: DimensionValue; style: StrokeStyleValue }
export interface TransitionValue { duration: DurationValue; delay: DurationValue; timingFunction: CubicBezierValue }
export interface ShadowLayer { color: ColorValue; offsetX: DimensionValue; offsetY: DimensionValue; blur: DimensionValue; spread: DimensionValue; inset?: boolean }
export interface GradientStop { color: ColorValue; position: number }
export interface TypographyValue { fontFamily: FontFamilyValue; fontSize: DimensionValue; fontWeight: number; lineHeight: number; letterSpacing: DimensionValue }

/** Each type's value once resolved: no references, weights as numbers. */
export interface ResolvedValueOf {
  color: ColorValue;
  dimension: DimensionValue;
  fontFamily: FontFamilyValue;
  fontWeight: number;
  duration: DurationValue;
  cubicBezier: CubicBezierValue;
  number: number;
  strokeStyle: StrokeStyleValue;
  border: BorderValue;
  transition: TransitionValue;
  shadow: ShadowLayer | ShadowLayer[];
  gradient: GradientStop[];
  typography: TypographyValue;
}

// --- References ------------------------------------------------------------------------------------------------------

const ALIAS = /^\{([^{}]+)\}$/;
/** `"{a.b}"`: a reference to the token at path `a.b`. */
export const isAlias = (value: unknown): value is string => typeof value === 'string' && ALIAS.test(value);
export const aliasPath = (alias: string): string => ALIAS.exec(alias)![1]!;
/** `{"$ref": "#/a/b/$value"}`: a JSON pointer (RFC 6901) into this file. */
export const isPointer = (value: unknown): value is { $ref: string } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as { $ref?: unknown }).$ref === 'string';
/** A pointer's segments, unescaped; null when it is not a `#/…` pointer within this file. */
export function pointerSegments(pointer: string): string[] | null {
  if (!pointer.startsWith('#/')) return null;
  return pointer.slice(2).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}
/** `#/a/b/$value` is `{a.b}` (the format's §7.4.2); null for any other pointer. */
export function pointerAsAlias(pointer: string): string | null {
  const segments = pointerSegments(pointer);
  if (!segments || segments.length < 2 || segments.at(-1) !== '$value') return null;
  const path = segments.slice(0, -1);
  return path.some((s) => s === '' || /[{}.]/.test(s)) ? null : `{${path.join('.')}}`;
}

// --- Canonical shapes ------------------------------------------------------------------------------------------------

const RANGES: Record<ColorSpace, readonly [string, number, number, boolean?][]> = {
  // [name, min, max, max excluded]; Infinity where the module leaves a side open
  srgb: [['red', 0, 1], ['green', 0, 1], ['blue', 0, 1]],
  'srgb-linear': [['red', 0, 1], ['green', 0, 1], ['blue', 0, 1]],
  hsl: [['hue', 0, 360, true], ['saturation', 0, 100], ['lightness', 0, 100]],
  hwb: [['hue', 0, 360, true], ['whiteness', 0, 100], ['blackness', 0, 100]],
  lab: [['lightness', 0, 100], ['a', -Infinity, Infinity], ['b', -Infinity, Infinity]],
  lch: [['lightness', 0, 100], ['chroma', 0, Infinity], ['hue', 0, 360, true]],
  oklab: [['lightness', 0, 1], ['a', -Infinity, Infinity], ['b', -Infinity, Infinity]],
  oklch: [['lightness', 0, 1], ['chroma', 0, Infinity], ['hue', 0, 360, true]],
  'display-p3': [['red', 0, 1], ['green', 0, 1], ['blue', 0, 1]],
  'a98-rgb': [['red', 0, 1], ['green', 0, 1], ['blue', 0, 1]],
  'prophoto-rgb': [['red', 0, 1], ['green', 0, 1], ['blue', 0, 1]],
  rec2020: [['red', 0, 1], ['green', 0, 1], ['blue', 0, 1]],
  // The module's table says [0, 1], but D65 white is Z 1.089: only the lower bound is held.
  'xyz-d65': [['x', 0, Infinity], ['y', 0, Infinity], ['z', 0, Infinity]],
  'xyz-d50': [['x', 0, Infinity], ['y', 0, Infinity], ['z', 0, Infinity]],
};

export const ColorValueSchema = z
  .strictObject({
    colorSpace: z.enum(COLOR_SPACES),
    components: z.array(z.union([z.number(), z.literal('none')])).length(3),
    alpha: z.number().min(0).max(1).optional(),
    hex: z.string().regex(/^#[0-9a-f]{6}$/, 'a 6-digit hex fallback (#rrggbb)').optional(),
  })
  .superRefine((color, ctx) => {
    RANGES[color.colorSpace].forEach(([name, min, max, open], i) => {
      const v = color.components[i];
      if (typeof v !== 'number' || (v >= min && (open ? v < max : v <= max))) return;
      const range = max === Infinity ? `at least ${min}` : min === -Infinity ? `any number` : `between ${min} and ${max}${open ? ' (excluded)' : ''}`;
      ctx.addIssue({ code: 'custom', path: ['components', i], message: `the ${color.colorSpace} ${name} must be ${range}` });
    });
  });
export const DimensionValueSchema = z.strictObject({ value: z.number(), unit: z.enum(['px', 'rem']) });
export const DurationValueSchema = z.strictObject({ value: z.number(), unit: z.enum(['ms', 's']) });
export const FontFamilyValueSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)], {
  error: 'a font family must be a name or a non-empty list of names',
});
export const FontWeightValueSchema = z.union([z.number().min(1).max(1000), z.enum(Object.keys(FONT_WEIGHTS) as [string, ...string[]])], {
  error: `a font weight must be a number from 1 to 1000 or one of ${Object.keys(FONT_WEIGHTS).join(', ')}`,
});
export const CubicBezierValueSchema = z.tuple([z.number().min(0).max(1), z.number(), z.number().min(0).max(1), z.number()], {
  error: 'a cubic Bézier is four numbers [P1x, P1y, P2x, P2y], the x coordinates in [0, 1]',
});
export const NumberValueSchema = z.number();
const LineCapSchema = z.enum(['round', 'butt', 'square']);

// --- The normalizer --------------------------------------------------------------------------------------------------

export const FAIL: unique symbol = Symbol('fail');
export const KEEP: unique symbol = Symbol('keep');
type Out = unknown; // a canonical value, or FAIL

/**
 * What the walk does with a reference. The parse keeps them (`alias` returns the alias, `pointer` KEEP); the resolution
 * returns the resolved value an alias names (already of `type`) or the raw value a pointer reaches (normalized here).
 */
export interface RefHandler {
  readonly mode: 'parse' | 'resolve';
  alias(alias: string, type: SubType, at: string): unknown | typeof FAIL;
  pointer(pointer: string, at: string): unknown | typeof KEEP | typeof FAIL;
  problem(message: string): void;
}

// The positions a value can hold: a token type, or a part of one (a shadow list's layer, a gradient's stop).
type SubType = TokenType | 'shadowLayer' | 'gradientStop';

const describe = (value: unknown) => (Array.isArray(value) ? 'a list' : value === null ? 'null' : typeof value === 'object' ? 'an object' : JSON.stringify(value));
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function viaSchema<T>(schema: z.ZodType<T>, raw: unknown, at: string, h: RefHandler): T | typeof FAIL {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const where = issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('');
    h.problem(`${at}${where}: ${issue.message}`);
  }
  return FAIL;
}

function containsPointer(value: unknown): boolean {
  if (isPointer(value)) return true;
  if (Array.isArray(value)) return value.some(containsPointer);
  return isObject(value) && Object.values(value).some(containsPointer);
}

// Replaces every pointer inside a leaf value with what it reaches; KEEP when the parse keeps them.
function substitute(value: unknown, at: string, h: RefHandler): unknown | typeof KEEP | typeof FAIL {
  if (isPointer(value)) {
    const target = h.pointer(value.$ref, at);
    return target === KEEP || target === FAIL ? target : substitute(target, at, h);
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const [i, item] of value.entries()) {
      const v = substitute(item, `${at}[${i}]`, h);
      if (v === KEEP || v === FAIL) return v;
      out.push(v);
    }
    return out;
  }
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const v = substitute(item, `${at}.${key}`, h);
      if (v === KEEP || v === FAIL) return v;
      out[key] = v;
    }
    return out;
  }
  return value;
}

const MEASURE = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*([a-z]+)\s*$/;

function color(raw: unknown, at: string, h: RefHandler): Out {
  if (typeof raw === 'string') {
    const parsed = colorFromHex(raw);
    if (parsed) return parsed;
    h.problem(`${at}: ${JSON.stringify(raw)} is not a colour (write a colour object or a hex string)`);
    return FAIL;
  }
  const lowered = isObject(raw) && typeof raw.hex === 'string' ? { ...raw, hex: raw.hex.toLowerCase() } : raw;
  const value = viaSchema(ColorValueSchema, lowered, at, h);
  if (value === FAIL) return FAIL;
  const out: ColorValue = { colorSpace: value.colorSpace, components: value.components };
  if (value.alpha !== undefined && value.alpha < 1) out.alpha = value.alpha; // opaque is the default, so 1 is not written
  // MAWS writes srgb with its hex (D1), always the components' own: the components are the value, the hex a fallback.
  if (value.colorSpace === 'srgb' && value.components.every((c) => typeof c === 'number')) out.hex = rgbToHex(toSrgb(value));
  else if (value.hex !== undefined) out.hex = value.hex;
  return out;
}

function measure(raw: unknown, at: string, h: RefHandler, kind: 'dimension' | 'duration'): Out {
  const [units, bare]: [string[], string] = kind === 'dimension' ? [['px', 'rem'], 'px'] : [['ms', 's'], 'ms'];
  if (typeof raw === 'number') return { value: raw, unit: bare };
  if (typeof raw === 'string') {
    const match = MEASURE.exec(raw);
    if (match && units.includes(match[2]!)) return { value: Number(match[1]), unit: match[2] };
    h.problem(`${at}: ${JSON.stringify(raw)} is not a ${kind} (write {value, unit} with unit ${units.join(' or ')})`);
    return FAIL;
  }
  const schema: z.ZodType<{ value: number; unit: string }> = kind === 'dimension' ? DimensionValueSchema : DurationValueSchema;
  const value = viaSchema(schema, raw, at, h);
  return value === FAIL ? FAIL : { value: value.value, unit: value.unit };
}

// A CSS-style stack ("Inter, 'Apple SD Gothic Neo', sans-serif") is read as the list it means; quotes around a name go.
const unquote = (name: string) => name.trim().replace(/^(["'])(.*)\1$/, '$2');
function fontFamily(raw: unknown, at: string, h: RefHandler): Out {
  let value = raw;
  if (typeof value === 'string' && value.includes(',')) value = value.split(',').map(unquote);
  else if (typeof value === 'string') value = unquote(value);
  else if (Array.isArray(value)) value = value.map((v) => (typeof v === 'string' ? unquote(v) : v));
  return viaSchema(FontFamilyValueSchema, value, at, h);
}

function fontWeight(raw: unknown, at: string, h: RefHandler): Out {
  const value = viaSchema(FontWeightValueSchema, raw, at, h);
  if (value === FAIL) return FAIL;
  return h.mode === 'resolve' && typeof value === 'string' ? FONT_WEIGHTS[value]! : value;
}

// An object of known parts: each part normalized at its type, unknown parts refused, optional parts defaulted. `flags`
// names optional boolean parts (a shadow's `inset`).
function parts(
  raw: unknown,
  at: string,
  h: RefHandler,
  what: string,
  shape: readonly (readonly [key: string, type: SubType, fallback?: unknown])[],
  flags: readonly string[] = [],
): Out {
  if (!isObject(raw)) {
    h.problem(`${at}: ${what} must be an object, not ${describe(raw)}`);
    return FAIL;
  }
  let failed = false;
  const known = new Set([...shape.map(([key]) => key), ...flags]);
  for (const key of Object.keys(raw)) {
    if (known.has(key)) continue;
    h.problem(`${at}: unknown property "${key}" in ${what}`);
    failed = true;
  }
  const out: Record<string, unknown> = {};
  for (const [key, type, fallback] of shape) {
    if (!(key in raw)) {
      if (fallback !== undefined) out[key] = structuredClone(fallback);
      else {
        h.problem(`${at}: ${what} needs "${key}"`);
        failed = true;
      }
      continue;
    }
    const value = normalizeAt(type, raw[key], `${at}.${key}`, h);
    if (value === FAIL) failed = true;
    else out[key] = value;
  }
  for (const flag of flags) {
    if (!(flag in raw)) continue;
    if (typeof raw[flag] === 'boolean') out[flag] = raw[flag];
    else {
      h.problem(`${at}.${flag}: must be true or false`);
      failed = true;
    }
  }
  return failed ? FAIL : out;
}

function list(raw: unknown, at: string, h: RefHandler, what: string, item: SubType, minimum = 1): Out {
  if (!Array.isArray(raw) || raw.length < minimum) {
    h.problem(`${at}: ${what} must be a list of at least ${minimum}`);
    return FAIL;
  }
  const out: unknown[] = [];
  let failed = false;
  raw.forEach((element, i) => {
    const value = normalizeAt(item, element, `${at}[${i}]`, h);
    if (value === FAIL) failed = true;
    else out.push(value);
  });
  return failed ? FAIL : out;
}

const SHADOW_LAYER = [['color', 'color'], ['offsetX', 'dimension'], ['offsetY', 'dimension'], ['blur', 'dimension'], ['spread', 'dimension']] as const;
const ZERO_PX: DimensionValue = { value: 0, unit: 'px' };

function normalizeAt(type: SubType, raw: unknown, at: string, h: RefHandler): Out {
  if (isAlias(raw)) {
    const target = h.alias(raw, type, at);
    // In a list, a reference names one layer or one stop; a whole list there would be flattened, which the format forbids.
    if (target !== FAIL && h.mode === 'resolve' && (type === 'shadowLayer' || type === 'gradientStop') && Array.isArray(target)) {
      h.problem(`${at}: ${raw} names a list; a reference inside a list must name a single ${type === 'shadowLayer' ? 'shadow' : 'gradient stop'}`);
      return FAIL;
    }
    return target;
  }
  if (isPointer(raw)) {
    const alias = pointerAsAlias(raw.$ref);
    if (alias) return normalizeAt(type, alias, at, h);
    if (!pointerSegments(raw.$ref)) {
      h.problem(`${at}: the pointer ${JSON.stringify(raw.$ref)} must start with "#/" (a place in this file)`);
      return FAIL;
    }
    const target = h.pointer(raw.$ref, at);
    if (target === KEEP) return { $ref: raw.$ref };
    return target === FAIL ? FAIL : normalizeAt(type, target, at, h);
  }
  // A leaf value with pointers inside (a colour's component, a dimension's unit; the format's §7.3): the parse keeps it
  // as written, the resolution replaces the pointers and then reads it.
  let value = raw;
  if (containsPointer(raw) && (type === 'color' || type === 'dimension' || type === 'duration' || type === 'cubicBezier' || type === 'fontFamily')) {
    const substituted = substitute(raw, at, h);
    if (substituted === KEEP) return raw;
    if (substituted === FAIL) return FAIL;
    value = substituted;
  }
  switch (type) {
    case 'color':
      return color(value, at, h);
    case 'dimension':
    case 'duration':
      return measure(value, at, h, type);
    case 'fontFamily':
      return fontFamily(value, at, h);
    case 'fontWeight':
      return fontWeight(value, at, h);
    case 'cubicBezier':
      return viaSchema(CubicBezierValueSchema, value, at, h);
    case 'number':
      return viaSchema(NumberValueSchema, value, at, h);
    case 'strokeStyle':
      if (typeof value === 'string') {
        if ((STROKE_KEYWORDS as readonly string[]).includes(value)) return value;
        h.problem(`${at}: a stroke style must be one of ${STROKE_KEYWORDS.join(', ')}, or {dashArray, lineCap}`);
        return FAIL;
      }
      return strokeObject(value, at, h);
    case 'border':
      return parts(value, at, h, 'a border', [['color', 'color'], ['width', 'dimension'], ['style', 'strokeStyle']]);
    case 'transition':
      return parts(value, at, h, 'a transition', [['duration', 'duration'], ['delay', 'duration'], ['timingFunction', 'cubicBezier']]);
    case 'shadow':
      return Array.isArray(value) ? list(value, at, h, 'a shadow', 'shadowLayer') : normalizeAt('shadowLayer', value, at, h);
    case 'shadowLayer':
      return parts(value, at, h, 'a shadow', SHADOW_LAYER, ['inset']);
    case 'gradient':
      return list(value, at, h, 'a gradient', 'gradientStop');
    case 'gradientStop':
      return parts(value, at, h, 'a gradient stop', [['color', 'color'], ['position', 'number']]);
    case 'typography':
      return parts(value, at, h, 'a typography value', [
        ['fontFamily', 'fontFamily'],
        ['fontSize', 'dimension'],
        ['fontWeight', 'fontWeight'],
        ['lineHeight', 'number'],
        // The format lists letterSpacing among the five properties; an absent one is read as 0px and written.
        ['letterSpacing', 'dimension', ZERO_PX],
      ]);
  }
}

function strokeObject(raw: unknown, at: string, h: RefHandler): Out {
  if (!isObject(raw)) {
    h.problem(`${at}: a stroke style must be one of ${STROKE_KEYWORDS.join(', ')}, or {dashArray, lineCap}`);
    return FAIL;
  }
  const unknown = Object.keys(raw).filter((key) => key !== 'dashArray' && key !== 'lineCap');
  for (const key of unknown) h.problem(`${at}: unknown property "${key}" in a stroke style`);
  const dashArray = list(raw.dashArray, `${at}.dashArray`, h, 'a dash array', 'dimension');
  const lineCap = viaSchema(LineCapSchema, raw.lineCap, `${at}.lineCap`, h);
  return unknown.length || dashArray === FAIL || lineCap === FAIL ? FAIL : { dashArray, lineCap };
}

/** Reads `raw` as a value of `type` at `at` (a location for messages, such as `$value`); FAIL when it is not one. */
export function normalizeValue(type: TokenType, raw: unknown, at: string, handler: RefHandler): unknown | typeof FAIL {
  return normalizeAt(type, raw, at, handler);
}
