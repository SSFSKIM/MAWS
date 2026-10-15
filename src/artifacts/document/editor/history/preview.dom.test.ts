// The history preview in the live editor (M5 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; P3-0's S3 item 2,
// `spikes/p3-store/s3/s3-history.mjs`, in happy-dom with real Tiptap): two versions drawn in the person's own editor
// through `showVersion` with a DiffRenderer, its change count the headless count, ↓ landing on every change; undo (the
// command and Mod-Z) and typing refused while it shows; the live doc, the host and both version docs byte-unchanged;
// leaving shows the live document again, an agent's edit made meanwhile included, and typing and undo work after.
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { stateV2 } from '../../../yjs';
import { ynodeToPmnode } from '../../../yjs/prosemirror';
import { Collaboration } from '../../collab';
import { changeList, nextChange, openDiff, renderDiff } from '../../history';
import { AGENT_1, HUMAN, TAB, block, body, seededHub, textOf } from '../../history.fixture';
import { coreExtensionOptions } from '../../ids';
import { extensions, schemaFor } from '../../schema';
import { tabBody } from '../../tabs';
import { ticks, until } from '../test-world';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

async function world() {
  const hub = seededHub(6);
  const human = hub.connect(HUMAN);
  const agent = hub.connect(AGENT_1);
  const element = document.createElement('div');
  document.body.append(element);
  editor = new Editor({ element, coreExtensionOptions, extensions: [...extensions({ generateID: (() => { let n = 0; return () => `h${++n}`; })() }), Collaboration.configure({ ytype: body(human) })] });
  await until(() => editor!.getText().length > 0, 'the editor to render');
  const v0 = hub.version('V0', HUMAN);
  // the person types, the agent rewrites a sentence and adds a paragraph
  for (const ch of ' Typed here.') editor.chain().insertContentAt(endOf(editor, 's0p2'), ch).run();
  agent.transact(() => {
    const node = block(agent, 's1p2');
    node.delete(0, 5);
    node.insert(0, 'AGENT');
  });
  await ticks(3);
  const v1 = hub.version('V1', AGENT_1);
  return { hub, human, agent, v0, v1, editor };
}

function endOf(ed: Editor, id: string): number {
  let at = -1;
  ed.state.doc.descendants((node, pos) => {
    if (at < 0 && node.attrs.id === id && node.isTextblock) at = pos + 1 + node.content.size;
    return at < 0;
  });
  return at;
}

describe('the preview in the live editor', () => {
  it('draws the diff read-only, refuses undo and typing, and leaves everything byte-unchanged', async () => {
    const { hub, human, v0, v1, editor: ed } = await world();
    const diff = openDiff({ prevState: v0.state, nextState: v1.state, attributions: hub.attributions() });
    const headless = changeList(renderDiff(tabBody(diff.nextDoc, TAB)!, diff.renderer));
    const prev = stateV2(diff.prevDoc);
    const next = stateV2(diff.nextDoc);
    const live = stateV2(human);
    const host = stateV2(hub.host);
    const undoDepth = ed.storage.collaboration.undoManager!.undoStack.length;
    expect(undoDepth).toBeGreaterThan(0);

    expect(ed.commands.showVersion({ ytype: tabBody(diff.nextDoc, TAB)!, renderer: diff.renderer })).toBe(true);
    await ticks(2);
    const view = changeList(ed.state.doc);
    expect(view.map((c) => [c.from, c.to, c.who])).toEqual(headless.map((c) => [c.from, c.to, c.who]));
    expect(view.length).toBe(2); // the typing, one change; the agent's replace, one change
    expect(() => ed.state.doc.check()).not.toThrow();
    expect(ed.view.dom.querySelectorAll('y-ins').length).toBeGreaterThan(0);
    expect(ed.view.dom.querySelectorAll('y-del').length).toBeGreaterThan(0);

    // ↓ lands on every change
    const visited: number[] = [];
    for (let i = 0; i < view.length; i++) {
      const change = nextChange(view, ed.state.selection.from)!;
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(change.from + 1))));
      visited.push(change.from);
    }
    expect(new Set(visited).size).toBe(view.length);

    // undo, by command and by key, and typing: all refused
    expect(ed.commands.undo()).toBe(false);
    ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, ctrlKey: true, bubbles: true }));
    ed.commands.insertContent('X');
    await ticks(3);
    expect(ed.isEditable).toBe(false);
    expect(ed.storage.collaboration.undoManager!.undoStack.length).toBe(undoDepth);
    expect(same(stateV2(human), live)).toBe(true);
    expect(same(stateV2(hub.host), host)).toBe(true);
    expect(same(stateV2(diff.prevDoc), prev)).toBe(true);
    expect(same(stateV2(diff.nextDoc), next)).toBe(true);

    // leaving shows the live document, byte-unchanged
    expect(ed.commands.leaveHistory()).toBe(true);
    await ticks(2);
    diff.destroy();
    expect(same(stateV2(human), live)).toBe(true);
    expect(same(stateV2(hub.host), host)).toBe(true);
    expect(ed.getJSON()).toEqual(ynodeToPmnode(body(human), schemaFor()).toJSON());
  });

  it('shows on leaving an agent edit made while the person looked at history; typing and undo work after', async () => {
    const { hub, human, agent, v0, v1, editor: ed } = await world();
    const diff = openDiff({ prevState: v0.state, nextState: v1.state, attributions: hub.attributions() });
    ed.commands.showVersion({ ytype: tabBody(diff.nextDoc, TAB)!, renderer: diff.renderer });
    await ticks(2);
    agent.transact(() => block(agent, 's2p2').insert(0, 'LIVE-DURING-HISTORY '));
    await ticks(3);
    expect(ed.getText()).not.toContain('LIVE-DURING-HISTORY');

    ed.commands.leaveHistory();
    diff.destroy();
    await until(() => ed.getText().includes('LIVE-DURING-HISTORY'), 'the agent’s edit after leaving');
    ed.chain().insertContentAt(endOf(ed, 's2p1'), ' after-exit').run();
    await ticks(2);
    expect(textOf(block(hub.host, 's2p1')).endsWith(' after-exit')).toBe(true);
    ed.storage.collaboration.undoManager!.stopCapturing();
    expect(ed.commands.undo()).toBe(true);
    await ticks(2);
    expect(textOf(block(hub.host, 's2p1')).endsWith(' after-exit')).toBe(false);
    expect(textOf(block(human, 's2p2')).startsWith('LIVE-DURING-HISTORY')).toBe(true); // the agent's edit is not undone
  });
});
