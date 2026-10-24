// Comments in DocumentEditor (happy-dom; M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9): the Comment
// control and Mod-Alt-M write the thread and the mark and hand the passage to the surface; the overlay the surface
// draws is given the editor's reach (record, discard, resolve, reopen, locate); the threads rail lists open and resolved
// threads, orphans marked, and resolves, reopens and shows a thread, switching tab when it lives in another.
import type { Editor, JSONContent } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import { schemaFor } from '../../schema';
import { addTab } from '../../tabs';
import { addThread, getThread, listThreads, reply, resolve } from '../../threads';
import { DocumentEditor } from '../DocumentEditor';
import type { DocumentHandle } from '../host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from '../memory-host';
import { TAB, World, doc, para, ticks, until } from '../test-world';
import type { CommentOverlayProps, CommentedPassage, DocumentComments } from './surface';
import { covered, findPos, highlighted, select } from './test-support';

let world: World | null = null;
let handles: DocumentHandle[] = [];
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  handles = [];
  world?.destroy();
  world = null;
});

const SESSION = { kind: 'session', appSessionId: 'a1111111-1111-4111-8111-111111111111' } as Actor;
const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });

interface Mounted {
  editor: () => Editor;
  handle: DocumentHandle;
  opened: CommentedPassage[];
  overlay: () => CommentOverlayProps;
}

async function mount(content: JSONContent, { surface = true } = {}): Promise<Mounted> {
  world = new World(content);
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
  render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} onEditor={(e) => (current = e)} {...(surface && { comments })} />);
  await until(() => current !== null && current.getText().length > 0, 'the editor to bind');
  return { editor: () => current!, handle, opened, overlay: () => overlay! };
}

const content = () => doc(para('p1', 'The plan ships quarterly.'), para('p2', 'Owners track the budget.'));
const toolbar = () => screen.getByRole('toolbar', { name: 'Formatting' });
const commentButton = () => within(toolbar()).getByRole('button', { name: 'Add comment' }) as HTMLButtonElement;
const rail = () => screen.getByRole('complementary', { name: 'Comments' }); // P4-B1: each thread in it is X36's card, a group (K1)
// the rail's list follows the document after a quiet moment (use-threads.ts)
const quiet = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 80)));

describe('commenting a selection', () => {
  it('writes the thread, then the mark, and hands the passage to the surface; the passage is drawn active; nothing to undo', async () => {
    const { editor, handle, opened } = await mount(content());
    expect(commentButton().disabled).toBe(true); // no selection
    act(() => void select(editor(), 'ships quarterly'));
    expect(commentButton().disabled).toBe(false);
    act(() => fireEvent.click(commentButton()));

    expect(opened).toHaveLength(1);
    const [{ threadId, tabId, tabTitle, quote }] = opened as [CommentedPassage];
    expect({ tabId, tabTitle, quote }).toEqual({ tabId: TAB, tabTitle: '', quote: 'ships quarterly' }); // P4-B1 (tracker L275): one tab, no tab title
    expect(getThread(handle.doc, threadId)).toMatchObject({ tabId: TAB, blockId: 'p1', quote: 'ships quarterly', status: 'open', createdBy: { kind: 'human' }, messages: [] });
    expect(covered(editor())).toEqual({ [threadId]: 'ships quarterly' });
    await ticks(3);
    expect(highlighted(editor())).toEqual({ [threadId]: 'ships quarterly' });
    expect(editor().view.dom.querySelector('.comment-active')?.textContent).toBe('ships quarterly');
    expect(editor().storage.collaboration.undoManager?.canUndo()).toBe(false);
    await until(() => getThread(world!.host.doc, threadId) !== null, 'the host to hold the thread');
  });

  it('Mod-Alt-M comments the selection too; a selection with no text writes nothing', async () => {
    const { editor, handle, opened } = await mount(content());
    act(() => void editor().commands.setTextSelection(3));
    act(() => void editor().commands.keyboardShortcut('Mod-Alt-m'));
    expect(opened).toHaveLength(0);
    act(() => void select(editor(), 'track the budget'));
    act(() => void editor().commands.keyboardShortcut('Mod-Alt-m'));
    expect(opened.map((p) => p.quote)).toEqual(['track the budget']);
    expect(listThreads(handle.doc)).toHaveLength(1);
  });

  it('is not offered without a surface', async () => {
    const { editor } = await mount(content(), { surface: false });
    act(() => void select(editor(), 'ships'));
    expect(within(toolbar()).queryByRole('button', { name: 'Add comment' })).toBeNull();
    act(() => void editor().commands.keyboardShortcut('Mod-Alt-m'));
    expect(covered(editor())).toEqual({});
  });
});

describe('the overlay’s reach', () => {
  it('records the sent comment as the thread’s message by the person, and discards an unsent one with its mark', async () => {
    const { editor, handle, opened, overlay } = await mount(content());
    act(() => void select(editor(), 'ships quarterly'));
    act(() => fireEvent.click(commentButton()));
    act(() => void select(editor(), 'Owners'));
    act(() => fireEvent.click(commentButton()));
    const [sent, unsent] = opened.map((p) => p.threadId) as [string, string];

    act(() => overlay().record(sent, 'Should this be monthly?'));
    expect(getThread(handle.doc, sent)!.messages).toMatchObject([{ by: { kind: 'human' }, body: 'Should this be monthly?' }]);
    act(() => overlay().discard(unsent));
    act(() => overlay().discard(sent)); // it has a message: kept
    expect(listThreads(handle.doc).map((t) => t.id)).toEqual([sent]);
    expect(covered(editor())).toEqual({ [sent]: 'ships quarterly' });
  });

  it('resolves and reopens, outside the editor’s undo; locates nothing for a thread with no live text here', async () => {
    const { editor, handle, opened, overlay } = await mount(content());
    act(() => void select(editor(), 'ships quarterly'));
    act(() => fireEvent.click(commentButton()));
    const id = opened[0]!.threadId;
    act(() => overlay().resolve(id));
    await ticks(3);
    expect(getThread(handle.doc, id)).toMatchObject({ status: 'resolved', resolvedBy: { kind: 'human' } });
    expect(highlighted(editor())).toEqual({});
    expect(editor().storage.collaboration.undoManager?.canUndo()).toBe(false);
    act(() => overlay().reopen(id));
    await ticks(3);
    expect(highlighted(editor())).toEqual({ [id]: 'ships quarterly' });
    expect(overlay().locate('nope')).toBeNull();
  });
});

describe('the threads rail', () => {
  async function seeded() {
    const m = await mount(content());
    const { handle } = m;
    world!.host.write((d) => addTab(d, { title: 'Appendix', id: 'tab2', body: schemaFor().nodeFromJSON(doc(para('a1', 'Appendix text.'))) }));
    act(() => void select(m.editor(), 'ships quarterly'));
    act(() => fireEvent.click(commentButton()));
    act(() => void select(m.editor(), 'Owners'));
    act(() => fireEvent.click(commentButton()));
    const [first, second] = m.opened.map((p) => p.threadId) as [string, string];
    act(() => m.overlay().record(first, 'Should this be monthly?'));
    reply(handle.doc, first, { id: 'r1', by: SESSION, at: 2, body: 'Changed to monthly.' });
    // a thread on the other tab, and the second's passage deleted (orphaned)
    addThread(handle.doc, { threadId: 'zz000001', tabId: 'tab2', blockId: 'a1', quote: 'Appendix', anchor: { start: null, end: null, block: null }, by: SESSION, at: Date.now() + 1 });
    act(() => {
      select(m.editor(), 'Owners');
      m.editor().commands.deleteSelection();
    });
    return { ...m, first, second };
  }

  it('opens from the toolbar with the open count, lists threads with their messages, marks an orphan and resolves one', async () => {
    const { handle, first, second } = await seeded();
    await until(() => (listThreads(handle.doc).length === 3), 'the threads');
    const toggle = within(toolbar()).getByRole('button', { name: /^Comments/ });
    await quiet();
    expect(toggle.textContent).toContain('1');
    act(() => fireEvent.click(toggle));
    await quiet();
    expect(within(rail()).getAllByRole('group').map((item) => item.dataset.thread)).toEqual([first]);
    const before = listThreads(handle.doc);
    const reveal = within(rail()).getByRole('button', { name: 'Show deleted-target comments' });
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    act(() => fireEvent.click(reveal));
    expect(reveal.getAttribute('aria-pressed')).toBe('true');
    expect(listThreads(handle.doc)).toEqual(before);
    const items = within(rail()).getAllByRole('group');
    expect(items.map((item) => item.dataset.thread)).toEqual([first, second, 'zz000001']);
    expect(items[0]!.textContent).toContain('ships quarterly');
    expect(items[0]!.textContent).toContain('Should this be monthly?');
    expect(items[0]!.textContent).toContain('Changed to monthly.');
    expect(items[1]!.dataset.orphan).toBe('');
    expect(items[1]!.textContent).toContain('passage was removed');

    act(() => fireEvent.click(within(items[0]!).getByRole('button', { name: 'Resolve' })));
    await quiet();
    expect(getThread(handle.doc, first)!.status).toBe('resolved');
    const resolved = within(rail()).getByRole('region', { name: /Resolved/ });
    expect(within(resolved).getAllByRole('group').map((item) => item.dataset.thread)).toEqual([first]);
    act(() => fireEvent.click(within(resolved).getByRole('button', { name: 'Reopen' })));
    await quiet();
    expect(getThread(handle.doc, first)!.status).toBe('open');
  });

  it('shows a thread: its passage selected and drawn active, the tab switched when it lives in another', async () => {
    const { editor } = await seeded();
    act(() => fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ })));
    await quiet();
    act(() => fireEvent.click(within(rail()).getAllByRole('button', { name: /^Show passage/ })[0]!));
    await act(() => ticks(5));
    expect(editor().view.dom.querySelector('.comment-active')?.textContent).toBe('ships quarterly');
    expect(editor().state.doc.textBetween(editor().state.selection.from, editor().state.selection.to)).toBe('ships quarterly');
    // P4-B1 (the activation table): with the margin hosting (an unmeasured body is not narrow), the item chosen closes
    // the panel and the margin shows the thread; the panel is opened again for the next one
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull();
    act(() => fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ })));
    await quiet();

    act(() => fireEvent.click(within(rail()).getByRole('button', { name: 'Show deleted-target comments' })));
    act(() => fireEvent.click(within(rail()).getByRole('button', { name: 'Show passage: Appendix' })));
    await until(() => screen.getByRole('tab', { name: 'Appendix' }).getAttribute('aria-selected') === 'true', 'the other tab');
  });

  // P4-B1 (D9, the prior art's Z4): the rail is the All comments panel, its cards X36's; it filters by status, by tab and
  // by a search over the messages, the quotes and the authors' names, and each card's reply draft is the panel's, so a
  // card a filter hides keeps it.
  it('filters by status, scope and a search, each card keeping its draft (P4-B1, Z4)', async () => {
    const { handle, first, second } = await seeded();
    act(() => void resolve(handle.doc, second, { kind: 'human' }, Date.now() + 2));
    act(() => fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ })));
    await quiet();
    expect(within(rail()).getByRole('heading', { name: 'All comments' })).toBeTruthy();
    const ids = () => within(rail()).queryAllByRole('group').map((card) => card.dataset.thread);
    const choose = (name: string) => act(() => fireEvent.click(within(rail()).getByRole('radio', { name })));
    const search = (value: string) => act(() => fireEvent.change(within(rail()).getByRole('searchbox', { name: 'Search comments' }), { target: { value } }));
    const field = (id: string) => within(rail().querySelector<HTMLElement>(`[data-thread="${id}"]`)!).getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
    expect(ids()).toEqual([first]);
    act(() => fireEvent.click(within(rail()).getByRole('button', { name: 'Show deleted-target comments' })));
    expect(ids()).toEqual([first, 'zz000001', second]); // All: open first, then the resolved section
    expect(within(rail()).getByRole('radio', { name: 'All' })).toHaveProperty('checked', true);
    expect(within(rail()).getByRole('radio', { name: 'All tabs' })).toHaveProperty('checked', true);
    act(() => fireEvent.change(field(first), { target: { value: 'Draft kept' } }));

    choose('Open');
    expect(ids()).toEqual([first, 'zz000001']);
    expect(within(rail()).queryByRole('region', { name: /Resolved/ })).toBeNull();
    choose('Resolved');
    expect(ids()).toEqual([second]);
    expect(within(rail()).queryByRole('region', { name: /Resolved/ })).toBeNull();
    choose('All');

    choose('This tab');
    expect(ids()).toEqual([first, second]);
    choose('All tabs');

    search('MONTHLY'); // a message's body, any case
    expect(ids()).toEqual([first]);
    search('appendix'); // a quote
    expect(ids()).toEqual(['zz000001']);
    search('claude'); // an author: the agent replied to the first and wrote the third
    expect(ids()).toEqual([first, 'zz000001']);
    search('owners'); // a resolved thread's quote: listed under Resolved, no note above it
    expect(ids()).toEqual([second]);
    expect(rail().querySelector('.doc-rail-empty')).toBeNull();
    search('nothing like it');
    expect(ids()).toEqual([]);
    expect(rail().textContent).toContain('No comments match');
    search('');
    expect(ids()).toEqual([first, 'zz000001', second]);
    expect(field(first).value).toBe('Draft kept');
  });

  // P4-B1 (X36: a hidden card keeps its draft): the drafts are the editor's, not the panel's, so closing it loses none
  it('keeps a reply being written across closing and reopening the panel (P4-B1, X36)', async () => {
    const { first } = await seeded();
    const toggle = () => within(toolbar()).getByRole('button', { name: /^Comments/ });
    const field = () => within(rail().querySelector<HTMLElement>(`[data-thread="${first}"]`)!).getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
    act(() => fireEvent.click(toggle()));
    await quiet();
    act(() => fireEvent.change(field(), { target: { value: 'Not sent yet' } }));
    act(() => fireEvent.click(within(rail()).getByRole('button', { name: 'Close comments' })));
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull();
    act(() => fireEvent.click(toggle()));
    await quiet();
    expect(field().value).toBe('Not sent yet');
  });

  it('moves the focus between its cards with J and K (P4-B1, K3)', async () => {
    const { first } = await seeded();
    act(() => fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ })));
    await quiet();
    act(() => fireEvent.click(within(rail()).getByRole('button', { name: 'Show deleted-target comments' })));
    const cards = () => within(rail()).getAllByRole('group');
    cards()[0]!.focus();
    expect(cards()[0]!.dataset.thread).toBe(first);
    act(() => fireEvent.keyDown(cards()[0]!, { key: 'j' }));
    expect(document.activeElement).toBe(cards()[1]);
    act(() => fireEvent.keyDown(cards()[1]!, { key: 'k' }));
    expect(document.activeElement).toBe(cards()[0]);
    act(() => fireEvent.keyDown(cards()[0]!, { key: 'k' })); // the first has no previous
    expect(document.activeElement).toBe(cards()[0]);
  });
});

// Fix wave 1 (Decision Log 25): an open thread in the rail takes a reply, posted to the thread as the person (the
// surface's identity) outside the editor's undo, listed with every author's messages; a resolved thread offers Reopen.
describe('a reply in the rail', () => {
  const messages = (item: HTMLElement) => within(item).queryAllByRole('listitem').map((message) => message.textContent);

  it('posts the person’s reply to the thread, outside undo, listed after the agent’s message', async () => {
    const { editor, handle, opened } = await mount(content());
    act(() => void select(editor(), 'ships quarterly'));
    act(() => fireEvent.click(commentButton()));
    const id = opened[0]!.threadId;
    reply(handle.doc, id, { id: 'r1', by: SESSION, at: 2, body: 'Changed to monthly.' });
    act(() => fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ })));
    await quiet();
    const item = within(rail()).getByRole('group');
    expect(messages(item)).toEqual(['ClaudeChanged to monthly.']);

    const field = within(item).getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
    const send = within(item).getByRole('button', { name: 'Reply' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    act(() => fireEvent.change(field, { target: { value: '  ' } }));
    expect(send.disabled).toBe(true);
    act(() => fireEvent.change(field, { target: { value: 'Thanks, monthly works.' } }));
    act(() => fireEvent.keyDown(field, { key: 'Enter' }));
    expect(getThread(handle.doc, id)!.messages.at(-1)).toMatchObject({ by: { kind: 'human' }, body: 'Thanks, monthly works.' });
    expect(field.value).toBe('');
    await quiet();
    expect(messages(within(rail()).getByRole('group'))).toEqual(['ClaudeChanged to monthly.', 'YouThanks, monthly works.']);
    expect(editor().storage.collaboration.undoManager?.canUndo()).toBe(false);
    await until(() => (getThread(world!.host.doc, id)?.messages.length ?? 0) === 2, 'the host to hold the reply');

    act(() => fireEvent.change(field, { target: { value: 'One more' } }));
    act(() => fireEvent.keyDown(field, { key: 'Enter', shiftKey: true }));
    act(() => fireEvent.keyDown(field, { key: 'Enter', isComposing: true }));
    expect(getThread(handle.doc, id)!.messages).toHaveLength(2);
    act(() => fireEvent.click(send));
    expect(getThread(handle.doc, id)!.messages.at(-1)!.body).toBe('One more');
  });

  it('is not offered on a resolved thread', async () => {
    const { editor, handle, opened } = await mount(content());
    act(() => void select(editor(), 'ships quarterly'));
    act(() => fireEvent.click(commentButton()));
    act(() => void resolve(handle.doc, opened[0]!.threadId, { kind: 'human' }, 3));
    act(() => fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ })));
    await quiet();
    const item = within(rail()).getByRole('group');
    expect(within(item).queryByRole('textbox', { name: 'Reply' })).toBeNull();
    expect(within(item).getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });
});

// Fix wave 1 (Decision Log 25): a click on a highlighted passage activates its thread, drawn active in the text and
// selected in the rail, which opens on it; where passages overlap the innermost (the shortest at the click) is taken;
// a click on text no open thread covers draws none active.
describe('a click on a passage', () => {
  // A click as ProseMirror hands it to its plugins: at the text's position, its target the element drawn there (happy-dom
  // has no layout, so ProseMirror's own mouse handling cannot place it).
  function clickOn(editor: Editor, needle: string): boolean {
    const pos = findPos(editor, needle) + 1;
    const { node } = editor.view.domAtPos(pos);
    const target = node.nodeType === Node.TEXT_NODE ? node.parentElement! : (node as Element);
    let event: MouseEvent | null = null;
    target.addEventListener('click', (e) => void (event = e as MouseEvent), { once: true });
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    let handled = false;
    act(() => void (handled = editor.view.someProp('handleClick', (handle) => handle(editor.view, pos, event!)) ?? false));
    return handled;
  }
  const active = (editor: Editor) => [...editor.view.dom.querySelectorAll('.comment-active')].map((span) => span.textContent).join('') || null;
  const selectedInRail = () => within(rail()).queryAllByRole('group').filter((item) => item.getAttribute('aria-current') === 'true').map((item) => item.dataset.thread);

  // P4-B1: with the margin drawing (here the icon rail: happy-dom lays out no side space), a passage click activates
  // its thread in the margin, whose overlaid card is current, and opens no list; the list (the panel) shows the active
  // thread selected once opened from the toolbar. Plain text draws none.
  it('draws the clicked passage’s thread active in the margin, and selected in the panel once opened; plain text draws none', async () => {
    const { editor, opened } = await mount(content());
    act(() => void select(editor(), 'ships quarterly'));
    act(() => fireEvent.click(commentButton()));
    act(() => void select(editor(), 'Owners'));
    act(() => fireEvent.click(commentButton()));
    const [first, second] = opened.map((p) => p.threadId) as [string, string];
    await ticks(3);
    expect(active(editor())).toBe('Owners');
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull();

    expect(clickOn(editor(), 'quarterly'), 'the click still places the caret').toBe(false);
    expect(active(editor())).toBe('ships quarterly');
    await quiet();
    expect(screen.queryByRole('complementary', { name: 'Comments' }), 'the margin takes the activation: no list opens').toBeNull();
    const margin = screen.getByRole('region', { name: 'Comments' });
    expect(margin.getAttribute('data-margin-tier')).toBe('icons');
    expect(margin.querySelector(`[data-margin-entry="${first}"]`)?.hasAttribute('data-active')).toBe(true);

    clickOn(editor(), 'Owners');
    expect(active(editor())).toBe('Owners');
    expect(margin.querySelector(`[data-margin-entry="${second}"]`)?.hasAttribute('data-active')).toBe(true);
    act(() => fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ })));
    expect(selectedInRail()).toEqual([second]);
    act(() => fireEvent.click(within(toolbar()).getByRole('button', { name: /^Comments/ })));

    clickOn(editor(), 'budget');
    expect(active(editor())).toBeNull();
    expect(screen.getByRole('region', { name: 'Comments' }).querySelector('[data-active]')).toBeNull();
  });

  it('takes the innermost of overlapping passages, and a resolved thread’s passage is no passage', async () => {
    const { editor, handle, opened } = await mount(content());
    act(() => void select(editor(), 'The plan ships quarterly'));
    act(() => fireEvent.click(commentButton()));
    act(() => void select(editor(), 'ships'));
    act(() => fireEvent.click(commentButton()));
    const [outer, inner] = opened.map((p) => p.threadId) as [string, string];
    await ticks(3);
    clickOn(editor(), 'plan');
    expect(active(editor())).toBe('The plan ships quarterly');
    clickOn(editor(), 'hips');
    expect(active(editor())).toBe('ships');
    expect(editor().view.dom.querySelector('.comment-active')!.classList.contains(`comment-${inner}`)).toBe(true);

    act(() => void resolve(handle.doc, inner, { kind: 'human' }, 3));
    await ticks(3);
    clickOn(editor(), 'hips');
    expect(active(editor())).toBe('The plan ships quarterly');
    expect(editor().view.dom.querySelector('.comment-active')!.classList.contains(`comment-${outer}`)).toBe(true);
  });
});

describe('a remote resolve', () => {
  it('stops the highlight on this editor', async () => {
    const { editor, opened } = await mount(content());
    act(() => void select(editor(), 'ships quarterly'));
    act(() => fireEvent.click(commentButton()));
    const id = opened[0]!.threadId;
    await until(() => getThread(world!.host.doc, id) !== null, 'the host to hold the thread');
    world!.host.write((d) => resolve(d, id, SESSION, 5));
    await until(() => Object.keys(highlighted(editor())).length === 0, 'the highlight to go');
  });
});

// P4-B1 (the prior art's Z6): a tab with open threads carries a dot in the strip, named by its count; resolving a tab's
// last open thread takes its dot away.
describe('the tab strip’s comment dot', () => {
  it('marks each tab with open threads by their count', async () => {
    const { editor, handle } = await mount(content());
    world!.host.write((d) => addTab(d, { title: 'Appendix', id: 'tab2', body: schemaFor().nodeFromJSON(doc(para('a1', 'Appendix text.'))) }));
    await until(() => screen.queryByRole('tab', { name: 'Appendix' }) !== null, 'the second tab');
    const dot = (title: string) => screen.getByRole('tab', { name: title }).querySelector('.doc-tab-dot');
    expect(dot('Main')).toBeNull();
    act(() => void select(editor(), 'ships quarterly'));
    act(() => fireEvent.click(commentButton()));
    act(() => void select(editor(), 'Owners'));
    act(() => fireEvent.click(commentButton()));
    act(() => void addThread(handle.doc, { threadId: 'zz000001', tabId: 'tab2', blockId: 'a1', quote: 'Appendix', anchor: { kind: 'block' }, by: SESSION, at: Date.now() + 1 }));
    await until(() => dot('Appendix') !== null, 'the dots');
    expect(dot('Main')?.getAttribute('aria-label')).toBe('2 open comments');
    expect(dot('Appendix')?.getAttribute('aria-label')).toBe('1 open comment');
    expect(screen.getByRole('tab', { name: 'Main' }).getAttribute('aria-description')).toBe('2 open comments');
    act(() => void resolve(handle.doc, 'zz000001', { kind: 'human' }, Date.now() + 2));
    await until(() => dot('Appendix') === null, 'the resolved tab’s dot to go');
    expect(dot('Main')).not.toBeNull();
  });
});

// P4-B1 (tracker L275): a document of one tab names no tab in the passage it hands the surface, so a tab title that
// differs from the document's does not label the comment card and the side thread "title, tab title"; with several
// tabs the shown tab is named.
describe('the commented passage’s tab title', () => {
  it('is empty in a one-tab document and the shown tab’s title once there are more', async () => {
    const { editor, opened } = await mount(content());
    act(() => void select(editor(), 'ships quarterly'));
    act(() => fireEvent.click(commentButton()));
    expect(opened[0]!.tabTitle).toBe('');
    world!.host.write((d) => addTab(d, { title: 'Appendix', id: 'tab2', body: schemaFor().nodeFromJSON(doc(para('a1', 'Appendix text.'))) }));
    await until(() => screen.queryByRole('tab', { name: 'Appendix' }) !== null, 'the second tab');
    act(() => void select(editor(), 'Owners'));
    act(() => fireEvent.click(commentButton()));
    expect(opened[1]!.tabTitle).toBe('Main');
  });
});
