// The find bar's tips (the word cut, T336; `find-glyphs.ts`): the rules alone decide when a glyph's word shows, so they
// are read as rules, as the app's stylesheet tests read theirs (happy-dom draws no pseudo-element and matches no hover).
// One owner at a time: a focused glyph's tip shows at once, and a pointed glyph's only while no glyph holds focus.
import { describe, expect, it } from 'vitest';
import { POINTING_DELAY_MS } from '../../../ui/pointing';
import { FIND_TIP_THEME } from './find-glyphs';

const FOCUSED = ['[data-find-tip]:focus-visible', '[data-find-tip]:has(input:focus-visible)'];
// A selector list's members, its commas inside parentheses (`:has(a, b)`) kept
const members = (list: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  return [...out, list.slice(start).trim()];
};
const shown = Object.entries(FIND_TIP_THEME)
  .filter(([, body]) => body.visibility === 'visible')
  .flatMap(([selector, body]) => members(selector).map((one) => ({ selector: one, body })));

describe('the find bar’s tips', () => {
  it('are hidden at rest', () => {
    expect(FIND_TIP_THEME['.cm-panel.cm-search [data-find-tip]::after']).toMatchObject({ content: 'attr(data-find-tip)', visibility: 'hidden', opacity: '0' });
  });

  it('show on a glyph’s keyboard focus at once, or on pointing after the delay only while no glyph holds focus', () => {
    const focus = shown.filter(({ selector }) => !selector.includes(':hover'));
    const hover = shown.filter(({ selector }) => selector.includes(':hover'));
    expect(focus.map(({ selector }) => selector)).toEqual(FOCUSED.map((owner) => `.cm-panel.cm-search ${owner}::after`));
    for (const { body } of focus) expect(body.transition).toBeUndefined();
    expect(hover).toHaveLength(1);
    const [pointed] = hover;
    // the pointed glyph's rule holds only when the bar has no focused glyph: so two tips never show together
    expect(pointed!.selector).toBe(`.cm-panel.cm-search:not(:has(${FOCUSED.join(', ')})) [data-find-tip]:hover::after`);
    expect(pointed!.body.transition).toBe(`visibility 0s ${POINTING_DELAY_MS}ms, opacity 0s ${POINTING_DELAY_MS}ms`);
  });

  it('a shown tip takes the pointer, flush under its glyph, so moving onto it keeps it open', () => {
    expect(FIND_TIP_THEME['.cm-panel.cm-search [data-find-tip]::after']).toMatchObject({ top: '100%', pointerEvents: 'none' });
    for (const { body } of shown) expect(body.pointerEvents).toBe('auto');
  });
});
