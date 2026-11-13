// The editor's repairs through the real store (docs/doperpowers/plans/2026-11-12-ux-wave-U10a-unmade-writes.md, M2;
// sequence S2 and the gap caret, S4): the engine host's DocumentService over SQLite, a document a session made that ends
// with a chart, DocumentEditor mounted on a replica that reaches the service through a PortProvider and a real port
// (`service.attach`, as `service.replica` attaches its own), and a second replica beside it. After each checkpoint the
// test waits for the commit and reads `artifact_updates` from the store's file: looking writes no row; the person's
// first change is one row of theirs, holding the change and the editor's trailing paragraph; a key typed at the gap
// caret after the chart is one row of theirs that keeps the chart. Lives here because the `renderer` project runs this
// directory's `*.dom.test.tsx` under happy-dom, with `node:sqlite` and `node:worker_threads`.
import { MessageChannel } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { Editor, JSONContent } from '@tiptap/core';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { TextSelection } from '@tiptap/pm/state';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PortProvider, type PortLike } from '@artifacts/provider/port';
import { applyV1, applyV2, newDoc, stateV2, type Doc } from '@artifacts/yjs';
import { YNode } from '@artifacts/yjs/document';
import { pmnodeToDelta, ynodeToPmnode } from '@artifacts/yjs/prosemirror';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument, tabBody } from '@artifacts/document/tabs';
import { DocumentEditor } from '@artifacts/document/editor/DocumentEditor';
import type { DocumentHandle } from '@artifacts/document/editor/host-types';
import { memoryEditorHost } from '@artifacts/document/editor/memory-host';
import { ticks } from '@artifacts/document/editor/test-world';
import { HUMAN, openDocumentWorld, sessionActor, type DocumentWorld } from '../../engine-host/documents/kinds/document-world.fixture';
import { fromNodePort } from '../../engine-host/documents/ports';

const TAB = 't1';
const AGENT = sessionActor('app-agent');
const para = (id: string, text: string): JSONContent => ({ type: 'paragraph', attrs: { id }, content: text ? [{ type: 'text', text }] : [] });
const chart = (id: string): JSONContent => ({ type: 'chart', attrs: { id, source: 'sales', spec: null } });

/** Polls `check` across macrotasks until it holds or 5 s pass (a commit and two ports lie between). */
async function until(check: () => boolean, what: string): Promise<void> {
  const give = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > give) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

let world: DocumentWorld | null = null;
let handles: DocumentHandle[] = [];
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  handles = [];
  world?.close();
  world = null;
});

/** A document a session made, holding `blocks` in its one tab. */
async function made(...blocks: JSONContent[]): Promise<string> {
  world = openDocumentWorld();
  const body = schemaFor().nodeFromJSON({ type: 'doc', content: blocks });
  const artifact = await world.store.create({ kind: 'document', title: 'Memo', initial: (d: Doc) => void createDocument(d, { title: 'Main', id: TAB, body }) }, AGENT);
  return artifact.id;
}

/** A person's replica of `id`: a PortProvider on a real port the service attached, as an open editor's is. */
async function replica(id: string): Promise<DocumentHandle & { provider: PortProvider }> {
  const { port1, port2 } = new MessageChannel();
  world!.service.attach(id, fromNodePort(port1), HUMAN);
  const doc = newDoc();
  const provider = new PortProvider(doc, { log: () => {} });
  provider.connect(port2 as unknown as PortLike);
  const handle = {
    provider,
    doc,
    awareness: provider.awareness,
    state: () => ({ ...provider.state, readOnly: false }),
    subscribe: (listener: Parameters<DocumentHandle['subscribe']>[0]) => provider.subscribe((state) => listener({ ...state, readOnly: false })),
    onRestored: (listener: Parameters<DocumentHandle['onRestored']>[0]) => provider.onRestored(listener),
    onProvisional: (listener: Parameters<DocumentHandle['onProvisional']>[0]) => provider.onProvisional(listener),
    holdRemote: (on: boolean) => provider.holdRemote(on),
    close: () => provider.destroy(),
  };
  handles.push(handle);
  await until(() => provider.state.synced, 'the replica to sync');
  return handle;
}

async function mounted(id: string) {
  const mine = await replica(id);
  let editor: Editor | null = null;
  const view = render(<DocumentEditor artifactId={id} handle={mine} host={memoryEditorHost({ actor: HUMAN, name: 'Owner', color: '--author-2' })} onEditor={(e) => (editor = e)} />);
  await until(() => editor !== null && editor.state.doc.firstChild?.attrs.id === 'p1', 'the editor to bind');
  const second = await replica(id);
  await ticks(30);
  return { mine, second, container: view.container, editor: () => editor! };
}

/** The committed rows of `id`, read from the store's file. */
async function rows(id: string): Promise<Array<{ seq: number; actor: string; bytes: Uint8Array }>> {
  await world!.service.whenCommitted();
  const db = new DatabaseSync(join(world!.dir, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT seq, actor, bytes FROM artifact_updates WHERE artifactId = ? ORDER BY seq').all(id) as Array<{ seq: number; actor: string; bytes: Uint8Array }>;
  } finally {
    db.close();
  }
}
const actors = async (id: string) => (await rows(id)).map((row) => row.actor);
const shape = (d: Doc) => {
  const out: string[] = [];
  ynodeToPmnode(tabBody(d, TAB)!, schemaFor()).forEach((block) => out.push(`${block.type.name}:${block.textContent}`));
  return out;
};
const endOf = (editor: Editor, id: string): number => {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.attrs.id === id && node.isTextblock) at = pos + 1 + node.content.size;
    return at < 0;
  });
  return at;
};
const outlined = (container: HTMLElement) => container.querySelectorAll('[data-agent-editing]').length;
/** The agent's write: a paragraph at the top of the tab, through the session's host replica. */
const agentWritesAbove = (id: string) =>
  world!.service.writeAs(id, AGENT, (d) => void tabBody(d, TAB)!.insert(0, [YNode.from(pmnodeToDelta(schemaFor().nodeFromJSON(para('p0', 'From the agent.'))))]));

describe('the editor’s repairs through the store', () => {
  it('write no row for an open, a presence redraw, a focus or a caret; the first change is one row holding the paragraph', async () => {
    const id = await made(para('p1', 'Quarterly sales.'), chart('c1'));
    const { mine, second, container, editor } = await mounted(id);
    expect(await actors(id), 'the open').toEqual(['session:app-agent']);

    second.awareness.setLocalState({ name: 'Fix the build', color: '--author-3', editing: { blocks: ['p1'] } });
    await until(() => outlined(container) === 1, 'the other replica’s presence drawn');
    await ticks(30);
    expect(await actors(id), 'a presence redraw').toEqual(['session:app-agent']);
    editor().view.dom.dispatchEvent(new FocusEvent('focus'));
    editor().view.dispatch(editor().state.tr.setSelection(TextSelection.create(editor().state.doc, endOf(editor(), 'p1'))));
    await ticks(30);
    expect([await actors(id), mine.state().unsaved], 'a focus and a caret').toEqual([['session:app-agent'], 0]);

    await agentWritesAbove(id);
    await until(() => editor().state.doc.firstChild?.attrs.id === 'p0', 'the agent’s write in the editor');
    await ticks(30);
    expect(await actors(id), 'a session’s write').toEqual(['session:app-agent', 'session:app-agent']);

    const before = stateV2(world!.service.live(id));
    editor().commands.insertContentAt(endOf(editor(), 'p1'), 'y');
    await until(() => mine.state().unsaved === 0 && shape(second.doc).includes('paragraph:Quarterly sales.y'), 'the change at the second replica');
    await ticks(30);
    const after = await rows(id);
    expect(after.map((row) => row.actor)).toEqual(['session:app-agent', 'session:app-agent', 'human']);
    const replay = newDoc();
    applyV2(replay, before);
    applyV1(replay, after[2]!.bytes);
    const expected = ['paragraph:From the agent.', 'paragraph:Quarterly sales.y', 'chart:', 'paragraph:'];
    expect(shape(replay), 'the person’s row holds the change and the paragraph').toEqual(expected);
    expect([shape(world!.service.live(id)), shape(second.doc)]).toEqual([expected, expected]);

    second.awareness.setLocalState(null);
    await until(() => outlined(container) === 0, 'the presence gone');
    await ticks(30);
    expect(await actors(id), 'a redraw after it').toEqual(['session:app-agent', 'session:app-agent', 'human']);
  });

  // Sequence S2 in its order, each step's rows read from disk: a session's write leaves a chart last; a redraw; a text
  // selection; composed input and its end; the person's first plain change; a redraw after it.
  it('run sequence S2: no row but the session’s, the composition’s and one plain change holding the paragraph', async () => {
    const id = await made(para('p1', 'Quarterly sales.'));
    const { mine, second, container, editor } = await mounted(id);
    const seen = async () => (await rows(id)).map((row) => `${row.seq}:${row.actor}`);
    const opened = await seen();
    expect(opened.map((row) => row.split(':').slice(1).join(':')), 'the open').toEqual(['session:app-agent']);
    const lastEverywhere = () => [editor().state.doc.lastChild?.type.name, shape(world!.service.live(id)).at(-1), shape(second.doc).at(-1)];

    await world!.service.writeAs(id, AGENT, (d) => {
      const body = tabBody(d, TAB)!;
      body.insert(body.length, [YNode.from(pmnodeToDelta(schemaFor().nodeFromJSON(chart('c1'))))]);
    });
    await until(() => editor().state.doc.lastChild?.type.name === 'chart' && shape(second.doc).at(-1) === 'chart:', 'the session’s chart in both replicas');
    await ticks(30);
    const written = await seen();
    expect([written.length, written.at(-1)!.endsWith(':session:app-agent'), written.slice(0, -1)], 'the session’s write: its row and nothing more').toEqual([2, true, opened]);

    second.awareness.setLocalState({ name: 'Fix the build', color: '--author-3', editing: { blocks: ['p1'] } });
    await until(() => outlined(container) === 1, 'the other replica’s presence drawn');
    await ticks(30);
    expect(await seen(), 'a redraw').toEqual(written);

    editor().view.dispatch(editor().state.tr.setSelection(TextSelection.create(editor().state.doc, 1, 10))); // 'Quarterly'
    await ticks(30);
    expect([await seen(), mine.state().unsaved], 'a text selection').toEqual([written, 0]);

    editor().view.dispatch(editor().state.tr.setSelection(TextSelection.create(editor().state.doc, endOf(editor(), 'p1'))));
    editor().view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    editor().view.dispatch(editor().state.tr.insertText('한', endOf(editor(), 'p1')).setMeta('composition', 1));
    await until(() => mine.state().unsaved === 0 && shape(second.doc)[0] === 'paragraph:Quarterly sales.한', 'the composed input at the second replica');
    await ticks(30);
    const composed = await seen();
    expect([composed.length, composed.at(-1)!.endsWith(':human'), composed.slice(0, -1)], 'the composed input: its row, the person’s').toEqual([3, true, written]);
    expect(lastEverywhere(), 'no trailing paragraph during the composition').toEqual(['chart', 'chart:', 'chart:']);

    editor().view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await ticks(30);
    expect([await seen(), lastEverywhere()], 'the composition’s end').toEqual([composed, ['chart', 'chart:', 'chart:']]);

    const before = stateV2(world!.service.live(id));
    editor().commands.insertContentAt(endOf(editor(), 'p1'), '!');
    await until(() => mine.state().unsaved === 0 && shape(second.doc).at(-1) === 'paragraph:', 'the plain change at the second replica');
    await ticks(30);
    const after = await rows(id);
    expect(after.map((row) => `${row.seq}:${row.actor}`).slice(0, -1), 'exactly one row more').toEqual(composed);
    expect(after.at(-1)!.actor).toBe('human');
    const replay = newDoc();
    applyV2(replay, before);
    applyV1(replay, after.at(-1)!.bytes);
    const expected = ['paragraph:Quarterly sales.한!', 'chart:', 'paragraph:'];
    expect([shape(replay), shape(world!.service.live(id)), shape(second.doc)], 'the row holds the change and the paragraph').toEqual([expected, expected, expected]);

    second.awareness.setLocalState(null);
    await until(() => outlined(container) === 0, 'the presence gone');
    await ticks(30);
    expect((await seen()).length, 'a redraw after it').toBe(after.length);
  });

  it('take a key typed at the gap caret after the chart, past a session’s write above it, as one row that keeps the chart', async () => {
    const id = await made(para('p1', 'Quarterly sales.'), chart('c1'));
    const { mine, second, editor } = await mounted(id);
    editor().view.dispatch(editor().state.tr.setSelection(new GapCursor(editor().state.doc.resolve(editor().state.doc.content.size))));
    await ticks(30);
    expect([await actors(id), mine.state().unsaved], 'the gap caret set').toEqual([['session:app-agent'], 0]);

    await agentWritesAbove(id);
    await until(() => editor().state.doc.firstChild?.attrs.id === 'p0', 'the agent’s write in the editor');
    await ticks(30);
    const { selection } = editor().state;
    expect([selection instanceof GapCursor, selection.head === editor().state.doc.content.size], 'still at the end').toEqual([true, true]);
    expect(await actors(id)).toEqual(['session:app-agent', 'session:app-agent']);

    const before = stateV2(world!.service.live(id));
    const typed = new KeyboardEvent('keypress', { key: 'x', bubbles: true, cancelable: true });
    Object.defineProperty(typed, 'charCode', { value: 'x'.charCodeAt(0) }); // happy-dom's KeyboardEvent carries none
    editor().view.dom.dispatchEvent(typed);
    await until(() => mine.state().unsaved === 0 && shape(second.doc).includes('paragraph:x'), 'the keystroke at the second replica');
    await ticks(30);
    const after = await rows(id);
    expect(after.map((row) => row.actor)).toEqual(['session:app-agent', 'session:app-agent', 'human']);
    const replay = newDoc();
    applyV2(replay, before);
    applyV1(replay, after[2]!.bytes);
    const expected = ['paragraph:From the agent.', 'paragraph:Quarterly sales.', 'chart:', 'paragraph:x'];
    expect([shape(replay), shape(world!.service.live(id)), shape(second.doc)]).toEqual([expected, expected, expected]);
  });
});
