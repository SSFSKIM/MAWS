// The margin in DocumentEditor (happy-dom; P4-B1, docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md D1 to
// D5, D9 to D12; the prior art's P1 to P6, R1 to R6, N1 to N6, Z1 to Z3, Z5, K1, K4 and the activation table). The
// geometry is a stub (margin-test-support.ts): the scene names each passage's first line box and each card's height,
// and the suite reads the transforms the layout wrote. The threads come from the editor's own Comment command and
// from the agent's bare replica (its reply, its resolve), so the human-only rule is exercised end to end.
import type { Editor, JSONContent } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARGIN_ACTIVE_SHIFT_PX, MARGIN_GAP_PX } from '../../../comments/margin-layout';
import { CARD_MAX_PX } from '../../../comments/margin-tiers';
import type { CommentsView } from '../../../comments/view';
import { addTab } from '../../tabs';
import { addThread, getThread, reply, resolve } from '../../threads';
import { DocumentEditor, type DocumentRail } from '../DocumentEditor';
import type { DocumentHandle } from '../host-types';
import { memoryEditorHost, openMemoryHandle, whenSynced } from '../memory-host';
import { TAB, World, doc, para, ticks, until } from '../test-world';
import { resetScene, resized, scene, shiftOf, stubGeometry, topOf } from './margin-test-support';
import { activeThread, commentSelection } from './plugins';
import type { CommentOverlayProps, CommentedPassage, DocumentComments } from './surface';
import { agentActor, findPos, now, owner as ownerActor, select } from './test-support';

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
      return <div data-testid="overlay" data-placement={props.placement ?? 'frame'} />;
    },
  };
  const rails: DocumentRail[] = [];
  let props = { rail: initial.rail ?? null, commentsView: initial.commentsView ?? 'expand' };
  const element = () => <DocumentEditor artifactId="doc1" handle={handle} host={owner} onEditor={(e) => (current = e)} {...(initial.surface !== false && { comments })} rail={props.rail} onRailChange={(rail) => rails.push(rail)} commentsView={props.commentsView} onCommentsViewChange={() => {}} />;
  const view = render(element());
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
      view.rerender(element());
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
  });
}
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 80))); // use-threads' quiet moment
const margin = () => screen.queryByRole('region', { name: 'Comments' });
const entry = (id: string) => document.querySelector<HTMLElement>(`[data-margin-entry="${id}"]`);
const relayouts = () => Number(margin()?.getAttribute('data-relayouts') ?? 0);
const reserve = () => margin()?.style.getPropertyValue('--doc-margin-reserve') ?? null;
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
    expect(reserve()).toBe(`${CARD_MAX_PX + 2 * MARGIN_GAP_PX}px`);
    expect(topOf(entry('t1'))).toBe(140 - scene.columnTop); // P1: the line's top, in the column's coordinates
    expect(topOf(entry('t2'))).toBe(300 - scene.columnTop);
    expect(margin()!.style.getPropertyValue('--doc-margin-height')).toBe(`${300 - scene.columnTop + scene.entryHeight + MARGIN_GAP_PX}px`); // L6
  });

  it('stacks colliding cards by the gap, the active one pinned at its anchor and shifted left, its neighbour pushed (L2, L3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'track the budget', 150); // 10 px under t1's line: no room for t1's 60 px card
    await settle();
    expect(activeThread(m.editor().state)).toBe('t2'); // the last comment written is active (the editor's rule)
    expect(topOf(entry('t2'))).toBe(50);
    expect(shiftOf(entry('t2'))).toBe(-MARGIN_ACTIVE_SHIFT_PX);
    expect(topOf(entry('t1'))).toBe(50 - MARGIN_GAP_PX - scene.entryHeight); // pushed up above the active one
    act(() => void m.editor().commands.setActiveThread('t1'));
    expect(topOf(entry('t1'))).toBe(40);
    expect(shiftOf(entry('t1'))).toBe(-MARGIN_ACTIVE_SHIFT_PX);
    expect(topOf(entry('t2'))).toBe(40 + scene.entryHeight + MARGIN_GAP_PX); // pushed down below it
    expect(shiftOf(entry('t2'))).toBe(0);
    expect(margin()!.hasAttribute('data-animate')).toBe(true); // an activation animates
  });

  it('skips a zero-width first rect at a soft wrap (P6) and anchors a block thread at its block', async () => {
    const m = await mount(content());
    comment(m, 't1', 'keeps going', 400);
    await settle();
    // the span's first client rect is empty: the next one is the line
    const span = m.editor().view.dom.querySelector('[data-thread="t1"]')!;
    vi.spyOn(span, 'getClientRects').mockImplementation(() => [new DOMRect(0, 0, 0, 0), new DOMRect(120, 420, 200, 20)] as unknown as DOMRectList);
    act(() => m.editor().view.dispatch(m.editor().state.tr.insertText(' ', findPos(m.editor(), 'Owners'))));
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(topOf(entry('t1'))).toBe(420 - scene.columnTop);
  });
});

describe('re-layout (R1 to R6)', () => {
  it('an edit moves the card with its line in the same pass, without animation (R1), and a scroll runs no layout (R4)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'track the budget', 300);
    await settle();
    const before = relayouts();
    scene.lines.set('t1', { top: 320, height: 20 }); // the line moved down one line
    act(() => m.editor().view.dispatch(m.editor().state.tr.insertText('X', findPos(m.editor(), 'The plan'))));
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(topOf(entry('t1'))).toBe(320 - scene.columnTop);
    expect(margin()!.hasAttribute('data-animate')).toBe(false);
    const after = relayouts();
    expect(after).toBeGreaterThan(before);
    const scroller = document.querySelector('.ds-doc')!;
    fireEvent.scroll(scroller);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(relayouts()).toBe(after);
  });

  it('an agent’s reply grows a card and re-lays the cards below it; the active thread stays (R2, R3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'track the budget', 230); // 90 px under: room for t1's 60 px card and the gap
    await settle();
    act(() => void m.editor().commands.setActiveThread('t2'));
    expect(topOf(entry('t2'))).toBe(130);
    act(() => reply(m.agent.doc, 't1', { id: 't1:m1', by: agentActor, at: now(), body: 'A long reply that grows the card.' }, 'agent'));
    await settle();
    scene.heights.set('t1', 120); // the reply doubled the card
    resized();
    expect(activeThread(m.editor().state)).toBe('t2'); // R3: the agent changed nothing here
    expect(topOf(entry('t2'))).toBe(130); // the active card stays at its anchor
    expect(topOf(entry('t1'))).toBe(130 - MARGIN_GAP_PX - 120); // t1 pushed up to make room
  });

  it('a tab switch shows only that tab’s open threads (R5)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    act(() => addTab(m.handle.doc, 'Second', 'tab2'));
    addThread(m.handle.doc, { threadId: 'tx', tabId: 'tab2', blockId: null, quote: 'elsewhere', anchor: null, by: ownerActor, at: now(), body: 'On the other tab' });
    await settle();
    expect(entry('t1')).not.toBeNull();
    expect(entry('tx')).toBeNull();
  });
});

describe('the tiers (N1 to N6) and the view states', () => {
  it('cards shrink to the side space before anything collapses (N1), then the icon rail (N2), then off under 720 px (N3)', async () => {
    const m = await mount(content());
    comment(m, 't1', 'ships quarterly', 140);
    await settle();
    expect(margin()!.dataset.marginTier).toBe('cards');
    scene.scrollWidth = 816 + 250; // 250 of side space: a 234 px card
    resized();
    expect(reserve()).toBe('250px');
    scene.scrollWidth = 816 + 100; // under the card's minimum: icons
    resized();
    expect(margin()!.dataset.marginTier).toBe('icons');
    expect(within(margin()!).getByRole('button', { name: /^Comment by You/ })).toBeDefined();
    scene.bodyWidth = 600; // the drawer's range: the margin is off
    resized();
    expect(margin()).toBeNull();
  });

  it('icons closer than one icon merge into a count; a click opens the overlaid card, active (N2)', async () => {
    const m = await mount(content(), { commentsView: 'minimize' });
    comment(m, 't1', 'ships quarterly', 140);
    comment(m, 't2', 'design review', 150);
    await settle();
    act(() => void m.editor().commands.setActiveThread(null));
    expect(margin()!.dataset.marginTier).toBe('icons');
    const icons = within(margin()!).getAllByRole('button', { name: /^Comment by/ });
    expect(icons).toHaveLength(2);
    expect(icons[0]!.textContent).toBe('2'); // the first carries the count of the pair
    fireEvent.click(icons[0]!);
    expect(activeThread(m.editor().state)).toBe('t1');
    expect(margin()!.querySelector('.doc-margin-overlay [data-thread="t1"]')).not.toBeNull();
    fireEvent.click(icons[0]!); // the open icon again closes it
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
    expect(m.editor().view.dom.querySelector('.comment-t1')).not.toBeNull(); // the highlight stays (LC-1 item 7)
    m.rerender({ commentsView: 'expand' });
    expect(margin()!.dataset.marginTier).toBe('cards');
  });
});

describe('resolve, orphans, the panel (Z1 to Z3, Z5) and the rail state (D5)', () => {
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
    expect(screen.getByRole('status').textContent).toContain('Comment resolved'); // K4
    act(() => {
      const { reopen } = require('../../threads') as typeof import('../../threads');
      reopen(m.handle.doc, 't1', ownerActor, now(), 'test');
    });
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
});

describe('the activation table and the keys', () => {
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
    act(() => m.overlay()!.hosting?.(null));
    expect(within(entry('t1')!).getByRole('group')).toBeDefined();
  });

  it('the Add comment button sits at the selection head’s line while text is selected and the editor focused (C1)', async () => {
    const m = await mount(content());
    act(() => m.editor().commands.focus());
    expect(screen.queryByRole('button', { name: 'Add comment' })).toBeNull();
    vi.spyOn(m.editor().view, 'coordsAtPos').mockReturnValue({ top: 250, bottom: 270, left: 100, right: 100 });
    act(() => void select(m.editor(), 'track the budget'));
    const add = screen.getByRole('button', { name: 'Add comment' });
    expect(topOf(add)).toBe(250 - scene.columnTop);
    fireEvent.click(add);
    expect(m.opened).toHaveLength(1);
    expect(m.opened[0]!.quote).toBe('track the budget');
  });
});
