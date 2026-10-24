// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"): the gestures write what
// they should, one transaction per frame and one undo step per gesture; the stage's keys and the clipboard act on the
// selection. happy-dom lays nothing out, so the boxes the gestures measure are given to the nodes here (offsets from
// each element's own px style); the real layout, paint and pointer are the e2e's.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@tiptap/pm/view';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptClientId, applyV1, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { DesignWorkbench } from '../../../design/editor/DesignWorkbench';
import { DesignView } from '../../../design/editor/viewport';
import { design, heldPeer } from '../../../design/fixtures/support';
import { MISSING_SOURCE_KEY } from '../../../design/model';
import { SlideCanvas } from '../../canvas';
import { childLists, deleteElementTree, importSlide, readFlat, ROOT, setStyle, slideFile, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { DeckEditor } from '../DeckEditor';
import { ElementBar } from '../ElementBar';
import { DeckSession, type DeckSessionOptions } from '../session';
import { startFlowMove, startMarquee, startMove, startResize, startRotate, type GestureContext } from './gestures';
import { CLIPBOARD_TYPE, copySelection, pasteClipboard } from './clipboard';
import { apply, applyLinear } from '../../geometry';
import { selectionCommands } from './commands';
import { hitIds, measure } from './measure';
import { armedBox } from '../armed';
import { TextBox } from '../TextBox';
import { Overlay } from './Overlay';
import { cellGrid, slideTree } from './selection';

const SLIDE = `<section id="s" style="background:#ffffff">
<h2 id="title" style="font-size:64px">Title</h2>
<p id="body" style="font-size:32px">Body</p>
<div id="a" style="position:absolute; left:300px; top:300px; width:200px; height:100px; background:#ff0000"></div>
<div id="b" style="position:absolute; right:128px; bottom:128px; width:100px; height:100px; background:#0000ff"></div>
</section>`;

function deck(html = SLIDE): Doc {
  const doc = newDoc();
  const l = loadSlide(html);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

/** Gives every node the layout box its own px style says (and flow children a column from y = 0). */
function fakeLayout(canvas: SlideCanvas, flow: Record<string, [number, number, number, number]> = {}): void {
  layoutRoot(canvas.root, flow);
}
function layoutRoot(root: HTMLElement, flow: Record<string, [number, number, number, number]> = {}): void {
  const canvas = { root };
  // offsets are taken from the nearest positioned element (a group), else the slide
  const hostOf = (n: HTMLElement) => {
    for (let p = n.parentElement; p && p !== canvas.root; p = p.parentElement) if (p.style.position === 'absolute' || p.style.position === 'relative') return p;
    return canvas.root;
  };
  const define = (n: HTMLElement, x: number, y: number, w: number, h: number) => {
    Object.defineProperty(n, 'offsetLeft', { configurable: true, get: () => x });
    Object.defineProperty(n, 'offsetTop', { configurable: true, get: () => y });
    Object.defineProperty(n, 'offsetWidth', { configurable: true, get: () => w });
    Object.defineProperty(n, 'offsetHeight', { configurable: true, get: () => h });
    Object.defineProperty(n, 'offsetParent', { configurable: true, get: () => hostOf(n) });
  };
  for (const n of canvas.root.querySelectorAll<HTMLElement>('[data-eid]')) {
    const id = n.dataset.eid!;
    if (flow[id]) {
      define(n, ...flow[id]!);
      continue;
    }
    const v = (k: string) => Number.parseFloat(n.style.getPropertyValue(k)) || 0;
    const [w, h] = [v('width'), v('height')];
    const x = n.style.getPropertyValue('left') ? v('left') : 1920 - v('right') - w;
    const y = n.style.getPropertyValue('top') ? v('top') : 1080 - v('bottom') - h;
    define(n, x, y, w, h);
  }
  Object.defineProperty(canvas.root, 'offsetWidth', { configurable: true, get: () => 1920 });
  Object.defineProperty(canvas.root, 'offsetHeight', { configurable: true, get: () => 1080 });
}

const canvases: SlideCanvas[] = [];
function gestureContext(doc: Doc, flow?: Record<string, [number, number, number, number]>, options?: DeckSessionOptions): GestureContext & { session: DeckSession } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const canvas = new SlideCanvas(doc, 's', host);
  canvases.push(canvas);
  fakeLayout(canvas, flow);
  return { session: new DeckSession(doc, 0, options), slideId: 's', canvas, scale: 0.5 };
}
afterEach(() => {
  cleanup();
  canvases.splice(0).forEach((c) => c.dispose());
  document.body.replaceChildren();
});
const styleOf = (doc: Doc, id: string) => readFlat(doc, 's', false).find((e) => e.id === id)!.style;
const NO = { shift: false, alt: false, meta: false };
const reload = (doc: Doc) => {
  const l = loadSlide(slideFile(doc, 's'), { fileId: 's' });
  expect(l.ok && l.diagnostics).toEqual([]);
};

describe('the gestures', () => {
  it('a move writes left/top each frame, one transaction a frame, and undoes as one step', () => {
    const doc = deck();
    const ctx = gestureContext(doc);
    let updates = 0;
    const off = onUpdate(doc, () => updates++);
    const g = startMove(ctx, ['a'], { x: 400, y: 350 });
    g.frame({ x: 410, y: 350 }, NO);
    g.frame({ x: 437, y: 371 }, NO);
    g.end();
    off();
    expect(updates).toBe(2);
    expect(styleOf(doc, 'a')).toMatchObject({ left: '337px', top: '321px' });
    ctx.session.undoStep();
    expect(styleOf(doc, 'a')).toMatchObject({ left: '300px', top: '300px' });
  });

  it('snaps to the 128 px margin and the slide’s centre within 6 screen px, ⌘ suppressing it', () => {
    const doc = deck();
    const ctx = gestureContext(doc); // scale 0.5: 6 screen px are 12 slide px
    const g = startMove(ctx, ['a'], { x: 400, y: 350 });
    const f = g.frame({ x: 400 - 165, y: 350 }, NO); // left would be 135: 7 from the margin
    expect(styleOf(doc, 'a').left).toBe('128px');
    expect(f.guides.some((x) => x.axis === 'x' && x.at === 128)).toBe(true);
    g.frame({ x: 400 - 165, y: 350 }, { ...NO, meta: true });
    expect(styleOf(doc, 'a').left).toBe('135px');
    g.frame({ x: 400 + 559, y: 350 + 189 }, NO); // centre 959,539: to 960,540
    expect(styleOf(doc, 'a')).toMatchObject({ left: '860px', top: '490px' });
    g.end();
  });

  it('a right/bottom pin becomes left/top on the first frame, where the element is', () => {
    const doc = deck();
    const ctx = gestureContext(doc);
    const g = startMove(ctx, ['b'], { x: 0, y: 0 });
    g.frame({ x: 30, y: 0 }, { ...NO, meta: true });
    g.end();
    expect(styleOf(doc, 'b')).toMatchObject({ left: '1722px', top: '852px' });
    expect(styleOf(doc, 'b').right).toBeUndefined();
    expect(styleOf(doc, 'b').bottom).toBeUndefined();
    reload(doc);
  });

  it('resizes from a corner, Shift keeping the aspect, and rotates by the handle', () => {
    const doc = deck();
    const ctx = gestureContext(doc);
    const r = startResize(ctx, 'a', 'se', { x: 500, y: 400 });
    r.frame({ x: 600, y: 400 }, { ...NO, shift: true, meta: true });
    r.end();
    expect(styleOf(doc, 'a')).toMatchObject({ left: '300px', top: '300px', width: '300px', height: '150px' });
    fakeLayout(ctx.canvas); // laid out again at its new size
    const t = startRotate(ctx, 'a', { x: 450, y: 200 }); // the handle above its centre (450, 375)
    t.frame({ x: 1000, y: 375 }, NO); // right of its centre (450, 375): 90°
    t.frame({ x: 1000, y: 380 }, { ...NO, shift: true });
    t.end();
    expect(styleOf(doc, 'a').transform).toBe('rotate(90deg)');
    reload(doc);
  });

  it('first human movement fixes the slide layout without moving siblings, in one undo step', () => {
    const doc = deck();
    const ctx = gestureContext(doc, { title: [128, 128, 1664, 80], body: [128, 240, 1664, 45] });
    const before = slideFile(doc, 's');
    const g = startFlowMove(ctx, 'title', { x: 300, y: 150 });
    g.frame({ x: 350, y: 300 }, { ...NO, meta: true });
    g.end();
    expect(styleOf(doc, 'title')).toMatchObject({ position: 'absolute', left: '178px', top: '278px', width: '1664px', height: '80px' });
    expect(styleOf(doc, 'body')).toMatchObject({ position: 'absolute', left: '128px', top: '240px', width: '1664px', height: '45px' });
    reload(doc);
    ctx.session.undoStep();
    expect(slideFile(doc, 's')).toBe(before);
  });

  it('detach freezes every sibling at its measured position instead of leaving a reflow gap', () => {
    const doc = deck();
    const ctx = gestureContext(doc, { title: [128, 128, 1664, 80], body: [128, 240, 1664, 45] });
    expect(selectionCommands(ctx, ['title'], false).detach()).toBeNull();
    expect(styleOf(doc, 'title')).toMatchObject({ position: 'absolute', top: '128px' });
    expect(styleOf(doc, 'body')).toMatchObject({ position: 'absolute', top: '240px' });
    reload(doc);
  });

});

describe('the always-available Arrange menu', () => {
  function mount(ctx = gestureContext(deck())) {
    const props = { session: ctx.session, slideId: ctx.slideId, canvas: ctx.canvas, scale: ctx.scale, onInsert: vi.fn(), onNotice: vi.fn(), inspectorOpen: false, onToggleInspector: vi.fn() };
    const utils = render(<ElementBar {...props} readOnly={false} />);
    const user = userEvent.setup();
    const choose = async (name: string) => {
      await user.click(screen.getByRole('button', { name: 'Arrange' }));
      await user.click(screen.getByRole('menuitem', { name }));
    };
    return { ...utils, ...ctx, doc: ctx.session.doc, user, choose, readOnly: () => utils.rerender(<ElementBar {...props} readOnly />) };
  }

  it('lists the same named commands with disabled states from the selection and routes every z-order action', async () => {
    const { doc, session, user, choose } = mount();
    await user.click(screen.getByRole('button', { name: 'Arrange' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(['Bring to front', 'Bring forward', 'Send backward', 'Send to back', 'Group', 'Ungroup', 'Detach', 'Duplicate', 'Delete']);
    expect(items.map((item) => item.querySelector('.deck-menu-shortcut')?.textContent ?? null)).toEqual([null, '⌘]', '⌘[', null, '⌘G', '⇧⌘G', null, '⌘D', '⌫']);
    expect(items.every((item) => item.hasAttribute('data-disabled'))).toBe(true);
    await user.keyboard('{Escape}');
    act(() => session.select(['a']));
    const order = () => childLists(readFlat(doc, 's', false)).get(ROOT)!.map((element) => element.id);
    await choose('Bring to front');
    expect(order()).toEqual(['title', 'body', 'b', 'a']);
    await choose('Send to back');
    expect(order()).toEqual(['a', 'title', 'body', 'b']);
    await choose('Bring forward');
    expect(order()).toEqual(['title', 'body', 'a', 'b']); // flow content is one paint layer
    await choose('Send backward');
    expect(order()).toEqual(['a', 'title', 'body', 'b']);
  });

  it('routes group, ungroup, duplicate and delete through the real selection commands and keeps undo', async () => {
    const { doc, session, canvas, choose } = mount();
    act(() => session.select(['a', 'b']));
    await choose('Group');
    const group = session.snapshot().selection[0]!;
    expect(readFlat(doc, 's', false).find((element) => element.id === group)?.attrs['data-group']).toBe('');
    fakeLayout(canvas);
    await choose('Ungroup');
    expect(readFlat(doc, 's', false).some((element) => element.id === group)).toBe(false);
    expect(session.snapshot().selection).toEqual(['a', 'b']);
    act(() => session.select(['a']));
    await choose('Duplicate');
    const copy = session.snapshot().selection[0]!;
    expect(copy).not.toBe('a');
    expect(styleOf(doc, copy)).toMatchObject({ left: '324px', top: '324px' });
    await choose('Delete');
    expect(readFlat(doc, 's', false).some((element) => element.id === copy)).toBe(false);
    act(() => session.undoStep());
    expect(readFlat(doc, 's', false).some((element) => element.id === copy)).toBe(true);
  });

  it('offers Detach only for a flow child and disables every editing command in a read-only editor', async () => {
    const { doc, session, user, choose, readOnly } = mount(gestureContext(deck(), { title: [128, 128, 1664, 80], body: [128, 240, 1664, 45] }));
    act(() => session.select(['body']));
    await user.click(screen.getByRole('button', { name: 'Arrange' }));
    expect(screen.getByRole('menuitem', { name: 'Detach' }).hasAttribute('data-disabled')).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'Bring to front' }).hasAttribute('data-disabled')).toBe(true);
    await user.keyboard('{Escape}');
    await choose('Detach');
    expect(styleOf(doc, 'body')).toMatchObject({ position: 'absolute', top: '240px' });
    readOnly();
    const before = slideFile(doc, 's');
    await user.click(screen.getByRole('button', { name: 'Arrange' }));
    expect(screen.getAllByRole('menuitem').every((item) => item.hasAttribute('data-disabled'))).toBe(true);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(slideFile(doc, 's')).toBe(before);
  });
});

describe('the stage’s keys and clipboard', () => {
  function mount(doc = deck()) {
    const session = new DeckSession(doc, 0);
    const utils = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} />);
    const stage = utils.container.querySelector('[data-stage-surface]') as HTMLElement;
    stage.focus();
    return { doc, session, stage, ...utils };
  }

  it('Tab picks the slide’s elements in paint order; Escape lets go; Enter edits a text element', () => {
    const { session, stage } = mount();
    fireEvent.keyDown(stage, { key: 'Tab' });
    expect(session.snapshot().selection).toEqual(['title']);
    fireEvent.keyDown(stage, { key: 'Tab' });
    expect(session.snapshot().selection).toEqual(['body']);
    fireEvent.keyDown(stage, { key: 'Enter' });
    expect(session.snapshot().editingText).toBe('body');
    act(() => session.editText(null));
    fireEvent.keyDown(stage, { key: 'Escape' });
    expect(session.snapshot().selection).toEqual([]);
  });

  it('Delete removes the selection, ⌘D duplicates it at the front, each one undo step', () => {
    const { doc, session, stage } = mount();
    act(() => session.select(['a']));
    fireEvent.keyDown(stage, { key: 'd', metaKey: true });
    const copy = session.snapshot().selection[0]!;
    expect(copy).not.toBe('a');
    expect(styleOf(doc, copy)).toMatchObject({ left: '324px', top: '324px' });
    fireEvent.keyDown(stage, { key: 'Delete' });
    expect(readFlat(doc, 's', false).some((e) => e.id === copy)).toBe(false);
    act(() => session.undoStep());
    expect(readFlat(doc, 's', false).some((e) => e.id === copy)).toBe(true);
  });

  it('⌘] and ⌥⌘[ restack a pinned element; Arrange uses the same commands and follows the selected element', async () => {
    const { doc, session, stage } = mount();
    act(() => session.select(['a']));
    fireEvent.keyDown(stage, { key: ']', metaKey: true });
    const order = () => childLists(readFlat(doc, 's', false)).get(ROOT)!.map((e) => e.id);
    expect(order()).toEqual(['title', 'body', 'b', 'a']);
    fireEvent.keyDown(stage, { key: '[', metaKey: true, altKey: true });
    expect(order()).toEqual(['a', 'title', 'body', 'b']);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('menuitem', { name: 'Bring to front' }));
    expect(order()).toEqual(['title', 'body', 'b', 'a']);
    await user.click(screen.getByRole('button', { name: 'Arrange' }));
    expect(screen.getByRole('menuitem', { name: 'Detach' }).hasAttribute('data-disabled')).toBe(true);
    act(() => session.select(['body']));
    expect(screen.getByRole('menuitem', { name: 'Detach' }).hasAttribute('data-disabled')).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'Bring to front' }).hasAttribute('data-disabled')).toBe(true);
  });

  it('copies the selection as the dialect and pastes it beside itself', async () => {
    const { doc, session } = mount();
    act(() => session.select(['a']));
    const data = new Map<string, string>();
    const clipboardData = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '' };
    const copy = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(copy, 'clipboardData', { value: clipboardData });
    act(() => void document.dispatchEvent(copy));
    expect((JSON.parse(data.get(CLIPBOARD_TYPE)!) as { html: string }).html).toMatch(/^<section id="clipboard">\s*<div id="a"/);
    expect(data.get('text/plain')).toBe('');
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: clipboardData });
    await act(async () => void document.dispatchEvent(paste));
    const pasted = session.snapshot().selection[0]!;
    expect(pasted).not.toBe('a');
    expect(styleOf(doc, pasted)).toMatchObject({ left: '324px', top: '324px', background: '#ff0000' });
  });
});

// ---------------------------------------------------------------- fix wave 1 (the M5 task review's reproductions)

describe('fix wave 1: one gesture one transaction, z-order of neighbours, measures through transforms', () => {
  const PINS = `<section id="s" style="background:#ffffff"><p id="p" style="font-size:32px">Flow</p>
<div id="d0" style="position:absolute; left:100px; top:300px; width:100px; height:100px; background:#ff0000"></div>
<div id="d1" style="position:absolute; left:300px; top:300px; width:100px; height:100px; background:#00ff00"></div>
<div id="d2" style="position:absolute; left:500px; top:300px; width:100px; height:100px; background:#0000ff"></div></section>`;
  const order = (doc: Doc) => childLists(readFlat(doc, 's', false)).get(ROOT)!.map((e) => e.id);
  const count = (doc: Doc, run: () => void) => {
    let n = 0;
    const off = onUpdate(doc, () => n++);
    run();
    off();
    return n;
  };

  it('an edit restyling several elements is one transaction', async () => {
    const { restyle } = await import('../../writers-elements');
    const doc = deck(PINS);
    const session = new DeckSession(doc, 0);
    expect(
      count(doc, () =>
        session.edit((o) => {
          restyle(doc, 's', 'd0', { background: '#000000' }, o);
          restyle(doc, 's', 'd1', { background: '#000000' }, o);
        }),
      ),
    ).toBe(1);
  });

  it('forward and backward move neighbouring selected elements together, one transaction', () => {
    const doc = deck(PINS);
    const ctx = gestureContext(doc);
    expect(count(doc, () => selectionCommands(ctx, ['d0', 'd1'], false).z('forward'))).toBe(1);
    expect(order(doc)).toEqual(['p', 'd2', 'd0', 'd1']);
    selectionCommands(ctx, ['d0', 'd1'], false).z('backward');
    expect(order(doc)).toEqual(['p', 'd0', 'd1', 'd2']);
  });

  it('measures an element’s scale and its group’s rotation as drawn', () => {
    const doc = deck(`<section id="s" style="background:#ffffff">
<div id="sc" style="position:absolute; left:300px; top:300px; width:100px; height:100px; transform:scale(2); background:#ff0000"></div>
<div id="g" data-group="" style="position:absolute; left:100px; top:100px; width:200px; height:100px; transform:rotate(90deg)">
<div id="k" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background:#00ff00"></div></div></section>`);
    const ctx = gestureContext(doc);
    const sc = measure(ctx.canvas, 'sc', 1)!;
    expect(sc.bounds).toEqual({ x: 250, y: 250, w: 200, h: 200 });
    // the group turns about its centre (200, 150): k's box (100..200, 100..200) is drawn at (150..250, 50..150)
    const k = measure(ctx.canvas, 'k', 1)!;
    expect(k.bounds).toEqual({ x: 150, y: 50, w: 100, h: 100 });
  });
});

describe('fix wave 1: the clipboard carries its assets across decks', () => {
  it('a copied picture’s asset is imported into the deck it is pasted in, its ref rewritten', async () => {
    const from = deck(`<section id="s" style="background:#ffffff"><img id="pic" alt="" src="assets/cat.png" style="position:absolute; left:0px; top:0px; width:100px; height:100px"></section>`);
    const to = deck(`<section id="s" style="background:#ffffff"></section>`);
    const data = new Map<string, string>();
    const clipboardData = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '' };
    const fromCtx = { ...gestureContext(from), artifactId: 'deck-a' };
    const copy = new Event('copy', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(copy, 'clipboardData', { value: clipboardData });
    copySelection(copy, fromCtx, ['pic'], false, () => {});
    const payload = JSON.parse(data.get(CLIPBOARD_TYPE)!) as { artifactId: string; assets: string[] };
    expect(payload).toMatchObject({ artifactId: 'deck-a', assets: ['assets/cat.png'] });
    const imported: [string, string][] = [];
    const toCtx = { ...gestureContext(to), artifactId: 'deck-b', importAsset: async (source: string, ref: string) => (imported.push([source, ref]), 'assets/cat-1.png') };
    const paste = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: clipboardData });
    const result = await pasteClipboard(paste, toCtx, []);
    expect(imported).toEqual([['deck-a', 'assets/cat.png']]);
    expect(result).toEqual({ ids: ['pic'] });
    expect(readFlat(to, 's', false).find((e) => e.id === 'pic')!.attrs.src).toBe('assets/cat-1.png');
  });
});

describe('fix wave 1: other replicas’ selections', () => {
  it('outlines what another replica has selected on this slide, in its colour', async () => {
    const { Awareness } = await import('@y/protocols/awareness');
    const doc = deck();
    const other = newDoc();
    const mine = new Awareness(doc);
    const theirs = new Awareness(other);
    const session = new DeckSession(doc, 0, { presence: { awareness: mine, name: 'You', color: '--author-1' } });
    const { container } = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} />);
    layoutRoot(container.querySelector('[data-stage-slide] .maws-slide') as HTMLElement);
    theirs.setLocalState({ name: 'Claude', color: '--author-3', deck: { slideId: 's', elementIds: ['a'] } });
    // the two awarenesses are joined by hand: their state applied to mine
    const { encodeAwarenessUpdate, applyAwarenessUpdate } = await import('@y/protocols/awareness');
    act(() => applyAwarenessUpdate(mine, encodeAwarenessUpdate(theirs, [other.clientID]), 'remote'));
    const outline = container.querySelector('[data-remote-selected="a"]') as HTMLElement;
    expect(outline).not.toBeNull();
    expect(outline.style.getPropertyValue('--remote-color')).toBe('var(--author-3, #7c5cd6)');
    expect(outline.getAttribute('aria-label')).toBe('Claude');
    act(() => session.select(['b']));
    expect(mine.getLocalState()).toMatchObject({ name: 'You', color: '--author-1', deck: { slideId: 's', elementIds: ['b'] } });
    mine.destroy();
    theirs.destroy();
  });
});

// ---------------------------------------------------------------- fix wave 2 (the M5 re-review's reproductions)

describe('fix wave 2: resize snapping and the rotation handle under the element’s own transform', () => {
  it('snaps the drawn edge of a translated element, keeping its held drawn edge (a % translate too)', () => {
    const doc = deck(`<section id="s" style="background:#ffffff">
<div id="px" style="position:absolute; left:660px; top:300px; width:200px; height:100px; transform:translateX(100px); background:#ff0000"></div>
<div id="pc" style="position:absolute; left:1790px; top:600px; width:200px; height:100px; transform:translateX(-50%); background:#0000ff"></div></section>`);
    const ctx = gestureContext(doc);
    const a = startResize(ctx, 'px', 'e', { x: 960, y: 350 });
    a.frame({ x: 963, y: 350 }, NO); // drawn right edge 963: snaps to the slide's centre at 960
    a.end();
    expect(styleOf(doc, 'px')).toMatchObject({ left: '660px', width: '200px' });
    const b = startResize(ctx, 'pc', 'e', { x: 1890, y: 650 });
    b.frame({ x: 1795, y: 650 }, NO); // drawn 1690..1795: the right edge snaps to the margin at 1792, the left held at 1690
    b.end();
    expect(styleOf(doc, 'pc')).toMatchObject({ width: '102px', left: '1741px' });
  });

  it('a rotation starts where the element is: an unmoved handle on a skewed element writes nothing; a quarter turn adds 90°', () => {
    const doc = deck(`<section id="s" style="background:#ffffff"><div id="k" style="position:absolute; left:300px; top:300px; width:200px; height:100px; transform:skew(20deg); background:#ff0000"></div></section>`);
    const ctx = gestureContext(doc);
    const m = measure(ctx.canvas, 'k', ctx.scale)!;
    const top = apply(m.matrix, { x: m.w / 2, y: 0 });
    const up = applyLinear(m.matrix, { x: 0, y: -1 });
    const len = Math.hypot(up.x, up.y);
    const handle = { x: top.x + (up.x / len) * 44, y: top.y + (up.y / len) * 44 }; // 22 screen px at half scale
    const centre = apply(m.matrix, { x: m.w / 2, y: m.h / 2 });
    let n = 0;
    const off = onUpdate(doc, () => n++);
    const g = startRotate(ctx, 'k', handle);
    g.frame(handle, NO);
    expect(n).toBe(0);
    // the pointer turned a quarter about the centre
    const quarter = { x: centre.x - (handle.y - centre.y), y: centre.y + (handle.x - centre.x) };
    g.frame(quarter, { ...NO, shift: true });
    g.end();
    off();
    expect(styleOf(doc, 'k').transform).toBe('rotate(90deg) skew(20deg)');
  });
});

describe('fix wave 2: a connector is hit in its place in the paint order', () => {
  it('a picture painted over a connector takes the press; a connector painted over a picture does', () => {
    const ids = (html: string) => {
      const doc = deck(`<section id="s" style="background:#ffffff">${html}</section>`);
      const ctx = gestureContext(doc);
      const pic = ctx.canvas.node('pic')!;
      const original = document.elementsFromPoint;
      document.elementsFromPoint = () => [pic]; // the browser's hit test: the picture (a connector takes no pointer)
      try {
        const line = measure(ctx.canvas, 'line', ctx.scale)!;
        return hitIds(ctx.canvas, { x: 0, y: 0 }, { x: 500, y: 540 }, 16, [line]);
      } finally {
        document.elementsFromPoint = original;
      }
    };
    const LINE = `<x-connector id="line" x1="300" y1="540" x2="700" y2="540" head="none"></x-connector>`;
    const PIC = `<img id="pic" alt="" src="assets/a.png" style="position:absolute; left:400px; top:440px; width:200px; height:200px">`;
    expect(ids(LINE + PIC)).toEqual(['pic', 'line']);
    expect(ids(PIC + LINE)).toEqual(['line', 'pic']);
  });
});

// ---------------------------------------------------------------- fix wave 3 (the M5 re-review 2's reproduction)

describe('fix wave 3: a transform that is a design-system token', () => {
  it('rotating or resizing an element whose whole transform is a token is refused with the reason, nothing written', () => {
    const doc = deck(`<section id="s" style="background:#ffffff"><div id="t" style="position:absolute; left:300px; top:300px; width:200px; height:100px; transform:var(--ds-pose, scale(1.5)); background:#ff0000"></div></section>`);
    const clean = loadSlide(slideFile(doc, 's'), { fileId: 's' });
    expect(clean.ok && clean.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]); // the loader takes the token whole
    const ctx = gestureContext(doc);
    let n = 0;
    const off = onUpdate(doc, () => n++);
    const r = startRotate(ctx, 't', { x: 400, y: 200 });
    expect(r.refused).toMatch(/design-system token/);
    r.frame({ x: 700, y: 350 }, NO);
    r.end();
    const z = startResize(ctx, 't', 'se', { x: 500, y: 400 });
    expect(z.refused).toMatch(/design-system token/);
    z.frame({ x: 560, y: 430 }, NO);
    z.end();
    off();
    expect(n).toBe(0);
    expect(styleOf(doc, 't').transform).toBe('var(--ds-pose, scale(1.5))');
  });
});

// ---------------------------------------------------------------- P3-F (the slide-editor panel)

describe('P3-F: a Shift-marquee adds at the selection’s level (scalpel-1#1)', () => {
  // the marquee's hits are the slide's own children: added to a group's child, they selected the child and its group
  // together, and one move then moved the child twice (its group's delta and its own)
  it('from inside a group the group replaces the selection, so one move moves the child once; at the slide’s level the hits are added', () => {
    const doc = deck(`<section id="s" style="background:#ffffff">
<div id="a" style="position:absolute; left:1200px; top:600px; width:100px; height:100px; background:#ff0000"></div>
<div id="g" data-group="" style="position:absolute; left:100px; top:100px; width:200px; height:100px">
<div id="k" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background:#00ff00"></div></div></section>`);
    const ctx = gestureContext(doc);
    const across = (base: string[]) => {
      const m = startMarquee(ctx, { x: 50, y: 50 }, base);
      m.frame({ x: 250, y: 150 }, NO);
      m.end();
      return ctx.session.snapshot().selection;
    };
    expect(across(['a'])).toEqual(['a', 'g']);
    expect(across(['k'])).toEqual(['g']);
    const g = startMove(ctx, ctx.session.snapshot().selection, { x: 150, y: 150 });
    g.frame({ x: 190, y: 150 }, { ...NO, meta: true });
    g.end();
    expect(styleOf(doc, 'g')).toMatchObject({ left: '140px', top: '100px' });
    expect(styleOf(doc, 'k')).toMatchObject({ left: '0px', top: '0px' }); // moved once, with its group
  });
});

describe('P3-F: Tab leaves the stage past its last element (scalpel-4#1, WCAG 2.1.2 no keyboard trap)', () => {
  function mount(doc: Doc) {
    const session = new DeckSession(doc, 0);
    const { container } = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} />);
    const stage = container.querySelector('[data-stage-surface]') as HTMLElement;
    stage.focus();
    return { session, stage, notes: screen.getByRole('button', { name: 'Speaker notes' }), user: userEvent.setup() };
  }

  // P4-B2 (D1, D15 A3): a text element selected is ARMED, its box holding the focus; any other, its own node
  const focusOf = (stage: HTMLElement, id: string) => (id === 'title' || id === 'body' ? stage.querySelector(`[data-eid="${id}"] .deck-textbox`) : stage.querySelector(`[data-eid="${id}"]`));

  it('Tab walks the slide’s elements, then leaves for the next control; Shift+Tab walks back and leaves before the first', async () => {
    const { session, stage, notes, user } = mount(deck());
    for (const id of ['title', 'body', 'a', 'b']) {
      await user.tab();
      expect([session.snapshot().selection, document.activeElement]).toEqual([[id], focusOf(stage, id)]);
    }
    await user.tab();
    expect(document.activeElement).toBe(notes);
    expect(session.snapshot().selection).toEqual(['b']); // leaving changes nothing on the slide
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(focusOf(stage, 'b')); // P4-B2 (A3): back on the stage, the focus is the selection's
    for (const id of ['a', 'body', 'title']) {
      await user.tab({ shift: true });
      expect([session.snapshot().selection, document.activeElement]).toEqual([[id], focusOf(stage, id)]);
    }
    await user.tab({ shift: true });
    expect(document.activeElement).not.toBe(stage);
    expect(stage.compareDocumentPosition(document.activeElement!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('lets the keyboard open folded notes and reach the notes field without trapping focus on the stage', async () => {
    const { stage, notes, user } = mount(deck(`<section id="s" style="background:#ffffff"></section>`));
    await user.tab();
    expect(document.activeElement).toBe(notes);
    await user.keyboard('{Enter}');
    expect(notes.getAttribute('aria-expanded')).toBe('true');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Speaker notes' }));
    expect(document.activeElement).not.toBe(stage);
  });

  it('an empty slide captures neither Tab nor Shift+Tab', async () => {
    const { session, stage, notes, user } = mount(deck(`<section id="s" style="background:#ffffff"></section>`));
    await user.tab();
    expect(document.activeElement).toBe(notes);
    stage.focus();
    await user.tab({ shift: true });
    expect(stage.compareDocumentPosition(document.activeElement!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(session.snapshot().selection).toEqual([]);
  });
});

describe('P3-F: a flow text element’s width only, Shift or not (scalpel-1#2)', () => {
  it('a Shift-drag of a flow paragraph’s handle writes its width and no height', () => {
    const doc = deck();
    const ctx = gestureContext(doc, { title: [128, 128, 1664, 80], body: [128, 240, 1664, 45] });
    const r = startResize(ctx, 'body', 'e', { x: 1792, y: 262 });
    r.frame({ x: 1692, y: 262 }, { ...NO, shift: true });
    r.end();
    expect(styleOf(doc, 'body').width).toBe('1564px');
    expect(styleOf(doc, 'body').height).toBeUndefined(); // a fixed height would clip or gap the text as it reflows
  });
});

// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D1 to D9; the prior art's P1 to P12 and K1 to K5):
// the click model and the armed keys on the overlay, with constructed events. happy-dom has no hit test: the press's
// stack is the pressed node and its ancestors (as `elementsFromPoint` answers over a node), and no layout: a caret's
// place at a point is given to ProseMirror (`posAtCoords`). Real clicks with their counts are the e2e's.
describe('P4-B2: the click model (P1 to P12) and the armed keys (K1 to K5)', () => {
  const SLIDE_B2 = `<section id="s" style="background:#ffffff">
<h2 id="title" style="position:absolute; left:100px; top:100px; width:800px; height:100px; font-size:64px">Hello world</h2>
<p id="body" style="position:absolute; left:100px; top:250px; width:800px; height:60px; font-size:32px">Body</p>
<div id="a" style="position:absolute; left:1000px; top:100px; width:200px; height:100px; background:#ff0000"></div>
<div id="g" data-group="" style="position:absolute; left:100px; top:400px; width:800px; height:300px"><h2 id="gh" style="position:absolute; left:0px; top:0px; width:800px; height:100px; font-size:48px">Grouped</h2><div id="g2" data-group="" style="position:absolute; left:0px; top:150px; width:800px; height:100px"><p id="deep" style="position:absolute; left:0px; top:0px; width:800px; height:100px; font-size:32px">Deep text</p></div></div>
<table id="t" style="position:absolute; left:1000px; top:400px; width:600px; font-size:24px"><tr id="r1"><th>A</th><th>B</th></tr><tr id="r2"><td>1</td><td>2</td></tr></table>
</section>`;
  const plain = (doc: Doc, id: string) =>
    Y.readText(doc, 's', id)
      .map((b) => b.inline.map((r) => ('text' in r ? r.text : '\n')).join(''))
      .join('\n');

  // the press's stack: the node under the pointer and its ancestors
  let under: Element | null = null;
  beforeEach(() => {
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => {
        const out: Element[] = [];
        for (let n = under; n; n = n.parentElement) out.push(n);
        return out;
      },
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(document, 'elementsFromPoint');
    under = null;
    vi.restoreAllMocks();
  });
  /** ProseMirror's position at any point: `pos` (happy-dom lays nothing out). */
  const caretAt = (pos: number) => vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue({ pos, inside: -1 });

  function mount(readOnly = false) {
    const doc = deck(SLIDE_B2);
    const session = new DeckSession(doc, 0);
    const host = document.createElement('div');
    const canvas = new SlideCanvas(doc, 's', host);
    canvases.push(canvas);
    fakeLayout(canvas);
    const adopt = (n: HTMLDivElement | null) => {
      if (n && host.parentElement !== n) n.appendChild(host);
    };
    function Stage() {
      const surface = useRef<HTMLDivElement>(null);
      const frame = useRef<HTMLDivElement>(null);
      return (
        <div ref={surface} tabIndex={0} data-stage-surface="">
          <div ref={adopt} />
          <div ref={frame}>
            <Overlay
              session={session}
              canvas={canvas}
              slideId="s"
              scale={0.5}
              readOnly={readOnly}
              surface={surface}
              frame={frame}
              renderText={(id, c, armed) => <TextBox session={session} canvas={c} slideId="s" elementId={id} readOnly={readOnly} armed={armed} />}
            />
          </div>
        </div>
      );
    }
    const { container } = render(<Stage />);
    const stage = container.querySelector<HTMLElement>('[data-stage-surface]')!;
    const node = (id: string) => canvas.node(id)!;
    const box = (id: string) => node(id).querySelector<HTMLElement & { editor: import('@tiptap/core').Editor }>('.deck-textbox');
    const [[a1, b1], [a2, b2]] = cellGrid(slideTree(doc, 's'), 't') as [string[], string[]];
    return { doc, session, canvas, stage, node, box, cells: { a1: a1!, b1: b1!, a2: a2!, b2: b2! } };
  }

  const pointer = (type: string, target: Element, x: number, y: number, init: PointerEventInit = {}) =>
    act(() => void target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y, ...init })));
  const mouse = (type: 'click' | 'dblclick', target: Element, detail: number, x = 10, y = 10, init: MouseEventInit = {}) =>
    act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, detail, clientX: x, clientY: y, ...init })));
  /** One click on `target`: its press, its release and the click with count `detail`, each with `init`'s modifiers. */
  const click = (target: Element, detail = 1, init: PointerEventInit = {}) => {
    under = target;
    pointer('pointerdown', target, 10, 10, init);
    pointer('pointerup', target, 10, 10, init);
    mouse('click', target, detail, 10, 10, init);
  };
  const doubleClick = (target: Element) => {
    click(target, 1);
    click(target, 2);
    mouse('dblclick', target, 2);
  };
  /** A press on `target`, a move of `dx` screen px with the pointer over `over`, and the release. */
  const drag = (target: Element, dx: number, over: Element = target) => {
    under = target;
    pointer('pointerdown', target, 10, 10);
    under = over;
    pointer('pointermove', target, 10 + dx, 10, { metaKey: true }); // ⌘: no snapping
    pointer('pointerup', target, 10 + dx, 10);
    mouse('click', target, 1, 10 + dx, 10);
  };
  /** A keydown on the focused element; true unless the page took it. */
  const key = (init: KeyboardEventInit) => {
    let passed = true;
    act(() => void (passed = (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))));
    return passed;
  };
  const editing = (session: DeckSession) => session.snapshot().editingText;
  const selectionText = (box: HTMLElement & { editor: import('@tiptap/core').Editor }) => {
    const { from, to } = box.editor.state.selection;
    return box.editor.state.doc.textBetween(from, to);
  };

  it('P1: a first click selects a text element ARMED: its box focused with the caret hidden, no edit', () => {
    const { session, stage, node, box } = mount();
    click(node('title'));
    expect(session.snapshot()).toMatchObject({ selection: ['title'], editingText: null, keyboard: 'stage' });
    expect(document.activeElement).toBe(box('title'));
    expect(stage.hasAttribute('data-armed')).toBe(true);
    expect(armedBox(session)?.elementId).toBe('title');
    click(node('a')); // a non-text element: the stage holds the focus
    expect(document.activeElement).toBe(stage);
    expect(stage.hasAttribute('data-armed')).toBe(false);
  });

  it('P2 and D3: a second click edits with the caret at the point, on the same box, the focus never moving', () => {
    const { session, node, box } = mount();
    click(node('title'));
    const root = box('title')!;
    let moved = 0;
    root.addEventListener('focusout', () => moved++);
    caretAt(4);
    click(node('title'));
    expect(editing(session)).toBe('title');
    expect(box('title')).toBe(root);
    expect(document.activeElement).toBe(root);
    expect(moved).toBe(0);
    expect([root.editor.state.selection.from, root.editor.state.selection.to]).toEqual([4, 4]);
  });

  it('P3: a 3 px drag of the armed element moves it, its text unchanged and still armed; a 2 px one is a click', () => {
    const { doc, session, node, box } = mount();
    click(node('title'));
    drag(node('title'), 4);
    expect(styleOf(doc, 'title').left).toBe('108px'); // 4 screen px at scale 0.5
    expect(plain(doc, 'title')).toBe('Hello world');
    expect(editing(session)).toBeNull();
    expect(document.activeElement).toBe(box('title'));
    drag(node('title'), 2);
    expect(styleOf(doc, 'title').left).toBe('108px');
    expect(editing(session)).toBe('title');
  });

  it('P4 and P12: a double-click on an unselected element edits once, with the word selected and no caret before it', () => {
    const { session, stage, node, box } = mount();
    const edits: (string | null)[] = [];
    session.subscribe(() => {
      const now = editing(session);
      if (now !== edits.at(-1)) edits.push(now);
    });
    caretAt(8); // inside "world"
    click(node('title'), 1);
    expect([editing(session), stage.hasAttribute('data-armed')]).toEqual([null, true]); // armed: the caret transparent
    click(node('title'), 2);
    mouse('dblclick', node('title'), 2);
    expect(edits.filter((e) => e !== null)).toEqual(['title']);
    expect(selectionText(box('title')!)).toBe('world');
  });

  it('P5 and P6: a double-click edits the deepest text whatever the scope: a heading two groups down, a table’s cell', () => {
    const { session, node, box, cells } = mount();
    caretAt(2);
    doubleClick(node('deep'));
    expect(session.snapshot()).toMatchObject({ selection: ['deep'], editingText: 'deep' });
    expect(selectionText(box('deep')!)).toBe('Deep');
    click(node('a'));
    doubleClick(node(cells.b2));
    expect(session.snapshot()).toMatchObject({ selection: [cells.b2], editingText: cells.b2 });
  });

  it('P7: single clicks on a grouped heading: the group (a drag moves it), then the heading armed, then a caret', () => {
    const { doc, session, node, box } = mount();
    click(node('gh'));
    expect(session.snapshot().selection).toEqual(['g']);
    drag(node('gh'), 4);
    expect(styleOf(doc, 'g').left).toBe('108px');
    expect(styleOf(doc, 'gh').left).toBe('0px');
    click(node('gh'));
    expect(session.snapshot()).toMatchObject({ selection: ['gh'], editingText: null });
    expect(document.activeElement).toBe(box('gh'));
    click(node('gh'));
    expect(editing(session)).toBe('gh');
  });

  it('P8 and D8: a click selects the table, a second edits the cell there; a drag across cells selects their range, the table unmoved', () => {
    const { doc, session, node, stage, cells } = mount();
    click(node(cells.a1));
    expect(session.snapshot().selection).toEqual(['t']);
    click(node(cells.b1));
    expect(session.snapshot()).toMatchObject({ selection: [cells.b1], editingText: cells.b1 });
    click(node('a'));
    click(node(cells.a1));
    drag(node(cells.a1), 6, node(cells.b2));
    expect(session.snapshot().selection).toEqual([cells.a1, cells.b1, cells.a2, cells.b2]);
    expect(styleOf(doc, 't').left).toBe('1000px');
    expect(document.activeElement).toBe(stage);
    expect(key({ key: 'Backspace' })).toBe(false); // the cells' text cleared, one step; the table kept
    expect([cells.a1, cells.b1, cells.a2, cells.b2].map((id) => plain(doc, id))).toEqual(['', '', '', '']);
    act(() => session.undoStep());
    expect([cells.a1, cells.b2].map((id) => plain(doc, id))).toEqual(['A', '2']);
    key({ key: 'Escape' });
    expect(session.snapshot().selection).toEqual(['t']);
  });

  it('T21: a ⌘-click or Ctrl-click on the selected text target or cell is a deep select, never T3’s edit; the element keys stay the element’s', () => {
    const { doc, session, node, box, cells } = mount();
    click(node('title'));
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      click(node('title'), 1, mod);
      expect(session.snapshot(), JSON.stringify(mod)).toMatchObject({ selection: ['title'], editingText: null });
      expect(armedBox(session)?.elementId).toBe('title');
      expect(document.activeElement).toBe(box('title'));
    }
    expect(key({ key: 'ArrowRight' })).toBe(false); // a nudge, not a caret move
    expect(styleOf(doc, 'title').left).toBe('101px');
    expect(plain(doc, 'title')).toBe('Hello world');
    click(node(cells.a1)); // the table
    click(node(cells.b1), 1, { metaKey: true }); // T21: the cell itself
    expect(session.snapshot()).toMatchObject({ selection: [cells.b1], editingText: null });
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      click(node(cells.b1), 1, mod);
      expect(session.snapshot(), JSON.stringify(mod)).toMatchObject({ selection: [cells.b1], editingText: null });
      expect(armedBox(session)?.elementId).toBe(cells.b1);
    }
    expect(plain(doc, cells.b1)).toBe('B');
  });

  it('P10 and P11: in an edit a drag in the text moves nothing; a click on another element commits and selects it, unedited', () => {
    const { doc, session, node, box } = mount();
    click(node('title'));
    click(node('title'));
    act(() => void box('title')!.editor.commands.insertContent('!'));
    drag(box('title')!.firstElementChild!, 20);
    expect(styleOf(doc, 'title').left).toBe('100px');
    expect(editing(session)).toBe('title');
    click(node('body'));
    expect(session.snapshot()).toMatchObject({ selection: ['body'], editingText: null });
    expect(armedBox(session)?.elementId).toBe('body');
    expect(plain(doc, 'title')).toContain('!');
  });

  it('K1 and T10: on ARMED a key replaces the text, typed by the box; one ⌘Z restores it, the element still selected', () => {
    const { doc, session, node, box } = mount();
    click(node('title'));
    expect(key({ key: 'x' })).toBe(false);
    expect(plain(doc, 'title')).toBe('x');
    expect(editing(session)).toBe('title');
    expect(document.activeElement).toBe(box('title'));
    key({ key: 'z', ...(/Mac|iP(hone|[oa]d)/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }) });
    expect(plain(doc, 'title')).toBe('Hello world');
    expect(session.snapshot().selection).toEqual(['title']);
  });

  it('T11: an input method’s first key (keyCode 229) clears the text and is left to the input method, in place', () => {
    const { doc, session, node, box } = mount();
    click(node('title'));
    const root = box('title');
    expect(key({ key: 'Process', keyCode: 229 })).toBe(true);
    expect(plain(doc, 'title')).toBe('');
    expect(editing(session)).toBe('title');
    expect(box('title')).toBe(root);
  });

  it('K2, K3 and the element keys on ARMED: Enter selects all, changing nothing; arrows nudge; ⌘B marks it all; ⌫ removes it', () => {
    const { doc, session, node, box } = mount();
    click(node('title'));
    expect(key({ key: 'ArrowRight' })).toBe(false);
    key({ key: 'ArrowDown', shiftKey: true });
    expect(styleOf(doc, 'title')).toMatchObject({ left: '101px', top: '110px' });
    expect(armedBox(session)?.elementId).toBe('title');
    key({ key: 'b', metaKey: true });
    expect(Y.readText(doc, 's', 'title')[0]!.inline).toEqual([{ text: 'Hello world', marks: { b: {} } }]);
    expect(editing(session)).toBeNull();
    key({ key: 'Enter' });
    expect(editing(session)).toBe('title');
    expect(selectionText(box('title')!)).toBe('Hello world');
    expect(plain(doc, 'title')).toBe('Hello world');
    act(() => session.editText(null));
    click(node('body'));
    key({ key: 'Backspace' });
    expect(readFlat(doc, 's', false).some((e) => e.id === 'body')).toBe(false);
  });

  it('K4 and T17: Escape from an edit is ARMED again, the text kept; a second Escape selects the group, or nothing at the top', () => {
    const { doc, session, node, box } = mount();
    click(node('title'));
    click(node('title'));
    act(() => void box('title')!.editor.commands.insertContent('!'));
    key({ key: 'Escape' });
    expect(session.snapshot()).toMatchObject({ selection: ['title'], editingText: null });
    expect(armedBox(session)?.elementId).toBe('title');
    expect(plain(doc, 'title')).toContain('!');
    key({ key: 'Escape' });
    expect(session.snapshot().selection).toEqual([]);
    doubleClick(node('gh'));
    key({ key: 'Escape' });
    key({ key: 'Escape' });
    expect(session.snapshot().selection).toEqual(['g']);
  });

  it('K5 and T16: in an edited cell Tab and Shift-Tab move between cells with their content selected', () => {
    const { session, node, box, cells } = mount();
    doubleClick(node(cells.a1));
    key({ key: 'Tab' });
    expect(editing(session)).toBe(cells.b1);
    expect(selectionText(box(cells.b1)!)).toBe('B');
    key({ key: 'Tab', shiftKey: true });
    expect(editing(session)).toBe(cells.a1);
    key({ key: 'Escape' });
    expect(session.snapshot()).toMatchObject({ selection: ['t'], editingText: null });
  });

  it('D1: the keyboard away (a focus outside the stage) unmounts the armed box, the selection kept; back on the stage it arms again', () => {
    const { session, stage, node, box } = mount();
    click(node('title'));
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    act(() => outside.focus());
    expect(session.snapshot()).toMatchObject({ selection: ['title'], keyboard: 'away' });
    expect(box('title')).toBeNull();
    expect(document.activeElement).toBe(outside);
    act(() => stage.focus());
    expect(session.snapshot().keyboard).toBe('stage');
    expect(document.activeElement).toBe(box('title'));
  });

  it('D9: a key reaching the stage with a text target selected goes to its armed box (T10); none on other selections, with ⌘, composing or a named key', () => {
    const { doc, session, stage, node } = mount();
    click(node('title'));
    act(() => stage.focus());
    expect(key({ key: 'N' })).toBe(false);
    expect(plain(doc, 'title')).toBe('N');
    act(() => session.editText(null));
    act(() => session.undoStep());
    for (const [selection, init] of [
      [['g'], { key: 'z' }],
      [['a'], { key: 'z' }],
      [['title', 'a'], { key: 'z' }],
      [['body'], { key: 'b', metaKey: true }],
      [['body'], { key: 'z', isComposing: true }],
      [['body'], { key: 'z', keyCode: 229 }],
      [['body'], { key: 'Process' }],
      [['body'], { key: 'F5' }],
    ] as const) {
      act(() => session.select(selection));
      act(() => stage.focus());
      key(init);
      const why = `${selection.join(', ')}: ${JSON.stringify(init)}`;
      expect(editing(session), why).toBeNull();
      expect([plain(doc, 'title'), plain(doc, 'body'), plain(doc, 'gh')], why).toEqual(['Hello world', 'Body', 'Grouped']);
    }
  });

  it('T20: the armed element deleted by another replica leaves the selection and unmounts its box', () => {
    const { doc, session, canvas, node } = mount();
    click(node('title'));
    const remote = newDoc();
    applyV1(remote, diffV1(doc));
    deleteElementTree(remote, 's', 'title');
    act(() => applyV1(doc, diffV1(remote, stateVector(doc)), 'remote'));
    expect(session.snapshot().selection).toEqual([]);
    expect(armedBox(session)).toBeNull();
    expect(canvas.root.querySelector('.deck-textbox')).toBeNull();
  });

  it('a read-only stage arms nothing and edits nothing: a click selects, a double-click and a key do nothing', () => {
    const { doc, session, stage, node } = mount(true);
    click(node('title'));
    expect(session.snapshot().selection).toEqual(['title']);
    expect(armedBox(session)).toBeNull();
    expect(document.activeElement).toBe(stage);
    doubleClick(node('title'));
    key({ key: 'z' });
    expect(editing(session)).toBeNull();
    expect(plain(doc, 'title')).toBe('Hello world');
  });

  it('D13: the overlay going mid-drag ends the session’s drag, which the inspector’s settled version reads', () => {
    const { session, node } = mount();
    click(node('a'));
    under = node('a');
    pointer('pointerdown', node('a'), 10, 10);
    pointer('pointermove', node('a'), 20, 10, { metaKey: true });
    expect(session.snapshot().dragging).toBe(true);
    cleanup();
    expect(session.snapshot().dragging).toBe(false);
  });

  it('T22 on a design board: a key on the world reaches the selected heading’s armed box; a double-click on an inactive board’s heading edits it in one gesture', () => {
    const doc = design();
    const session = new DeckSession(doc, 0);
    const view = new DesignView();
    view.setRoom({ w: 1000, h: 800 });
    view.setViewport({ zoom: 1, x: 0, y: 0 });
    const { container } = render(<DesignWorkbench session={session} view={view} assetUrl={() => null} system={null} readOnly={false} />);
    const world = container.querySelector<HTMLElement>('[data-design-world]')!;
    const heading = (board: string) => container.querySelector<HTMLElement>(`[data-board-id="${board}"] [data-eid="title"]`)!;
    act(() => {
      session.show('b1');
      session.select(['title']);
    });
    act(() => world.focus());
    expect(document.activeElement).toBe(heading('b1').querySelector('.deck-textbox'));
    act(() => world.focus());
    key({ key: 'W' });
    expect(session.snapshot().editingText).toBe('title');
    expect(Y.readText(doc, 'b1', 'title')[0]!.inline).toEqual([{ text: 'W', marks: {} }]);
    act(() => session.editText(null));
    caretAt(2);
    doubleClick(heading('b2'));
    expect(session.snapshot()).toMatchObject({ currentSlide: 'b2', selection: ['title'], editingText: 'title' });
    const box = heading('b2').querySelector<HTMLElement & { editor: import('@tiptap/core').Editor }>('.deck-textbox')!;
    expect(document.activeElement).toBe(box);
    expect(selectionText(box)).toBe('Title');
  });
});

// ---------------------------------------------------------------- P4-B2 M6: the gesture hold

// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md D17): a drag holds the replica's remote frames (the
// session's gesture reason; session.test.ts), and its drop writes the gesture's last values again wherever a write it
// held moved them, so the owner's drop wins whatever the clientIDs; it writes nothing into a slide the flush held,
// emptied of its file or removed, nor onto an element the flush deleted. The agent is the fixtures' `heldPeer`: its
// writes reach the owner as the provider delivers them, buffered while held and applied merged at the release.
describe('P4-B2: the gesture hold and the drop’s re-assert (D17)', () => {
  const OWNER = 0x100;
  const HIGHER = 0x7fff0000;
  const LOWER = 0x10;

  function heldDeck(clientId = HIGHER) {
    const doc = deck();
    adoptClientId(doc, OWNER);
    const channel = heldPeer(doc, clientId);
    return { doc, ctx: gestureContext(doc, undefined, { holdRemote: channel.holdRemote }), ...channel };
  }
  /** How many updates of the owner's own `run` made. */
  const ownWrites = (doc: Doc, session: DeckSession, run: () => void): number => {
    let n = 0;
    const off = onUpdate(doc, (_update, origin) => {
      if (origin === session.origin) n += 1;
    });
    try {
      run();
    } finally {
      off();
    }
    return n;
  };

  it('holds the agent’s writes from the drag’s start; its drop applies them and the owner’s last values win, whatever the clientIDs, in the drag’s one step', () => {
    for (const clientId of [HIGHER, LOWER]) {
      const { doc, ctx, agent, holds, buffered, write } = heldDeck(clientId);
      const g = startMove(ctx, ['a'], { x: 400, y: 350 });
      expect(holds).toEqual([true]);
      g.frame({ x: 410, y: 350 }, NO);
      write((a) => setStyle(a, 's', 'a', { left: '900px', top: '20px' })); // the agent moves the dragged element
      expect(buffered()).toBe(1);
      g.frame({ x: 437, y: 371 }, NO);
      expect(styleOf(doc, 'a')).toMatchObject({ left: '337px', top: '321px' });
      g.end();
      expect(holds, `agent ${clientId}`).toEqual([true, false]);
      expect(buffered()).toBe(0);
      expect(styleOf(doc, 'a'), `agent ${clientId}`).toMatchObject({ left: '337px', top: '321px' });
      applyV1(agent, diffV1(doc, stateVector(agent)));
      expect(styleOf(agent, 'a'), `the agent’s replica, agent ${clientId}`).toMatchObject({ left: '337px', top: '321px' });
      // the re-assert is the drag's own: one undo takes the whole gesture back
      ctx.session.undoStep();
      expect(ctx.session.undo.canUndo(), `agent ${clientId}`).toBe(false);
    }
  });

  it('re-asserts every key the gesture wrote at its last value: a pin only its first frame removed, set again under the hold, is removed again', () => {
    const { doc, ctx, write } = heldDeck();
    const g = startMove(ctx, ['b'], { x: 0, y: 0 });
    g.frame({ x: 30, y: 0 }, { ...NO, meta: true }); // b's right/bottom pin becomes left/top
    write((a) => setStyle(a, 's', 'b', { right: '50px' }));
    g.frame({ x: 40, y: 0 }, { ...NO, meta: true });
    g.end();
    expect(styleOf(doc, 'b')).toMatchObject({ left: '1732px', top: '852px' });
    expect(styleOf(doc, 'b').right).toBeUndefined();
  });

  it('writes nothing into a slide the flush held, emptied of its file or removed: the agent’s move and that arriving under the drag', () => {
    for (const turn of ['held', 'missing', 'removed'] as const) {
      const { doc, ctx, holds, write } = heldDeck();
      const g = startMove(ctx, ['a'], { x: 400, y: 350 });
      g.frame({ x: 410, y: 350 }, NO);
      write((a) => setStyle(a, 's', 'a', { left: '900px' }));
      write((a) => {
        if (turn === 'held') Y.setSlideKey(a, 's', 'held', { source: '<section id="s"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] });
        else if (turn === 'missing') Y.setSlideKey(a, 's', MISSING_SOURCE_KEY, true);
        else Y.deleteSlide(a, 's');
      });
      g.frame({ x: 437, y: 371 }, NO);
      expect(ownWrites(doc, ctx.session, () => g.end()), turn).toBe(0);
      expect(holds, turn).toEqual([true, false]);
      if (turn === 'removed') expect(Y.hasSlide(doc, 's'), turn).toBe(false);
      else expect(styleOf(doc, 'a').left, turn).toBe('900px'); // the agent's, its clientID the higher
      expect(ctx.session.snapshot().dragging, turn).toBe(false);
    }
  });

  it('the dragged element deleted under the hold: the drop applies the deletion, writes nothing and ends clean', () => {
    const { doc, ctx, holds, write } = heldDeck();
    const g = startMove(ctx, ['a', 'b'], { x: 400, y: 350 });
    g.frame({ x: 410, y: 350 }, { ...NO, meta: true });
    write((a) => deleteElementTree(a, 's', 'a'));
    write((a) => setStyle(a, 's', 'b', { top: '10px' }));
    g.frame({ x: 437, y: 371 }, { ...NO, meta: true });
    expect(Y.hasElement(doc, 's', 'a')).toBe(true); // held
    g.end();
    expect(Y.hasElement(doc, 's', 'a')).toBe(false);
    expect(styleOf(doc, 'b').top).toBe('873px'); // the other element the drag moved: re-asserted
    expect(holds).toEqual([true, false]);
    expect(ctx.session.snapshot().dragging).toBe(false);
  });

  /** The overlay alone over the deck's slide, its session holding through `holdRemote`, `a` selected. */
  function overlaid(holdRemote: (on: boolean) => void) {
    const doc = deck();
    const session = new DeckSession(doc, 0, { holdRemote });
    const canvas = new SlideCanvas(doc, 's', document.createElement('div'));
    canvases.push(canvas);
    fakeLayout(canvas);
    function Stage() {
      const surface = useRef<HTMLDivElement>(null);
      const frame = useRef<HTMLDivElement>(null);
      return (
        <div ref={surface} tabIndex={0} data-stage-surface="">
          <div ref={frame}>
            <Overlay session={session} canvas={canvas} slideId="s" scale={0.5} readOnly={false} surface={surface} frame={frame} />
          </div>
        </div>
      );
    }
    const utils = render(<Stage />);
    act(() => session.select(['a']));
    return { doc, session, utils, stage: utils.container.querySelector<HTMLElement>('[data-stage-surface]')!, handle: utils.container.querySelector('[data-handle="se"]')! };
  }

  it('a gesture the overlay unmounts in ends as a cancel does: the hold released, the drag over', () => {
    const holds: boolean[] = [];
    const { session, utils, handle } = overlaid((on) => holds.push(on));
    fireEvent.pointerDown(handle, { button: 0, buttons: 1, clientX: 10, clientY: 10, pointerId: 1 });
    expect(holds).toEqual([true]);
    expect(session.snapshot().dragging).toBe(true);
    utils.unmount();
    expect(holds).toEqual([true, false]);
    expect(session.snapshot().dragging).toBe(false);
  });

  it('a cancel whose drop throws (a listener of the flush) leaves no gesture behind: a later move writes nothing', () => {
    const { doc, session, stage, handle } = overlaid((on) => {
      if (!on) throw new Error('a listener of the flush');
    });
    // the move and the cancel on the stage itself: the handle is drawn again as the frame re-measures
    fireEvent.pointerDown(handle, { button: 0, buttons: 1, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(stage, { buttons: 1, clientX: 60, clientY: 10, pointerId: 1 });
    const width = styleOf(doc, 'a').width;
    expect(width).not.toBe('200px');
    try {
      fireEvent.pointerCancel(stage, { pointerId: 1 });
    } catch {
      // the flush's error, as the listener's caller sees it
    }
    expect(session.snapshot().dragging).toBe(false);
    fireEvent.pointerMove(stage, { buttons: 0, clientX: 110, clientY: 10, pointerId: 1 });
    expect(styleOf(doc, 'a').width).toBe(width);
  });
});
