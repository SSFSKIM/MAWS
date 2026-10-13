// The page's writes: one token through the model's one writer (`setToken`, which stores it canonically and refuses
// what does not read; Decision Log 19), its refusal returned as the words to show beside the field.
import type { Doc } from '../../yjs';
import { parseLength } from '../css-read';
import { setToken, SystemFilesError } from '../model';
import { identityKey } from '../roles';
import type { Token, TokenSet } from '../tokens';
import type { DimensionValue } from '../values';

/** The token as written at a path, found by identity (`x` or `x.$root`), with the key it is stored under. */
export function writtenToken(tokens: TokenSet, path: string): { path: string; token: Token } | null {
  const key = identityKey(tokens.tokens, path);
  const token = key === undefined ? undefined : tokens.tokens.get(key);
  return key !== undefined && token ? { path: key, token } : null;
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
