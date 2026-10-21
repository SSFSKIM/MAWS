// P4-B2 D19: what the agent's answer says of a deck's faces: an uploaded face whose file the deck lacks (as before), and
// each Google Fonts face that does not draw yet, refused by name or pending while the host fetches it.
import { describe, expect, it } from 'vitest';
import { newDoc, transact } from '../yjs';
import * as Y from '../yjs/slides';
import { assetWarnings } from './answer';
import { DECK_PATH } from './deck';

const LORA = 'https://fonts.googleapis.com/css2?family=Lora';
const SLAB = 'https://fonts.googleapis.com/css2?family=Roboto+Slab';

describe('the answer’s face warnings', () => {
  it('names a refused face by its licence, a bad link by what it names, and a pending one; a saved or uploaded face says nothing', () => {
    const doc = newDoc();
    transact(doc, () => {
      Y.setDeckEntry(doc, 'faces', 'roboto-slab', { family: 'Roboto Slab', href: SLAB, google: { request: SLAB, refused: 'Apache-2.0' } });
      Y.setDeckEntry(doc, 'faces', 'lora', { family: 'Lora', href: LORA, google: { request: LORA, licence: 'OFL', licenceSrc: 'assets/gf-lora-OFL.txt', files: [{ src: 'assets/gf-lora-400.woff2', weight: '400', style: 'normal' }] } });
      Y.setDeckEntry(doc, 'faces', 'inter', { family: 'Inter', href: 'https://fonts.googleapis.com/css2?family=Inter' });
      Y.setDeckEntry(doc, 'faces', 'brand', { family: 'Brand', href: SLAB });
      Y.setDeckEntry(doc, 'faces', 'upload', { family: 'Upload', src: 'assets/upload.woff2' });
    });
    const warnings = assetWarnings(doc, new Set(['assets/gf-lora-400.woff2', 'assets/gf-lora-OFL.txt', 'assets/upload.woff2']), [DECK_PATH]);
    expect(warnings).toEqual([
      { path: DECK_PATH, property: 'faces.roboto-slab', message: 'Roboto Slab is Apache-2.0 on Google Fonts; MAWS fetches only OFL faces, so it draws as its fallback; upload a font file to use it' },
      { path: DECK_PATH, property: 'faces.inter', message: expect.stringMatching(/^Inter is not in this deck yet: MAWS fetches it from Google Fonts once/) },
      { path: DECK_PATH, property: 'faces.brand', message: expect.stringContaining('link names Roboto Slab, not Brand') },
    ]);
  });
});
