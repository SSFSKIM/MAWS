// E4c (M3, Design §10): a browser action row on screen. Its one line per tool and action ("Opened example.com",
// "Clicked button "Submit"", "Snapshot of example.com (24,000 of 47,125 chars)"), the time it took, the waiting line
// while main reports the person or a sheet holding the action, the disclosure of a snapshot's text or an eval's value,
// Open tab and a screenshot's Open, a refusal's reason and a cancelled call's line.
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearBrowserProgress, connectBrowserProgress, resetBrowserProgress } from '../../../tools/browser/agent/progress';
import { installFakeMain } from '../../../test-support/code';
import type { Row } from '../../model/rows';
import { renderRow } from './test-support';

type BrowserRow = Extract<Row, { kind: 'browser_action' }>;

const APP = 'app-browser' as AppSessionId;
const TAB = 'b_000000000001';
const DELIVERABLE = '6f1c2a4e-3b5d-4c7e-8f90-a1b2c3d4e5f6';
const BASE: BrowserRow = {
  id: 'browser:t1' as never, turnId: null, at: '2026-10-07T10:00:00.000Z', kind: 'browser_action', toolUseId: 't1' as never, tool: 'browser_act', action: 'click', tabId: TAB,
  target: 'e12', targetRole: 'button', targetName: 'Submit', value: null, url: 'https://example.com/form', title: 'Order form', ms: 40, deliverableId: null, error: null,
  waitedFor: null, waitedMs: null, chars: null, tabCount: null, state: 'done', detail: null, answered: true,
};
const row = (over: Partial<BrowserRow>): BrowserRow => ({ ...BASE, ...over });
const heading = (container: HTMLElement) => container.querySelector('[data-browser-heading]')!.textContent;
const buttons = (container: HTMLElement) => [...container.querySelectorAll('button')].map((button) => button.textContent);

beforeEach(() => resetBrowserProgress());
afterEach(() => {
  cleanup();
  resetBrowserProgress();
  vi.useRealTimers();
  delete (window as { maws?: unknown }).maws;
});

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
    ['snapshot, cut', { tool: 'browser_snapshot', action: 'snapshot', target: null, chars: 47_125, detail: 'x'.repeat(24_000) }, 'Snapshot of example.com (24,000 of 47,125 chars)'],
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
    ['refused arguments', { action: 'drag', state: 'error', error: 'browser_act: invalid arguments: action: Invalid option' }, 'Could not run browser act'],
  ])('reads its line: %s', (_name, over, expected) => {
    expect(heading(renderRow(row(over), { storeKey: APP }).container)).toBe(expected);
  });

  it('shows the time once done, and how long the person or a sheet held it', () => {
    const { container } = renderRow(row({ ms: 3_400, waitedFor: 'human', waitedMs: 3_000 }), { storeKey: APP });
    expect(container.querySelector('[data-browser-took]')!.textContent).toBe('3.4s · waited 3.0s for you');
    cleanup();
    expect(renderRow(row({ ms: 40 }), { storeKey: APP }).container.querySelector('[data-browser-took]')!.textContent).toBe('40ms');
  });

  it('while running, reads the waiting line main reports, ticking, and drops it when the wait ends', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(Date.parse('2026-10-07T10:00:12.000Z'));
    const main = installFakeMain(() => ({ ok: true, value: undefined }));
    const stop = connectBrowserProgress(main.bridge);
    const progress = (waiting: 'human' | 'cover' | null) =>
      act(() => main.emit('maws.browser.progress', { appSessionId: APP, toolUseId: 't1' as never, tabId: TAB, tool: 'browser_act', waiting, since: '2026-10-07T10:00:00.000Z' }));
    const running = row({ state: 'running', ms: null, url: null, answered: false });
    const view = renderRow(running, { storeKey: APP });
    expect(view.container.querySelector('section')!.getAttribute('data-state')).toBe('running');
    expect(screen.queryByRole('status')).toBeNull();
    progress('human');
    expect(screen.getByRole('status').textContent).toBe('Waiting · you have the page · 12s');
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole('status').textContent).toBe('Waiting · you have the page · 14s');
    progress('cover');
    expect(screen.getByRole('status').textContent).toBe('Waiting · a sheet covers the page · 14s');
    progress(null);
    expect(screen.queryByRole('status')).toBeNull();
    stop();
  });

  it('a row whose result is in reads no waiting line, and lets the store forget the wait', () => {
    const main = installFakeMain(() => ({ ok: true, value: undefined }));
    const stop = connectBrowserProgress(main.bridge);
    act(() => main.emit('maws.browser.progress', { appSessionId: APP, toolUseId: 't1' as never, tabId: TAB, tool: 'browser_act', waiting: 'human', since: '2026-10-07T10:00:00.000Z' }));
    const view = renderRow(row({ state: 'running', answered: false, ms: null }), { storeKey: APP });
    expect(screen.getByRole('status')).toBeTruthy();
    view.rerenderRow(row({}));
    expect(screen.queryByRole('status')).toBeNull();
    view.rerenderRow(row({ state: 'running', answered: false, ms: null })); // the store no longer holds it
    expect(screen.queryByRole('status')).toBeNull();
    stop();
    clearBrowserProgress('t1');
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

  it('Open tab shows the row’s tab in the Browser tool; a screenshot’s Open its deliverable', () => {
    const acted = renderRow(row({}), { storeKey: APP });
    expect(buttons(acted.container)).toEqual(['Open tab']);
    fireEvent.click(screen.getByRole('button', { name: 'Open tab' }));
    expect(acted.actions.openBrowserTab).toHaveBeenCalledWith(APP, TAB);
    cleanup();
    const shot = renderRow(row({ tool: 'browser_screenshot', action: 'screenshot', target: 'page', deliverableId: DELIVERABLE }), { storeKey: APP });
    expect(buttons(shot.container)).toEqual(['Open', 'Open tab']);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(shot.actions.openDeliverable).toHaveBeenCalledWith(APP, DELIVERABLE);
  });

  it('offers no Open tab for a listing, a closed tab or a refusal, and nothing outside a mounted transcript', () => {
    for (const over of [{ tool: 'browser_tabs', action: 'list', tabId: null }, { tool: 'browser_tabs', action: 'close' }, { state: 'error', error: 'browser_act: no tab' }] as Partial<BrowserRow>[]) {
      expect(buttons(renderRow(row(over), { storeKey: APP }).container)).toEqual([]);
      cleanup();
    }
    expect(buttons(renderRow(row({})).container)).toEqual([]);
  });

  it('a refusal reads what could not be done and why, without the tool’s name; a cancelled call says the turn was interrupted', () => {
    const error = 'browser_act: ref "e12" is stale or missing in the current snapshot; call browser_snapshot again and use a ref from it';
    const refused = renderRow(row({ targetRole: null, targetName: null, state: 'error', error, ms: null }), { storeKey: APP });
    expect(heading(refused.container)).toBe('Could not click e12');
    expect(refused.container.querySelector('[data-browser-error]')!.textContent).toBe('Ref "e12" is stale or missing in the current snapshot; call browser_snapshot again and use a ref from it');
    cleanup();
    const cancelled = renderRow(row({ state: 'cancelled', ms: null, answered: false }), { storeKey: APP });
    expect(heading(cancelled.container)).toBe('Clicking button "Submit"');
    expect(cancelled.container.querySelector('[data-browser-note]')!.textContent).toBe('Cancelled, the turn was interrupted');
  });
});
