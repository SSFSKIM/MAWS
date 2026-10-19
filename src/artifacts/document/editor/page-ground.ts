// The ground of a document page (`.ds-doc`): the live page's (DocumentEditor's PageFrame) and the suggestion review's
// sheet, so code on either takes the colours of the ground it is drawn on.
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { isDarkGround } from '../export/highlight';

// The page's ground, light or dark, as its computed background reads (the system's `--ds-color-bg`, the app's without
// a system; Decision Log 22): what the code highlighting keys its colours to. Read again when the app's theme, a
// stylesheet (a design-system scope's) or the page's own tokens change.
export function usePageGround(page: RefObject<HTMLElement | null>, tokens: CSSProperties | undefined): 'light' | 'dark' {
  const [ground, setGround] = useState<'light' | 'dark'>('light');
  useLayoutEffect(() => {
    const element = page.current;
    if (!element) return;
    const read = () => {
      const background = getComputedStyle(element).backgroundColor;
      const clear = background === '' || background === 'transparent' || /^rgba\(.*,\s*0\)$/.test(background);
      setGround(!clear && isDarkGround(background) ? 'dark' : 'light');
    };
    read();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    observer.observe(document.head, { childList: true, subtree: true }); // a stylesheet added, removed or rewritten
    if (element.parentElement) observer.observe(element.parentElement, { attributes: true });
    return () => observer.disconnect();
  }, [page, tokens]);
  return ground;
}
