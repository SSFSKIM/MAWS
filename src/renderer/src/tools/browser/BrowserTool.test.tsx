// E4a (Task 3.1): the Browser tool (X5) and the `browser` main tab (X14). `open` with a target opens (or reuses) a tab
// of the named session through main, with the request's id; with a tab id it selects that tab; with nothing it leaves
// the session's own state. The body lists its session on mount (Decision Log 44 (a)); a main tab whose tab main no
// longer knows shows the session's browser headed "That tab was closed" (Decision Log 21).
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import type { PanelToolContext } from '../../panel/tool';
import { browserTab, T1, T2 } from '../../test-support/browser';
import { installFakeMain, ok } from '../../test-support/code';
import { BrowserHandle, browserTool } from './BrowserTool';
import { BrowserTab } from './BrowserTab';
import { BROWSER_COPY } from './copy';
import { browser, resetBrowser } from './store';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;

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
      if (name === 'browser.tabs.list') return ok({ tabs: input.appSessionId === A ? [browserTab(T1, A)] : [], selected: { [String(input.appSessionId)]: input.appSessionId === A ? T1 : null } });
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
    expect(main.callsOf('browser.tabs.list')).toEqual([{ appSessionId: A }]);
    expect(browser.getState().sessions.get(A)?.selected).toBe(T1);
    rerender(<Body state={state} ctx={ctxOf(B)} />);
    await act(async () => {});
    expect(main.callsOf('browser.tabs.list')).toEqual([{ appSessionId: A }, { appSessionId: B }]);
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
