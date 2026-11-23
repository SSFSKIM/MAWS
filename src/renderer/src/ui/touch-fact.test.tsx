// The touch rule (the word cut, Decision Log): a fact a tip shows on pointing is drawn at rest where nothing can point
// (`(hover: none)`, the desk's phone), hidden from assistive technology, which hears it as the owner's description.
// happy-dom matches no media query, so what the stylesheet and the markup guarantee together is pinned: the markup marks
// the fact and hides it from the accessibility tree; the stylesheet hides every marked fact outside any layer (so no
// utility class can draw it where the pointer can point) and draws it only under `(hover: none)`.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { accessibleText } from '../test-support/accessible-text';
import { appCssRules } from '../test-support/app-css';
import { TOUCH_FACT, TouchFact } from './touch-fact';

afterEach(cleanup);

describe('the touch fact’s stylesheet', () => {
  const { top, media } = appCssRules();
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
