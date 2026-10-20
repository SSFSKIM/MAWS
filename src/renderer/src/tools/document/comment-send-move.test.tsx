// P4-B3 M6's review (its Decision Log 37): a document's comment sent and, before the answer, the document moved: to the
// other main pane (the body remounts over the same tab state, as `moveTab`, ⌘\ and Open in split do) or between the
// panel and a main tab (the hold handed over). The card stays (its host id is the tab state's), so its composer is drawn
// again by a new form: it starts sending, a second Enter opens no second thread, and the answer reaches it. The real
// document editor over the memory host, with the real card host; happy-dom lays nothing out, so the page has a box.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { createDocument } from '@artifacts/document/tabs';
import type { ArtifactHost } from '@artifacts/host';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import type { LayoutMain } from '@shared/ipc/schema/layout';
import { EMPTY_TAB_SET, LAYOUT_DEFAULTS, NO_PROJECT } from '@shared/ipc/schema/layout';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { adoptStagedArtifactEditorState, artifactEditorFor, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors, stageArtifactEditorState } from '../../artifacts/registry';
import { resetMarkupSurfaces } from '../../markup/surface';
import { EditorHostScopeContext, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { useCommentCard } from '../../side/card/store';
import { openComment } from '../../side/register';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { A, sessionTab } from '../../test-support/panel';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerCommentComposer } from '../code/anchor/anchor';
import { registerDocumentEditor } from './index';
import type { DocumentTabDeps, DocumentTabState } from './tab-state';

const DOC = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const panel: EditorHostScope = { surface: 'panel', tabId: 'panel-tab-1' };
const main: EditorHostScope = { surface: 'main', tabId: `artifact:${DOC}` };
const HOST_BOX = { width: 900, height: 900 };

let memory: MemoryDocumentHost;
let fake: FakeClient;
let offs: Array<() => void> = [];

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
  resetEditorHosts();
  resetMarkupSurfaces();
  resetArtifactEditors();
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
  return { host, ipc, log: () => {}, confirm: () => false, sessionTitle: () => undefined, sessions: () => [] };
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
  await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
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
