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

const PREVIEW = { title: 'Version of 19 October, 09:12 (named “Before the review”)', showChanges: true, changes: { count: 3 }, versionId: 'v1' } as unknown as DeckPreview;
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

    // P3-F F3 review 2: a wrapping row places each item at its flex basis, so a notice at its text's width ("A deck holds
    // at most 100 slides: delete one to add another.") would take a row of its own for as long as it shows, the zoom
    // with it, and the stage would jump. With a zero basis it never breaks the row: it takes what the row has left
    // beside the spacer and ellipsizes there, as before the row wrapped.
    for (const which of ['the deck’s toolbar', 'the design workbench’s toolbar']) {
      it(`${which}’s notice never takes a row of its own, ellipsized in what is left, sheets in the order ${order.join(', ')}`, () => {
        sheets(order);
        const { container } = render(TOOLBARS[which]!());
        const notice = container.querySelector<HTMLElement>('.deck-toolbar > .deck-notice')!;
        const s = getComputedStyle(notice);
        expect({ basis: ['0', '0px', '0%'].includes(s.flexBasis) ? 'zero' : s.flexBasis || 'auto (unset)', grow: s.flexGrow, minWidth: s.minWidth }).toEqual({ basis: 'zero', grow: '1', minWidth: '0' });
        expect([s.overflow, s.textOverflow, s.whiteSpace]).toEqual(['hidden', 'ellipsis', 'nowrap']);
      });
    }
  }
});
