// P3-C M5 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer"): the gestures write what
// they should, one transaction per frame and one undo step per gesture; the stage's keys and the clipboard act on the
// selection. happy-dom lays nothing out, so the boxes the gestures measure are given to the nodes here (offsets from
// each element's own px style); the real layout, paint and pointer are the e2e's.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, onUpdate, transact, type Doc } from '../../../yjs';
import { SlideCanvas } from '../../canvas';
import { childLists, importSlide, readFlat, ROOT, slideFile, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { DeckEditor } from '../DeckEditor';
import { DeckSession } from '../session';
import { startFlowMove, startMove, startResize, startRotate, type GestureContext } from './gestures';
import { CLIPBOARD_TYPE, copySelection, pasteClipboard } from './clipboard';
import { selectionCommands } from './commands';
import { measure } from './measure';

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
function gestureContext(doc: Doc, flow?: Record<string, [number, number, number, number]>): GestureContext & { session: DeckSession } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const canvas = new SlideCanvas(doc, 's', host);
  canvases.push(canvas);
  fakeLayout(canvas, flow);
  return { session: new DeckSession(doc, 0), slideId: 's', canvas, scale: 0.5 };
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
    const t = startRotate(ctx, 'a');
    t.frame({ x: 1000, y: 375 }, NO); // right of its centre (450, 375): 90°
    t.frame({ x: 1000, y: 380 }, { ...NO, shift: true });
    t.end();
    expect(styleOf(doc, 'a').transform).toBe('rotate(90deg)');
    reload(doc);
  });

  it('drags a flow child below its sibling: one re-order on the drop', () => {
    const doc = deck();
    const ctx = gestureContext(doc, { title: [128, 128, 1664, 80], body: [128, 240, 1664, 45] });
    const g = startFlowMove(ctx, 'title', { x: 300, y: 150 });
    const f = g.frame({ x: 300, y: 300 }, NO);
    expect(f.insertion).toBeDefined();
    g.end(true);
    expect(childLists(readFlat(doc, 's', false)).get(ROOT)!.filter((e) => e.tag !== 'div').map((e) => e.id)).toEqual(['body', 'title']);
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

  it('⌘] and ⌥⌘[ restack a pinned element; the toolbar’s buttons are the same commands', () => {
    const { doc, session, stage } = mount();
    act(() => session.select(['a']));
    fireEvent.keyDown(stage, { key: ']', metaKey: true });
    const order = () => childLists(readFlat(doc, 's', false)).get(ROOT)!.map((e) => e.id);
    expect(order()).toEqual(['title', 'body', 'b', 'a']);
    fireEvent.keyDown(stage, { key: '[', metaKey: true, altKey: true });
    expect(order()).toEqual(['a', 'title', 'body', 'b']);
    fireEvent.click(screen.getByRole('button', { name: 'Bring to front' }));
    expect(order()).toEqual(['title', 'body', 'b', 'a']);
    expect((screen.getByRole('button', { name: 'Detach' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => session.select(['body']));
    expect((screen.getByRole('button', { name: 'Detach' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Bring to front' }) as HTMLButtonElement).disabled).toBe(true);
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
