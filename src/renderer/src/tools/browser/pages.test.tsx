// E4a (Task 3.2): the renderer-drawn pages by tab state (Design §4 "The pane", §5, §15): Codex's error page per kind
// (no "Try:" list for a certificate), its details and Reload; the crash page; a view that could not be created, with
// Retry (`reload`, Decision Log 44 (c)); a suspended tab offering its last URL as parsed (Decision Log 34); a tab that
// never navigated; a main tab whose tab is gone.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOAD_ERROR_KINDS } from '@shared/browser/errors';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { browserTab, T1 } from '../../test-support/browser';
import { installFakeMain, ok } from '../../test-support/code';
import { BROWSER_COPY } from './copy';
import { resetCovering } from './covering';
import { BrowserPane } from './Pane';
import { resetBrowser } from './store';

const A = 'app-a' as AppSessionId;
let main: ReturnType<typeof installFakeMain>;
const navigations = () => main.callsOf('browser.tabs.navigate');

beforeEach(() => {
  resetBrowser();
  resetCovering();
  main = installFakeMain(() => ok({ accepted: true }));
});
afterEach(() => {
  cleanup();
  resetCovering();
});

const show = (over: Partial<BrowserTab>) => render(<BrowserPane tab={browserTab(T1, A, over)} surface="panel" />);
const loadError = (kind: (typeof LOAD_ERROR_KINDS)[number], description = 'ERR_X') => ({ url: 'http://127.0.0.1:1/', host: '127.0.0.1', kind, code: -102, description });

describe('the error page', () => {
  it.each(LOAD_ERROR_KINDS)('%s: Codex’s heading and the summary for the kind, with the host', (kind) => {
    show({ loadError: loadError(kind) });
    expect(screen.getByRole('heading', { name: BROWSER_COPY.loadError.heading })).toBeTruthy();
    expect(screen.getByText(BROWSER_COPY.loadError.summary[kind]('127.0.0.1'))).toBeTruthy();
    expect(screen.queryByText(BROWSER_COPY.loadError.try) === null).toBe(kind === 'certificate');
  });

  it('refused: the exact sentence, the error’s name, the details behind the second suggestion, and Reload', () => {
    show({ loadError: loadError('refused', 'ERR_CONNECTION_REFUSED') });
    expect(screen.getByText('127.0.0.1 refused to connect')).toBeTruthy();
    expect(screen.getByText('ERR_CONNECTION_REFUSED')).toBeTruthy();
    expect(screen.getByText('Checking the connection')).toBeTruthy();
    expect(screen.queryByText('Check your DNS settings')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Checking the proxy, firewall, and DNS configuration' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Allow MAWS to access the network in your firewall or security settings')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(navigations()).toEqual([{ tabId: T1, to: 'reload' }]);
  });

  it('an empty description names the code as Codex does', () => {
    show({ loadError: loadError('generic', '') });
    expect(screen.getByText('ERR_FAILED (-102)')).toBeTruthy();
  });
});

describe('the other pages', () => {
  it('crashed: the reason, and Reload', () => {
    show({ crashed: { reason: 'oom' } });
    expect(screen.getByRole('heading', { name: BROWSER_COPY.crashedHeading })).toBeTruthy();
    expect(screen.getByText(BROWSER_COPY.crashed('oom'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(navigations()).toEqual([{ tabId: T1, to: 'reload' }]);
  });

  it('a view that could not be created: its message, and Retry sends reload', () => {
    show({ failed: { message: 'the partition could not open' } });
    expect(screen.getByRole('heading', { name: BROWSER_COPY.viewFailedHeading })).toBeTruthy();
    expect(screen.getByText('the partition could not open')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(navigations()).toEqual([{ tabId: T1, to: 'reload' }]);
  });

  it('suspended with a URL: its title, Open <url> loading it as parsed, the restored note', () => {
    show({ suspended: true, url: 'https://Example.com/a', title: 'Page A' });
    expect(screen.getByText('Page A')).toBeTruthy();
    expect(screen.getByText(BROWSER_COPY.suspended.note)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open https://example.com/a' }));
    expect(navigations()).toEqual([{ tabId: T1, to: { url: 'https://example.com/a' } }]);
  });

  it('a tab that never navigated, and a session with no tab: Start browsing', () => {
    show({ url: '', title: '' });
    expect(screen.getByRole('heading', { name: BROWSER_COPY.empty.title })).toBeTruthy();
    expect(screen.getByText(BROWSER_COPY.empty.body)).toBeTruthy();
    cleanup();
    render(<BrowserPane tab={null} surface="panel" />);
    expect(screen.getByRole('heading', { name: BROWSER_COPY.empty.title })).toBeTruthy();
    expect(screen.queryByText(BROWSER_COPY.tabGone)).toBeNull();
  });

  it('a main tab whose tab is gone: Start browsing, headed That tab was closed', () => {
    render(<BrowserPane tab={null} surface="main" gone />);
    expect(screen.getByText(BROWSER_COPY.tabGone)).toBeTruthy();
    expect(screen.getByRole('heading', { name: BROWSER_COPY.empty.title })).toBeTruthy();
  });

  it('a refusal other than an unknown tab is warned; an unknown tab (closed meanwhile) is not', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    main = installFakeMain(() => ({ ok: false, error: { code: 'invalid_input', message: 'unknown browser tab' } }));
    show({ crashed: { reason: 'oom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).not.toHaveBeenCalled();
    cleanup();
    main = installFakeMain(() => ({ ok: false, error: { code: 'invalid_input', message: 'not an http or https URL' } }));
    show({ crashed: { reason: 'oom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledWith('[browser] navigating failed: not an http or https URL');
    warn.mockRestore();
  });

  it('a live page draws nothing over the view', () => {
    const { container } = show({});
    expect(container.querySelector('[data-browser-pane]')!.childElementCount).toBe(0);
  });
});
