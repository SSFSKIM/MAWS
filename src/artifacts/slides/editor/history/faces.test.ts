// P3-C M8 fix waves 1 and 2 (R2; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11, D6): a version's preview
// draws the deck's uploaded faces as each state of the comparison had them, at that state's assets, under private names
// of its own, so the live editor of the same deck in the same window, the version and its earlier state never compete
// for one family.
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { newDoc, transact } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { aliasFaces, aliasFamilyList, previewFaces } from './faces';

function deckWithFaces(faces: Record<string, { family: string; src: string }>) {
  const doc = newDoc();
  transact(doc, () => {
    for (const [key, face] of Object.entries(faces)) Y.setDeckEntry(doc, 'faces', key, face);
  });
  return doc;
}
const at = (revision: number | null) => (ref: string) => `maws-artifact://deck/${revision === null ? 'live' : revision}/${ref}`;

describe('the preview’s faces (R2)', () => {
  it('declares each state’s faces under private names at its own assets, never the authored family', () => {
    const shown = deckWithFaces({ brand: { family: 'Brand', src: 'assets/brand-1.woff2' } }); // the version
    const earlier = deckWithFaces({ brand: { family: 'Brand', src: 'assets/brand-0.woff2' }, old: { family: 'Old Face', src: 'assets/old.woff2' } });
    const faces = previewFaces({ shown, earlier }, { shown: at(12), earlier: at(7) });
    const shownBrand = faces.shown.get('brand')!;
    const earlierBrand = faces.earlier.get('brand')!;
    expect(shownBrand).toMatch(/^deck-face-/);
    expect(earlierBrand).toMatch(/^deck-face-/);
    expect(shownBrand).not.toBe(earlierBrand); // the version and its earlier state draw their own uploads
    expect(faces.css).toContain(`font-family: "${shownBrand}"; src: url("maws-artifact://deck/12/assets/brand-1.woff2")`);
    expect(faces.css).toContain(`font-family: "${earlierBrand}"; src: url("maws-artifact://deck/7/assets/brand-0.woff2")`);
    expect(faces.css).toContain(`url("maws-artifact://deck/7/assets/old.woff2")`);
    expect(faces.css).not.toMatch(/font-family: "Brand"/); // the authored name stays the live editor's
  });

  it('rewrites a drawn slide’s font-family values to the state’s private names, leaving other families and tokens', () => {
    const aliases = new Map([['brand', 'deck-face-x'], ['old face', 'deck-face-y']]);
    expect(aliasFamilyList('"Brand", Arial, sans-serif', aliases)).toBe('"deck-face-x", Arial, sans-serif');
    expect(aliasFamilyList("'Old Face', serif", aliases)).toBe('"deck-face-y", serif');
    expect(aliasFamilyList('Georgia, serif', aliases)).toBe('Georgia, serif');
    expect(aliasFamilyList('var(--ds-font-body, Brand)', aliases)).toBe('var(--ds-font-body, Brand)');
    const root = document.createElement('section');
    root.style.setProperty('font-family', 'Brand, sans-serif');
    const p = document.createElement('p');
    p.style.setProperty('font-family', '"Old Face"');
    root.appendChild(p);
    aliasFaces(root, aliases);
    expect(root.style.getPropertyValue('font-family')).toContain('deck-face-x');
    expect(p.style.getPropertyValue('font-family')).toContain('deck-face-y');
  });
});
