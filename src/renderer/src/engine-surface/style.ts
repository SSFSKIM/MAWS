// A plugin's Box and Text props as CSS (R2): Ink's vocabulary (d.ts BoxProps, TextProps), laid out in the DOM in MAWS's
// UI font. Numbers are character cells: a column is `1ch`, a row `1lh`. Colours are the terminal's names, drawn with
// MAWS's ANSI tokens (theme-aware), grey as the muted text; any other spelling (hex, rgb, ansi256) draws the default,
// since the surface's colours are its tokens. Hover styles, absolute placement and hover groups are not drawn in R2.
import type { CSSProperties } from 'react';
import type { StyleProps } from './tree';

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

export function colorOf(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  const lower = name.toLowerCase();
  if (lower === 'gray' || lower === 'grey' || lower === 'blackbright') return 'var(--fg-muted)';
  const bright = lower.endsWith('bright') ? lower.slice(0, -'bright'.length) : null;
  const base = bright ?? lower;
  if (!(ANSI as readonly string[]).includes(base)) return undefined;
  return `var(--term-ansi-${bright ? 'bright-' : ''}${base})`;
}

const cells = (value: unknown, unit: 'ch' | 'lh'): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}${unit}`;
  if (typeof value === 'string' && /^\d+(\.\d+)?%$/.test(value)) return value;
  return undefined;
};

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined => (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined);

function spacing(p: StyleProps, kind: 'margin' | 'padding'): CSSProperties {
  const all = num(p[kind]);
  const x = num(p[`${kind}X`]) ?? all;
  const y = num(p[`${kind}Y`]) ?? all;
  const side = (name: 'Top' | 'Bottom' | 'Left' | 'Right', fallback: number | undefined, unit: 'ch' | 'lh') => cells(num(p[`${kind}${name}`]) ?? fallback, unit);
  return {
    [`${kind}Top`]: side('Top', y, 'lh'),
    [`${kind}Bottom`]: side('Bottom', y, 'lh'),
    [`${kind}Left`]: side('Left', x, 'ch'),
    [`${kind}Right`]: side('Right', x, 'ch'),
  };
}

export function boxStyle(p: StyleProps): CSSProperties {
  const direction = oneOf(p.flexDirection, ['row', 'column', 'row-reverse', 'column-reverse'] as const) ?? 'row';
  const gap = num(p.gap);
  const bordered = typeof p.borderStyle === 'string';
  const style: CSSProperties = {
    display: p.display === 'none' ? 'none' : 'flex',
    flexDirection: direction,
    flexGrow: num(p.flexGrow),
    flexShrink: num(p.flexShrink) ?? 1,
    flexWrap: oneOf(p.flexWrap, ['nowrap', 'wrap', 'wrap-reverse'] as const),
    alignItems: oneOf(p.alignItems, ['flex-start', 'center', 'flex-end', 'stretch'] as const),
    alignSelf: oneOf(p.alignSelf, ['flex-start', 'center', 'flex-end', 'auto'] as const),
    justifyContent: oneOf(p.justifyContent, ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] as const),
    rowGap: cells(num(p.rowGap) ?? gap, 'lh'),
    columnGap: cells(num(p.columnGap) ?? gap, 'ch'),
    width: cells(p.width, 'ch'),
    height: cells(p.height, 'lh'),
    minWidth: cells(p.minWidth, 'ch') ?? 0,
    minHeight: cells(p.minHeight, 'lh'),
    overflow: p.overflow === 'hidden' ? 'hidden' : undefined,
    backgroundColor: colorOf(p.backgroundColor),
    ...spacing(p, 'margin'),
    ...spacing(p, 'padding'),
  };
  if (bordered) {
    const color = colorOf(p.borderColor) ?? 'var(--border-strong)';
    style.borderWidth = 1;
    style.borderStyle = 'solid';
    style.borderColor = color;
    if (p.borderDimColor === true) style.opacity = 0.7;
    if (p.borderStyle === 'round') style.borderRadius = 'var(--radius-sm)';
  }
  return style;
}

const TRUNCATE = ['truncate', 'truncate-end', 'truncate-start', 'truncate-middle', 'end', 'middle'];

export function textStyle(p: StyleProps): CSSProperties {
  const decorations = [p.underline === true && 'underline', p.strikethrough === true && 'line-through'].filter(Boolean).join(' ');
  let color = colorOf(p.color);
  let background = colorOf(p.backgroundColor);
  if (color === undefined && p.dimColor === true) color = 'var(--fg-muted)';
  if (p.inverse === true) [color, background] = [background ?? 'var(--bg)', color ?? 'var(--fg)'];
  const truncate = typeof p.wrap === 'string' && TRUNCATE.includes(p.wrap);
  return {
    color,
    backgroundColor: background,
    fontWeight: p.bold === true ? 600 : undefined,
    fontStyle: p.italic === true ? 'italic' : undefined,
    textDecoration: decorations || undefined,
    whiteSpace: truncate ? 'nowrap' : 'pre-wrap',
    overflow: truncate ? 'hidden' : undefined,
    textOverflow: truncate ? 'ellipsis' : undefined,
    minWidth: 0,
    overflowWrap: 'anywhere',
  };
}
