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

// The screen rect an element shows at the motion's start: each motion (translate after a scale about the element's own
// final centre) applied from the element up through its moving ancestors.
function startRect(items: readonly MagicItem[], motions: Map<string, { dx: number; dy: number; sx: number; sy: number }>, id: string, scale: number): MotionRect {
  let rect = items.find((i) => i.id === id)!.to;
  for (let at: MagicItem | undefined = items.find((i) => i.id === id); at; at = items.find((i) => i.id === at!.ancestor)) {
    const m = motions.get(at.id)!;
    const [cx, cy] = [at.to.x + at.to.w / 2, at.to.y + at.to.h / 2];
    rect = { x: cx + (rect.x - cx) * m.sx + m.dx * scale, y: cy + (rect.y - cy) * m.sy + m.dy * scale, w: rect.w * m.sx, h: rect.h * m.sy };
  }
  return rect;
}
const near = (a: MotionRect, b: MotionRect) => expect([a.x, a.y, a.w, a.h].map((v) => Math.round(v * 1000) / 1000)).toEqual([b.x, b.y, b.w, b.h]);

describe('a magic move’s motions', () => {
  it('gives a matched child inside a matched, scaling group only its own motion', () => {
    const scale = 0.5;
    const items: MagicItem[] = [
      { id: 'g', ancestor: null, from: { x: 0, y: 0, w: 200, h: 100 }, to: { x: 400, y: 200, w: 400, h: 200 } },
      // moved and scaled with its group exactly: no motion of its own
      { id: 'still', ancestor: 'g', from: { x: 50, y: 25, w: 50, h: 25 }, to: { x: 500, y: 250, w: 100, h: 50 } },
      // moved within its group too, and nested once more
      { id: 'inner', ancestor: 'g', from: { x: 120, y: 60, w: 40, h: 20 }, to: { x: 450, y: 300, w: 160, h: 40 } },
      { id: 'deep', ancestor: 'inner', from: { x: 125, y: 62, w: 10, h: 10 }, to: { x: 470, y: 310, w: 20, h: 20 } },
    ];
    const motions = magicMotions(items, scale);
    const still = motions.get('still')!;
    expect([still.dx, still.dy, still.sx, still.sy].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 1, 1]);
    for (const item of items) near(startRect(items, motions, item.id, scale), item.from);
  });
});
