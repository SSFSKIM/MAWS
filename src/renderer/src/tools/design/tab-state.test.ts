// P3-E1 M3 (X32's lifetime rule): a design tab's state is C's deck tab state with the workbench's view beside it. The
// header's Zoom to fit acts with no body mounted (it waits for the body's room, then fits every board), the view is the
// tab's (a body remounting finds it where it was), and the deck tab's lifetime (the session, the close) is unchanged.
import { Awareness } from '@y/protocols/awareness';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { newDoc, transact } from '@artifacts/yjs';
import { writeBoardEntry, writeCanvasKeys } from '@artifacts/design/model';
import { importSlide } from '@artifacts/slides/model';
import { loadSlide } from '@artifacts/slides/parse';
import { openDeckTabs } from '../presentation/tab-state';
import { DesignTabState, openDesignTabs } from './tab-state';

function designDoc() {
  const doc = newDoc();
  transact(doc, () => {
    writeCanvasKeys(doc, { v: 1, title: 'Screens', boards: {}, order: [] });
    [
      { id: 'phone', frame: { x: 0, y: 0, w: 390, h: 844 } },
      { id: 'poster', frame: { x: 500, y: 0, w: 1080, h: 9000 } },
    ].forEach((b, i) => {
      const l = loadSlide(`<section id="${b.id}"><p id="p">Hi</p></section>`, { fileId: b.id });
      if (!l.ok) throw new Error('fixture');
      importSlide(doc, l.slide, `a${i}`);
      writeBoardEntry(doc, b.id, b.frame);
    });
  });
  return doc;
}

function handleOf(doc = designDoc()): DocumentHandle & { closed: boolean } {
  const state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, readOnly: false };
  const handle = {
    doc,
    awareness: new Awareness(doc),
    closed: false,
    state: () => state,
    subscribe: () => () => {},
    onRestored: () => () => {},
    holdRemote() {},
    close() {
      handle.closed = true;
    },
  };
  return handle as unknown as DocumentHandle & { closed: boolean };
}

async function opened() {
  const handle = handleOf();
  const host = { open: vi.fn(async () => handle), assetUrl: () => '', identity: () => ({ actor: { kind: 'human' }, name: 'You', color: '--author-2' }) } as unknown as ArtifactHost;
  const state = new DesignTabState({ artifactId: 'design-1', kind: 'design', surface: 'main' }, { host, log: () => {}, confirmDiscard: async () => true });
  await vi.waitFor(() => expect(state.snapshot().session).not.toBeNull());
  return { handle, state };
}

describe('a design tab’s state', () => {
  it('fits every board when the header asks, waiting for the body’s room when none is measured', async () => {
    const { state } = await opened();
    state.fitAll();
    expect(state.view.snapshot().viewport).toBeNull(); // no body has measured a room yet
    state.view.setRoom({ w: 1000, h: 800 });
    const v = state.view.snapshot().viewport!;
    expect(v.zoom).toBeCloseTo((800 - 96) / 9000, 6); // the union of the phone and the poster, by its height
    state.dispose();
  });

  it('keeps its view across bodies, is listed as a design tab, and closes its replica as the deck tab does', async () => {
    const { state, handle } = await opened();
    state.view.setRoom({ w: 900, h: 700 });
    state.view.setViewport({ zoom: 0.5, x: 10, y: 20 });
    state.view.selectFrame('poster');
    expect(state.view.snapshot()).toMatchObject({ viewport: { zoom: 0.5, x: 10, y: 20 }, frame: 'poster' });
    expect(openDesignTabs()).toContain(state);
    expect(openDeckTabs()).toContain(state);
    state.dispose();
    expect(openDesignTabs()).not.toContain(state);
    expect(handle.closed).toBe(true);
  });
});
