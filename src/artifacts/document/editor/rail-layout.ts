// The document's floating tool card (Comments, History), under the page's toolbar, preview bar and find. From
// RAIL_BESIDE_FROM_PX up the stylesheet reserves the card's width beside the page (at most 40 % of the body); below,
// a drawer overlays the page without narrowing it. The page frames and new-changes pills are watched as well as the
// body: controls come and go without resizing the body. Every editor render measures again for a newly mounted frame.
// A body not laid out (0 px wide) keeps the wide layout.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { RAIL_BESIDE_FROM_PX } from '../rail-width'; // P4-B1: the margin's tiers read it too

export { RAIL_BESIDE_FROM_PX }; // P4-B1

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
      const pills = [...element.querySelectorAll<HTMLElement>('.doc-pill')];
      for (const pill of pills) observer?.observe(pill);
      const pillBottom = Math.max(0, ...pills.map(pill => pill.getBoundingClientRect()).filter(rect => rect.height > 0).map(rect => rect.bottom + 8));
      const next: RailLayout = {
        mode: box.width > 0 && box.width < RAIL_BESIDE_FROM_PX ? 'drawer' : 'beside',
        // Both layouts are floating cards under the document's toolbar; only the wide layout reserves page space.
        top: Math.max(0, Math.ceil(Math.max(shown?.top ?? box.top, pillBottom) - box.top)),
      };
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
