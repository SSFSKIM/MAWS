// The margin in DocumentEditor (happy-dom; P4-B1, docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md D1 to
// D5, D9 to D12; the prior art's P1 to P6, R1 to R6, N1 to N6, Z1 to Z3, Z5, K1, K4 and the activation table). The
// geometry is a stub (margin-test-support.ts): the scene names each passage's first line box and each card's height,
// and the suite reads the transforms the layout wrote. The threads come from the editor's own Comment command and
// from the agent's bare replica (its reply, its resolve), so the human-only rule is exercised end to end.
import type { Editor, JSONContent } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ICON_GAP_PX, MARGIN_CARD_INSET_PX, MARGIN_GAP_PX } from '../../../comments/margin-layout';
import { CARD_MIN_PX, ICON_PX, MARGIN_PAGE_GUTTER_PX } from '../../../comments/margin-tiers';
import chromeCss from '../chrome.css?raw';
import type { CommentsView } from '../../../comments/view';
import { addTab } from '../../tabs';
import { addThread, getThread, reopen, reply, resolve } from '../../threads';
import { DocumentEditor, type DocumentRail } from '../DocumentEditor';
import type { DocumentHandle } from '../host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from '../memory-host';
import { TAB, World, doc, para, until } from '../test-world';
import { MARGIN_SETTLE_MAX_MS, MARGIN_SETTLE_QUIET_MS } from './margin-settle';
import { resetScene, resized, scene, shiftOf, stubCoords, stubGeometry, topOf, unstubGeometry } from './margin-test-support';
import { MarginThreads } from './MarginThreads';
import { activeThread, commentDisplayKey, commentSelection, pinnedThread } from './plugins';
import type { CommentOverlayProps, CommentedPassage, DocumentComments } from './surface';
import { agentActor, findPos, now, owner as ownerActor, select } from './test-support';

// P4-B1: the shared card counted as it renders (passed through), so a case can show a thread's change leaves another
// thread's card alone
const cardRenders = vi.hoisted(() => new Map<string, number>());
vi.mock('../../../comments/ThreadCard', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../comments/ThreadCard')>();
  return {
    ...original,
    ThreadCard: (props: Parameters<typeof original.ThreadCard>[0]) => {
      cardRenders.set(props.thread.id, (cardRenders.get(props.thread.id) ?? 0) + 1);
      return original.ThreadCard(props);
    },
  };
});

let world: World | null = null;
let handles: DocumentHandle[] = [];
beforeEach(() => {
  resetScene();
  stubGeometry();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  unstubGeometry();
  for (const handle of handles) handle.close();
  handles = [];
  world?.destroy();
  world = null;
});

const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });

interface Mounted {
  editor: () => Editor;
  handle: DocumentHandle;
  agent: DocumentHandle;
  opened: CommentedPassage[];
  overlay: () => CommentOverlayProps | null;
  overlays: number;
  rerender(props: Partial<{ rail: DocumentRail; commentsView: CommentsView }>): void;
  rails: DocumentRail[];
}

const content = () => doc(para('p1', 'The plan ships quarterly with design review notes.'), para('p2', 'Owners track the budget closely.'), para('p3', 'Third paragraph keeps going here.'));

async function mount(content: JSONContent, initial: { rail?: DocumentRail; commentsView?: CommentsView; surface?: boolean } = {}): Promise<Mounted> {
  world = new World(content);
  const handle = openMemoryHandle(world.host, { log: () => {} });
  const agent = await world.bare();
  handles.push(handle);
  await whenSynced(handle);
  let current: Editor | null = null;
  const opened: CommentedPassage[] = [];
  let overlay: CommentOverlayProps | null = null;
  const state = { overlays: 0 };
  const comments: DocumentComments = {
    opened: (passage) => opened.push(passage),
    overlay: (props) => {
      overlay = props;
      state.overlays += 1;
      return <div data-testid="overlay" data-comment-card="" data-placement={props.placement ?? 'frame'} />; // the card's attribute, as P2's host draws it
    },
  };
  const rails: DocumentRail[] = [];
  let props = { rail: initial.rail ?? null, commentsView: initial.commentsView ?? 'expand' };
  // the host holds the rail (the tab's state): the editor's report becomes the prop, as DocumentPanel does
  let view: ReturnType<typeof render> | null = null;
  const element = (): JSX.Element => (
    <DocumentEditor
      artifactId="doc1"
      handle={handle}
      host={owner}
      onEditor={(e) => {
        current = e;
        if (e) stubCoords(e); // P4-B1: the margin anchors through coordsAtPos
      }}
      {...(initial.surface !== false && { comments })}
      rail={props.rail}
      onRailChange={(rail) => {
        rails.push(rail);
        props = { ...props, rail };
        view?.rerender(element());
      }}
      commentsView={props.commentsView}
      onCommentsViewChange={() => {}}
    />
  );
  view = render(element());
  await until(() => current !== null && current.getText().length > 0, 'the editor to bind');
  return {
    editor: () => current!,
    handle,
    agent,
    opened,
    overlay: () => overlay,
    get overlays() {
      return state.overlays;
    },
    rerender: (next) => {
      props = { ...props, ...next };
      view!.rerender(element());
    },
    rails,
  };
}

/** A thread on `needle` written from the editor, its line placed at `top` in the scene. */
function comment(m: Mounted, id: string, needle: string, top: number, body = `About ${needle}`): void {
  scene.lines.set(id, { top, height: 20 });
  act(() => {
    select(m.editor(), needle);
    commentSelection(m.editor(), m.handle.doc, { threadId: id, tabId: TAB, by: ownerActor, at: now(), body });
    m.editor().commands.setActiveThread(id); // as the editor's Comment command draws the new thread
  });
}
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 80))); // use-threads' quiet moment (the panel's)
const frame = () => act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
// P4-B1 (the follow-up wave): past the edits' quiet, by when the pass they owe has run (margin-settle.ts; happy-dom has no
// idle callback, so the pass is a task of its own right after the quiet)
const afterEdits = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, MARGIN_SETTLE_QUIET_MS + 50)));
const type =(m: Mounted, text: string, at: string) => act(() => m.editor().view.dispatch(m.editor().state.tr.insertText(text, findPos(m.editor(), at))));
const margin = () => screen.queryByRole('region', { name: 'Comments' });
const entry = (id: string) => document.querySelector<HTMLElement>(`[data-margin-entry="${id}"]`);
const relayouts = () => Number(margin()?.getAttribute('data-relayouts') ?? 0);
const frames = () => Number(document.querySelector('.ds-doc')?.getAttribute('data-frames') ?? 0); // the page frame's callbacks run
const reserve = () => margin()?.style.getPropertyValue('--doc-margin-reserve') ?? null;
const cardWidth = () => margin()?.style.getPropertyValue('--doc-margin-card') ?? null; // P4-B1: the drawn card's width
const overlap = () => margin()?.style.getPropertyValue('--doc-margin-overlap') ?? null;
// P4-B1 (the follow-up wave): from now until `stop`, each entry's top as the passes wrote it, in order, with whether the
// column animated when it was written (each record's value is the next record's old value, or the value at the end).
// happy-dom reports an old value of '' as null, so `data-animate` (always '') is mirrored as `data-animate-seen`, on or
// off, at each set and removal, and that is what is read
function recordWrites(): { stop(): Array<{ id: string; top: number | null; animated: boolean }> } {
  const root = margin()!;
  const set = root.setAttribute.bind(root);
  const remove = root.removeAttribute.bind(root);
  const sets = vi.spyOn(root, 'setAttribute').mockImplementation((name, value) => {
    set(name, value);
    if (name === 'data-animate') set('data-animate-seen', 'on');
  });
  const removes = vi.spyOn(root, 'removeAttribute').mockImplementation((name) => {
    remove(name);
    if (name === 'data-animate') set('data-animate-seen', 'off');
  });
  const initially = root.hasAttribute('data-animate');
  const seen: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => seen.push(...batch));
  observer.observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-animate-seen', 'style'] });
  return {
    stop: () => {
      const records = [...seen, ...observer.takeRecords()].filter((record) => (record.target === root ? record.attributeName === 'data-animate-seen' : (record.target as HTMLElement).dataset.marginEntry !== undefined));
      observer.disconnect();
      sets.mockRestore();
      removes.mockRestore();
      const value = (i: number) => {
        const later = records.slice(i + 1).find((next) => next.target === records[i]!.target && next.attributeName === records[i]!.attributeName);
        return later ? later.oldValue : (records[i]!.target as Element).getAttribute(records[i]!.attributeName!); // an old value of null: absent then
      };
      const out: Array<{ id: string; top: number | null; animated: boolean }> = [];
      let animated = initially;
      records.forEach((record, i) => {
        if (record.target === root) return void (animated = value(i) === 'on');
        const styled = document.createElement('div');
        styled.setAttribute('style', value(i) ?? '');
        const id = (record.target as HTMLElement).dataset.marginEntry!;
        const top = topOf(styled);
        if (out.findLast((w) => w.id === id)?.top !== top) out.push({ id, top, animated });
      });
      return out;
    },
  };
}
// ⌃⌘ and a key, as the keyboard sends it (activation.dom.test.tsx's: Ctrl off a Mac, one ctrlKey here)
const chord = (editor: Editor, key: string): boolean => {
  const event = new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, metaKey: /Mac/.test(navigator.platform), bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
};
const plainClick = (m: Mounted, needle: string) => {
  const pos = findPos(m.editor(), needle);
  act(() => {
    m.editor().commands.setTextSelection(pos);
    m.editor().view.someProp('handleClick', (f) => f(m.editor().view, pos, new MouseEvent('click', { bubbles: true })));
  });
};

describe('placement (P1 to P6) and the stack (L1, L2)', () => {
  it('puts each card at its passage’s first line, in document order, the column reserved only while a thread is open (N6)', async () => {
    const m = await mount(content());
    expect(margin()).not.toBeNull();
    expect(reserve()).toBe('0px'); // nothing open: the page centred alone
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'track the budget', 300);
    await settle();
    // the scene's 584 px of side space (LC-1 item 6): the page centred with its gutter and the least card (the reserve),
    // the card widening into the space on its right to 584 − 138 (the page's left) − 26 − 25
    expect(reserve()).toBe(`${MARGIN_PAGE_GUTTER_PX + CARD_MIN_PX}px`);
    expect(cardWidth()).toBe('395px');
    expect(topOf(entry('t1'))).toBe(140 - scene.columnTop + MARGIN_CARD_INSET_PX); // P1: the line's top, in the column's coordinates, plus the card's inset
    expect(topOf(entry('t2'))).toBe(300 - scene.columnTop + MARGIN_CARD_INSET_PX);
    expect(margin()!.style.getPropertyValue('--doc-margin-height')).toBe(`${300 - scene.columnTop + MARGIN_CARD_INSET_PX + scene.entryHeight + MARGIN_GAP_PX}px`); // L6
  });

  it('stacks colliding cards by the gap, the pinned one at its anchor and no card shifted, its neighbour pushed (L2, L3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 200);
    comment(m, 't2', 'track the budget', 210); // 10 px under t1's line: no room for t1's 60 px card between them
    await settle();
    expect(activeThread(m.editor().state)).toBe('t2'); // the last comment written is active (the editor's rule), and pinned
    expect(pinnedThread(m.editor().state)).toBe('t2');
    expect(topOf(entry('t2'))).toBe(110 + MARGIN_CARD_INSET_PX);
    expect(shiftOf(entry('t2'))).toBe(0); // Docs marks the active card by its elevation, not a shift (LC-1 item 2)
    expect(topOf(entry('t1'))).toBe(110 + MARGIN_CARD_INSET_PX - MARGIN_GAP_PX - scene.entryHeight); // pushed up above the active one
    act(() => void m.editor().commands.setActiveThread('t1'));
    expect(topOf(entry('t1'))).toBe(100 + MARGIN_CARD_INSET_PX);
    expect(shiftOf(entry('t1'))).toBe(0);
    expect(topOf(entry('t2'))).toBe(100 + MARGIN_CARD_INSET_PX + scene.entryHeight + MARGIN_GAP_PX); // pushed down below it
    expect(shiftOf(entry('t2'))).toBe(0);
    expect(margin()!.hasAttribute('data-animate')).toBe(true); // an activation animates
    // L5: with the active one too close to the top for the card above, the card above takes the top and the active
    // one leaves its anchor by the overshoot alone
    scene.lines.set('t1', { top: 140, height: 20 });
    scene.lines.set('t2', { top: 150, height: 20 });
    act(() => void m.editor().commands.setActiveThread('t2'));
    expect(topOf(entry('t1'))).toBe(0);
    expect(topOf(entry('t2'))).toBe(scene.entryHeight + MARGIN_GAP_PX);
  });

  // P4-B1: the anchor is the character after the passage's first position (`coordsAtPos(from, 1)`), so a passage that
  // starts at a soft wrap anchors on the line its first character is drawn on, not at the end of the line above
  it('anchors a passage starting at a soft wrap on its first character’s line (P6)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'keeps going', 400);
    await settle();
    scene.lines.set('t1', { top: 420, beforeTop: 400, height: 20 }); // before the position: the line above's end
    type(m, ' ', 'Owners');
    await afterEdits();
    expect(topOf(entry('t1'))).toBe(420 - scene.columnTop + MARGIN_CARD_INSET_PX);
  });
});

// P4-B1 (D2 as Docs, LC-1 item 3): the stack is walked from the pin, the last thread the human activated, which a
// deselect keeps; a resolve of the pinned thread drops it and the stack relaxes to the plain walk
describe('the pin (D2, LC-1 item 3)', () => {
  const SIX = ['The plan', 'ships', 'quarterly', 'design', 'review notes', 'Owners'] as const;
  const ids = SIX.map((_, i) => `s${i + 1}`);
  const topsOf = () => ids.map((id) => topOf(entry(id)));
  const anchor = 600 - 100 + MARGIN_CARD_INSET_PX; // the scene's column at 100
  const step = 60 + MARGIN_GAP_PX; // the scene's entries 60 tall

  it('keeps the stack where the pin left it when a click on plain text clears the active thread', async () => {
    const m = await mount(content());
    SIX.forEach((needle, i) => comment(m, ids[i]!, needle, 600)); // six comments on one line, the last active
    await settle();
    const pinned = ids.map((_, i) => anchor - (ids.length - 1 - i) * step); // walked up from the last
    expect(topsOf()).toEqual(pinned);
    plainClick(m, 'Third');
    expect(activeThread(m.editor().state)).toBeNull();
    expect(pinnedThread(m.editor().state)).toBe('s6');
    await settle();
    expect(topsOf()).toEqual(pinned); // not relaxed: the plain walk would put the first card at the line
  });

  it('relaxes the stack to the plain walk, animated, when the pinned thread resolves', async () => {
    const m = await mount(content());
    SIX.slice(0, 3).forEach((needle, i) => comment(m, ids[i]!, needle, 600));
    await settle();
    plainClick(m, 'Third');
    await settle();
    expect(topsOf().slice(0, 3)).toEqual([anchor - 2 * step, anchor - step, anchor]);
    act(() => resolve(m.agent.doc, 's3', agentActor, now(), 'agent'));
    await settle();
    expect(pinnedThread(m.editor().state)).toBeNull();
    expect(entry('s3')).toBeNull();
    expect(topsOf().slice(0, 2)).toEqual([anchor, anchor + step]); // the plain downward walk from the line
    expect(margin()!.hasAttribute('data-animate')).toBe(true);
  });

  it('animates the stack’s move when a click on another passage moves the pin', async () => {
    const m = await mount(content());
    SIX.slice(0, 3).forEach((needle, i) => comment(m, ids[i]!, needle, 600));
    await settle();
    plainClick(m, 'Third');
    await settle();
    margin()!.removeAttribute('data-animate'); // the activations' attribute cleared, to read the next pass's
    // a click on the first passage: the pin on s1, the stack walked down from its line
    const pos = findPos(m.editor(), 'The plan') + 1;
    const { node } = m.editor().view.domAtPos(pos);
    const target = node.nodeType === Node.TEXT_NODE ? node.parentElement! : (node as Element);
    let event: MouseEvent | null = null;
    target.addEventListener('click', (e) => void (event = e as MouseEvent), { once: true });
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    act(() => void m.editor().view.someProp('handleClick', (f) => f(m.editor().view, pos, event!)));
    expect(pinnedThread(m.editor().state)).toBe('s1');
    expect(topsOf().slice(0, 3)).toEqual([anchor, anchor + step, anchor + 2 * step]);
    expect(margin()!.hasAttribute('data-animate')).toBe(true);
  });
});

describe('re-layout (R1 to R6)', () => {
  // P4-B1 (the follow-up wave): an edit owes the pass rather than running it in the frame that paints the edit; the card
  // follows its line once the edits pause
  it('an edit moves the card with its line once the edits pause, not in the edit’s frame, without animation (R1), and a scroll runs no layout (R4)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'track the budget', 300);
    await settle();
    const before = relayouts();
    scene.lines.set('t1', { top: 320, height: 20 }); // the line moved down one line
    act(() => m.editor().view.dispatch(m.editor().state.tr.insertText('X', findPos(m.editor(), 'The plan'))));
    await frame();
    expect(relayouts(), 'nothing measured in the edit’s frame').toBe(before);
    expect(topOf(entry('t1'))).toBe(300 - scene.columnTop + MARGIN_CARD_INSET_PX);
    await afterEdits();
    expect(topOf(entry('t1'))).toBe(320 - scene.columnTop + MARGIN_CARD_INSET_PX);
    expect(margin()!.hasAttribute('data-animate')).toBe(false);
    const after = relayouts();
    expect(after).toBe(before + 1);
    const scroller = document.querySelector('.ds-doc')!;
    fireEvent.scroll(scroller);
    await frame();
    expect(relayouts()).toBe(after);
  });

  // P4-B1 (review finding 1; the follow-up wave): the page counts the frame callbacks that ran (an edit's, an agent's, the
  // layer's growth), against which the scale gate reads the margin's passes; edits in a run of frames run none in their
  // frames, and one pass once they pause
  it('counts the frame callbacks on the page; edits run no pass in their frames and one once they pause (D13)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'track the budget', 300);
    await settle();
    const [frames0, passes0] = [frames(), relayouts()];
    for (const text of ['a', 'b', 'c']) {
      type(m, text, 'The plan');
      await frame();
    }
    expect(frames() - frames0).toBe(3);
    expect(relayouts() - passes0).toBe(0);
    type(m, 'x', 'The plan');
    type(m, 'y', 'The plan'); // the same frame
    await frame();
    expect(frames() - frames0).toBe(4);
    expect(relayouts() - passes0).toBe(0);
    await afterEdits();
    expect(relayouts() - passes0).toBe(1);
    expect(Number(margin()!.dataset.staleMax)).toBeLessThanOrEqual(MARGIN_SETTLE_MAX_MS); // the wait, written for the scale gate
  });

  // P4-B1 (the follow-up wave): under edits that never pause the margin is never stale past the ceiling
  it('under edits that never pause, a pass reads them within the ceiling (margin-settle.ts)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'track the budget', 300);
    await settle();
    const passes0 = relayouts();
    margin()!.removeAttribute('data-stale-max');
    const started = performance.now();
    let firstPass: number | null = null;
    for (let k = 1; performance.now() - started < MARGIN_SETTLE_MAX_MS + 400; k += 1) {
      scene.lines.set('t1', { top: 300 + k, height: 20 }); // every keystroke moves the line
      type(m, 'z', 'The plan');
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));
      if (firstPass === null && relayouts() > passes0) firstPass = performance.now() - started;
    }
    expect(firstPass, 'a pass while the edits went on').not.toBeNull();
    expect(firstPass!).toBeLessThanOrEqual(MARGIN_SETTLE_MAX_MS + 60); // the ceiling, read at the 60 ms steps
    expect(Number(margin()!.dataset.staleMax)).toBeLessThanOrEqual(MARGIN_SETTLE_MAX_MS);
    await afterEdits();
    expect(topOf(entry('t1'))).toBe(Math.round(scene.lines.get('t1')!.top) - scene.columnTop + MARGIN_CARD_INSET_PX); // settled at the last line
  });

  // P4-B1: the move needs no React render (the cards' elements and their transforms are left as the pass wrote them);
  // the follow-up wave: the pass the edits owe, once they pause
  it('the edits’ pass moves the cards with no render, the active card unshifted (R1)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'track the budget', 300);
    await settle();
    expect(activeThread(m.editor().state)).toBe('t2');
    const card = within(entry('t2')!).getByRole('group');
    scene.lines.set('t2', { top: 320, height: 20 });
    act(() => m.editor().view.dispatch(m.editor().state.tr.insertText('X', findPos(m.editor(), 'The plan'))));
    await new Promise((r) => setTimeout(r, MARGIN_SETTLE_QUIET_MS + 50)); // outside act: nothing React does may help
    expect(topOf(entry('t2'))).toBe(320 - scene.columnTop + MARGIN_CARD_INSET_PX);
    expect(shiftOf(entry('t2'))).toBe(0);
    expect(within(entry('t2')!).getByRole('group')).toBe(card);
    // a re-render that runs no pass (a reply being typed in the active card) keeps the transform
    act(() => fireEvent.change(within(entry('t2')!).getByRole('textbox', { name: 'Reply' }), { target: { value: 'Typing a reply' } }));
    expect(shiftOf(entry('t2'))).toBe(0);
    expect(topOf(entry('t2'))).toBe(320 - scene.columnTop + MARGIN_CARD_INSET_PX);
  });

  // P4-B1 (D4): an add's or an activation's move stays animated through the follow-up pass the mounted card's height
  // asks for; an edit's pass is not animated
  it('keeps an add and an activation animated through the follow-up pass, an edit’s pass not (D4)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    scene.heights.set('t2', 90);
    comment(m, 't2', 'track the budget', 180);
    await settle(); // the add: t2's entry mounts, its height read, the stack re-laid a microtask later
    expect(topOf(entry('t1'))).toBe(180 - scene.columnTop + MARGIN_CARD_INSET_PX - MARGIN_GAP_PX - scene.entryHeight); // pushed up by the active t2
    expect(topOf(entry('t2'))).toBe(180 - scene.columnTop + MARGIN_CARD_INSET_PX);
    expect(margin()!.hasAttribute('data-animate')).toBe(true);
    scene.heights.set('t1', 120); // the activated card grows its reply field
    act(() => void m.editor().commands.setActiveThread('t1'));
    await act(() => Promise.resolve()); // the follow-up passes' microtask
    expect(margin()!.hasAttribute('data-animate')).toBe(true);
    expect(topOf(entry('t2'))).toBe(140 - scene.columnTop + MARGIN_CARD_INSET_PX + 120 + MARGIN_GAP_PX); // laid with the grown height
    // P4-B1: an edit's pass that moves nothing leaves the attribute (a running transition goes on); one that moves a card
    // is not animated
    type(m, 'X', 'Third');
    await afterEdits();
    expect(margin()!.hasAttribute('data-animate')).toBe(true);
    scene.lines.set('t1', { top: 160, height: 20 }); // a line typed above t1's passage
    type(m, 'X', 'Third');
    await afterEdits();
    expect(topOf(entry('t1'))).toBe(160 - scene.columnTop + MARGIN_CARD_INSET_PX);
    expect(margin()!.hasAttribute('data-animate')).toBe(false);
  });

  // P4-B1 (D4, Z1): a resolve closes the stack up animated. The display's redraw for the threads map reaches the margin
  // before React's re-read of the list, so that first pass, the one that moves the cards, carries the cause 'set'
  it('animates the close-up after a resolve, from the display’s redraw on (D4, Z1)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'design review', 150);
    comment(m, 't3', 'track the budget', 160);
    await settle();
    // the pin on t1 (a deselect keeps it, LC-1 item 3), so the stack walks down from t1's anchor and the resolve of t2
    // closes it up under t1
    act(() => void m.editor().commands.setActiveThread('t1'));
    act(() => void m.editor().commands.setActiveThread(null));
    const stacked = 140 - scene.columnTop + MARGIN_CARD_INSET_PX;
    const step = scene.entryHeight + MARGIN_GAP_PX;
    expect(topOf(entry('t3'))).toBe(stacked + 2 * step);
    scene.lines.set('t1', { top: 160, height: 20 }); // a line typed above: an edit's move, not animated
    scene.lines.set('t2', { top: 170, height: 20 });
    scene.lines.set('t3', { top: 180, height: 20 });
    type(m, 'X', 'The plan');
    await afterEdits();
    expect(margin()!.hasAttribute('data-animate')).toBe(false);
    // the margin's attribute and t3's transform in the order they were written, each with the value it was written to
    // (the next record's old value, or the value at the end), so a later pass re-setting the attribute cannot make a
    // move already written look animated
    const root = margin()!;
    const t3 = entry('t3')!;
    const seen: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => seen.push(...batch));
    observer.observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-animate', 'style'] });
    act(() => resolve(m.agent.doc, 't2', agentActor, now(), 'agent'));
    await settle();
    expect(entry('t2')).toBeNull();
    expect(topOf(entry('t3'))).toBe(stacked + 20 + step); // closed up under t1
    const records = [...seen, ...observer.takeRecords()].filter((record) => (record.target === root && record.attributeName === 'data-animate') || (record.target === t3 && record.attributeName === 'style'));
    observer.disconnect();
    const written = records.map((record, i) => records.slice(i + 1).find((later) => later.target === record.target && later.attributeName === record.attributeName)?.oldValue ?? (record.target as Element).getAttribute(record.attributeName!));
    const styled = (style: string) => {
      const element = document.createElement('div');
      element.setAttribute('style', style);
      return element;
    };
    let animated = false;
    const moves: boolean[] = [];
    records.forEach((record, i) => {
      if (record.target === root) animated = written[i] !== null;
      else if (topOf(styled(written[i] ?? '')) === stacked + 20 + step) moves.push(animated);
    });
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every(Boolean)).toBe(true); // the close-up written while the margin animates
  });

  // P4-B1 (the follow-up wave, D4): an activation over a margin the edits left stale catches the margin up; the edits'
  // moves are written unanimated first (from the stack as last laid), then the activation's own moves animated
  it('an activation over a stale margin lands the edits’ moves unanimated, then its own animated (D4)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 200);
    comment(m, 't2', 'track the budget', 210); // 10 px under t1's: t2 pinned, t1 pushed up above it
    await settle();
    const step = scene.entryHeight + MARGIN_GAP_PX;
    expect([topOf(entry('t1')), topOf(entry('t2'))]).toEqual([114 - step, 114]);
    scene.lines.set('t1', { top: 220, height: 20 }); // a line typed above both
    scene.lines.set('t2', { top: 230, height: 20 });
    type(m, 'X', 'The plan');
    await frame();
    const passes0 = relayouts();
    const writes = recordWrites();
    act(() => void m.editor().commands.setActiveThread('t1')); // the human's: the pin to t1
    const written = writes.stop();
    expect(relayouts() - passes0, 'the catch-up and the activation, at once').toBe(2);
    // the edits' moves (t2 still pinned): t2 at its new line, t1 pushed above it, unanimated
    expect(written.filter((w) => w.top === 134 || w.top === 134 - step)).toEqual([
      { id: 't1', top: 134 - step, animated: false },
      { id: 't2', top: 134, animated: false },
    ]);
    // the activation's (t1 pinned): t1 at its line, t2 pushed below it, animated
    expect(written.filter((w) => w.top === 124 || w.top === 124 + step)).toEqual([
      { id: 't1', top: 124, animated: true },
      { id: 't2', top: 124 + step, animated: true },
    ]);
    await afterEdits();
    expect(relayouts() - passes0, 'nothing left owed').toBe(2);
  });

  // P4-B1 (the follow-up wave, D4, Z1): a resolve over a margin the edits left stale catches it up with the resolved
  // card still in the stack (at the anchor last measured for it), so the edits' moves land unanimated and the close-up
  // is the resolve's own, animated
  it('a resolve over a stale margin lands the edits’ moves unanimated, then the close-up animated (D4, Z1)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'design review', 150);
    comment(m, 't3', 'track the budget', 160);
    await settle();
    act(() => void m.editor().commands.setActiveThread('t1')); // the pin on t1: the stack walks down from its anchor
    act(() => void m.editor().commands.setActiveThread(null));
    const stacked = 140 - scene.columnTop + MARGIN_CARD_INSET_PX;
    const step = scene.entryHeight + MARGIN_GAP_PX;
    expect(['t1', 't2', 't3'].map((id) => topOf(entry(id)))).toEqual([stacked, stacked + step, stacked + 2 * step]);
    scene.lines.set('t1', { top: 160, height: 20 }); // a line typed above all three
    scene.lines.set('t2', { top: 170, height: 20 });
    scene.lines.set('t3', { top: 180, height: 20 });
    type(m, 'X', 'The plan');
    await frame();
    const writes = recordWrites();
    act(() => resolve(m.agent.doc, 't2', agentActor, now(), 'agent')); // within the edits' quiet
    await settle();
    const written = writes.stop();
    expect(entry('t2')).toBeNull();
    expect(written).toEqual([
      // the edits' moves, t2 still stacked between: all three down a line, unanimated
      { id: 't1', top: stacked + 20, animated: false },
      { id: 't2', top: stacked + 20 + step, animated: false },
      { id: 't3', top: stacked + 20 + 2 * step, animated: false },
      // the resolve's close-up under t1, animated
      { id: 't3', top: stacked + 20 + step, animated: true },
    ]);
  });

  // P4-B1 (the follow-up wave): the human's own changes re-lay at once, and settle what the edits owed
  it('a frame resize, a card’s resize, a font load and a view change re-lay at once, settling a pass the edits owed', async () => {
    const fonts = new EventTarget();
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    try {
      const m = await mount(content());
      comment(m, 't1', 'track the budget', 300);
      await settle();
      let line = 300;
      const edit = async () => {
        line += 20;
        scene.lines.set('t1', { top: line, height: 20 });
        type(m, 'X', 'The plan');
        await frame();
      };
      const at = () => topOf(entry('t1'));
      const fresh = () => line - scene.columnTop + MARGIN_CARD_INSET_PX;
      await edit();
      const passes0 = relayouts();
      resized((target) => target.classList.contains('doc-page-frame')); // the window or the panel resized
      await frame();
      expect([relayouts() - passes0, at()]).toEqual([1, fresh()]);
      await edit();
      scene.heights.set('t1', 90); // a reply field growing
      resized((target) => (target as HTMLElement).dataset.marginEntry !== undefined);
      expect([relayouts() - passes0, at()]).toEqual([2, fresh()]);
      await edit();
      act(() => void fonts.dispatchEvent(new Event('loadingdone')));
      expect([relayouts() - passes0, at()]).toEqual([3, fresh()]);
      await edit();
      expect(relayouts() - passes0).toBe(3);
      m.rerender({ commentsView: 'minimize' });
      expect(margin()!.dataset.marginTier).toBe('icons');
      expect(relayouts() - passes0).toBeGreaterThanOrEqual(4);
      expect(at()).toBe(fresh());
      const passes1 = relayouts();
      await afterEdits();
      expect(relayouts(), 'no pass left owed').toBe(passes1);
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });

  // P4-B1 (review finding 7): at a Comment the host names the compose card's thread before the display draws its
  // passage (a microtask later), so the first pass puts the entry at the column's top (the rule for another tab's
  // thread); the pass that then finds the passage writes the entry at its line with no transition, so the card appears
  // there rather than flying in, while the neighbour it pushes in that pass moves animated
  it('a compose card hosted before its passage is drawn appears at its line, its neighbour’s push animated (D4)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 240);
    await settle();
    act(() => void m.editor().commands.setActiveThread(null));
    const root = margin()!;
    const seen: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => seen.push(...batch));
    observer.observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-animate', 'style'] });
    scene.lines.set('t2', { top: 250, height: 20 }); // 10 px under t1's line: t2, active, pushes t1 up
    act(() => m.overlay()!.hosting?.('t2')); // the host's card opened on it, its passage not drawn yet
    await act(() => Promise.resolve());
    act(() => {
      select(m.editor(), 'track the budget');
      commentSelection(m.editor(), m.handle.doc, { threadId: 't2', tabId: TAB, by: ownerActor, at: now(), body: '' });
      m.overlay()!.setActive('t2');
    });
    await settle();
    const anchor = 250 - scene.columnTop + MARGIN_CARD_INSET_PX;
    const pushed = anchor - MARGIN_GAP_PX - scene.entryHeight;
    expect(topOf(entry('t2'))).toBe(anchor);
    expect(topOf(entry('t1'))).toBe(pushed);
    expect(entry('t2')!.style.transition).toBe(''); // the jump's override cleared
    const records = [...seen, ...observer.takeRecords()].filter((record) => record.target === root ? record.attributeName === 'data-animate' : record.attributeName === 'style');
    observer.disconnect();
    const written = records.map((record, i) => records.slice(i + 1).find((later) => later.target === record.target && later.attributeName === record.attributeName)?.oldValue ?? (record.target as Element).getAttribute(record.attributeName!));
    const styled = (style: string) => {
      const element = document.createElement('div');
      element.setAttribute('style', style);
      return element;
    };
    let animated = false;
    const writes: Array<{ id: string; top: number | null; transition: string; animated: boolean }> = [];
    records.forEach((record, i) => {
      if (record.target === root) animated = written[i] !== null;
      else {
        const id = (record.target as HTMLElement).dataset.marginEntry;
        const style = styled(written[i] ?? '');
        if (id !== undefined) writes.push({ id, top: topOf(style), transition: style.style.transition, animated });
      }
    });
    const t2 = writes.filter((w) => w.id === 't2');
    expect(t2.some((w) => w.top !== anchor)).toBe(true); // the first pass's top, unlocated
    expect(t2.find((w) => w.top === anchor)?.transition).toBe('none'); // written at its line unanimated (then the override cleared)
    const t1 = writes.filter((w) => w.id === 't1' && w.top === pushed);
    expect(t1).toEqual([{ id: 't1', top: pushed, transition: '', animated: true }]); // the push in the same pass, animated
  });

  // P4-B1 (Z3): what is drawn is the display's decorations, which an undo brings back with the mark in one transaction,
  // so a passage deleted and restored at once has its card back at the next frame, and no pass searches the page
  it('a passage deleted and restored by undo within 100 ms has its card back, and no pass queries the page (Z3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'track the budget', 300);
    await settle();
    const queries = vi.spyOn(m.editor().view.dom, 'querySelectorAll');
    const from = findPos(m.editor(), 'ships quarterly');
    act(() => m.editor().view.dispatch(m.editor().state.tr.delete(from, from + 'ships quarterly'.length)));
    await frame();
    expect(entry('t1')).toBeNull(); // the orphan leaves at the edit's frame
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    act(() => void m.editor().commands.undo());
    await frame();
    expect(entry('t1')).not.toBeNull();
    expect(topOf(entry('t1'))).toBe(140 - scene.columnTop + MARGIN_CARD_INSET_PX);
    expect(entry('t2')).not.toBeNull();
    expect(queries.mock.calls.filter(([selector]) => selector === '[data-thread]')).toHaveLength(0);
  });

  // P4-B1 (the follow-up wave, Z3): the compose card's thread stays an entry once its passage is deleted, at the column's
  // top, so the deletion and its undo keep the same ids while they move it between its line and the top; each re-lays in
  // its edit's frame
  it('a hosted compose card’s passage deleted and restored by undo re-lays in each edit’s frame (Z3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 240);
    await settle();
    act(() => m.overlay()!.hosting?.('t1'));
    expect(entry('t1')!.hasAttribute('data-compose')).toBe(true);
    const line = 240 - scene.columnTop + MARGIN_CARD_INSET_PX;
    expect(topOf(entry('t1'))).toBe(line);
    const from = findPos(m.editor(), 'ships quarterly');
    act(() => m.editor().view.dispatch(m.editor().state.tr.delete(from, from + 'ships quarterly'.length)));
    await frame();
    expect(topOf(entry('t1')), 'at the column’s top, its inset below it').toBe(MARGIN_CARD_INSET_PX);
    act(() => void m.editor().commands.undo());
    await frame();
    expect(topOf(entry('t1'))).toBe(line);
  });

  // P4-B1 (R2): the margin reads the threads map at once, so an agent's reply shows in its card while the owner types,
  // with no pause in the typing
  it('shows an agent’s reply in its card while the owner keeps typing (R2)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'track the budget', 300);
    await settle();
    type(m, 'X', 'Third');
    act(() => reply(m.agent.doc, 't1', { id: 't1:m2', by: agentActor, at: now(), body: 'Answered mid-typing.' }, 'agent'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    type(m, 'Y', 'Third');
    await frame();
    expect(within(entry('t1')!).getByText('Answered mid-typing.')).toBeDefined();
  });

  it('an agent’s reply grows a card and re-lays the cards below it; the active thread stays (R2, R3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'track the budget', 230); // 90 px under: room for t1's 60 px card and the gap
    await settle();
    act(() => void m.editor().commands.setActiveThread('t2'));
    expect(topOf(entry('t2'))).toBe(130 + MARGIN_CARD_INSET_PX);
    act(() => reply(m.agent.doc, 't1', { id: 't1:m1', by: agentActor, at: now(), body: 'A long reply that grows the card.' }, 'agent'));
    await settle();
    scene.heights.set('t1', 120); // the reply doubled the card
    resized();
    expect(activeThread(m.editor().state)).toBe('t2'); // R3: the agent changed nothing here
    expect(topOf(entry('t2'))).toBe(130 + MARGIN_CARD_INSET_PX); // the active card stays at its anchor
    expect(topOf(entry('t1'))).toBe(130 + MARGIN_CARD_INSET_PX - MARGIN_GAP_PX - 120); // t1 pushed up to make room
  });

  // P4-B1: the list follows the threads map; an unchanged thread keeps its object and its card is not drawn again
  it('an agent’s reply re-renders only that thread’s card', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'track the budget', 300);
    await settle();
    const before = { t1: cardRenders.get('t1') ?? 0, t2: cardRenders.get('t2') ?? 0 };
    expect(before.t2).toBeGreaterThan(0);
    act(() => reply(m.agent.doc, 't1', { id: 't1:m1', by: agentActor, at: now(), body: 'The agent answers here.' }, 'agent'));
    await settle();
    expect(within(entry('t1')!).getByText('The agent answers here.')).toBeDefined();
    expect(cardRenders.get('t1')).toBeGreaterThan(before.t1);
    expect(cardRenders.get('t2')).toBe(before.t2);
  });

  it('a tab switch shows only that tab’s open threads (R5)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    act(() => void addTab(m.handle.doc, { title: 'Second', id: 'tab2' }));
    addThread(m.handle.doc, { threadId: 'tx', tabId: 'tab2', blockId: 'tab2-block', quote: 'elsewhere', anchor: { kind: 'block' }, by: ownerActor, at: now(), body: 'On the other tab' });
    await settle();
    expect(entry('t1')).not.toBeNull();
    expect(entry('tx')).toBeNull();
  });
});

describe('the tiers (N1 to N6) and the view states', () => {
  // P4-B1 (LC-1 item 6's sweep): the page centred with its gutter and the least card while they fit, the card taking
  // what is free on its right; then the page giving way to the box's left edge, the reserve rising to the least card and
  // both gutters (333); under that the icon rail, hanging over the page's right padding when even it is short
  it('cards narrow to the least card as the page gives way (N1, N6), then the icon rail over the page (N2), then off under 720 px (N3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    expect(margin()!.dataset.marginTier).toBe('cards');
    scene.scrollWidth = 816 + 400; // the page 46 px from the box's left: a card 400 − 46 − 26 − 25 wide
    resized();
    expect([reserve(), cardWidth()]).toEqual(['308px', '303px']);
    scene.scrollWidth = 816 + 333; // the page at the box's left edge: the least card and both gutters
    resized();
    expect([margin()!.dataset.marginTier, reserve(), cardWidth()]).toEqual(['cards', '333px', `${CARD_MIN_PX}px`]);
    scene.scrollWidth = 816 + 332; // under the least card: icons, the rail an icon and both gutters wide
    resized();
    expect([margin()!.dataset.marginTier, reserve(), overlap()]).toEqual(['icons', '83px', '0px']);
    scene.scrollWidth = 816 + 60; // the rail hangs 23 px over the page's right padding
    resized();
    expect([margin()!.dataset.marginTier, reserve(), overlap()]).toEqual(['icons', '60px', '23px']);
    // the rail is moved by `left` from the overlap, never by a negative margin (which would shrink the row `.ds-doc`
    // centres and push the page right; the e2e icon-tier case measures it): no margin on the column, chrome.css reads it
    expect(margin()!.style.marginLeft).toBe('');
    const rule = /\n\.doc-margin \{([^}]*)\}/.exec(chromeCss)?.[1] ?? '';
    expect(rule).toContain('left: calc(-1 * var(--doc-margin-overlap, 0px));');
    expect(rule).not.toMatch(/margin(-left)?:/);
    expect(within(margin()!).getByRole('button', { name: /^Comment by You/ })).toBeDefined();
    scene.bodyWidth = 600; // the drawer's range: the margin is off
    resized();
    expect(margin()).toBeNull();
  });

  // P4-B1 (N2 on LC-1 item 7): Docs' Minimize stacked three threads on adjacent lines as three icons 46 px apart, the
  // first at its line + 4; none merged
  it('three threads on adjacent lines give three icons stacked by the icon gap; a click opens the overlaid card, active (N2)', async () => {
    const m = await mount(content(), { commentsView: 'minimize' });
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'design review', 160);
    comment(m, 't3', 'track the budget', 180);
    await settle();
    act(() => void m.editor().commands.setActiveThread('t1')); // the pin on the first: the stack walks down from it
    act(() => void m.editor().commands.setActiveThread(null));
    expect(margin()!.dataset.marginTier).toBe('icons');
    const icons = within(margin()!).getAllByRole('button', { name: /^Comment by/ });
    expect(icons).toHaveLength(3);
    expect(icons.map((icon) => icon.textContent)).toEqual(['', '', '']);
    const first = 140 - scene.columnTop + MARGIN_CARD_INSET_PX;
    expect(['t1', 't2', 't3'].map((id) => topOf(entry(id)))).toEqual([first, first + ICON_PX + ICON_GAP_PX, first + 2 * (ICON_PX + ICON_GAP_PX)]);
    act(() => fireEvent.click(icons[0]!));
    expect(activeThread(m.editor().state)).toBe('t1');
    expect(margin()!.querySelector('.doc-margin-overlay [data-thread="t1"]')).not.toBeNull();
    act(() => fireEvent.keyDown(within(margin()!.querySelector<HTMLElement>('.doc-margin-overlay')!).getByRole('group'), { key: 'j' }));
    expect(activeThread(m.editor().state)).toBe('t2'); // J reaches the next icon's thread
    expect(margin()!.querySelector('.doc-margin-overlay [data-thread="t2"]')).not.toBeNull();
    act(() => fireEvent.click(within(entry('t2')!).getByRole('button', { name: /^Comment by/ }))); // the open card's icon closes it
    expect(activeThread(m.editor().state)).toBeNull();
  });

  it('Minimize gives the icon rail at any width, Hide no margin, and Expand the cards again (N5)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    expect(margin()!.dataset.marginTier).toBe('cards');
    m.rerender({ commentsView: 'minimize' });
    expect(margin()!.dataset.marginTier).toBe('icons');
    m.rerender({ commentsView: 'hide' });
    expect(margin()).toBeNull();
    // Hide draws the passages plain (LC-1 item 7: Docs drops the highlights), through the tab editor's view state that
    // chrome.css reads; the display's decoration stays, so Expand brings the highlight back with no redraw
    expect(document.querySelector('.doc-tab-editor[data-comments-view="hide"]')).not.toBeNull();
    expect(m.editor().view.dom.querySelector('.comment-t1')).not.toBeNull();
    m.rerender({ commentsView: 'expand' });
    expect(margin()!.dataset.marginTier).toBe('cards');
  });
});

describe('resolve, orphans, the panel (Z1 to Z3, Z5) and the rail state (D5)', () => {
  // P4-B1 (D13): a redraw for the threads map that changes nothing draws decorations equal to the last ones (their specs
  // compare shallowly), so the view re-patches no commented node
  it('a redraw for the same threads draws equal decorations, text and block', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    act(() => addThread(m.handle.doc, { threadId: 'b1', tabId: TAB, blockId: 'p3', quote: 'Third paragraph keeps going here.', anchor: { kind: 'block' }, by: ownerActor, at: now() }, 'test'));
    await settle();
    const drawn = () => commentDisplayKey.getState(m.editor().state)!.decorations.find() as unknown as Array<{ spec: { blockComment?: true }; eq(other: unknown): boolean }>;
    const before = drawn();
    expect(before.some((decoration) => decoration.spec.blockComment === true)).toBe(true);
    act(() => m.editor().view.dispatch(m.editor().state.tr.setMeta(commentDisplayKey, { threads: true }).setMeta('addToHistory', false)));
    const after = drawn();
    expect(after).toHaveLength(before.length);
    expect(after.every((decoration, i) => decoration !== before[i] && decoration.eq(before[i]))).toBe(true);
  });

  it('resolving removes the card and keeps the mark, the margin un-reserved after the last; reopening brings it back (Z1, Z2)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    expect(reserve()).not.toBe('0px');
    act(() => resolve(m.agent.doc, 't1', agentActor, now(), 'agent'));
    await settle();
    expect(entry('t1')).toBeNull();
    expect(m.editor().view.dom.querySelector('[data-thread="t1"]')).not.toBeNull();
    expect(reserve()).toBe('0px');
    expect(document.querySelector('[data-margin-live]')?.textContent).toContain('Comment resolved'); // K4
    act(() => reopen(m.handle.doc, 't1', ownerActor, now(), 'test'));
    await settle();
    expect(entry('t1')).not.toBeNull();
  });

  it('a passage deleted whole takes its card out; the thread stays open as an orphan in the panel; undo brings the card back (Z3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    const from = findPos(m.editor(), 'ships quarterly');
    act(() => m.editor().view.dispatch(m.editor().state.tr.delete(from, from + 'ships quarterly'.length)));
    await settle();
    expect(entry('t1')).toBeNull();
    expect(getThread(m.handle.doc, 't1')?.status).toBe('open');
    m.rerender({ rail: 'comments' });
    const panel = screen.getByRole('complementary', { name: 'Comments' });
    expect(within(panel).queryByText('The commented passage was removed.')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Show deleted-target comments' }));
    expect(within(panel).getByText('The commented passage was removed.')).toBeDefined();
    m.rerender({ rail: null });
    act(() => void m.editor().commands.undo());
    await settle();
    expect(entry('t1')).not.toBeNull();
  });

  it('opening the panel takes the cards out of the margin and closing it brings them back with the same active thread (Z5); a margin thread active reports the rail state margin (D5)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    expect(m.rails).toContain('margin');
    m.rerender({ rail: 'comments' });
    expect(margin()).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBeDefined();
    m.rerender({ rail: null });
    expect(margin()).not.toBeNull();
    expect(activeThread(m.editor().state)).toBe('t1');
    expect(entry('t1')!.hasAttribute('data-active')).toBe(true);
    act(() => void m.editor().commands.setActiveThread(null));
    expect(m.rails[m.rails.length - 1]).toBeNull();
  });

  // P4-B1 (the activation table): an All comments item chosen while the margin would host closes the panel; the margin
  // returns with that thread active and the rail state is margin
  it('choosing an item in the panel closes it and the margin returns with that thread active (D5)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'track the budget', 300);
    await settle();
    m.rerender({ rail: 'comments' });
    await settle();
    const panel = screen.getByRole('complementary', { name: 'Comments' });
    act(() => fireEvent.click(within(panel.querySelector<HTMLElement>('[data-thread="t1"]')!).getByRole('button', { name: /^Show/ })));
    await settle();
    expect(screen.queryByRole('complementary', { name: 'Comments' })).toBeNull();
    expect(margin()).not.toBeNull();
    expect(activeThread(m.editor().state)).toBe('t1');
    expect(entry('t1')!.hasAttribute('data-active')).toBe(true);
    expect(m.rails.slice(-2)).toEqual([null, 'margin']);
  });

  // P4-B1 (review finding 2): an orphan has no passage for the margin to draw it beside, so choosing it keeps the panel
  it('choosing an orphan in the panel keeps the panel open, its card the only place it shows (Z3, D5)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    const from = findPos(m.editor(), 'ships quarterly');
    act(() => m.editor().view.dispatch(m.editor().state.tr.delete(from, from + 'ships quarterly'.length)));
    await settle();
    m.rerender({ rail: 'comments' });
    await settle();
    const panel = screen.getByRole('complementary', { name: 'Comments' });
    const told = m.rails.length;
    fireEvent.click(within(panel).getByRole('button', { name: 'Show deleted-target comments' }));
    act(() => fireEvent.click(within(panel.querySelector<HTMLElement>('[data-thread="t1"]')!).getByRole('button', { name: /^Show/ })));
    await settle();
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBe(panel);
    expect(m.rails.slice(told)).toEqual([]); // the panel not closed
  });

  // P4-B1 (review finding 2, with finding 3): the panel decides from its own layout whether the margin would host (the
  // margin is not drawn while the panel is), so a body narrowed under the panel keeps it open on a choice, as the drawer
  it('choosing an item in a panel narrowed to the drawer keeps it open (D5, N3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    m.rerender({ rail: 'comments' });
    await settle();
    scene.bodyWidth = 600;
    m.rerender({}); // the rail's layout re-reads the body after the editor draws
    const panel = screen.getByRole('complementary', { name: 'Comments' });
    act(() => fireEvent.click(within(panel.querySelector<HTMLElement>('[data-thread="t1"]')!).getByRole('button', { name: /^Show/ })));
    await settle();
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBe(panel);
  });

  // P4-B1 (review finding 3): the margin tells its tier while it draws and off when it goes (the panel opening, Hide),
  // never off between two renders of a drawn margin
  it('reports its tier while drawn and off once it goes, not between renders', async () => {
    const m = await mount(content(), { commentsView: 'hide' }); // the editor's own margin not drawn
    const seen: string[] = [];
    const Margin = ({ onTier }: { onTier(tier: { kind: string }): void }) => (
      <div className="doc-editor-body">
        <div className="ds-doc">
          <div className="ds-doc-page" />
          <MarginThreads editor={m.editor()} doc={m.handle.doc} tabId={TAB} author={{ actor: ownerActor, now }} readOnly={false} view="expand" hosting={null} overlay={null} onComment={null} onTier={onTier} drafts={new Map()} onDraftChange={() => {}} />
        </div>
      </div>
    );
    const view = render(<Margin onTier={(tier) => void seen.push(tier.kind)} />);
    expect(seen[seen.length - 1]).toBe('cards');
    seen.length = 0;
    view.rerender(<Margin onTier={(tier) => void seen.push(`again:${tier.kind}`)} />); // a new callback, the same tier
    expect(seen).toEqual([]);
    view.unmount();
    expect(seen).toEqual(['again:off']);
  });

  // P4-B1 (X36's draft rule: a hidden card keeps its draft, one draft per thread): the reply drafts are the editor's,
  // so the margin and the panel draw the same draft and neither unmounting loses it
  it('keeps a reply typed in a margin card across the panel’s round trip, the panel showing the same draft (Z5, X36)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    const field = () => within(entry('t1')!).getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
    act(() => fireEvent.change(field(), { target: { value: 'Half a reply' } }));
    m.rerender({ rail: 'comments' });
    await settle();
    const panel = screen.getByRole('complementary', { name: 'Comments' });
    expect((within(panel.querySelector<HTMLElement>('[data-thread="t1"]')!).getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement).value).toBe('Half a reply');
    m.rerender({ rail: null });
    expect(field().value).toBe('Half a reply');
  });
});

describe('the activation table and the keys', () => {
  // P4-B1 (review finding 4): with no margin to host it (Hide, a narrow body), a chord's activation opens the panel as a
  // click's does; the caret's never (D5)
  it('a chord activating a passage with the margin hidden opens the panel; the caret does not', async () => {
    const m = await mount(content(), { commentsView: 'hide' });
    comment(m, 't1', 'ships quarterly', 140);
    act(() => void m.editor().commands.setActiveThread(null));
    await settle();
    m.rails.length = 0;
    act(() => m.editor().commands.setTextSelection(findPos(m.editor(), 'ships quarterly') + 2)); // the caret into the passage
    expect(activeThread(m.editor().state)).toBe('t1');
    expect(m.rails).not.toContain('comments');
    act(() => m.editor().commands.setTextSelection(findPos(m.editor(), 'The plan')));
    act(() => void m.editor().commands.setActiveThread(null));
    act(() => void chord(m.editor(), 'n'));
    act(() => void chord(m.editor(), 'c'));
    expect(activeThread(m.editor().state)).toBe('t1');
    expect(m.rails[m.rails.length - 1]).toBe('comments');
  });

  it('a click on a card activates it; a click on plain text clears it; J and K move; U returns to the text (K1, K3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'track the budget', 300);
    await settle();
    plainClick(m, 'Third');
    expect(activeThread(m.editor().state)).toBeNull();
    const card1 = within(entry('t1')!).getByRole('group', { name: /^You: About ships quarterly \(1 of 2\)/ });
    fireEvent.click(card1);
    expect(activeThread(m.editor().state)).toBe('t1');
    fireEvent.keyDown(card1, { key: 'j' });
    expect(activeThread(m.editor().state)).toBe('t2');
    const card2 = within(entry('t2')!).getByRole('group');
    fireEvent.keyDown(card2, { key: 'k' });
    expect(activeThread(m.editor().state)).toBe('t1');
    fireEvent.keyDown(card1, { key: 'u' });
    expect(document.activeElement).toBe(m.editor().view.dom);
    expect(activeThread(m.editor().state)).toBe('t1'); // U keeps the thread in the cards tier
  });

  it('the compose card is hosted in the margin at its thread, in place of that thread’s card, while the surface says so', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    expect(screen.queryByTestId('overlay')?.dataset.placement).toBe('margin');
    act(() => m.overlay()!.hosting?.('t1'));
    const hosted = entry('t1')!;
    expect(hosted.hasAttribute('data-compose')).toBe(true);
    expect(within(hosted).queryByRole('group')).toBeNull();
    expect(within(hosted).getByTestId('overlay')).toBeDefined();
    expect(margin()!.querySelector('[data-margin-entry][data-compose] [data-comment-card]')).not.toBeNull(); // the e2e cases' selector
    act(() => m.overlay()!.hosting?.(null));
    expect(within(entry('t1')!).getByRole('group')).toBeDefined();
  });

  // P4-B1: in the icon tier the compose card sits in the entry's overlay beside the dot; the entry carries data-compose
  // as in the cards tier, so one selector finds the hosted card in both
  it('the compose card is hosted in the icon tier’s overlay, its entry marked as the cards tier’s is', async () => {
    const m = await mount(content(), { commentsView: 'minimize' });
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    expect(margin()!.dataset.marginTier).toBe('icons');
    act(() => m.overlay()!.hosting?.('t1'));
    expect(entry('t1')!.hasAttribute('data-compose')).toBe(true);
    expect(entry('t1')!.querySelector('.doc-margin-overlay [data-testid="overlay"]')).not.toBeNull();
    expect(margin()!.querySelector('[data-margin-entry][data-compose] [data-comment-card]')).not.toBeNull();
    act(() => m.overlay()!.hosting?.(null));
    expect(entry('t1')!.hasAttribute('data-compose')).toBe(false);
  });

  it('the Add comment button sits at the selection head’s line while text is selected and the editor focused (C1)', async () => {
    const m = await mount(content());
    act(() => m.editor().view.dom.focus());
    expect(within(margin()!).queryByRole('button', { name: 'Add comment' })).toBeNull();
    vi.spyOn(m.editor().view, 'coordsAtPos').mockReturnValue({ top: 250, bottom: 270, left: 100, right: 100 });
    act(() => void select(m.editor(), 'track the budget'));
    const add = within(margin()!).getByRole('button', { name: 'Add comment' });
    expect(topOf(add)).toBe(250 - scene.columnTop);
    fireEvent.click(add);
    expect(document.activeElement).toBe(m.editor().view.dom);
    expect(m.opened).toHaveLength(1);
    expect(m.opened[0]!.quote).toBe('track the budget');
  });
});
