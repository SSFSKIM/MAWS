// The touch rule (the word cut, Decision Log): a fact a tip shows on pointing is drawn at rest where nothing can point
// (`(hover: none)`, the desk's phone), hidden from assistive technology, which hears it as the owner's description.
// happy-dom matches no media query, so what the stylesheet and the markup guarantee together is pinned: the markup marks
// the fact and hides it from the accessibility tree; the stylesheet hides every marked fact outside any layer (so no
// utility class can draw it where the pointer can point) and draws it only under `(hover: none)`.
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { accessibleText } from '../test-support/accessible-text';
import { TOUCH_FACT, TouchFact } from './touch-fact';

afterEach(cleanup);

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

describe('the touch fact’s stylesheet', () => {
  const { top, media } = rules();
  it('hides a marked fact outside every layer, so no utility draws it where the pointer can point', () => {
    expect(top).toContainEqual({ selector: `[${TOUCH_FACT}]`, body: 'display: none;' });
  });
  it('draws it only where nothing points, inline or as a block of its own lines', () => {
    const touch = media.filter((rule) => rule.query === '@media (hover: none)');
    expect(touch).toContainEqual({ query: '@media (hover: none)', selector: `[${TOUCH_FACT}]`, body: 'display: inline;' });
    expect(touch).toContainEqual({ query: '@media (hover: none)', selector: `[${TOUCH_FACT}="block"]`, body: 'display: block;' });
    expect(media.filter((rule) => rule.selector.includes(TOUCH_FACT) && rule.query !== '@media (hover: none)')).toEqual([]);
  });
});

describe('TouchFact', () => {
  it('marks its fact for the stylesheet and keeps it out of the accessibility tree', () => {
    render(
      <p data-testid="line">
        <span>Cancelled</span>
        <TouchFact>The turn was interrupted</TouchFact>
      </p>,
    );
    const fact = screen.getByTestId('line').querySelector(`[${TOUCH_FACT}]`)!;
    expect(fact.textContent).toBe('The turn was interrupted');
    expect(fact.getAttribute(TOUCH_FACT)).toBe('');
    expect(fact.getAttribute('aria-hidden')).toBe('true');
    expect(accessibleText(screen.getByTestId('line'))).toBe('Cancelled');
  });

  it('as a block keeps the fact’s line breaks on lines of their own', () => {
    render(
      <div data-testid="row">
        <TouchFact block>{'Survey · Read · 4s\nAudit · Grep · 2s'}</TouchFact>
      </div>,
    );
    const fact = screen.getByTestId('row').querySelector<HTMLElement>(`[${TOUCH_FACT}]`)!;
    expect(fact.getAttribute(TOUCH_FACT)).toBe('block');
    expect(fact.className).toContain('whitespace-pre-line');
  });

  it('draws nothing when there is no fact', () => {
    const { container } = render(
      <>
        <TouchFact>{null}</TouchFact>
        <TouchFact>{undefined}</TouchFact>
        <TouchFact block>{''}</TouchFact>
      </>,
    );
    expect(container.innerHTML).toBe('');
  });
});
