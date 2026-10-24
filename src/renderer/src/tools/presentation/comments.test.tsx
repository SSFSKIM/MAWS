// P3-C M7 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; Decision Log 33, 35): a deck's
// comment opens P2's card through B's surface on an `artifact-comment` anchor that names the presentation kind, so the
// agent's lead names the element and the presentation (Decision Log 36); a document's anchor stays as B writes it.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Awareness } from '@y/protocols/awareness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { importSlide, writeDeckKeys } from '@artifacts/slides/model';
import { loadSlide } from '@artifacts/slides/parse';
import { listThreads } from '@artifacts/slides/threads';
import { newDoc, transact, type Doc } from '@artifacts/yjs';
import { anchoredMessage } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { artifactEditorFor, handArtifactViewOver, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors } from '../../artifacts/registry';
import { resetLibrary } from '../../library/store';
import { resetMarkupSurfaces } from '../../markup/surface';
import { EditorHostScopeContext, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { useCommentCard } from '../../side/card/store';
import { openComment } from '../../side/register';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerCommentComposer } from '../code/anchor/anchor';
import { commentDraftOf } from '../document/comment-drafts';
import { artifactCommentAnchor, useDocumentComments } from '../document/comments';
import { registerPresentationEditor } from './index';
import type { DeckTabState } from './tab-state';

const PARENT = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const passage = { threadId: 't1', tabId: 's3', tabTitle: 'slide 3: Plan', quote: 'One path' };

let offComposer: () => void;
beforeEach(() => {
  resetShellStores();
  offComposer = registerCommentComposer(openComment);
  const s = useSessions.getState();
  useSessions.setState({ records: new Map([[PARENT, record(PARENT)]]), engine: new Map([[PARENT, status(PARENT, { process: 'ready' } as never)]]), recordsVersion: s.recordsVersion + 1 });
});
afterEach(() => {
  cleanup();
  offComposer();
  useCommentCard.setState({ open: null });
});

describe('a deck comment’s anchor', () => {
  it('names the presentation kind, and the lead names the element and the presentation', () => {
    const anchor = artifactCommentAnchor({ artifactId: 'deck-1', title: 'Q3 review', ...passage, artifactKind: 'presentation' });
    expect(anchor).toEqual({ kind: 'artifact-comment', label: 'Q3 review, slide 3: Plan', locator: 'One path', artifactId: 'deck-1', threadId: 't1', artifactKind: 'presentation' });
    expect(anchoredMessage({ anchor, text: 'Shorter?', destination: 'main', screenshot: false }).split('\n')[0]).toBe('Comment on "Q3 review, slide 3: Plan" (element "One path" in presentation deck-1, thread t1):');
    expect(artifactCommentAnchor({ artifactId: 'doc-1', title: 'Plan', ...passage })).not.toHaveProperty('artifactKind'); // a document's, as B writes it
  });

  it('is what the surface opens the card on when the deck gives its kind', async () => {
    let opened: ((p: typeof passage) => void) | null = null;
    function Deck() {
      const comments = useDocumentComments({ artifactId: 'deck-1', appSessionId: PARENT, title: 'Q3 review', artifactKind: 'presentation' });
      opened = comments.opened;
      return null;
    }
    render(<Deck />);
    act(() => opened!(passage));
    await act(async () => {});
    expect(useCommentCard.getState().open?.anchor).toMatchObject({ kind: 'artifact-comment', artifactKind: 'presentation', threadId: 't1' });
  });
});

// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; X36's draft rule, as B1's document): the deck's
// body, mounted as a main tab mounts it beside a chat, opts into the draft rule: Escape on a typed comment keeps the card
// and its text, the toolbar's Comment refocuses that draft instead of writing a second thread, a blur with nothing typed
// discards the card, and the tab's close guard asks before the draft is lost (not on a move, which keeps the card).
describe('a deck’s compose card keeps its draft', () => {
  const DECK = '77777777-7777-4777-8777-777777777777';
  const scope: EditorHostScope = { surface: 'main', tabId: 'main-tab-1' };
  let off = () => {};
  beforeEach(() => {
    resetLibrary();
    resetEditorHosts();
    resetMarkupSurfaces();
    resetArtifactEditors();
  });
  afterEach(() => {
    cleanup();
    releaseArtifactEditorState(scope);
    off();
    delete (window as { maws?: unknown }).maws;
  });

  function deck(): Doc {
    const doc = newDoc();
    transact(doc, () => {
      writeDeckKeys(doc, { v: 4, title: 'Q3 review', order: ['s1'] });
      const loaded = loadSlide('<section id="s1"><p id="body" style="font-size:32px">One path</p></section>', { fileId: 's1' });
      if (!loaded.ok) throw new Error('fixture');
      importSlide(doc, loaded.slide, 'a0');
    });
    return doc;
  }
  async function mount() {
    window.maws = fakeClient({ 'session.intent.get': null, 'library.get': { row: null } }).client;
    const doc = deck();
    const document: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false };
    const handle = { doc, awareness: new Awareness(doc), state: () => document, subscribe: () => () => {}, onRestored: () => () => {}, onProvisional: () => () => {}, holdRemote() {}, close() {} } as unknown as DocumentHandle;
    const host = { open: vi.fn(async () => handle), assetUrl: () => '', identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' }) } as unknown as ArtifactHost;
    const confirmDiscard = vi.fn<(title: string, about?: 'comment') => Promise<boolean>>(async () => false);
    act(() => useLayout.getState().openSession(PARENT)); // a chat shown: the comment goes to it
    off = registerPresentationEditor(() => ({ host, log: () => {}, confirmDiscard }));
    const editor = artifactEditorFor('presentation')!;
    const hold = holdArtifactEditorState<DeckTabState>(scope, DECK, 'presentation', editor as never);
    const Main = editor.Main;
    const view = render(
      <EditorHostScopeContext.Provider value={scope}>
        <Main artifactId={DECK} state={hold.state} scope={scope} visible onShown={() => {}} />
      </EditorHostScopeContext.Provider>,
    );
    await waitFor(() => expect(hold.state.snapshot().session).not.toBeNull());
    const session = hold.state.snapshot().session!;
    const comment = async () => {
      act(() => session.select(['body']));
      const button = await waitFor(() => within(screen.getByRole('toolbar', { name: 'Deck' })).getByRole('button', { name: 'Add comment' }));
      act(() => button.click());
      await act(async () => {});
    };
    return { doc, state: hold.state, confirmDiscard, comment, unmount: view.unmount };
  }
  const field = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;

  it('Escape on a typed comment keeps the card and its text; Comment refocuses it rather than writing another thread', async () => {
    const { doc, comment } = await mount();
    await comment();
    expect(useCommentCard.getState().open).toMatchObject({ hostId: expect.stringMatching(/^deck:tab-/), anchor: { artifactKind: 'presentation', locator: 'One path' } });
    await userEvent.type(field(), 'Shorter?');
    await userEvent.keyboard('{Escape}');
    expect(useCommentCard.getState().open).not.toBeNull();
    expect(field().value).toBe('Shorter?');
    expect(document.activeElement).not.toBe(field());
    await comment();
    expect(listThreads(doc)).toHaveLength(1);
    expect(document.activeElement).toBe(field());
  });

  it('an empty card is discarded on Escape, its thread withdrawn', async () => {
    const { doc, comment } = await mount();
    await comment();
    await userEvent.keyboard('{Escape}');
    await act(async () => {});
    expect(useCommentCard.getState().open).toBeNull();
    expect(listThreads(doc)).toHaveLength(0);
  });

  // the review's P1: a move onto a view already showing the deck activates that view and closes the source (P4-B3's
  // activate-existing move, its Decision Log 39); the guard does not ask a move, so the card must go to the kept view
  it('a move onto a view already showing the deck hands the card and its typed comment to that view, the source closing', async () => {
    const { doc, state, comment, unmount } = await mount();
    await comment();
    await userEvent.type(field(), 'Shorter?');
    // the panel shows the deck too: the move's destination
    const panelScope: EditorHostScope = { surface: 'panel', tabId: 'panel-tab-1' };
    const editor = artifactEditorFor('presentation')!;
    const kept = holdArtifactEditorState<DeckTabState>(panelScope, DECK, 'presentation', editor as never);
    const Panel = editor.Panel;
    const panel = render(
      <EditorHostScopeContext.Provider value={panelScope}>
        <Panel artifactId={DECK} state={kept.state} scope={panelScope} visible onShown={() => {}} />
      </EditorHostScopeContext.Provider>,
    );
    await waitFor(() => expect(kept.state.snapshot().session).not.toBeNull());
    expect(await state.closeGuard({ moving: true })).toBe(true);
    expect(handArtifactViewOver(scope, panelScope)).toBe(true);
    expect(useCommentCard.getState().open?.hostId).toBe(kept.state.commentHostId);
    expect(commentDraftOf(DECK)).toEqual({ threadId: listThreads(doc)[0]!.id, text: 'Shorter?' });
    // the source closes, its body and its state with it
    unmount();
    act(() => releaseArtifactEditorState(scope));
    await act(async () => {});
    expect(useCommentCard.getState().open).toMatchObject({ hostId: kept.state.commentHostId });
    expect(commentDraftOf(DECK)?.text).toBe('Shorter?');
    expect(listThreads(doc)).toHaveLength(1); // not withdrawn
    panel.unmount();
    releaseArtifactEditorState(panelScope);
  });

  it('the tab’s close guard asks before an unsent comment is lost, keeps the tab when refused, and lets a move go', async () => {
    const { state, confirmDiscard, comment } = await mount();
    expect(await state.closeGuard()).toBe(true); // nothing typed: nothing asked
    expect(confirmDiscard).not.toHaveBeenCalled();
    await comment();
    await userEvent.type(field(), 'Shorter?');
    expect(await state.closeGuard()).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledWith('Presentation', 'comment');
    expect(useCommentCard.getState().open).not.toBeNull();
    expect(await state.closeGuard({ moving: true })).toBe(true); // the move keeps the card with the state
    confirmDiscard.mockResolvedValueOnce(true);
    expect(await state.closeGuard()).toBe(true);
  });
});
