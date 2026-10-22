// P4-A2 G2.3 (docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md, G-R3 to G-R5; §4.2's four rules): a publish
// drawn as it streams in the deck editor, under happy-dom, through the editor's own wiring (the layers' store given to
// `DeckEditor`, the replica standing in for the port): the label from the frame naming the file; each class of element
// drawn on the ghost canvas and veiled on the live one; the human's EDIT, ARMED and dragged elements never covered, a
// ghost meeting one held back and then drawn; the withdrawal and the write's patch in one call, under a held drag too; a
// refusal leaving no trace; nothing focusable; the filmstrip's ring, its whole provisional thumbnail and a new slide's
// entry at its place. happy-dom lays nothing out, so the boxes the layer compares are given by element.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateVector, transact } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { flushLayout } from '../../canvas';
import { DECK_PATH, slidePath } from '../../deck';
import { slideOrder } from '../../model';
import { DeckEditor } from '../DeckEditor';
import { DeckSession } from '../session';
import { SlideCanvas } from '../../canvas';
import { DeckProvisional } from './deck';
import { SlideLayer } from './layers';
import { deckWorld, publishFrame, replica } from './testing';
import sheet from './provisional.css?raw';

const ONE = `<section id="s1" style="background:#ffffff; padding:96px; display:flex; flex-direction:column; gap:24px">
<h1 id="title" style="font-size:80px">Launch review</h1>
<p id="date" style="font-size:40px">Friday, 24 October</p>
<p id="body" style="font-size:32px">Scope is frozen</p>
<p id="foot" style="font-size:24px">Draft</p>
<x-shape id="badge" kind="rounded" style="position:absolute; right:64px; bottom:64px; width:200px; height:60px; background:#eef2f1"></x-shape>
</section>`;
// a relative group whose pinned child reaches out of its box, onto the line below
const GROUPED = `<section id="s1" style="background:#ffffff; padding:96px; display:flex; flex-direction:column; gap:24px">
<h1 id="title" style="font-size:80px">Launch review</h1>
<div id="g" style="position:relative; height:80px; background:#eef2f1"><p id="gc" style="position:absolute; left:0; top:60px; font-size:24px">Callout</p></div>
<p id="date" style="font-size:40px">Friday, 24 October</p>
</section>`;
const TWO = '<section id="s2" style="background:#ffffff"><h2 id="t2" style="font-size:64px">Numbers</h2></section>';

type Rect = [left: number, top: number, width: number, height: number];
const boxes = { live: new Map<string, Rect>(), ghost: new Map<string, Rect>(), label: [0, 0, 0, 0] as Rect };

/** Whether a node paints under the layer's sheet: no transparent ancestor (opacity multiplies down), not itself hidden. */
const paints = (node: Element) => {
  for (let n: Element | null = node; n; n = n.parentElement) if (getComputedStyle(n).opacity === '0') return false;
  return getComputedStyle(node).visibility !== 'hidden';
};
let styles: HTMLStyleElement | null = null;

beforeEach(() => {
  styles = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: sheet })); // the layer's sheet, applied
  // the layer reads boxes from each canvas's origin: an element's box is given here by its canvas and id (zero else)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const root = this.closest('section.maws-slide');
    const table = root?.hasAttribute('data-provisional-ghost') ? boxes.ghost : boxes.live;
    const [left, top, width, height] = this.hasAttribute('data-provisional-label') ? boxes.label : (this.dataset.eid && table.get(this.dataset.eid)) || [0, 0, 0, 0];
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  styles?.remove();
  cleanup();
  vi.restoreAllMocks();
  boxes.live.clear();
  boxes.ghost.clear();
  boxes.label = [0, 0, 0, 0];
});

function mount(one = ONE) {
  const world = deckWorld({ s1: one, s2: TWO });
  const live = replica(world.doc);
  const stopLayers = live.layers.attach(); // the tab's state attaches its store
  const session = new DeckSession(world.doc, 0, { holdRemote: live.holdRemote });
  const utils = render(<DeckEditor session={session} assetUrl={() => null} system={null} readOnly={false} provisional={live.layers} />);
  const q = (selector: string) => utils.container.querySelector<HTMLElement>(selector);
  const all = (selector: string) => [...utils.container.querySelectorAll<HTMLElement>(selector)];
  const stage = {
    layer: () => q('[data-stage-slide] [data-provisional-layer]'),
    label: () => q('[data-stage-slide] [data-provisional-label]')?.textContent ?? null,
    ghost: () => q('[data-stage-slide] section[data-provisional-ghost]'),
    shown: () => Object.fromEntries(all('[data-stage-slide] [data-provisional-ghost] [data-provisional-shown]').map((n) => [n.dataset.provisionalKey, n.dataset.provisionalShown])),
    veiled: () => all('[data-stage-slide] .maws-slide:not([data-provisional-ghost]) [data-provisional-veiled]').map((n) => n.dataset.provisionalVeiled).sort(),
    held: () => stage.layer()?.dataset.provisionalHeld ?? '',
    text: (id: string) => q(`[data-stage-slide] .deck-slide-frame .maws-slide [data-eid="${id}"]`)?.textContent ?? null,
    ghostText: (id: string) => q(`[data-stage-slide] [data-provisional-ghost] [data-eid="${id}"]`)?.textContent ?? null,
  };
  const stream = (files: Record<string, string>, id = 'call1') => act(() => live.frame(publishFrame(id, 'streaming', files)));
  return { ...world, live, session, ...utils, q, all, stage, stream, stop: stopLayers };
}

const edit = (file: string, ...pairs: [string, string][]) => pairs.reduce((text, [from, to]) => (expect(text).toContain(from), text.replace(from, to)), file);

describe('the deck’s provisional layer on the stage', () => {
  it('labels the slide from the frame that names its file, then draws each class of element and veils its live node', () => {
    const w = mount();
    const before = stateVector(w.doc);
    const file = w.file('s1');
    w.stream({ [slidePath('s1')]: file.slice(0, file.indexOf('Launch')) });
    expect(w.stage.label(), 'named before any element differs').toBe('Fix the dates is writing…');
    expect(w.stage.layer()!.dataset.provisionalWriting).toBe('call1');
    expect(w.stage.ghost(), 'nothing differs yet: nothing drawn').toBeNull();
    expect(w.stage.veiled()).toEqual([]);

    const next = edit(file, ['Friday, 24 October', 'Monday, 27 October'], [/<p id="body"[^>]*>Scope is frozen<\/p>\s*/.exec(file)![0], ''], ['<p id="foot"', '<p id="n1" style="font-size:32px">Hiring on track</p><p id="foot"']);
    w.stream({ [slidePath('s1')]: next.slice(0, next.indexOf('Monday') + 3) });
    expect(w.stage.shown(), 'the open element as far as it streamed').toEqual({ date: 'changed' });
    expect(w.stage.ghostText('date')).toBe('Mon');
    expect(w.stage.veiled()).toEqual(['date']);
    expect(w.stage.text('date'), 'the live slide is the live slide').toBe('Friday, 24 October');

    w.stream({ [slidePath('s1')]: next });
    expect(w.stage.shown()).toEqual({ date: 'changed', n1: 'added' });
    expect(w.stage.veiled(), 'a whole file removes what it leaves out').toEqual(['body', 'date']);

    // the provisional layout moves the footer (the removed body and the new line above it): drawn on the ghost, veiled live
    boxes.live.set('foot', [96, 600, 1728, 34]);
    boxes.ghost.set('foot', [96, 640, 1728, 34]);
    boxes.live.set('title', [96, 96, 1728, 88]);
    boxes.ghost.set('title', [96, 96, 1728, 88]);
    act(() => flushLayout());
    expect(w.stage.shown()).toEqual({ date: 'changed', n1: 'added', foot: 'moved' });
    expect(w.stage.veiled()).toEqual(['body', 'date', 'foot']);
    expect(stateVector(w.doc), 'nothing is written into the live doc').toEqual(before);
  });

  it('veils again a live node the canvas makes anew while the layer stands (a remote write elsewhere in the slide)', () => {
    const w = mount();
    w.stream({ [slidePath('s1')]: edit(w.file('s1'), ['Friday, 24 October', 'Monday, 27 October']) });
    const before = w.q('[data-stage-slide] .deck-slide-frame [data-eid="date"]')!;
    expect(before.dataset.provisionalVeiled).toBe('date');
    // another replica changes the date's tag: the live canvas replaces its node, the agent's drawing is unchanged
    act(() => transact(w.doc, () => Y.setElementKey(w.doc, 's1', 'date', 'tag', 'h3'), 'remote'));
    const after = w.q('[data-stage-slide] .deck-slide-frame [data-eid="date"]')!;
    expect(after, 'a new node').not.toBe(before);
    expect(after.dataset.provisionalVeiled).toBe('date');
  });

  it('takes no pointer, focus or name: the layer is inert and hidden from assistive technology, nothing in it focusable', () => {
    const w = mount();
    w.stream({ [slidePath('s1')]: edit(w.file('s1'), ['Launch review', 'Launch plan']) });
    const layer = w.stage.layer()!;
    expect(layer.hasAttribute('inert')).toBe(true);
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.querySelectorAll('[tabindex], [role], [aria-label], button, input, [contenteditable]')).toHaveLength(0);
    expect(w.stage.ghost()!.querySelector('[data-eid="title"]')!.getAttribute('tabindex'), 'the live canvas names its nodes; the ghost never').toBeNull();
    // between the live canvas and the overlay
    const frame = w.q('[data-stage-slide]')!;
    const order = [...frame.querySelectorAll('.deck-slide-frame, [data-provisional-layer], .deck-stage-overlay')].map((n) => n.className.split(' ')[0]);
    expect(order).toEqual(['deck-slide-frame', 'deck-provisional', 'deck-stage-overlay']);
  });

  it('never covers the element in EDIT, the ARMED one or a drag’s targets, and holds a ghost meeting one until it ends', () => {
    const w = mount();
    boxes.live.set('date', [96, 200, 1728, 56]);
    boxes.ghost.set('n1', [96, 220, 1728, 44]); // the new line drawn where the human types
    boxes.ghost.set('title', [96, 96, 1728, 88]);
    act(() => w.session.editText('date'));
    w.stream({ [slidePath('s1')]: edit(w.file('s1'), ['Friday, 24 October', 'Monday'], ['Launch review', 'Launch plan'], ['<p id="foot"', '<p id="n1" style="font-size:32px">Hiring</p><p id="foot"']) });
    expect(w.stage.shown(), 'EDIT: the element and a ghost over it wait').toEqual({ title: 'changed' });
    expect(w.stage.veiled()).toEqual(['title']);
    expect(w.stage.held().split(' ').sort()).toEqual(['date', 'n1']);
    expect(w.stage.text('date'), 'the human’s text box is untouched').toBe('Friday, 24 October');

    act(() => {
      w.session.editText(null);
      w.session.select([]);
    });
    expect(w.stage.shown(), 'drawn at the change that ends the protection').toEqual({ title: 'changed', date: 'changed', n1: 'added' });
    expect(w.stage.held()).toBe('');

    act(() => {
      w.session.setKeyboard('stage');
      w.session.select(['date']);
    });
    expect(w.stage.shown(), 'ARMED: the same').toEqual({ title: 'changed' });
    expect(w.stage.veiled()).toEqual(['title']);

    act(() => {
      w.session.select(['title', 'badge']);
      w.session.beginDrag();
    });
    expect(Object.keys(w.stage.shown()).sort(), 'a drag’s targets').toEqual(['date', 'n1']);
    expect(w.stage.veiled()).toEqual(['date']);
    act(() => w.session.endDrag());
    expect(Object.keys(w.stage.shown()).sort()).toEqual(['date', 'n1', 'title']);
  });

  it('holds back a shown container whose drawn descendant meets a protected element', () => {
    const w = mount(GROUPED);
    boxes.live.set('date', [96, 300, 1728, 56]);
    boxes.ghost.set('g', [96, 200, 1728, 80]); // the group's own box stops above the date
    boxes.ghost.set('gc', [96, 260, 400, 60]); // its pinned child reaches onto it
    act(() => {
      w.session.setKeyboard('stage');
      w.session.select(['date']);
    });
    w.stream({ [slidePath('s1')]: edit(w.file('s1'), ['background:#eef2f1', 'background:#ffd8a8'], ['Launch review', 'Launch plan']) });
    expect(w.stage.shown(), 'the group is not drawn: its child would cover the armed line').toEqual({ title: 'changed' });
    expect(w.stage.veiled()).toEqual(['title']);
    expect(w.stage.held()).toBe('g');
    act(() => w.session.select([]));
    expect(w.stage.shown()).toEqual({ title: 'changed', g: 'changed' });
  });

  it('checks the protection again after a layout pass: a drawn element grown over a protected one is held back', async () => {
    const w = mount();
    boxes.live.set('date', [96, 200, 1728, 56]);
    boxes.ghost.set('date', [96, 200, 1728, 56]); // unmoved: the layout pass finds no new move
    boxes.ghost.set('title', [96, 96, 1728, 88]);
    act(() => w.session.editText('date'));
    w.stream({ [slidePath('s1')]: edit(w.file('s1'), ['Launch review', 'Launch review and the plan for the next quarter']) });
    expect(w.stage.shown()).toEqual({ title: 'changed' });
    // the title's fit (or a face arriving) grows it over the date: no deck write, a layout pass alone
    boxes.ghost.set('title', [96, 96, 1728, 140]);
    const restyle = document.createElement('style');
    restyle.setAttribute('data-ds-scope-style', '');
    document.head.appendChild(restyle);
    await act(async () => {
      await Promise.resolve();
      flushLayout();
    });
    restyle.remove();
    expect(w.stage.shown()).toEqual({});
    expect(w.stage.held()).toBe('title');
    expect(w.stage.veiled()).toEqual([]);
  });

  it('paints nothing of the ghost but what it shows: an svg’s own visible descendant, a held container’s content included', () => {
    const art = '<svg id="art" style="position:absolute; right:64px; top:64px" width="120" height="120" viewBox="0 0 120 120"><rect style="visibility:visible" width="120" height="120" fill="#2b7a78"/></svg>';
    const w = mount(ONE.replace('</section>', `${art}\n</section>`));
    w.stream({ [slidePath('s1')]: edit(w.file('s1'), ['Launch review', 'Launch plan']) });
    expect(w.stage.shown()).toEqual({ title: 'changed' });
    const ghost = (css: string) => w.q(`[data-stage-slide] [data-provisional-ghost] ${css}`)!;
    expect(paints(ghost('[data-provisional-key="title"]')), 'what it shows paints').toBe(true);
    expect(paints(ghost('[data-eid="date"]')), 'an unchanged element does not').toBe(false);
    expect(paints(ghost('rect')), 'nor an svg’s descendant that asks to be visible').toBe(false);
    // the human edits the title: held, the ghost shows nothing, and nothing in it paints
    boxes.live.set('title', [96, 96, 1728, 88]);
    boxes.ghost.set('title', [96, 96, 1728, 88]);
    act(() => w.session.editText('title'));
    expect(w.stage.held()).toBe('title');
    expect(w.all('[data-stage-slide] [data-provisional-ghost] *').filter((node) => paints(node)), 'nothing of the held ghost paints').toEqual([]);
  });

  it('hides the label while it meets a protected element, and shows it again when the protection ends', () => {
    const w = mount();
    boxes.live.set('title', [0, 0, 1728, 120]); // the human's title at the slide's top left
    boxes.label = [8, 8, 160, 20];
    act(() => w.session.editText('title'));
    w.stream({ [slidePath('s1')]: edit(w.file('s1'), ['Friday, 24 October', 'Monday']) });
    const label = () => w.q('[data-stage-slide] [data-provisional-label]')!;
    expect(label().hasAttribute('data-provisional-held'), 'over the text the human edits').toBe(true);
    expect(paints(label()), 'and not painted').toBe(false);
    expect(w.stage.shown()).toEqual({ date: 'changed' });
    act(() => {
      w.session.editText(null);
      w.session.select([]);
    });
    expect(label().hasAttribute('data-provisional-held')).toBe(false);
    expect(paints(label())).toBe(true);
    expect(label().textContent).toBe('Fix the dates is writing…');
  });

  it('withdraws the layer in the call that applies the write, and under a held drag at the drop', () => {
    const w = mount();
    const next = edit(w.file('s1'), ['Friday, 24 October', 'Monday, 27 October']);
    w.stream({ [slidePath('s1')]: next });
    const update = w.publish({ [slidePath('s1')]: next });
    act(() => {
      w.live.frame(publishFrame('call1', 'committed', {}, 5));
      expect(w.stage.shown(), 'committed: kept until the replica holds the row').toEqual({ date: 'changed' });
      w.live.update(update, 5);
      // the same call: the live canvas patched, the ghost and the veil gone, nothing of the layer left
      expect(w.stage.text('date')).toBe('Monday, 27 October');
      expect(w.stage.ghost()).toBeNull();
      expect(w.stage.veiled()).toEqual([]);
      expect(w.stage.label()).toBeNull();
    });

    const later = edit(w.file('s1'), ['Launch review', 'Launch plan']);
    act(() => {
      w.session.select(['badge']);
      w.session.beginDrag();
    });
    w.stream({ [slidePath('s1')]: later }, 'call2');
    act(() => {
      w.live.frame(publishFrame('call2', 'committed', {}, 6));
      w.live.update(w.publish({ [slidePath('s1')]: later }), 6);
    });
    expect(w.stage.text('title'), 'held with the drag').toBe('Launch review');
    expect(w.stage.shown()).toEqual({ title: 'changed' });
    act(() => {
      w.session.endDrag();
      expect(w.stage.text('title'), 'the drop applies the write').toBe('Launch plan');
      expect(w.stage.ghost()).toBeNull();
      expect(w.stage.veiled()).toEqual([]);
      expect(w.stage.label()).toBeNull();
    });
  });

  it('leaves no trace at a refusal, on the stage or in the filmstrip', () => {
    const w = mount();
    const three = '<section id="s3"><h2 id="t3">Risks</h2></section>';
    w.stream({ [slidePath('s1')]: edit(w.file('s1'), ['Friday, 24 October', 'Monday'], [/<p id="body"[^>]*>Scope is frozen<\/p>/.exec(w.file('s1'))![0], '']), [slidePath('s3')]: three });
    expect(w.stage.veiled()).toEqual(['body', 'date']);
    expect(w.q('[data-provisional-new-slide="s3"]')).not.toBeNull();
    act(() => {
      w.live.frame(publishFrame('call1', 'dropped'));
      expect(w.stage.ghost(), 'the stage withdraws in the call').toBeNull();
    });
    expect(w.stage.layer()!.childElementCount, 'the layer holds its empty scaler alone').toBe(1);
    expect(w.stage.layer()!.querySelector('.maws-slide')).toBeNull();
    expect(w.stage.layer()!.hasAttribute('data-provisional-writing')).toBe(false);
    expect(w.stage.veiled()).toEqual([]);
    expect(w.all('[data-provisional-thumb][data-provisional-writing], [data-provisional-thumb] .maws-slide, [data-provisional-new-slide]')).toEqual([]);
    expect(w.stage.text('date')).toBe('Friday, 24 October');
  });
});

describe('the deck’s provisional layer in the filmstrip', () => {
  it('rings every slide being written and draws its whole provisional slide; the stage stays on the human’s slide', () => {
    const w = mount();
    w.stream({ [slidePath('s2')]: edit(w.file('s2'), ['Numbers', 'Figures']) });
    const thumb = w.q('[data-slide-thumb="s2"] [data-provisional-thumb]')!;
    expect(thumb.dataset.provisionalWriting).toBe('call1');
    expect(thumb.querySelector('.maws-slide [data-eid="t2"]')!.textContent).toBe('Figures');
    expect(thumb.hasAttribute('inert')).toBe(true);
    expect(w.q('[data-slide-thumb="s1"] [data-provisional-thumb]')!.hasAttribute('data-provisional-writing')).toBe(false);
    expect(w.session.snapshot().currentSlide, 'the stage never follows the agent').toBe('s1');
    expect(w.stage.label()).toBeNull();
  });

  it('shows a new slide at its place in the streamed index as an entry that is no button, until its real entry comes', () => {
    const w = mount();
    const three = '<section id="s3" style="background:#000000"><h2 id="t3" style="font-size:64px; color:#ffffff">Risks</h2></section>';
    const index = w.index().replace('"s2"', '"s3", "s2"');
    w.stream({ [slidePath('s3')]: three.slice(0, three.indexOf('Ri') + 2) });
    const entries = () => w.all('.deck-filmstrip-list > li').map((li) => li.dataset.provisionalNewSlide ?? li.querySelector<HTMLElement>('[data-slide-thumb]')!.dataset.slideThumb);
    expect(entries(), 'last until the index names it').toEqual(['s1', 's2', 's3']);
    w.stream({ [DECK_PATH]: index });
    expect(entries()).toEqual(['s1', 's3', 's2']);
    const entry = w.q('[data-provisional-new-slide="s3"]')!;
    expect(entry.hasAttribute('inert')).toBe(true);
    expect(entry.querySelectorAll('button, [tabindex], [role="button"]')).toHaveLength(0);
    expect(entry.querySelector('[data-provisional-thumb] .maws-slide [data-eid="t3"]')!.textContent).toBe('Ri');

    act(() => {
      w.live.frame(publishFrame('call1', 'committed', {}, 4));
      w.live.update(w.publish({ [DECK_PATH]: index, [slidePath('s3')]: three }), 4);
      // the layer is withdrawn in this call; React swaps the entries in the render after it: until then the ghost entry
      // still paints its slide (no paint shows neither)
      expect(w.q('[data-provisional-new-slide="s3"] [data-provisional-thumb] .maws-slide [data-eid="t3"]')?.textContent, 'the ghost entry keeps its last drawing until React unmounts it').toBe('Ri');
    });
    expect(w.q('[data-slide-thumb="s3"] .deck-slide-frame .maws-slide [data-eid="t3"]')?.textContent, 'the real entry paints in the render that removes the ghost').toBe('Risks');
    expect(slideOrder(w.doc)).toEqual(['s1', 's3', 's2']);
    expect(entries(), 'one entry, the real one').toEqual(['s1', 's3', 's2']);
    expect(w.q('[data-provisional-new-slide]')).toBeNull();
    expect(w.q('[data-slide-thumb="s3"] [data-provisional-thumb]')!.hasAttribute('data-provisional-writing')).toBe(false);
  });
});

describe('the stage layer’s scale', () => {
  it('checks the label against the protected boxes again when the stage’s scale changes with nothing else (Fit as the pane resizes)', async () => {
    const world = deckWorld({ s1: ONE, s2: TWO });
    const live = replica(world.doc);
    const stopLayers = live.layers.attach();
    const deck = new DeckProvisional(live.layers, world.doc);
    const stopDeck = deck.attach();
    const session = new DeckSession(world.doc, 0);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const canvas = new SlideCanvas(world.doc, 's1', host);
    const assetUrl = () => null; // stable, as the editor's is: only the scale changes below
    const layer = (scale: number) => <SlideLayer deck={deck} canvas={canvas} slideId="s1" scale={scale} session={session} assetUrl={assetUrl} />;
    const { container, rerender } = render(layer(0.5));
    boxes.live.set('title', [96, 48, 864, 44]); // the human's title, below the screen-sized label at this scale
    boxes.label = [8, 8, 160, 20];
    act(() => session.editText('title'));
    act(() => live.frame(publishFrame('call1', 'streaming', { [slidePath('s1')]: edit(world.file('s1'), ['Friday, 24 October', 'Monday']) })));
    act(() => flushLayout()); // every layout pass the canvases scheduled is done: what follows changes no layout
    const label = () => container.querySelector<HTMLElement>('[data-provisional-label]')!;
    expect(label().hasAttribute('data-provisional-held')).toBe(false);
    // the pane narrows: Fit draws the slide smaller, the label keeps its size, and now meets the title
    boxes.live.set('title', [24, 12, 216, 11]);
    rerender(layer(0.125));
    await act(async () => {});
    expect(label().hasAttribute('data-provisional-held'), 'held once the new transform is applied').toBe(true);
    stopDeck();
    stopLayers();
    canvas.dispose();
  });
});
