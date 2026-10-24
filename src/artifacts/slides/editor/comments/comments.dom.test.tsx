// P3-C M7 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; Acceptance 4's owner half under happy-dom): the
// deck editor's comments. Comment on the selected element writes its thread and hands it to the surface with the
// slide's number and title; the card's reach writes the thread (the sent comment, Resolve, an unsent draft withdrawn)
// and locates its element; no write of the comments is undone; the threads rail lists open, orphaned and resolved
// threads with Reply, Resolve and Reopen, and shows a thread's element; a pin sits at its element's top-right and
// follows a move. happy-dom lays nothing out, so the stage's nodes get the boxes their own px style says; the paint,
// the real card and the agent's tools are the e2e's and the host's tests.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommentOverlayProps, CommentedPassage, DocumentComments } from '../../../document/editor/comments/surface';
import { newDoc, transact, type Doc } from '../../../yjs';
import { deleteElementTree, importSlide, moveSlide, setStyle, setText, writeDeckKeys } from '../../model';
import * as Y from '../../../yjs/slides';
import { loadSlide } from '../../parse';
import { addThread, getThread, listThreads } from '../../threads';
import { DeckEditor } from '../DeckEditor';
import { DeckSession } from '../session';

const S1 = `<section id="s1" style="background:#ffffff; padding:128px">
<h2 id="title" style="font-size:64px">Plan</h2>
<p id="body" style="position:absolute; left:300px; top:400px; width:400px; height:100px">One path</p>
</section>`;
const S2 = `<section id="s2" style="background:#ffffff"><p id="lead" style="font-size:32px">Second</p></section>`;

function deck(): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'Q3', order: ['s1', 's2'] });
    [S1, S2].forEach((html, i) => {
      const l = loadSlide(html);
      if (!l.ok) throw new Error(l.held.reasons.join('; '));
      importSlide(doc, l.slide, `a${i}`);
    });
  });
  return doc;
}

/** A surface as the renderer's (B's `useDocumentComments`): what it was handed, and the overlay's latest reach. */
function surface() {
  const opened: CommentedPassage[] = [];
  const reach: { current: CommentOverlayProps | null } = { current: null };
  const value: DocumentComments = {
    opened: (passage) => opened.push(passage),
    overlay: (props) => {
      reach.current = props;
      return <div data-card-host />;
    },
  };
  return { value, opened, reach };
}

/** Every stage node a box from its own px style (pinned ones), else the slide's top-left; read live, so a move moves it. */
/** A token's effect on geometry with no deck write (fix wave 1): added to every element's left. */
const token = { shift: 0 };
function fakeLayout(container: HTMLElement): void {
  const root = container.querySelector<HTMLElement>('[data-stage-slide] .maws-slide')!;
  const px = (n: HTMLElement, k: string) => Number.parseFloat(n.style.getPropertyValue(k)) || 0;
  for (const n of root.querySelectorAll<HTMLElement>('[data-eid]')) {
    Object.defineProperty(n, 'offsetLeft', { configurable: true, get: () => px(n, 'left') + token.shift });
    Object.defineProperty(n, 'offsetTop', { configurable: true, get: () => px(n, 'top') });
    Object.defineProperty(n, 'offsetWidth', { configurable: true, get: () => px(n, 'width') });
    Object.defineProperty(n, 'offsetHeight', { configurable: true, get: () => px(n, 'height') });
    Object.defineProperty(n, 'offsetParent', { configurable: true, get: () => root });
  }
  Object.defineProperty(root, 'offsetWidth', { configurable: true, get: () => 1920 });
  Object.defineProperty(root, 'offsetHeight', { configurable: true, get: () => 1080 });
}

afterEach(cleanup);
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 80))); // the list's quiet moment

function mount({ withSurface = true, readOnly = false } = {}) {
  const doc = deck();
  const session = new DeckSession(doc, 0);
  const s = surface();
  let clock = 1_000; // each write a millisecond after the last, so threads list in the order they were made
  const utils = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={readOnly} comments={withSurface ? s.value : undefined} commentAuthor={{ actor: { kind: 'human' }, now: () => clock++ }} />);
  const toolbar = screen.getByRole('toolbar');
  return { doc, session, surface: s, toolbar, ...utils };
}

describe('comments on a deck’s elements (D9)', () => {
  it('Comment writes a thread on the one selected element and hands it to the surface with the slide’s number and title', () => {
    const { doc, session, surface: s, toolbar } = mount();
    const button = within(toolbar).getByRole('button', { name: 'Add comment' });
    expect(button).toHaveProperty('disabled', true);
    act(() => session.select(['body']));
    fireEvent.click(button);
    const [thread] = listThreads(doc);
    expect(thread).toMatchObject({ slideId: 's1', elementId: 'body', quote: 'One path', status: 'open', createdBy: { kind: 'human' }, createdAt: 1_000, messages: [] });
    expect(s.opened).toEqual([{ threadId: thread!.id, tabId: 's1', tabTitle: 'slide 1: Plan', quote: 'One path' }]);
    // ⌥⌘M on the stage does the same
    act(() => session.select(['title']));
    fireEvent.keyDown(document.querySelector('[data-stage-surface]')!, { key: 'µ', code: 'KeyM', altKey: true, metaKey: true });
    expect(listThreads(doc).map((t) => t.elementId)).toEqual(['body', 'title']);
    // the comments are no undo step: ⌘Z has nothing to take back
    expect(session.snapshot().canUndo).toBe(false);
  });

  it('the card’s reach records the sent comment, resolves and reopens, withdraws an unsent draft, and locates the element on the slide shown', () => {
    const { doc, session, surface: s } = mount();
    act(() => session.select(['body']));
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    const reach = s.reach.current!;
    const id = listThreads(doc)[0]!.id;
    // P4-B2: the card stands at the element's pin: where it will be (the element's top-right, the 20 px pin above it) until drawn
    expect(reach.locate(id)).toEqual({ x: 2, y: -20, width: 20, height: 20 }); // the element drawn at happy-dom's empty box
    act(() => reach.record(id, 'Shorter?'));
    act(() => reach.resolve(id));
    expect(getThread(doc, id)).toMatchObject({ status: 'resolved', messages: [{ body: 'Shorter?', by: { kind: 'human' }, at: 1_001 }] });
    act(() => reach.reopen(id));
    expect(getThread(doc, id)!.status).toBe('open');
    act(() => reach.discard(id)); // spoken in: kept
    expect(getThread(doc, id)).not.toBeNull();
    act(() => session.select(['title']));
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    const draft = listThreads(doc)[1]!.id;
    act(() => s.reach.current!.discard(draft));
    expect(getThread(doc, draft)).toBeNull();
    act(() => session.show('s2'));
    expect(s.reach.current!.locate(id)).toBeNull(); // its slide is not the one shown: the card stays where it is
    expect(session.snapshot().canUndo).toBe(false);
  });

  it('offers no Comment without a surface or on a read-only store; the rail still lists', async () => {
    const { session } = mount({ withSurface: false });
    expect(screen.queryByRole('button', { name: 'Add comment' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    expect(session.snapshot().rail).toBe('comments');
    expect(screen.getByRole('complementary', { name: 'Comments' }).textContent).toContain('No open comments');
    cleanup();
    mount({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'Add comment' })).toBeNull();
  });

  it('hides deleted-target comments and badges until explicitly revealed, keeping conversations and reply drafts through hide and undo (WR 49)', async () => {
    const { doc, session, toolbar } = mount();
    act(() => {
      addThread(doc, { threadId: 'live', slideId: 's1', elementId: 'body', quote: 'One path', by: { kind: 'human' }, at: 1, body: 'Keep this path.' });
      addThread(doc, { threadId: 'deleted', slideId: 's1', elementId: 'title', quote: 'Plan', by: { kind: 'human' }, at: 2, body: 'Shorter title?' });
    });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Comments (2 open)' }));
    const rail = screen.getByRole('complementary', { name: 'Comments' });
    const item = () => rail.querySelector<HTMLElement>('article[data-thread="deleted"]');
    act(() => session.edit((origin) => deleteElementTree(doc, 's1', 'title', origin)));
    await settle();
    expect(item()).toBeNull();
    expect(within(toolbar).getByRole('button', { name: 'Comments (1 open)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Slide 1, 1 open comment/ })).toBeTruthy();
    const reveal = () => within(rail).getByRole('button', { name: /^(Show|Hide) deleted-target comments$/ });
    const before = listThreads(doc);
    fireEvent.click(reveal());
    expect(reveal().getAttribute('aria-pressed')).toBe('true');
    expect(item()!.textContent).toContain('Shorter title?');
    fireEvent.change(within(item()!).getByRole('textbox', { name: 'Reply' }), { target: { value: 'Unsent reply' } });
    fireEvent.click(reveal());
    expect(item()).toBeNull();
    expect(listThreads(doc)).toEqual(before);
    fireEvent.click(reveal());
    expect(within(item()!).getByRole('textbox', { name: 'Reply' })).toHaveProperty('value', 'Unsent reply');
    fireEvent.click(within(item()!).getByRole('button', { name: 'Resolve' }));
    await settle();
    fireEvent.click(reveal());
    expect(item()).toBeNull(); // a deleted target stays hidden even after resolving its thread
    expect(within(rail).queryByRole('region', { name: /Resolved/ })).toBeNull();
    fireEvent.click(reveal());
    fireEvent.click(within(item()!).getByRole('button', { name: 'Reopen' }));
    await settle();
    fireEvent.click(reveal());
    act(() => session.undo.undo());
    await settle();
    expect(item()!.textContent).toContain('Shorter title?');
    expect(within(toolbar).getByRole('button', { name: 'Comments (2 open)' })).toBeTruthy();
  });

  it('the rail: open threads with their slide and quote, an orphan with its last text, Reply, Resolve and Reopen, and Show', async () => {
    const { doc, session, toolbar } = mount();
    act(() => session.select(['body']));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Add comment' }));
    act(() => session.select(['title']));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Add comment' }));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Comments (2 open)' }));
    await settle();
    const rail = screen.getByRole('complementary', { name: 'Comments' });
    const [body, title] = listThreads(doc).map((t) => t.id);
    const item = (id: string) => rail.querySelector<HTMLElement>(`article[data-thread="${id}"]`)!;
    expect(within(item(body!)).getByRole('button', { name: 'Show element: One path' }).textContent).toBe('Slide 1One path');

    // the slides re-ordered elsewhere: the thread names the slide's new number
    act(() => moveSlide(doc, 's1', 's2'));
    await settle();
    expect(within(item(body!)).getByRole('button', { name: 'Show element: One path' }).textContent).toBe('Slide 2One path');
    act(() => moveSlide(doc, 's1', null));
    await settle();

    // a reply typed and posted with Enter
    const field = within(item(body!)).getByRole('textbox', { name: 'Reply' });
    fireEvent.change(field, { target: { value: 'Cut it' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    expect(getThread(doc, body!)!.messages.map((m) => m.body)).toEqual(['Cut it']);
    expect(item(body!).textContent).toContain('Cut it');

    // the element deleted: orphaned, with its last text; a resolve moves it under Resolved, Reopen brings it back
    act(() => deleteElementTree(doc, 's1', 'title'));
    await settle();
    expect(item(title!)).toBeNull();
    fireEvent.click(within(rail).getByRole('button', { name: 'Show deleted-target comments' }));
    expect(item(title!).hasAttribute('data-orphan')).toBe(true);
    expect(item(title!).textContent).toContain('The commented element was deleted.');
    expect(item(title!).textContent).toContain('Plan');
    fireEvent.click(within(item(title!)).getByRole('button', { name: 'Resolve' }));
    await settle();
    expect(within(rail).getByRole('region', { name: 'Resolved (1)' }).contains(item(title!))).toBe(true);
    expect(within(toolbar).getByRole('button', { name: 'Comments (1 open)' })).toBeTruthy();
    fireEvent.click(within(item(title!)).getByRole('button', { name: 'Reopen' }));
    await settle();
    expect(getThread(doc, title!)!.status).toBe('open');

    // Show: the slide shown, the element selected, the thread current
    act(() => session.show('s2'));
    fireEvent.click(within(item(body!)).getByRole('button', { name: 'Show element: One path' }));
    expect(session.snapshot()).toMatchObject({ currentSlide: 's1', selection: ['body'] });
    expect(item(body!).getAttribute('aria-current')).toBe('true');
    expect(session.snapshot().canUndo).toBe(false);
  });

  // P4-B2: a pin opens its popover now (pin-popover.dom.test.tsx), not the rail
  it('distinguishes coincident identical comment targets in both pins and the rail', async () => {
    const { doc, session, container } = mount();
    fakeLayout(container);
    act(() => {
      setStyle(doc, 's1', 'title', { position: 'absolute', left: '300px', top: '400px', width: '400px', height: '100px' });
      setText(doc, 's1', 'title', [{ type: 'p', inline: [{ text: 'One path', marks: {} }] }]);
      for (const elementId of ['title', 'body']) addThread(doc, { threadId: elementId, slideId: 's1', elementId, quote: 'One path', by: { kind: 'human' }, at: 1, body: 'Change this one' });
      session.setZoom(0.5);
      session.toggleRail('comments');
    });
    await settle();
    const pins = [...container.querySelectorAll<HTMLElement>('[data-comment-pin]')];
    expect(pins).toHaveLength(2);
    expect(new Set(pins.map((pin) => pin.getAttribute('aria-label'))).size).toBe(2);
    const [a, b] = pins.map((pin) => ({ x: Number.parseFloat(pin.style.left), y: Number.parseFloat(pin.style.top) }));
    expect(Math.max(Math.abs(a!.x - b!.x), Math.abs(a!.y - b!.y))).toBeGreaterThanOrEqual(28);
    const targets = [...container.querySelectorAll('.deck-thread-quote')].map((node) => node.textContent);
    expect(new Set(targets).size).toBe(2);
  });

  it('a pin sits at its element’s top-right, follows a move, and is drawn active with its thread', async () => {
    const { doc, session, container } = mount();
    fakeLayout(container);
    act(() => session.select(['body']));
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await settle();
    act(() => session.setZoom(0.5));
    const scale = 0.5;
    const pin = () => container.querySelector<HTMLElement>('[data-comment-pin="body"]')!;
    expect([Number.parseFloat(pin().style.left), Number.parseFloat(pin().style.top)]).toEqual([(300 + 400) * scale, 400 * scale]);
    act(() => setStyle(doc, 's1', 'body', { left: '900px', top: '200px' }));
    await settle();
    expect([Number.parseFloat(pin().style.left), Number.parseFloat(pin().style.top)]).toEqual([(900 + 400) * scale, 200 * scale]);
    expect(pin().hasAttribute('data-active')).toBe(true); // Comment drew its thread active
    // deleted: no pin
    act(() => deleteElementTree(doc, 's1', 'body'));
    await settle();
    expect(container.querySelector('[data-comment-pin]')).toBeNull();
  });

  // fix wave 1: geometry a token moves, with no deck write (a design system's change re-lays the slide out)
  it('a pin and the card follow a layout pass with no deck write', async () => {
    const { session, container, surface: s } = mount();
    fakeLayout(container);
    act(() => session.setZoom(0.5));
    act(() => session.select(['body']));
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await settle();
    const pin = () => container.querySelector<HTMLElement>('[data-comment-pin="body"]')!;
    expect(Number.parseFloat(pin().style.left)).toBe((300 + 400) * 0.5);
    const key = s.reach.current!.layoutKey;
    token.shift = 100;
    try {
      // a design system's scope style rewritten: every canvas lays out again in the next frame
      const style = document.createElement('style');
      style.setAttribute('data-ds-scope-style', '');
      await act(async () => {
        document.head.appendChild(style);
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(Number.parseFloat(pin().style.left)).toBe((300 + 100 + 400) * 0.5);
      expect(s.reach.current!.layoutKey).not.toBe(key); // the card asks where its element is again
      style.remove();
    } finally {
      token.shift = 0;
    }
  });

  // fix wave 1: the session's undo is no removal writer: an undo that removes a commented element keeps its last text
  it('an undo that removes a commented element stores the text it had, under the comments’ origin', () => {
    const { doc, session } = mount();
    act(() => session.edit((origin) => transact(doc, () => Y.createElement(doc, 's1', 'q', { tag: 'p', parent: '', order: 'a9' }, [{ type: 'p', inline: [{ text: 'Old', marks: {} }] }]), origin)));
    act(() => session.edit((origin) => setText(doc, 's1', 'q', [{ type: 'p', inline: [{ text: 'New', marks: {} }] }], origin)));
    addThread(doc, { threadId: 'tq', slideId: 's1', elementId: 'q', quote: 'New', by: { kind: 'human' }, at: 1 }, 'deck-comments');
    act(() => session.undoStep()); // the typing
    act(() => session.undoStep()); // the creation
    expect(Y.hasElement(doc, 's1', 'q')).toBe(false);
    expect(getThread(doc, 'tq')!.quote).toBe('Old');
    expect(session.snapshot().canRedo).toBe(true);
    act(() => session.redoStep()); // the element back: its quote is derived again
    expect(getThread(doc, 'tq')!.quote).toBe('Old');
  });
});
