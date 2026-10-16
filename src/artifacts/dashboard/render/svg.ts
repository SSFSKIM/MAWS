// The SVG writing helpers of the renderer (P3-E2 M3, promoted from M1's spike): XML escaping, coordinate and label number
// formats, and the theme, resolved from D's document-medium `--ds-*` values (the same input in the editor and the
// exporters) and validated before any value enters an attribute. Nothing here reads a DOM, the locale, the clock or
// randomness, so equal inputs write equal bytes.
import { authoredFontStack } from '../../design-system/assets';
import { HOUSE_TOKENS } from '../../document/export/design-system';

/** Text and attribute content, escaped for XML; control characters other than tab and newline are dropped. */
export function esc(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** A coordinate at 2 decimals, never `-0`, never exponent notation. */
export function px(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) || rounded === 0 ? '0' : String(rounded);
}

const MINUS = '−';
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A value for a label: thousands grouped from 10,000 up (so years read 1990), a true minus sign, `decimals` places. */
export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return (value < 0 ? MINUS : '') + abs.toExponential(2).replace('e+', 'e').replace('-', MINUS);
  let text = abs.toFixed(decimals);
  if (decimals > 0) text = text.replace(/\.?0+$/, '');
  const [whole, fraction] = text.split('.');
  const body = (abs >= 10_000 ? group(whole) : whole) + (fraction ? `.${fraction}` : '');
  return (value < 0 && Number(text) !== 0 ? MINUS : '') + body;
}

/** The fewest decimals (0 to 6) that write every tick exactly. */
export function decimalsFor(ticks: number[]): number {
  for (let d = 0; d <= 6; d += 1) if (ticks.every((t) => Math.abs(Math.round(t * 10 ** d) - t * 10 ** d) < 1e-6)) return d;
  return 6;
}

export type TimeUnit = 'year' | 'month' | 'day' | 'hour' | 'minute';
const pad = (n: number) => String(n).padStart(2, '0');

/** An instant written in UTC at the unit's grain: `1990`, `1990-03`, `1990-03-15`, `03-15 14:00`. */
export function formatInstant(ms: number, unit: TimeUnit): string {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (unit === 'year') return String(d.getUTCFullYear());
  if (unit === 'month') return date.slice(0, 7);
  if (unit === 'day') return date;
  return `${date.slice(5)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The grain of a tick list: the coarsest unit every tick sits on. */
export function unitOf(ticks: number[]): TimeUnit {
  const on = (test: (d: Date) => boolean) => ticks.every((t) => test(new Date(t)));
  const midnight = (d: Date) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  if (on((d) => midnight(d) && d.getUTCDate() === 1 && d.getUTCMonth() === 0)) return 'year';
  if (on((d) => midnight(d) && d.getUTCDate() === 1)) return 'month';
  if (on(midnight)) return 'day';
  return on((d) => d.getUTCMinutes() === 0) ? 'hour' : 'minute';
}

export interface Theme {
  ground: string;
  ink: string;
  muted: string;
  rule: string;
  fontBody: string;
  fontMono: string;
  /** The text sizes of the law's two roles a figure uses: caption (axes, legend, labels) and body (table cells). */
  caption: number;
  body: number;
  width: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[\p{L}\p{N} ,"'\-_.]{1,300}$/u;

/** The figure's width in px when the page names none: the house page's text column (8.5 in less two 0.75 in margins). */
export const FIGURE_WIDTH = 672;

/** The `--ds-*` names a figure reads. */
export const THEME_PROPERTIES = ['--ds-color-bg-raised', '--ds-color-text', '--ds-color-text-muted', '--ds-color-border', '--ds-font-body', '--ds-font-mono', '--ds-type-caption-size', '--ds-type-body-size'] as const;

/** The theme from resolved `--ds-*` properties (an absent or empty one is the house system's, D's `maws` default); a value
 * the figure cannot take safely (not a six-digit hex colour, a font list with markup, a size outside 8 to 40 px) is
 * refused with a warning and the house value kept. A font list is written as the system authored it (P3-E Decision Log
 * 37): an editor scope's private names of uploaded faces dropped, so the editor's figure is the exports' figure; the
 * editor's stylesheet draws it in the scope's faces. */
export function themeFrom(props: Readonly<Record<string, string | undefined>>, width = FIGURE_WIDTH): { theme: Theme; warnings: string[] } {
  const warnings: string[] = [];
  const house = HOUSE_TOKENS.properties as Readonly<Record<string, string>>;
  const given = (name: string) => {
    const value = props[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };
  const pick = (name: string, test: RegExp) => {
    const value = given(name);
    if (value !== undefined && test.test(value)) return value;
    if (value !== undefined) warnings.push(`theme value ${name} refused`);
    return house[name];
  };
  const size = (name: string) => {
    const value = given(name);
    const match = value === undefined ? null : /^(\d{1,2}(?:\.\d+)?)px$/.exec(value);
    if (match && Number(match[1]) >= 8 && Number(match[1]) <= 40) return Number(match[1]);
    if (value !== undefined) warnings.push(`theme value ${name} refused`);
    return Number.parseFloat(house[name]);
  };
  return {
    theme: {
      ground: pick('--ds-color-bg-raised', HEX),
      ink: pick('--ds-color-text', HEX),
      muted: pick('--ds-color-text-muted', HEX),
      rule: pick('--ds-color-border', HEX),
      fontBody: authoredFontStack(pick('--ds-font-body', FONT)),
      fontMono: authoredFontStack(pick('--ds-font-mono', FONT)),
      caption: size('--ds-type-caption-size'),
      body: size('--ds-type-body-size'),
      width: Number.isFinite(width) && width >= 240 && width <= 2000 ? Math.round(width) : FIGURE_WIDTH,
    },
    warnings,
  };
}
