// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, R3, N3.1 to N3.9, S3; Interfaces §D): a web
// link out of a session's transcript or terminal. A loopback http(s) link of a session on this Mac opens in that session's
// in-app browser, with no forward; ⌘ in a transcript leaves it to the system browser; a link of another machine's session
// is forwarded or refused as before, ⌘ or not; every other link is left to its surface.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf, bareOf } from '@shared/machine/address';
import { record } from '../../../../../test/support/builders';
import { at, OTHER_MACHINE } from '../../../../../test/support/machine';
import { registerPanelTool } from '../../panel/host';
import { useLayout } from '../../stores/layout';
import { activeTab, sessionOfTab } from '../../stores/layout-model';
import { useMachines } from '../../stores/machines';
import { useNotices } from '../../stores/notices';
import { useSessions } from '../../stores/sessions';
import { browserTab, T1 } from '../../test-support/browser';
import { deferred, installFakeMain, ok } from '../../test-support/code';
import { A, B, C, panelOf, resetPanelStores } from '../../test-support/panel';
import { browserTool } from './BrowserTool';
import { BROWSER_COPY } from './copy';
import { COMMENT_COPY } from './comment/copy';
import { resetForwards } from './forward';
import { isLocalWebLink, openLinkInApp, openWebLink } from './local-link';

const R = addressOf(OTHER_MACHINE, 'session-r' as AppSessionId); // a session MAWS runs on another machine
const THREAD = at('side-thread' as AppSessionId);
const LOCAL = 'http://localhost:5173/';

// The loopback http(s) links the child's file names (`isLoopbackLink`), not only the forwardable ones.
const LOOPBACK = ['http://localhost:5173/', 'https://localhost/app', 'http://app.localhost:3000/', 'http://127.0.0.2:8080/', 'http://0.0.0.0:3000/', 'http://[::1]:5173/', 'http://[::]:8000/', 'http://[::ffff:127.0.0.1]:3000/', 'HTTP://LOCALHOST:5173/'];
// N3.1: a loopback name that is not the host
const LOOKALIKE = ['http://localhost.example.com/', 'http://127.0.0.1.example.com/', 'http://localhost:3000@example.com/', 'https://example.com/?u=http://localhost:3000'];
// N3.2: a loopback host under another scheme (a terminal passes any scheme to its forwarder)
const OTHER_SCHEME = ['ftp://localhost/', 'ws://127.0.0.1:9/', 'file:///a'];

let main: ReturnType<typeof installFakeMain>;
// The forward's answer, held by a test until it releases it; null answers at once
let tunnel: ReturnType<typeof deferred<ReturnType<typeof ok>>> | null = null;
const browserTabs = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((t) => t.toolId === browserTool.id);
const toasts = () => useNotices.getState().notices.map((n) => n.text);
const sent = () => main.calls.map(({ name }) => name);

beforeEach(() => {
  resetPanelStores();
  useNotices.setState({ notices: [] });
  const records = new Map(useSessions.getState().records);
  records.set(THREAD, { ...record(THREAD), lineage: { kind: 'side-thread', parentAppSessionId: B, parentEngineSessionId: null, openedBy: 'comment' } });
  useSessions.setState({ records });
  useMachines.setState({ machines: new Map([[OTHER_MACHINE, { name: 'mini' } as MachineState]]) });
  registerPanelTool(browserTool);
  main = installFakeMain((name, input) => {
    if (name === 'browser.tabs.open') return ok({ tab: browserTab(T1, input.appSessionId as AppSessionId, { url: input.url as string }), reused: false });
    if (name === 'remote.forward.open') return tunnel?.promise ?? ok({ localPort: 54321 });
    return ok();
  });
});
afterEach(() => {
  tunnel = null;
  resetForwards();
  useMachines.setState({ machines: new Map() });
  delete (window as { maws?: unknown }).maws;
});

describe('isLocalWebLink', () => {
  it.each(LOOPBACK)('answers true for an http(s) link to a loopback host: %s', (url) => {
    expect(isLocalWebLink(url)).toBe(true);
  });

  it.each([...LOOKALIKE, ...OTHER_SCHEME, 'https://example.com/', 'not a url', ''])('answers false for any other link: %s', (url) => {
    expect(isLocalWebLink(url)).toBe(false);
    expect(isLocalWebLink(LOCAL)).toBe(true); // the control, read by the same test
  });
});

describe('openLinkInApp, a session on this Mac', () => {
  it.each(LOOPBACK)('opens a loopback link in the session’s in-app browser, with no forward and nothing for the system browser: %s', (url) => {
    expect(openLinkInApp(A, url)).toBe(true);
    expect(browserTabs(A)).toHaveLength(1);
    expect(panelOf(A)!.activeTabId).toBe(browserTabs(A)[0]!.id);
    expect(main.callsOf('browser.tabs.open')).toHaveLength(1);
    expect(main.callsOf('browser.tabs.open')[0]).toMatchObject({ appSessionId: bareOf(A), select: true, reuse: 'url' });
    expect(sent()).toEqual(['browser.tabs.open']); // no remote.forward.open, no layout.openExternal
    expect(toasts()).toEqual([]);
  });

  // decision 14: a terminal's forwarder passes no option, so its ⌘-click on a printed loopback address opens in the app
  it('opens a terminal’s link to 127.0.0.1 in the in-app browser, since the terminal passes no option', () => {
    expect(openLinkInApp(A, 'http://127.0.0.1:4000/')).toBe(true);
    expect(main.callsOf('browser.tabs.open')).toEqual([{ appSessionId: bareOf(A), url: 'http://127.0.0.1:4000/', select: true, reuse: 'url' }]);
  });

  it.each([...LOOKALIKE, ...OTHER_SCHEME, 'https://example.com/'])('leaves any other link to its surface (N3.1, N3.2): %s', (url) => {
    expect(openLinkInApp(A, url)).toBe(false);
    expect(browserTabs(A)).toEqual([]);
    expect(sent()).toEqual([]);
    expect(openLinkInApp(A, LOCAL)).toBe(true); // the control: the loopback form is taken by the same reader
    expect(browserTabs(A)).toHaveLength(1);
  });

  it('leaves a loopback link held with ⌘ to the system browser (N3.5)', () => {
    expect(openLinkInApp(A, LOCAL, { external: true })).toBe(false);
    expect(browserTabs(A)).toEqual([]);
    expect(sent()).toEqual([]);
    expect(openLinkInApp(A, LOCAL, { external: false })).toBe(true); // the control
  });

  it('opens a side thread’s link in its parent’s browser (N3.7)', () => {
    expect(openLinkInApp(THREAD, LOCAL)).toBe(true);
    expect(main.callsOf('browser.tabs.open')).toEqual([{ appSessionId: bareOf(B), url: LOCAL, select: true, reuse: 'url' }]);
    expect(browserTabs(THREAD)).toEqual([]);
    expect(browserTabs(B)).toHaveLength(1);
  });

  // S3: the link's session is not the one shown; the tab joins its panel, unactivated, and a line says where
  it('adds the tab to a session not in view without bringing it forward, and says where it opened (S3)', () => {
    expect(openLinkInApp(C, LOCAL)).toBe(true);
    expect(browserTabs(C)).toHaveLength(1);
    expect(panelOf(C)!.activeTabId).not.toBe(browserTabs(C)[0]!.id);
    expect(sessionOfTab(activeTab(useLayout.getState().main))).toBe(A);
    expect(toasts()).toEqual([COMMENT_COPY.openedElsewhere(C)]);
  });
});

describe('openLinkInApp, a session on another machine', () => {
  it.each([undefined, { external: true }])('forwards a forwardable loopback link, ⌘ or not (N3.4): %o', (options) => {
    expect(openLinkInApp(R, 'http://localhost:3000/', options)).toBe(true);
    expect(main.callsOf('remote.forward.open')).toEqual([{ machine: OTHER_MACHINE, port: 3000 }]);
    expect(browserTabs(R)).toHaveLength(1);
    expect(main.callsOf('layout.openExternal')).toEqual([]);
  });

  // The forward to its end: nothing opens while the tunnel is out; once it answers, the page opens once, at its listener
  it.each([undefined, { external: true }])('opens a forwarded link once, at the listener the forward answers, and never directly: %o', async (options) => {
    tunnel = deferred<ReturnType<typeof ok>>();
    expect(openLinkInApp(R, 'http://localhost:3000/app?x=1', options)).toBe(true);
    expect(main.callsOf('remote.forward.open')).toEqual([{ machine: OTHER_MACHINE, port: 3000 }]);
    await new Promise((resolve) => setTimeout(resolve, 0)); // the tool's open is under way and waits on the forward
    expect(main.callsOf('browser.tabs.open')).toEqual([]);
    tunnel.resolve(ok({ localPort: 61234 }));
    await vi.waitFor(() => expect(main.callsOf('browser.tabs.open')).toHaveLength(1));
    expect(main.callsOf('browser.tabs.open')[0]).toMatchObject({ url: 'http://127.0.0.1:61234/app?x=1', select: true, reuse: 'url' });
    expect(main.callsOf('layout.openExternal')).toEqual([]);
    expect(sent()).toEqual(['remote.forward.open', 'browser.tabs.open']);
  });

  // N3.3: the local branch would open these in R's browser; it reads the session's machine, so it never runs for R
  it.each([
    ['http://app.localhost:3000/', undefined],
    ['http://127.0.0.2/', undefined],
    ['http://app.localhost:3000/', { external: true }],
    ['http://127.0.0.2/', { external: true }],
  ])('refuses a loopback link that cannot be forwarded with the forward’s line, and neither browser opens it (N3.3): %s %o', (url, options) => {
    expect(openLinkInApp(R, url, options)).toBe(true);
    expect(browserTabs(R)).toEqual([]);
    expect(sent()).toEqual([]);
    expect(toasts()).toEqual([BROWSER_COPY.forwarded.refused('mini')]);
    expect(openLinkInApp(A, url)).toBe(true); // the control: the same link of a session on this Mac opens in its browser
    expect(browserTabs(A)).toHaveLength(1);
  });

  it('leaves a link that is not loopback to its surface', () => {
    expect(openLinkInApp(R, 'https://example.com/')).toBe(false);
    expect(sent()).toEqual([]);
    expect(browserTabs(R)).toEqual([]);
    expect(openLinkInApp(R, 'http://localhost:3000/')).toBe(true); // the control: the same session's loopback link is taken
    expect(sent()).toEqual(['remote.forward.open']);
  });
});

// A session id that is no address names no machine: no mounted route passes one (a transcript's store key and a
// terminal's session are addresses), so the decision takes nothing of it and the surface opens the link as before
describe('openLinkInApp, an id that is no address', () => {
  it('leaves even a loopback link to its surface, and sends nothing', () => {
    expect(openLinkInApp('app-bare' as AppSessionId, LOCAL)).toBe(false);
    expect(sent()).toEqual([]);
    expect(openLinkInApp(A, LOCAL)).toBe(true); // the control: the same link of an addressed session on this Mac
    expect(sent()).toEqual(['browser.tabs.open']);
  });
});

// The transcript's opener, as App.tsx registers it: the one decision first, else the host's default (layout.openExternal,
// told the session's machine)
describe('openWebLink', () => {
  it('asks layout.openExternal once, and opens no Browser tab, for a loopback link held with ⌘ (N3.5)', () => {
    openWebLink(LOCAL, A, { external: true });
    expect(main.callsOf('layout.openExternal')).toEqual([{ url: LOCAL }]);
    expect(main.callsOf('browser.tabs.open')).toEqual([]);
    expect(browserTabs(A)).toEqual([]);
  });

  it('opens a loopback link without ⌘ in the in-app browser and asks nothing of the system browser', () => {
    openWebLink(LOCAL, A);
    expect(main.callsOf('layout.openExternal')).toEqual([]);
    expect(browserTabs(A)).toHaveLength(1);
  });

  it('asks layout.openExternal once for any other web link, ⌘ or not', () => {
    openWebLink('https://example.com/', A);
    openWebLink('https://example.com/', A, { external: true });
    expect(main.callsOf('layout.openExternal')).toEqual([{ url: 'https://example.com/' }, { url: 'https://example.com/' }]);
    expect(browserTabs(A)).toEqual([]);
  });

  it('asks layout.openExternal, as today, for a link with no session (N3.6)', () => {
    openWebLink(LOCAL, null);
    openWebLink(LOCAL);
    expect(main.callsOf('layout.openExternal')).toEqual([{ url: LOCAL }, { url: LOCAL }]);
    expect(main.callsOf('browser.tabs.open')).toEqual([]);
  });

  it('tells main the session’s machine for another machine’s link it does not take, and forwards one it does', () => {
    openWebLink('https://example.com/', R);
    expect(main.callsOf('layout.openExternal')).toEqual([{ url: 'https://example.com/' }]);
    expect(main.targetsOf('layout.openExternal')).toEqual([OTHER_MACHINE]);
    openWebLink('http://localhost:3000/', R, { external: true });
    expect(main.callsOf('layout.openExternal')).toHaveLength(1);
    expect(main.callsOf('remote.forward.open')).toEqual([{ machine: OTHER_MACHINE, port: 3000 }]);
  });
});
