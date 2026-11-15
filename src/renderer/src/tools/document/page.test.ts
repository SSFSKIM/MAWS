// The page items of a document's Export menu (UX wave U10b, §B.5 and M3 decision 1 of
// docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md; the owner's answer to the card "Export menu", "Always
// show the page in force"): which of Letter and A4 is the size in force, and what choosing an item writes, in one
// transaction with the person's origin.
import { describe, expect, it } from 'vitest';
import { docPage, dsOverrides, setDocPage, setDsOverrides } from '@artifacts/document/meta';
import { newDoc, onUpdate, type Doc } from '@artifacts/yjs';
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
    expect(pageInForce({}, {}, 'letter')).toEqual({ size: 'letter', compact: false, sizeKnown: true });
    expect(pageInForce({}, {}, 'a4')).toEqual({ size: 'a4', compact: false, sizeKnown: true });
    expect(pageInForce({ size: 'a4' }, {}, 'letter')).toEqual({ size: 'a4', compact: false, sizeKnown: true });
    expect(pageInForce({ density: 'compact' }, {}, 'letter')).toEqual({ size: 'letter', compact: true, sizeKnown: true });
  });

  it('is not known while the system’s page is not, unless the document names its own size', () => {
    expect(pageInForce({}, {}, null)).toEqual({ size: null, compact: false, sizeKnown: false });
    expect(pageInForce({ size: 'letter', density: 'compact' }, {}, null)).toEqual({ size: 'letter', compact: true, sizeKnown: true });
  });

  // L4: the document's own overrides of the page's width or height decide the size its exports print on
  it('is neither size when the document’s overrides set another page, and the size the overrides spell otherwise', () => {
    expect(pageInForce({}, { '--ds-page-width': '6in', '--ds-page-height': '9in' }, 'letter')).toEqual({ size: null, compact: false, sizeKnown: true });
    expect(pageInForce({}, { '--ds-page-width': '7in' }, 'letter'), 'one side overridden, the other the system’s').toMatchObject({ size: null, sizeKnown: true });
    expect(pageInForce({}, { '--ds-page-width': '210mm', '--ds-page-height': '297mm' }, 'letter')).toMatchObject({ size: 'a4' });
    expect(pageInForce({}, { '--ds-page-width': '816px', '--ds-page-height': '11in' }, 'a4')).toMatchObject({ size: 'letter' });
    expect(pageInForce({ size: 'a4' }, { '--ds-page-width': '6in', '--ds-page-height': '9in' }, 'letter'), 'the document’s size wins over its overrides, as at export').toMatchObject({ size: 'a4' });
    expect(pageInForce({}, { '--ds-page-width': '7in' }, null), 'the other side is the system’s, not known yet').toMatchObject({ size: null, sizeKnown: false });
  });
});

describe('choosing a page item', () => {
  it('writes the other size as one transaction of the person’s origin, and nothing for the size in force', () => {
    const doc = newDoc();
    expect(writes(doc, () => expect(choosePage(doc, 'letter', 'letter')).toBe(false)), 'the size in force: nothing written').toEqual([]);
    expect(writes(doc, () => expect(choosePage(doc, 'a4', 'letter')).toBe(true))).toEqual([PAGE_ORIGIN]);
    expect(docPage(doc)).toEqual({ size: 'a4' });
    expect(writes(doc, () => choosePage(doc, 'a4', 'letter'))).toEqual([]);
  });

  it('clears the document’s size when the one chosen is the system’s page, so the document follows its system again', () => {
    const doc = newDoc();
    setDocPage(doc, { size: 'a4', density: 'compact' });
    expect(writes(doc, () => choosePage(doc, 'letter', 'letter'))).toEqual([PAGE_ORIGIN]);
    expect(docPage(doc)).toEqual({ density: 'compact' });
    setDocPage(doc, { size: 'letter' });
    choosePage(doc, 'a4', 'a4');
    expect(docPage(doc)).toEqual({});
    expect(doc.get('meta').getAttr('page'), 'an empty page removes the attribute').toBeUndefined();
  });

  it('toggles Compact, keeping the size', () => {
    const doc = newDoc();
    setDocPage(doc, { size: 'a4' });
    expect(writes(doc, () => choosePage(doc, 'compact', 'letter'))).toEqual([PAGE_ORIGIN]);
    expect(docPage(doc)).toEqual({ size: 'a4', density: 'compact' });
    choosePage(doc, 'compact', null); // the system's page plays no part in the density
    expect(docPage(doc)).toEqual({ size: 'a4' });
  });

  it('removes the document’s overrides of the page’s width and height in the same transaction, keeping its others (L4)', () => {
    const doc = newDoc();
    setDsOverrides(doc, { '--ds-page-width': '6in', '--ds-page-height': '9in', '--ds-font-body': 'Georgia, serif' });
    expect(writes(doc, () => choosePage(doc, 'a4', 'letter'))).toEqual([PAGE_ORIGIN]);
    expect([docPage(doc), dsOverrides(doc)]).toEqual([{ size: 'a4' }, { '--ds-font-body': 'Georgia, serif' }]);
    setDsOverrides(doc, { '--ds-page-height': '9in' });
    expect(writes(doc, () => choosePage(doc, 'letter', 'letter')), 'the system’s size chosen: the size cleared and the override gone, in one').toEqual([PAGE_ORIGIN]);
    expect([docPage(doc), doc.get('meta').getAttr('dsOverrides')]).toEqual([{}, undefined]);
  });

  it('writes no size while the size in force is not known', () => {
    const doc = newDoc();
    expect(writes(doc, () => expect(choosePage(doc, 'a4', null)).toBe(false))).toEqual([]);
  });
});
