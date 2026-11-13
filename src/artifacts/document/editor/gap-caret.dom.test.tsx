// The place to type after a final block that holds no text (docs/doperpowers/plans/2026-11-12-ux-wave-U10a-unmade-writes.md,
// decisions 9 to 11, sequence S4; happy-dom over the in-memory host): ProseMirror's gap cursor in the document editor.
// Where it is a place and where it is not, block kind by block kind; the arrows that set it from a selected final
// chart; drawn while it is the selection; kept through another replica's write; a key typed or a composition begun at
// it makes a paragraph after the block, which stays, in one update of the person's. Setting it writes nothing. Where
// a click lands needs a layout: e2e/dashboard.spec.ts holds that.
import type { Editor, JSONContent } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { onUpdate, type Doc } from '../../yjs';
import { YNode } from '../../yjs/document';
import { pmnodeToDelta, ynodeToPmnode } from '../../yjs/prosemirror';
import { schemaFor } from '../schema';
import { tabBody } from '../tabs';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle } from './host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced, type Landed } from './memory-host';
import { TAB, World, doc, para, ticks, until } from './test-world';

let world: World | null = null;
let handles: DocumentHandle[] = [];
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  handles = [];
  world?.destroy();
  world = null;
});

const AGENT = { kind: 'session', appSessionId: 'agent' } as never;
const chart = (id: string): JSONContent => ({ type: 'chart', attrs: { id, source: 'sales', spec: null } });
const table = (id: string): JSONContent => ({ type: 'table', attrs: { id }, content: [{ type: 'tableRow', attrs: { id: `${id}r` }, content: [{ type: 'tableCell', attrs: { id: `${id}c` }, content: [para(`${id}p`, 'A cell.')] }] }] });
// `valid` is the library's own test of a place (prosemirror-gapcursor 1.4.1), left out of its typings
const isGap = ($pos: ResolvedPos): boolean => (GapCursor as unknown as { valid($pos: ResolvedPos): boolean }).valid($pos);
const shape = (d: Doc) => {
  const out: string[] = [];
  ynodeToPmnode(tabBody(d, TAB)!, schemaFor()).forEach((block) => out.push(`${block.type.name}:${block.textContent}`));
  return out;
};
const shown = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.forEach((block) => out.push(`${block.type.name}:${block.textContent}`));
  return out;
};

async function opened(content: JSONContent) {
  world = new World(content);
  const landed: Landed[] = [];
  world.host.onLanded((row) => landed.push(row));
  const handle = openMemoryHandle(world.host, { log: () => {} });
  handles.push(handle);
  await whenSynced(handle);
  const sent: Uint8Array[] = [];
  onUpdate(handle.doc, (update, origin) => void (origin !== handle.provider && sent.push(update)));
  let editor: Editor | null = null;
  render(<DocumentEditor artifactId="doc1" handle={handle} host={memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' })} onEditor={(e) => (editor = e)} />);
  const first = (content.content?.[0]?.attrs as { id?: string } | undefined)?.id;
  await until(() => editor !== null && editor.state.doc.firstChild?.attrs.id === first, 'the editor to bind');
  await ticks();
  return { handle, landed, sent, editor: () => editor! };
}
const atEnd = (editor: Editor) => editor.view.dispatch(editor.state.tr.setSelection(new GapCursor(editor.state.doc.resolve(editor.state.doc.content.size))));
const isGapAtEnd = (editor: Editor) => editor.state.selection instanceof GapCursor && editor.state.selection.head === editor.state.doc.content.size;
// A key typed while the selection is no text selection: ProseMirror takes the keypress itself (prosemirror-view's
// `keypress` handler), which happy-dom's KeyboardEvent carries no `charCode` for.
function press(editor: Editor, key: string): void {
  const event = new KeyboardEvent('keypress', { key, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'charCode', { value: key.charCodeAt(0) });
  editor.view.dom.dispatchEvent(event);
}
const keydown = (editor: Editor, key: string) => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

describe('the gap caret', () => {
  it('is a place after a final block that holds no text, and none after a block with a text position of its own', () => {
    const lasts: Record<string, JSONContent> = {
      chart: chart('z'),
      table: table('z'),
      horizontalRule: { type: 'horizontalRule', attrs: { id: 'z' } },
      mathBlock: { type: 'mathBlock', attrs: { id: 'z', latex: 'x^2' } },
      diagram: { type: 'diagram', attrs: { id: 'z', source: 'graph TD; A-->B' } },
      pending: { type: 'pending', attrs: { id: 'z', intent: 'Summary' } },
      bulletList: { type: 'bulletList', attrs: { id: 'z' }, content: [{ type: 'listItem', attrs: { id: 'zi' }, content: [para('zp', 'An item.')] }] },
      heading: { type: 'heading', attrs: { id: 'z', level: 2 }, content: [{ type: 'text', text: 'Next steps' }] },
      codeBlock: { type: 'codeBlock', attrs: { id: 'z' }, content: [{ type: 'text', text: 'let x = 1;' }] },
      callout: { type: 'callout', attrs: { id: 'z' }, content: [para('zp', 'A note.')] },
      blockquote: { type: 'blockquote', attrs: { id: 'z' }, content: [para('zp', 'A quote.')] },
      paragraph: para('z', 'The end.'),
    };
    const valid = Object.fromEntries(
      Object.entries(lasts).map(([name, last]) => {
        const node = schemaFor().nodeFromJSON(doc(para('p1', 'Intro.'), last));
        return [name, isGap(node.resolve(node.content.size))];
      }),
    );
    expect(valid).toEqual({ chart: true, table: true, horizontalRule: true, mathBlock: true, diagram: true, pending: true, bulletList: false, heading: false, codeBlock: false, callout: false, blockquote: false, paragraph: false });
  });

  it('is drawn while it is the selection, and setting it writes nothing', async () => {
    const { landed, sent, editor } = await opened(doc(para('p1', 'Quarterly sales.'), chart('c1')));
    atEnd(editor());
    await ticks();
    expect(editor().view.dom.querySelector('.ProseMirror-gapcursor'), 'the library draws it').not.toBeNull();
    expect([sent.length, landed.length, shown(editor())]).toEqual([0, 0, ['paragraph:Quarterly sales.', 'chart:']]);
  });

  it('is set by ArrowRight and by ArrowDown from a selected chart that nothing follows', async () => {
    const { landed, sent, editor } = await opened(doc(para('p1', 'Quarterly sales.'), chart('c1')));
    for (const key of ['ArrowRight', 'ArrowDown']) {
      editor().view.dispatch(editor().state.tr.setSelection(NodeSelection.create(editor().state.doc, editor().state.doc.content.size - 1)));
      keydown(editor(), key);
      expect(isGapAtEnd(editor()), key).toBe(true);
    }
    await ticks();
    expect([sent.length, landed.length]).toEqual([0, 0]);
  });

  it.each([
    ['after a paragraph and a chart', doc(para('p1', 'Quarterly sales.'), chart('c1')), ['paragraph:Quarterly sales.', 'chart:', 'paragraph:x']],
    ['after a chart alone', doc(chart('c1')), ['chart:', 'paragraph:x']],
  ])('takes a key typed at it into a paragraph after the chart, which stays, in one update of the person’s, %s', async (_, content, after) => {
    const { handle, landed, sent, editor } = await opened(content);
    atEnd(editor());
    press(editor(), 'x');
    await until(() => landed.length === 1 && handle.state().unsaved === 0, 'the keystroke at the host');
    await ticks();
    expect(shown(editor())).toEqual(after);
    expect(shape(world!.host.doc)).toEqual(after);
    expect([sent.length, landed.map((row) => row.actor.kind)]).toEqual([1, ['human']]);
    expect(editor().state.selection).toBeInstanceOf(TextSelection);
  });

  it('stays at the document’s end through another replica’s write above it, and sends nothing', async () => {
    const { handle, landed, sent, editor } = await opened(doc(para('p1', 'Quarterly sales.'), chart('c1')));
    atEnd(editor());
    world!.host.write((d) => void tabBody(d, TAB)!.insert(0, [YNode.from(pmnodeToDelta(schemaFor().nodeFromJSON(para('p0', 'From the agent.'))))]), AGENT);
    await until(() => editor().state.doc.firstChild?.attrs.id === 'p0', 'the remote paragraph');
    await ticks();
    expect(isGapAtEnd(editor())).toBe(true);
    expect([sent.length, landed.map((row) => row.actor.kind), handle.state().unsaved]).toEqual([0, ['session'], 0]);
  });

  it('makes a paragraph for a composition begun at it and puts the caret inside, the chart kept', async () => {
    const { handle, landed, editor } = await opened(doc(para('p1', 'Quarterly sales.'), chart('c1')));
    atEnd(editor());
    editor().view.dom.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: '한', bubbles: true, cancelable: true }));
    await until(() => landed.length === 1 && handle.state().unsaved === 0, 'the paragraph at the host');
    expect(shown(editor())).toEqual(['paragraph:Quarterly sales.', 'chart:', 'paragraph:']);
    const { selection } = editor().state;
    expect([selection instanceof TextSelection, selection.$head.parent.type.name, selection.$head.index(0)]).toEqual([true, 'paragraph', 2]);
  });
});
