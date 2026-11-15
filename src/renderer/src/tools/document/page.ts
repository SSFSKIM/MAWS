// The page items of a document's Export menu (UX wave U10b, §B.5 of docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md).
// Stub: the rule is written with the tests (red).
import type { DocPage, TokenOverrides } from '@artifacts/document/meta';
import type { PageSize } from '@artifacts/document/export/design-system';
import type { Doc } from '@artifacts/yjs';

export type PageItem = 'letter' | 'a4' | 'compact';
export const PAGE_ORIGIN = 'document-page';

export interface PageInForce {
  size: PageSize | null;
  compact: boolean;
  sizeKnown: boolean;
}

export function pageInForce(_page: DocPage, _overrides: TokenOverrides, _system: PageSize | null): PageInForce {
  throw new Error('not built');
}

export function choosePage(_doc: Doc, _item: PageItem, _system: PageSize | null, _origin: unknown = PAGE_ORIGIN): boolean {
  throw new Error('not built');
}
