// The deck editor's Export menu (P3-C M9; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D12): its entries, and
// an entry's export through main's service (the PPTX font variant on the request) saved where the owner chooses.
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNotices } from '../../stores/notices';
import { installFakeMain, ok } from '../../test-support/code';
import { DECK_EXPORTS, deckExports, exportDeck } from './exports';

const A = '00000000-0000-4000-8000-000000000001';
const toasts = () => useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => [n.level, n.text]);

beforeEach(() => useNotices.setState({ notices: [] }));

describe('the deck’s Export menu', () => {
  it('offers PowerPoint in three font variants, PDF, HTML, For Claude and PNG', () => {
    const picked: string[] = [];
    const entries = deckExports(A, (entry) => picked.push(entry.id));
    expect(entries.map((e) => e.label)).toEqual(['PowerPoint (fonts by name)', 'PowerPoint (basic fonts)', 'PowerPoint (slides as pictures)', 'PDF', 'HTML (one page)', 'For Claude (zip)', 'PNG (cover slide)']);
    entries[2]!.onSelect();
    expect(picked).toEqual(['pptx-pictures']);
  });

  it('exports with the entry’s fonts and saves that export where the owner chooses', async () => {
    const main = installFakeMain((name) => (name === 'artifacts.export' ? ok({ path: '/store/x/exports/7-pptx.pptx', revision: 7 }) : ok({ saved: true, path: '/Users/me/Downloads/Deck.pptx' })));
    await act(() => exportDeck(A, DECK_EXPORTS.find((e) => e.id === 'pptx-basic')!));
    await act(() => exportDeck(A, DECK_EXPORTS.find((e) => e.id === 'pdf')!));
    expect(main.calls).toEqual([
      { name: 'artifacts.export', input: { artifactId: A, format: 'pptx', fonts: 'basic' } },
      { name: 'library.saveAs', input: { artifactId: A, source: { export: { revision: 7, format: 'pptx' } } } },
      { name: 'artifacts.export', input: { artifactId: A, format: 'pdf' } },
      { name: 'library.saveAs', input: { artifactId: A, source: { export: { revision: 7, format: 'pdf' } } } },
    ]);
    expect(toasts()).toEqual([
      ['info', 'Saved to /Users/me/Downloads/Deck.pptx'],
      ['info', 'Saved to /Users/me/Downloads/Deck.pptx'],
    ]);
  });

  it('tells a refused export and saves nothing', async () => {
    const main = installFakeMain(() => ({ ok: false, error: { code: 'internal', message: 'the export did not finish within 55 s' } }));
    await act(() => exportDeck(A, DECK_EXPORTS[0]!));
    expect(main.calls).toHaveLength(1);
    expect(toasts()).toEqual([['warning', 'Couldn’t export: the export did not finish within 55 s']]);
  });
});
