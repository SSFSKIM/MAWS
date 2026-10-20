// Who activates a thread (P4-B1; the P4 spec §4.3 [binding]: only the human; the prior art's activation table and
// R3): the local caret moving into a passage draws its thread active with the cause `caret`, leaving it by the keyboard
// keeps it (LC-1 item 5 re-bases), a click on plain text clears it (the editor's click, as before); a remote edit, a
// remote reply or a remote resolve never changes this editor's active thread; Docs' chords (⌃⌘ N then C, P then C, E
// then C) go to the next and previous passage after the caret and enter the current one.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reply, resolve } from '../../threads';
import { TAB, World, ticks } from '../test-world';
import type { DocumentHandle } from '../host-types';
import { activeThread, Comments, commentSelection, type ActivationCause } from './plugins';
import { agentActor, findPos, now, owner, seedJSON, select } from './test-support';

let world: World | null = null;
afterEach(() => {
  world?.destroy();
  world = null;
});

interface Built {
  A: { editor: Editor; handle: DocumentHandle };
  B: { editor: Editor; handle: DocumentHandle };
  agent: DocumentHandle;
  activated: Array<[string, ActivationCause]>;
  entered: string[];
}

// A's editor reports activations and chords; B's is the other replica; t1 on p1 ("ships quarterly with design review"),
// t3 on p2 ("keeps going"), written from A.
async function build(): Promise<Built> {
  world = new World(seedJSON());
  const activated: Array<[string, ActivationCause]> = [];
  const entered: string[] = [];
  const A = await world.replica('a', (handle) => [Comments.configure({ doc: handle.doc, tabId: TAB, onActivate: (id, cause) => activated.push([id, cause]), onEnter: (id) => entered.push(id) })]);
  const B = await world.replica('b', (handle) => [Comments.configure({ doc: handle.doc, tabId: TAB })]);
  const agent = await world.bare();
  for (const [id, needle, body] of [
    ['t1', 'ships quarterly with design review', 'Should this be monthly?'],
    ['t3', 'keeps going', 'Too vague.'],
  ] as const) {
    select(A.editor, needle);
    commentSelection(A.editor, A.handle.doc, { threadId: id, tabId: TAB, by: owner, at: now(), body });
  }
  A.editor.commands.setActiveThread(null);
  await ticks(5);
  activated.length = 0;
  return { A, B, agent, activated, entered };
}

const caretTo = (editor: Editor, pos: number) => editor.view.dispatch(editor.state.tr.setSelection(editor.state.selection.constructor.near(editor.state.doc.resolve(pos))));
// A chord as the keyboard sends it (Tiptap's `keyboardShortcut` command captures the handler's transaction and replays
// its steps alone, dropping a selection and a meta, so it cannot drive a chord that sets the active thread); `Mod` is
// Ctrl off a Mac, where this suite runs, so ⌃⌘ is one ctrlKey here. Answers whether the editor took it.
const chord = (editor: Editor, key: string): boolean => {
  const event = new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, metaKey: /Mac/.test(navigator.platform), bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('the local caret', () => {
  it('moving into a passage activates its thread with the cause caret; leaving it by the keyboard keeps the thread', async () => {
    const { A, activated } = await build();
    expect(activeThread(A.editor.state)).toBeNull();
    caretTo(A.editor, findPos(A.editor, 'quarterly') + 2);
    expect(activeThread(A.editor.state)).toBe('t1');
    expect(activated).toEqual([['t1', 'caret']]);
    caretTo(A.editor, findPos(A.editor, 'Owners') + 1); // out of the passage, in the same paragraph
    expect(activeThread(A.editor.state)).toBe('t1');
    expect(activated).toHaveLength(1);
    caretTo(A.editor, findPos(A.editor, 'going') + 1);
    expect(activeThread(A.editor.state)).toBe('t3');
    expect(activated).toEqual([
      ['t1', 'caret'],
      ['t3', 'caret'],
    ]);
  });

  it('a selection that is not a caret activates nothing, and a caret in a resolved passage activates nothing', async () => {
    const { A, activated } = await build();
    select(A.editor, 'ships quarterly');
    expect(activeThread(A.editor.state)).toBeNull();
    resolve(A.handle.doc, 't1', owner, now(), 'test');
    await ticks(5);
    caretTo(A.editor, findPos(A.editor, 'quarterly') + 2);
    expect(activeThread(A.editor.state)).toBeNull();
    expect(activated).toEqual([]);
  });
});

describe('only the human activates', () => {
  it('a remote edit, a remote reply and a remote resolve of another thread never change this editor’s active thread', async () => {
    const { A, B, agent, activated } = await build();
    caretTo(A.editor, findPos(A.editor, 'going') + 1);
    expect(activeThread(A.editor.state)).toBe('t3');
    // B types into t1's passage (a remote edit through the binding)
    B.editor.commands.setTextSelection(findPos(B.editor, 'quarterly'));
    B.editor.view.dispatch(B.editor.state.tr.insertText('very '));
    await ticks(10);
    expect(A.editor.getText()).toContain('very quarterly');
    expect(activeThread(A.editor.state)).toBe('t3');
    // the agent replies to t1 and resolves it (threads-map changes, no transaction of A's)
    reply(agent.doc, 't1', { id: 't1:m1', by: agentActor, at: now(), body: 'Monthly.' }, 'agent');
    await ticks(10);
    expect(activeThread(A.editor.state)).toBe('t3');
    resolve(agent.doc, 't1', agentActor, now(), 'agent');
    await ticks(10);
    expect(activeThread(A.editor.state)).toBe('t3');
    // B's own caret moving into t3's passage is B's activation, not A's
    caretTo(B.editor, findPos(B.editor, 'going') + 1);
    await ticks(5);
    expect(activeThread(B.editor.state)).toBe('t3');
    expect(activated).toEqual([['t3', 'caret']]); // A was told once, of its own caret
  });
});

describe('the chords', () => {
  it('⌃⌘ N then C goes to the next passage after the caret, P then C to the previous, E then C enters the current one', async () => {
    const { A, activated, entered } = await build();
    caretTo(A.editor, findPos(A.editor, 'The plan'));
    expect(chord(A.editor, 'n')).toBe(true);
    expect(chord(A.editor, 'c')).toBe(true);
    expect(activeThread(A.editor.state)).toBe('t1');
    expect(A.editor.state.selection.from).toBe(findPos(A.editor, 'ships quarterly'));
    chord(A.editor, 'n');
    chord(A.editor, 'c');
    expect(activeThread(A.editor.state)).toBe('t3');
    chord(A.editor, 'p');
    chord(A.editor, 'c');
    expect(activeThread(A.editor.state)).toBe('t1');
    expect(activated.map(([id, cause]) => `${id}:${cause}`)).toEqual(['t1:key', 't3:key', 't1:key']);
    chord(A.editor, 'e');
    chord(A.editor, 'c');
    expect(entered).toEqual(['t1']);
    // the second key alone, or after the window, does nothing
    expect(chord(A.editor, 'c')).toBe(false);
    vi.useFakeTimers();
    try {
      chord(A.editor, 'n');
      vi.setSystemTime(Date.now() + 2_000);
      expect(chord(A.editor, 'c')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    expect(activeThread(A.editor.state)).toBe('t1');
  });
});
