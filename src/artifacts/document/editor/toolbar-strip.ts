// P3-F1 (fix 1, docs/doperpowers/ledgers/2026-10-17-P3-F1.md): the formatting toolbar's one row. Its tools scroll in a
// strip, so they never wrap into a column in a narrow panel, and the strip says which way it has more
// (`data-overflow`, a fade at that edge). A menu (Link's form, Insert's menu, the mention picker) is positioned by the
// toolbar rather than by its button, so the strip's scrolling box does not clip it: it opens under its button, at the
// button's place as the strip is scrolled, and is kept inside the toolbar's width.
import { useLayoutEffect, type RefObject } from 'react';

interface Strip {
  /** The toolbar row, the menus' containing block. */
  bar: RefObject<HTMLElement | null>;
  /** The scrolling strip of tools. */
  strip: RefObject<HTMLElement | null>;
  /** The open menu's button wrapper (its `.doc-menu-anchor`), none while no menu is open. */
  anchor: RefObject<HTMLElement | null> | null;
  /** Which menu is open: another menu in the same wrapper is placed again. */
  menu: string | null;
  /** Changes when tools come and go in the strip (a table's controls, a code block's language, an upload error). */
  tools: string;
}

export function useToolbarStrip({ bar, strip, anchor, menu, tools }: Strip): void {
  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    const cue = () => {
      const more = element.scrollWidth - element.clientWidth;
      const before = element.scrollLeft > 0;
      const after = element.scrollLeft < more - 1; // a fractional width leaves a pixel's rounding at the end
      const overflow = more <= 0 ? null : before && after ? 'both' : before ? 'start' : after ? 'end' : null;
      if (overflow) element.dataset.overflow = overflow;
      else delete element.dataset.overflow;
    };
    cue();
    element.addEventListener('scroll', cue, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(cue);
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', cue);
      observer?.disconnect();
    };
  }, [strip, tools]);

  useLayoutEffect(() => {
    const row = bar.current;
    const element = strip.current;
    const at = anchor?.current ?? null;
    if (!row) return;
    if (!element || !at || menu === null) {
      row.style.removeProperty('--doc-popover-left');
      return;
    }
    const place = () => {
      const box = row.getBoundingClientRect();
      const width = at.querySelector('.doc-menu, .doc-popover')?.getBoundingClientRect().width ?? 0;
      const left = Math.max(0, Math.min(at.getBoundingClientRect().left - box.left, box.width - width));
      row.style.setProperty('--doc-popover-left', `${Math.round(left)}px`);
    };
    place();
    element.addEventListener('scroll', place, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(row);
    return () => {
      element.removeEventListener('scroll', place);
      observer?.disconnect();
    };
  }, [bar, strip, anchor, menu]);
}
