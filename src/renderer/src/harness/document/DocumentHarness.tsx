// The document harness page (`#document`; P3-B M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): two
// DocumentEditors side by side over two replicas of one in-memory host document, each a real `PortProvider` on a real
// `MessageChannel` (P3-0's S5 "world"), so the e2e cases type, insert, find and compose in one editor while the other
// stands for a remote collaborator. Playwright drives it through `window.__maws_document` (api.ts). No IPC: the page
// stands alone until A's renderer `ArtifactHost` and L's registry mount the editor in the product (M8).
//
// M4: each editor has the renderer's comment surface (tools/document/comments.tsx), so Comment opens P2's card on the
// artifact target in that editor's host, through the composer seam the side pane registers in the app (registered here
// for the page); the card's parent is a stand-in session id, so nothing is sent from this page.
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DocumentEditor } from '@artifacts/document/editor/DocumentEditor';
import type { DocumentHandle } from '@artifacts/document/editor/host-types';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument, listTabs, tabBody } from '@artifacts/document/tabs';
import { ynodeToPmnode } from '@artifacts/yjs/prosemirror';
import { listThreads } from '@artifacts/document/threads';
import type { AppSessionId } from '@shared/graph/ids';
import { openComment } from '../../side/register';
import { registerCommentComposer } from '../../tools/code/anchor/anchor';
import { useDocumentComments } from '../../tools/document/comments';
import type { DocumentHarnessApi, Replica } from './api';
import { placeCaret } from './caret';

// The session a comment would go to; none exists on this page, so a card opens and composes but never sends.
const COMMENT_SESSION = 'e0000000-0000-4000-8000-00000000d0c5' as AppSessionId;
const TITLE = 'Field notes';

declare global {
  interface Window {
    __maws_document?: DocumentHarnessApi;
  }
}

// The seed: United States frame, culture-neutral content.
const SEED = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { id: 'title001', level: 1 }, content: [{ type: 'text', text: 'Field notes' }] },
    { type: 'paragraph', attrs: { id: 'para0001' }, content: [{ type: 'text', text: 'The owner types here.' }] },
    { type: 'paragraph', attrs: { id: 'para0002' }, content: [{ type: 'text', text: 'The river runs north; the river is cold.' }] },
    { type: 'paragraph', attrs: { id: 'para0003' }, content: [{ type: 'text', text: 'The collaborator types here.' }] },
  ],
};

interface World {
  host: MemoryDocumentHost;
  handles: Record<Replica, DocumentHandle>;
}

async function openWorld(): Promise<World> {
  const host = new MemoryDocumentHost();
  host.write((doc) => createDocument(doc, { title: 'Notes', id: 'tab00001', body: schemaFor().nodeFromJSON(SEED) }));
  const handles = { a: openMemoryHandle(host), b: openMemoryHandle(host) };
  await Promise.all([whenSynced(handles.a), whenSynced(handles.b)]);
  return { host, handles };
}

function closeWorld(world: World): void {
  world.handles.a.close();
  world.handles.b.close();
  world.host.destroy();
}

function endOf(editor: Editor, id: string): number {
  let at = -1;
  editor.state.doc.forEach((node, offset) => {
    if (node.attrs.id === id && node.isTextblock) at = offset + 1 + node.content.size;
  });
  if (at < 0) throw new Error(`no block ${id}`);
  return at;
}

export function DocumentHarness() {
  const [generation, setGeneration] = useState(1); // a reset opens the next one
  const [world, setWorld] = useState<World | null>(null);
  const [editors, setEditors] = useState<Partial<Record<Replica, Editor | null>>>({});
  const hosts = useMemo(
    () => ({
      a: memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' }),
      b: memoryEditorHost({ actor: { kind: 'human' }, name: 'Collaborator', color: '--author-4' }),
    }),
    [],
  );

  useEffect(() => {
    let live = true;
    let opened: World | null = null;
    void openWorld().then((w) => {
      if (live) setWorld((opened = w));
      else closeWorld(w);
    });
    return () => {
      live = false;
      if (opened) closeWorld(opened);
    };
  }, [generation]);

  useEffect(() => registerCommentComposer(openComment), []);
  const commentsA = useDocumentComments({ artifactId: 'harness-doc', appSessionId: COMMENT_SESSION, title: TITLE });
  const commentsB = useDocumentComments({ artifactId: 'harness-doc', appSessionId: COMMENT_SESSION, title: TITLE });

  const onEditorA = useCallback((editor: Editor | null) => setEditors((all) => ({ ...all, a: editor })), []);
  const onEditorB = useCallback((editor: Editor | null) => setEditors((all) => ({ ...all, b: editor })), []);

  useEffect(() => {
    let typing: { timer: ReturnType<typeof setInterval>; typed: string } | null = null;
    const editorOf = (replica: Replica) => {
      const editor = editors[replica];
      if (!editor) throw new Error(`replica ${replica} has no editor`);
      return editor;
    };
    const api: DocumentHarnessApi = {
      ready: () =>
        world !== null && !!editors.a && !!editors.b && editors.a.getText().length > 0 && editors.b.getText().length > 0,
      generation: () => generation,
      reset: () => {
        setEditors({});
        setWorld(null);
        setGeneration(generation + 1);
      },
      json: (replica) => editorOf(replica).getJSON(),
      hostJson: (tabId) => {
        if (!world) return null;
        const id = tabId ?? listTabs(world.host.doc)[0]?.id;
        const body = id ? tabBody(world.host.doc, id) : undefined;
        return body ? ynodeToPmnode(body, schemaFor()).toJSON() : null;
      },
      blockText: (replica, id) => {
        let text: string | null = null;
        editorOf(replica).state.doc.forEach((node) => {
          if (node.attrs.id === id) text = node.textContent;
        });
        return text;
      },
      selectText: (replica, id, text) => {
        const editor = editorOf(replica);
        let from = -1;
        editor.state.doc.forEach((node, offset) => {
          const at = node.attrs.id === id && node.isTextblock ? node.textContent.indexOf(text) : -1;
          if (at >= 0) from = offset + 1 + at;
        });
        if (from < 0) throw new Error(`no "${text}" in block ${id}`);
        editor.commands.setTextSelection({ from, to: from + text.length });
        editor.view.focus();
      },
      threads: () =>
        world === null
          ? []
          : listThreads(world.host.doc).map(({ id, status, quote, messages }) => ({ id, status, quote, messages: messages.map((message) => message.body) })),
      caretAtEnd: (replica, id) => {
        const editor = editorOf(replica);
        return placeCaret(editor, endOf(editor, id));
      },
      newLineAtEnd: (replica) => {
        const editor = editorOf(replica);
        editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph' });
        return placeCaret(editor, editor.state.doc.content.size - 1);
      },
      startRemoteTyping: (id, text, everyMs) => {
        if (typing) clearInterval(typing.timer);
        const state: { timer: ReturnType<typeof setInterval>; typed: string } = {
          typed: '',
          timer: setInterval(() => {
            const editor = editors.b;
            if (!editor || editor.isDestroyed) return;
            const char = text[state.typed.length % text.length];
            editor.commands.insertContentAt(endOf(editor, id), char);
            state.typed += char;
          }, everyMs),
        };
        typing = state;
      },
      stopRemoteTyping: () => {
        if (!typing) return '';
        clearInterval(typing.timer);
        const { typed } = typing;
        typing = null;
        return typed;
      },
    };
    window.__maws_document = api;
    return () => {
      if (typing) clearInterval(typing.timer);
      if (window.__maws_document === api) delete window.__maws_document;
    };
  }, [world, editors, generation]);

  if (!world) return <div className="p-4 text-fg-muted">Opening the document…</div>;
  return (
    <div className="grid h-full grid-cols-2 divide-x divide-border">
      <section aria-label="Replica A" data-replica="a" className="min-h-0">
        <DocumentEditor artifactId="harness-doc" handle={world.handles.a} host={hosts.a} onEditor={onEditorA} comments={commentsA} />
      </section>
      <section aria-label="Replica B" data-replica="b" className="min-h-0">
        <DocumentEditor artifactId="harness-doc" handle={world.handles.b} host={hosts.b} onEditor={onEditorB} comments={commentsB} />
      </section>
    </div>
  );
}
