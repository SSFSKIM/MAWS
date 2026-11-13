// Awareness in DocumentEditor (M5 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D11; happy-dom over the
// in-memory host, awareness relayed between real ports): the agent's editing blocks outlined in its colour with its name
// while its presence names them, cleared when the presence drops them or goes; the agent's cursor drawn in its own
// name and colour from A's presence shape; a person's cursor from the binding's. And (X-141) a presence redraw, or any
// other look at a document whose last block is no paragraph, writes nothing; the person's first change writes once.
import type { Editor, JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyV1, applyV2, newDoc, onUpdate, stateV2, type Doc } from '../../yjs';
import { YNode, createRelativePositionFromTypeIndex, relativePositionToJSON } from '../../yjs/document';
import { pmnodeToDelta, ynodeToPmnode } from '../../yjs/prosemirror';
import { schemaFor } from '../schema';
import { tabBody } from '../tabs';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle } from './host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced, type Landed } from './memory-host';
import { TAB, World, doc, endOf, para, ticks, until } from './test-world';

let world: World | null = null;
let handles: DocumentHandle[] = [];
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  handles = [];
  world?.destroy();
  world = null;
});

async function mount() {
  world = new World(doc(para('p1', 'The owner writes here.'), para('p2', 'The agent rewrites this sentence.'), para('p3', 'A third paragraph.')));
  const open = async () => {
    const handle = openMemoryHandle(world!.host, { log: () => {} });
    handles.push(handle);
    await whenSynced(handle);
    return handle;
  };
  const handle = await open();
  const agent = await open();
  let editor: Editor | null = null;
  const view = render(<DocumentEditor artifactId="doc1" handle={handle} host={memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' })} onEditor={(e) => (editor = e)} />);
  await until(() => editor !== null && editor.getText().length > 0, 'the editor to bind');
  return { agent, container: view.container, editor: () => editor! };
}

const outlined = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-agent-editing]')];

describe('the agent’s presence', () => {
  // M9 (the scale gate's keystroke → frame): the person's keystroke maps the outline; only the others' awareness or a
  // remote change (an agent's blocks arriving) redraws it, which walks the whole document (1,455 blocks at 200 pages).
  it('maps the outline through the person’s own typing instead of redrawing it', async () => {
    const { agent, container, editor } = await mount();
    agent.awareness.setLocalState({ name: 'Fix the build', color: '--author-3', editing: { blocks: ['p1'] } });
    await until(() => outlined(container).length === 1, 'the editing outline');
    const key = editor().state.plugins.find((plugin) => (plugin as unknown as { key: string }).key.startsWith('agentEditing'))!;
    const before = (key.getState(editor().state) as { find(): unknown[] }).find();
    editor().commands.insertContentAt(editor().state.doc.content.size - 1, 'X'); // typed in p3, after the outlined p1
    const after = (key.getState(editor().state) as { find(): unknown[] }).find();
    expect(after).toHaveLength(1);
    expect((after[0] as { type: unknown }).type, 'the same decoration, mapped').toBe((before[0] as { type: unknown }).type);
  });

  it('outlines the blocks it is editing in its colour, labelled with its name, and clears them when it drops them', async () => {
    const { agent, container } = await mount();
    agent.awareness.setLocalState({ name: 'Fix the build', color: '--author-3', editing: { blocks: ['p2'] } });
    await until(() => outlined(container).length === 1, 'the editing outline');
    const [block] = outlined(container);
    expect(block.textContent).toBe('The agent rewrites this sentence.');
    expect(block.dataset.agentEditing).toBe('Fix the build');
    expect(block.style.getPropertyValue('--doc-presence')).toBe('var(--author-3)');

    agent.awareness.setLocalState({ name: 'Fix the build', color: '--author-3', editing: { blocks: ['p1', 'p3'] } });
    await until(() => outlined(container).map((el) => el.textContent).join('|') === 'The owner writes here.|A third paragraph.', 'the outline to move');

    agent.awareness.setLocalState({ name: 'Fix the build', color: '--author-3' }); // the batch committed: nothing edited
    await until(() => outlined(container).length === 0, 'the outline to clear');
    agent.awareness.setLocalState({ name: 'Fix the build', color: '--author-3', editing: { blocks: ['p2'] } });
    await until(() => outlined(container).length === 1, 'the outline again');
    agent.awareness.setLocalState(null); // the replica closed
    await until(() => outlined(container).length === 0, 'the outline to clear when the presence goes');
  });

  it('draws the agent’s cursor in its name and colour', async () => {
    const { agent, container } = await mount();
    const at = relativePositionToJSON(createRelativePositionFromTypeIndex(tabBody(agent.doc, TAB)!.get(1) as never, 4));
    agent.awareness.setLocalState({ name: 'Fix the build', color: '--author-3', cursor: { anchor: at, head: at } });
    await until(() => container.querySelector('.ProseMirror-yjs-cursor') !== null, 'the agent’s cursor');
    const cursor = container.querySelector<HTMLElement>('.ProseMirror-yjs-cursor')!;
    expect(cursor.textContent).toContain('Fix the build');
    expect(cursor.style.getPropertyValue('--user-color')).toBe('var(--author-3)');
  });

  it('draws a person’s cursor from the binding’s own state', async () => {
    const { agent, container } = await mount();
    const at = relativePositionToJSON(createRelativePositionFromTypeIndex(tabBody(agent.doc, TAB)!.get(0) as never, 3));
    agent.awareness.setLocalState({ user: { name: 'Collaborator', color: 'var(--author-5)' }, cursor: { anchor: at, head: at } });
    await until(() => container.querySelector('.ProseMirror-yjs-cursor') !== null, 'the person’s cursor');
    const cursor = container.querySelector<HTMLElement>('.ProseMirror-yjs-cursor')!;
    expect(cursor.textContent).toContain('Collaborator');
    expect(cursor.style.getPropertyValue('--user-color')).toBe('var(--author-5)');
  });
});

// X-141 (docs/doperpowers/plans/2026-11-12-ux-wave-U10a-unmade-writes.md, sequence S2; tracker row 354's close
// condition): a remote write leaves a block that is no paragraph last, and nothing the person does short of changing
// the content writes: not the presence redraw, a focus, a caret or a selection, a composition (its own input aside).
// The person's first change outside a composition leaves the replica as one update holding it and the trailing
// paragraph; a redraw after that writes nothing. And opening such a document writes nothing either.
describe('looking at a document whose last block is no paragraph', () => {
  const AGENT = { kind: 'session', appSessionId: 'agent' } as never;
  const chart = (id: string): JSONContent => ({ type: 'chart', attrs: { id, source: 'sales', spec: null } });
  const shape = (d: Doc) => {
    const out: string[] = [];
    ynodeToPmnode(tabBody(d, TAB)!, schemaFor()).forEach((block) => out.push(`${block.type.name}:${block.textContent}`));
    return out;
  };

  async function opened(content: JSONContent) {
    world = new World(content);
    const landed: Landed[] = [];
    world.host.onLanded((row) => landed.push(row));
    const handle = openMemoryHandle(world.host, { log: () => {} });
    handles.push(handle);
    await whenSynced(handle);
    const agent = openMemoryHandle(world.host, { log: () => {} });
    handles.push(agent);
    await whenSynced(agent);
    // what leaves the editor's replica: every update of its doc but the ones its provider applied from the host
    const sent: Uint8Array[] = [];
    onUpdate(handle.doc, (update, origin) => void (origin !== handle.provider && sent.push(update)));
    let editor: Editor | null = null;
    const view = render(<DocumentEditor artifactId="doc1" handle={handle} host={memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' })} onEditor={(e) => (editor = e)} />);
    await until(() => editor !== null && editor.getText().length > 0, 'the editor to bind');
    await ticks();
    return { handle, agent, landed, sent, container: view.container, editor: () => editor! };
  }

  it('writes nothing through a remote write, presence, a focus, a selection and a composition; the first plain change writes once', async () => {
    const { handle, agent, landed, sent, container, editor } = await opened(doc(para('p1', 'Quarterly sales.')));
    const last = () => editor().state.doc.lastChild?.type.name;
    const quiet = (what: string, rows: number) => {
      expect(sent, `${what}: nothing leaves the replica`).toEqual([]);
      expect(landed.length, `${what}: the host's revision stays`).toBe(rows);
      expect(last(), `${what}: the last block stays`).toBe('chart');
      expect(handle.state().unsaved, `${what}: nothing unsaved`).toBe(0);
    };

    world!.host.write((d) => {
      const body = tabBody(d, TAB)!;
      body.insert(body.length, [YNode.from(pmnodeToDelta(schemaFor().nodeFromJSON(chart('c1'))))]);
    }, AGENT);
    await until(() => last() === 'chart', 'the remote chart');
    await ticks();
    quiet('the remote write', 1);

    agent.awareness.setLocalState({ name: 'Fix the build', color: '--author-3', editing: { blocks: ['p1'] } });
    await until(() => outlined(container).length === 1, 'the editing outline');
    await ticks();
    quiet('the presence arriving', 1);
    agent.awareness.setLocalState(null);
    await until(() => outlined(container).length === 0, 'the outline to clear');
    await ticks();
    quiet('the presence leaving', 1);

    editor().view.dom.dispatchEvent(new FocusEvent('focus'));
    editor().view.dispatch(editor().state.tr.setSelection(TextSelection.create(editor().state.doc, endOf(editor(), 'p1'))));
    editor().view.dispatch(editor().state.tr.setSelection(TextSelection.create(editor().state.doc, 1, 10))); // text selected to copy
    await ticks();
    quiet('a focus, a caret and a selection', 1);

    editor().view.dispatch(editor().state.tr.setSelection(TextSelection.create(editor().state.doc, endOf(editor(), 'p1'))));
    editor().view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    editor().view.dispatch(editor().state.tr.insertText('한', endOf(editor(), 'p1')).setMeta('composition', 1));
    await until(() => landed.length === 2, 'the composed input at the host');
    expect([last(), shape(world!.host.doc)], 'no paragraph during the composition').toEqual(['chart', ['paragraph:Quarterly sales.한', 'chart:']]);
    editor().view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await ticks(30);
    expect([landed.length, last()], 'nothing written when the composition ends').toEqual([2, 'chart']);

    const before = stateV2(handle.doc);
    sent.length = 0;
    editor().commands.insertContentAt(endOf(editor(), 'p1'), '!');
    await until(() => landed.length === 3 && handle.state().unsaved === 0, 'the plain change at the host');
    await ticks();
    expect(sent, 'one update leaves the replica').toHaveLength(1);
    expect(landed.map((row) => row.actor.kind)).toEqual(['session', 'human', 'human']);
    const replay = newDoc();
    applyV2(replay, before);
    applyV1(replay, sent[0]!);
    expect(shape(replay), 'the update holds the change and the paragraph').toEqual(['paragraph:Quarterly sales.한!', 'chart:', 'paragraph:']);
    expect(shape(world!.host.doc)).toEqual(['paragraph:Quarterly sales.한!', 'chart:', 'paragraph:']);

    agent.awareness.setLocalState({ name: 'Fix the build', color: '--author-3', editing: { blocks: ['p1'] } });
    await until(() => outlined(container).length === 1, 'the outline again');
    await ticks();
    expect([sent.length, landed.length], 'a redraw after it writes nothing').toEqual([1, 3]);
  });

  it('writes nothing at the open of a document that ends with a table, until the person’s first change', async () => {
    const table: JSONContent = { type: 'table', attrs: { id: 'tb' }, content: [{ type: 'tableRow', attrs: { id: 'tbr' }, content: [{ type: 'tableCell', attrs: { id: 'tbc' }, content: [para('tbp', 'A cell.')] }] }] };
    const { handle, landed, sent, editor } = await opened(doc(para('p1', 'Quarterly sales.'), table));
    await ticks(30); // the undo manager's swap into the binding, a microtask after the mount, among them
    expect([sent.length, landed.length, handle.state().unsaved, editor().state.doc.lastChild?.type.name]).toEqual([0, 0, 0, 'table']);
    editor().commands.insertContentAt(endOf(editor(), 'p1'), '!');
    await until(() => landed.length === 1 && handle.state().unsaved === 0, 'the change at the host');
    await ticks();
    expect(sent).toHaveLength(1);
    expect(shape(world!.host.doc)).toEqual(['paragraph:Quarterly sales.!', 'table:A cell.', 'paragraph:']);
  });
});
