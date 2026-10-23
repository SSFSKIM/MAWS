// P3-C M4 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Shell"; X32's lifetime rule): a deck
// tab's state lives with the tab, not its body. Its close guard answers with no body mounted, its disposal waits for the
// host's acknowledgement of every edit before closing the replica, and a restore it did not witness clears its undo.
import { Awareness } from '@y/protocols/awareness';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import type { Restored } from '@artifacts/provider/port';
import { newDoc, transact } from '@artifacts/yjs';
import { importSlide, setStyle, writeDeckKeys } from '@artifacts/slides/model';
import { deleteSlide } from '@artifacts/yjs/slides'; // P3-F (L203)
import { loadSlide } from '@artifacts/slides/parse';
import { addThread, resolve } from '@artifacts/slides/threads'; // M7
import { adoptStagedArtifactEditorState, artifactEditorFor, heldArtifactEditorState, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors, stageArtifactEditorState } from '../../artifacts/registry'; // P4-B3 M5
import { registerPresentationEditor } from './index'; // P4-B3 M5
import { DeckTabState } from './tab-state';

class FakeHandle implements DocumentHandle {
  readonly doc = newDoc();
  readonly awareness = new Awareness(this.doc);
  closed = false;
  private current: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false };
  private readonly listeners = new Set<(state: DocumentState) => void>();
  private readonly restoredListeners = new Set<(restored: Restored) => void>();
  constructor() {
    const l = loadSlide('<section id="a"><p id="p" style="font-size:32px">Hi</p></section>');
    if (!l.ok) throw new Error('fixture');
    transact(this.doc, () => {
      writeDeckKeys(this.doc, { v: 4, title: 'T', order: ['a'] });
      importSlide(this.doc, l.slide, 'a0');
    });
  }
  state = () => this.current;
  subscribe = (listener: (state: DocumentState) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  onProvisional = () => () => {}; // P4-A2
  onRestored = (listener: (restored: Restored) => void) => {
    this.restoredListeners.add(listener);
    return () => this.restoredListeners.delete(listener);
  };
  holdRemote(): void {}
  close(): void {
    this.closed = true;
  }
  /** The host's word on the replica changes. */
  set(patch: Partial<DocumentState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of [...this.listeners]) listener(this.current);
  }
  restore(): void {
    for (const listener of [...this.restoredListeners]) listener({ revision: 9, versionId: 2 });
  }
}

async function opened(confirmDiscard = vi.fn(async () => false), saveWaitMs = 30) {
  const handle = new FakeHandle();
  const host = { open: vi.fn(async () => handle), assetUrl: () => '', identity: () => ({ actor: { kind: 'human' }, name: 'You', color: '--author-2' }) } as unknown as ArtifactHost;
  const state = new DeckTabState({ artifactId: 'deck-1', kind: 'presentation', surface: 'main' }, { host, log: () => {}, confirmDiscard, saveWaitMs, savingShownMs: 10 });
  await vi.waitFor(() => expect(state.snapshot().session).not.toBeNull());
  return { handle, state, confirmDiscard };
}

describe('a deck tab’s state (X32’s lifetime rule)', () => {
  it('publishes its slide and selection in the replica’s awareness, beside who this is (fix wave 1)', async () => {
    const { handle, state } = await opened();
    state.snapshot().session!.select(['p']);
    expect(handle.awareness.getLocalState()).toMatchObject({ name: 'You', color: '--author-2', deck: { slideId: 'a', elementIds: ['p'] } });
    state.dispose();
    expect(handle.awareness.getLocalState()).toMatchObject({ deck: null });
  });

  it('its close guard answers with no body mounted: at once when saved, after the host’s ack when it comes in time', async () => {
    const { handle, state, confirmDiscard } = await opened();
    await expect(state.closeGuard()).resolves.toBe(true);
    handle.set({ unsaved: 2 });
    const asked = state.closeGuard();
    handle.set({ unsaved: 0 });
    await expect(asked).resolves.toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it('its close guard asks the owner when the ack does not come, and keeps the tab when they decline', async () => {
    const { handle, state, confirmDiscard } = await opened();
    state.setTitle('Q3 review');
    handle.set({ unsaved: 1 });
    await expect(state.closeGuard()).resolves.toBe(false);
    expect(confirmDiscard).toHaveBeenCalledWith('Q3 review');
  });

  it('disposed with edits in flight, it closes the replica only once the host acknowledges them', async () => {
    const { handle, state } = await opened();
    handle.set({ unsaved: 3 });
    state.dispose();
    expect(handle.closed).toBe(false);
    handle.set({ unsaved: 1 });
    expect(handle.closed).toBe(false);
    handle.set({ unsaved: 0 });
    expect(handle.closed).toBe(true);
  });

  it('(P4-B2 D17) disposed while a drag holds the replica, it closes the replica even when the hold’s flush throws', async () => {
    const { handle, state } = await opened();
    (handle as DocumentHandle).holdRemote = (on) => {
      if (!on) throw new Error('a listener of the flush');
    };
    state.snapshot().session!.beginDrag();
    expect(() => state.dispose()).toThrow('a listener of the flush');
    expect(handle.closed).toBe(true);
  });

  it('a restore it did not witness clears its undo stack', async () => {
    const { handle, state } = await opened();
    const session = state.snapshot().session!;
    session.edit((origin) => setStyle(handle.doc, 'a', 'p', { 'font-size': '40px' }, origin));
    expect(session.snapshot().canUndo).toBe(true);
    handle.restore();
    expect(session.snapshot().canUndo).toBe(false);
    expect(session.undo.canUndo()).toBe(false);
  });

  // final fix wave (B4): an awaited edit (an upload, an asset copy) has nothing unsaved yet, but its write is to come
  it('its close guard waits for an awaited edit still to write, and asks when it does not finish in time', async () => {
    const { state, confirmDiscard } = await opened();
    const session = state.snapshot().session!;
    let finish!: () => void;
    const written = session.later(new Promise<void>((resolve) => (finish = resolve)), () => {});
    const asked = state.closeGuard();
    let answered = false;
    void asked.then(() => (answered = true));
    await Promise.resolve();
    expect(answered).toBe(false);
    finish();
    await written;
    await expect(asked).resolves.toBe(true);
    expect(confirmDiscard).not.toHaveBeenCalled();

    void session.later(new Promise<void>(() => {}), () => {}); // never finishes
    await expect(state.closeGuard()).resolves.toBe(false);
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
  });

  // P3-F (L203): speaker notes the session keeps unwritten go with the tab; nothing writes them but the owner
  it('its close guard asks about notes the session keeps unwritten, at once when nothing is in flight, read-only too, not for a slide gone', async () => {
    const { handle, state, confirmDiscard } = await opened();
    const session = state.snapshot().session!;
    session.keepNotesDraft('a', { text: 'x'.repeat(4_001), from: '' });
    const asked = state.closeGuard();
    expect(confirmDiscard).toHaveBeenCalledTimes(1); // at once: waiting cannot write them
    await expect(asked).resolves.toBe(false);
    handle.set({ readOnly: true }); // a read-only replica cannot write them either: still asked, the text kept
    await expect(state.closeGuard()).resolves.toBe(false);
    expect(confirmDiscard).toHaveBeenCalledTimes(2);
    expect(session.unwrittenNotes('a')).toBe('x'.repeat(4_001));
    handle.set({ readOnly: false, unsaved: 1 }); // an edit in flight is waited for as before, then the notes asked about
    const later = state.closeGuard();
    await Promise.resolve();
    expect(confirmDiscard).toHaveBeenCalledTimes(2);
    handle.set({ unsaved: 0 });
    await expect(later).resolves.toBe(false);
    expect(confirmDiscard).toHaveBeenCalledTimes(3);
    session.keepNotesDraft('a', null); // written, or short enough again
    await expect(state.closeGuard()).resolves.toBe(true);
    session.keepNotesDraft('a', { text: 'x'.repeat(4_001), from: '' });
    deleteSlide(handle.doc, 'a');
    await expect(state.closeGuard()).resolves.toBe(true);
    expect(confirmDiscard).toHaveBeenCalledTimes(3);
  });

  it('an awaited edit finishing once the replica turned read-only writes nothing', async () => {
    const { handle, state } = await opened();
    const write = vi.fn();
    let finish!: () => void;
    const written = state.snapshot().session!.later(new Promise<void>((resolve) => (finish = resolve)), write);
    handle.set({ readOnly: true });
    finish();
    await expect(written).resolves.toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  // M7 (D9): the header's count and the comment card's hold on the replica
  it('counts only live-target open threads and follows target deletion and undo with no mounted body (WR 49)', async () => {
    const { handle, state } = await opened();
    expect(state.snapshot().unresolved).toBe(0);
    addThread(handle.doc, { threadId: 't1', slideId: 'a', elementId: 'p', quote: 'Hi', by: { kind: 'human' }, at: 1 });
    addThread(handle.doc, { threadId: 't2', slideId: 'a', elementId: 'gone', quote: 'Gone', by: { kind: 'human' }, at: 2 });
    expect(state.snapshot().unresolved).toBe(1);
    const session = state.snapshot().session!;
    session.edit(() => deleteSlide(handle.doc, 'a'));
    await vi.waitFor(() => expect(state.snapshot().unresolved).toBe(0));
    session.undo.undo();
    await vi.waitFor(() => expect(state.snapshot().unresolved).toBe(1));
    resolve(handle.doc, 't1', { kind: 'human' }, 3);
    expect(state.snapshot().unresolved).toBe(0);
    state.dispose();
  });

  it('disposed while something holds the replica, it closes it only once the last hold is released', async () => {
    const { handle, state } = await opened();
    const card = state.hold();
    const send = state.hold();
    state.dispose();
    expect(handle.closed).toBe(false);
    card();
    card(); // a release counts once
    expect(handle.closed).toBe(false);
    send();
    expect(handle.closed).toBe(true);
  });
});

// P4-B3 M5 (X38's carry table): a deck moved between the panel and a main tab carries its tab state through the hold
// (the registry's hand-off, M4): the slide shown, the selection, the zoom and the deck session's one undo stack, with the
// state's surface following it.
describe('a deck moved between the panel and a main tab', () => {
  it('comes across on the same slide, with its selection, zoom and undo, its surface the target’s', async () => {
    const handle = new FakeHandle();
    const host = { open: vi.fn(async () => handle), assetUrl: () => '', identity: () => ({ actor: { kind: 'human' }, name: 'You', color: '--author-2' }) } as unknown as ArtifactHost;
    const off = registerPresentationEditor(() => ({ host, log: () => {}, confirmDiscard: async () => false, savingShownMs: 10 }));
    const panel = { surface: 'panel', tabId: 'p1' } as const;
    const main = { surface: 'main', tabId: 'artifact:deck-1' } as const;
    const { state } = holdArtifactEditorState<DeckTabState>(panel, 'deck-1', 'presentation', artifactEditorFor('presentation') as never);
    await vi.waitFor(() => expect(state.snapshot().session).not.toBeNull());
    const session = state.snapshot().session!;
    session.select(['p']);
    session.setZoom(1.5);
    session.edit((origin) => setStyle(handle.doc, 'a', 'p', { 'font-size': '40px' }, origin));
    expect(state.surface).toBe('panel');

    stageArtifactEditorState(panel);
    releaseArtifactEditorState(panel); // the source lets go
    adoptStagedArtifactEditorState('deck-1', main);
    expect(heldArtifactEditorState(main)?.state).toBe(state);
    expect(state.surface).toBe('main');
    expect(state.snapshot().session).toBe(session);
    expect(session.snapshot()).toMatchObject({ currentSlide: 'a', selection: ['p'], zoom: 1.5, canUndo: true });
    session.undoStep();
    expect(JSON.stringify(handle.doc.toJSON())).not.toContain('40px');
    expect(handle.closed).toBe(false);

    releaseArtifactEditorState(main);
    off();
    resetArtifactEditors();
  });
});
