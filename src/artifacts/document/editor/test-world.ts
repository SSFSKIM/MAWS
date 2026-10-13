// The editor suites' world (happy-dom): an in-memory host holding one document and bare Tiptap editors bound to its
// replicas through the `collaboration` extension, as DocumentEditor binds them (M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md). Test support only; the harness page builds its own.
import { Editor, type Extensions, type JSONContent } from '@tiptap/core';
import { Collaboration } from '../collab';
import { coreExtensionOptions } from '../ids';
import { extensions, schemaFor } from '../schema';
import { createDocument, tabBody } from '../tabs';
import type { DocumentHandle } from './host-types';
import { MemoryDocumentHost, openMemoryHandle, whenSynced } from './memory-host';

export const TAB = 't1';

export const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks });
export const para = (id: string | null, text: string): JSONContent => ({ type: 'paragraph', attrs: { id }, content: text ? [{ type: 'text', text }] : [] });

/** Polls `check` across macrotasks (MessageChannel delivery, the binding's microtask) until it holds or 2 s pass. */
export async function until(check: () => boolean, what = 'the condition'): Promise<void> {
  const give = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > give) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
export const ticks = async (n = 10): Promise<void> => {
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
};

export interface Replica {
  handle: DocumentHandle;
  editor: Editor;
}

export class World {
  readonly host = new MemoryDocumentHost();
  private readonly replicas: Replica[] = [];
  private readonly bareHandles: DocumentHandle[] = [];
  private n = 0;

  constructor(content: JSONContent) {
    this.host.write((d) => createDocument(d, { title: 'Main', id: TAB, body: schemaFor().nodeFromJSON(content) }));
  }

  /** A replica with an editor bound to a tab, once its content has rendered; `extra` adds extensions over its handle. */
  async replica(name: string, extra: (handle: DocumentHandle) => Extensions = () => [], tabId = TAB): Promise<Replica> {
    const handle = openMemoryHandle(this.host, { log: () => {} });
    await whenSynced(handle);
    const element = document.createElement('div');
    document.body.append(element);
    const editor = new Editor({
      element,
      coreExtensionOptions,
      extensions: [
        ...extensions({ generateID: () => `${name}${++this.n}` }),
        Collaboration.configure({ ytype: tabBody(handle.doc, tabId)!, awareness: handle.awareness, user: { name, color: 'var(--author-1)' }, hold: handle, onRestored: (l) => handle.onRestored(l) }),
        ...extra(handle),
      ],
    });
    const replica = { handle, editor };
    this.replicas.push(replica);
    await until(() => editor.getText().length > 0 || editor.state.doc.childCount > 1, `${name}'s editor to render`);
    return replica;
  }

  /** A replica with no editor (the agent's stands behind the host in the product). */
  async bare(): Promise<DocumentHandle> {
    const handle = openMemoryHandle(this.host, { log: () => {} });
    await whenSynced(handle);
    this.bareHandles.push(handle);
    return handle;
  }

  destroy(): void {
    for (const handle of this.bareHandles) handle.close();
    for (const { handle, editor } of this.replicas) {
      editor.destroy();
      handle.close();
    }
    this.host.destroy();
  }
}

/** The text of each top-level block with its id. */
export const blocks = (editor: Editor): Array<[string | null, string]> => {
  const out: Array<[string | null, string]> = [];
  editor.state.doc.forEach((node) => out.push([(node.attrs.id as string | null) ?? null, node.textContent]));
  return out;
};

/** The position just inside the end of the block with `id`. */
export function endOf(editor: Editor, id: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.attrs.id === id && node.isTextblock) at = pos + 1 + node.content.size;
    return at < 0;
  });
  if (at < 0) throw new Error(`no block ${id}`);
  return at;
}
