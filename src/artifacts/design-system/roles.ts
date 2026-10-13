// The roles (D2): the token paths every system defines, in the ledger's order (X28), and how a token path becomes its
// `--ds-*` CSS names. Also the canonical path order the serializer, the resolver and the CSS generator share.
import type { TokenType } from './values';

export interface Role {
  path: string;
  type: TokenType;
}

export const TYPE_ROLES = ['title', 'subtitle', 'h1', 'h2', 'h3', 'body', 'caption', 'quote'] as const;
export type TypeRole = (typeof TYPE_ROLES)[number];

/** The token paths every system defines, in the ledger's order (X28); their CSS names are `cssNamesOf`. */
export const ROLES: readonly Role[] = [
  ...['color.bg.$root', 'color.bg.raised', 'color.text.$root', 'color.text.muted', 'color.accent.$root', 'color.accent.text', 'color.border'].map((path) => ({ path, type: 'color' as const })),
  ...['ok', 'warn', 'error', 'info'].map((s) => ({ path: `color.status.${s}`, type: 'color' as const })),
  ...['display', 'body', 'mono'].map((f) => ({ path: `font.${f}`, type: 'fontFamily' as const })),
  ...TYPE_ROLES.map((r) => ({ path: `type.${r}`, type: 'typography' as const })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ path: `space.${n}`, type: 'dimension' as const })),
  ...['sm', 'md', 'lg', 'full'].map((r) => ({ path: `radius.${r}`, type: 'dimension' as const })),
  ...['sm', 'md', 'lg'].map((s) => ({ path: `shadow.${s}`, type: 'shadow' as const })),
];
const ROLE_INDEX = new Map(ROLES.map((role, i) => [role.path, i]));

// --- Paths and CSS names ---------------------------------------------------------------------------------------------

export const splitPath = (path: string): string[] => (path === '' ? [] : path.split('.'));

/** Canonical order: the roles in the ledger's order, then every other path by its segments, code unit by code unit. */
export function comparePaths(a: string, b: string): number {
  const ra = ROLE_INDEX.get(a);
  const rb = ROLE_INDEX.get(b);
  if (ra !== undefined || rb !== undefined) return ra === undefined ? 1 : rb === undefined ? -1 : ra - rb;
  const sa = splitPath(a);
  const sb = splitPath(b);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) return sa[i]! < sb[i]! ? -1 : 1;
  }
  return sa.length - sb.length;
}

/** A CSS identifier's characters: letters, digits, `-`, `_` and non-ASCII pass; anything else is a hex escape. */
export const cssIdent = (text: string): string =>
  [...text].map((ch) => (/[A-Za-z0-9_-]/.test(ch) || ch.codePointAt(0)! >= 0x80 ? ch : `\\${ch.codePointAt(0)!.toString(16)} `)).join('');

/** The `--ds-*` names a token writes: `--ds-` and its segments joined by `-`, `$root` dropped; a typography token
 * writes its size, line and weight. None for a path that is only `$root`. */
export function cssNamesOf(path: string, type: TokenType): string[] {
  const segments = splitPath(path).filter((s) => s !== '$root');
  if (segments.length === 0) return [];
  const base = `--ds-${segments.map(cssIdent).join('-')}`;
  return type === 'typography' ? [`${base}-size`, `${base}-line`, `${base}-weight`] : [base];
}

