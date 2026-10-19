// P3-C M6 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D13): the show's stage under happy-dom with
// a stand-in for Web Animations: every layer it makes is disposed once its slide has gone (a cut, a transition played
// out or forced, the stage disposed mid-move), a first entry plays the slide's entry builds, and a magic move gives a
// matched element inside a matched group only the motion the group does not already give it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newDoc, transact, type Doc } from '../../../yjs';
import { SlideCanvas } from '../../canvas';
import { importSlide, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { slideSteps } from './sequence';
import type { Affine } from '../../geometry';
import { magicMotions, ShowStage, type MagicItem, type MotionRect } from './stage';

interface Fake {
  target: Element;
  frames: Keyframe[];
  state: 'running' | 'finished' | 'cancelled';
  finish(): void;
  cancel(): void;
  finished: Promise<unknown>;
}
const played: Fake[] = [];
const native = (Element.prototype as { animate?: unknown }).animate;
beforeEach(() => {
  played.length = 0;
  (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[]) {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const finished = new Promise((res, rej) => ((resolve = res), (reject = rej)));
    finished.catch(() => {});
    const fake: Fake = {
      target: this,
      frames,
      state: 'running',
      finished,
      finish() {
        if (fake.state !== 'running') return;
        fake.state = 'finished';
        resolve(fake);
      },
      cancel() {
        if (fake.state !== 'running') return;
        fake.state = 'cancelled';
        reject(new Error('AbortError'));
      },
    };
    played.push(fake);
    return fake;
  };
});
afterEach(() => {
  (Element.prototype as { animate?: unknown }).animate = native;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const pin = (id: string, attrs = '') => `<p id="${id}" ${attrs} style="position:absolute; left:100px; top:100px; width:400px; font-size:40px">${id}</p>`;
function deck(): Doc {
  const files: Record<string, string> = {
    s1: `<section id="s1" data-transition="fade"><h1 id="t" style="font-size:96px">One</h1></section>`,
    s2: `<section id="s2" data-transition="push"><h1 id="t" style="font-size:96px">Two</h1></section>`,
    s3: `<section id="s3"><h1 id="t" style="font-size:96px">Three</h1></section>`,
    s4: `<section id="s4">${pin('auto1', 'data-build-in="fade auto"')}</section>`,
    s5: `<section id="s5">${pin('c1', 'data-build-in="fade 1"')}${pin('c2', 'data-build-in="fade 2"')}${pin('c3', 'data-build-in="fade 3"')}</section>`,
  };
  const doc = newDoc();
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: Object.keys(files) });
    Object.entries(files).forEach(([id, html], i) => {
      const loaded = loadSlide(html, { fileId: id });
      if (!loaded.ok) throw new Error(`fixture ${id}`);
      importSlide(doc, loaded.slide, `a${i}`);
    });
  });
  return doc;
}

function counted() {
  const made = vi.spyOn(SlideCanvas.prototype as unknown as { renderAll(): void }, 'renderAll');
  const disposed = vi.spyOn(SlideCanvas.prototype, 'dispose');
  return { live: () => made.mock.calls.length - disposed.mock.calls.length, made: () => made.mock.calls.length, disposed: () => disposed.mock.calls.length };
}
function stageOf(doc: Doc) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stage = new ShowStage(host, doc, { assetUrl: () => null, animate: true });
  const layers = () => host.querySelectorAll('.present-layer').length;
  const go = (slideId: string, move: 'forward' | 'back' | 'jump' | 'enter', transition: 'fade' | 'push' | null = null) => stage.show({ slideId, build: 0 }, slideSteps(doc, slideId), move, transition);
  return { stage, layers, go, host };
}

describe('the stage’s layers', () => {
  it('disposes the leaving slide’s canvas on a cut', () => {
    const canvases = counted();
    const { go, layers } = stageOf(deck());
    go('s1', 'jump');
    go('s3', 'jump');
    expect([canvases.made(), canvases.disposed(), canvases.live(), layers()]).toEqual([2, 1, 1, 1]);
  });

  it('lets go of the leaving layer when a fade or a push plays out, once', async () => {
    const canvases = counted();
    const { go, layers } = stageOf(deck());
    go('s1', 'jump');
    go('s2', 'forward', 'fade');
    expect(layers()).toBe(2);
    played.forEach((a) => a.finish());
    await settle();
    expect([layers(), canvases.live()]).toEqual([1, 1]);
    go('s3', 'forward', 'push');
    expect(layers()).toBe(2);
    played.forEach((a) => a.finish());
    await settle();
    expect([layers(), canvases.live(), canvases.disposed()]).toEqual([1, 1, 2]);
  });

  it('lets go of it once when the next move forces the transition to its end', async () => {
    const canvases = counted();
    const { go, layers } = stageOf(deck());
    go('s1', 'jump');
    go('s2', 'forward', 'fade');
    go('s3', 'forward', 'push'); // the fade forced to its end, then the push
    played.forEach((a) => a.finish());
    await settle();
    expect([layers(), canvases.live(), canvases.disposed()]).toEqual([1, 1, 2]);
  });

  it('disposes every canvas when the stage goes mid-transition', () => {
    const canvases = counted();
    const { stage, go, host } = stageOf(deck());
    go('s1', 'jump');
    go('s2', 'forward', 'fade');
    stage.dispose();
    expect([canvases.made(), canvases.disposed(), host.childElementCount]).toEqual([2, 2, 0]);
  });
});

describe('a first entry', () => {
  it('plays the slide’s entry builds; a jump shows it built', () => {
    const doc = deck();
    stageOf(doc).go('s4', 'enter');
    expect(played.some((a) => (a.target as HTMLElement).dataset.eid === 'auto1')).toBe(true);
    played.length = 0;
    stageOf(doc).go('s4', 'jump');
    expect(played).toEqual([]);
  });
});

// P3-F slide-editor scalpel-3#1: a stage made anew mid-slide (the audience view remounted after P twice, or a slide written
// anew where the show stands) enters at the position's build, not at the slide's entry
describe('a stage that enters mid-slide', () => {
  it('shows the clicks played before it, plays only the current one, and the next click plays only its own', () => {
    const doc = deck();
    const steps = slideSteps(doc, 's5');
    const first = stageOf(doc).stage;
    first.show({ slideId: 's5', build: 0 }, steps, 'enter');
    first.show({ slideId: 's5', build: 1 }, steps, 'forward');
    first.show({ slideId: 's5', build: 2 }, steps, 'forward');
    first.dispose();
    played.length = 0;
    const { stage } = stageOf(doc);
    stage.show({ slideId: 's5', build: 2 }, steps, 'forward'); // the remount: the show's last move, at build 2
    const eids = () => played.map((a) => (a.target as HTMLElement).dataset.eid);
    expect([[...stage.hiddenNow()], eids()]).toEqual([['c3'], ['c2']]);
    played.length = 0;
    stage.show({ slideId: 's5', build: 3 }, steps, 'forward');
    expect([[...stage.hiddenNow()], eids()]).toEqual([[], ['c3']]);
  });
});

// Where an element's centre and its screen box start: its own motion (a translate in its parent's frame, a scale about its
// own centre in that frame) then each moving ancestor's, all mapped to the screen through each one's parent frame, as
// the browser composes them; written apart from `magicMotions` so the test checks the composition, not the code.
type Motions = ReadonlyMap<string, { dx: number; dy: number; sx: number; sy: number } | 'fade'>;
const lin = (m: Affine, x: number, y: number) => ({ x: m.a * x + m.c * y, y: m.b * x + m.d * y });
const solve = (m: Affine, x: number, y: number) => {
  const det = m.a * m.d - m.b * m.c;
  return { x: (m.d * x - m.c * y) / det, y: (-m.b * x + m.a * y) / det };
};
function moveOf(item: MagicItem, m: Motions, p: { x: number; y: number }) {
  const got = m.get(item.id)!;
  if (got === 'fade') return p; // drawn where it is, fading in
  const own = got;
  const c = { x: item.to.x + item.to.w / 2, y: item.to.y + item.to.h / 2 };
  const local = solve(item.parent, p.x - c.x, p.y - c.y); // into the parent's frame, about the centre
  const scaled = lin(item.parent, local.x * own.sx, local.y * own.sy);
  const shifted = lin(item.parent, own.dx, own.dy);
  return { x: c.x + scaled.x + shifted.x, y: c.y + scaled.y + shifted.y };
}
function startOf(items: readonly MagicItem[], m: Motions, id: string): MotionRect {
  const item = items.find((i) => i.id === id)!;
  const chain: MagicItem[] = [];
  for (let at: MagicItem | undefined = item; at; at = items.find((i) => i.id === at!.ancestor)) chain.push(at);
  const map = (p: { x: number; y: number }) => chain.reduce((q, at) => moveOf(at, m, q), p);
  const tl = map({ x: item.to.x, y: item.to.y });
  const br = map({ x: item.to.x + item.to.w, y: item.to.y + item.to.h });
  const [x0, x1] = [Math.min(tl.x, br.x), Math.max(tl.x, br.x)];
  const [y0, y1] = [Math.min(tl.y, br.y), Math.max(tl.y, br.y)];
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** An element's own motion, which the case expects it to take (not the fade route). */
function movedBy(m: Motions, id: string) {
  const got = m.get(id);
  if (got === undefined || got === 'fade') throw new Error(`${id} takes no motion of its own`);
  return got;
}
const near = (a: MotionRect, b: MotionRect) => expect([a.x, a.y, a.w, a.h].map((v) => Math.round(v * 1000) / 1000)).toEqual([b.x, b.y, b.w, b.h]);
const scaled = (k: number): Affine => ({ a: k, b: 0, c: 0, d: k, e: 0, f: 0 });
const turned = (deg: number, k: number): Affine => {
  const t = (deg * Math.PI) / 180;
  return { a: k * Math.cos(t), b: k * Math.sin(t), c: -k * Math.sin(t), d: k * Math.cos(t), e: 0, f: 0 };
};

describe('a magic move’s motions', () => {
  it('gives a matched child inside a matched, scaling group only its own motion', () => {
    const scale = 0.5;
    const items: MagicItem[] = [
      { id: 'g', ancestor: null, parent: scaled(scale), from: { x: 0, y: 0, w: 200, h: 100 }, to: { x: 400, y: 200, w: 400, h: 200 } },
      // moved and scaled with its group exactly: no motion of its own
      { id: 'still', ancestor: 'g', parent: scaled(scale), from: { x: 50, y: 25, w: 50, h: 25 }, to: { x: 500, y: 250, w: 100, h: 50 } },
      // moved within its group too, and nested once more
      { id: 'inner', ancestor: 'g', parent: scaled(scale), from: { x: 120, y: 60, w: 40, h: 20 }, to: { x: 450, y: 300, w: 160, h: 40 } },
      { id: 'deep', ancestor: 'inner', parent: scaled(scale), from: { x: 125, y: 62, w: 10, h: 10 }, to: { x: 470, y: 310, w: 20, h: 20 } },
    ];
    const motions = magicMotions(items);
    const still = movedBy(motions, 'still');
    expect([still.dx, still.dy, still.sx, still.sy].map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 0, 1, 1]);
    for (const item of items) near(startOf(items, motions, item.id), item.from);
  });

  // fix wave 2: the child's motion is in its parent's own frame, which the parent's authored transform turns
  it('maps a residual through a parent turned by its own transform (the review’s case), and through a turned, moving group', () => {
    // a 400×200 group turned 90° moves from left 200 to left 500 (top 300); its 50×50 child from local left 50 to 100
    // (top 25). Drawn: the group's box turned about its centre; the child's centre through the turn.
    const turn = (left: number, top: number, w: number, h: number, x: number, y: number) => {
      const [cx, cy] = [left + w / 2, top + h / 2];
      return { x: cx - (y - (top + h / 2)) + 0 * x, y: cy + (x - (left + w / 2)) };
    };
    const box = (c: { x: number; y: number }, w: number, h: number): MotionRect => ({ x: c.x - w / 2, y: c.y - h / 2, w, h });
    const groupFrom = box({ x: 400, y: 400 }, 200, 400); // turned: its bounds are 200 wide, 400 tall
    const groupTo = box({ x: 700, y: 400 }, 200, 400);
    const kidFrom = box(turn(200, 300, 400, 200, 200 + 75, 300 + 50), 50, 50);
    const kidTo = box(turn(500, 300, 400, 200, 500 + 125, 300 + 50), 50, 50);
    const items: MagicItem[] = [
      { id: 'g', ancestor: null, parent: scaled(1), from: groupFrom, to: groupTo },
      { id: 'kid', ancestor: 'g', parent: turned(90, 1), from: kidFrom, to: kidTo },
    ];
    const motions = magicMotions(items);
    const kid = movedBy(motions, 'kid');
    // in the group's own frame the child only moves back by its own 50 px
    expect([kid.dx, kid.dy, kid.sx, kid.sy].map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([-50, 0, 1, 1]);
    near(startOf(items, motions, 'kid'), kidFrom);
    // the same under a stage at half size and a child that also grows in its turned frame
    const half: MagicItem[] = [
      { id: 'g', ancestor: null, parent: scaled(0.5), from: { x: 150, y: 150, w: 100, h: 200 }, to: { x: 300, y: 150, w: 100, h: 200 } },
      { id: 'kid', ancestor: 'g', parent: turned(90, 0.5), from: { x: 180, y: 160, w: 20, h: 40 }, to: { x: 330, y: 170, w: 40, h: 40 } },
    ];
    const m2 = magicMotions(half);
    for (const item of half) near(startOf(half, m2, item.id), item.from);
  });

  // fix wave 3: CSS's `scale` is diagonal in the parent's frame; a resize that is not, under a parent turned off the axes,
  // cannot start where it was, so that element fades instead (its descendants keep their own motions)
  it('fades an element whose start needs an off-diagonal scale under a 30°-turned parent; a uniform resize still moves', () => {
    const group = { id: 'g', ancestor: null, parent: scaled(1), from: { x: 0, y: 0, w: 400, h: 400 }, to: { x: 0, y: 0, w: 400, h: 400 } };
    const squashed: MagicItem[] = [
      group,
      // twice as wide, the same height: in a 30°-turned frame that scale has an off-diagonal part
      { id: 'kid', ancestor: 'g', parent: turned(30, 1), from: { x: 100, y: 100, w: 100, h: 100 }, to: { x: 100, y: 100, w: 200, h: 100 } },
      // its own child moves by a plain translation, in the same turned frame
      { id: 'dot', ancestor: 'kid', parent: turned(30, 1), from: { x: 110, y: 110, w: 10, h: 10 }, to: { x: 130, y: 110, w: 10, h: 10 } },
    ];
    const motions = magicMotions(squashed);
    expect(motions.get('kid')).toBe('fade');
    // the faded element stays where it is drawn: its descendant's motion composes with its ancestors' alone
    expect(motions.get('dot')).not.toBe('fade');
    near(startOf(squashed.filter((i) => i.id !== 'kid').map((i) => (i.id === 'dot' ? { ...i, ancestor: 'g' } : i)), motions, 'dot'), squashed[2]!.from);
    // a uniform resize in the same frame is a scalar: it moves and starts where it was
    const uniform: MagicItem[] = [group, { id: 'kid', ancestor: 'g', parent: turned(30, 1), from: { x: 100, y: 100, w: 100, h: 100 }, to: { x: 80, y: 90, w: 200, h: 200 } }];
    const moved = magicMotions(uniform);
    expect(moved.get('kid')).not.toBe('fade');
    near(startOf(uniform, moved, 'kid'), uniform[1]!.from);
  });
});
