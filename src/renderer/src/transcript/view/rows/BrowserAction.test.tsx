// E4c (M3, Design §10): a browser action row on screen, as a journal written before the browser tools left (P1 A-54)
// draws it. Its one line per tool and action ("Opened example.com", "Clicked button "Submit"", "Snapshot of example.com
// (24,000 of 47,125 chars)"), the time it took, the disclosure of a snapshot's text or an eval's value, Open tab and a
// screenshot's Open, a refusal's reason and a cancelled call's line.
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { POINTING_DELAY_MS } from '../../../ui/pointing';
import { fakeTimeouts, realTimeouts } from '../../../test-support/fake-timeouts';
import type { Row } from '../../model/rows';
import { accessibleText } from '../../../test-support/accessible-text';
import { renderRow } from './test-support';

type BrowserRow = Extract<Row, { kind: 'browser_action' }>;

const APP = 'app-browser' as AppSessionId;
const TAB = 'b_000000000001';
const DELIVERABLE = '6f1c2a4e-3b5d-4c7e-8f90-a1b2c3d4e5f6';
const BASE: BrowserRow = {
  id: 'browser:t1' as never, turnId: null, at: '2026-10-07T10:00:00.000Z', kind: 'browser_action', toolUseId: 't1' as never, tool: 'browser_act', action: 'click', tabId: TAB,
  target: 'e12', targetRole: 'button', targetName: 'Submit', value: null, url: 'https://example.com/form', title: 'Order form', ms: 40, deliverableId: null, error: null,
  waitedFor: null, waitedMs: null, chars: null, truncated: false, tabCount: null, state: 'done', detail: null, answered: true,
};
const row = (over: Partial<BrowserRow>): BrowserRow => ({ ...BASE, ...over });
const heading = (container: HTMLElement) => container.querySelector('[data-browser-heading]')!.textContent;
const described = (element: HTMLElement) => (element.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
const buttons = (container: HTMLElement) => [...container.querySelectorAll('button')].map((button) => button.textContent);

afterEach(() => cleanup());

describe('the browser action row', () => {
  it.each<[string, Partial<BrowserRow>, string]>([
    ['open', { tool: 'browser_tabs', action: 'open', target: 'https://example.com/form' }, 'Opened example.com'],
    ['open, running', { tool: 'browser_tabs', action: 'open', target: 'https://example.com/form', url: null, state: 'running', ms: null, answered: false }, 'Opening example.com'],
    ['list', { tool: 'browser_tabs', action: 'list', tabId: null, target: null, url: null, tabCount: 3 }, 'Listed 3 tabs'],
    ['close', { tool: 'browser_tabs', action: 'close', target: null }, 'Closed tab'],
    ['select', { tool: 'browser_tabs', action: 'select', target: null }, 'Selected tab example.com'],
    ['navigate', { tool: 'browser_navigate', action: 'url', target: 'https://example.com/form' }, 'Navigated to example.com'],
    ['back', { tool: 'browser_navigate', action: 'back', target: null }, 'Went back'],
    ['reload', { tool: 'browser_navigate', action: 'reload', target: null }, 'Reloaded example.com'],
    ['snapshot, cut', { tool: 'browser_snapshot', action: 'snapshot', target: null, chars: 47_125, truncated: true, detail: 'x'.repeat(24_000) }, 'Snapshot of example.com (24,000 of 47,125 chars)'],
    // the cut is the result's own flag, never inferred from the text's length (the engine may append to it, or drop it)
    ['snapshot, whole, shorter text', { tool: 'browser_snapshot', action: 'snapshot', target: null, chars: 47_125, truncated: false, detail: 'x'.repeat(24_000) }, 'Snapshot of example.com (47,125 chars)'],
    ['snapshot, whole', { tool: 'browser_snapshot', action: 'snapshot', target: null, chars: 448, detail: 'x'.repeat(448) }, 'Snapshot of example.com (448 chars)'],
    ['snapshot, rooted', { tool: 'browser_snapshot', action: 'snapshot', target: 'main', chars: 448, detail: 'x'.repeat(448) }, 'Snapshot of main on example.com (448 chars)'],
    ['click', {}, 'Clicked button "Submit"'],
    ['click by ref alone', { targetRole: null, targetName: null }, 'Clicked e12'],
    ['fill', { action: 'fill', target: 'e2', targetRole: 'textbox', targetName: 'Name' }, 'Filled textbox "Name"'],
    ['select', { action: 'select', targetRole: 'combobox', targetName: 'Colour', value: 'Blue' }, 'Selected "Blue" in combobox "Colour"'],
    ['check off', { action: 'check', targetRole: 'checkbox', targetName: 'Gift', value: 'false' }, 'Unchecked checkbox "Gift"'],
    ['press', { action: 'press', value: 'Enter' }, 'Pressed Enter'],
    ['hover by css', { action: 'hover', target: '#menu > li:first-child', targetRole: null, targetName: null }, 'Hovered over #menu > li:first-child'],
    ['scroll', { action: 'scroll', targetRole: 'list', targetName: 'Orders', value: '-300' }, 'Scrolled list "Orders" by -300 px'],
    ['eval', { tool: 'browser_eval', action: 'eval', target: null, detail: '"Order form"' }, 'Evaluated an expression'],
    ['screenshot', { tool: 'browser_screenshot', action: 'screenshot', target: 'page', targetRole: null, targetName: null, deliverableId: DELIVERABLE }, 'Screenshot of example.com'],
    ['full page', { tool: 'browser_screenshot', action: 'screenshot', target: 'fullPage', targetRole: null, targetName: null, deliverableId: DELIVERABLE }, 'Full-page screenshot of example.com'],
    ['element shot', { tool: 'browser_screenshot', action: 'screenshot', deliverableId: DELIVERABLE }, 'Screenshot of button "Submit"'],
    // a page with no host (about:blank, data:, file:) is worded without one; an unparseable URL is cut as an element is
    ['open, no host', { tool: 'browser_tabs', action: 'open', target: 'https://example.com/form', url: 'data:text/html,<p>hi</p>' }, 'Opened a page'],
    ['navigate, no host', { tool: 'browser_navigate', action: 'url', target: 'https://example.com/form', url: 'file:///tmp/form.html' }, 'Navigated to a page'],
    ['reload, no host', { tool: 'browser_navigate', action: 'reload', target: null, url: 'about:blank' }, 'Reloaded the page'],
    ['select, no host', { tool: 'browser_tabs', action: 'select', target: null, url: 'about:blank' }, 'Selected tab'],
    ['snapshot, no host', { tool: 'browser_snapshot', action: 'snapshot', target: null, url: 'about:blank', chars: 30, detail: 'x'.repeat(30) }, 'Snapshot (30 chars)'],
    ['snapshot, rooted, no host', { tool: 'browser_snapshot', action: 'snapshot', target: 'main', url: 'about:blank', chars: 30, detail: 'x'.repeat(30) }, 'Snapshot of main (30 chars)'],
    ['screenshot, no host', { tool: 'browser_screenshot', action: 'screenshot', target: 'page', targetRole: null, targetName: null, url: 'about:blank', deliverableId: DELIVERABLE }, 'Screenshot'],
    ['open, unparseable', { tool: 'browser_tabs', action: 'open', target: `not a url ${'x'.repeat(80)}`, url: null }, `Opened not a url ${'x'.repeat(49)}…`],
    ['refused arguments', { action: 'drag', state: 'error', error: 'browser_act: invalid arguments: action: Invalid option' }, 'Could not run browser act'],
  ])('reads its line: %s', (_name, over, expected) => {
    expect(heading(renderRow(row(over), { storeKey: APP }).container)).toBe(expected);
  });

  it('keeps the time it took, and how long the person or a sheet held it, for pointing at or focusing its line (the word cut, T105)', () => {
    const { container } = renderRow(row({ ms: 3_400, waitedFor: 'human', waitedMs: 3_000 }), { storeKey: APP });
    const line = container.querySelector<HTMLElement>('[data-browser-heading]')!;
    expect(accessibleText(container)).toBe('Clicked button "Submit"Open tab');
    expect(described(line)).toBe('3.4s · waited 3.0s for you');
    act(() => line.focus());
    expect(document.activeElement).toBe(line);
    expect(screen.getByRole('tooltip').textContent).toBe('3.4s · waited 3.0s for you');
    cleanup();
    const quick = renderRow(row({ ms: 40 }), { storeKey: APP }).container.querySelector<HTMLElement>('[data-browser-heading]')!;
    expect(described(quick)).toBe('40ms');
    cleanup();
    const running = renderRow(row({ state: 'running', ms: null, answered: false }), { storeKey: APP }).container.querySelector<HTMLElement>('[data-browser-heading]')!;
    expect(running.hasAttribute('tabindex')).toBe(false); // nothing waits on a running call's line
  });

  // Task 2 fix round 1 (T105): the whole line is where pointing shows the time; the keyboard reaches it on the phrase
  it('shows the time on pointing anywhere along its line, its actions not part of the tip', async () => {
    fakeTimeouts();
    onTestFinished(realTimeouts);
    const { container } = renderRow(row({ ms: 3_400 }), { storeKey: APP });
    const openTab = screen.getByRole('button', { name: 'Open tab' });
    await userEvent.setup({ delay: null }).hover(openTab);
    act(() => void vi.advanceTimersByTime(POINTING_DELAY_MS));
    expect(screen.getByRole('tooltip').textContent).toBe('3.4s');
    expect(openTab.hasAttribute('aria-describedby')).toBe(false);
    expect(described(container.querySelector<HTMLElement>('[data-browser-heading]')!)).toBe('3.4s');
  });

  // Fix wave (scalpel-3#1; the touch rule, ticket 830): where nothing points (a phone's desk) the tip cannot open, so
  // the time stands on the line, drawn only there by the stylesheet (ui/touch-fact.test.tsx) and hidden from assistive
  // technology, which hears it as the phrase's description
  it('carries its time on the line for a screen that cannot point, hidden from assistive technology', () => {
    const { container } = renderRow(row({ ms: 3_400, waitedFor: 'human', waitedMs: 3_000 }), { storeKey: APP });
    const time = container.querySelector<HTMLElement>('.transcript-browser-action-line > [data-touch-fact]')!;
    expect(time.textContent).toBe('3.4s · waited 3.0s for you');
    expect(time.textContent).toBe(described(container.querySelector<HTMLElement>('[data-browser-heading]')!));
    expect([time.getAttribute('data-touch-fact'), time.getAttribute('aria-hidden')]).toEqual(['', 'true']);
    cleanup();
    const running = renderRow(row({ state: 'running', ms: null, answered: false }), { storeKey: APP }).container;
    expect(running.querySelector('[data-touch-fact]')).toBeNull();
  });

  it('draws its actions on pointing or focus within the line, and keeps them while the snapshot is open (T106)', () => {
    const { container } = renderRow(row({ tool: 'browser_snapshot', action: 'snapshot', target: null, chars: 30, detail: 'x' }), { storeKey: APP });
    const actions = container.querySelector('.transcript-browser-action-actions')!;
    expect(actions.hasAttribute('data-on-hover')).toBe(true);
    const root = container.querySelector('.transcript-browser-action')!;
    expect(root.hasAttribute('data-open')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show snapshot' }));
    expect(root.hasAttribute('data-open')).toBe(true);
  });

  it('discloses a snapshot’s text and an eval’s value', () => {
    const snapshot = renderRow(row({ tool: 'browser_snapshot', action: 'snapshot', target: null, chars: 30, detail: '- heading "Order form" [ref=e1]' }), { storeKey: APP });
    expect(snapshot.container.querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show snapshot' }));
    expect(snapshot.container.querySelector('pre')!.textContent).toBe('- heading "Order form" [ref=e1]');
    fireEvent.click(screen.getByRole('button', { name: 'Hide snapshot' }));
    expect(snapshot.container.querySelector('pre')).toBeNull();
    cleanup();
    renderRow(row({ tool: 'browser_eval', action: 'eval', target: null, detail: '{\n  "fields": 2\n}' }), { storeKey: APP });
    fireEvent.click(screen.getByRole('button', { name: 'Show value' }));
    expect(document.querySelector('pre')!.textContent).toBe('{\n  "fields": 2\n}');
  });

  it('Open tab shows the row’s tab in the Browser tool; a screenshot’s Open its artifact', () => {
    const acted = renderRow(row({}), { storeKey: APP });
    expect(buttons(acted.container)).toEqual(['Open tab']);
    fireEvent.click(screen.getByRole('button', { name: 'Open tab' }));
    expect(acted.actions.openBrowserTab).toHaveBeenCalledWith(APP, TAB);
    cleanup();
    const shot = renderRow(row({ tool: 'browser_screenshot', action: 'screenshot', target: 'page', deliverableId: DELIVERABLE }), { storeKey: APP });
    expect(buttons(shot.container)).toEqual(['Open', 'Open tab']);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(shot.actions.openArtifact).toHaveBeenCalledWith(APP, DELIVERABLE);
  });

  it('offers no Open tab for a listing, a closed tab or a refusal, and nothing outside a mounted transcript', () => {
    for (const over of [{ tool: 'browser_tabs', action: 'list', tabId: null }, { tool: 'browser_tabs', action: 'close' }, { state: 'error', error: 'browser_act: no tab' }] as Partial<BrowserRow>[]) {
      expect(buttons(renderRow(row(over), { storeKey: APP }).container)).toEqual([]);
      cleanup();
    }
    expect(buttons(renderRow(row({})).container)).toEqual([]);
  });

  it('a refusal reads what could not be done and why, without the tool’s name; a cancelled call reads Cancelled (T107)', () => {
    const error = 'browser_act: ref "e12" is stale or missing in the current snapshot; call browser_snapshot again and use a ref from it';
    const refused = renderRow(row({ targetRole: null, targetName: null, state: 'error', error, ms: null }), { storeKey: APP });
    expect(heading(refused.container)).toBe('Could not click e12');
    expect(refused.container.querySelector('[data-browser-error]')!.textContent).toBe('Ref "e12" is stale or missing in the current snapshot; call browser_snapshot again and use a ref from it');
    cleanup();
    const cancelled = renderRow(row({ state: 'cancelled', ms: null, answered: false }), { storeKey: APP });
    expect(heading(cancelled.container)).toBe('Clicking button "Submit"');
    expect(cancelled.container.querySelector('[data-browser-note]')!.textContent).toBe('Cancelled');
  });
});
