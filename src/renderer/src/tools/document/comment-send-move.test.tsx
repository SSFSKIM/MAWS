// P4-B3 M6's review (its Decision Log 37): a document's comment sent and, before the answer, the document moved: to the
// other main pane (the body remounts over the same tab state, as `moveTab`, ⌘\ and Open in split do) or between the
// panel and a main tab (the hold handed over). The card stays (its host id is the tab state's), so its composer is drawn
// again by a new form: it starts sending, a second Enter opens no second thread, and the answer reaches it.
// P4-B3's whole-branch review (its Decision Log 39): a comment typed and not sent when its document moves onto a surface
// already showing it (T5, T8), which keeps its own view and closes the source: the card goes to the kept view with its
// text and its thread, and the source closes asking nothing. The real document editor over the memory host, with the
// real card host and the real transfer; happy-dom lays nothing out, so the page has a box.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { createDocument } from '@artifacts/document/tabs';
import { listThreads } from '@artifacts/document/threads';
import type { ArtifactHost } from '@artifacts/host';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import type { LayoutMain, TabRef } from '@shared/ipc/schema/layout';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { library, resetLibrary, rowKey } from '../../library/store';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT } from '@shared/ipc/schema/layout';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { adoptStagedArtifactEditorState, artifactEditorFor, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors, stageArtifactEditorState } from '../../artifacts/registry';
import { resetMarkupSurfaces } from '../../markup/surface';
import { askEditorHostClose, EditorHostScopeContext, registerEditorHost, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { panelHost, registerPanelTool, resetPanelHost, usePanelHost } from '../../panel/host';
import { moveArtifactToPanel, moveArtifactToTab } from '../../shell/transfer';
import { useCommentCard } from '../../side/card/store';
import { openComment } from '../../side/register';
import { useLayout } from '../../stores/layout';
import { allTabs } from '../../stores/layout-model';
import { useSessions } from '../../stores/sessions';
import { A, sessionTab } from '../../test-support/panel';
import { resetShellStores } from '../../test-support/shell-stores';
import { ARTIFACTS_TOOL_ID, artifactsTool } from '../artifacts/ArtifactsTool';
import { registerCommentComposer } from '../code/anchor/anchor';
import { commentDraftOf } from './comment-drafts';
import { registerDocumentEditor } from './index';
import type { DocumentTabDeps, DocumentTabState } from './tab-state';

const DOC = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const panel: EditorHostScope = { surface: 'panel', tabId: 'panel-tab-1' };
const main: EditorHostScope = { surface: 'main', tabId: `artifact:${DOC}` };
const HOST_BOX = { width: 900, height: 900 };

let memory: MemoryDocumentHost;
let fake: FakeClient;
let offs: Array<() => void> = [];
let asked: string[] = []; // what a close guard asked the owner

const clientSize = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!, height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')! };
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => HOST_BOX.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => HOST_BOX.height });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientSize.width);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientSize.height);
});

beforeEach(() => {
  resetShellStores();
  resetLibrary();
  resetEditorHosts();
  resetMarkupSurfaces();
  resetArtifactEditors();
  asked = [];
  fake = fakeClient({ 'session.intent.get': null });
  window.maws = fake.client;
  memory = new MemoryDocumentHost();
  memory.write((doc) => createDocument(doc, { title: 'Launch plan' }));
  offs = [registerDocumentEditor(deps), registerCommentComposer(openComment)];
  // the main area shows session A, ready: the document's comments go to it
  const main: LayoutMain = { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { ...EMPTY_TAB_SET, panes: [{ tabs: [sessionTab(A)], activeTabId: sessionTab(A).id }] } } } as LayoutMain;
  useLayout.setState({ main });
  const s = useSessions.getState();
  useSessions.setState({ records: new Map([[A, record(A)]]), engine: new Map([[A, status(A, { process: 'ready' } as never)]]), recordsVersion: s.recordsVersion + 1 });
});
afterEach(() => {
  cleanup();
  releaseArtifactEditorState(panel);
  releaseArtifactEditorState(main);
  for (const off of offs) off();
  useCommentCard.setState({ open: null });
  memory.destroy();
  delete (window as { maws?: unknown }).maws;
});

function deps(): DocumentTabDeps {
  const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
    invoke: (async (name: CommandName) => ({ ok: true, value: name === 'artifacts.get' ? { artifact: { id: DOC, kind: 'document', title: 'Launch plan', lastViewedAt: null, revision: 1 } } : name === 'artifacts.versions' ? { versions: [] } : undefined })) as MawsBridge['invoke'],
    on: (() => () => {}) as MawsBridge['on'],
  };
  const host = {
    ...memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' }),
    open: async () => {
      const handle = openMemoryHandle(memory, { log: () => {} });
      await whenSynced(handle);
      return handle;
    },
  } as unknown as ArtifactHost;
  return { host, ipc, log: () => {}, confirm: (message) => {
      asked.push(message);
      return false;
    },
    sessionTitle: () => undefined, sessions: () => [] };
}

// A body of the kind's surface in `scope` over the state that scope holds; `slot` keys its element, so a new slot is
// another body over the same state (a pane move's remount).
function mountIn(scope: EditorHostScope) {
  const editor = artifactEditorFor('document')!;
  const hold = holdArtifactEditorState<DocumentTabState>(scope, DOC, 'document', editor as never);
  const Body = scope.surface === 'panel' ? editor.Panel : editor.Main;
  const tree = (slot: string) => (
    <EditorHostScopeContext.Provider value={scope}>
      <div key={slot}>
        <Body artifactId={DOC} state={hold.state} scope={scope} visible onShown={() => {}} />
      </div>
    </EditorHostScopeContext.Provider>
  );
  const view = render(tree('a'));
  return { view, remount: () => view.rerender(tree('b')) };
}

const editorOn = () => (document.querySelector('.ds-doc .ProseMirror') as (HTMLElement & { editor?: Editor }) | null)?.editor ?? null;
const field = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;
async function ready(): Promise<Editor> {
  await waitFor(() => expect(editorOn()?.state.doc.childCount ?? 0).toBeGreaterThan(0));
  return editorOn()!;
}

// A comment on the first words, sent as a Side thread: its request on its way (unanswered).
async function commentSent(): Promise<void> {
  const editor = await ready();
  act(() => {
    editor.commands.insertContent('Quarterly plans ship on time.');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 10)));
  });
  await userEvent.click(screen.getByRole('button', { name: 'Add comment' }));
  await waitFor(() => expect(field()).toBeTruthy());
  await userEvent.type(field(), 'Monthly?{Enter}');
  expect(fake.invoked('side.thread.open')).toHaveLength(1);
}

async function replacementFormSendsNothing(before: HTMLTextAreaElement): Promise<void> {
  await waitFor(() => expect(field()).not.toBe(before));
  expect(field().disabled, 'the new form starts sending').toBe(true);
  fireEvent.keyDown(field(), { key: 'Enter' });
  await act(async () => {});
  expect(fake.invoked('side.thread.open'), 'no second thread').toHaveLength(1);
  await act(() => fake.fail('side.thread.open', 'The session is gone'));
  await waitFor(() => expect(field().disabled, 'the refusal reaches the new form').toBe(false));
  expect(document.querySelector('[data-comment-card] [role="alert"]')?.textContent).toContain('The session is gone');
}

describe('a comment being sent when its document moves', () => {
  it('to the other main pane: the body remounts over the same state', async () => {
    const body = mountIn(main);
    await commentSent();
    const before = field();
    body.remount();
    await replacementFormSendsNothing(before);
  });

  it('from the panel to a main tab, and back: the hold handed over', async () => {
    const source = mountIn(panel);
    await commentSent();
    const before = field();
    act(() => {
      stageArtifactEditorState(panel);
      source.view.unmount();
      adoptStagedArtifactEditorState(DOC, main);
    });
    const target = mountIn(main);
    await replacementFormSendsNothing(before);

    // the refused comment kept in the card; sent again, then moved back before its answer
    await userEvent.type(field(), '{Enter}');
    expect(fake.invoked('side.thread.open')).toHaveLength(2);
    const again = field();
    act(() => {
      stageArtifactEditorState(main);
      target.view.unmount();
      adoptStagedArtifactEditorState(DOC, panel);
    });
    mountIn(panel);
    await waitFor(() => expect(field()).not.toBe(again));
    expect(field().disabled).toBe(true);
    fireEvent.keyDown(field(), { key: 'Enter' });
    await act(async () => {});
    expect(fake.invoked('side.thread.open'), 'no third thread').toHaveLength(2);
  });
});

describe('an unsent comment when its document moves onto a view of it already open (T5, T8)', () => {
  const DOC_TAB: TabRef = { id: main.tabId, kind: 'artifact', artifactId: DOC, pinned: false };
  const TEXT = 'Keep this unsent comment';

  beforeEach(() => {
    resetPanelHost();
    const row: LibraryRow = { id: DOC, kind: 'document', title: 'Launch plan', createdBy: { kind: 'human' }, createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0, sessions: [] };
    library.setState({ reads: new Map([[rowKey(DOC), { status: 'ready', value: row, error: null }]]) });
    offs.push(registerPanelTool(artifactsTool));
  });

  // The main area: `left` beside session A's tab (focused), so the panel shown is A's once the document's tab is gone.
  function mainWith(left: TabRef[]): void {
    const set = { ...EMPTY_TAB_SET, focusedPane: 1, panes: [{ tabs: left, activeTabId: left.at(-1)!.id }, { tabs: [sessionTab(A)], activeTabId: sessionTab(A).id }] };
    useLayout.setState({ hydrated: true, main: { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: set } } as LayoutMain });
  }
  // A's Artifacts tab showing the document as a record.
  const recordInPanel = (): EditorHostScope => ({ surface: 'panel', tabId: panelHost.addTool(ARTIFACTS_TOOL_ID, { appSessionId: A, params: { target: DOC }, activate: false }) });
  const mainTabOpen = () => allTabs(useLayout.getState().main).some((t) => t.id === main.tabId);

  // A comment started on the first words and typed, not sent: its thread made, its text the artifact's draft.
  async function typedUnsent(): Promise<string> {
    const editor = await ready();
    act(() => {
      editor.commands.insertContent('Quarterly plans ship on time.');
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 10)));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(field()).toBeTruthy());
    await userEvent.type(field(), TEXT);
    expect(commentDraftOf(DOC)?.text).toBe(TEXT);
    return commentDraftOf(DOC)!.threadId;
  }

  // The card drawn in `container` with the text typed, the draft and its thread kept, nothing asked.
  function keptIn(container: HTMLElement, threadId: string): void {
    expect(container.contains(field()), 'the card is drawn by that view').toBe(true);
    expect(field().value).toBe(TEXT);
    expect(commentDraftOf(DOC)).toEqual({ threadId, text: TEXT });
    expect(listThreads(memory.doc).map((t) => t.id), 'the thread is not withdrawn').toContain(threadId);
    expect(asked, 'no guard asked about the comment').toEqual([]);
  }

  it('main → panel (T5): the panel’s view takes the card and its text; the tab closes without asking', async () => {
    mainWith([DOC_TAB]);
    const kept = recordInPanel();
    const source = mountIn(main);
    const threadId = await typedUnsent();
    const target = mountIn(kept);
    let moved = false;
    await act(async () => void (moved = await moveArtifactToPanel(main.tabId)));
    expect(moved).toBe(true);
    expect(mainTabOpen()).toBe(false);
    source.view.unmount(); // the closed tab's body goes
    await act(async () => {});
    keptIn(target.view.container, threadId);
  });

  it('panel → main (T8): main’s tab, its body never mounted, takes the card and its text as it shows; the record goes Back without asking', async () => {
    mainWith([DOC_TAB]); // the document's tab, its body not mounted (no hold yet)
    const source = recordInPanel();
    const record = mountIn(source);
    const threadId = await typedUnsent();
    let moved = false;
    await act(async () => void (moved = await moveArtifactToTab(source.tabId)));
    expect(moved).toBe(true);
    record.view.unmount(); // the record went Back to the list
    await act(async () => {});
    expect(commentDraftOf(DOC)?.text, 'kept while no body draws it').toBe(TEXT);
    // Comments go to the session in front; the library is not connected here, so with the document in front its own
    // context stays unread and its comments wait. A's pane in front again gives the card its session.
    act(() => useLayout.getState().focusPane(1));
    const target = mountIn(main); // the tab main activated
    await waitFor(() => expect(field()).toBeTruthy());
    keptIn(target.view.container, threadId);
  });

  it('a move refused at the re-check after the source’s guard hands nothing over: the card stays the source’s, whose close asks about it', async () => {
    mainWith([DOC_TAB]);
    const kept = recordInPanel();
    const source = mountIn(main);
    const threadId = await typedUnsent();
    mountIn(kept);
    let moved = true;
    await act(async () => {
      const move = moveArtifactToPanel(main.tabId);
      usePanelHost.setState({ closing: new Set([kept.tabId]) }); // the panel's tab starts closing while the guard is asked
      moved = await move;
    });
    expect(moved).toBe(false);
    expect(mainTabOpen()).toBe(true);
    await waitFor(() => expect(source.view.container.contains(field())).toBe(true));
    keptIn(source.view.container, threadId);
    let closes = true;
    await act(async () => void (closes = await askEditorHostClose(main)!));
    expect(closes).toBe(false);
    expect(asked, 'the source’s own comment').toEqual(['Discard your unsent comment?']);
  });

  it('a move the source’s guard refuses leaves the destination’s own comment on the destination', async () => {
    mainWith([DOC_TAB]);
    const source = recordInPanel();
    const kept = mountIn(main);
    const threadId = await typedUnsent(); // typed in main's card: main's draft, not the panel's
    holdArtifactEditorState(source, DOC, 'document', artifactEditorFor('document') as never);
    act(() => void registerEditorHost(source, { title: 'Launch plan', closeGuard: async () => false })); // the record keeps itself
    let moved = true;
    await act(async () => void (moved = await moveArtifactToTab(source.tabId)));
    expect(moved).toBe(false);
    keptIn(kept.view.container, threadId);
  });
});
