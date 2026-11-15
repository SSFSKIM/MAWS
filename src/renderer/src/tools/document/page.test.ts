// The page items of a document's Export menu (UX wave U10b, §B.5 and M3 decision 1 of
// docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md; the owner's answer to the card "Export menu", "Always
// show the page in force"): which of Letter and A4 is the size in force, and what choosing an item writes, in one
// transaction with the person's origin.
import { describe, expect, it } from 'vitest';
import { docPage, dsOverrides, setDocPage, setDsOverrides } from '@artifacts/document/meta';
import { newDoc, onUpdate, type Doc } from '@artifacts/yjs';
import { exportDesign, pageOf } from '@artifacts/document/export/design-system';
import { A4_SYSTEM, LETTER_SYSTEM } from '../../test-support/page-systems';
import { choosePage, PAGE_ORIGIN, pageInForce } from './page';

/** The origins of the transactions `doc` saw while `act` ran. */
function writes(doc: Doc, act: () => void): unknown[] {
  const origins: unknown[] = [];
  const off = onUpdate(doc, (_update, origin) => origins.push(origin));
  try {
    act();
  } finally {
    off();
  }
  return origins;
}

describe('the size in force', () => {
  it('is the document’s size, else the system’s page; compact is the document’s density', () => {
    expect(pageInForce({}, {}, LETTER_SYSTEM)).toEqual({ size: 'letter', compact: false, sizeKnown: true });
    expect(pageInForce({}, {}, A4_SYSTEM)).toEqual({ size: 'a4', compact: false, sizeKnown: true });
    expect(pageInForce({ size: 'a4' }, {}, LETTER_SYSTEM)).toEqual({ size: 'a4', compact: false, sizeKnown: true });
    expect(pageInForce({ density: 'compact' }, {}, LETTER_SYSTEM)).toEqual({ size: 'letter', compact: true, sizeKnown: true });
  });

  // M3 decision 6 and the branch review's finding 1: a size choice rests on the system's page (choosing it clears the
  // document's size), so the sizes take no choice until it is known; a size the document names is still shown
  it('is not known while the system’s page is not, and still names the size the document sets', () => {
    expect(pageInForce({}, {}, null)).toEqual({ size: null, compact: false, sizeKnown: false });
    expect(pageInForce({ size: 'letter', density: 'compact' }, {}, null)).toEqual({ size: 'letter', compact: true, sizeKnown: false });
    expect(pageInForce({}, { '--ds-page-width': '210mm', '--ds-page-height': '297mm' }, null), 'both sides overridden: read only through the system’s resolver').toEqual({ size: null, compact: false, sizeKnown: false });
  });

  // L4: the document's own overrides of the page's width or height decide the size its exports print on
  it('is neither size when the document’s overrides set another page, and the size the overrides spell otherwise', () => {
    expect(pageInForce({}, { '--ds-page-width': '6in', '--ds-page-height': '9in' }, LETTER_SYSTEM)).toEqual({ size: null, compact: false, sizeKnown: true });
    expect(pageInForce({}, { '--ds-page-width': '7in' }, LETTER_SYSTEM), 'one side overridden, the other the system’s').toMatchObject({ size: null, sizeKnown: true });
    expect(pageInForce({}, { '--ds-page-width': '210mm', '--ds-page-height': '297mm' }, LETTER_SYSTEM)).toMatchObject({ size: 'a4' });
    expect(pageInForce({}, { '--ds-page-width': '816px', '--ds-page-height': '11in' }, A4_SYSTEM)).toMatchObject({ size: 'letter' });
    expect(pageInForce({ size: 'a4' }, { '--ds-page-width': '6in', '--ds-page-height': '9in' }, LETTER_SYSTEM), 'the document’s size wins over its overrides, as at export').toMatchObject({ size: 'a4' });
    expect(pageInForce({}, { '--ds-page-width': '7in' }, null), 'the other side is the system’s, not known yet').toMatchObject({ size: null, sizeKnown: false });
  });
});

// The branch review's P2: the overrides' width and height are read as the export reads them, through the governing
// system's resolver (`pageOf` over `exportDesign`), so a reference or a fallback names the page it prints on
describe('the size in force, read as the export reads it', () => {
  const both = (width: string, height: string) => ({ '--ds-page-width': width, '--ds-page-height': height });
  it('reads a reference’s fallback in the width, the height or both', () => {
    expect(pageInForce({}, both('var(--ds-print-width, 210mm)', '297mm'), LETTER_SYSTEM)).toEqual({ size: 'a4', compact: false, sizeKnown: true });
    expect(pageInForce({}, both('210mm', 'var(--ds-print-height, 297mm)'), LETTER_SYSTEM)).toEqual({ size: 'a4', compact: false, sizeKnown: true });
    expect(pageInForce({}, both('var(--ds-print-width, 210mm)', 'var(--ds-print-height, 297mm)'), LETTER_SYSTEM)).toEqual({ size: 'a4', compact: false, sizeKnown: true });
    expect(pageInForce({}, { '--ds-page-width': 'var(--ds-print-width, 8.5in)' }, A4_SYSTEM), 'one side, the other the system’s').toMatchObject({ size: null });
  });

  it('follows a reference to another value to the length it names', () => {
    const chained = { ...both('var(--ds-print-width)', 'var(--ds-print-height)'), '--ds-print-width': '210mm', '--ds-print-height': '297mm' };
    expect(pageInForce({}, chained, LETTER_SYSTEM)).toMatchObject({ size: 'a4', sizeKnown: true });
    expect(pageInForce({}, both('var(--ds-space-8)', 'var(--ds-space-8)'), LETTER_SYSTEM), 'a system length that is no page: neither').toMatchObject({ size: null, sizeKnown: true });
  });

  // what the export does with an override its resolver cannot resolve: drops it, and prints on the system's page
  it('takes the system’s page where the export drops an override that resolves to nothing', () => {
    const lost = both('var(--ds-nowhere)', 'var(--ds-nowhere)');
    expect(pageOf(exportDesign(LETTER_SYSTEM, lost))).toMatchObject({ width: '8.5in', height: '11in' });
    expect(pageOf(exportDesign(A4_SYSTEM, lost))).toMatchObject({ width: '210mm', height: '297mm' });
    expect([pageInForce({}, lost, LETTER_SYSTEM).size, pageInForce({}, lost, A4_SYSTEM).size]).toEqual(['letter', 'a4']);
  });

  it('writes a fallback’s size as the size in force: choosing it writes nothing', () => {
    const doc = newDoc();
    setDsOverrides(doc, both('var(--ds-print-width, 210mm)', '297mm'));
    expect(writes(doc, () => expect(choosePage(doc, 'a4', LETTER_SYSTEM)).toBe(false))).toEqual([]);
  });
});

describe('choosing a page item', () => {
  it('writes the other size as one transaction of the person’s origin, and nothing for the size in force', () => {
    const doc = newDoc();
    expect(writes(doc, () => expect(choosePage(doc, 'letter', LETTER_SYSTEM)).toBe(false)), 'the size in force: nothing written').toEqual([]);
    expect(writes(doc, () => expect(choosePage(doc, 'a4', LETTER_SYSTEM)).toBe(true))).toEqual([PAGE_ORIGIN]);
    expect(docPage(doc)).toEqual({ size: 'a4' });
    expect(writes(doc, () => choosePage(doc, 'a4', LETTER_SYSTEM))).toEqual([]);
  });

  it('clears the document’s size when the one chosen is the system’s page, so the document follows its system again', () => {
    const doc = newDoc();
    setDocPage(doc, { size: 'a4', density: 'compact' });
    expect(writes(doc, () => choosePage(doc, 'letter', LETTER_SYSTEM))).toEqual([PAGE_ORIGIN]);
    expect(docPage(doc)).toEqual({ density: 'compact' });
    setDocPage(doc, { size: 'letter' });
    choosePage(doc, 'a4', A4_SYSTEM);
    expect(docPage(doc)).toEqual({});
    expect(doc.get('meta').getAttr('page'), 'an empty page removes the attribute').toBeUndefined();
  });

  it('toggles Compact, keeping the size', () => {
    const doc = newDoc();
    setDocPage(doc, { size: 'a4' });
    expect(writes(doc, () => choosePage(doc, 'compact', LETTER_SYSTEM))).toEqual([PAGE_ORIGIN]);
    expect(docPage(doc)).toEqual({ size: 'a4', density: 'compact' });
    choosePage(doc, 'compact', null); // the system's page plays no part in the density
    expect(docPage(doc)).toEqual({ size: 'a4' });
  });

  it('removes the document’s overrides of the page’s width and height in the same transaction, keeping its others (L4)', () => {
    const doc = newDoc();
    setDsOverrides(doc, { '--ds-page-width': '6in', '--ds-page-height': '9in', '--ds-font-body': 'Georgia, serif' });
    expect(writes(doc, () => choosePage(doc, 'a4', LETTER_SYSTEM))).toEqual([PAGE_ORIGIN]);
    expect([docPage(doc), dsOverrides(doc)]).toEqual([{ size: 'a4' }, { '--ds-font-body': 'Georgia, serif' }]);
    setDsOverrides(doc, { '--ds-page-height': '9in' });
    expect(writes(doc, () => choosePage(doc, 'letter', LETTER_SYSTEM)), 'the system’s size chosen: the size cleared and the override gone, in one').toEqual([PAGE_ORIGIN]);
    expect([docPage(doc), doc.get('meta').getAttr('dsOverrides')]).toEqual([{}, undefined]);
  });

  it('writes no size while the system’s page is not known, whatever the document sets', () => {
    const doc = newDoc();
    expect(writes(doc, () => expect(choosePage(doc, 'a4', null)).toBe(false))).toEqual([]);
    setDocPage(doc, { size: 'a4' }); // an agent's A4 on a document whose system is Letter, still loading here
    expect(writes(doc, () => expect(choosePage(doc, 'letter', null)).toBe(false)), 'no explicit Letter stored in place of the system’s').toEqual([]);
    expect(docPage(doc)).toEqual({ size: 'a4' });
    setDocPage(doc, {});
    setDsOverrides(doc, { '--ds-page-width': '210mm', '--ds-page-height': '297mm' });
    expect(writes(doc, () => expect(choosePage(doc, 'letter', null)).toBe(false)), 'the overrides spell A4: still no choice').toEqual([]);
    expect(writes(doc, () => expect(choosePage(doc, 'compact', null)).toBe(true)), 'Compact rests on no system').toEqual([PAGE_ORIGIN]);
  });
});
