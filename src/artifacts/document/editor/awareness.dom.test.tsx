// Awareness in DocumentEditor (M5 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D11; happy-dom over the
// in-memory host, awareness relayed between real ports): the agent's editing blocks outlined in its colour with its name
// while its presence names them, cleared when the presence drops them or goes; the agent's cursor drawn in its own
// name and colour from A's presence shape; a person's cursor from the binding's.
import type { Editor } from '@tiptap/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRelativePositionFromTypeIndex, relativePositionToJSON } from '../../yjs/document';
import { tabBody } from '../tabs';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle } from './host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import { TAB, World, doc, para, until } from './test-world';

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
