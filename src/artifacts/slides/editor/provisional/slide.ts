// P4-A2 G2.3 (X35, the slide editors' provisional layer; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md
// G-R3, G-R4, G-R5; §4.2's four rules and §4.4's ARMED and EDIT states [binding]): a publish's slide drawn on the stage
// (or a design board) beneath the human's states, and over a filmstrip thumbnail.
//
// On the stage the layer draws only what differs (G-R3): a ghost canvas over the scratch doc (`DeckProvisional`) at
// the live canvas's scale, between the live canvas and the overlay, shows the changed and new elements and those the
// provisional layout moves, everything else in it hidden with its layout kept; the live canvas veils the same elements
// and the removed ones. The human's ARMED and EDIT text box lives inside the live canvas's element node, so an opaque
// layer would cover it; drawing the differences leaves every other pixel the live slide's. The element in EDIT, the
// ARMED one and a drag's targets are protected (G-R4): never veiled or ghosted, and a ghost meeting one (its box, or
// its subtree holding it) waits until the protection ends. Everything here is driven from listeners, never a React
// render, so the withdrawal, the unveiling and the write's own patch of the live canvas land in one task.
//
// The DOM hooks an e2e recorder reads (stable): the layer `[data-provisional-layer="<slide>"]` (`data-provisional-writing`
// with the call's tool use id while a layer writes the slide, `data-provisional-held` the keys held back), its label
// `[data-provisional-label]` (`data-provisional-held` while it would meet a protected element), the ghost canvas
// `section[data-provisional-ghost]` whose drawn nodes carry `data-provisional-shown="changed|added|moved"` and
// `data-provisional-key` (the element's key: its id, or a cell's `<rowId>#<column>`), the live canvas's veiled nodes `[data-provisional-veiled="<key>"]`; a thumbnail's
// `[data-provisional-thumb="<slide>"]` (ringed with `data-provisional-writing`, the whole provisional slide drawn inside).
import { cssColor } from '../../../document/editor/host-types';
import { onUpdate, type Doc } from '../../../yjs';
import { slideToken } from '../../../yjs/slides-observe';
import { SlideCanvas, type AssetUrl } from '../../canvas';
import type { FaceAliases } from '../../canvas/faces';
import type { DeckSession, DeckSessionState } from '../session';
import { isTextTarget, slideTree } from '../transform/selection';
import type { DeckProvisional, WrittenSlide } from './deck';

/** The human's elements the layer must never cover (G-R4), by model id, and when they change. */
export interface Protection {
  ids(): ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * G-R4's protected set on a slide, from the deck session: the element in EDIT, the ARMED one (one selected text target
 * outside EDIT while the stage owns the keyboard, the box mounted on it) and, while a gesture drags, every selected
 * element. Only on the session's current slide (the stage's, a design's active board), where its selection lives.
 */
export function protectedIds(state: DeckSessionState, doc: Doc, slideId: string): ReadonlySet<string> {
  if (state.currentSlide !== slideId) return NONE;
  const ids = new Set<string>();
  if (state.editingText !== null) ids.add(state.editingText);
  if (state.dragging) state.selection.forEach((id) => ids.add(id));
  const one = state.selection.length === 1 ? state.selection[0]! : null;
  if (state.editingText === null && state.keyboard === 'stage' && one !== null && isTextTarget(slideTree(doc, slideId), one)) ids.add(one);
  return ids;
}

/** The session's protection for one slide (`protectedIds`), told at each change of the session. */
export function sessionProtection(session: DeckSession, slideId: string): Protection {
  return { ids: () => protectedIds(session.snapshot(), session.doc, slideId), subscribe: session.subscribe };
}

export interface SlideLayerOptions {
  deck: DeckProvisional;
  slideId: string;
  /** The live canvas the layer draws over (the stage's, or a board's). */
  live: SlideCanvas;
  /** The layer's element, over the live canvas's frame; the label goes in it. */
  host: HTMLElement;
  /** Where the ghost canvas mounts, scaled as the live canvas is. */
  scaler: HTMLElement;
  /** The human's elements on this slide; none without (a design's inactive board). */
  protection?: Protection | null;
  assetUrl: AssetUrl;
  faces?: FaceAliases;
  /** The label's words: "<name> is writing…". */
  label: (name: string) => string;
  /**
   * P4-A2 G2.4: told when the layer's screen transform changes with no layout pass of either canvas (a design world's
   * zoom: its transform and the label's counter-scale, written by their own listeners of the same change).
   */
  onTransform?: (listener: () => void) => () => void;
}

type Shown = 'changed' | 'added' | 'moved';

const MOVED_PX = 0.5; // a box that differs by more than this, in screen px, has moved

/** The stage's (or a board's) layer for one slide: the ghost, the veil, the label and the protection (G-R3, G-R4). */
export class SlideProvisional {
  private ghost: SlideCanvas | null = null;
  private ghostToken: object | null = null;
  private stopGhostLayout: (() => void) | null = null;
  private label: HTMLElement | null = null;
  private moved: ReadonlySet<string> = NONE;
  private readonly marked = { ghost: new Set<HTMLElement>(), live: new Set<HTMLElement>(), off: new Set<Element>() };
  private readonly stops: (() => void)[] = [];
  private disposed = false; // a transform's deferred check finds nothing to do after

  constructor(private readonly o: SlideLayerOptions) {
    this.stops.push(
      o.deck.subscribe(() => this.draw()),
      // after the live canvas's own patch of an update (its observer runs first): a node it made anew is veiled again
      onUpdate(o.deck.live, () => this.draw()),
      o.live.onLayout(() => this.measure()),
    );
    if (o.protection) this.stops.push(o.protection.subscribe(() => this.draw()));
    // the label's box against the protected boxes once every listener of the change has written its part (G-R4)
    if (o.onTransform) this.stops.push(o.onTransform(() => queueMicrotask(() => !this.disposed && this.draw())));
    this.draw();
  }


  dispose(): void {
    this.disposed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.clear();
  }

  private entry(): WrittenSlide | undefined {
    return this.o.deck.snapshot().slides.get(this.o.slideId);
  }

  private draw(): void {
    const entry = this.entry();
    if (!entry) return this.clear();
    const { host } = this.o;
    host.dataset.provisionalWriting = entry.toolUseId;
    host.style.setProperty('--provisional-color', cssColor(entry.color));
    const liveNodes = keyedNodes(this.o.live.root);
    const guarded = this.guarded(liveNodes);
    this.showLabel(entry.name, guarded);
    const drawn = entry.drawn;
    if (!drawn) {
      this.moved = NONE;
      this.disposeGhost();
      this.mark(new Map(), new Map(), NONE);
      return;
    }
    const ghost = this.ensureGhost();
    const ghostNodes = keyedNodes(ghost.root);
    const shown = new Map<string, Shown>();
    for (const key of drawn.changed) shown.set(key, 'changed');
    for (const key of drawn.added) shown.set(key, 'added');
    for (const key of this.moved) if (!shown.has(key) && ghostNodes.has(key) && liveNodes.has(key)) shown.set(key, 'moved');
    const veiled = new Set([...drawn.removed, ...[...shown].filter(([, kind]) => kind !== 'added').map(([key]) => key)]);
    const held = this.held(guarded, shown, veiled, ghostNodes, liveNodes, ghost.root);
    const ghostMarks = new Map<HTMLElement, [string, Shown]>();
    for (const [key, kind] of shown) {
      const node = ghostNodes.get(key);
      if (node && !held.has(key)) ghostMarks.set(node, [key, kind]);
    }
    const liveMarks = new Map<HTMLElement, string>();
    for (const key of veiled) {
      const node = liveNodes.get(key);
      if (node && !held.has(key)) liveMarks.set(node, key);
    }
    this.mark(ghostMarks, liveMarks, held);
  }

  // The protected elements' live nodes, by key (G-R4); none without a protection or a protected element on this slide.
  private guarded(liveNodes: Map<string, HTMLElement>): [string, HTMLElement][] {
    const ids = this.o.protection?.ids() ?? NONE;
    return ids.size === 0 ? [] : [...liveNodes].filter(([, node]) => ids.has(node.dataset.eid!));
  }

  // The keys held back (G-R4): a protected element itself, an element whose live subtree or ghost subtree holds one, and
  // a ghost whose box, or any drawn descendant's (a pinned child reaching out of its container, which a shown container
  // shows with it), meets a protected element's; the removed ones only for the first two (a veil covers nothing).
  private held(guarded: [string, HTMLElement][], shown: ReadonlyMap<string, Shown>, veiled: ReadonlySet<string>, ghostNodes: Map<string, HTMLElement>, liveNodes: Map<string, HTMLElement>, ghostRoot: HTMLElement): ReadonlySet<string> {
    if (guarded.length === 0) return NONE;
    const liveRoot = this.o.live.root;
    const boxes = guarded.map(([, node]) => box(node, liveRoot));
    const holds = (key: string) => {
      const live = liveNodes.get(key);
      const ghost = ghostNodes.get(key);
      return guarded.some(([pkey, node]) => (live !== undefined && live.contains(node)) || (ghost !== undefined && ghostNodes.has(pkey) && ghost.contains(ghostNodes.get(pkey)!)));
    };
    const out = new Set<string>();
    for (const key of shown.keys()) {
      const ghost = ghostNodes.get(key);
      const drawn = ghost ? [ghost, ...Array.from(ghost.querySelectorAll('[data-eid]'))] : [];
      if (holds(key) || drawn.some((node) => boxes.some((b) => meets(box(node, ghostRoot), b)))) out.add(key);
    }
    for (const key of veiled) if (!shown.has(key) && holds(key)) out.add(key);
    return out;
  }

  // After a layout pass of either canvas: the elements whose box the provisional layout moves (G-R3), then the drawing
  // again, its protection checked against the boxes as laid out now (a fit pass or a face arriving grows a drawn element
  // with no write of the deck's).
  private measure(): void {
    const entry = this.entry();
    if (!entry) return;
    const drawn = entry.drawn;
    if (!drawn || !this.ghost) return this.draw(); // the label alone, checked again
    const ghostNodes = keyedNodes(this.ghost.root);
    const liveNodes = keyedNodes(this.o.live.root);
    const [ghostRoot, liveRoot] = [this.ghost.root, this.o.live.root];
    const moved = new Set<string>();
    for (const [key, node] of ghostNodes) {
      const live = liveNodes.get(key);
      if (!live || drawn.changed.has(key) || drawn.added.has(key)) continue;
      const [a, b] = [box(node, ghostRoot), box(live, liveRoot)];
      if (Math.abs(a.left - b.left) > MOVED_PX || Math.abs(a.top - b.top) > MOVED_PX || Math.abs(a.width - b.width) > MOVED_PX || Math.abs(a.height - b.height) > MOVED_PX) moved.add(key);
    }
    if (moved.size !== this.moved.size || [...moved].some((key) => !this.moved.has(key))) this.moved = moved.size === 0 ? NONE : moved;
    this.draw();
  }

  private ensureGhost(): SlideCanvas {
    const { deck, slideId } = this.o;
    const token = slideToken(deck.scratch, slideId);
    if (this.ghost && this.ghostToken === token) return this.ghost;
    this.disposeGhost();
    // a thumbnail's drawing (an embed's place, never a running page) and no names: nothing in it is focusable or read
    const ghost = new SlideCanvas(deck.scratch, slideId, this.o.scaler, { assetUrl: this.o.assetUrl, thumbnail: true, ...(this.o.faces && { faces: this.o.faces }) });
    ghost.root.setAttribute('data-provisional-ghost', '');
    this.ghost = ghost;
    this.ghostToken = token;
    this.stopGhostLayout = ghost.onLayout(() => this.measure());
    return ghost;
  }

  private disposeGhost(): void {
    this.stopGhostLayout?.();
    this.stopGhostLayout = null;
    this.ghost?.dispose();
    this.ghost = null;
    this.ghostToken = null;
    this.marked.ghost.clear();
    this.marked.off.clear();
  }

  // The label at the slide's top left, held (hidden, its box kept so it is measured again) while it meets a protected
  // element (G-R4: nothing the layer draws covers the human's text box).
  private showLabel(name: string, guarded: [string, HTMLElement][]): void {
    if (!this.label) {
      this.label = this.o.host.ownerDocument.createElement('div');
      this.label.className = 'deck-provisional-label';
      this.label.setAttribute('data-provisional-label', '');
      this.o.host.appendChild(this.label);
    }
    const text = this.o.label(name);
    if (this.label.textContent !== text) this.label.textContent = text;
    const label = guarded.length > 0 ? this.label.getBoundingClientRect() : null;
    const held = label !== null && guarded.some(([, node]) => meets(label, node.getBoundingClientRect()));
    if (held !== this.label.hasAttribute('data-provisional-held')) this.label.toggleAttribute('data-provisional-held', held);
  }

  // Every subtree of the ghost holding nothing it shows, at its top, made transparent (`data-provisional-off`): a
  // transparency no descendant can undo, as a raw svg's own `visibility: visible` undoes the ghost's hidden root; what
  // stays hidden by visibility alone is a container's own box around a shown descendant, whose style cannot set
  // visibility (the dialect has no such property).
  private markOff(): void {
    const off = new Set<Element>();
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (child.hasAttribute('data-provisional-shown')) continue;
        if (child.querySelector('[data-provisional-shown]')) walk(child);
        else off.add(child);
      }
    };
    if (this.ghost) walk(this.ghost.root);
    for (const node of this.marked.off) if (!off.has(node)) node.removeAttribute('data-provisional-off');
    for (const node of off) if (!node.hasAttribute('data-provisional-off')) node.setAttribute('data-provisional-off', '');
    this.marked.off = off;
  }

  // The marks as drawn now, each attribute written only where it changes.
  private mark(ghost: ReadonlyMap<HTMLElement, [string, Shown]>, live: ReadonlyMap<HTMLElement, string>, held: ReadonlySet<string>): void {
    for (const node of this.marked.ghost) {
      if (ghost.has(node)) continue;
      node.removeAttribute('data-provisional-shown');
      node.removeAttribute('data-provisional-key');
    }
    for (const [node, [key, kind]] of ghost) {
      if (node.getAttribute('data-provisional-shown') !== kind) node.setAttribute('data-provisional-shown', kind);
      if (node.getAttribute('data-provisional-key') !== key) node.setAttribute('data-provisional-key', key);
    }
    this.marked.ghost = new Set(ghost.keys());
    this.markOff();
    for (const node of this.marked.live) if (!live.has(node)) node.removeAttribute('data-provisional-veiled');
    for (const [node, key] of live) if (node.getAttribute('data-provisional-veiled') !== key) node.setAttribute('data-provisional-veiled', key);
    this.marked.live = new Set(live.keys());
    const keys = [...held].join(' ');
    if (keys) this.o.host.dataset.provisionalHeld = keys;
    else delete this.o.host.dataset.provisionalHeld;
  }

  private clear(): void {
    if (!this.label && !this.ghost && this.marked.live.size === 0) return; // nothing drawn: a keystroke costs nothing here
    this.moved = NONE;
    this.mark(new Map(), new Map(), NONE);
    this.disposeGhost();
    this.label?.remove();
    this.label = null;
    delete this.o.host.dataset.provisionalWriting;
    this.o.host.style.removeProperty('--provisional-color');
  }
}

export interface ThumbnailLayerOptions {
  deck: DeckProvisional;
  slideId: string;
  /** The layer's element over the thumbnail, ringed while the slide is being written. */
  host: HTMLElement;
  /** Where the provisional slide's canvas mounts, scaled as the thumbnail is. */
  scaler: HTMLElement;
  assetUrl: AssetUrl;
  faces?: FaceAliases;
  /**
   * A new slide's or board's ghost entry: when its call is withdrawn the slide keeps its last drawing, still, until the
   * entry unmounts, since the real entry replaces it on React's next render, not in the store's call (no blank between).
   */
  keepLast?: boolean;
}

/**
 * A filmstrip entry's layer (G-R5): while a publish writes the slide, a ring in the agent's colour, and, once it differs,
 * the whole provisional slide drawn opaque over the thumbnail (a thumbnail holds no text box); a new slide's ghost entry
 * draws it the same way.
 */
export class ThumbnailProvisional {
  private canvas: SlideCanvas | null = null;
  private token: object | null = null;
  /** The last drawing a withdrawn `keepLast` entry holds, observing nothing. */
  private kept: HTMLElement | null = null;
  private readonly stop: () => void;

  constructor(private readonly o: ThumbnailLayerOptions) {
    this.stop = o.deck.subscribe(() => this.draw());
    this.draw();
  }

  dispose(): void {
    this.stop();
    this.drawSlide(false, false);
    this.ring(null);
  }

  private draw(): void {
    const entry = this.o.deck.snapshot().slides.get(this.o.slideId);
    this.ring(entry ?? null);
    this.drawSlide(entry?.drawn != null, this.o.keepLast ?? false);
  }

  private ring(entry: WrittenSlide | null): void {
    const { host } = this.o;
    if (entry) {
      host.dataset.provisionalWriting = entry.toolUseId;
      host.style.setProperty('--provisional-color', cssColor(entry.color));
    } else {
      delete host.dataset.provisionalWriting;
      host.style.removeProperty('--provisional-color');
    }
  }

  private drawSlide(on: boolean, keep: boolean): void {
    const { deck, slideId } = this.o;
    const token = on ? slideToken(deck.scratch, slideId) : null;
    if (this.canvas && this.token === token) return;
    const last = this.canvas;
    last?.dispose();
    this.canvas = null;
    this.token = token;
    if (token || !keep) {
      this.kept?.remove();
      this.kept = null;
    } else if (last) this.kept = this.o.scaler.appendChild(last.root);
    if (token) this.canvas = new SlideCanvas(deck.scratch, slideId, this.o.scaler, { assetUrl: this.o.assetUrl, thumbnail: true, ...(this.o.faces && { faces: this.o.faces }) });
  }
}

/** Every element node of a canvas by its key: its id, or a cell's `<rowId>#<column>` (cells go by position, D2). */
function keyedNodes(root: HTMLElement): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-eid]'))) {
    const row = node.parentElement;
    if (row?.localName === 'tr' && row.dataset.eid) out.set(`${row.dataset.eid}#${Array.prototype.indexOf.call(row.children, node)}`, node);
    else out.set(node.dataset.eid!, node);
  }
  return out;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** A node's box from its canvas's origin, in screen px (the ghost and the live canvas share a scale). */
function box(node: Element, root: Element): Box {
  const [n, r] = [node.getBoundingClientRect(), root.getBoundingClientRect()];
  return { left: n.left - r.left, top: n.top - r.top, width: n.width, height: n.height };
}
/** Two boxes overlap over some area (boxes that only touch do not meet). */
function meets(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}
