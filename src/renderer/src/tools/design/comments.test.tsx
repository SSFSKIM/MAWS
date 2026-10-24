// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the P3-E spec's Decision Log 12): a design's
// comment opens P2's card through B's surface on an `artifact-comment` anchor naming the design kind and its target, a
// board or an element, so the agent's lead says which; a deck's and a document's anchors stay as they were written.
// P3-F (L230): a design opened as its own main tab with no chat shown offers a new comment as the document and the deck do.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Awareness } from '@y/protocols/awareness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { design } from '@artifacts/design/fixtures/support';
import type { CommentedPassage } from '@artifacts/document/editor/comments/surface';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { threadStates } from '@artifacts/slides/threads';
import { anchoredMessage } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient } from '../../../../../test/support/fake-client';
import { artifactEditorFor, handArtifactViewOver, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors } from '../../artifacts/registry';
import { NO_SESSION_CONTEXT } from '../../artifacts/session-context';
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
import { registerDesignEditor } from './index';
import type { DesignTabState } from './tab-state';

const PARENT = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const onBoard: CommentedPassage = { threadId: 't1', tabId: 'phone', tabTitle: 'Phone', quote: 'Phone', artifactTarget: 'board' };
const onElement: CommentedPassage = { threadId: 't2', tabId: 'phone', tabTitle: 'Phone', quote: 'Ship the first week.', artifactTarget: 'element' };

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

describe('a design comment’s anchor', () => {
  it('names the design kind and its target, and the lead names the board or the element and the design', () => {
    const board = artifactCommentAnchor({ artifactId: 'design-1', title: 'Launch screens', ...onBoard, artifactKind: 'design' });
    expect(board).toEqual({ kind: 'artifact-comment', label: 'Launch screens, Phone', locator: 'Phone', artifactId: 'design-1', threadId: 't1', artifactKind: 'design', artifactTarget: 'board' });
    expect(anchoredMessage({ anchor: board, text: 'Taller?', destination: 'main', screenshot: false }).split('\n')[0]).toBe('Comment on "Launch screens, Phone" (board "Phone" in design design-1, thread t1):');
    const element = artifactCommentAnchor({ artifactId: 'design-1', title: 'Launch screens', ...onElement, artifactKind: 'design' });
    expect(anchoredMessage({ anchor: element, text: 'Shorter?', destination: 'main', screenshot: false }).split('\n')[0]).toBe('Comment on "Launch screens, Phone" (element "Ship the first week." in design design-1, thread t2):');
    const deckPassage: CommentedPassage = { threadId: 't2', tabId: 's1', tabTitle: 'slide 1: Plan', quote: 'One path' };
    expect(artifactCommentAnchor({ artifactId: 'deck-1', title: 'Q3 review', ...deckPassage, artifactKind: 'presentation' })).not.toHaveProperty('artifactTarget'); // a deck's, as C writes it
  });

  it('is what the surface opens the card on', async () => {
    let opened: ((p: CommentedPassage) => void) | null = null;
    function Design() {
      const comments = useDocumentComments({ artifactId: 'design-1', appSessionId: PARENT, title: 'Launch screens', artifactKind: 'design' });
      opened = comments.opened;
      return null;
    }
    render(<Design />);
    act(() => opened!(onBoard));
    await act(async () => {});
    expect(useCommentCard.getState().open?.anchor).toMatchObject({ kind: 'artifact-comment', artifactKind: 'design', artifactTarget: 'board', threadId: 't1', locator: 'Phone' });
  });
});

// P3-F (L230's Design remainder; the document's and the deck's at P3-F1, bd8532a18): the design's body, mounted as an
// `artifact` main tab mounts it, takes its comment target from `useArtifactCommentTarget`: beside a chat the shown
// session as before; with no chat shown the design's own context (H's owner-start policy), its own session opening the
// card that names it, or with no context the card's notice saying why.
describe('a design opened as its own tab', () => {
  const OWN = 'a2222222-2222-4222-8222-222222222222' as AppSessionId;
  const DESIGN = '66666666-6666-4666-8666-666666666666';
  const scope: EditorHostScope = { surface: 'main', tabId: 'main-tab-1' };
  // a library row as main answers it (the IPC client validates every answer)
  const row = (over: Partial<LibraryRow>): LibraryRow => ({
    id: DESIGN, kind: 'design', title: 'Launch screens', createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
    revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 1, sessions: [], ...over,
  });
  let off = () => {};
  beforeEach(() => {
    resetLibrary();
    resetEditorHosts();
    resetMarkupSurfaces();
    resetArtifactEditors();
    const s = useSessions.getState();
    useSessions.setState({ records: new Map(s.records).set(OWN, record(OWN, { title: { text: 'Own plan', source: 'user' } })), recordsVersion: s.recordsVersion + 1 });
  });
  afterEach(() => {
    cleanup();
    releaseArtifactEditorState(scope);
    off();
    delete (window as { maws?: unknown }).maws;
  });

  function handleOf(): DocumentHandle {
    const doc = design([{ id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 }, title: 'Phone' }]);
    const state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false };
    return { doc, awareness: new Awareness(doc), state: () => state, subscribe: () => () => {}, onRestored: () => () => {}, onProvisional: () => () => {}, holdRemote() {}, close() {} } as unknown as DocumentHandle;
  }
  // L's main tab: the kind's Main with the state held for the tab's scope, the design's row as the library answers it
  async function mount(answer: LibraryRow) {
    window.maws = fakeClient({ 'session.intent.get': null, 'library.get': { row: answer } }).client;
    const handle = handleOf();
    const host = { open: vi.fn(async () => handle), assetUrl: () => '', identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' }) } as unknown as ArtifactHost;
    off = registerDesignEditor(() => ({ host, log: () => {}, confirmDiscard: async () => true }));
    const editor = artifactEditorFor('design')!;
    const hold = holdArtifactEditorState<DesignTabState>(scope, DESIGN, 'design', editor as never);
    const Main = editor.Main;
    render(
      <EditorHostScopeContext.Provider value={scope}>
        <Main artifactId={DESIGN} state={hold.state} scope={scope} visible onShown={() => {}} />
      </EditorHostScopeContext.Provider>,
    );
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Design' })).toBeTruthy());
  }
  const comment = async () => {
    const button = await waitFor(() => within(screen.getByRole('toolbar', { name: 'Design' })).getByRole('button', { name: 'Add comment' }));
    act(() => button.click());
    await act(async () => {});
  };

  it('beside a chat: the card goes to the shown session, as before, without naming it', async () => {
    act(() => useLayout.getState().openSession(PARENT));
    await mount(row({ createdBy: { kind: 'session', appSessionId: OWN } }));
    await comment();
    expect(useCommentCard.getState().open).toMatchObject({ parent: PARENT, anchor: { kind: 'artifact-comment', artifactKind: 'design', artifactTarget: 'board', locator: 'Phone' } });
    expect(document.querySelector('[data-card-parent]')).toBeNull();
  });

  it('with no chat shown: Comment opens the card on the design’s own session, naming it', async () => {
    await mount(row({ createdBy: { kind: 'session', appSessionId: OWN } }));
    await comment();
    expect(useCommentCard.getState().open).toMatchObject({ parent: OWN, anchor: { kind: 'artifact-comment', artifactKind: 'design', artifactTarget: 'board' } });
    expect(document.querySelector<HTMLElement>('[data-card-parent]')?.textContent).toBe('Session: Own plan');
  });

  it('with no chat shown and no context: Comment shows the card’s notice saying why, and starts nothing', async () => {
    await mount(row({}));
    await comment();
    expect(useCommentCard.getState().open).toBeNull();
    const notice = document.querySelector<HTMLElement>('[data-comment-context]');
    expect(notice?.dataset.commentContext).toBe('none');
    expect(notice?.textContent).toContain(NO_SESSION_CONTEXT);
  });
});

// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; X36's draft rule, as B1's document and the deck):
// the design's body opts into the draft rule: Escape on a typed comment keeps the card and its text, Comment refocuses it
// instead of anchoring a second thread, and the tab's close guard asks before the draft is lost (not on a move).
describe('a design’s compose card keeps its draft', () => {
  const DESIGN = '66666666-6666-4666-8666-666666666666';
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

  async function mount() {
    window.maws = fakeClient({ 'session.intent.get': null, 'library.get': { row: null } }).client;
    const doc = design([{ id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 }, title: 'Phone' }]);
    const document: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false };
    const handle = { doc, awareness: new Awareness(doc), state: () => document, subscribe: () => () => {}, onRestored: () => () => {}, onProvisional: () => () => {}, holdRemote() {}, close() {} } as unknown as DocumentHandle;
    const host = { open: vi.fn(async () => handle), assetUrl: () => '', identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' }) } as unknown as ArtifactHost;
    const confirmDiscard = vi.fn<(title: string, about?: 'comment') => Promise<boolean>>(async () => false);
    act(() => useLayout.getState().openSession(PARENT)); // a chat shown: the comment goes to it
    off = registerDesignEditor(() => ({ host, log: () => {}, confirmDiscard }));
    const editor = artifactEditorFor('design')!;
    const hold = holdArtifactEditorState<DesignTabState>(scope, DESIGN, 'design', editor as never);
    const Main = editor.Main;
    render(
      <EditorHostScopeContext.Provider value={scope}>
        <Main artifactId={DESIGN} state={hold.state} scope={scope} visible onShown={() => {}} />
      </EditorHostScopeContext.Provider>,
    );
    await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Design' })).toBeTruthy());
    const comment = async () => {
      const button = await waitFor(() => within(screen.getByRole('toolbar', { name: 'Design' })).getByRole('button', { name: 'Add comment' }));
      act(() => button.click());
      await act(async () => {});
    };
    return { doc, state: hold.state, confirmDiscard, comment };
  }
  const field = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;

  it('Escape on a typed comment keeps the card and its text; Comment refocuses it rather than anchoring another thread', async () => {
    const { doc, comment } = await mount();
    await comment();
    expect(useCommentCard.getState().open).toMatchObject({ hostId: expect.stringMatching(/^deck:tab-/), anchor: { artifactKind: 'design', artifactTarget: 'board' } });
    await userEvent.type(field(), 'Taller?');
    await userEvent.keyboard('{Escape}');
    expect(useCommentCard.getState().open).not.toBeNull();
    expect(field().value).toBe('Taller?');
    await comment();
    expect(threadStates(doc)).toHaveLength(1);
    expect(document.activeElement).toBe(field());
  });

  // the review's P1: an activate-existing move hands the card and its comment to the view it keeps
  it('a move onto a view already showing the design hands the card and its typed comment to that view', async () => {
    const { state, comment } = await mount();
    await comment();
    await userEvent.type(field(), 'Taller?');
    const panelScope: EditorHostScope = { surface: 'panel', tabId: 'panel-tab-1' };
    const kept = holdArtifactEditorState<DesignTabState>(panelScope, DESIGN, 'design', artifactEditorFor('design')! as never);
    expect(await state.closeGuard({ moving: true })).toBe(true);
    expect(handArtifactViewOver(scope, panelScope)).toBe(true);
    expect(useCommentCard.getState().open?.hostId).toBe(kept.state.commentHostId);
    expect(commentDraftOf(DESIGN)?.text).toBe('Taller?');
    releaseArtifactEditorState(panelScope);
  });

  it('the tab’s close guard asks before an unsent comment is lost, and lets a move go', async () => {
    const { state, confirmDiscard, comment } = await mount();
    await comment();
    await userEvent.type(field(), 'Taller?');
    expect(await state.closeGuard()).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledWith('Design', 'comment');
    expect(await state.closeGuard({ moving: true })).toBe(true);
  });
});
