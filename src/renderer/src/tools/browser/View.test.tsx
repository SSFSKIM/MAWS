// U12a (the UX wave's U12, l9-browser-delivery-06; Interfaces §D; review finding 4): one tab shown by two mounts at once,
// a main tab and the panel at unequal widths. The room a device size must fit is one mount's: the pane that holds the
// view tells its own surface, whose chrome offers the sizes and draws the chip by that room alone; the other offers none.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { at } from '../../../../../test/support/machine';
import { browserTab, T1 } from '../../test-support/browser';
import { installFakeMain, ok } from '../../test-support/code';
import { BROWSER_COPY } from './copy';
import { resetCovering } from './covering';
import { connectBrowser, resetBrowser } from './store';
import { BrowserView } from './View';

const MAIN_A = 'app-a' as AppSessionId; // main's bare id; the page's is its address
const A = at(MAIN_A);
const TABLET = { width: 768, height: 1024 };
// each surface's page box, as the window lays them out: the panel 400 wide at the right, a main tab 1000 wide
const ROOMS = { panel: { left: 1200, top: 80, right: 1600, bottom: 980 }, main: { left: 0, top: 80, right: 1000, bottom: 980 } };

let main: ReturnType<typeof installFakeMain>;
let disconnect: () => void;
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const listed = (over: Partial<BrowserTab> = {}) => browserTab(T1, MAIN_A, { viewport: TABLET, ...over });

beforeEach(() => {
  resetBrowser();
  resetCovering();
  main = installFakeMain((name) => (name === 'browser.tabs.list' ? ok({ tabs: [listed()], selected: { [MAIN_A]: T1 } }) : ok()));
  disconnect = connectBrowser();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const surface = this.closest('[data-browser-view]')?.getAttribute('data-browser-view') as keyof typeof ROOMS | undefined;
    const r = surface && this.matches('[data-browser-page-box], [data-browser-pane]') ? ROOMS[surface] : { left: 0, top: 0, right: 0, bottom: 0 };
    return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r } as DOMRect;
  });
});
afterEach(() => {
  disconnect();
  cleanup();
  resetCovering();
  vi.restoreAllMocks();
});

const viewOf = (surface: 'panel' | 'main') => document.querySelector<HTMLElement>(`[data-browser-view="${surface}"]`)!;
const chipOf = (surface: 'panel' | 'main') => viewOf(surface).querySelector<HTMLElement>('[data-browser-viewport-chip]');
const paneIdOf = (surface: 'panel' | 'main') => main.callsOf('browser.view.place').find((call) => call.surface === surface)!.paneId as string;
const placedIn = (surface: 'panel' | 'main') => act(() => main.emit('browser.tabs.changed', { appSessionId: MAIN_A, tabs: [listed({ placedIn: { paneId: paneIdOf(surface), surface } })], selected: T1 }));

// What a surface's options menu offers: whether Viewport is enabled, and Tablet's state inside it when it is.
async function offered(user: ReturnType<typeof userEvent.setup>, surface: 'panel' | 'main') {
  await user.click(within(viewOf(surface)).getByRole('button', { name: BROWSER_COPY.options }));
  const viewport = await screen.findByRole('menuitem', { name: BROWSER_COPY.menu.viewport });
  let tablet: string | null = null;
  if (viewport.getAttribute('aria-disabled') !== 'true') {
    await user.click(viewport);
    const item = (await screen.findAllByRole('menuitemradio')).find((candidate) => candidate.getAttribute('data-viewport') === 'tablet')!;
    tablet = item.getAttribute('aria-disabled') === 'true' ? item.textContent : 'enabled';
    await user.keyboard('{Escape}');
  }
  await user.keyboard('{Escape}');
  return tablet;
}

describe('one tab in a main tab and in the panel at unequal widths (U12a)', () => {
  it('the mount holding the view offers and reads by its own room; the other offers no size, and after Show here the two swap', async () => {
    const user = userEvent.setup();
    const panel = render(<BrowserView appSessionId={A} surface="panel" />);
    render(<BrowserView appSessionId={A} surface="main" browserTabId={T1} />);
    await settle();
    await settle();
    placedIn('panel');
    await settle();

    // the panel holds the view: 400 points of room, so Tablet does not fit there, whatever the main tab's 1000
    expect(await offered(user, 'panel')).toBe(`${BROWSER_COPY.viewport.tablet}${BROWSER_COPY.viewport.tooWide}`);
    expect(chipOf('panel')!.textContent).toBe('400 × 900');
    expect(await offered(user, 'main')).toBeNull(); // Viewport disabled: this mount has no room
    expect(chipOf('main')).toBeNull();

    // Show here in the main tab: that mount reads its own room now, and the panel has none
    fireEvent.click(within(viewOf('main')).getByRole('button', { name: BROWSER_COPY.showHere }));
    placedIn('main');
    await settle();
    expect(await offered(user, 'main')).toBe('enabled');
    expect(chipOf('main')!.textContent).toBe('768 × 900');
    expect(await offered(user, 'panel')).toBeNull();
    expect(chipOf('panel')).toBeNull();

    // the panel, which gave the view up, unmounting changes nothing in the main tab
    panel.unmount();
    await settle();
    expect(chipOf('main')!.textContent).toBe('768 × 900');
    expect(await offered(user, 'main')).toBe('enabled');
  });
});
