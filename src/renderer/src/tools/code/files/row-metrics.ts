// What a row of Files' tree column is measured by: its height and indent, the fonts its name and folder are measured in,
// and an element's own width followed as it changes. Moved out of `FilesTool.tsx` (UX wave U6b-3b,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, M2) so that Go to file's result rows (`FinderView.tsx`)
// are drawn by the tree's own measures without importing the tool that draws the field.
import { useCallback, useState } from 'react';

export const FILES_ROW_HEIGHT = 24;

export const indent = (depth: number) => ({ paddingLeft: 8 + depth * 12 });

// The element's own width, measured as it draws and followed as it changes (happy-dom measures 0: a tab too narrow for
// both).
export function useWidth(): [number, (element: HTMLDivElement | null) => (() => void) | undefined] {
  const [width, setWidth] = useState(0);
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (element === null) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [width, measure];
}

// The fonts a row's name and folder are measured in (UX wave U6b-3a, M2 decision 9), read from the page's tokens once per
// list.
export function rowFonts(): { name: string; folder: string } {
  const style = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
  const family = token('--font-ui', 'system-ui, sans-serif');
  return { name: `${token('--text-ui', '13px')} ${family}`, folder: `${token('--text-ui-sm', '12px')} ${family}` };
}
