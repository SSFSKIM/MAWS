// How many character cells a site's box holds (R2): a plugin sizes its tree to the site's columns (`bodyColumns`) and
// rows, which the engine counts in cells of the surface's monospace metric. Measured from the box as it lays out, over
// a probe one `ch` wide and one `lh` tall, whole cells only, so a resize asks again only when a cell is gained or lost;
// before the first layout (or with none, in tests), the given fallbacks.
import { useEffect, useState, type RefObject } from 'react';

const PROBE = 'position:absolute;visibility:hidden;width:1ch;height:1lh';

export function useCells(ref: RefObject<HTMLElement | null>, fallback: { columns: number; rows: number }): { columns: number; rows: number } {
  const [cells, setCells] = useState(fallback);
  const { columns: fallbackColumns, rows: fallbackRows } = fallback;
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const probe = document.createElement('span');
      probe.style.cssText = PROBE;
      element.appendChild(probe);
      const { width: ch, height: lh } = probe.getBoundingClientRect();
      probe.remove();
      const { width, height } = element.getBoundingClientRect();
      const next = { columns: ch > 0 && width > 0 ? Math.max(1, Math.floor(width / ch)) : fallbackColumns, rows: lh > 0 && height > 0 ? Math.max(1, Math.floor(height / lh)) : fallbackRows };
      setCells((prev) => (prev.columns === next.columns && prev.rows === next.rows ? prev : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); // its first callback measures
    return () => observer.disconnect();
  }, [ref, fallbackColumns, fallbackRows]);
  return cells;
}
