// `tokens.css` (D3): one stylesheet per (system, scope, medium) with the `--ds-*` custom properties on the scope, the eight
// `.ds-type-<role>` classes inside it, and the Hangul word-break rule on them. Values are written resolved (an alias
// writes its target's value), except where a class reads a property: there a reference stays a `var()`, so an override
// of `--ds-font-display` restyles every class drawn in it. Total: a token that does not resolve is left out (the
// validation names it).
import { colorToCss, round4 } from './color';
import { CSS_KEY, DECK_KEY, type WordBreak } from './extensions';
import { resolveTokens, resolveValueAgainst, type ResolvedToken, type ResolvedTokens } from './resolve';
import { cssNamesOf, TYPE_ROLES } from './roles';
import type { TokenSet } from './tokens';
import { aliasPath, isAlias, type CubicBezierValue, type DimensionValue, type DurationValue, type FontFamilyValue, type ShadowLayer, type StrokeStyleValue } from './values';

export type Medium = 'document' | 'deck';
export interface TokensCssOptions {
  /** The selector the properties are set on: `:root` for a standalone page or a frame, `[data-ds-scope="<id>"]` in the app. */
  scope?: string;
  medium?: Medium;
}

const n = (value: number) => String(round4(value));
const measure = (value: DimensionValue | DurationValue) => `${n(value.value)}${value.unit}`;
const bezier = (value: CubicBezierValue) => `cubic-bezier(${value.map(n).join(', ')})`;
// CSS cannot draw a dash array; the format's own fallback (§9.3.3) is `dashed`.
const stroke = (value: StrokeStyleValue) => (typeof value === 'string' ? value : 'dashed');
const shadowLayer = (layer: ShadowLayer) =>
  `${layer.inset ? 'inset ' : ''}${[layer.offsetX, layer.offsetY, layer.blur, layer.spread].map(measure).join(' ')} ${colorToCss(layer.color)}`;

const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default']);

/** Inside a CSS string: quotes, backslashes, and what could end a declaration, a rule or the `<style>` element. */
export const cssString = (text: string): string =>
  `"${[...text].map((ch) => (/["\\;{}:<>]/.test(ch) || ch.charCodeAt(0) < 0x20 || ch === '\u007f' ? `\\${ch.charCodeAt(0).toString(16)} ` : ch)).join('')}"`;

/** A family list in CSS: a single identifier (Inter, serif, -apple-system) as is, any other name quoted. */
export function fontFamilyCss(value: FontFamilyValue): string {
  return (typeof value === 'string' ? [value] : value)
    .map((name) => (/^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(name) && !CSS_WIDE.has(name.toLowerCase()) ? name : cssString(name)))
    .join(', ');
}

/** One token's value in CSS (a typography token has three, written by `declarations`). */
export function cssValue(token: Exclude<ResolvedToken, { type: 'typography' }>): string {
  switch (token.type) {
    case 'color':
      return colorToCss(token.value);
    case 'dimension':
    case 'duration':
      return measure(token.value);
    case 'fontFamily':
      return fontFamilyCss(token.value);
    case 'fontWeight':
    case 'number':
      return n(token.value);
    case 'cubicBezier':
      return bezier(token.value);
    case 'strokeStyle':
      return stroke(token.value);
    case 'border':
      return `${measure(token.value.width)} ${stroke(token.value.style)} ${colorToCss(token.value.color)}`;
    case 'transition':
      return `${measure(token.value.duration)} ${bezier(token.value.timingFunction)} ${measure(token.value.delay)}`;
    case 'shadow':
      return (Array.isArray(token.value) ? token.value : [token.value]).map(shadowLayer).join(', ');
    case 'gradient':
      // The stops, for `linear-gradient(<angle>, var(--ds-…))`; positions clamped to [0, 1] as the format says.
      return token.value.map((stop) => `${colorToCss(stop.color)} ${n(Math.min(1, Math.max(0, stop.position)) * 100)}%`).join(', ');
  }
}

/** The deck scale of a `type.<role>` token (D2), resolved; null when it has none or it does not resolve. */
function deckScale(token: Extract<ResolvedToken, { type: 'typography' }>, resolved: ResolvedTokens): { fontSize: DimensionValue; lineHeight?: number } | null {
  const deck = token.token.$extensions?.[DECK_KEY] as { fontSize?: unknown; lineHeight?: unknown } | undefined;
  if (!deck || deck.fontSize === undefined) return null;
  const fontSize = resolveValueAgainst(resolved, 'dimension', deck.fontSize, 'fontSize').value;
  if (!fontSize) return null;
  const lineHeight = deck.lineHeight === undefined ? null : resolveValueAgainst(resolved, 'number', deck.lineHeight, 'lineHeight').value;
  return lineHeight === null ? { fontSize } : { fontSize, lineHeight };
}

function declarations(token: ResolvedToken, medium: Medium, resolved: ResolvedTokens): [string, string][] {
  const names = cssNamesOf(token.path, token.type);
  if (token.type !== 'typography') return names.map((name) => [name, cssValue(token)]);
  const deck = medium === 'deck' ? deckScale(token, resolved) : null;
  const size = deck?.fontSize ?? token.value.fontSize;
  const line = deck?.lineHeight ?? token.value.lineHeight;
  return [
    [names[0]!, measure(size)],
    [names[1]!, n(line)],
    [names[2]!, n(token.value.fontWeight)],
  ];
}

/**
 * The composite a typography token's value is written as, followed through whole-token aliases (`type.body` →
 * `{type.base}` → its `{fontFamily: "{font.body}", …}`), so a class reads the same custom properties its source does.
 */
function writtenComposite(token: ResolvedToken, resolved: ResolvedTokens): Record<string, unknown> {
  let value = token.token.$value;
  const seen = new Set<string>();
  while (isAlias(value) && !seen.has(value)) {
    seen.add(value);
    const target = resolved.tokens.get(aliasPath(value));
    if (target?.type !== 'typography') return {};
    value = target.token.$value;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The stylesheet for `tokens` inside `scope`, at the medium's type scale. Byte-stable for equal input. */
export function generateTokensCss(tokens: TokenSet, options: TokensCssOptions = {}): string {
  const { scope = ':root', medium = 'document' } = options;
  const resolved = resolveTokens(tokens);
  const written = new Map<string, string>(); // name → the path that wrote it; on a collision the first (a role) wins
  const lines: string[] = [];
  for (const token of resolved.tokens.values()) {
    for (const [name, value] of declarations(token, medium, resolved)) {
      if (written.has(name)) continue;
      written.set(name, token.path);
      lines.push(`  ${name}: ${value};`);
    }
  }
  const out = ['/* tokens.css, generated from tokens.tokens.json: edits here are not kept */', `${scope} {`, ...lines, '}'];

  // A class reads the custom property a reference names, when that token wrote it; otherwise the value itself.
  const varOf = (raw: unknown, type: ResolvedToken['type']): string | null => {
    if (!isAlias(raw)) return null;
    const target = resolved.tokens.get(aliasPath(raw));
    const name = target && target.type === type ? cssNamesOf(target.path, target.type)[0] : undefined;
    return name && written.get(name) === target!.path ? `var(${name})` : null;
  };
  const wordBreak: WordBreak = (tokens.groups.get('')?.$extensions?.[CSS_KEY] as { wordBreak?: WordBreak } | undefined)?.wordBreak ?? 'keep-all';
  for (const role of TYPE_ROLES) {
    const token = resolved.tokens.get(`type.${role}`);
    if (!token || token.type !== 'typography') continue;
    const [size, line, weight] = cssNamesOf(token.path, 'typography');
    const raw = writtenComposite(token, resolved);
    out.push(
      '',
      `${scope} .ds-type-${role} {`,
      `  font-family: ${varOf(raw.fontFamily, 'fontFamily') ?? fontFamilyCss(token.value.fontFamily)};`,
      `  font-size: var(${size});`,
      `  line-height: var(${line});`,
      `  font-weight: var(${weight});`,
      `  letter-spacing: ${varOf(raw.letterSpacing, 'dimension') ?? measure(token.value.letterSpacing)};`,
      `  word-break: ${wordBreak};`,
      '}',
    );
  }
  return `${out.join('\n')}\n`;
}
