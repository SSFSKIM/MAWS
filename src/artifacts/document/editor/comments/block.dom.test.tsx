// P3-E (E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md; E's Decision Log 28): commenting a whole block in
// DocumentEditor (happy-dom). With `blockCommentQuote`, a selected chart is commented as a block: the thread is written
// with the block discriminant and the quote the callback gives, no mark, the block drawn as the active comment, the card
// opened and located on it; the rail lists, shows (the block selected), orphans with its quote when the block goes, and
// resolves and reopens it. Without the callback the selected chart offers nothing to comment (B's behaviour).
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getThread, listThreads } from '../../threads';
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
const quoteOf = (node: PMNode): string | undefined => (node.type.name === 'chart' ? `chart: ${(node.attrs.spec as { title: string }).title}` : undefined);

async function mount({ blockQuote = true } = {}) {
  world = new World(content());
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
  render(<DocumentEditor artifactId="dash1" handle={handle} host={owner} onEditor={(e) => (current = e)} comments={comments} {...(blockQuote && { blockCommentQuote: quoteOf })} />);
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
const commentButton = () => within(toolbar()).getByRole('button', { name: 'Comment' }) as HTMLButtonElement;
const rail = () => screen.getByRole('complementary', { name: 'Comments' });
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
    expect({ tabId, tabTitle, quote }).toEqual({ tabId: TAB, tabTitle: 'Main', quote: 'chart: Sales by region' });
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
    const item = () => within(rail()).getByRole('article');
    expect(item().dataset.thread).toBe(id);
    expect(item().textContent).toContain('chart: Sales by region');
    expect(item().dataset.orphan).toBeUndefined();

    act(() => fireEvent.click(within(item()).getByRole('button', { name: /^Show/ })));
    await act(() => ticks(5));
    const selection = editor().state.selection;
    expect(selection instanceof NodeSelection && selection.node.attrs.id).toBe('c1');

    act(() => void editor().commands.deleteSelection());
    await quiet();
    expect(item().dataset.orphan).toBe('');
    expect(item().textContent).toContain('chart: Sales by region');
    act(() => fireEvent.click(within(item()).getByRole('button', { name: 'Resolve' })));
    await quiet();
    expect(getThread(handle.doc, id)!.status).toBe('resolved');
    act(() => fireEvent.click(within(rail()).getByRole('button', { name: 'Reopen' })));
    await quiet();
    expect(getThread(handle.doc, id)!.status).toBe('open');

    act(() => void editor().commands.undo());
    await quiet();
    expect(item().dataset.orphan).toBeUndefined(); // the block is back: live again
  });
});
