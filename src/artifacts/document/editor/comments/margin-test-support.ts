// The margin suites' geometry (P4-B1; happy-dom lays nothing out): a stub of the few measurements MarginThreads makes,
// each answered from the scene a test sets. The editor body, the page's scroll box and the page have widths; the column
// sits at a top; every mark span (`[data-thread]`) has the first line box the scene names for its thread (viewport
// coordinates); every margin entry (`[data-margin-entry]`) has the height the scene names (a default otherwise). A
// `ResizeObserver` that records its targets lets a test fire a resize as the browser would. Test support only.
import type { Editor } from '@tiptap/core';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { drawnThreads } from './plugins';

export interface Scene {
  /** The editor body's width (the 720 px rule reads it). */
  bodyWidth: number;
  /** The page's scroll box's client width and the page's rendered width (the tiers read their difference). */
  scrollWidth: number;
  pageWidth: number;
  /** The column's top in the viewport (anchors are measured against it). */
  columnTop: number;
  /**
   * threadId → the first line box of its passage: top and height in viewport coordinates. P4-B1: `beforeTop` is the top
   * `coordsAtPos` answers for the side before the passage's first position (the line above, at a soft wrap); `top` the
   * side after it.
   */
  lines: Map<string, { top: number; height: number; left?: number; width?: number; beforeTop?: number }>;
  /** threadId → its entry's height; `entryHeight` for the rest. */
  heights: Map<string, number>;
  entryHeight: number;
}

export const scene: Scene = { bodyWidth: 1400, scrollWidth: 1400, pageWidth: 816, columnTop: 100, lines: new Map(), heights: new Map(), entryHeight: 60 };

export function resetScene(): void {
  scene.bodyWidth = 1400;
  scene.scrollWidth = 1400;
  scene.pageWidth = 816;
  scene.columnTop = 100;
  scene.lines = new Map();
  scene.heights = new Map();
  scene.entryHeight = 60;
}

// Every ResizeObserver the margin makes, with its targets, so a test can report a resize as the browser would.
interface Observer {
  callback: ResizeObserverCallback;
  self: ResizeObserver;
  targets: Set<Element>;
}
const observers = new Set<Observer>();
class FakeResizeObserver {
  private readonly entry: Observer;
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, self: this as unknown as ResizeObserver, targets: new Set() };
    observers.add(this.entry);
  }
  observe(target: Element): void {
    this.entry.targets.add(target);
  }
  unobserve(target: Element): void {
    this.entry.targets.delete(target);
  }
  disconnect(): void {
    observers.delete(this.entry);
  }
}

/** Reports a resize of every observed target (the scene has changed meanwhile), or of those `only` takes (P4-B1). */
export const resized = (only?: (target: Element) => boolean): void =>
  act(() => {
    for (const { callback, self, targets } of [...observers]) {
      const entries = [...targets].filter((target) => only?.(target) ?? true).map((target) => ({ target, contentRect: rectOf(target), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }) as unknown as ResizeObserverEntry);
      if (entries.length > 0) callback(entries, self);
    }
  });

const box = (x: number, y: number, w: number, h: number) => new DOMRect(x, y, w, h);

function rectOf(element: Element): DOMRect {
  if (element.classList.contains('doc-editor-body')) return box(0, 0, scene.bodyWidth, 800);
  if (element.classList.contains('ds-doc')) return box(0, scene.columnTop, scene.scrollWidth, 800);
  if (element.classList.contains('ds-doc-page')) return box(0, scene.columnTop, scene.pageWidth, 4000);
  if (element.classList.contains('doc-margin')) return box(scene.pageWidth, scene.columnTop, scene.scrollWidth - scene.pageWidth, 4000);
  const entry = (element as HTMLElement).dataset?.marginEntry;
  if (entry !== undefined) return box(0, 0, 300, scene.heights.get(entry) ?? scene.entryHeight);
  const thread = (element as HTMLElement).dataset?.thread;
  if (thread !== undefined) {
    const line = scene.lines.get(thread);
    if (line) return box(line.left ?? 120, line.top, line.width ?? 200, line.height);
  }
  return box(0, 0, 0, 0);
}

/** Installs the stubs for a suite (call in `beforeEach`; vitest's `restoreAllMocks` undoes the spies). */
export function stubGeometry(): void {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectOf(this);
  });
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    const rect = rectOf(this);
    const list = [rect] as unknown as DOMRectList;
    (list as unknown as { item(i: number): DOMRect | null }).item = (i: number) => (i === 0 ? rect : null);
    return list;
  });
  const widthOf = (element: Element): number => {
    if (element.classList.contains('doc-editor-body')) return scene.bodyWidth;
    if (element.classList.contains('ds-doc')) return scene.scrollWidth;
    if (element.classList.contains('ds-doc-page')) return scene.pageWidth;
    return 0;
  };
  // happy-dom answers 0 for clientWidth: the getter is defined on both prototypes for the suite (whichever the element
  // reads first), restored by `unstubGeometry`
  for (const proto of PROTOS) {
    saved.set(proto, Object.getOwnPropertyDescriptor(proto, 'clientWidth') ?? null);
    Object.defineProperty(proto, 'clientWidth', {
      configurable: true,
      get(this: Element) {
        return widthOf(this);
      },
    });
  }
}

const PROTOS = [HTMLElement.prototype, Element.prototype] as unknown as Array<Record<string, unknown>>;
const saved = new Map<Record<string, unknown>, PropertyDescriptor | null>();
export function unstubGeometry(): void {
  for (const proto of PROTOS) {
    const was = saved.get(proto);
    if (was) Object.defineProperty(proto, 'clientWidth', was);
    else delete proto.clientWidth;
  }
  saved.clear();
}

/** The transform's translateY of an entry, as the layout wrote it; null when none. */
export function topOf(element: Element | null): number | null {
  const transform = (element as HTMLElement | null)?.style.transform ?? '';
  const match = /translate(?:Y|)\((?:(-?[\d.]+)px, )?(-?[\d.]+)px\)/.exec(transform);
  return match ? Number(match[2]) : null;
}

/** The transform's translateX of an entry, 0 when none (P4-B1: no card is shifted since LC-1 item 2; the cases read 0). */
export function shiftOf(element: Element | null): number {
  const transform = (element as HTMLElement | null)?.style.transform ?? '';
  const match = /translate\((-?[\d.]+)px, /.exec(transform);
  return match ? Number(match[1]) : 0;
}

/**
 * P4-B1: the editor's `coordsAtPos` answered from the scene: a thread's first drawn position (the display's decorations,
 * as the margin reads them) is at its line's top (`beforeTop` for the side before it); any other position at 0.
 */
export function stubCoords(editor: Editor): void {
  vi.spyOn(editor.view, 'coordsAtPos').mockImplementation((pos: number, side = 1) => {
    for (const [id, from] of drawnThreads(editor.state)) {
      if (from !== pos) continue;
      const line = scene.lines.get(id);
      if (!line) break;
      const top = side < 0 ? (line.beforeTop ?? line.top) : line.top;
      return { top, bottom: top + line.height, left: line.left ?? 120, right: (line.left ?? 120) + 1 };
    }
    return { top: 0, bottom: 0, left: 0, right: 0 };
  });
}
