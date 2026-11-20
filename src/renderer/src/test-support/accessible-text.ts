// The text the accessibility tree keeps: every text node outside a subtree Testing Library reads as inaccessible (the
// `hidden` attribute, `aria-hidden`, `display: none`, `visibility: hidden`). It measures exclusion from the tree, not
// what is drawn: `sr-only` text counts, visible `aria-hidden` text does not, and no layout is read. The word cut's
// parts hide what waits for the pointer or the keyboard from the tree at rest, so here it is absent until revealed;
// a picture is the proof of what is drawn.
import { isInaccessible } from '@testing-library/react';

export function accessibleText(root: Element): string {
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
    else if (node instanceof Element && !isInaccessible(node)) node.childNodes.forEach(walk);
  };
  walk(root);
  return text;
}
