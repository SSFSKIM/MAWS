// The app's stylesheet read as rules, for the tests that pin what CSS alone guarantees (happy-dom matches no media
// query): the touch rule's fact (`ui/touch-fact.test.tsx`) and the hover scope's action (`ui/hover-scope.test.ts`).
// `top` holds the rules at the stylesheet's top level, outside any `@layer` or `@media`; `media` the rules directly
// inside each top-level `@media`. Comments are dropped; nested and at-rule blocks are not listed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface CssRule {
  selector: string;
  body: string;
}

export function appCssRules(): { top: CssRule[]; media: (CssRule & { query: string })[] } {
  const css = readFileSync(resolve(__dirname, '../styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const top: CssRule[] = [];
  const media: (CssRule & { query: string })[] = [];
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
