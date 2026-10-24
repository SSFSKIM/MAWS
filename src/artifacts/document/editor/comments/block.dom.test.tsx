// P3-E (E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md; E's Decision Log 28): commenting a whole block in
// DocumentEditor (happy-dom). With `blockCommentQuote`, a selected chart is commented as a block: the thread is written
// with the block discriminant and the quote the callback gives, no mark, the block drawn as the active comment, the card
// opened and located on it; the rail lists, shows (the block selected), orphans with its quote when the block goes, and
// resolves and reopens it. Without the callback the selected chart offers nothing to comment (B's behaviour).
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { AllSelection, NodeSelection } from '@tiptap/pm/state';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { addThread, getThread, listThreads, liveThreadIds, threadStates } from '../../threads';
import { schemaFor } from '../../schema';
import { addTab } from '../../tabs';
import { DocumentEditor } from '../DocumentEditor';
import type { DocumentHandle } from '../host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from '../memory-host';
import { TAB, World, doc, para, ticks, until } from '../test-world';
import type { CommentOverlayProps, CommentedPassage, DocumentComments } from './surface';

let world: World | null = null;
let handles: DocumentHandle[] = [];
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  handles = [];
  world?.destroy();
  world = null;
});

const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });
const chart = (id: string, title: string): JSONContent => ({ type: 'chart', attrs: { id, source: 'sales', spec: { view: 'bar', x: 'region', y: 'total', title } } });
const content = () => doc(para('p1', 'Sales rose in every region.'), chart('c1', 'Sales by region'), para('p2', 'Notes follow.'));
const QUOTE_C1 = 'chart: Sales by region';
const quoteOf = (node: PMNode): string | undefined => (node.type.name === 'chart' ? `chart: ${(node.attrs.spec as { title: string }).title}` : undefined);

async function mount({ blockQuote = true, artifactId = 'dash1', seed = content() }: { blockQuote?: boolean; artifactId?: string; seed?: JSONContent } = {}) {
  world = new World(seed);
  const handle = openMemoryHandle(world.host, { log: () => {} });
  handles.push(handle);
  await whenSynced(handle);
  let current: Editor | null = null;
  const opened: CommentedPassage[] = [];
  let overlay: CommentOverlayProps | null = null;
  const comments: DocumentComments = {
    opened: (passage) => opened.push(passage),
    overlay: (props) => {
      overlay = props;
      return <div data-testid="overlay" />;
    },
  };
  render(<DocumentEditor artifactId={artifactId} handle={handle} host={owner} onEditor={(e) => (current = e)} comments={comments} {...(blockQuote && { blockCommentQuote: quoteOf })} />);
  await until(() => current !== null && current.getText().length > 0, 'the editor to bind');
  return { editor: () => current!, handle, opened, overlay: () => overlay! };
}

const posOf = (editor: Editor, id: string): number => {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.id === id) at = pos;
    return at < 0;
  });
  return at;
};
const selectBlock = (editor: Editor, id: string) => act(() => void editor.commands.setNodeSelection(posOf(editor, id)));
const toolbar = () => screen.getByRole('toolbar', { name: 'Formatting' });
const commentButton = () => within(toolbar()).getByRole('button', { name: 'Add comment' }) as HTMLButtonElement;
const rail = () => screen.getByRole('complementary', { name: 'Comments' }); // P4-B1: each thread in it is X36's card, a group (K1)
const quiet = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 80)));
const chartDom = (editor: Editor) => editor.view.dom.querySelector<HTMLElement>('[data-node="chart"]')!;

describe('commenting a block (P3-E)', () => {
  it('writes a block thread with the callback’s quote and no mark, draws the block active and opens the card on it', async () => {
    const { editor, handle, opened, overlay } = await mount();
    selectBlock(editor(), 'c1');
    expect(commentButton().disabled).toBe(false);
    act(() => fireEvent.click(commentButton()));

    expect(opened).toHaveLength(1);
    const [{ threadId, tabId, tabTitle, quote }] = opened as [CommentedPassage];
    expect({ tabId, tabTitle, quote }).toEqual({ tabId: TAB, tabTitle: '', quote: 'chart: Sales by region' }); // P4-B1 (tracker L275): one tab, no tab title
    expect(getThread(handle.doc, threadId)).toMatchObject({ tabId: TAB, blockId: 'c1', quote: 'chart: Sales by region', anchor: { kind: 'block' }, status: 'open', messages: [] });
    expect(JSON.stringify(editor().getJSON())).not.toContain('"comment"'); // no mark anywhere
    await ticks(3);
    expect([...chartDom(editor()).classList]).toEqual(expect.arrayContaining(['comment', `comment-${threadId}`, 'comment-active']));
    expect(overlay().locate(threadId)).not.toBeNull();
    expect(editor().storage.collaboration.undoManager?.canUndo()).toBe(false);
    await until(() => getThread(world!.host.doc, threadId) !== null, 'the host to hold the thread');
  });

  it('Mod-Alt-M comments the selected block too; a text selection still comments the passage', async () => {
    const { editor, opened, handle } = await mount();
    selectBlock(editor(), 'c1');
    act(() => void editor().commands.keyboardShortcut('Mod-Alt-m'));
    act(() => void editor().commands.setTextSelection({ from: 1, to: 6 }));
    act(() => void editor().commands.keyboardShortcut('Mod-Alt-m'));
    expect(opened.map((p) => p.quote)).toEqual(['chart: Sales by region', 'Sales']);
    expect(listThreads(handle.doc).map((t) => t.anchor && 'kind' in t.anchor)).toEqual([true, false]);
  });

  it('without the callback a selected block offers nothing to comment (B’s text-only behaviour)', async () => {
    const { editor, opened, handle } = await mount({ blockQuote: false });
    selectBlock(editor(), 'c1');
    act(() => fireEvent.click(commentButton()));
    act(() => void editor().commands.keyboardShortcut('Mod-Alt-m'));
    expect(opened).toEqual([]);
    expect(listThreads(handle.doc)).toEqual([]);
  });

  it('a resolved block thread is drawn plain but still located; reopened, drawn again', async () => {
    const { editor, opened, overlay } = await mount();
    selectBlock(editor(), 'c1');
    act(() => fireEvent.click(commentButton()));
    const id = opened[0]!.threadId;
    act(() => overlay().resolve(id));
    await ticks(3);
    expect(chartDom(editor()).classList.contains('comment')).toBe(false);
    expect(overlay().locate(id)).not.toBeNull();
    act(() => overlay().reopen(id));
    await ticks(3);
    expect(chartDom(editor()).classList.contains(`comment-${id}`)).toBe(true);
  });

  it('the rail lists the block thread, shows it by selecting the block, marks it orphaned when the block goes, and resolves and reopens it', async () => {
    const { editor, opened, handle } = await mount();
    selectBlock(editor(), 'c1');
    act(() => fireEvent.click(commentButton()));
    const id = opened[0]!.threadId;
    act(() => void editor().commands.setTextSelection(2));
    act(() => fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ })));
    await quiet();
    const item = () => within(rail()).getByRole('group');
    expect(item().dataset.thread).toBe(id);
    expect(item().textContent).toContain('chart: Sales by region');
    expect(item().dataset.orphan).toBeUndefined();

    act(() => fireEvent.click(within(item()).getByRole('button', { name: /^Show/ })));
    await act(() => ticks(5));
    const selection = editor().state.selection;
    expect(selection instanceof NodeSelection && selection.node.attrs.id).toBe('c1');
    // P4-B1 (the activation table): the item chosen closed the panel, the margin hosting (an unmeasured body is not
    // narrow); it is opened again
    act(() => fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ })));
    await quiet();

    act(() => void editor().commands.deleteSelection());
    await quiet();
    expect(within(rail()).queryByRole('group')).toBeNull();
    expect(within(toolbar()).getByRole('button', { name: 'Comments (0 open)' })).toBeTruthy();
    const before = getThread(handle.doc, id);
    const reveal = within(rail()).getByRole('button', { name: /^(Show|Hide) deleted-target comments$/ });
    act(() => fireEvent.click(reveal));
    expect(getThread(handle.doc, id)).toEqual(before);
    expect(item().dataset.orphan).toBe('');
    expect(item().textContent).toContain('chart: Sales by region');
    act(() => fireEvent.click(within(item()).getByRole('button', { name: 'Resolve' })));
    await quiet();
    expect(getThread(handle.doc, id)!.status).toBe('resolved');
    act(() => fireEvent.click(reveal));
    expect(within(rail()).queryByRole('group')).toBeNull();
    act(() => fireEvent.click(reveal));
    act(() => fireEvent.click(within(rail()).getByRole('button', { name: 'Reopen' })));
    await quiet();
    expect(getThread(handle.doc, id)!.status).toBe('open');

    act(() => void editor().commands.undo());
    await quiet();
    expect(item().dataset.orphan).toBeUndefined(); // the block is back: live again
  });
});

// P3-E (E2 M4; E's Decision Log 34): a view block cut and pasted within its artifact keeps its id, so its thread stays
// live with no thread write. Only a real cut carries: B's cut is stamped with a one-shot nonce after ProseMirror writes the
// clipboard, and a paste restores the original id (after UniqueID's fresh one) only for that cut's nonce, in the same
// artifact, while the original block is live nowhere, once. A copy, another artifact, foreign HTML and a second paste get
// B's fresh id. Clipboard events dispatched as the window's Edit commands deliver them (happy-dom has no pasteboard).
describe('a commented view cut and pasted (P3-E, Decision Log 34)', () => {
  const clipboard = (editor: Editor, kind: 'cut' | 'copy' | 'paste', data = new DataTransfer()): DataTransfer => {
    act(() => void editor.view.dom.dispatchEvent(new ClipboardEvent(kind, { clipboardData: data, bubbles: true, cancelable: true })));
    return data;
  };
  const ids = (editor: Editor) => {
    const out: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'chart') out.push(String(node.attrs.id));
      return !node.isTextblock;
    });
    return out;
  };
  const caretAtEnd = (editor: Editor) => act(() => void editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  async function commented() {
    const m = await mount();
    selectBlock(m.editor(), 'c1');
    act(() => fireEvent.click(commentButton()));
    const id = m.opened[0]!.threadId;
    act(() => m.overlay().record(id, 'Why the dip?')); // a sent comment: never withdrawn
    return { ...m, id, before: () => JSON.stringify(getThread(m.handle.doc, id)) };
  }
  const live = (m: { handle: DocumentHandle }, id: string) => listThreads(m.handle.doc).length > 0 && !threadStates(m.handle.doc, liveThreadIds(m.handle.doc)).find((t) => t.id === id)!.orphan;

  it('a cut is stamped with its nonce and a copy is not; the paste restores the original id, the thread live and unwritten', async () => {
    const m = await commented();
    const record = m.before();
    selectBlock(m.editor(), 'c1');
    const copied = clipboard(m.editor(), 'copy');
    expect(copied.getData('text/html')).toContain('data-id="c1"');
    expect(copied.getData('text/html')).not.toContain('data-maws-cut');
    selectBlock(m.editor(), 'c1');
    const cut = clipboard(m.editor(), 'cut');
    expect(cut.getData('text/html')).toMatch(/data-maws-cut="[\w-]+"/);
    expect(ids(m.editor())).toEqual([]);
    expect(live(m, m.id)).toBe(false);
    caretAtEnd(m.editor());
    clipboard(m.editor(), 'paste', cut);
    expect(ids(m.editor())).toEqual(['c1']);
    expect(live(m, m.id)).toBe(true);
    expect(m.before()).toBe(record); // the thread was never written
    await ticks(3);
    expect(chartDom(m.editor()).classList.contains(`comment-${m.id}`)).toBe(true);
  });

  it('cut, paste, undo, undo: the thread stays live (the paste and its id restore are one undo step)', async () => {
    const m = await commented();
    // each step its own undo item, as a person's pauses make them (the binding groups steps within its capture timeout)
    const pause = () => m.editor().storage.collaboration.undoManager?.stopCapturing();
    pause();
    selectBlock(m.editor(), 'c1');
    const cut = clipboard(m.editor(), 'cut');
    pause();
    caretAtEnd(m.editor());
    clipboard(m.editor(), 'paste', cut);
    pause();
    expect(ids(m.editor())).toEqual(['c1']);
    act(() => void m.editor().commands.undo());
    expect(ids(m.editor())).toEqual([]);
    expect(live(m, m.id)).toBe(false);
    act(() => void m.editor().commands.undo());
    expect(ids(m.editor())).toEqual(['c1']);
    expect(live(m, m.id)).toBe(true);
  });

  it('a copy pasted, a second paste of one cut and foreign HTML with a nonce get fresh ids; the thread is not adopted', async () => {
    const m = await commented();
    selectBlock(m.editor(), 'c1');
    const copied = clipboard(m.editor(), 'copy');
    caretAtEnd(m.editor());
    clipboard(m.editor(), 'paste', copied);
    expect(ids(m.editor())).toHaveLength(2);
    expect(ids(m.editor())[0]).toBe('c1'); // the original stays; the copy is B's fresh id

    selectBlock(m.editor(), 'c1');
    const cut = clipboard(m.editor(), 'cut');
    caretAtEnd(m.editor());
    clipboard(m.editor(), 'paste', cut);
    expect(ids(m.editor()).filter((id) => id === 'c1')).toHaveLength(1);
    caretAtEnd(m.editor());
    clipboard(m.editor(), 'paste', cut); // consumed: a fresh id
    expect(ids(m.editor())).toHaveLength(3);
    expect(ids(m.editor()).filter((id) => id === 'c1')).toHaveLength(1);

    const foreign = new DataTransfer();
    foreign.setData('text/html', cut.getData('text/html').replace(/data-maws-cut="[\w-]+"/, 'data-maws-cut="forged01"'));
    selectBlock(m.editor(), 'c1');
    act(() => void m.editor().commands.deleteSelection());
    caretAtEnd(m.editor());
    clipboard(m.editor(), 'paste', foreign);
    expect(ids(m.editor())).not.toContain('c1');
    expect(live(m, m.id)).toBe(false);
  });

  it('a later cut with no threaded block clears the record: the earlier cut pastes fresh', async () => {
    const m = await commented();
    selectBlock(m.editor(), 'c1');
    const cut = clipboard(m.editor(), 'cut');
    act(() => void m.editor().commands.setTextSelection({ from: 1, to: 6 }));
    clipboard(m.editor(), 'cut'); // prose: nothing recorded, the earlier record gone
    caretAtEnd(m.editor());
    clipboard(m.editor(), 'paste', cut);
    expect(ids(m.editor())).toHaveLength(1);
    expect(ids(m.editor())).not.toContain('c1');
    expect(live(m, m.id)).toBe(false);
  });

  it('a cut pasted into another artifact (a duplicate holding the same orphaned thread) gets a fresh id', async () => {
    const m = await commented();
    selectBlock(m.editor(), 'c1');
    const cut = clipboard(m.editor(), 'cut');
    cleanup();
    for (const handle of handles) handle.close();
    handles = [];
    world?.destroy();
    // the duplicate: the same thread, its chart deleted, open in its own editor
    const copy = await mount({ artifactId: 'dash2', seed: doc(para('p1', 'Sales rose in every region.'), para('p2', 'Notes follow.')) });
    act(() => addThread(copy.handle.doc, { threadId: m.id, tabId: TAB, blockId: 'c1', quote: QUOTE_C1, anchor: { kind: 'block' }, by: { kind: 'human' }, at: 1 }));
    caretAtEnd(copy.editor());
    clipboard(copy.editor(), 'paste', cut);
    expect(ids(copy.editor())).toHaveLength(1);
    expect(ids(copy.editor())).not.toContain('c1');
    expect(live(copy, m.id)).toBe(false);
  });

  it('pasted into another tab of the same artifact, the original id is restored there', async () => {
    const m = await commented();
    world!.host.write((d) => addTab(d, { title: 'Appendix', id: 'tab2', body: schemaFor().nodeFromJSON(doc(para('a1', 'Appendix.'))) }));
    selectBlock(m.editor(), 'c1');
    const cut = clipboard(m.editor(), 'cut');
    await until(() => screen.queryByRole('tab', { name: 'Appendix' }) !== null, 'the second tab');
    act(() => fireEvent.click(screen.getByRole('tab', { name: 'Appendix' })));
    await until(() => m.editor().getText().includes('Appendix.'), 'the second tab bound');
    caretAtEnd(m.editor());
    clipboard(m.editor(), 'paste', cut);
    expect(ids(m.editor())).toEqual(['c1']);
    expect(live(m, m.id)).toBe(true);
  });

  // Review fix (E2's Decision Log 27): a cut holding views whose attributes are identical (only the ids differ) restores
  // each threaded view's id to the view pasted at its own place in the clipboard slice, unthreaded twins keeping B's fresh
  // ids, whatever the paste's surroundings (a nested view, a paste into the middle of a paragraph, an untouched twin
  // elsewhere in the document).
  const same = (id: string) => chart(id, 'Same view');
  const thread = (m: { handle: DocumentHandle }, threadId: string, blockId: string) =>
    act(() => addThread(m.handle.doc, { threadId, tabId: TAB, blockId, quote: 'chart: Same view', anchor: { kind: 'block' }, by: { kind: 'human' }, at: 1, body: `On ${blockId}.` }));
  const cutAll = (editor: Editor) => {
    act(() => void editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc))));
    return clipboard(editor, 'cut');
  };
  const isFresh = (id: string, taken: string[]) => !taken.includes(id);

  it('an unthreaded view and its threaded identical twin, cut together: the twin’s id goes to the second pasted view', async () => {
    const m = await mount({ seed: doc(para('p1', 'Intro'), same('c1'), same('c2'), para('p2', 'End')) });
    thread(m, 'tb', 'c2');
    const cut = cutAll(m.editor());
    expect(ids(m.editor())).toEqual([]);
    act(() => void m.editor().commands.setTextSelection(1));
    clipboard(m.editor(), 'paste', cut);
    const after = ids(m.editor());
    expect(after).toHaveLength(2);
    expect(after[1]).toBe('c2');
    expect(isFresh(after[0]!, ['c1', 'c2'])).toBe(true);
    expect(live(m, 'tb')).toBe(true);
  });

  it('threaded, unthreaded and threaded identical views keep their own ids in order; the unthreaded one is fresh', async () => {
    const m = await mount({ seed: doc(para('p1', 'Intro'), same('c1'), same('c2'), same('c3'), para('p2', 'End')) });
    thread(m, 't1', 'c1');
    thread(m, 't3', 'c3');
    const cut = cutAll(m.editor());
    act(() => void m.editor().commands.setTextSelection(1));
    clipboard(m.editor(), 'paste', cut);
    const after = ids(m.editor());
    expect(after).toHaveLength(3);
    expect([after[0], after[2]]).toEqual(['c1', 'c3']);
    expect(isFresh(after[1]!, ['c1', 'c2', 'c3'])).toBe(true);
    expect([live(m, 't1'), live(m, 't3')]).toEqual([true, true]);
  });

  it('a nested view among identical twins, pasted into the middle of a paragraph beside an untouched twin, gets its own id back', async () => {
    const seed = doc(
      para('p1', 'Intro'),
      same('c1'),
      { type: 'blockquote', attrs: { id: 'q1' }, content: [para('qp', 'Quoted.'), same('c2')] },
      para('p2', 'Middle text here.'),
      same('c9'),
    );
    const m = await mount({ seed });
    thread(m, 't2', 'c2');
    // the cut: from inside "Intro" to inside "Middle", so c1 and the quote holding c2 go
    const from = 3;
    let to = -1;
    m.editor().state.doc.descendants((node, pos) => {
      if (node.attrs.id === 'p2') to = pos + 4;
      return to < 0;
    });
    act(() => void m.editor().commands.setTextSelection({ from, to }));
    const cut = clipboard(m.editor(), 'cut');
    expect(ids(m.editor())).toEqual(['c9']);
    // pasted into the middle of the remaining paragraph's text: the slice lands between its two halves
    act(() => void m.editor().commands.setTextSelection(5));
    clipboard(m.editor(), 'paste', cut);
    const after = ids(m.editor());
    expect(after).toHaveLength(3);
    expect(after[2]).toBe('c9'); // the untouched twin keeps its id
    expect(after[1]).toBe('c2'); // the nested view, its own id back
    expect(isFresh(after[0]!, ['c1', 'c2', 'c9'])).toBe(true);
    expect(live(m, 't2')).toBe(true);
  });
});
