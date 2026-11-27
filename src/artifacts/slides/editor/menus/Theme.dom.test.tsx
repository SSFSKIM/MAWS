// P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): Theme ▸ Faces lists each of the deck's faces by
// family with its state, so the owner sees what MAWS fetched from Google Fonts, what waits for it, and what it refused
// by name.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    // the word cut (G465, G466): a face that draws is its family alone; only an exception carries words
    expect(read('brand-sans')).toEqual(['uploaded', 'Brand Sans']);
    expect(read('lora')).toEqual(['saved', 'Lora']);
    expect(read('source-serif-4')).toEqual(['pending', 'Source Serif 4 Waiting for Google Fonts']);
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
    expect(screen.getByRole('listitem').textContent).toBe('Blob No font file');
    cleanup();
    panel({});
    expect(screen.queryByRole('list', { name: 'This deck’s faces' })).toBeNull();
  });
});

// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3): Default has no caption unless it is
// chosen (G461), the Faces rows read Display and Body (G463), and the reset reads Reset all (G468).
describe('the word cut in the Theme panel', () => {
  const theme = (chosen: string | null) => ({ systems: [{ id: 'ds1', name: 'Brand' }], chosen, choose: async () => {} });

  it('Default carries no caption while another system is chosen, and the governing system’s name once it is', async () => {
    render(<ThemePanel session={session()} system={{ builtin: 'maws' }} theme={theme('ds1')} overrides={{}} faces={{}} readOnly={false} />);
    const radio = screen.getByRole('radio', { name: /^Default/ });
    expect(radio.querySelector('.deck-theme-system-detail')).toBeNull();
    cleanup();
    render(<ThemePanel session={session()} system={{ builtin: 'maws' }} theme={theme(null)} overrides={{}} faces={{}} readOnly={false} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Default/ }).querySelector('.deck-theme-system-detail')?.textContent).toBeTruthy());
  });

  it('the Faces rows read Display and Body; their selects keep the full names', () => {
    panel({});
    const faces = screen.getByRole('region', { name: 'Faces' });
    expect([...faces.querySelectorAll('.deck-inspector-caption')].map((n) => n.textContent)).toEqual(['Display', 'Body']);
    expect(within(faces).getByRole('combobox', { name: 'Display face' })).toBeTruthy();
    expect(within(faces).getByRole('combobox', { name: 'Body face' })).toBeTruthy();
  });

  it('the reset of every override reads Reset all', () => {
    const s = session();
    render(<ThemePanel session={s} system={null} overrides={{ '--ds-color-accent': '#ff0000' }} faces={{}} readOnly={false} />);
    const reset = screen.getByRole('button', { name: 'Reset all' });
    fireEvent.click(reset);
    expect(screen.queryByText(/Use the system/)).toBeNull();
  });
});
