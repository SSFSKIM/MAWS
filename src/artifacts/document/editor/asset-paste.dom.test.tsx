// P4 (the tracker's 2026-10-19 "P4 document paste" row; P3 Decision Log 65): an image pasted from one document into
// another (happy-dom, through ProseMirror's own copy and paste handlers; the OS pasteboard is the e2e's). An image's
// `src` is its own document's asset ref, drawn against the document showing it (nodes/views.ts), so the paste copies the
// asset into the target through `copyAsset` before anything lands and stores the copy's ref: the picture is the
// target's own and stays when the source document goes. A paste within one document, or from outside MAWS, copies
// nothing and lands as before.
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { act, cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ynodeToPmnode } from '../../yjs/prosemirror';
import { schemaFor } from '../schema';
import { tabBody } from '../tabs';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle, EditorHost } from './host-types';
import { openMemoryHandle, whenSynced } from './memory-host';
import { TAB, World, doc, endOf, para, ticks, until } from './test-world';

let worlds: World[] = [];
let handles: DocumentHandle[] = [];
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  for (const world of worlds) world.destroy();
  handles = [];
  worlds = [];
});

// Each artifact's assets as the store keeps them: a ref names a picture only within its own artifact, and a copy is a
// row of the target's own (here the same picture under the target's new ref). A deleted artifact's assets are gone.
function storeHost() {
  const assets = new Map<string, Map<string, string>>();
  const of = (artifactId: string): Map<string, string> => assets.get(artifactId) ?? assets.set(artifactId, new Map()).get(artifactId)!;
  let copies = 0;
  let gate: Promise<void> = Promise.resolve();
  const host = {
    identity: () => ({ actor: { kind: 'human' as const }, name: 'Owner', color: '--author-2' }),
    assetUrl: (artifactId: string, ref: string) => assets.get(artifactId)?.get(ref) ?? `missing:${artifactId}/${ref}`,
    uploadAsset: () => Promise.reject(new Error('no upload in this suite')),
    copyAsset: vi.fn(async (from: string, ref: string, to: string) => {
      await gate;
      const picture = assets.get(from)?.get(ref);
      if (!picture) throw new Error(`no asset ${ref} in ${from}`);
      copies += 1;
      const copy = { assetId: `copy-${copies}`, ref: `assets/copy-${copies}.png` };
      of(to).set(copy.ref, picture);
      return copy;
    }),
  } satisfies EditorHost;
  return {
    host,
    put: (artifactId: string, ref: string, picture: string) => void of(artifactId).set(ref, picture),
    remove: (artifactId: string) => void assets.delete(artifactId),
    /** Copies wait until the answer is called. */
    hold(): () => void {
      let release!: () => void;
      gate = new Promise((resolve) => (release = resolve));
      return () => release();
    },
  };
}

async function open(artifactId: string, content: JSONContent, host: EditorHost, world = new World(content)) {
  if (!worlds.includes(world)) worlds.push(world);
  const handle = openMemoryHandle(world.host, { log: () => {} });
  handles.push(handle);
  await whenSynced(handle);
  let current: Editor | null = null;
  const view = render(<DocumentEditor artifactId={artifactId} handle={handle} host={host} renderDiagram={async () => '<svg></svg>'} onEditor={(e) => (current = e)} />);
  await until(() => current !== null && current.getText().length > 0, `${artifactId}'s editor to bind`);
  return { world, container: view.container, unmount: view.unmount, editor: () => current! };
}

const harbour = (): JSONContent =>
  doc({ type: 'paragraph', attrs: { id: 'a1' }, content: [{ type: 'text', text: 'Harbour ' }, { type: 'image', attrs: { src: 'assets/photo.png', alt: 'Harbour', assetId: 'asset-a' } }] });

const imagesIn = (root: PMNode): Array<{ src: unknown; assetId: unknown }> => {
  const out: Array<{ src: unknown; assetId: unknown }> = [];
  root.descendants((node) => void (node.type.name === 'image' && out.push({ src: node.attrs.src, assetId: node.attrs.assetId })));
  return out;
};
/** The images the host's tab holds: what the store keeps. */
const stored = (world: World) => imagesIn(ynodeToPmnode(tabBody(world.host.doc, TAB)!, schemaFor()));
/** The pictures the editor draws. */
const drawn = (container: HTMLElement) => [...container.querySelectorAll('img.doc-image')].map((img) => img.getAttribute('src'));

/** The whole document copied as a person's Mod-C does: ProseMirror's own copy handler writes the clipboard. */
function copyAll(editor: Editor): { html: string; text: string } {
  act(() => void editor.commands.selectAll());
  const data = new DataTransfer();
  act(() => void editor.view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true })));
  return { html: data.getData('text/html'), text: data.getData('text/plain') };
}
/** A paste at the end of block `id`, as a user's paste arrives. */
function pasteAt(editor: Editor, id: string, clip: { html: string; text?: string }): void {
  act(() => void editor.commands.setTextSelection(endOf(editor, id)));
  const data = new DataTransfer();
  data.setData('text/html', clip.html);
  data.setData('text/plain', clip.text ?? '');
  act(() => void editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })));
}
const toolbarOf = (container: HTMLElement) => within(container).getByRole('toolbar', { name: 'Formatting' });

describe('an image pasted from another document', () => {
  it('is copied into this document before the paste lands, and the stored ref is the copy’s, which outlives the source', async () => {
    const store = storeHost();
    store.put('docA', 'assets/photo.png', 'picture: the harbour');
    store.put('docB', 'assets/photo.png', 'picture: a different photo'); // B's own photo.png, which A's ref would name in B
    const a = await open('docA', harbour(), store.host);
    const b = await open('docB', doc(para('b1', 'Notes ')), store.host);

    const release = store.hold();
    pasteAt(b.editor(), 'b1', copyAll(a.editor()));
    await ticks();
    expect(imagesIn(b.editor().state.doc)).toEqual([]); // nothing lands while the copy is in flight
    expect(store.host.copyAsset.mock.calls).toEqual([['docA', 'assets/photo.png', 'docB']]);

    release();
    await until(() => stored(b.world).length === 1, 'the paste to reach the host');
    expect(stored(b.world)).toEqual([{ src: 'assets/copy-1.png', assetId: 'copy-1' }]);
    expect(b.editor().getText()).toContain('Harbour');
    expect(drawn(b.container)).toEqual(['picture: the harbour']);

    // the source document goes, its assets with it: B, opened again, still draws its own copy
    a.unmount();
    store.remove('docA');
    const again = await open('docB', doc(), store.host, b.world);
    expect(drawn(again.container)).toEqual(['picture: the harbour']);
  });

  it('pastes nothing when the copy fails, and says why in the toolbar', async () => {
    const store = storeHost();
    store.put('docA', 'assets/photo.png', 'picture: the harbour');
    const a = await open('docA', harbour(), store.host);
    const b = await open('docB', doc(para('b1', 'Notes ')), store.host);
    const clip = copyAll(a.editor());
    store.remove('docA'); // the source went between the copy and the paste: the store refuses to copy from it

    const before = JSON.stringify(b.editor().getJSON());
    pasteAt(b.editor(), 'b1', clip);
    const alert = await within(toolbarOf(b.container)).findByRole('alert');
    expect(alert.textContent).toContain('no asset assets/photo.png in docA');
    await ticks();
    expect(JSON.stringify(b.editor().getJSON())).toBe(before);
  });

  it('pastes nothing when the document stops taking edits while the copy is in flight', async () => {
    const store = storeHost();
    store.put('docA', 'assets/photo.png', 'picture: the harbour');
    const a = await open('docA', harbour(), store.host);
    const b = await open('docB', doc(para('b1', 'Notes ')), store.host);

    const release = store.hold();
    pasteAt(b.editor(), 'b1', copyAll(a.editor()));
    await ticks();
    act(() => b.editor().setEditable(false));
    release();
    const alert = await within(toolbarOf(b.container)).findByRole('alert');
    expect(alert.textContent).toContain('stopped taking edits');
    expect(imagesIn(b.editor().state.doc)).toEqual([]);
  });
});

describe('a paste that names no other document', () => {
  it('within one document, or from outside MAWS, lands as before with nothing copied', async () => {
    const store = storeHost();
    store.put('docA', 'assets/photo.png', 'picture: the harbour');
    const a = await open('docA', harbour(), store.host);
    pasteAt(a.editor(), 'a1', copyAll(a.editor()));
    await until(() => stored(a.world).length === 2, 'the paste within the document');
    expect(stored(a.world)).toEqual([
      { src: 'assets/photo.png', assetId: 'asset-a' },
      { src: 'assets/photo.png', assetId: 'asset-a' },
    ]);

    const b = await open('docB', doc(para('b1', 'Notes ')), store.host);
    pasteAt(b.editor(), 'b1', { html: '<p>From the web <img src="https://example.com/pier.png" alt="Pier"></p>' });
    await until(() => stored(b.world).length === 1, 'the web picture');
    expect(stored(b.world)).toEqual([{ src: 'https://example.com/pier.png', assetId: null }]);
    expect(store.host.copyAsset).not.toHaveBeenCalled();
  });
});
