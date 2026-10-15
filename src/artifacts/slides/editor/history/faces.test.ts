// P3-C M8 fix wave 1 (R2; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11, D6): a version's preview draws
// the deck's uploaded faces as the version had them, each resolved against the version's own assets, never the live
// deck's mapping.
import { describe, expect, it } from 'vitest';
import { newDoc, transact } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { previewFaceRules } from './faces';

function deckWithFaces(faces: Record<string, { family: string; src: string }>) {
  const doc = newDoc();
  transact(doc, () => {
    for (const [key, face] of Object.entries(faces)) Y.setDeckEntry(doc, 'faces', key, face);
  });
  return doc;
}
const at = (revision: number | null) => (ref: string) => `maws-artifact://deck/${ref}${revision === null ? '' : `@${revision}`}`;

describe('the preview’s faces (R2)', () => {
  it('maps each family to the version’s own upload at the version’s revision when the deck’s mapping changed since', () => {
    const shown = deckWithFaces({ brand: { family: 'Brand', src: 'assets/brand-1.woff2' } }); // the version
    const earlier = deckWithFaces({ brand: { family: 'Brand', src: 'assets/brand-0.woff2' }, old: { family: 'Old Face', src: 'assets/old.woff2' } });
    const rules = previewFaceRules({ shown, earlier }, { shown: at(12), earlier: at(7) });
    expect(rules).toContain('font-family: "Brand"; src: url("maws-artifact://deck/assets/brand-1.woff2@12")');
    expect(rules).not.toContain('brand-0');
    // a family only the earlier state has (a deleted element ghosted in it) is drawn from the earlier state's assets
    expect(rules).toContain('font-family: "Old Face"; src: url("maws-artifact://deck/assets/old.woff2@7")');
  });

  it('draws the live deck’s faces from the live assets when the preview shows the live deck', () => {
    const shown = deckWithFaces({ brand: { family: 'Brand', src: 'assets/brand-2.woff2' } });
    const earlier = deckWithFaces({ brand: { family: 'Brand', src: 'assets/brand-1.woff2' } });
    const rules = previewFaceRules({ shown, earlier }, { shown: at(null), earlier: at(12) });
    expect(rules).toBe('@font-face { font-family: "Brand"; src: url("maws-artifact://deck/assets/brand-2.woff2"); }');
  });
});
