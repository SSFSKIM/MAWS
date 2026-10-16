// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the parent's Decision Log 23): a design tab's
// history reads a retained version through the design model: an earlier build's generic-file version as its migration
// would build it, on a temporary copy, encoded before the copy goes; a model version's own bytes; neither written.
import { describe, expect, it } from 'vitest';
import type { HistoryApi } from '@artifacts/document/editor/history/api';
import { publishFiles } from '@artifacts/files';
import { CANVAS_PATH } from '@artifacts/design/canvas';
import { isLegacyDesign } from '@artifacts/design/migrate';
import { designFiles } from '@artifacts/design/model';
import { writeBoards } from '@artifacts/design/fixtures/support';
import { applyV2, newDoc, stateV2, transact } from '@artifacts/yjs';
import { designHistoryApi } from './history-api';

describe('the design’s history api', () => {
  it('answers a legacy version’s bytes as its migration would build them, a model version’s as they are, and never changes either', async () => {
    const legacy = newDoc();
    const files = { [CANVAS_PATH]: JSON.stringify({ v: 1, title: 'Old', boards: { p: { x: 0, y: 0, w: 390, h: 844 } }, order: ['p'] }), 'project/boards/p.html': '<section id="p"><p id="hi">Hello</p></section>' };
    transact(legacy, () => publishFiles(legacy, {}, files, false));
    const old = stateV2(legacy);
    const model = newDoc();
    transact(model, () => writeBoards(model, [{ id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 } }]));
    const current = stateV2(model);
    const states = new Map([
      [1, old],
      [2, current],
    ]);
    const versions = async () => [];
    const api = designHistoryApi({ versions, versionState: async (id: number) => states.get(id)! } as unknown as HistoryApi);
    expect(api.versions).toBe(versions); // every other method B's, as it was

    const projected = newDoc();
    applyV2(projected, await api.versionState(1));
    expect(isLegacyDesign(projected)).toBe(false);
    expect(designFiles(projected)['project/boards/p.html']).toContain('Hello');
    expect(await api.versionState(2)).toBe(current); // the model's own bytes: the diff keeps its items and provenance
    const reread = newDoc();
    applyV2(reread, old);
    expect(isLegacyDesign(reread)).toBe(true); // the retained state untouched
  });
});
