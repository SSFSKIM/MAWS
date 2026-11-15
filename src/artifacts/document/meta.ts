// The document's own settings (D2 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the root `meta` node of the
// document's Y.Doc, beside `tabs` and `threads`, so a version pins them with the content and a restore reverts them. It
// holds two settings, each one attribute (an attribute is the unit of merge): the design-system token overrides the
// document applies over its system (X28's `TokenOverrides`, Decision Log 39), and, since UX wave U10b, the page its
// exports print on (`page`, docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §B.1).
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

/** The page a document's exports print on; a field absent is the system's page, at standard density. */
export interface DocPage {
  size?: 'letter' | 'a4';
  density?: 'compact';
}

/** The document's page: `{}` when it has none; a field holding a value this build does not know is read as absent. */
export function docPage(doc: Doc): DocPage {
  const value: unknown = doc.get(META).getAttr('page');
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  const { size, density } = value as Record<string, unknown>;
  return { ...((size === 'letter' || size === 'a4') && { size }), ...(density === 'compact' && { density }) };
}

/** Sets the page as one value in one transaction; an empty page removes the attribute. */
export function setDocPage(doc: Doc, page: DocPage, origin?: unknown): void {
  const meta = doc.get(META);
  const value: DocPage = { ...(page.size !== undefined && { size: page.size }), ...(page.density !== undefined && { density: page.density }) };
  transact(doc, () => (Object.keys(value).length === 0 ? meta.deleteAttr('page') : meta.setAttr('page', value)), origin);
}
