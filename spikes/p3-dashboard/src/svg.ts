// P3-E2 M1 spike: the SVG writing helpers both candidates share: XML escaping, coordinate and label number formats,
// and the theme, resolved from D's document-medium `--ds-*` values and validated before any value enters an attribute.
// Nothing here reads a DOM, the locale, the clock or randomness, so equal inputs write equal bytes.

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

/** The theme from resolved `--ds-*` properties; an invalid value is refused with a warning and the house value kept. */
export function themeFrom(props: Readonly<Record<string, string>>, width = 672): { theme: Theme; warnings: string[] } {
  const warnings: string[] = [];
  const pick = (name: string, test: RegExp, fallback: string) => {
    const value = props[name]?.trim();
    if (value !== undefined && test.test(value)) return value;
    if (value !== undefined) warnings.push(`theme value ${name} refused`);
    return fallback;
  };
  const size = (name: string, fallback: number) => {
    const match = /^(\d{1,2}(?:\.\d+)?)px$/.exec(props[name]?.trim() ?? '');
    return match ? Number(match[1]) : fallback;
  };
  return {
    theme: {
      ground: pick('--ds-color-bg-raised', HEX, '#ffffff'),
      ink: pick('--ds-color-text', HEX, '#1f1e1b'),
      muted: pick('--ds-color-text-muted', HEX, '#72716e'),
      rule: pick('--ds-color-border', HEX, '#e3e2df'),
      fontBody: pick('--ds-font-body', FONT, 'sans-serif'),
      fontMono: pick('--ds-font-mono', FONT, 'monospace'),
      caption: size('--ds-type-caption-size', 13),
      body: size('--ds-type-body-size', 16),
      width: Number.isFinite(width) && width >= 240 && width <= 2000 ? Math.round(width) : 672,
    },
    warnings,
  };
}
