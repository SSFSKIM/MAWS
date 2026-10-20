// The margin suites' geometry (P4-B1; happy-dom lays nothing out): a stub of the few measurements MarginThreads makes,
// each answered from the scene a test sets. The editor body, the page's scroll box and the page have widths; the column
// sits at a top; every mark span (`[data-thread]`) has the first line box the scene names for its thread (viewport
// coordinates); every margin entry (`[data-margin-entry]`) has the height the scene names (a default otherwise). A
// `ResizeObserver` that records its targets lets a test fire a resize as the browser would. Test support only.
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export interface Scene {
  /** The editor body's width (the 720 px rule reads it). */
  bodyWidth: number;
  /** The page's scroll box's client width and the page's rendered width (the tiers read their difference). */
  scrollWidth: number;
  pageWidth: number;
  /** The column's top in the viewport (anchors are measured against it). */
  columnTop: number;
  /** threadId → the first line box of its passage: top and height in viewport coordinates. */
  lines: Map<string, { top: number; height: number; left?: number; width?: number }>;
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

/** Reports a resize of every observed target (the scene has changed meanwhile). */
export const resized = (): void =>
  act(() => {
    for (const { callback, self, targets } of [...observers]) {
      const entries = [...targets].map((target) => ({ target, contentRect: rectOf(target), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }) as unknown as ResizeObserverEntry);
      callback(entries, self);
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
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return widthOf(this);
  });
}

/** The transform's translateY of an entry, as the layout wrote it; null when none. */
export function topOf(element: Element | null): number | null {
  const transform = (element as HTMLElement | null)?.style.transform ?? '';
  const match = /translate(?:Y|)\((?:(-?[\d.]+)px, )?(-?[\d.]+)px\)/.exec(transform);
  return match ? Number(match[2]) : null;
}

/** The transform's translateX of an entry (the active shift), 0 when none. */
export function shiftOf(element: Element | null): number {
  const transform = (element as HTMLElement | null)?.style.transform ?? '';
  const match = /translate\((-?[\d.]+)px, /.exec(transform);
  return match ? Number(match[1]) : 0;
}
