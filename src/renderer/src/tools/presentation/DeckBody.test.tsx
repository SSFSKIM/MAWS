// P3-F slide-editor (scalpel-2#1, scalpel-2#2): the deck's body over its tab's replica, under happy-dom. The header's
// Present is offered only while the deck has a slide to show, following the deck live, and a deck with no slide at all
// records the owner's view as a drawn first slide does.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Awareness } from '@y/protocols/awareness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { importSlide, writeDeckKeys } from '@artifacts/slides/model';
import { loadSlide } from '@artifacts/slides/parse';
import { newDoc, transact, type Doc } from '@artifacts/yjs';
import * as Y from '@artifacts/yjs/slides';
import { fakeClient } from '../../../../../test/support/fake-client';
import { resetLibrary } from '../../library/store';
import { resetMarkupSurfaces } from '../../markup/surface';
import { EditorHostScopeContext, editorHostOf, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { requestArtifactOpen, resetOpenRequests, takeOpenRequest } from '../artifacts/viewers/requests';
import { DeckPanel } from './DeckBody';
import { DeckTabState } from './tab-state';

const DECK = '77777777-7777-4777-8777-777777777777';
const scope: EditorHostScope = { surface: 'panel', tabId: 'panel-tab-1' };

function deckOf(ids: readonly string[]): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: [...ids] });
    ids.forEach((id, i) => {
      const loaded = loadSlide(`<section id="${id}"><p id="p${i}" style="font-size:32px">Slide ${id}</p></section>`, { fileId: id });
      if (!loaded.ok) throw new Error(`fixture ${id}`);
      importSlide(doc, loaded.slide, `a${i}`);
    });
  });
  return doc;
}

const states: DeckTabState[] = [];
beforeEach(() => {
  resetLibrary();
  resetEditorHosts();
  resetMarkupSurfaces();
  window.maws = fakeClient().client; // the library's row and lists stay unanswered: the body's title is its default
});
afterEach(() => {
  cleanup();
  for (const state of states.splice(0)) state.dispose();
  delete (window as { maws?: unknown }).maws;
});

async function mount(doc: Doc) {
  const document: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false };
  const handle = { doc, awareness: new Awareness(doc), state: () => document, subscribe: () => () => {}, onRestored: () => () => {}, onProvisional: () => () => {}, holdRemote() {}, close() {} } as unknown as DocumentHandle;
  const host = { open: vi.fn(async () => handle), assetUrl: () => '', identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' }) } as unknown as ArtifactHost;
  const state = new DeckTabState({ artifactId: DECK, kind: 'presentation', surface: 'panel' }, { host, log: () => {}, confirmDiscard: async () => true });
  states.push(state);
  const onShown = vi.fn();
  render(
    <EditorHostScopeContext.Provider value={scope}>
      <DeckPanel artifactId={DECK} state={state} scope={scope} visible onShown={onShown} />
    </EditorHostScopeContext.Provider>,
  );
  await waitFor(() => expect(state.snapshot().session).not.toBeNull());
  const present = () => editorHostOf(scope)?.actions?.find((a) => a.id === 'present');
  await waitFor(() => expect(present()).toBeDefined());
  return { state, onShown, present };
}

describe('the deck body', () => {
  it('registers the deck’s own toolbar as its host without dropping the tab’s close guard or actions', async () => {
    const { state } = await mount(deckOf(['a']));
    const host = editorHostOf(scope)!;
    expect(host.toolbarHost?.menuLabel).toBe('Deck actions');
    expect(host.toolbarHost?.element.closest('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Deck');
    expect(host.closeGuard).toBe(state.closeGuard);
    expect(host.actions?.map((action) => action.id)).toEqual(['present', 'theme', 'check']);
  });

  // scalpel-2#1: header.ts's contract, "the deck has a slide to show"
  it('offers Present while the deck has a slide to show: not with every slide hidden, nor with no slide', async () => {
    const doc = deckOf(['a']);
    const { present } = await mount(doc);
    expect(present()?.disabled).toBe(false);
    act(() => Y.setSlideKey(doc, 'a', 'attr:hidden', ''));
    expect(present()?.disabled).toBe(true);
    act(() => Y.deleteSlideKey(doc, 'a', 'attr:hidden'));
    expect(present()?.disabled).toBe(false);
    cleanup();
    resetEditorHosts();
    expect((await mount(deckOf([]))).present()?.disabled).toBe(true);
  });

  // P4-B4: an open's place (a link's `#slide=`) is the open request for this deck on this surface: the slide is selected
  // in a body already showing the deck, and the request taken once
  it('selects the slide a link names, taking the open request', async () => {
    resetOpenRequests();
    const { state } = await mount(deckOf(['a', 'b', 'c']));
    const session = state.snapshot().session!;
    expect(session.snapshot().currentSlide).toBe('a');
    const serial = requestArtifactOpen(DECK, 'latest', 'main', { slide: 'c' }); // another surface's: this body leaves it
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(session.snapshot().currentSlide).toBe('a');
    expect(takeOpenRequest(serial)).toBe(true);
    let asked = 0;
    act(() => void (asked = requestArtifactOpen(DECK, 'latest', 'panel', { slide: 'c' })));
    await waitFor(() => expect(session.snapshot().currentSlide).toBe('c'));
    expect(takeOpenRequest(asked)).toBe(false);
  });

  // scalpel-2#2: the empty deck's stage draws no slide canvas, so it never reported drawn and whenShown never resolved
  it('records the owner’s view of a deck with no slide once its stage shows', async () => {
    const { state, onShown } = await mount(deckOf([]));
    await waitFor(() => expect(onShown).toHaveBeenCalledTimes(1));
    expect(state.markShown()).toBe(false); // the showing is already marked: the history rail's wait is over
  });
});
