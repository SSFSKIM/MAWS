// Block ids in a real Tiptap editor (happy-dom): UniqueID mints an id for every block a local transaction makes, keeps
// the first half's id through a split, gives a pasted block a fresh id, and writes nothing into the blocks a remote
// binding transaction brings in (S1 pitfall 1; D1 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md).
import { Editor, Extension, type JSONContent } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { applyV1, applyV2, diffV1, newDoc, stateV2, stateVector, type Node } from '../yjs';
import { YNode } from '../yjs/document';
import { configureYProsemirror, pmnodeToDelta, syncPlugin, ynodeToPmnode } from '../yjs/prosemirror';
import { coreExtensionOptions } from './ids';
import { extensions, schemaFor } from './schema';
import { createDocument, tabBody } from './tabs';

// happy-dom's clipboard globals, typed here so the suite needs no DOM lib (tsconfig.node.json typechecks it).
const dom = globalThis as unknown as {
  DataTransfer: new () => { setData(type: string, data: string): void };
  ClipboardEvent: new (type: string, init: { clipboardData: unknown; bubbles: boolean; cancelable: boolean }) => unknown;
};

let editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

function editorWith(content: JSONContent): Editor {
  let n = 0;
  const editor = new Editor({ extensions: extensions({ generateID: () => `n${++n}` }), coreExtensionOptions, content });
  editors.push(editor);
  return editor;
}

const ids = (editor: Editor): Array<string | null> => {
  const out: Array<string | null> = [];
  editor.state.doc.forEach((node) => out.push(node.attrs.id as string | null));
  return out;
};

const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks });
const para = (id: string | null, text: string): JSONContent => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });

describe('UniqueID on the document schema', () => {
  it('ids the blocks of the initial content that have none (once the editor has emitted create)', async () => {
    const editor = editorWith(doc(para('p1', 'one'), para(null, 'two')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ids(editor)).toEqual(['p1', 'n1']);
  });

  it('keeps the first half’s id through a split and mints one for the second', () => {
    const editor = editorWith(doc(para('p1', 'hello world')));
    editor.chain().setTextSelection(7).splitBlock().run();
    expect(editor.state.doc.child(0).textContent).toBe('hello ');
    expect(ids(editor)).toEqual(['p1', 'n1']);
  });

  it('gives a pasted block a fresh id, never the id it was copied with', () => {
    const editor = editorWith(doc(para('p1', 'one'), para('p2', 'two')));
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const clipboardData = new dom.DataTransfer();
    clipboardData.setData('text/html', '<p data-id="p1">copied one</p><p data-id="p2">copied two</p>');
    clipboardData.setData('text/plain', 'copied one\n\ncopied two');
    editor.view.dom.dispatchEvent(new dom.ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    const all = ids(editor);
    expect(editor.getText()).toContain('copied two');
    expect(new Set(all).size).toBe(all.length);
    expect(all.filter((id) => id === 'p1' || id === 'p2')).toEqual(['p1', 'p2']);
  });

  it('mints ids for a local insert but none for a remote binding transaction', () => {
    const editor = editorWith(doc(para('p1', 'one')));
    const block = () => editor.schema.nodes.paragraph.create(null, editor.schema.text('arrived'));
    const end = () => editor.state.doc.content.size;

    editor.view.dispatch(editor.state.tr.insert(end(), block()).setMeta('y-sync-transaction', true));
    expect(ids(editor)).toEqual(['p1', null]);

    editor.view.dispatch(editor.state.tr.insert(end(), block()));
    expect(ids(editor)).toEqual(['p1', null, 'n1']);
  });
});

// The same through the real binding: an editor bound by `@y/prosemirror`'s sync plugin to a tab body, and a block
// written into that body by another replica (no id, as a writer that omits ids would leave it; the host's repair is
// M2's). The binding's own dispatch must not answer it with an id, or every replica would write one.
describe('UniqueID under the real binding', () => {
  const Bind = (ytype: Node) =>
    Extension.create({
      name: 'collaboration', // Tiptap's name, so UniqueID takes its collaborative path (no ids written at create)
      addProseMirrorPlugins() {
        const bind = new Plugin({
          view: (view) => {
            queueMicrotask(() => !view.isDestroyed && configureYProsemirror({ ytype })(view.state, view.dispatch));
            return {};
          },
        });
        return [syncPlugin(), bind];
      },
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('mints no id for a block a remote replica wrote, and one for a block typed locally', async () => {
    const host = newDoc();
    const tab = createDocument(host, { title: 'Main', body: schemaFor().nodeFromJSON(doc(para('p1', 'one'))) });
    const local = newDoc();
    applyV2(local, stateV2(host));
    let n = 0;
    const editor = new Editor({ extensions: [...extensions({ generateID: () => `n${++n}` }), Bind(tabBody(local, tab)!)], coreExtensionOptions });
    editors.push(editor);
    await settle();
    expect(ids(editor)).toEqual(['p1']);

    // the other replica appends an id-less block; its update arrives at this one
    const remote = newDoc();
    applyV2(remote, stateV2(local));
    const before = stateVector(remote);
    const body = tabBody(remote, tab)!;
    body.insert(body.length, [YNode.from(pmnodeToDelta(schemaFor().nodes.paragraph.create(null, schemaFor().text('arrived'))))]);
    applyV1(local, diffV1(remote, before));
    await settle();
    expect(editor.getText()).toContain('arrived');
    expect(ids(editor)).toEqual(['p1', null]);
    expect(ynodeToPmnode(tabBody(local, tab)!, schemaFor()).child(1).attrs.id).toBeNull();

    // a local split mints, and the id reaches the Y.Doc through the binding
    editor.chain().setTextSelection(3).splitBlock().run();
    await settle();
    const [, minted, remoteBlock] = ids(editor);
    expect([minted, remoteBlock]).toEqual([expect.stringMatching(/^n\d+$/), null]);
    expect(ynodeToPmnode(tabBody(local, tab)!, schemaFor()).child(1).attrs.id).toBe(minted);
  });

  // M9 (the scale gate): Tiptap core's Delete extension *ignores* a transaction its filter answers true for (UniqueID's
  // keeps one), and its work is quadratic in a transaction's steps (getChangedRanges); the binding's rebind of a
  // 200-page tab is one transaction of a step per block, so it must be the binding's transactions it ignores.
  it('reports a local deletion to the core Delete extension, never a remote binding transaction’s', async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0)); // the extension reports after the update
    const editor = editorWith(doc(para('p1', 'one'), para('p2', 'two'), para('p3', 'three')));
    const deleted: string[] = [];
    editor.on('delete', ({ type }) => deleted.push(type));
    const second = () => editor.state.doc.child(0).nodeSize;

    editor.view.dispatch(editor.state.tr.delete(second(), second() + editor.state.doc.child(1).nodeSize).setMeta('y-sync-transaction', true));
    expect(editor.getText()).not.toContain('two');
    await tick();
    expect(deleted).toEqual([]);

    editor.view.dispatch(editor.state.tr.delete(second(), second() + editor.state.doc.child(1).nodeSize));
    expect(editor.getText()).not.toContain('three');
    await tick();
    expect(deleted).toContain('node');
  });
});
