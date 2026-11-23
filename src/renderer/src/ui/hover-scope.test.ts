// The word cut's rule 5 (P140, T222): a row's or a heading's action is drawn on pointing at its scope or on keyboard
// focus within it, and always where nothing can point (the touch rule). happy-dom matches no media query, so the
// stylesheet is read: the action is hidden outside every layer (no utility can draw it at rest), drawn while its scope
// is pointed at or holds focus, and drawn always under `(hover: none)`.
import { describe, expect, it } from 'vitest';
import { appCssRules } from '../test-support/app-css';
import { HOVER_SCOPE, ON_HOVER } from './hover-scope';

const scope = `[${Object.keys(HOVER_SCOPE)[0]}]`;
const action = `[${Object.keys(ON_HOVER)[0]}]`;
const selectors = (rule: { selector: string }) => rule.selector.split(',').map((one) => one.trim());

describe('an action drawn on its pointed or focused scope', () => {
  const { top, media } = appCssRules();
  it('is hidden at rest outside every layer', () => {
    expect(top).toContainEqual({ selector: `${scope} ${action}`, body: 'opacity: 0;' });
  });
  it('is drawn while its scope is pointed at or holds focus', () => {
    const shown = top.find((rule) => rule.body === 'opacity: 1;' && selectors(rule).includes(`${scope}:hover ${action}`));
    expect(shown && selectors(shown)).toEqual([`${scope}:hover ${action}`, `${scope}:focus-within ${action}`]);
  });
  it('is drawn always where nothing can point', () => {
    expect(media).toContainEqual({ query: '@media (hover: none)', selector: `${scope} ${action}`, body: 'opacity: 1;' });
  });
});
