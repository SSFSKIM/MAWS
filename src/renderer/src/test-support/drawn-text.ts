// What a person reads at rest: the text of every node that is drawn, skipping a subtree that is hidden (the `hidden`
// attribute, `aria-hidden`, `display: none` or `visibility: hidden`, as Testing Library reads them). The word cut's
// parts are tested against it: what waits for the pointer or the keyboard is absent from it until revealed.
import { isInaccessible } from '@testing-library/react';

export function drawnText(root: Element): string {
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
    else if (node instanceof Element && !isInaccessible(node)) node.childNodes.forEach(walk);
  };
  walk(root);
  return text;
}
