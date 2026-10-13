// The document's own settings (D2 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the root `meta` node of the
// document's Y.Doc, beside `tabs` and `threads`, so a version pins them with the content. Today it holds one setting,
// the design-system token overrides the document applies over its system (X28's `TokenOverrides`, Decision Log 39).
import { transact, type Doc } from '../yjs';

export const META = 'meta';

/** X28's `TokenOverrides`: a `--ds-*` name to a CSS value. */
export type TokenOverrides = Record<`--ds-${string}`, string>;

export function dsOverrides(doc: Doc): TokenOverrides {
  const value: unknown = doc.get(META).getAttr('dsOverrides');
  return value != null && typeof value === 'object' ? { ...(value as TokenOverrides) } : {};
}

/** Replaces the overrides as one value (an attribute is the unit of merge); `null` clears them. */
export function setDsOverrides(doc: Doc, overrides: TokenOverrides | null, origin?: unknown): void {
  const meta = doc.get(META);
  transact(doc, () => (overrides == null ? meta.deleteAttr('dsOverrides') : meta.setAttr('dsOverrides', { ...overrides })), origin);
}
