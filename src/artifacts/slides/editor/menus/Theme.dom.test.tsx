// P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): Theme ▸ Faces lists each of the deck's faces by
// family with its state, so the owner sees what MAWS fetched from Google Fonts, what waits for it, and what it refused
// by name.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, transact } from '../../../yjs';
import type { DeckFace } from '../../deck';
import { loraFace, ROBOTO_SLAB_REFUSAL, robotoSlabFace, TODAYS_FACES } from '../../export/faces.test-support';
import { writeDeckKeys } from '../../model';
import { DeckSession } from '../session';
import { ThemePanel } from './Theme';

function session(): DeckSession {
  const doc = newDoc();
  transact(doc, () => writeDeckKeys(doc, { v: 4, title: 'T', order: [] }));
  return new DeckSession(doc);
}
const panel = (faces: Record<string, DeckFace>) => render(<ThemePanel session={session()} system={null} overrides={{}} faces={faces} readOnly={false} />);

afterEach(cleanup);

describe('Theme ▸ Faces (D19)', () => {
  it('lists each face by family with its state: an upload, saved, pending, refused by name', () => {
    panel({ 'brand-sans': TODAYS_FACES['brand-sans']!, lora: loraFace(), 'source-serif-4': TODAYS_FACES['source-serif-4']!, 'roboto-slab': robotoSlabFace() });
    const faces = within(screen.getByRole('region', { name: 'Faces' })).getByRole('list', { name: 'This deck’s faces' });
    const rows = within(faces).getAllByRole('listitem');
    const read = (key: string) => {
      const row = rows.find((r) => r.dataset.face === key)!;
      return [row.dataset.faceState, row.textContent];
    };
    expect(rows).toHaveLength(4);
    expect(read('brand-sans')).toEqual(['uploaded', 'Brand Sans Uploaded font file']);
    expect(read('lora')).toEqual(['saved', 'Lora Saved in this deck (Google Fonts, OFL)']);
    expect(read('source-serif-4')).toEqual(['pending', 'Source Serif 4 Draws as its fallback until MAWS reaches Google Fonts']);
    expect(read('roboto-slab')).toEqual(['refused', `Roboto Slab ${ROBOTO_SLAB_REFUSAL}`]);
    expect(within(faces).getByText(ROBOTO_SLAB_REFUSAL)).toBeTruthy(); // the refusal as text of its own, by name
  });

  it('names a link MAWS refuses before fetching, and lists nothing for a deck with no faces of its own', () => {
    panel({ lora: { family: 'Lora', href: 'https://fonts.googleapis.com/css2?family=Lora&text=Hi' } });
    const row = screen.getByRole('listitem');
    expect(row.dataset.faceState).toBe('refused');
    expect(row.textContent).toMatch(/^Lora Lora's link carries text=/);
    cleanup();
    // a Claude reference MAWS holds no file for draws as its fallback, and says so
    panel({ blob: TODAYS_FACES.blob! });
    expect(screen.getByRole('listitem').dataset.faceState).toBe('missing');
    expect(screen.getByRole('listitem').textContent).toBe('Blob No font file in this deck: draws as its fallback');
    cleanup();
    panel({});
    expect(screen.queryByRole('list', { name: 'This deck’s faces' })).toBeNull();
  });
});
