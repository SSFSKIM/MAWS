// E4a (Task 3.1): the Browser tool (X5) and the `browser` main tab (X14). `open` with a target opens (or reuses) a tab
// of the named session through main, with the request's id; with a tab id it selects that tab; with nothing it leaves
// the session's own state. The body lists its session on mount (Decision Log 44 (a)); a main tab whose tab main no
// longer knows shows the session's browser headed "That tab was closed" (Decision Log 21).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import type { PanelToolContext } from '../../panel/tool';
import { browserTab, T1, T2 } from '../../test-support/browser';
import { installFakeMain, ok } from '../../test-support/code';
import { BrowserHandle, browserTool } from './BrowserTool';
import { BrowserTab } from './BrowserTab';
import { BROWSER_COPY } from './copy';
import { browser, resetBrowser } from './store';
import { addressOf } from '@shared/machine/address';
import { OTHER_MACHINE } from '../../../../../test/support/machine';
import { forwards, resetForwards } from './forward';
import type { MachineState } from '@shared/ipc/schema/machines';
import { useMachines } from '../../stores/machines';

// P5 O6 M2: the page's ids are addresses; main (installFakeMain) is asked and answers with the bare MAIN_A and MAIN_B.
const MAIN_A = 'app-a' as AppSessionId;
const MAIN_B = 'app-b' as AppSessionId;
const A = at(MAIN_A);
const B = at(MAIN_B);

const ctxOf = (appSessionId: AppSessionId | null): PanelToolContext => ({
  appSessionId,
  session: null,
  status: null,
  pinned: false,
  visible: true,
  focusRequest: 0,
  setTitle: () => {},
  close: () => {},
  openTool: () => '',
  editorHost: { surface: 'panel', tabId: 'browser:test' },
});

describe('BrowserHandle.open', () => {
  let fake: FakeClient;
  beforeEach(() => {
    fake = fakeClient({ 'browser.tabs.open': { tab: browserTab(T1, A), reused: false }, 'browser.tabs.select': undefined });
  });

  it('a target opens or reuses a tab of the session, selected, as parsed, with the request id', () => {
    new BrowserHandle(A, { target: 'https://Example.com/a', requestId: 'r1' }, fake.client);
    expect(fake.invoked('browser.tabs.open')).toEqual([{ appSessionId: A, url: 'https://example.com/a', select: true, reuse: 'url', requestId: 'r1' }]);
  });

  it('a target for another session opens there, not in the session the handle showed (a pinned tool; P-21)', () => {
    const handle = new BrowserHandle(A, undefined, fake.client);
    handle.open({ target: 'https://example.com/b', appSessionId: B });
    expect(fake.invoked('browser.tabs.open')).toEqual([{ appSessionId: B, url: 'https://example.com/b', select: true, reuse: 'url' }]);
    expect(handle.appSessionId).toBe(B);
  });

  it('a tab id selects that tab in its session', () => {
    const handle = new BrowserHandle(A, undefined, fake.client);
    handle.open({ tabId: T2 });
    expect(fake.invoked('browser.tabs.select')).toEqual([{ appSessionId: A, tabId: T2 }]);
  });

  it('a tab id selects in the session the store lists the tab under, not the session the handle was made for', () => {
    resetBrowser();
    browser.setState({ sessions: new Map([[B, { tabs: [browserTab(T2, B)], selected: null }]]) });
    const handle = new BrowserHandle(A, undefined, fake.client);
    handle.open({ tabId: T2 });
    expect(fake.invoked('browser.tabs.select')).toEqual([{ appSessionId: B, tabId: T2 }]);
    resetBrowser();
  });

  // P5 O7 M3: a loopback link of another machine's session, routed here with its forward
  it('a target with a forward opens the forward on this app, then the page on its local port in the session', async () => {
    const R = addressOf(OTHER_MACHINE, 'session-r' as AppSessionId);
    const forward = { machine: OTHER_MACHINE, port: 5173 };
    new BrowserHandle(A, { target: 'http://localhost:5173/app', forward, appSessionId: R, requestId: 'r2' }, fake.client);
    expect(fake.invoked('remote.forward.open')).toEqual([forward]);
    expect(fake.invoked('browser.tabs.open')).toEqual([]);
    await fake.reply('remote.forward.open', { localPort: 54321 });
    expect(fake.invoked('browser.tabs.open')).toEqual([{ appSessionId: R, url: 'http://127.0.0.1:54321/app', select: true, reuse: 'url', requestId: 'r2' }]);
    resetForwards();
  });

  it('nothing, a refused target, or no session at all sends nothing', () => {
    const handle = new BrowserHandle(A, undefined, fake.client);
    handle.open(undefined);
    handle.open({});
    handle.open({ target: 'javascript:alert(1)' });
    new BrowserHandle(null, { target: 'https://example.com/' }, fake.client);
    expect(fake.calls).toEqual([]);
  });
});

describe('the tool and the main tab', () => {
  let main: ReturnType<typeof installFakeMain>;
  beforeEach(() => {
    resetBrowser();
    main = installFakeMain((name, input) => {
      if (name === 'browser.tabs.list') return ok({ tabs: input.appSessionId === MAIN_A ? [browserTab(T1, MAIN_A)] : [], selected: { [String(input.appSessionId)]: input.appSessionId === MAIN_A ? T1 : null } });
      if (name === 'remote.forward.open') return ok({ localPort: 54321 }); // P5 O7 M3
      return ok();
    });
  });
  afterEach(() => cleanup());

  it('is declared as X5 asks: single-instance, pinnable, offered from "+"', () => {
    expect(browserTool).toMatchObject({ id: 'browser', title: BROWSER_COPY.title, pinnable: true, multiInstance: false, menu: true });
  });

  it('with no session shown: the no-session line, nothing listed', () => {
    const Body = browserTool.render;
    render(<Body state={new BrowserHandle(null, undefined)} ctx={ctxOf(null)} />);
    expect(screen.getByText(BROWSER_COPY.noSession)).toBeTruthy();
    expect(main.callsOf('browser.tabs.list')).toEqual([]);
  });

  it('lists the shown session on mount, and again for the next session shown', async () => {
    const Body = browserTool.render;
    const state = new BrowserHandle(A, undefined);
    const { rerender } = render(<Body state={state} ctx={ctxOf(A)} />);
    await act(async () => {});
    expect(main.callsOf('browser.tabs.list')).toEqual([{ appSessionId: MAIN_A }]);
    expect(browser.getState().sessions.get(A)?.selected).toBe(T1);
    rerender(<Body state={state} ctx={ctxOf(B)} />);
    await act(async () => {});
    expect(main.callsOf('browser.tabs.list')).toEqual([{ appSessionId: MAIN_A }, { appSessionId: MAIN_B }]);
  });

  // P5 O7 M3: a refused forward, in place of the pane while the tab it was over stays selected
  it('in the panel, a refused forward says why in the machine’s name, with Try again and Dismiss, over its tab only', async () => {
    useMachines.setState({ machines: new Map([[OTHER_MACHINE, { name: 'mini' } as MachineState]]) });
    const refused = (selected: string | null) =>
      forwards.setState({
        failures: new Map([[A, { url: 'http://localhost:5173/', forward: { machine: OTHER_MACHINE, port: 5173 }, error: { code: 'internal', message: 'x', issues: { refusal: 'grade' } }, selected }]]),
      });
    const Body = browserTool.render;
    refused(T1);
    render(<Body state={new BrowserHandle(A, undefined)} ctx={ctxOf(A)} />);
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Couldn’t open port 5173 on mini' })).toBeTruthy();
    expect(screen.getByText('This Mac isn’t allowed to open ports on mini')).toBeTruthy();
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: BROWSER_COPY.forwarded.tryAgain })));
    expect(main.callsOf('remote.forward.open')).toEqual([{ machine: OTHER_MACHINE, port: 5173 }]);
    expect(screen.queryByRole('heading', { name: 'Couldn’t open port 5173 on mini' })).toBeNull(); // opened: the pane is back
    act(() => refused(T1));
    act(() => void fireEvent.click(screen.getByRole('button', { name: BROWSER_COPY.forwarded.dismiss })));
    expect(document.querySelector('[data-browser-page="forward-failed"]')).toBeNull();
    act(() => refused(T2)); // over a tab no longer selected
    expect(document.querySelector('[data-browser-page="forward-failed"]')).toBeNull();
    resetForwards();
    useMachines.setState({ machines: new Map() });
  });

  // P5 O7 M3c fix wave 1: the app-wide list is this Mac's sessions only, so another machine's main tab is gone only once
  // its own session's list says so
  it('a main tab of another machine’s session is not called closed while its session’s list is out', async () => {
    const R = addressOf(OTHER_MACHINE, 'session-r' as AppSessionId);
    browser.setState({ ready: true });
    main = installFakeMain((name) => (name === 'browser.tabs.list' ? new Promise(() => {}) : ok()));
    render(<BrowserTab tab={{ id: `browser:${R}:${T2}`, kind: 'browser', appSessionId: R, browserTabId: T2, pinned: false }} />);
    await act(async () => {});
    expect(main.callsOf('browser.tabs.list')).toHaveLength(1);
    expect(screen.queryByText(BROWSER_COPY.tabGone)).toBeNull();
  });

  it('a main tab whose tab is gone is headed “That tab was closed”; one that exists is not', async () => {
    render(<BrowserTab tab={{ id: `browser:${A}:${T2}`, kind: 'browser', appSessionId: A, browserTabId: T2, pinned: false }} />);
    await act(async () => {});
    expect(screen.getByText(BROWSER_COPY.tabGone)).toBeTruthy();
    cleanup();
    render(<BrowserTab tab={{ id: `browser:${A}:${T1}`, kind: 'browser', appSessionId: A, browserTabId: T1, pinned: false }} />);
    await act(async () => {});
    expect(screen.queryByText(BROWSER_COPY.tabGone)).toBeNull();
  });
});
