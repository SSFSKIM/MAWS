import { beforeEach, expect, it, vi } from 'vitest';
import { newDoc, stateV2, transact } from '@artifacts/yjs';
import { writeBoardEntry, writeCanvasKeys } from '@artifacts/design/model';
import { importSlide } from '@artifacts/slides/model';
import { loadSlide } from '@artifacts/slides/parse';
import { installFakeMain, ok } from '../../test-support/code';
import { useNotices } from '../../stores/notices';
import { designVersionExports } from './exports';

const A = '00000000-0000-4000-8000-0000000000d5';
beforeEach(() => useNotices.setState({ notices: [] }));

function versionState() {
  const doc = newDoc();
  transact(doc, () => {
    writeCanvasKeys(doc, { v: 1, title: 'Screens', boards: {}, order: [] });
    for (const id of ['old-board', 'shared']) {
      const parsed = loadSlide(`<section id="${id}"><p id="p">Draft</p></section>`, { fileId: id });
      if (!parsed.ok) throw new Error('fixture');
      importSlide(doc, parsed.slide, id);
      writeBoardEntry(doc, id, { x: 0, y: 0, w: 200, h: 200 });
    }
  });
  const bytes = stateV2(doc);
  doc.destroy();
  return bytes;
}

it('exports a card’s retained design and its own board, never another preview’s or a missing live board', async () => {
  const source = { versionState: vi.fn(async () => versionState()) };
  const main = installFakeMain((name) => name === 'artifacts.export' ? ok({ path: '/store/x', revision: 12 }) : ok({ saved: false }));
  const entries = designVersionExports(A, 7, { shown: 'compare', board: 'live-only', label: 'Live board' }, source);
  await entries[0]!.onSelect();
  expect(main.calls).toEqual([
    { name: 'artifacts.export', input: { artifactId: A, format: 'png', board: 'old-board', versionId: 7 } },
    { name: 'library.saveAs', input: { artifactId: A, source: { export: { revision: 12, format: 'png' } } } },
  ]);
  expect(source.versionState).toHaveBeenCalledWith(7);

  const shared = designVersionExports(A, 9, { shown: null, board: 'shared', label: 'Renamed live board' }, source);
  await shared[1]!.onSelect();
  expect(main.calls[2]).toEqual({ name: 'artifacts.export', input: { artifactId: A, format: 'pdf', boards: ['shared'], versionId: 9 } });
  await entries[2]!.onSelect();
  expect(main.calls[4]).toEqual({ name: 'artifacts.export', input: { artifactId: A, format: 'pdf', versionId: 7 } });
});

it('reports a failed retained-state read rather than exporting the live design', async () => {
  const main = installFakeMain(() => ok(undefined));
  const entries = designVersionExports(A, 7, { shown: null, board: 'phone', label: 'Phone' }, { versionState: async () => { throw new Error('Version unavailable'); } });
  await entries[0]!.onSelect();
  expect(main.calls).toEqual([]);
  expect(useNotices.getState().notices.map((n) => n.text).join(' ')).toContain('Version unavailable');
});
