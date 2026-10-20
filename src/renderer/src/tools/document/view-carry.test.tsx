// P4-B3 M5 (its Decision Log 25; X38's carry for the document kind, and the dashboard's, which shares its body; tracker
// row 147's undo half, candidate 22): a document's body remounts when it moves between the panel and a main tab, and
// when its tab is switched away and back. The tab's state keeps the undo history (one UndoManager per tab body, swapped
// into each new editor), so ⌘Z after either undoes an edit made before it; a move also carries what the owner was
// looking at: the first visible block, the selection and the focus. happy-dom lays nothing out, so the page and its
// blocks are given rects here: a block's height stands for the surface's width (the panel's narrower, its blocks taller).
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { createDocument } from '@artifacts/document/tabs';
import type { ArtifactHost } from '@artifacts/host';
import { yUndoPluginKey } from '@artifacts/yjs/prosemirror';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../../test/support/fake-client';
import { adoptStagedArtifactEditorState, artifactEditorFor, holdArtifactEditorState, releaseArtifactEditorState, resetArtifactEditors, stageArtifactEditorState } from '../../artifacts/registry';
import { resetMarkupSurfaces } from '../../markup/surface';
import { EditorHostScopeContext, resetEditorHosts, type EditorHostScope } from '../../panel/editor-host';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerDocumentEditor } from './index';
import type { DocumentTabDeps, DocumentTabState } from './tab-state';
import { liveBody } from './view-carry';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const panel: EditorHostScope = { surface: 'panel', tabId: 'panel-tab-1' };
const main: EditorHostScope = { surface: 'main', tabId: `artifact:${A}` };

let memory: MemoryDocumentHost;
let off = () => {};
let blockHeight = 100; // the surface's: a block's height at its width
const PAGE_HEIGHT = 600;

beforeEach(() => {
  resetShellStores();
  resetEditorHosts();
  resetMarkupSurfaces();
  resetArtifactEditors();
  window.maws = fakeClient({ 'session.intent.get': null }).client;
  memory = new MemoryDocumentHost();
  memory.write((doc) => createDocument(doc, { title: 'Launch plan' }));
  off = registerDocumentEditor(deps);
  blockHeight = 100;
  // The page (`.ds-doc`, the scroll box) at the viewport's top; its blocks stacked at `blockHeight` each, moved by its
  // scrollTop.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('ds-doc')) return new DOMRect(0, 0, 800, PAGE_HEIGHT);
    const parent = this.parentElement;
    if (parent?.classList.contains('ProseMirror')) {
      const page = parent.closest('.ds-doc') as HTMLElement;
      const index = [...parent.children].indexOf(this);
      return new DOMRect(0, index * blockHeight - page.scrollTop, 800, blockHeight);
    }
    return new DOMRect(0, 0, 0, 0);
  });
});
afterEach(() => {
  cleanup();
  releaseArtifactEditorState(panel);
  releaseArtifactEditorState(main);
  off();
  memory.destroy();
  vi.restoreAllMocks();
  delete (window as { maws?: unknown }).maws;
});

const until = async (check: () => boolean, what: string) => {
  const give = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > give) throw new Error(`timed out waiting for ${what}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }
};
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));

function deps(): DocumentTabDeps {
  const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
    invoke: (async (name: CommandName) => ({ ok: true, value: name === 'artifacts.get' ? { artifact: { id: A, kind: 'document', title: 'Launch plan', lastViewedAt: null, revision: 1 } } : name === 'artifacts.versions' ? { versions: [] } : undefined })) as MawsBridge['invoke'],
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

// A body of the kind's surface in `scope`, over the state that scope holds (as the record view and the main tab mount it).
function mountIn(scope: EditorHostScope) {
  const editor = artifactEditorFor('document')!;
  const hold = holdArtifactEditorState<DocumentTabState>(scope, A, 'document', editor as never);
  const Body = scope.surface === 'panel' ? editor.Panel : editor.Main;
  const tree = () => (
    <EditorHostScopeContext.Provider value={scope}>
      <Body artifactId={A} state={hold.state} scope={scope} visible onShown={() => {}} />
    </EditorHostScopeContext.Provider>
  );
  const view = render(tree());
  return { state: hold.state as DocumentTabState, view, remount: () => (view.unmount(), render(tree())) };
}

const pageEl = () => document.querySelector<HTMLElement>('.ds-doc')!;
const editorOn = () => (document.querySelector('.ds-doc .ProseMirror') as (HTMLElement & { editor?: Editor }) | null)?.editor ?? null;
// The live editor, bound to its tab: its binding has swapped in an undo history of the document's (not the placeholder
// it starts with), and the body has had its moment to put the tab's own in.
async function ready(): Promise<Editor> {
  await until(() => {
    const editor = editorOn();
    if (!editor || editor.state.doc.childCount === 0) return false;
    const manager = (yUndoPluginKey.getState(editor.state) as { undoManager?: unknown } | undefined)?.undoManager;
    const storage = editor.storage.collaboration;
    return storage.undoManager !== null && manager !== storage.scratch?.undoManager;
  }, 'the editor bound');
  await settle();
  return editorOn()!;
}
const textOf = (editor: Editor) => editor.state.doc.textContent;

// Two undo steps in the editor: a block of paragraphs, then a word typed in the last.
function edit(editor: Editor, state: DocumentTabState): void {
  act(() => void editor.commands.insertContent(Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i + 1}</p>`).join('')));
  for (const manager of state.undoManagers()) manager.stopCapturing();
  act(() => void editor.commands.insertContent(' typed'));
}

describe('the document tab keeps its undo history across a remount (row 147’s undo half, candidate 22)', () => {
  it('⌘Z after the body remounts (its tab switched away and back) undoes edits made before it, step by step', async () => {
    const { state, remount } = mountIn(panel);
    const first = await ready();
    edit(first, state);
    expect(textOf(first)).toContain('Paragraph 30 typed');
    remount();
    const second = await ready();
    expect(second).not.toBe(first);
    act(() => void second.commands.undo());
    expect(textOf(second), 'the word typed before the remount').not.toContain('typed');
    expect(textOf(second)).toContain('Paragraph 30');
    act(() => void second.commands.undo());
    expect(textOf(second), 'the block before it').not.toContain('Paragraph');
  });

  it('a restore this replica did not make clears it, as the binding’s own history was cleared', async () => {
    const { state } = mountIn(panel);
    const editor = await ready();
    edit(editor, state);
    await until(() => state.snapshot().handle!.state().unsaved === 0, 'the edits durable'); // the provider takes a restore after its ack
    act(() => memory.announceRestored(3));
    await until(() => state.undoManagers().every((manager) => manager.undoStack.length === 0), 'the history cleared');
    act(() => void editor.commands.undo());
    expect(textOf(editor)).toContain('Paragraph 30 typed');
  });

  it('is the tab’s own: another surface’s tab of the same artifact keeps another; disposing the tab ends it', async () => {
    const one = mountIn(panel);
    await ready();
    const kept = one.state.undoManagers();
    expect(kept).toHaveLength(1);
    const destroyed = vi.spyOn(kept[0]!, 'destroy');
    cleanup();
    const other = mountIn(main);
    await ready();
    expect(other.state).not.toBe(one.state);
    expect(other.state.undoManagers()[0]).not.toBe(kept[0]);
    releaseArtifactEditorState(panel);
    expect(destroyed).toHaveBeenCalledOnce();
    expect(one.state.undoManagers()).toEqual([]);
  });
});

describe('a document moved between the panel and a main tab comes back where the owner was', () => {
  // The move's synchronous run, as `shell/transfer.ts` does it: the source stages its hold while its body is mounted, lets
  // go, and the target adopts the hold before its body mounts.
  function move(from: EditorHostScope, to: EditorHostScope, source: ReturnType<typeof mountIn>, targetBlockHeight = blockHeight) {
    act(() => {
      stageArtifactEditorState(from);
      source.view.unmount();
      adoptStagedArtifactEditorState(A, to);
    });
    blockHeight = targetBlockHeight;
    return mountIn(to);
  }

  it('panel → main: the same first visible block, the same selection, the focus, and the history', async () => {
    const source = mountIn(panel);
    const editor = await ready();
    edit(editor, source.state);
    // The reader at paragraph 12's middle in the panel (blocks 100 px: the page's first block is the title's), with a
    // passage of paragraph 14 selected and the keyboard in the page.
    act(() => {
      pageEl().scrollTop = 12 * 100 + 50;
      editor.view.focus();
      const at = positionOf(editor, 'Paragraph 14');
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at, at + 9)));
    });
    expect(editor.view.hasFocus()).toBe(true);
    const selected = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);
    expect(selected).toBe('Paragraph');

    const target = move(panel, main, source, 40); // main is wider: shorter blocks
    expect(target.state).toBe(source.state);
    const moved = await ready();
    await settle();
    expect(pageEl().scrollTop, 'block 12, half way, at the top').toBe(12 * 40 + 20);
    expect(moved.view.hasFocus()).toBe(true);
    const { from, to } = moved.state.selection;
    expect(from).toBe(positionOf(moved, 'Paragraph 14'));
    expect(moved.state.doc.textBetween(from, to)).toBe('Paragraph');
    act(() => void moved.commands.undo());
    expect(textOf(moved)).not.toContain('typed');
  });

  it('main → panel: a block’s top at the page’s top, a page without the keyboard left without it', async () => {
    blockHeight = 40;
    const source = mountIn(main);
    const editor = await ready();
    edit(editor, source.state);
    act(() => {
      pageEl().scrollTop = 7 * 40;
      editor.view.dom.blur();
    });
    expect(editor.view.hasFocus()).toBe(false);
    const target = move(main, panel, source, 100);
    expect(target.state).toBe(source.state);
    const moved = await ready();
    await settle();
    expect(pageEl().scrollTop).toBe(7 * 100);
    expect(moved.view.hasFocus()).toBe(false);
    act(() => void moved.commands.undo());
    expect(textOf(moved)).not.toContain('typed');
  });

  it('a view captured on the document’s second tab restores nothing on the first, which the moved body opens on', async () => {
    const source = mountIn(panel);
    const first = await ready();
    edit(first, source.state);
    const firstBody = liveBody(first);
    act(() => screen.getByRole('button', { name: 'Add tab' }).click());
    await until(() => editorOn() !== null && editorOn() !== first, 'the second tab’s editor');
    const second = await ready();
    expect(liveBody(second)).not.toBe(firstBody);
    act(() => void (pageEl().scrollTop = 900));
    const target = move(panel, main, source);
    const moved = await ready();
    await settle();
    expect(liveBody(moved), 'the document editor’s own tab choice').toBe(firstBody);
    expect(pageEl().scrollTop).toBe(0);
    expect(target.state.undoManagers(), 'one history per tab body').toHaveLength(2);
  });

  it('only the first mount restores: a later remount of the target opens as an ordinary remount does', async () => {
    const source = mountIn(panel);
    const editor = await ready();
    edit(editor, source.state);
    act(() => void (pageEl().scrollTop = 900));
    const target = move(panel, main, source);
    await ready();
    await settle();
    expect(pageEl().scrollTop).toBe(900);
    target.remount();
    await ready();
    await settle();
    expect(pageEl().scrollTop, 'a fresh page').toBe(0);
  });
});

// The document position at the start of the paragraph whose text is `text`.
function positionOf(editor: Editor, text: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock && node.textContent.startsWith(text)) at = pos + 1;
    return !node.isTextblock;
  });
  return at;
}
