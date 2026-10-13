// The `collaboration` extension in real Tiptap editors bound to replicas of one host doc over real ports (happy-dom; M3
// of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): convergence, undo scoped to the local binding, history mode's
// refusals, the UndoManager cleared by a restore, the composition hold, the caret following its block's id, and a
// remote write that writes nothing back.
import { afterEach, describe, expect, it } from 'vitest';
import { onUpdate, type Node as YType } from '../../yjs';
import { YNode, newDocGcOff } from '../../yjs/document';
import { pmnodeToDelta, ynodeToPmnode } from '../../yjs/prosemirror';
import { applyV2, stateV2 } from '../../yjs';
import { schemaFor } from '../schema';
import { tabBody } from '../tabs';
import { TAB, World, blocks, doc, endOf, para, ticks, until } from './test-world';

let world: World | null = null;
afterEach(() => {
  world?.destroy();
  world = null;
});

const text = (body: YType) => ynodeToPmnode(body, schemaFor()).textContent;
const composition = (type: 'compositionstart' | 'compositionend') => new Event(type, { bubbles: true });

describe('the live binding', () => {
  it('converges two editors after typing on both', async () => {
    world = new World(doc(para('p1', 'one'), para('p2', 'two')));
    const a = await world.replica('a');
    const b = await world.replica('b');
    a.editor.chain().insertContentAt(endOf(a.editor, 'p1'), ' from a').run();
    b.editor.chain().insertContentAt(endOf(b.editor, 'p2'), ' from b').run();
    await until(() => a.editor.getText() === b.editor.getText() && a.editor.getText().includes('from b') && b.editor.getText().includes('from a'), 'convergence');
    expect(blocks(a.editor)).toEqual([
      ['p1', 'one from a'],
      ['p2', 'two from b'],
    ]);
    expect(text(tabBody(world.host.doc, TAB)!)).toBe('one from atwo from b');
  });

  it('undoes this replica’s change and never the other’s', async () => {
    world = new World(doc(para('p1', 'one'), para('p2', 'two')));
    const a = await world.replica('a');
    const b = await world.replica('b');
    a.editor.chain().insertContentAt(endOf(a.editor, 'p1'), ' mine').run();
    b.editor.chain().insertContentAt(endOf(b.editor, 'p2'), ' theirs').run();
    await until(() => a.editor.getText().includes('theirs'), 'b’s change at a');
    expect(a.editor.commands.undo()).toBe(true);
    await until(() => b.editor.getText() === a.editor.getText(), 'the undo at b');
    expect(blocks(a.editor)).toEqual([
      ['p1', 'one'],
      ['p2', 'two theirs'],
    ]);
  });

  it('writes nothing back for a remote write: no ids minted, no repair run', async () => {
    world = new World(doc(para('p1', 'one')));
    const a = await world.replica('a');
    let local = 0;
    onUpdate(a.handle.doc, (_update, origin) => {
      if (origin !== (a.handle as unknown as { provider: unknown }).provider) local += 1;
    });
    // an id-less heading last: UniqueID would id it and the trailing-node rule would add a paragraph after it, were
    // either to answer the binding's own transaction
    world.host.write((d) => {
      const body = tabBody(d, TAB)!;
      const heading = schemaFor().nodes.heading.create({ level: 2 }, schemaFor().text('arrived'));
      body.insert(body.length, [YNode.from(pmnodeToDelta(heading))]);
    });
    await until(() => a.editor.getText().includes('arrived'), 'the remote heading');
    await ticks();
    expect(local).toBe(0);
    expect(blocks(a.editor)).toEqual([
      ['p1', 'one'],
      [null, 'arrived'],
    ]);
  });
});

describe('history mode', () => {
  it('shows a version read-only, refuses undo and local edits, and leaves for the live fragment', async () => {
    world = new World(doc(para('p1', 'before')));
    const a = await world.replica('a');
    const version = newDocGcOff();
    applyV2(version, stateV2(a.handle.doc));
    a.editor.chain().insertContentAt(endOf(a.editor, 'p1'), ' and after').run();
    const live = stateV2(a.handle.doc);

    expect(a.editor.commands.showVersion({ ytype: tabBody(version, TAB)!, renderer: null })).toBe(true);
    expect(a.editor.getText()).toBe('before');
    expect(a.editor.isEditable).toBe(false);
    expect(a.editor.can().undo()).toBe(false);
    expect(a.editor.commands.undo()).toBe(false);
    a.editor.commands.insertContentAt(1, 'typed in history ');
    expect(a.editor.getText()).toBe('before');
    expect(text(tabBody(version, TAB)!)).toBe('before');
    expect(stateV2(a.handle.doc)).toEqual(live);

    expect(a.editor.commands.leaveHistory()).toBe(true);
    expect(a.editor.getText()).toBe('before and after');
    expect(a.editor.isEditable).toBe(true);
    expect(a.editor.can().undo()).toBe(true);
    version.destroy();
  });

  it('clears the undo history when a restore lands', async () => {
    world = new World(doc(para('p1', 'one')));
    const a = await world.replica('a');
    a.editor.chain().insertContentAt(endOf(a.editor, 'p1'), ' typed').run();
    expect(a.editor.can().undo()).toBe(true);
    // acked first: the provider takes a `restored` that directly follows its first step 2 for the one the opened
    // document already reflects (A's Decision Log 16)
    await until(() => a.handle.state().unsaved === 0, 'the typing to be durable');
    world.host.announceRestored(7);
    await until(() => !a.editor.can().undo(), 'the undo history to clear');
    expect(a.editor.getText()).toBe('one typed');
  });
});

describe('the composition hold', () => {
  it('holds remote updates through a composition and applies them as one merged update after it', async () => {
    world = new World(doc(para('p1', 'mine'), para('p2', 'theirs')));
    const a = await world.replica('a');
    const b = await world.replica('b');
    const provider = (a.handle as unknown as { provider: unknown }).provider;
    let remote = 0;
    onUpdate(a.handle.doc, (_update, origin) => {
      if (origin === provider) remote += 1;
    });

    a.editor.commands.setTextSelection(endOf(a.editor, 'p1'));
    a.editor.view.dom.dispatchEvent(composition('compositionstart'));
    b.editor.chain().insertContentAt(endOf(b.editor, 'p2'), ' one').run();
    b.editor.chain().insertContentAt(endOf(b.editor, 'p2'), ' two').run();
    await until(() => text(tabBody(world!.host.doc, TAB)!).endsWith('theirs one two'), 'b’s updates at the host');
    await ticks();
    expect(remote).toBe(0);
    expect(a.editor.getText()).not.toContain('one');

    a.editor.view.dom.dispatchEvent(composition('compositionend'));
    await until(() => a.editor.getText().includes('theirs one two'), 'the held updates at a');
    expect(remote).toBe(1);
  });
});

describe('the caret', () => {
  it('follows its block’s id across a remote move', async () => {
    world = new World(doc(para('p1', 'alpha'), para('p2', 'beta'), para('p3', 'gamma')));
    const a = await world.replica('a');
    a.editor.commands.setTextSelection(endOf(a.editor, 'p2') - 2); // be|ta
    // a move as the writer makes one: the block's node re-inserted with its id after p3, the original deleted
    world.host.write((d) => {
      const body = tabBody(d, TAB)!;
      const moved = ynodeToPmnode(body, schemaFor()).child(1);
      body.insert(3, [YNode.from(pmnodeToDelta(moved))]);
      body.delete(1, 1);
    });
    await until(() => blocks(a.editor).map(([id]) => id).join() === 'p1,p3,p2', 'the move at a');
    const { $head } = a.editor.state.selection;
    expect([$head.parent.attrs.id, $head.parentOffset]).toEqual(['p2', 2]);
    a.editor.commands.insertContent('X');
    expect(blocks(a.editor)[2]).toEqual(['p2', 'beXta']);
  });
});
