// P3-C M8 fix waves 1 and 2 (R2; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11, D6): a version's preview
// draws the deck's uploaded faces as each state of the comparison had them, at that state's assets, under private names
// of its own, so the live editor of the same deck in the same window, the version and its earlier state never compete
// for one family.
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { newDoc, transact } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import type { DeckFace } from '../../deck';
import { LORA_FILES, LORA_LICENCE, loraFace } from '../../export/faces.test-support';
import { aliasFaces, aliasFamilyList, aliasOverrides, previewFaces } from './faces';

function deckWithFaces(faces: Record<string, DeckFace>) {
  const doc = newDoc();
  transact(doc, () => {
    for (const [key, face] of Object.entries(faces)) Y.setDeckEntry(doc, 'faces', key, face as Y.Json);
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

  // P4-B2 D19: a Google Fonts face the host fetched draws from the state's assets, every file, with its weight and style
  it('declares a fetched face’s every file at the state’s own assets, under one private name per state', () => {
    const shown = deckWithFaces({ lora: loraFace() });
    const earlier = deckWithFaces({ lora: loraFace() });
    const faces = previewFaces({ shown, earlier }, { shown: at(12), earlier: at(7) });
    const [shownLora, earlierLora] = [faces.shown.get('lora')!, faces.earlier.get('lora')!];
    expect(shownLora).toMatch(/^deck-face-/);
    expect(shownLora).not.toBe(earlierLora);
    for (const file of LORA_FILES) {
      expect(faces.css).toContain(`font-family: "${shownLora}"; src: url("maws-artifact://deck/12/${file.src}"); font-weight: ${file.weight}; font-style: ${file.style};`);
      expect(faces.css).toContain(`font-family: "${earlierLora}"; src: url("maws-artifact://deck/7/${file.src}"); font-weight: ${file.weight}; font-style: ${file.style};`);
    }
    expect(faces.css).not.toContain(LORA_LICENCE); // the licence is kept beside the files, never drawn
  });

  it('rewrites a drawn slide’s font-family values to the state’s private names, leaving other families', () => {
    const aliases = new Map([['brand', 'deck-face-x'], ['old face', 'deck-face-y']]);
    expect(aliasFamilyList('"Brand", Arial, sans-serif', aliases)).toBe('"deck-face-x", Arial, sans-serif');
    expect(aliasFamilyList("'Old Face', serif", aliases)).toBe('"deck-face-y", serif');
    expect(aliasFamilyList('Georgia, serif', aliases)).toBe('Georgia, serif');
    const root = document.createElement('section');
    root.style.setProperty('font-family', 'Brand, sans-serif');
    const p = document.createElement('p');
    p.style.setProperty('font-family', '"Old Face"');
    root.appendChild(p);
    aliasFaces(root, aliases);
    expect(root.style.getPropertyValue('font-family')).toContain('deck-face-x');
    expect(p.style.getPropertyValue('font-family')).toContain('deck-face-y');
  });

  // L180: an uploaded family a value names only as an unresolved token's fallback still draws as the upload
  it('rewrites the families inside a var() fallback, a nested one too, and keeps each var() and its token', () => {
    const aliases = new Map([['brand', 'deck-face-x'], ['old face', 'deck-face-y']]);
    expect(aliasFamilyList('var(--ds-font-x, Brand, serif)', aliases)).toBe('var(--ds-font-x, "deck-face-x", serif)');
    expect(aliasFamilyList("var(--ds-font-x, var(--brand-face, 'Old Face'), Brand)", aliases)).toBe('var(--ds-font-x, var(--brand-face, "deck-face-y"), "deck-face-x")');
    expect(aliasFamilyList('var(--ds-font-body), Brand, serif', aliases)).toBe('var(--ds-font-body), "deck-face-x", serif');
    expect(aliasFamilyList('var(--ds-font-body)', aliases)).toBe('var(--ds-font-body)');
    expect(aliasFamilyList('var(--ds-font-body, Georgia, serif)', aliases)).toBe('var(--ds-font-body, Georgia, serif)');
    expect(aliasOverrides({ '--ds-font-display': 'var(--brand-display, "Brand")' }, aliases)).toEqual({ '--ds-font-display': 'var(--brand-display, "deck-face-x")' });
  });

  it('maps the font-token overrides (the Theme’s Body and Display faces) through the same private names (fix wave 3)', () => {
    const aliases = new Map([['brand', 'deck-face-x']]);
    expect(aliasOverrides({ '--ds-font-body': '"Brand", sans-serif', '--ds-font-display': 'Georgia, serif', '--ds-color-bg': '#ffffff' }, aliases)).toEqual({
      '--ds-font-body': '"deck-face-x", sans-serif',
      '--ds-font-display': 'Georgia, serif',
      '--ds-color-bg': '#ffffff',
    });
  });
});
