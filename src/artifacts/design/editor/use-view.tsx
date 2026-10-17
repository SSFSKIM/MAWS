// P3-E1 M6 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M6; the scale gate's frame work): narrow
// subscriptions to the tab's view, so a pan re-renders nothing and a zoom re-renders only what draws at the zoom. A
// component reads the zoom or the selected frame, never the whole view (whose viewport changes on every pan frame).
import { useSyncExternalStore, type ReactNode } from 'react';
import type { DesignView } from './viewport';

/** The view's zoom (1 before the world is placed). */
export const useViewZoom = (view: DesignView): number => useSyncExternalStore(view.subscribe, () => view.snapshot().viewport?.zoom ?? 1);

/** The board whose frame is selected, if any. */
export const useViewFrame = (view: DesignView): string | null => useSyncExternalStore(view.subscribe, () => view.snapshot().frame);

/** Renders `children` with the view's zoom, re-rendering on a change of zoom alone. */
export function WithZoom({ view, children }: { view: DesignView; children: (zoom: number) => ReactNode }) {
  return <>{children(useViewZoom(view))}</>;
}
