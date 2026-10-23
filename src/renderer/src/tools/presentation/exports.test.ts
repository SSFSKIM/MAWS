// The deck editor's Export menu (P3-C M9; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D12): its entries, and
// an entry's export through main's service (the PPTX font variant on the request) saved where the owner chooses.
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNotices } from '../../stores/notices';
import { installFakeMain, ok } from '../../test-support/code';
import { DECK_EXPORTS, deckExports, exportDeck } from './exports';

const A = '00000000-0000-4000-8000-000000000001';
const E = '00000000-0000-4000-8000-0000000000e1'; // an export's own id, as main mints it
const toasts = () => useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => [n.level, n.text]);

beforeEach(() => useNotices.setState({ notices: [] }));

describe('the deck’s Export menu', () => {
  it('offers PowerPoint in three font variants, PDF, HTML, For Claude and PNG', () => {
    const picked: string[] = [];
    const entries = deckExports(A, null, (entry) => picked.push(entry.id));
    expect(entries.map((e) => e.label)).toEqual(['PowerPoint', 'PDF', 'HTML (one page)', 'For Claude (zip)', 'PNG (all slides)']);
    expect(entries[0]!.children?.map((e) => e.id)).toEqual(['pptx-basic', 'pptx-named', 'pptx-pictures']);
    entries[0]!.children![2]!.onSelect();
    expect(picked).toEqual(['pptx-pictures']);
  });

  it('exports with the entry’s fonts and saves that export where the owner chooses', async () => {
    // P4 (W1, tracker 2026-10-19 L302): each export takes a file of its own and the save names it by its id, so an export
    // of the same revision and format between the two (the agent's, the other paper) never swaps the file saved
    const main = installFakeMain((name) => (name === 'artifacts.export' ? ok({ path: `/store/x/exports/7-pptx-${E}.pptx`, revision: 7, exportId: E }) : ok({ saved: true, path: '/Users/me/Downloads/Deck.pptx' })));
    await act(() => exportDeck(A, DECK_EXPORTS.find((e) => e.id === 'pptx-basic')!));
    await act(() => exportDeck(A, DECK_EXPORTS.find((e) => e.id === 'pdf')!));
    expect(main.calls).toEqual([
      { name: 'artifacts.export', input: { artifactId: A, format: 'pptx', fonts: 'basic', ownFile: true } },
      { name: 'library.saveAs', input: { artifactId: A, source: { export: { revision: 7, format: 'pptx', exportId: E } } } },
      { name: 'artifacts.export', input: { artifactId: A, format: 'pdf', ownFile: true } },
      { name: 'library.saveAs', input: { artifactId: A, source: { export: { revision: 7, format: 'pdf', exportId: E } } } },
    ]);
    expect(toasts()).toEqual([
      ['info', 'Saved to /Users/me/Downloads/Deck.pptx'],
      ['info', 'Saved to /Users/me/Downloads/Deck.pptx'],
    ]);
  });

  // P3-F (L233; the design's what-you-see rule, P3-E's Decision Log 31): the header exports what the editor shows
  it('exports the version the history previews, the live deck otherwise, and offers nothing while two are compared', async () => {
    const main = installFakeMain((name) => (name === 'artifacts.export' ? ok({ path: '/store/x/exports/4-pdf.pdf', revision: 4 }) : ok({ saved: true, path: '/Users/me/Downloads/Deck.pdf' })));
    const pdf = DECK_EXPORTS.find((e) => e.id === 'pdf')!;
    const chosen: string[] = [];
    for (const shown of [null, { versionId: 3 }] as const) {
      const entries = deckExports(A, shown);
      expect(entries.some((e) => e.disabled)).toBe(false);
    }
    expect(deckExports(A, 'compare', (entry) => chosen.push(entry.id)).every((e) => e.disabled)).toBe(true);
    expect(chosen).toEqual([]);
    await act(() => exportDeck(A, pdf, { versionId: 3 }));
    await act(() => exportDeck(A, pdf, null));
    await act(() => exportDeck(A, pdf, 'compare')); // two versions compared: nothing is exported
    expect(main.calls).toEqual([
      { name: 'artifacts.export', input: { artifactId: A, format: 'pdf', versionId: 3, ownFile: true } },
      { name: 'library.saveAs', input: { artifactId: A, source: { export: { revision: 4, format: 'pdf' } } } },
      { name: 'artifacts.export', input: { artifactId: A, format: 'pdf', ownFile: true } },
      { name: 'library.saveAs', input: { artifactId: A, source: { export: { revision: 4, format: 'pdf' } } } },
    ]);
  });

  it('tells a refused export and saves nothing', async () => {
    const main = installFakeMain(() => ({ ok: false, error: { code: 'internal', message: 'the export did not finish within 55 s' } }));
    await act(() => exportDeck(A, DECK_EXPORTS[0]!));
    expect(main.calls).toHaveLength(1);
    expect(toasts()).toEqual([['warning', 'Couldn’t export: the export did not finish within 55 s']]);
  });
});
