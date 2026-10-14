// P3-C M4 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Shell"; X32's lifetime rule): a deck
// tab's state lives with the tab, not its body. Its close guard answers with no body mounted, its disposal waits for the
// host's acknowledgement of every edit before closing the replica, and a restore it did not witness clears its undo.
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import type { Restored } from '@artifacts/provider/port';
import { newDoc, transact } from '@artifacts/yjs';
import { importSlide, setStyle, writeDeckKeys } from '@artifacts/slides/model';
import { loadSlide } from '@artifacts/slides/parse';
import { DeckTabState } from './tab-state';

class FakeHandle implements DocumentHandle {
  readonly doc = newDoc();
  readonly awareness = {} as DocumentHandle['awareness'];
  closed = false;
  private current: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, readOnly: false };
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
  const host = { open: vi.fn(async () => handle), assetUrl: () => '' } as unknown as ArtifactHost;
  const state = new DeckTabState({ artifactId: 'deck-1', kind: 'presentation', surface: 'main' }, { host, log: () => {}, confirmDiscard, saveWaitMs, savingShownMs: 10 });
  await vi.waitFor(() => expect(state.snapshot().session).not.toBeNull());
  return { handle, state, confirmDiscard };
}

describe('a deck tab’s state (X32’s lifetime rule)', () => {
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

  it('a restore it did not witness clears its undo stack', async () => {
    const { handle, state } = await opened();
    const session = state.snapshot().session!;
    session.edit((origin) => setStyle(handle.doc, 'a', 'p', { 'font-size': '40px' }, origin));
    expect(session.snapshot().canUndo).toBe(true);
    handle.restore();
    expect(session.snapshot().canUndo).toBe(false);
    expect(session.undo.canUndo()).toBe(false);
  });
});
