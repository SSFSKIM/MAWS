// P3-G (§D4.1): Mark-up's surfaces. A surface is something a still can be taken of and drawn over, registered per panel
// or main tab by the body that draws it (the Browser tool's pane, the deliverable viewer; P3-B's and P3-C's editors
// later), for as long as that body is mounted. The header's Mark up shows for the selected panel tab when its scope has a
// surface. Two capture routes: a native browser view captures itself in main (`browser.view.capture`, the Browser
// tool's `begin`), a surface the renderer draws through `captureWindowRegion` (`layout.captureRegion`).
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { create } from 'zustand';
import type { CapturedImage, CaptureRect } from '@shared/markup/image';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { useEditorHostScope, type EditorHostScope } from '../panel/editor-host';

export type { CapturedImage } from '@shared/markup/image';

export interface MarkupSurface {
  element(): HTMLElement | null; // the region the overlay covers, in the window's CSS px
  label(): string; // the anchor's label, e.g. `"<page title>" — <url>`
  begin(): Promise<CapturedImage | null>; // freeze: take the still (and, the browser, hold the cover); null = cannot mark up now
  end(): void; // unfreeze (release the cover)
}

const keyOf = (scope: EditorHostScope): string => `${scope.surface}:${scope.tabId}`;

const useMarkupSurfaces = create<{ entries: Readonly<Record<string, MarkupSurface>> }>()(() => ({ entries: {} }));
const removed = new Set<(surface: MarkupSurface) => void>();

// The latest registration for a scope wins; the returned function withdraws this one only (a remount's successor stays).
export function registerMarkupSurface(scope: EditorHostScope, surface: MarkupSurface): () => void {
  const key = keyOf(scope);
  useMarkupSurfaces.setState((s) => ({ entries: { ...s.entries, [key]: surface } }));
  return () => {
    if (useMarkupSurfaces.getState().entries[key] !== surface) return;
    useMarkupSurfaces.setState((s) => {
      const entries = { ...s.entries };
      delete entries[key];
      return { entries };
    });
    for (const listener of [...removed]) listener(surface);
  };
}

export const markupSurfaceOf = (scope: EditorHostScope): MarkupSurface | null => useMarkupSurfaces.getState().entries[keyOf(scope)] ?? null;

export function useMarkupSurface(scope: EditorHostScope | null): MarkupSurface | null {
  return useMarkupSurfaces((s) => (scope ? (s.entries[keyOf(scope)] ?? null) : null));
}

// A surface withdrawn (its body unmounted), for the session drawing over it.
export function onMarkupSurfaceRemoved(listener: (surface: MarkupSurface) => void): () => void {
  removed.add(listener);
  return () => void removed.delete(listener);
}

// The DOM route's still: the window's own page at the rect, taken by main. Null when main could not take it.
export async function captureWindowRegion(rect: CaptureRect, client: MawsBridge = ipc): Promise<CapturedImage | null> {
  const result = await client.invoke('layout.captureRegion', { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
  if (!result.ok) {
    console.warn(`[markup] the capture was refused: ${result.error.message}`);
    return null;
  }
  return result.value.image;
}

// A surface the renderer draws (the DOM route), registered under the body's scope while `enabled`: the element's rect
// captured from the window, nothing to freeze. The deliverable viewer's now; P3-B's and P3-C's editors the same way. The
// scope is read by its fields (the context's object is new on every render of the body, and re-registering would end
// a session drawing here); the label is read when a session starts.
export function useRegionMarkupSurface(element: RefObject<HTMLElement | null>, label: string, enabled: boolean): void {
  const scope = useEditorHostScope();
  const latest = useRef(label);
  useLayoutEffect(() => {
    latest.current = label;
  });
  const surface = scope?.surface ?? null;
  const tabId = scope?.tabId ?? null;
  useEffect(() => {
    if (!enabled || surface === null || tabId === null) return;
    return registerMarkupSurface(
      { surface, tabId },
      {
        element: () => element.current,
        label: () => latest.current,
        begin: async () => {
          const box = element.current?.getBoundingClientRect();
          return box && box.width > 0 && box.height > 0 ? captureWindowRegion({ x: box.left, y: box.top, width: box.width, height: box.height }) : null;
        },
        end: () => {},
      },
    );
  }, [enabled, surface, tabId, element]);
}

// Tests.
export function resetMarkupSurfaces(): void {
  useMarkupSurfaces.setState({ entries: {} });
}
