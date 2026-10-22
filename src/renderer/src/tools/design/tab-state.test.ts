// P3-E1 M3 (X32's lifetime rule): a design tab's state is C's deck tab state with the workbench's view beside it. The
// header's Zoom to fit acts with no body mounted (it waits for the body's room, then fits every board), the view is the
// tab's (a body remounting finds it where it was), and the deck tab's lifetime (the session, the close) is unchanged.
import { Awareness } from '@y/protocols/awareness';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import type { ArtifactProvisional } from '@shared/artifacts/provisional';
import { newDoc, transact } from '@artifacts/yjs';
import { writeBoardEntry, writeCanvasKeys } from '@artifacts/design/model';
import { importSlide } from '@artifacts/slides/model';
import { loadSlide } from '@artifacts/slides/parse';
import { openDeckTabs } from '../presentation/tab-state';
import { adoptStagedArtifactEditorState, artifactEditorFor, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors, stageArtifactEditorState } from '../../artifacts/registry'; // P4-B3 M5
import { registerDesignEditor } from './index'; // P4-B3 M5
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

function handleOf(doc = designDoc()): DocumentHandle & { closed: boolean; frames: Set<(frame: ArtifactProvisional) => void> } {
  const state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false };
  const frames = new Set<(frame: ArtifactProvisional) => void>();
  const handle = {
    doc,
    awareness: new Awareness(doc),
    closed: false,
    frames,
    state: () => state,
    subscribe: () => () => {},
    onRestored: () => () => {},
    onProvisional: (listener: (frame: ArtifactProvisional) => void) => {
      frames.add(listener);
      return () => frames.delete(listener);
    },
    holdRemote() {},
    close() {
      handle.closed = true;
    },
  };
  return handle as unknown as DocumentHandle & { closed: boolean; frames: Set<(frame: ArtifactProvisional) => void> };
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

  it('P4-A2 G2.4: holds the replica’s provisional layers while it holds the replica, for every body over it', async () => {
    const { state, handle } = await opened();
    const layers = state.snapshot().provisional!;
    expect(handle.frames.size, 'listening from the open').toBe(1);
    const frame = { toolUseId: 'call1', appSessionId: 's1', artifactId: 'design-1', kind: 'design', state: 'streaming', at: 0, name: 'Agent', color: '--author-3', ops: [{ op: 'file', path: 'project/boards/phone.html', text: '<section id="phone">' }] } as unknown as ArtifactProvisional;
    handle.frames.forEach((listener) => listener(frame));
    expect([...layers.get().keys()]).toEqual(['call1']);
    state.dispose();
    expect(handle.frames.size, 'stopped with the tab').toBe(0);
    expect(layers.get().size).toBe(0);
  });

  it('M5 (Decision Log 31): answers what its Export exports now: live, the selected frame else the active board, named as now; a previewed version, its own board and name', async () => {
    const { state } = await opened();
    expect(state.exportContext()).toEqual({ board: 'phone', label: 'phone', shown: null }); // the active board, untitled: its id
    state.view.selectFrame('poster');
    expect(state.exportContext()).toEqual({ board: 'poster', label: 'poster', shown: null });
    // a version previewed that lacks the live selection: the version's own board and name, never the live board's
    const shown = { versionId: 3, board: 'old', label: 'Old poster' };
    state.view.showVersion(shown);
    expect(state.exportContext()).toEqual({ board: 'old', label: 'Old poster', shown });
    state.view.showVersion('compare');
    expect(state.exportContext().shown).toBe('compare');
    state.view.showVersion(null);
    expect(state.exportContext()).toEqual({ board: 'poster', label: 'poster', shown: null }); // the live selection kept
    state.dispose();
  });

  it('(design-workbench scalpel-2#2) leaves the hidden live view where it was when Zoom to fit lands while the history shows a version or a comparison', async () => {
    const { state } = await opened();
    state.view.setRoom({ w: 1000, h: 800 });
    state.view.setViewport({ zoom: 0.5, x: 10, y: 20 });
    for (const shown of [{ versionId: 3, board: 'phone', label: 'phone' }, 'compare'] as const) {
      state.view.showVersion(shown);
      state.fitAll();
      expect(state.view.snapshot().viewport).toEqual({ zoom: 0.5, x: 10, y: 20 });
    }
    state.view.showVersion(null);
    state.fitAll();
    expect(state.view.snapshot().viewport!.zoom).toBeCloseTo((800 - 96) / 9000, 6); // the live design again: every board
    state.dispose();
  });
});

// P4-B3 M5 (X38's carry table): a design moved between the panel and a main tab carries the workbench's view through the
// hold (the registry's hand-off, M4): the viewport and the selected board, with the state's surface following it.
describe('a design moved between a main tab and the panel', () => {
  it('comes across with its viewport and selected board, its surface the target’s', async () => {
    const handle = handleOf();
    const host = { open: vi.fn(async () => handle), assetUrl: () => '', identity: () => ({ actor: { kind: 'human' }, name: 'You', color: '--author-2' }) } as unknown as ArtifactHost;
    const off = registerDesignEditor(() => ({ host, log: () => {}, confirmDiscard: async () => true }));
    const main = { surface: 'main', tabId: 'artifact:design-1' } as const;
    const panel = { surface: 'panel', tabId: 'p1' } as const;
    const { state } = holdArtifactEditorState<DesignTabState>(main, 'design-1', 'design', artifactEditorFor('design') as never);
    await vi.waitFor(() => expect(state.snapshot().session).not.toBeNull());
    state.view.setRoom({ w: 900, h: 700 });
    state.view.setViewport({ zoom: 0.5, x: 10, y: 20 });
    state.view.selectFrame('poster');

    stageArtifactEditorState(main);
    releaseArtifactEditorState(main);
    adoptStagedArtifactEditorState('design-1', panel);
    expect(state.surface).toBe('panel');
    expect(state.view.snapshot()).toMatchObject({ viewport: { zoom: 0.5, x: 10, y: 20 }, frame: 'poster' });
    expect(openDesignTabs()).toContain(state);
    expect(handle.closed).toBe(false);

    releaseArtifactEditorState(panel);
    off();
    resetArtifactEditors();
  });
});
