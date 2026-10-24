import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
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
  // happy-dom has no layout; provide the real native pane's measured boundary only.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rect = this.matches('[data-browser-pane]') ? { x: 30, y: 90, width: 500, height: 400 } : { x: 0, y: 0, width: 0, height: 0 };
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

  it('does not let an Overview hidden behind the sheet freeze its Browser surface', async () => {
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
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    await frames();
    expect(covers()).toEqual([true, false, true]);
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

  it('releases only the occluded main view for a narrow sheet, keeps a Browser sheet live, and restores main placement when closed', async () => {
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
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    await frames();
    expect(mainPlaces().at(-1)).toMatchObject({ paneId: originalPane, claim: true, rect: { width: 500 } });
  });
});
