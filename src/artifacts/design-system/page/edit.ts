// The page's writes: one token through the model's one writer (`setToken`, which stores it canonically and refuses
// what does not read; Decision Log 19), its refusal returned as the words to show beside the field.
import type { Doc } from '../../yjs';
import { parseLength } from '../css-read';
import { setToken, SystemFilesError } from '../model';
import type { ResolvedToken } from '../resolve';
import { identityKey } from '../roles';
import { inheritedType, type Token, type TokenSet } from '../tokens';
import type { DimensionValue } from '../values';

/** The token as written at a path, found by identity (`x` or `x.$root`), with the key it is stored under. */
export function writtenToken(tokens: TokenSet, path: string): { path: string; token: Token } | null {
  const key = identityKey(tokens.tokens, path);
  const token = key === undefined ? undefined : tokens.tokens.get(key);
  return key !== undefined && token ? { path: key, token } : null;
}

/**
 * The token to edit for one the page shows: the one written at its path, or, for a token its group inherits through
 * `$extends`, a local copy at the shown path (the extended group keeps its own). The copy, and a token whose type comes
 * only from its alias's target, carry the shown token's type, so the edit still reads once its value is a literal and
 * whatever group it was inherited from goes.
 */
export function editableToken(tokens: TokenSet, shown: ResolvedToken): { path: string; token: Token } {
  const written = shown.inherited ? null : writtenToken(tokens, shown.path);
  const path = written?.path ?? shown.path;
  const token = written?.token ?? shown.token;
  const typed = token.$type !== undefined || (!shown.inherited && inheritedType(tokens.groups, path) === shown.type);
  return { path, token: typed ? token : { ...token, $type: shown.type } };
}

/** Writes the shown token changed by `change` (`editableToken`'s rule); null when written, else why not. */
export function editToken(doc: Doc, tokens: TokenSet, shown: ResolvedToken, change: (token: Token) => Token): string | null {
  const { path, token } = editableToken(tokens, shown);
  return writeToken(doc, path, change(token));
}

/** Writes `token` at `path`; null when written, else why not. */
export function writeToken(doc: Doc, path: string, token: Token): string | null {
  try {
    setToken(doc, path, token);
    return null;
  } catch (error) {
    if (error instanceof SystemFilesError) return error.problems.map((p) => p.message).join('; ');
    throw error;
  }
}

/** A dimension as typed (`16`, `16px`, `1rem`), or null. */
export function dimensionOf(text: string): DimensionValue | null {
  const length = parseLength(text);
  if (!length || !Number.isFinite(length.value)) return null;
  if (length.unit === '' || length.unit === 'px') return { value: length.value, unit: 'px' };
  return length.unit === 'rem' ? { value: length.value, unit: 'rem' } : null;
}

export const dimensionText = (value: DimensionValue): string => `${value.value}${value.unit}`;

/** A plain number as typed, or null. */
export function numberOf(text: string): number | null {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text.trim())) return null;
  return Number(text);
}
