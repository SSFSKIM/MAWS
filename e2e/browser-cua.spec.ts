// E13 M2's e2e case (cua repository, docs/doperpowers/specs/2026-10-08-maws-in-app-browser-design.md, M2): MAWS's
// primitive server on the real Electron, driven over an app session's socket by the in-repo fake host
// (test/support/cua-fake-host.ts) as cua's host drives it, against a local server on loopback. It replaces the retired
// browser live test as the in-repo proof that the in-app browser can be driven from outside: a tab created unselected
// in the session's panel, a page navigated and read, a click dispatched through the lease, a cross-origin frame's child
// session, the filter, isolation between sessions, one automation owner per tab between two hosts, the agent state
// undone on detach, the emulated Target.closeTarget, and a lease let go when its host disconnects.
// M3's case: takeover and the cursor through a lease (acceptance 8 and 9 through the seam's `sendInput`, `control` and
// `cursorMessages`): the agent's cursor drawn for `cursor.move` and hidden when the lease goes; the person's click takes
// the page, an acting command in the same second is refused within 2 s while a reading one passes, and 3 s after the
// person's last input the same command goes through. Along the way the window hears what the agent did
// (`browser.agent.activity`, acceptance 10's main half): the tab opened, the navigation, a click labelled from the real
// page's node, typing as a count only.
// Runs under `pnpm e2e:browser-cua` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); the launch passes
// MAWS_HARNESS=0 (the product app) and MAWS_E2E_QUIET=1, over a profile under /tmp (a Unix socket path is short).
// The final fix wave's case (the owner's decision; P1 A-54, amended): the Browser panel follows the agent again. In a
// window that shows a seeded session, a lease's reading commands open nothing, its first acting command opens the
// session's Browser tool, and the agent's tab is not selected: the person's tab stays the session's selection.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { connectFakeHost, type FakeHost } from '../test/support/cua-fake-host';
import { browserIn, tabsOf } from './support/browser-scene';
import { launchMaws, type MawsLaunch } from './support/launch';
import { closeScene, launchScene, scratchProject, show } from './support/maws-tools';

test.describe.configure({ timeout: 120_000 });

const A = 'cua-e2e-A';
const B = 'cua-e2e-B';
const MARKER = 'cua-e2e-marker-7f3';

// The page and a cross-origin frame (127.0.0.1 embeds localhost): the frame posts to its parent once its script runs.
function startPages(): Promise<{ origin: string; url(path: string): string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    const html = (body: string) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8">${body}`);
    };
    if (req.url === '/') return html(`<title>cua e2e</title><p id="marker">${MARKER}</p><button id="go" style="position:absolute;left:40px;top:60px;width:120px;height:40px" onclick="document.querySelector('#state').textContent='clicked'">Go</button><p id="state">idle</p>`);
    if (req.url === '/frames.html') return html(`<title>frames</title><p id="frame">waiting</p><script>addEventListener('message', (e) => { document.querySelector('#frame').textContent = String(e.data); });</script><iframe src="http://localhost:${port}/child.html"></iframe>`);
    if (req.url === '/child.html') return html(`<script>parent.postMessage('child-ran:' + location.host, '*');</script>`);
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve({ origin, url: (path) => `${origin}${path}`, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

// The e2e seam's members this case reads (globalThis.__maws_browser under MAWS_E2E=1): cua's server and the agent's
// presence (the person's stand-in, control and the cursor).
interface Seam {
  __maws_browser: {
    cua: { socketPathFor(appSessionId: string): string | null; inspect(): Record<string, { connections: number; held: number; leased: string[] }> };
    agent: {
      control(tabId: string): { control: string } | null;
      lastInputs(tabId: string): { kind: string; source: string }[];
      sendInput(tabId: string, event: Record<string, unknown>): boolean;
      cursorMessages(tabId: string): number;
    };
  };
}
const seam = (maws: MawsLaunch) => ({
  socketPathFor: (appSessionId: string) => maws.app.evaluate((_electron, id) => (globalThis as unknown as Seam).__maws_browser.cua.socketPathFor(id), appSessionId),
  inspect: () => maws.app.evaluate(() => (globalThis as unknown as Seam).__maws_browser.cua.inspect()),
  // a tab the person opens in the session's Browser tool (`browser.tabs.open` from the window, as the address field does)
  open: (appSessionId: string, url: string) =>
    maws.page.evaluate(([id, address]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<{ ok: boolean }> } }).maws.invoke('browser.tabs.open', { appSessionId: id, url: address, select: true }), [appSessionId, url] as const),
  control: (tabId: string) => maws.app.evaluate((_electron, tab) => (globalThis as unknown as Seam).__maws_browser.agent.control(tab)?.control ?? null, tabId),
  inputs: (tabId: string) => maws.app.evaluate((_electron, tab) => (globalThis as unknown as Seam).__maws_browser.agent.lastInputs(tab).map((i) => `${i.kind}/${i.source}`), tabId),
  sendInput: (tabId: string, event: Record<string, unknown>) => maws.app.evaluate((_electron, [tab, input]) => (globalThis as unknown as Seam).__maws_browser.agent.sendInput(tab as string, input as Record<string, unknown>), [tabId, event] as const),
  cursorMessages: (tabId: string) => maws.app.evaluate((_electron, tab) => (globalThis as unknown as Seam).__maws_browser.agent.cursorMessages(tab), tabId),
});

// The CDP helpers a host uses, through the fake host's primitives.
const cdp = (host: FakeHost, tabId: number) => <T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  host.request<T>('debugger.sendCommand', { debuggee: { tabId }, method, params, timeoutMs: 10_000, ...extra });
const evaluate = async (send: ReturnType<typeof cdp>, expression: string) => (await send<{ result: { value: unknown } }>('Runtime.evaluate', { expression, returnByValue: true })).result.value;
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => undefined as T);
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test('a fake cua host drives a session\'s tabs through its socket: create, navigate, read, click, frames, filter, isolation, ownership, reset, close, disconnect', async () => {
  const userData = mkdtempSync('/tmp/mcua-e2e-');
  const pages = await startPages();
  const maws = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1' } });
  const hosts: FakeHost[] = [];
  try {
    const app = seam(maws);
    const path = await app.socketPathFor(A);
    expect(path).toBe(`${userData}/browser/cua/${A}.sock`);
    const host = await connectFakeHost(path!);
    hosts.push(host);
    expect(host.hello).toMatchObject({ extensionId: 'maws', extensionInstanceId: `maws:${A}`, protocolVersion: 1, profileName: 'MAWS' });

    // a tab created unselected (the session's first tab is its selection: nothing else to show), navigated and read
    expect(await app.open(A, pages.url('/'))).toMatchObject({ ok: true });
    const created = await host.request<{ id: number; active: boolean }>('tabs.create', { url: 'about:blank', group: { key: 's', title: 'cua' } });
    expect(created.active).toBe(false);
    expect(await host.request('debugger.attach', { tabId: created.id })).toEqual({ alreadyHeld: false });
    const send = cdp(host, created.id);
    await send('Page.enable');
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }); // as the vendor's attach does: a hidden page takes input
    await send('Page.navigate', { url: pages.url('/') });
    expect(await until(() => evaluate(send, `document.querySelector('#marker')?.textContent`), (v) => v === MARKER)).toBe(MARKER);
    await host.waitFor('tabs.updated', (p) => p.tabId === created.id && String(p.url).startsWith(pages.origin));

    // a click dispatched through the lease, at the button's centre (the parked view is 1280 x 800)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 100, y: 80, button: 'left', clickCount: 1 });
    expect(await until(() => evaluate(send, `document.querySelector('#state').textContent`), (v) => v === 'clicked')).toBe('clicked');
    expect((await app.inspect())[A]).toMatchObject({ connections: 1, held: 0 });

    // the filter
    await expect(send('Browser.getVersion')).rejects.toThrow('Method not allowed: Browser.getVersion');
    await expect(send('Target.createTarget', { url: 'about:blank' })).rejects.toThrow('Method not allowed: Target.createTarget');

    // a cross-origin frame runs, and its child session is reachable
    const listed = await host.request<{ id: number; url: string }[]>('tabs.query');
    const personId = listed.find((t) => t.id !== created.id)!.id;
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await send('Page.navigate', { url: pages.url('/frames.html') });
    expect(await until(() => evaluate(send, `document.querySelector('#frame').textContent`), (v) => typeof v === 'string' && v.startsWith('child-ran:'))).toMatch(/^child-ran:localhost:/);
    const child = await host.waitFor('debugger.event', (p) => p.method === 'Target.attachedToTarget' && (p.params as { targetInfo: { type: string } }).targetInfo.type === 'iframe');
    const childSession = (child.params.params as { sessionId: string }).sessionId;
    expect(await send('Runtime.evaluate', { expression: 'location.host', returnByValue: true }, { sessionId: childSession })).toMatchObject({ result: { value: expect.stringMatching(/^localhost:/) } });

    // another session's socket sees none of A's tabs
    const other = await connectFakeHost((await app.socketPathFor(B))!);
    hosts.push(other);
    expect(await other.request('tabs.query')).toEqual([]);
    await expect(other.request('debugger.attach', { tabId: created.id })).rejects.toThrow(`No tab with id: ${created.id}`);

    // a second host on A's socket cannot take the first's tab
    const second = await connectFakeHost(path!);
    hosts.push(second);
    const secondsView = (await second.request<{ id: number; url: string }[]>('tabs.query')).find((t) => t.url.endsWith('/frames.html'))!;
    await expect(second.request('debugger.attach', { tabId: secondsView.id })).rejects.toThrow('Tab is held by another agent session');

    // detach undoes the agent's state, and the attachment ends with the last lease
    await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
    expect(await evaluate(send, 'innerWidth')).toBe(800);
    await host.request('debugger.detach', { tabId: created.id });
    expect((await app.inspect())[A]).toMatchObject({ leased: [] });
    await host.request('debugger.attach', { tabId: created.id });
    expect(await evaluate(send, 'innerWidth')).toBe(1280); // the parked size, the override gone

    // Target.closeTarget closes the tab through the store; the host hears tabs.removed
    const targets = await host.request<{ targetId: string; tabId: number; type: string }[]>('debugger.getTargets');
    const page = targets.find((t) => t.tabId === created.id && t.type === 'page')!;
    expect(await send('Target.closeTarget', { targetId: page.targetId })).toEqual({ success: true });
    await host.waitFor('tabs.removed', (p) => p.tabId === created.id);
    expect((await host.request<{ id: number }[]>('tabs.query')).map((t) => t.id)).toEqual([personId]);

    // a host that disconnects with a lease: the lease is let go, the tab stays the person's
    const third = await connectFakeHost(path!);
    const blank = await third.request<{ id: number }>('tabs.create', { url: 'about:blank' });
    await third.request('debugger.attach', { tabId: blank.id });
    expect((await app.inspect())[A]!.leased).toHaveLength(1);
    await third.close();
    await expect.poll(async () => (await app.inspect())[A]).toMatchObject({ leased: [], held: 0 });
    expect(await host.request<unknown[]>('tabs.query')).toHaveLength(2);
  } finally {
    for (const host of hosts) await host.close();
    await maws.cleanup();
    await pages.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

test('takeover and the cursor through a lease: cursor.move draws, a screenshot hides it first, the person\'s click takes the page, an acting command is refused within 2 s and a reading one passes, 3 s later the same command goes through, letting go hides the cursor', async () => {
  const userData = mkdtempSync('/tmp/mcua-e2e-');
  const pages = await startPages();
  const maws = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1' } });
  let host: FakeHost | null = null;
  try {
    const app = seam(maws);
    // what the window hears of the agent's activity, as the transcript's store does
    await maws.page.evaluate(() => {
      const w = window as unknown as { __acts: unknown[]; maws: { on(name: string, listener: (payload: unknown) => void): () => void } };
      w.__acts = [];
      w.maws.on('browser.agent.activity', (payload) => void w.__acts.push(payload));
    });
    const heard = () => maws.page.evaluate(() => (window as unknown as { __acts: { appSessionId: string; activity: Record<string, unknown> }[] }).__acts);
    host = await connectFakeHost((await app.socketPathFor(A))!);
    const created = await host.request<{ id: number }>('tabs.create', { url: 'about:blank', group: { key: 's', title: 'cua' } });
    await host.request('debugger.attach', { tabId: created.id });
    const tab = (await app.inspect())[A]!.leased[0]!;
    const send = cdp(host, created.id);
    await send('Page.enable');
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.navigate', { url: pages.url('/') });
    expect(await until(() => evaluate(send, `document.querySelector('#marker')?.textContent`), (v) => v === MARKER)).toBe(MARKER);

    // the cursor: drawn where the agent aims (the vendor's moveMouse), then by the agent's own mouse, the tab the agent's
    const drawn = await app.cursorMessages(tab);
    expect(await host.request('cursor.move', { tabId: created.id, x: 100, y: 80 })).toEqual({});
    await expect.poll(() => app.cursorMessages(tab)).toBeGreaterThan(drawn);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: 80 });
    expect(await app.control(tab)).toBe('agent');

    // an agent's screenshot never carries the cursor's overlay: the cursor is hidden before the capture goes (the spec's
    // "Cursor", M4 fix wave); the agent's next mouse event draws it again
    const shown = await app.cursorMessages(tab);
    expect(await send('Page.captureScreenshot', { format: 'png' })).toHaveProperty('data');
    expect(await app.cursorMessages(tab)).toBe(shown + 1);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: 80 });
    expect(await app.cursorMessages(tab)).toBe(shown + 2);

    // the person clicks the page: theirs at once
    const clickedAt = Date.now();
    expect(await app.sendInput(tab, { type: 'mouseDown', x: 100, y: 80, button: 'left', clickCount: 1 })).toBe(true);
    expect(await app.sendInput(tab, { type: 'mouseUp', x: 100, y: 80, button: 'left', clickCount: 1 })).toBe(true);
    await expect.poll(async () => (await app.inputs(tab)).slice(-2)).toEqual(['mouse/human', 'mouse/human']);
    await expect.poll(() => app.control(tab)).toBe('human');

    // an acting command in the same second: refused within 2 s; a reading one passes and leaves the person the page
    const click = { expression: `document.querySelector('#state').textContent = 'agent'; 1`, returnByValue: true };
    const refusedAt = Date.now();
    await expect(send('Runtime.evaluate', click, { timeoutMs: 3_000 })).rejects.toThrow('A person is using this tab; wait and retry');
    expect(Date.now() - refusedAt).toBeLessThan(2_000);
    expect(await send('Page.captureScreenshot', { format: 'jpeg' })).toHaveProperty('data');
    expect(await app.control(tab)).toBe('human');

    // 3 s after the person's last input the page is handed back, and the same command goes through
    await expect.poll(() => app.control(tab), { timeout: 6_000 }).toBe('idle');
    expect(Date.now() - clickedAt).toBeGreaterThanOrEqual(2_900);
    expect(await evaluate(send, `document.querySelector('#state').textContent`)).toBe('clicked'); // the person's click; the refused command never ran
    expect(await send('Runtime.evaluate', click, { timeoutMs: 3_000 })).toMatchObject({ result: { value: 1 } });
    expect(await evaluate(send, `document.querySelector('#state').textContent`)).toBe('agent');
    expect(await app.control(tab)).toBe('agent');

    // the window heard it all, in order, typed text as a count only
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 100, y: 80, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 100, y: 80, button: 'left', clickCount: 1 });
    await send('Input.insertText', { text: 'secret-e2e-typed' });
    await expect.poll(async () => (await heard()).map((a) => a.activity.kind), { timeout: 5_000 }).toEqual(['tabOpened', 'navigated', 'screenshot', 'screenshot', 'clicked', 'typed']);
    const acts = await heard();
    expect(acts.every((a) => a.appSessionId === A)).toBe(true);
    expect(acts[1]!.activity).toMatchObject({ kind: 'navigated', url: pages.url('/') });
    expect(acts[4]!.activity).toEqual({ kind: 'clicked', x: 100, y: 80, label: 'button Go' });
    expect(acts[5]!.activity).toEqual({ kind: 'typed', chars: 16 });
    expect(JSON.stringify(acts)).not.toContain('secret-e2e-typed');

    // letting go: the tab idle and the cursor hidden
    const before = await app.cursorMessages(tab);
    await host.request('debugger.detach', { tabId: created.id });
    expect(await app.control(tab)).toBe('idle');
    await expect.poll(() => app.cursorMessages(tab)).toBeGreaterThan(before);
  } finally {
    await host?.close();
    await maws.cleanup();
    await pages.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

test('the Browser panel follows the agent: a lease\'s first acting command opens the shown session\'s Browser tool, and the agent\'s tab is not selected', async () => {
  const tmp = process.env.TMPDIR;
  process.env.TMPDIR = '/tmp'; // the scratch profile under /tmp: a Unix socket path is short
  const scratch = scratchProject({ titles: ['E13: the panel follows the agent'], label: 'cua-panel' });
  if (tmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = tmp;
  const pages = await startPages();
  let host: FakeHost | undefined;
  try {
    const s = await launchScene(scratch);
    try {
      const [id] = s.ids as [AppSessionId];
      await show(s, id);
      const app = seam(s.maws);
      const panelBrowser = browserIn(s, 'panel');
      await expect(panelBrowser).toHaveCount(0);

      // the person's tab, the session's selection (opened from the window, as the address field does)
      expect(await app.open(id, pages.url('/'))).toMatchObject({ ok: true });
      const person = (await tabsOf(s, id)).selected;
      expect(person).not.toBeNull();

      host = await connectFakeHost((await app.socketPathFor(id))!);
      const created = await host.request<{ id: number }>('tabs.create', { url: 'about:blank' });
      await host.request('debugger.attach', { tabId: created.id });
      const send = cdp(host, created.id);
      await send('Page.enable'); // reading: the panel stays as it is
      await send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await s.page.waitForTimeout(300);
      await expect(panelBrowser).toHaveCount(0);

      await send('Page.navigate', { url: pages.url('/') }); // the lease's first acting command
      await expect(panelBrowser).toBeVisible();
      const { tabs, selected } = await tabsOf(s, id);
      expect(tabs).toHaveLength(2);
      expect(selected).toBe(person); // the agent's tab is not selected
      await host.close();
      host = undefined;
    } finally {
      await closeScene(s);
    }
  } finally {
    await host?.close();
    await pages.close();
    rmSync(scratch.root, { recursive: true, force: true });
  }
});
