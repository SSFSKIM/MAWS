import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../ipc/query';
import { registerPanelTool } from '../panel/host';
import { PanelHost } from '../panel/PanelHost';
import { useLayout } from '../stores/layout';
import { A, probeTool, ref, resetPanelStores } from '../test-support/panel';
import { browserTab, T1, T2 } from '../test-support/browser';
import { installFakeMain, ok } from '../test-support/code';
import { BrowserPane } from '../tools/browser/Pane';
import { resetCovering } from '../tools/browser/covering';
import { resetBrowser } from '../tools/browser/store';
import { Shell } from './Shell';
import { useShellView } from './shell-view';
import { registerSlot, resetSlots } from './slots';

vi.mock('./Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const offs: (() => void)[] = [];
let main: ReturnType<typeof installFakeMain>;
const setWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });
const frames = async (n = 3) => {
  for (let i = 0; i < n; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};
const mainPlaces = () => main.callsOf('browser.view.place').filter((call) => call.surface === 'main');
const covers = () => main.callsOf('browser.view.cover').map((call) => call.covered);
const openSurface = (id: string) => act(() => useLayout.getState().setPanelTabs(A, { tabs: [ref(`${id}:aaaaaaaa`)], activeTabId: `${id}:aaaaaaaa` }));
function renderShell() {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  return render(<QueryClientProvider client={queryClient}><Shell /></QueryClientProvider>, { container: root });
}

beforeEach(() => {
  setWidth(900);
  resetPanelStores();
  resetBrowser();
  resetCovering();
  useLayout.setState({ overviewOpen: false });
  main = installFakeMain(() => ok());
  registerSlot('panelHost', PanelHost);
  registerSlot('browserTab', () => <BrowserPane tab={browserTab(T1, A)} surface="main" />);
  offs.push(registerPanelTool(probeTool('review').tool));
  offs.push(registerPanelTool(probeTool('browser', { render: () => <BrowserPane tab={browserTab(T2, A)} surface="panel" /> }).tool));
  useLayout.getState().openTab({ kind: 'browser', appSessionId: A, browserTabId: T1 });
  // happy-dom has no layout; provide the native pane's measured boundary, with no room in a collapsed panel.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const visiblePane = this.matches('[data-browser-pane]') && !this.closest('[data-region="panel"][inert]');
    const rect = visiblePane ? { x: 30, y: 90, width: 500, height: 400 } : { x: 0, y: 0, width: 0, height: 0 };
    return { ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => rect } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  document.getElementById('root')?.remove();
  offs.splice(0).forEach((off) => off());
  resetSlots();
  resetCovering();
  vi.restoreAllMocks();
});

describe('native Browser views under shell overlays', () => {
  it('covers the live main Browser under explicit Session cards only while the cards overlay it', async () => {
    const user = userEvent.setup();
    renderShell();
    await frames();
    expect(covers()).toEqual([]);
    expect(screen.queryByRole('complementary', { name: 'Session cards' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Session cards' }));
    await frames();
    expect(screen.getByRole('complementary', { name: 'Session cards' })).toBeTruthy();
    expect(mainPlaces().at(-1)!.rect).not.toBeNull();
    expect(covers()).toEqual([true]);
    await user.click(screen.getByRole('button', { name: 'Session cards' }));
    await frames();
    expect(screen.queryByRole('complementary', { name: 'Session cards' })).toBeNull();
    expect(covers()).toEqual([true, false]);
    await user.click(screen.getByRole('button', { name: 'Session cards' }));
    await frames();
    expect(covers()).toEqual([true, false, true]);
    act(() => setWidth(1440));
    await frames();
    expect(screen.getByRole('complementary', { name: 'Session cards' })).toBeTruthy();
    expect(covers()).toEqual([true, false, true, false]); // wide cards have their own reserved main-area column
  });

  it('registers the automatic sidebar overlay with the cover lifecycle and lifts it on close or return to a docked sidebar', async () => {
    openSurface('review');
    renderShell();
    await frames();
    expect(mainPlaces().at(-1)).toMatchObject({ claim: true, rect: { width: 500 } });
    expect(covers()).toEqual([]);
    act(() => useShellView.setState({ sidebarOverlay: true }));
    expect(screen.getByRole('button', { name: 'Close sidebar overlay' })).toBeTruthy();
    await frames();
    expect(covers()).toEqual([true]);
    act(() => useShellView.setState({ sidebarOverlay: false }));
    await frames();
    expect(covers()).toEqual([true, false]);
    act(() => useShellView.setState({ sidebarOverlay: true }));
    await frames();
    act(() => setWidth(1200));
    await frames();
    expect(covers()).toEqual([true, false, true, false]);
  });

  it('keeps a Browser sheet live above Overview and lets Escape dismiss the sheet before Overview', async () => {
    const user = userEvent.setup();
    setWidth(600);
    renderShell();
    await frames();
    act(() => useLayout.getState().setOverviewOpen(true));
    await frames();
    expect(covers()).toEqual([true]);
    openSurface('browser');
    await frames();
    expect(covers()).toEqual([true, false]);
    expect(main.callsOf('browser.view.place').filter((call) => call.surface === 'panel').at(-1)).toMatchObject({ tabId: T2, claim: true, rect: { width: 500 } });
    screen.getByRole('button', { name: 'Close surface sheet' }).focus();
    await user.keyboard('{Escape}');
    await frames();
    expect(screen.queryByRole('button', { name: 'Close surface sheet' })).toBeNull();
    expect(useLayout.getState().overviewOpen).toBe(true);
    expect(mainPlaces().at(-1)).toMatchObject({ claim: true, rect: { width: 500 } });
    expect(covers()).toEqual([true, false, true]);
    await user.keyboard('{Escape}');
    await frames();
    expect(useLayout.getState().overviewOpen).toBe(false);
    expect(covers()).toEqual([true, false, true, false]);
  });

  it('updates native placement when a sheet opens at an already narrow window, without requiring a resize', async () => {
    setWidth(600);
    renderShell();
    await frames();
    expect(mainPlaces().at(-1)!.rect).not.toBeNull();
    openSurface('browser');
    await frames();
    expect(mainPlaces().at(-1)).toMatchObject({ rect: null, claim: false });
    expect(main.callsOf('browser.view.place').filter((call) => call.surface === 'panel').at(-1)).toMatchObject({ tabId: T2, claim: true, rect: { width: 500 } });
    expect(covers()).toEqual([]);
  });

  it.each(['Escape', 'backdrop'] as const)('keeps a narrow Browser sheet live across %s dismissal and reopening, releasing only the occluded main view', async (dismissal) => {
    const user = userEvent.setup();
    renderShell();
    await frames();
    const originalPane = mainPlaces()[0]!.paneId;
    openSurface('review');
    await frames();
    expect(mainPlaces().at(-1)!.rect).not.toBeNull(); // docked surfaces do not cover main
    act(() => setWidth(600));
    await frames();
    expect(mainPlaces().at(-1)).toMatchObject({ paneId: originalPane, rect: null, claim: false });
    openSurface('browser');
    await frames();
    expect(main.callsOf('browser.view.place').filter((call) => call.surface === 'panel').at(-1)).toMatchObject({ tabId: T2, claim: true, rect: { width: 500 } });
    expect(covers()).toEqual([]); // a blanket cover would freeze the very sheet the person opened
    if (dismissal === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: 'Close surface sheet' }));
    await frames();
    expect(screen.queryByRole('button', { name: 'Close surface sheet' })).toBeNull();
    expect(mainPlaces().at(-1)).toMatchObject({ paneId: originalPane, claim: true, rect: { width: 500 } });
    expect(main.callsOf('browser.view.place').filter((call) => call.surface === 'panel').at(-1)).toMatchObject({ tabId: T2, rect: null, claim: false });
    expect(covers()).toEqual([]);
    act(() => useLayout.getState().setPanel({ collapsed: false }));
    await frames();
    expect(screen.getByRole('button', { name: 'Close surface sheet' })).toBeTruthy();
    expect(mainPlaces().at(-1)).toMatchObject({ paneId: originalPane, rect: null, claim: false });
    expect(main.callsOf('browser.view.place').filter((call) => call.surface === 'panel').at(-1)).toMatchObject({ tabId: T2, claim: true, rect: { width: 500 } });
    expect(covers()).toEqual([]);
  });
});
