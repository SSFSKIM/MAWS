// P3-F1 (fix 1, docs/doperpowers/ledgers/2026-10-17-P3-F1.md): where the editor's rail (Comments, History) goes in the
// width its body has. From RAIL_BESIDE_FROM_PX up it sits beside the page as before, the stylesheet capping it at 40 %
// of the body and keeping the page at 420 px or more; below, in a narrow artifact panel, it is a drawer over the page's
// right side, so the page and its toolbar keep the whole width. The drawer starts at the page frame's top, under the
// toolbar, a preview's bar and find, which come and go inside the tab editor without resizing the body: the frames are
// watched as well, and every render of the editor measures again (a tab switch or a suggestion review mounts another).
// A body not laid out (0 px wide) keeps the rail beside the page.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** The body width from which the rail sits beside the page (the P3-E inspector's threshold, the architect's ruling). */
export const RAIL_BESIDE_FROM_PX = 720;

export interface RailLayout {
  mode: 'beside' | 'drawer';
  /** The drawer's top in the body: the shown page frame's offset from the body's top. */
  top: number;
}

const BESIDE: RailLayout = { mode: 'beside', top: 0 };

export function useRailLayout(body: RefObject<HTMLElement | null>, open: boolean): RailLayout {
  const [layout, setLayout] = useState<RailLayout>(BESIDE);
  const measure = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const element = body.current;
    if (!open || !element) return;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure.current());
    measure.current = () => {
      const box = element.getBoundingClientRect();
      const frames = [...element.querySelectorAll<HTMLElement>('.doc-page-frame')];
      for (const frame of frames) observer?.observe(frame); // observing one already observed does nothing
      const shown = frames.map((frame) => frame.getBoundingClientRect()).find((frame) => frame.height > 0);
      const next: RailLayout = box.width > 0 && box.width < RAIL_BESIDE_FROM_PX ? { mode: 'drawer', top: Math.max(0, Math.round((shown?.top ?? box.top) - box.top)) } : BESIDE;
      setLayout((now) => (now.mode === next.mode && now.top === next.top ? now : next));
    };
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      measure.current = () => {};
    };
  }, [body, open]);

  // after every render of the editor: what it drew may have moved the page frame
  useLayoutEffect(() => {
    measure.current();
  });

  return open ? layout : BESIDE;
}
