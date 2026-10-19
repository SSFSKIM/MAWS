// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D13; M6): one view of the show: a 1920×1080 box drawing
// the slide at a position, live from the replica (a SlideCanvas per slide shown), with what has not built yet hidden.
// The audience view animates: a click's builds play beat by beat, and a change of slide plays the leaving slide's
// transition (fade, push, magic move by equal ids on pinned elements); the presenter's views jump. Any motion still
// running is finished before the next one starts, so a fast clicker never sees a half-built slide. The box is scaled
// by its owner (a CSS transform); nothing here writes the model.
import type { Doc } from '../../../yjs';
import { slideToken } from '../../../yjs/slides-observe';
import { SlideCanvas, type AssetUrl } from '../../canvas';
import { isPinned, type Tag } from '../../ir';
import { readFlat } from '../../model';
import { apply, applyLinear, IDENTITY, invert, linear, multiply, shift, transformMatrix, type Affine } from '../../geometry';
import { BUILD_MS, buildKeyframes, canAnimate, EASE_IN_OUT, EASE_OUT, TRANSITION_MS } from './effects';
import { hiddenAt, type BuildEvent, type Position, type SlideSteps, type Transition } from './sequence';

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export interface ShowStageOptions {
  assetUrl: AssetUrl;
  /** Where an x-embed's page runs (Decision Log 18); without it, the presenter's previews draw embeds as placeholders. */
  embedUrl?: (slideId: string, elementId: string, raw: string) => string;
  /** Plays builds and transitions (the audience view); else every move is a cut. */
  animate: boolean;
}

/**
 * How the show moved to a position: forward by one step, back by one, a jump (Home, End, a sync, a slide gone from the
 * show), or `enter`: the audience's first sight of the show, which plays the slide's entry builds (fix wave 1).
 */
export type Move = 'forward' | 'back' | 'jump' | 'enter';

interface Layer {
  el: HTMLDivElement;
  canvas: SlideCanvas;
  slideId: string;
  /** The slide's node the canvas observes: a slide written anew (an undo bringing it back) is drawn anew. */
  token: object | null;
  build: number;
  hidden: Set<string>;
  style: HTMLStyleElement;
}

let layers = 0;

export class ShowStage {
  readonly root: HTMLDivElement;
  private layer: Layer | null = null;
  /** Every layer drawn: the one shown and any a transition is still taking away. */
  private readonly layers = new Set<Layer>();
  private readonly running = new Set<Animation>();
  /** What a motion leaves to do when it ends, naturally or forced: each runs once. */
  private readonly settles = new Set<() => void>();

  constructor(
    host: HTMLElement,
    private readonly doc: Doc,
    private readonly options: ShowStageOptions,
  ) {
    this.root = host.ownerDocument.createElement('div');
    this.root.className = 'present-stage';
    this.root.style.cssText = `position:relative; width:${SLIDE_W}px; height:${SLIDE_H}px; overflow:hidden`;
    host.appendChild(this.root);
  }

  /** The slide shown and the clicks played on it. */
  get at(): Position | null {
    return this.layer && { slideId: this.layer.slideId, build: this.layer.build };
  }

  /**
   * Shows `pos`. `steps` are its slide's; `transition` is how the move between two slides plays (the leaving slide's
   * going forward, the arriving slide's going back), reversed when `move` is back.
   */
  show(pos: Position, steps: SlideSteps, move: Move, transition: Transition | null = null): void {
    const fresh = this.layer && this.layer.slideId === pos.slideId && this.layer.token !== slideToken(this.doc, pos.slideId);
    if (fresh) {
      this.finishMotion();
      this.removeLayer(this.layer!);
      this.layer = null;
    }
    const layer = this.layer;
    if (layer && layer.slideId === pos.slideId && layer.build === pos.build) {
      // the same place, the deck changed: what is hidden follows it, once any motion has played out
      if (this.running.size === 0) this.setHidden(layer, hiddenAt(steps, pos.build));
      return;
    }
    this.finishMotion();
    const animate = this.options.animate && canAnimate(this.root);
    if (layer && layer.slideId === pos.slideId) {
      if (animate && move === 'forward' && pos.build === layer.build + 1) this.playGroup(layer, steps, pos.build, 0);
      else this.setHidden(layer, hiddenAt(steps, pos.build));
      layer.build = pos.build;
      return;
    }
    // a new slide: forward (or the first entry) with motion, after the transition its position's group plays over what the
    // clicks before it built (P3-F: a layer made mid-slide, a remount or a slide written anew where the show stands, enters
    // at its build, not at the slide's entry); any other move shows it as built
    const entering = animate && (move === 'forward' || move === 'enter');
    const next = this.makeLayer(pos.slideId, pos.build, hiddenAt(steps, entering ? pos.build - 1 : pos.build));
    this.layer = next;
    const delay = layer && animate && transition ? TRANSITION_MS : 0;
    if (layer) {
      if (animate && transition) this.transit(layer, next, transition, move === 'back');
      else this.removeLayer(layer);
    }
    if (entering) this.playGroup(next, steps, pos.build, delay);
  }

  /** The elements of the slide shown, hidden or not, as drawn now (the e2e reads them). */
  hiddenNow(): ReadonlySet<string> {
    return this.layer?.hidden ?? new Set();
  }

  dispose(): void {
    this.finishMotion();
    for (const layer of [...this.layers]) this.removeLayer(layer);
    this.layer = null;
    this.root.remove();
  }

  // ---- layers

  private makeLayer(slideId: string, build: number, hidden: Set<string>): Layer {
    const document = this.root.ownerDocument;
    const el = document.createElement('div');
    el.className = 'present-layer';
    el.dataset.presentLayer = String(++layers);
    el.style.cssText = `position:absolute; inset:0`;
    const style = document.createElement('style');
    el.appendChild(style);
    this.root.appendChild(el);
    const canvas = new SlideCanvas(this.doc, slideId, el, { assetUrl: this.options.assetUrl, thumbnail: !this.options.embedUrl, ...(this.options.embedUrl && { embedUrl: this.options.embedUrl }) });
    const layer: Layer = { el, canvas, slideId, token: slideToken(this.doc, slideId), build, hidden: new Set(), style };
    this.layers.add(layer);
    this.setHidden(layer, hidden);
    return layer;
  }

  private setHidden(layer: Layer, hidden: Set<string>): void {
    layer.hidden = hidden;
    const scope = `[data-present-layer="${layer.el.dataset.presentLayer}"]`;
    layer.style.textContent = hidden.size ? `${[...hidden].map((id) => `${scope} [data-eid="${id}"]`).join(',\n')} { visibility: hidden !important; }` : '';
  }

  private removeLayer(layer: Layer): void {
    if (!this.layers.delete(layer)) return;
    layer.canvas.dispose();
    layer.el.remove();
  }

  // ---- motion

  /** A motion; `settle` runs once when it ends, played out, forced to its end or cancelled. */
  private track(animation: Animation, settle?: () => void): void {
    this.running.add(animation);
    let once: (() => void) | undefined;
    if (settle) {
      once = () => {
        if (!this.settles.delete(once!)) return;
        settle();
      };
      this.settles.add(once);
    }
    const ended = () => {
      this.running.delete(animation);
      once?.();
    };
    void animation.finished.then(ended, ended);
  }

  /** Ends every motion now, at its end state. */
  private finishMotion(): void {
    for (const animation of [...this.running]) {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
    }
    this.running.clear();
    for (const settle of [...this.settles]) settle();
  }

  /** A click's beats, each after the one before; built-in elements show as they start, built-out ones go as they end. */
  private playGroup(layer: Layer, steps: SlideSteps, group: number, delay: number): void {
    const beats = steps.groups[group] ?? [];
    const hidden = new Set(layer.hidden);
    for (const beat of beats) for (const event of beat) if (event.kind === 'in') hidden.delete(event.id);
    this.setHidden(layer, hidden); // what builds in shows now: its first keyframe keeps it invisible until its beat
    beats.forEach((beat, i) => {
      for (const event of beat) this.playBuild(layer, event, delay + i * BUILD_MS);
    });
  }

  private playBuild(layer: Layer, event: BuildEvent, delay: number): void {
    const node = layer.canvas.node(event.id);
    if (!node) {
      if (event.kind === 'out') this.hide(layer, event.id);
      return;
    }
    const frames = buildKeyframes(event.effect);
    if (event.kind === 'in') {
      this.track(node.animate(frames, { duration: BUILD_MS, delay, easing: EASE_OUT, fill: 'backwards' }));
      return;
    }
    const animation = node.animate([...frames].reverse(), { duration: BUILD_MS, delay, easing: EASE_OUT, fill: 'forwards' });
    this.track(animation, () => {
      this.hide(layer, event.id); // gone for good, then the animation's hold on it let go
      animation.cancel();
    });
  }

  private hide(layer: Layer, id: string): void {
    if (this.layer !== layer || layer.hidden.has(id)) return;
    this.setHidden(layer, new Set([...layer.hidden, id]));
  }

  private transit(from: Layer, to: Layer, transition: Transition, back: boolean): void {
    const done = () => this.removeLayer(from);
    const options: KeyframeAnimationOptions = { duration: TRANSITION_MS, easing: EASE_IN_OUT };
    if (transition === 'fade') {
      this.track(to.el.animate([{ opacity: 0 }, { opacity: 1 }], options), done);
    } else if (transition === 'push') {
      const sign = back ? -1 : 1;
      // the leaving layer's own motion settles nothing: its layer goes with the arriving one's
      this.track(from.el.animate([{ translate: '0px 0px' }, { translate: `${-sign * SLIDE_W}px 0px` }], options));
      this.track(to.el.animate([{ translate: `${sign * SLIDE_W}px 0px` }, { translate: '0px 0px' }], options), done);
    } else {
      this.magicMove(from, to, options);
      done();
    }
  }

  /**
   * Magic move: each pinned element on both slides (by id) moves and resizes from where it was to where it is, a matched
   * element inside a matched one by only the motion its moving ancestors do not already give it (fix wave 1); the rest
   * of the arriving slide fades in over it. The leaving slide goes at once (the arriving one paints its own ground).
   */
  private magicMove(from: Layer, to: Layer, options: KeyframeAnimationOptions): void {
    const pinned = (slideId: string) => new Set(readFlat(this.doc, slideId, false).filter((e) => isPinned(e.tag as Tag, e.style, e.attrs)).map((e) => e.id));
    const before = pinned(from.slideId);
    const matched = [...pinned(to.slideId)].filter((id) => before.has(id) && !from.hidden.has(id) && !to.hidden.has(id));
    to.canvas.layoutNow();
    const scale = this.root.getBoundingClientRect().width / SLIDE_W || 1;
    const rect = (r: DOMRect | undefined): MotionRect | null => (r && r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
    const nodes = new Map<string, HTMLElement>();
    const found: { id: string; node: HTMLElement; from: MotionRect; to: MotionRect }[] = [];
    for (const id of matched) {
      const node = to.canvas.node(id);
      const a = rect(from.canvas.node(id)?.getBoundingClientRect());
      const b = rect(node?.getBoundingClientRect());
      if (node && a && b) found.push({ id, node, from: a, to: b });
    }
    // ancestors before their descendants, each with its nearest moving ancestor
    const depth = (n: Node) => {
      let d = 0;
      for (let at: Node | null = n; at; at = at.parentNode) d++;
      return d;
    };
    found.sort((a, b) => depth(a.node) - depth(b.node));
    for (const f of found) nodes.set(f.id, f.node);
    // a parent's frame on screen: the stage's scale, then each element's own transform down to it (computed, so a token
    // reads as what it draws; the moving ancestors' motions are the composite's, not this)
    const frameOf = (parent: HTMLElement | null): Affine => {
      const chain: HTMLElement[] = [];
      for (let at = parent; at && at !== to.canvas.root; at = at.parentElement) chain.unshift(at);
      return chain.reduce((m, el) => multiply(m, linear(transformMatrix(getComputedStyle(el).transform, el.offsetWidth, el.offsetHeight))), { ...IDENTITY, a: scale, d: scale });
    };
    const items: MagicItem[] = found.map((f) => {
      let ancestor: string | null = null;
      for (let at = f.node.parentElement; at && at !== to.canvas.root && ancestor === null; at = at.parentElement) {
        const id = at.dataset.eid;
        if (id !== undefined && nodes.get(id) === at) ancestor = id;
      }
      return { id: f.id, ancestor, parent: frameOf(f.node.parentElement), from: f.from, to: f.to };
    });
    const motions = magicMotions(items);
    const moving = new Set<HTMLElement>();
    const faded = new Set<HTMLElement>();
    for (const f of found) {
      const m = motions.get(f.id)!;
      // fix wave 3: a start CSS's `scale` cannot draw fades in where it is, as the unmatched content does
      if (m === 'fade') {
        faded.add(f.node);
        this.track(f.node.animate([{ opacity: 0 }, { opacity: 1 }], options));
        continue;
      }
      moving.add(f.node);
      this.track(f.node.animate([{ translate: `${m.dx}px ${m.dy}px`, scale: `${m.sx} ${m.sy}` }, { translate: '0px 0px', scale: '1 1' }], options));
    }
    // everything else on the arriving slide (that holds no moving element) fades in
    const fade = (el: Element) => {
      for (const child of Array.from(el.children) as HTMLElement[]) {
        if (child.tagName === 'STYLE' || moving.has(child) || faded.has(child)) continue;
        if ([...moving].some((m) => child.contains(m))) fade(child);
        else this.track(child.animate([{ opacity: 0 }, { opacity: 1 }], options));
      }
    };
    fade(to.canvas.root);
  }
}

/** A box on screen (px): left, top, width, height. */
export interface MotionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/**
 * A matched element of a magic move: its nearest moving ancestor (listed before it), its box on screen before and after,
 * and `parent`: the linear map of its parent's frame onto the screen as the arriving slide is drawn (the stage's scale
 * and every ancestor's own transform), where its `translate` and `scale` act.
 */
export interface MagicItem {
  id: string;
  ancestor: string | null;
  parent: Affine;
  from: MotionRect;
  to: MotionRect;
}
/**
 * An element's own starting motion: `translate` in its parent's frame (px), `scale` about its own centre in that frame;
 * or `'fade'` when its start needs a scale CSS's diagonal `scale` cannot draw (fix wave 3).
 */
export interface Motion {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
}

/**
 * Each matched element's starting motion, so that with its moving ancestors' it starts where it was (fix wave 2: in its
 * parent's own frame). On screen, the ancestors' start maps a point of the arriving layout by F (an affine); the element
 * itself maps a point x by c + P·d + P·G·P⁻¹·(x − c) about its centre c, P its parent frame's map onto the screen, d its
 * translate and G its scale. The composite takes its centre to its earlier one when d = P⁻¹·(F⁻¹(from centre) − c), and
 * its size to its earlier one when G = P⁻¹·F⁻¹·D·P, D the ratio of its boxes on screen. CSS's `scale` is diagonal: when G
 * is not (beyond `OFF_DIAGONAL`), the element takes the fade route instead (fix wave 3; general affine morphing is out of
 * scope).
 */
/** How far off the diagonal a start's scale may be, relative to its diagonal, and still be drawn by `scale`. */
export const OFF_DIAGONAL = 1e-3;

export function magicMotions(items: readonly MagicItem[]): Map<string, Motion | 'fade'> {
  const composite = new Map<string, Affine>();
  const out = new Map<string, Motion | 'fade'>();
  for (const item of items) {
    const f = (item.ancestor !== null && composite.get(item.ancestor)) || IDENTITY;
    const p = linear(item.parent);
    const pInv = invert(p);
    const fInv = invert(f);
    const c = { x: item.to.x + item.to.w / 2, y: item.to.y + item.to.h / 2 };
    const back = apply(fInv, { x: item.from.x + item.from.w / 2, y: item.from.y + item.from.h / 2 });
    const d = applyLinear(pInv, { x: back.x - c.x, y: back.y - c.y });
    const ratio: Affine = { ...IDENTITY, a: item.from.w / item.to.w, d: item.from.h / item.to.h };
    const full = multiply(pInv, multiply(linear(fInv), multiply(ratio, p)));
    // fix wave 3: a resize that is not diagonal in the parent's frame (a non-uniform one under a parent turned off the
    // axes) cannot be started by `scale`: the element fades in where it is, and its descendants move by its ancestors'
    if (Math.abs(full.b) + Math.abs(full.c) > OFF_DIAGONAL * (Math.abs(full.a) + Math.abs(full.d))) {
      composite.set(item.id, f);
      out.set(item.id, 'fade');
      continue;
    }
    const g: Affine = { ...IDENTITY, a: full.a, d: full.d };
    // this element's own start on screen, its descendants' F
    const own = multiply(shift(c.x, c.y), multiply(shift(applyLinear(p, d).x, applyLinear(p, d).y), multiply(p, multiply(g, multiply(pInv, shift(-c.x, -c.y))))));
    composite.set(item.id, multiply(f, own));
    out.set(item.id, { dx: d.x, dy: d.y, sx: g.a, sy: g.d });
  }
  return out;
}
