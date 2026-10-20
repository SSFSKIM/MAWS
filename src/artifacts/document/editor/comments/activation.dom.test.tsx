// Who activates a thread (P4-B1; the P4 spec §4.3 [binding]: only the human; the prior art's activation table and
// R3): the local caret moving into a passage draws its thread active with the cause `caret`, leaving it by the keyboard
// keeps it (LC-1 item 5 re-bases), a click on plain text clears it (the editor's click, as before); a remote edit, a
// remote reply or a remote resolve never changes this editor's active thread; Docs' chords (⌃⌘ N then C, P then C, E
// then C) go to the next and previous passage after the caret and enter the current one. The pin (Docs' sticky stack,
// LC-1 item 3 in docs/doperpowers/evidence/p4/lc1/lc1-docs-margin.md): the last thread the human activated, kept when
// the active thread clears, cleared when that thread resolves; a click on a passage puts the caret at the click.
import type { Editor } from '@tiptap/core';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reply, resolve } from '../../threads';
import { TAB, World, ticks } from '../test-world';
import type { DocumentHandle } from '../host-types';
import { activeThread, Comments, commentSelection, pinnedThread, type ActivationCause } from './plugins';
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

// A click as ProseMirror hands it to its plugins (editor.dom.test.tsx's): at a text position, its target the element
// drawn there (happy-dom has no layout, so ProseMirror's own mouse handling cannot place it).
function clickAt(editor: Editor, pos: number, init: MouseEventInit = {}): void {
  const { node } = editor.view.domAtPos(pos);
  const target = node.nodeType === Node.TEXT_NODE ? node.parentElement! : (node as Element);
  let event: MouseEvent | null = null;
  target.addEventListener('click', (e) => void (event = e as MouseEvent), { once: true });
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  editor.view.someProp('handleClick', (handle) => handle(editor.view, pos, event!));
}
const caretTo = (editor: Editor, pos: number) => editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(pos))));
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

describe('a click on a passage', () => {
  // Surprise 7: ProseMirror calls handleClick from its mouseup, and the activation's redraw of the passage could write
  // the stale state selection back over the native caret; the activation itself puts the caret at the click
  it('puts the caret at the click and activates the passage, even when its thread is already active; a right-click and a ctrl-click leave the selection alone', async () => {
    const { A, activated } = await build();
    caretTo(A.editor, findPos(A.editor, 'The plan'));
    const at = findPos(A.editor, 'quarterly') + 3;
    clickAt(A.editor, at);
    expect(activeThread(A.editor.state)).toBe('t1');
    expect(A.editor.state.selection.empty).toBe(true);
    expect(A.editor.state.selection.from).toBe(at);
    expect(activated).toEqual([['t1', 'click']]);
    // the thread already active: the caret still moves
    const again = findPos(A.editor, 'design review') + 2;
    clickAt(A.editor, again);
    expect(A.editor.state.selection.from).toBe(again);
    // a right-click and macOS's Ctrl-click open a context menu (ProseMirror's mouseup hands them to handleClick too):
    // the selection under it stays, the passage still activates
    const selected = { from: findPos(A.editor, 'Owners'), to: findPos(A.editor, 'Owners') + 4 };
    A.editor.view.dispatch(A.editor.state.tr.setSelection(TextSelection.create(A.editor.state.doc, selected.from, selected.to)));
    const before = A.editor.state.selection;
    clickAt(A.editor, findPos(A.editor, 'going') + 2, { button: 2 });
    expect(activeThread(A.editor.state)).toBe('t3');
    expect(A.editor.state.selection.eq(before)).toBe(true);
    clickAt(A.editor, findPos(A.editor, 'quarterly') + 2, { ctrlKey: true });
    expect(activeThread(A.editor.state)).toBe('t1');
    expect(A.editor.state.selection.eq(before)).toBe(true);
    expect(activated.slice(-2)).toEqual([['t3', 'click'], ['t1', 'click']]);
  });
});

describe('the pin (D2 as Docs: the stack stays where the last activation left it)', () => {
  it('a click activates and pins; a click on plain text clears the active thread and keeps the pin', async () => {
    const { A } = await build();
    expect(pinnedThread(A.editor.state)).toBeNull();
    clickAt(A.editor, findPos(A.editor, 'quarterly') + 2);
    expect(activeThread(A.editor.state)).toBe('t1');
    expect(pinnedThread(A.editor.state)).toBe('t1');
    clickAt(A.editor, findPos(A.editor, 'Third') + 2);
    expect(activeThread(A.editor.state)).toBeNull();
    expect(pinnedThread(A.editor.state)).toBe('t1');
  });

  it('every human activation moves the pin (the caret, a chord, the margin’s own), and clearing the active thread keeps it', async () => {
    const { A } = await build();
    caretTo(A.editor, findPos(A.editor, 'going') + 1);
    expect(pinnedThread(A.editor.state)).toBe('t3');
    chord(A.editor, 'p'); // the previous passage before the active one
    chord(A.editor, 'c');
    expect(pinnedThread(A.editor.state)).toBe('t1');
    A.editor.commands.setActiveThread('t3'); // a card's click, J or K, the panel's item
    expect(pinnedThread(A.editor.state)).toBe('t3');
    A.editor.commands.setActiveThread(null); // Escape on a card
    expect(activeThread(A.editor.state)).toBeNull();
    expect(pinnedThread(A.editor.state)).toBe('t3');
  });

  it('a resolve of the pinned thread clears the pin; a resolve of another thread keeps it', async () => {
    const { A, agent } = await build();
    clickAt(A.editor, findPos(A.editor, 'quarterly') + 2);
    clickAt(A.editor, findPos(A.editor, 'Third') + 2);
    resolve(agent.doc, 't3', agentActor, now(), 'agent');
    await ticks(10);
    expect(pinnedThread(A.editor.state)).toBe('t1');
    resolve(A.handle.doc, 't1', owner, now(), 'test');
    await ticks(10);
    expect(pinnedThread(A.editor.state)).toBeNull();
  });

  it('only the human pins: another replica’s activation, an agent’s reply and a remote edit leave this editor’s pin', async () => {
    const { A, B, agent } = await build();
    clickAt(A.editor, findPos(A.editor, 'quarterly') + 2);
    caretTo(B.editor, findPos(B.editor, 'going') + 1);
    await ticks(5);
    expect(pinnedThread(B.editor.state)).toBe('t3');
    reply(agent.doc, 't3', { id: 't3:m1', by: agentActor, at: now(), body: 'Sharper.' }, 'agent');
    B.editor.commands.setTextSelection(findPos(B.editor, 'going'));
    B.editor.view.dispatch(B.editor.state.tr.insertText('still '));
    await ticks(10);
    expect(A.editor.getText()).toContain('still going');
    expect(activeThread(A.editor.state)).toBe('t1');
    expect(pinnedThread(A.editor.state)).toBe('t1');
  });
});
