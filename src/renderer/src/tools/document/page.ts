// The page items of a document's Export menu (UX wave U10b, §B.5 and M3 decisions 1 and 2 of
// docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md; the owner's answer of 2026-11-15 to the card "Export
// menu": "Always show the page in force"). Letter and A4 show the size an export prints on, read as the export reads it:
// `pageOf` over `exportDesign` with the governing system's export helpers (D's resolver, as main binds them), so the
// document's size, else its own overrides of the page's width and height (a reference or a fallback resolved, one that
// resolves to nothing dropped), else the system's page. Neither is checked when that is another page. Choosing the other
// size writes it, except that choosing the system's page clears the document's size, so the document follows its
// system again; a choice also removes the overrides of the page's width and height (L4), so the size chosen is the one
// in force. Compact toggles the density. Each choice is one transaction on the replica it is given, with the person's
// origin. While the system's helpers are not known, a size the document sets is still shown, and no size is chosen.
import { docPage, dsOverrides, setDocPage, setDsOverrides, type DocPage, type TokenOverrides } from '@artifacts/document/meta';
import { exportDesign, pageOf, twipsOf, type DesignSystemExport, type PageSize } from '@artifacts/document/export/design-system';
import { transact, type Doc } from '@artifacts/yjs';

export type PageItem = 'letter' | 'a4' | 'compact';
/** The origin of a page item's write: a gesture of the person's in the menu, credited as their edits are. */
export const PAGE_ORIGIN = 'document-page';

/** What Letter, A4 and Compact show: the size in force (null: neither), whether it can be told yet, and the density. */
export interface PageInForce {
  size: PageSize | null;
  compact: boolean;
  /**
   * False while the system's page is not known: the sizes take no choice then, since a choice rests on it (choosing the
   * system's page clears the document's size). The size the document sets is still named in `size`.
   */
  sizeKnown: boolean;
}

const WIDTH = '--ds-page-width';
const HEIGHT = '--ds-page-height';
const SIZES: Record<PageSize, [width: string, height: string]> = { letter: ['8.5in', '11in'], a4: ['210mm', '297mm'] };
const TOLERANCE_TWIPS = 10; // half a point: a size spelt in another unit is the same page

/** The size whose width and height these are, or null for another page. */
function sizeOf(width: string, height: string): PageSize | null {
  const [w, h] = [twipsOf(width), twipsOf(height)];
  if (w === null || h === null) return null;
  const near = (a: number, b: string) => Math.abs(a - twipsOf(b)!) <= TOLERANCE_TWIPS;
  return (Object.keys(SIZES) as PageSize[]).find((size) => near(w, SIZES[size][0]) && near(h, SIZES[size][1])) ?? null;
}

/** The size the export prints the document on, given the governing system's export helpers. */
function printedSize(page: DocPage, overrides: TokenOverrides, system: DesignSystemExport): PageSize | null {
  const { width, height } = pageOf(exportDesign(system, overrides), page.size);
  return sizeOf(width, height);
}

/** `system`: the governing system's export helpers, null while they are not known. */
export function pageInForce(page: DocPage, overrides: TokenOverrides, system: DesignSystemExport | null): PageInForce {
  const compact = page.density === 'compact';
  if (system === null) return { size: page.size ?? null, compact, sizeKnown: false };
  return { size: printedSize(page, overrides, system), compact, sizeKnown: true };
}

/** Writes what choosing `item` asks, in one transaction of `origin`; answers whether it wrote. */
export function choosePage(doc: Doc, item: PageItem, system: DesignSystemExport | null, origin: unknown = PAGE_ORIGIN): boolean {
  const page = docPage(doc);
  if (item === 'compact') {
    setDocPage(doc, { ...page, density: page.density === 'compact' ? undefined : 'compact' }, origin);
    return true;
  }
  const overrides = dsOverrides(doc);
  const inForce = pageInForce(page, overrides, system);
  if (system === null || !inForce.sizeKnown || inForce.size === item) return false;
  const systemSize = printedSize({}, {}, system); // the page the system gives a document that sets none
  transact(
    doc,
    () => {
      setDocPage(doc, { ...page, size: item === systemSize ? undefined : item });
      if (WIDTH in overrides || HEIGHT in overrides) {
        const rest = Object.fromEntries(Object.entries(overrides).filter(([name]) => name !== WIDTH && name !== HEIGHT)) as TokenOverrides;
        setDsOverrides(doc, Object.keys(rest).length > 0 ? rest : null);
      }
    },
    origin,
  );
  return true;
}
