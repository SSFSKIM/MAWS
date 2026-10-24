// P3-F wave S, F3 (docs/doperpowers/plans/2026-10-18-p3-f-finish.md, Wave S triage c37, c40, obs 9, R.2:E1): the deck
// family's toolbars (the deck's, its history bar, the design workbench's and its history bar) wrap by whole controls in
// a narrow editor. The row wraps and grows past one row's height; no control shrinks below its own width and no
// button's label wraps inside it; the element bar is a group that may narrow by wrapping its own controls; the Text
// style trigger keeps its width whichever stylesheet comes first. Read from the cascade happy-dom computes over the real
// stylesheets (`?raw`, vitest.config.ts) on the real toolbars, in the app's sheet order and in the reverse; the wrapped
// rows themselves are layout, proven in the panel at its 280 px minimum by e2e:presentations and e2e:design.
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { newDoc, transact } from '../../yjs';
import workbenchCss from '../../design/editor/workbench.css?raw';
import { DesignWorkbench } from '../../design/editor/DesignWorkbench';
import { DesignHistoryBar } from '../../design/editor/history';
import { DesignView } from '../../design/editor/viewport';
import { design } from '../../design/fixtures/support';
import { importSlide, writeDeckKeys } from '../model';
import { loadSlide } from '../parse';
import chromeCss from './chrome.css?raw';
import { DeckEditor } from './DeckEditor';
import historyCss from './history/history.css?raw';
import { HistoryBar } from './history/HistoryBar';
import type { DeckHistoryController, DeckPreview } from './history/controller';
import menusCss from './menus/menus.css?raw';
import { DeckSession } from './session';

const SHEETS = { menus: menusCss, chrome: chromeCss, history: historyCss, workbench: workbenchCss } as const;
type Sheet = keyof typeof SHEETS;
// The app's order (DeckEditor.tsx reaches menus.css through TextStyle.tsx before its own `import './chrome.css'`) and the
// reverse: the rules hold in either.
const ORDERS: Sheet[][] = [
  ['menus', 'chrome', 'history', 'workbench'],
  ['workbench', 'history', 'chrome', 'menus'],
];

let style: HTMLStyleElement | null = null;
afterEach(() => {
  cleanup();
  style?.remove();
  style = null;
});
function sheets(order: Sheet[]): void {
  for (const name of order) expect(SHEETS[name], `${name}.css read as text`).toMatch(/\{/);
  style = document.createElement('style');
  style.textContent = order.map((name) => SHEETS[name]).join('\n');
  document.head.append(style);
}

function deckDoc() {
  const doc = newDoc();
  const l = loadSlide(`<section id="s" style="background:#ffffff"><h2 id="title" style="font-size:64px">Title</h2></section>`);
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

const PREVIEW = {
  title: 'Version of 19 October, 09:12 (named “Before the review”)',
  showChanges: true,
  changes: { count: 3 },
  stops: [{ part: 'deck', slideId: null }, { part: 'slide', slideId: 's' }, { part: 'element', slideId: 's', elementId: 'title' }],
  focus: 0,
  versionId: 1,
} as unknown as DeckPreview;
const CONTROLLER = { canName: true, setShowChanges() {}, step() {}, duplicate: async () => {}, name: async () => {}, restore: async () => {} } as unknown as DeckHistoryController;
const noop = () => {};

// Each toolbar as the app mounts it, inside its editor's root.
const TOOLBARS: Record<string, () => ReactElement> = {
  'the deck’s toolbar': () => <DeckEditor session={new DeckSession(deckDoc(), 0)} assetUrl={() => null} system={null} readOnly={false} />,
  'the deck’s history bar': () => (
    <div className="deck-editor">
      <HistoryBar preview={PREVIEW} controller={CONTROLLER} onBack={noop} />
    </div>
  ),
  'the design workbench’s toolbar': () => {
    const view = new DesignView();
    view.setRoom({ w: 1000, h: 800 });
    view.setViewport({ zoom: 1, x: 0, y: 0 });
    return <DesignWorkbench session={new DeckSession(design(), 0)} view={view} assetUrl={() => null} system={null} readOnly={false} />;
  },
  'the design’s history bar': () => (
    <div className="deck-editor design-workbench">
      <DesignHistoryBar preview={PREVIEW} controller={CONTROLLER} count={3} onStep={noop} onBack={noop} />
    </div>
  ),
};

/** What keeps the toolbar from wrapping by whole controls, each named; none when it does. */
function wholeControlProblems(bar: HTMLElement): string[] {
  const problems: string[] = [];
  const css = (el: Element) => getComputedStyle(el);
  const name = (el: Element) => el.getAttribute('aria-label') ?? (el.textContent?.trim() || el.className || el.tagName.toLowerCase());
  if (css(bar).flexWrap !== 'wrap') problems.push(`the toolbar: flex-wrap ${css(bar).flexWrap || 'nowrap (unset)'}`);
  if (!['', 'auto'].includes(css(bar).height)) problems.push(`the toolbar: height fixed at ${css(bar).height}, so a second row overflows it`);
  if (css(bar).minHeight !== '36px') problems.push(`the toolbar: min-height ${css(bar).minHeight || 'unset'}, not one row's 36px`);
  // every item of the row keeps its own width, but the notice (it ellipsizes), the spacer and the element bar
  for (const item of Array.from(bar.children)) {
    if (item.matches('.deck-notice, .deck-toolbar-spacer')) continue;
    if (item.matches('.deck-element-bar')) {
      const s = css(item);
      if (s.flexWrap !== 'wrap' || !['0', '0px'].includes(s.minWidth) || s.maxWidth !== '100%') problems.push(`the element bar: flex-wrap ${s.flexWrap || 'unset'}, min-width ${s.minWidth || 'unset'}, max-width ${s.maxWidth || 'unset'}`);
      for (const inner of Array.from(item.children)) if (css(inner).flexShrink !== '0') problems.push(`${name(inner)} in the element bar: flex-shrink ${css(inner).flexShrink || '1 (unset)'}`);
      continue;
    }
    if (css(item).flexShrink !== '0') problems.push(`${name(item)}: flex-shrink ${css(item).flexShrink || '1 (unset)'}`);
  }
  // and no control's label wraps inside it
  for (const control of Array.from(bar.querySelectorAll('button, select'))) if (css(control).whiteSpace !== 'nowrap') problems.push(`${name(control)}: white-space ${css(control).whiteSpace || 'normal (unset)'}`);
  return problems;
}

describe('P3-F F3: the deck family’s toolbars wrap by whole controls', () => {
  for (const order of ORDERS) {
    for (const [which, mount] of Object.entries(TOOLBARS)) {
      it(`${which}, sheets in the order ${order.join(', ')}`, () => {
        sheets(order);
        const { container } = render(mount());
        const bar = container.querySelector<HTMLElement>('.deck-toolbar')!;
        expect(bar.getAttribute('role')).toBe('toolbar');
        expect(bar.querySelectorAll('button').length).toBeGreaterThan(3);
        expect(wholeControlProblems(bar)).toEqual([]);
      });
    }

    it(`the Text style trigger keeps its 84 px over the toolbar button’s 26 px, sheets in the order ${order.join(', ')}`, () => {
      sheets(order);
      const { container } = render(TOOLBARS['the deck’s toolbar']!());
      const trigger = container.querySelector<HTMLElement>('.deck-text-style')!;
      expect(trigger.getAttribute('aria-label')).toBe('Text style');
      expect(getComputedStyle(trigger).minWidth).toBe('84px');
    });

    it(`the deck’s minus, Fit and plus stay in one non-shrinking group, sheets in the order ${order.join(', ')}`, () => {
      sheets(order);
      const { container } = render(TOOLBARS['the deck’s toolbar']!());
      const zoom = container.querySelector<HTMLElement>('[role="group"][aria-label="Zoom controls"]')!;
      expect([...zoom.querySelectorAll('button, select')].map((control) => control.getAttribute('aria-label'))).toEqual(['Zoom out', 'Zoom', 'Zoom in']);
      expect(getComputedStyle(zoom).display).toBe('inline-flex');
      expect(getComputedStyle(zoom).flexWrap).toBe('nowrap');
      expect(getComputedStyle(zoom).flexShrink).toBe('0');
      for (const control of zoom.children) expect(getComputedStyle(control).flexShrink).toBe('0');
    });

    it(`the host slot can narrow within the toolbar instead of preserving its controls’ combined width, sheets in the order ${order.join(', ')}`, () => {
      sheets(order);
      const { container } = render(<DeckEditor session={new DeckSession(deckDoc(), 0)} assetUrl={() => null} system={null} readOnly={false} onToolbarHost={noop} />);
      const host = container.querySelector<HTMLElement>('.deck-toolbar-host')!;
      host.append(document.createElement('button'));
      const css = getComputedStyle(host);
      expect(css.flexShrink).toBe('1');
      expect(css.minWidth).toBe('0');
      expect(css.maxWidth).toBe('100%');
    });

    // P3-F F3 reviews 2 and 4: a wrapping row places each item at its flex basis, so a notice at its text's width ("A deck
    // holds at most 100 slides: delete one to add another.") would take a row of its own whenever it shows, the zoom with
    // it, and the stage would jump: its basis is zero. Beside the spacer (grow 1) it takes nearly all the row's free
    // space (grow 1000), not half, so a notice that fits shows whole. A notice shown is never narrower than a readable
    // floor, min(12rem, 100%): with less room left on its row it moves to the next row whole rather than reading as an
    // ellipsis. An empty notice has no floor, so it never breaks the row. The split itself is the browser's layout (the
    // e2e reads it, e2e:presentations); a model of flex line-breaking here would restate these same values.
    for (const which of ['the deck’s toolbar', 'the design workbench’s toolbar']) {
      it(`${which}’s notice takes the row’s free space beside the spacer, readable or on its own row, never forcing one while empty, sheets in the order ${order.join(', ')}`, () => {
        sheets(order);
        const { container } = render(TOOLBARS[which]!());
        const notice = container.querySelector<HTMLElement>('.deck-toolbar > .deck-notice')!;
        const spacer = container.querySelector<HTMLElement>('.deck-toolbar > .deck-toolbar-spacer')!;
        expect(notice.nextElementSibling, 'the spacer beside the notice').toBe(spacer);
        const s = getComputedStyle(notice);
        expect(['0', '0px', '0%'].includes(s.flexBasis) ? 'zero' : s.flexBasis || 'auto (unset)').toBe('zero');
        expect(Number(s.flexGrow), 'the notice’s grow against the spacer’s').toBeGreaterThanOrEqual(100 * Number(getComputedStyle(spacer).flexGrow || 1));
        expect([s.overflow, s.textOverflow, s.whiteSpace]).toEqual(['hidden', 'ellipsis', 'nowrap']);
        expect(notice.textContent).toBe('');
        expect(s.minWidth, 'an empty notice: no floor').toBe('0');
        // the floor for a notice shown, read from the sheet: happy-dom 20's `:empty` also matches an element holding
        // text, so its cascade never applies `:not(:empty)` (the e2e reads the floor as Chromium lays it out)
        const floor = Array.from(style!.sheet!.cssRules).find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === '.deck-notice:not(:empty)');
        expect(floor?.style.getPropertyValue('min-width'), 'a notice shown: the readable floor').toBe('min(12rem, 100%)');
      });
    }
  }
});
