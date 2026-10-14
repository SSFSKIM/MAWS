// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas"; X27's `SlideCanvas`), grown from S6's
// `spikes/p3-store/s6/src/canvas.ts`: a slide drawn from the model into a `section.maws-slide` (1920×1080) that patches
// itself from the seam's change records with the fewest DOM writes (one style property, one attribute, one re-placed
// node, one re-rendered text box), never importing Yjs. The stage and every filmstrip thumbnail are one each.
//
// Size-dependent drawing (x-shape outlines, x-connector lines) and the fit pass run in a layout pass after the slide has
// laid out: batched across every canvas in one animation frame (all measures, then all writes), so a hundred
// thumbnails opening together lay out once rather than a hundred times.
import type { Doc } from '../../yjs';
import { childLists, groupOf, readFlat, ROOT, type FlatElement } from '../model';
import * as Y from '../../yjs/slides';
import { createNode, drawConnector, drawShape, drawsInLayout, renderText, setImageSource, type AssetUrl } from './elements';
import { clearFit, fitText, isSizedText } from './fit';

export interface SlideCanvasOptions {
  /** An uploaded asset's URL (`assets/<name>`); without it every picture is a placeholder. */
  assetUrl?: AssetUrl;
  /** A filmstrip thumbnail: an x-embed draws as a placeholder, never a live frame. */
  thumbnail?: boolean;
}

/** A longest strictly increasing subsequence of `seq` (values, in order). */
function longestRun(seq: number[]): number[] {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  seq.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (seq[tails[m]!]! < v) lo = m + 1;
      else hi = m;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  });
  const out: number[] = [];
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i !== -1; i = prev[i]!) out.unshift(seq[i]!);
  return out;
}

// ---- the shared layout pass ----------------------------------------------------------------------------------------

const pending = new Set<SlideCanvas>();
let frame: number | null = null;
function schedule(canvas: SlideCanvas): void {
  pending.add(canvas);
  if (frame !== null) return;
  const view = canvas.root.ownerDocument.defaultView;
  const run = () => {
    frame = null;
    flushLayout();
  };
  frame = view?.requestAnimationFrame ? view.requestAnimationFrame(run) : (setTimeout(run, 0) as unknown as number);
}
/** Runs every pending layout pass now (all measures, then all writes, then the fits). */
export function flushLayout(): void {
  const canvases = [...pending];
  pending.clear();
  const writes = canvases.map((c) => c.measureGlyphs());
  writes.forEach((write) => write());
  canvases.forEach((c) => c.fitAll());
}
// What changes measured output without a change record of the slide's own: faces arriving (every text's metrics), and
// the design system's scope (a token's value: a stroke width, a type role's size the fit read). A system's scope style
// is rewritten in place on every change of the system, and a change of the deck's overrides or system moves the scope
// to another id: either lays every canvas of the document out again, in the next frame, after the styles apply.
const watched = new WeakSet<Document>();
const live = new Set<SlideCanvas>();
function relayAll(document: Document): void {
  live.forEach((c) => c.root.ownerDocument === document && schedule(c));
}
function watchStyles(document: Document): void {
  if (watched.has(document)) return;
  watched.add(document);
  document.fonts?.addEventListener?.('loadingdone', () => relayAll(document));
  const View = document.defaultView?.MutationObserver;
  if (!View) return;
  const isScopeStyle = (node: Node | null) => node instanceof (document.defaultView as Window & typeof globalThis).HTMLStyleElement && node.hasAttribute('data-ds-scope-style');
  new View((records) => {
    if (records.some((r) => isScopeStyle(r.target) || isScopeStyle(r.target.parentNode) || [...r.addedNodes, ...r.removedNodes].some(isScopeStyle))) relayAll(document);
  }).observe(document.head, { childList: true, subtree: true, characterData: true });
  new View(() => relayAll(document)).observe(document.body, { attributes: true, attributeFilter: ['data-ds-scope'], subtree: true });
}

export class SlideCanvas {
  readonly root: HTMLElement;
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly stop: () => void;
  private readonly assetUrl: AssetUrl;
  private readonly thumbnail: boolean;
  private laidOut = false;
  private readonly layoutWaiters: (() => void)[] = [];
  /** DOM writes this canvas made, by kind (the "minimal patching" claim's measure). */
  readonly writes = { style: 0, attr: 0, place: 0, text: 0, create: 0, remove: 0, layout: 0 };

  constructor(
    private readonly doc: Doc,
    readonly slideId: string,
    host: HTMLElement,
    options: SlideCanvasOptions = {},
  ) {
    this.assetUrl = options.assetUrl ?? (() => null);
    this.thumbnail = options.thumbnail ?? false;
    const document = host.ownerDocument;
    this.root = document.createElement('section');
    this.root.className = 'maws-slide';
    this.root.dataset.slide = slideId;
    // a link on a slide is the slide's content, not a way out of the editor
    this.root.addEventListener('click', (event) => {
      if ((event.target as Element | null)?.closest?.('a')) event.preventDefault();
    });
    host.appendChild(this.root);
    this.renderAll();
    this.stop = Y.observeSlide(doc, slideId, (changes) => this.patch(changes));
    live.add(this);
    watchStyles(document);
    schedule(this);
  }

  dispose(): void {
    this.stop();
    live.delete(this);
    pending.delete(this);
    this.root.remove();
  }
  node(id: string): HTMLElement | undefined {
    return this.nodes.get(id);
  }
  /** Resolves once the slide has been laid out and drawn (its first layout pass). */
  whenLaidOut(): Promise<void> {
    return this.laidOut ? Promise.resolve() : new Promise((resolve) => this.layoutWaiters.push(resolve));
  }

  private renderAll(): void {
    for (const [k, v] of Object.entries(Y.slideScalars(this.doc, this.slideId))) this.applySlideKey(k, v as string);
    for (const e of readFlat(this.doc, this.slideId)) this.create(e);
    this.placeAll();
  }

  private applySlideKey(k: string, v: string | undefined): void {
    if (k.startsWith('style:')) {
      if (v === undefined) this.root.style.removeProperty(k.slice(6));
      else this.root.style.setProperty(k.slice(6), v);
    } else if (k.startsWith('attr:')) {
      // a hidden slide still draws (the filmstrip dims it); `hidden` on the canvas would hide it
      const name = k === 'attr:hidden' ? 'data-hidden' : k.slice(5);
      if (v === undefined) this.root.removeAttribute(name);
      else this.root.setAttribute(name, v);
    }
  }

  private create(e: FlatElement): HTMLElement {
    const n = createNode(this.root.ownerDocument, e, e.text, this.assetUrl, this.thumbnail);
    this.nodes.set(e.id, n);
    this.writes.create++;
    return n;
  }

  /** Puts every node under its effective parent in [under][flow][over] order, moving only the nodes out of place. */
  private placeAll(only?: Set<string>): void {
    const els = readFlat(this.doc, this.slideId, false);
    const lists = childLists(els);
    const parents = only ?? new Set([ROOT, ...els.map((e) => e.id)]);
    for (const p of parents) {
      const host = p === ROOT ? this.root : this.nodes.get(p);
      if (!host) continue;
      const want = (lists.get(p) ?? []).map((e) => {
        const n = this.nodes.get(e.id)!;
        this.setLayer(n, e, p === ROOT);
        return n;
      });
      // keyed reconciliation: nodes in a longest increasing run of their wanted positions stay; the rest move
      const pos = new Map(want.map((n, i) => [n, i]));
      const seq = Array.from(host.children)
        .map((c) => pos.get(c as HTMLElement))
        .filter((i): i is number => i !== undefined);
      const stay = new Set(longestRun(seq).map((i) => want[i]));
      for (let i = want.length - 1; i >= 0; i--) {
        const n = want[i]!;
        const next = want[i + 1] ?? null;
        if (stay.has(n) && n.parentElement === host) continue;
        if (n.parentElement === host && n.nextElementSibling === next) continue;
        host.insertBefore(n, next);
        this.writes.place++;
      }
    }
  }

  /**
   * CSS paints every positioned element over all in-flow content (CSS 2.1 Appendix E); the dialect paints a section's
   * pinned child listed before the first flow child UNDER the flow layer. The section isolates and those children take
   * z-index:-1. Only the section: inside a relative host pinned children always paint over (Claude).
   */
  private setLayer(n: HTMLElement, e: FlatElement, inSection: boolean): void {
    const under = inSection && groupOf(e) === 'under';
    if (under && n.dataset.layer !== 'under') n.dataset.layer = 'under';
    else if (!under && n.dataset.layer) delete n.dataset.layer;
  }

  private parentKeyOf(n: HTMLElement): string {
    return n.parentElement === this.root ? ROOT : ((n.parentElement as HTMLElement | null)?.dataset.eid ?? ROOT);
  }

  private patch(changes: Y.Change[]): void {
    const replace = new Set<string>();
    const reparents = new Set<string>();
    for (const c of changes) {
      switch (c.kind) {
        case 'slide': {
          const scalars = Y.slideScalars(this.doc, this.slideId);
          for (const k of c.keys) {
            this.applySlideKey(k, scalars[k] as string | undefined);
            this.writes.style++;
          }
          break;
        }
        case 'notes':
          break;
        case 'removed': {
          const n = this.nodes.get(c.id);
          if (n) {
            n.remove();
            this.nodes.delete(c.id);
            this.writes.remove++;
          }
          reparents.add(ROOT);
          break;
        }
        case 'added':
          replace.add(c.id);
          break;
        case 'text': {
          const n = this.nodes.get(c.id);
          if (n && Y.hasElement(this.doc, this.slideId, c.id)) {
            renderText(n, Y.elementScalars(this.doc, this.slideId, c.id).tag as string, Y.readText(this.doc, this.slideId, c.id));
            this.writes.text++;
          }
          break;
        }
        case 'element': {
          const n = this.nodes.get(c.id);
          if (!n || !Y.hasElement(this.doc, this.slideId, c.id)) break;
          const s = Y.elementScalars(this.doc, this.slideId, c.id);
          for (const k of c.keys) {
            const v = s[k] as string | undefined;
            if (k.startsWith('style:')) {
              if (v === undefined) n.style.removeProperty(k.slice(6));
              else n.style.setProperty(k.slice(6), v);
              this.writes.style++;
              if (k === 'style:position') {
                reparents.add(this.parentKeyOf(n));
                reparents.add(s.parent as string);
              }
            } else if (k === 'attr:src' && s.tag === 'img') {
              setImageSource(n as HTMLImageElement, v, this.assetUrl);
              this.writes.attr++;
            } else if ((k === 'attr:name' && s.tag === 'x-icon') || (k === 'attr:kind' && s.tag === 'x-shape')) replace.add(c.id); // another drawing
            else if (k.startsWith('attr:')) {
              if (v === undefined) n.removeAttribute(k.slice(5));
              else n.setAttribute(k.slice(5), v);
              this.writes.attr++;
              if (s.tag === 'x-connector' && /^attr:x\d$|^attr:y\d$/.test(k)) reparents.add(this.parentKeyOf(n)); // pinned or flow
            } else if (k === 'order' || k === 'z' || k === 'parent') {
              reparents.add(this.parentKeyOf(n));
              reparents.add((s.parent as string) ?? ROOT);
            } else if (k === 'raw' || k === 'tag') replace.add(c.id);
          }
        }
      }
    }
    for (const id of replace) {
      if (!Y.hasElement(this.doc, this.slideId, id)) continue;
      const old = this.nodes.get(id);
      const e = readFlat(this.doc, this.slideId).find((f) => f.id === id)!;
      const n = this.create(e);
      if (old) old.replaceWith(n); // child element nodes are placed under the new node by placeAll
      reparents.add(e.parent);
      reparents.add(id);
    }
    if (reparents.size) this.placeAll(reparents.has(ROOT) || replace.size ? undefined : reparents);
    schedule(this);
  }

  // ---- the layout pass (called by the shared scheduler, or `layoutNow`) ----

  /** Measures the boxes of every size-dependent element; returns the writes that draw them. */
  measureGlyphs(): () => void {
    const draws: (() => void)[] = [];
    if (!this.root.isConnected) return () => {};
    for (const [id, s] of Y.allElementScalars(this.doc, this.slideId)) {
      const tag = s.tag as string;
      const attrs: Record<string, string> = {};
      const style: Record<string, string> = {};
      for (const [k, v] of Object.entries(s)) {
        if (k.startsWith('attr:')) attrs[k.slice(5)] = v as string;
        else if (k.startsWith('style:')) style[k.slice(6)] = v as string;
      }
      if (!drawsInLayout(tag, attrs)) continue;
      const n = this.nodes.get(id);
      if (!n) continue;
      const [w, h] = [n.clientWidth, n.clientHeight];
      draws.push(() => (tag === 'x-connector' ? drawConnector(n, style, attrs, w, h) : drawShape(n, style, attrs.kind ?? 'rect', w, h)));
    }
    return () => draws.forEach((draw) => draw());
  }

  /** The fit pass over every sized text element (each forces a layout of its own). */
  fitAll(): void {
    if (!this.root.isConnected) return;
    this.writes.layout++;
    for (const [id, s] of Y.allElementScalars(this.doc, this.slideId)) {
      const style: Record<string, string> = {};
      for (const [k, v] of Object.entries(s)) if (k.startsWith('style:')) style[k.slice(6)] = v as string;
      const n = this.nodes.get(id);
      if (!n) continue;
      if (isSizedText(s.tag as never, style)) fitText(n, style, s['attr:data-fit'] as string | undefined);
      else clearFit(n, style); // no longer a sized text box: nothing a fit wrote stays
    }
    if (!this.laidOut) {
      this.laidOut = true;
      this.layoutWaiters.splice(0).forEach((resolve) => resolve());
    }
  }

  /** This canvas's layout pass, now. */
  layoutNow(): void {
    pending.delete(this);
    this.measureGlyphs()();
    this.fitAll();
  }
}
