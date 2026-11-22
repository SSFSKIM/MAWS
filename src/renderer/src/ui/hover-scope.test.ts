// The word cut's rule 5 (P140, T222): a row's or a heading's action is drawn on pointing at its scope or on keyboard
// focus within it, and always where nothing can point (the touch rule). happy-dom matches no media query, so the
// stylesheet is read: the action is hidden outside every layer (no utility can draw it at rest), drawn while its scope
// is pointed at or holds focus, and drawn always under `(hover: none)`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOVER_SCOPE, ON_HOVER } from './hover-scope';

const css = readFileSync(resolve(__dirname, '../styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// The rules at the stylesheet's top level (outside any `@layer` or `@media`), and the rules inside each `@media`.
function rules() {
  const top: { selector: string; body: string }[] = [];
  const media: { query: string; selector: string; body: string }[] = [];
  const at: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      at[depth] = css.slice(start, i).trim();
      depth++;
      start = i + 1;
    } else if (css[i] === '}') {
      depth--;
      const body = css.slice(start, i).trim();
      const selector = at[depth]!;
      if (!selector.startsWith('@') && !body.includes('{')) {
        if (depth === 0) top.push({ selector, body });
        else if (depth === 1 && at[0]!.startsWith('@media')) media.push({ query: at[0]!, selector, body });
      }
      start = i + 1;
    } else if (css[i] === ';' && depth === 0) start = i + 1;
  }
  return { top, media };
}

const scope = `[${Object.keys(HOVER_SCOPE)[0]}]`;
const action = `[${Object.keys(ON_HOVER)[0]}]`;
const selectors = (rule: { selector: string }) => rule.selector.split(',').map((one) => one.trim());

describe('an action drawn on its pointed or focused scope', () => {
  const { top, media } = rules();
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
