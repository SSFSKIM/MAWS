// The design's Export menu and sheet (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M5; XE9 and the
// parent's Decision Logs 26 and 31): its entries for the tab's selected board and every board, the request each sends
// (the board from the tab's state, the version the history shows), every entry disabled while two versions are compared,
// and an over-cap picture: the sheet states the fitting scale from main's refusal, the export runs at it when the owner
// agrees and nothing is written when they do not.
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNotices } from '../../stores/notices';
import { installFakeMain, ok } from '../../test-support/code';
import { DESIGN_EXPORTS, designExportRequest, designExports, exportDesign, runDesignExport, type DesignExportAsk } from './exports';

const A = '00000000-0000-4000-8000-0000000000d5';
const toasts = () => useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => [n.level, n.text]);
const entry = (id: string) => DESIGN_EXPORTS.find((e) => e.id === id)!;

beforeEach(() => useNotices.setState({ notices: [] }));

describe('the design’s Export menu', () => {
  it('offers the selected board as PNG or PDF and every board as PDF', () => {
    const picked: string[] = [];
    const entries = designExports({ shown: null, board: 'phone' }, (e) => picked.push(e.id));
    expect(entries.map((e) => [e.label, e.disabled ?? false])).toEqual([
      ['PNG (selected board)', false],
      ['PDF (selected board)', false],
      ['PDF (all boards)', false],
    ]);
    entries[2]!.onSelect();
    expect(picked).toEqual(['pdf']);
  });

  it('disables the board’s entries with no board, and every entry while two versions are compared', () => {
    expect(designExports({ shown: null, board: null }, () => {}).map((e) => e.disabled ?? false)).toEqual([true, true, false]);
    expect(designExports({ shown: 'compare', board: 'phone' }, () => {}).map((e) => e.disabled)).toEqual([true, true, true]);
  });

  it('asks for the tab’s board, every board, and the version the history shows', () => {
    const live = { shown: null, board: 'phone', label: 'Phone' };
    expect(designExportRequest(entry('png'), live)).toEqual({ format: 'png', board: 'phone' });
    expect(designExportRequest(entry('pdf-board'), live)).toEqual({ format: 'pdf', boards: ['phone'] });
    expect(designExportRequest(entry('pdf'), live)).toEqual({ format: 'pdf' });
    const version = { versionId: 4, board: 'poster', label: 'Poster' };
    expect(designExportRequest(entry('png'), { shown: version, board: 'poster', label: 'Poster' })).toEqual({ format: 'png', board: 'poster', versionId: 4 });
    expect(designExportRequest(entry('pdf'), { shown: version, board: null, label: null })).toEqual({ format: 'pdf', versionId: 4 });
  });
});

describe('an export from the menu', () => {
  const tooLarge = { ok: false as const, error: { code: 'invalid_input', message: 'board poster is 1080×9000 px …', issues: { reason: 'exportTooLarge', data: { board: 'poster', w: 1080, h: 9000, maxScale: 0.9102 } } } };

  it('saves the board’s export where the owner chooses', async () => {
    const exportId = '00000000-0000-4000-8000-0000000000e7';
    const main = installFakeMain((name) => (name === 'artifacts.export' ? ok({ path: `/store/x/exports/7-png-${exportId}.png`, revision: 7, exportId }) : ok({ saved: true, path: '/Users/me/Downloads/Screens.png' })));
    await act(() => exportDesign(A, { format: 'png', board: 'phone', versionId: 3 }, { ask: async () => true, boardName: (id) => id }));
    expect(main.calls).toEqual([
      { name: 'artifacts.export', input: { artifactId: A, format: 'png', board: 'phone', versionId: 3 } },
      { name: 'library.saveAs', input: { artifactId: A, source: { export: { revision: 7, format: 'png', exportId } } } }, // its own file (Decision Log 33)
    ]);
    expect(toasts()).toEqual([['info', 'Saved to /Users/me/Downloads/Screens.png']]);
  });

  it('a picture over the cap: the sheet states the fitting scale and the size it gives; agreed, it exports at that scale', async () => {
    let first = true;
    const main = installFakeMain((name) => {
      if (name !== 'artifacts.export') return ok({ saved: true, path: '/Users/me/Downloads/Screens.png' });
      if (!first) return ok({ path: '/store/x/exports/7-png.png', revision: 7 });
      first = false;
      return tooLarge;
    });
    const asked: Parameters<DesignExportAsk>[0][] = [];
    await act(() => exportDesign(A, { format: 'png', board: 'poster' }, { ask: async (sheet) => (asked.push(sheet), true), boardName: () => 'Poster' }));
    expect(asked).toEqual([
      {
        title: 'Export “Poster” at 91.02%?',
        body: '“Poster” is 1080 × 9000 px. A PNG can be at most 8192 px on a side, so MAWS exports the whole board at 91.02% (983 × 8192 px); nothing is cropped.',
        confirmLabel: 'Export at 91.02%',
        destructive: false,
      },
    ]);
    expect(main.calls.map((c) => [c.name, c.input])).toEqual([
      ['artifacts.export', { artifactId: A, format: 'png', board: 'poster' }],
      ['artifacts.export', { artifactId: A, format: 'png', board: 'poster', scale: 0.9102 }],
      ['library.saveAs', { artifactId: A, source: { export: { revision: 7, format: 'png' } } }],
    ]);
  });

  it('the sheet names the board as the shown version names it, not as the live design does', async () => {
    installFakeMain(() => tooLarge);
    const asked: string[] = [];
    const context = { board: 'poster', label: 'Festival poster (Draft)', shown: { versionId: 2, board: 'poster', label: 'Festival poster (Draft)' } };
    await act(() => runDesignExport(A, entry('png'), context, { ask: async (sheet) => (asked.push(sheet.title), false) }));
    expect(asked).toEqual(['Export “Festival poster (Draft)” at 91.02%?']);
  });

  it('declined, nothing more is asked of main; any other refusal is told and nothing is saved', async () => {
    const main = installFakeMain(() => tooLarge);
    await act(() => exportDesign(A, { format: 'png', board: 'poster' }, { ask: async () => false, boardName: () => 'Poster' }));
    expect(main.calls).toHaveLength(1);
    expect(toasts()).toEqual([]);
    const other = installFakeMain(() => ({ ok: false, error: { code: 'invalid_input', message: 'board bad is held', issues: { reason: 'invalid', data: { board: 'bad' } } } }));
    await act(() => exportDesign(A, { format: 'png', board: 'bad' }, { ask: async () => true, boardName: () => 'Bad' }));
    expect(other.calls).toHaveLength(1);
    expect(toasts()).toEqual([['warning', 'Couldn’t export: board bad is held']]);
  });
});
