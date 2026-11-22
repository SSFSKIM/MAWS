// The find bar's tips (the word cut, T336; `find-glyphs.ts`): the rules alone decide when a glyph's word shows, so they
// are read as the code theme emits them, after style-mod has scoped and split them (happy-dom draws no pseudo-element and
// matches no hover). One owner at a time: a focused glyph's tip shows at once, and a pointed glyph's only while no glyph
// holds focus; no tip takes the pointer.
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { POINTING_DELAY_MS } from '../../../ui/pointing';
import { codeThemeLight } from './code-theme';

// The emitted rules that draw a tip, each split into its selectors and its declarations
const rules = EditorState.create({ extensions: codeThemeLight })
  .facet(EditorView.styleModule)
  .flatMap((module) => module.getRules().split('\n'))
  .filter((rule) => rule.includes('[data-find-tip]'))
  .map((rule) => {
    const [, selectors = '', body = ''] = /^(.*?) \{(.*)\}$/.exec(rule) ?? [];
    const declarations = Object.fromEntries(
      body
        .split(';')
        .filter((part) => part.trim() !== '')
        .map((part) => part.split(/:(.*)/s).map((side) => side.trim()) as [string, string]),
    );
    return { rule, selectors: selectors.split(', '), declarations };
  });
const all = rules.flatMap(({ selectors }) => selectors);
const scope = /^\.ͼ\w+ /.exec(all[0] ?? '')?.[0] ?? 'no scope';
const shown = rules.filter(({ declarations }) => declarations.visibility === 'visible');

const balanced = (selector: string) => {
  let depth = 0;
  for (const char of selector) {
    depth += char === '(' ? 1 : char === ')' ? -1 : 0;
    if (depth < 0) return false;
  }
  return depth === 0;
};
// a `:has(` opened while another is still open: Chromium drops the whole rule
const nestsHas = (selector: string) => {
  const open: number[] = [];
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector.startsWith(':has(', i) && open.push(depth + 1) > 1) return true;
    if (selector[i] === '(') depth++;
    else if (selector[i] === ')') {
      if (open.at(-1) === depth) open.pop();
      depth--;
    }
  }
  return false;
};

describe('the find bar’s tips', () => {
  it('are emitted as well-formed rules in the editor’s scope, none nesting :has', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const { rule } of rules) expect(rule, rule).toMatch(/^\S.* \{.+\}$/);
    for (const selector of all) {
      expect(selector.startsWith(scope), selector).toBe(true);
      expect(selector.indexOf('.ͼ', 1), selector).toBe(-1); // the scope once, at the head, never inserted mid-selector
      expect(balanced(selector), selector).toBe(true);
      expect(nestsHas(selector), selector).toBe(false);
      expect(() => document.querySelector(selector.replace(/::after$/, '')), selector).not.toThrow();
    }
  });

  it('are hidden at rest, below their glyph', () => {
    const rest = rules.find(({ selectors }) => selectors.join() === `${scope}.cm-panel.cm-search [data-find-tip]::after`);
    expect(rest?.declarations).toMatchObject({ content: 'attr(data-find-tip)', top: '100%', visibility: 'hidden', opacity: '0' });
  });

  it('show on a glyph’s keyboard focus at once, or on pointing after the delay only while no glyph holds focus', () => {
    const pointed = ({ selectors }: { selectors: string[] }) => selectors.some((selector) => selector.includes(':hover'));
    const focus = shown.filter((rule) => !pointed(rule));
    const hover = shown.filter(pointed);
    expect(focus.flatMap(({ selectors }) => selectors)).toEqual([
      `${scope}.cm-panel.cm-search [data-find-tip]:focus-visible::after`,
      `${scope}.cm-panel.cm-search [data-find-tip]:has(input:focus-visible)::after`,
    ]);
    for (const { declarations } of focus) expect(declarations.transition).toBeUndefined();
    // the pointed glyph's rule holds only while the bar has no focused glyph of either kind: two tips never show together
    expect(hover.flatMap(({ selectors }) => selectors)).toEqual([
      `${scope}.cm-panel.cm-search:not(:has([data-find-tip]:focus-visible)):not(:has([data-find-tip] input:focus-visible)) [data-find-tip]:hover::after`,
    ]);
    expect(hover[0]?.declarations.transition).toBe(`visibility 0s ${POINTING_DELAY_MS}ms, opacity 0s ${POINTING_DELAY_MS}ms`);
  });

  it('never take the pointer, so a click on a tip reaches neither its glyph nor the code under it', () => {
    const set = rules.filter(({ declarations }) => 'pointer-events' in declarations);
    expect(set.length).toBeGreaterThan(0);
    for (const { declarations } of set) expect(declarations['pointer-events']).toBe('none');
  });
});
