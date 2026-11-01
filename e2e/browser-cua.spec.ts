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
// MAWS_HARNESS=0 (the product app), quiet as every e2e window is, over a profile under /tmp (a Unix socket path is short).
// The final fix wave's case (the owner's decision; P1 A-54, amended): the Browser panel follows the agent again. In a
// window that shows a seeded session, a lease's reading commands open nothing, its first acting command opens the
// session's Browser tool, and the agent's tab is not selected: the person's tab stays the session's selection. Then the
// app restarts over the same profile (cua board #93): the session's activity lists the same as before the quit.
// cua board #98's case: on a leased idle tab the person's own navigations are theirs, never an agent row: ⌘R in the page
// (through the page's input hook) and the chrome's Reload over IPC (through none, which the Navigator now stamps).
// cua board #90's case (its spec's acceptance 11): a person's bookmark click on a leased idle tab of an imported profile
// (`browser.bookmarks.open` from the window) is theirs too: no agent row, and the agent's next acting command within the
// hand-back window is refused as the person's; the agent's own navigation through CDP still makes its row. The profile is
// imported over IPC from the synthetic Chrome fixture (bookmarks only), never the owner's Chrome.
// Socket peer authentication (cua docs/doperpowers/specs/2026-10-09-maws-socket-peer-auth-design.md, M2; Acceptance 5):
// every socket checks its peer, so each scene whose fake host runs in this test process makes the process a trusted root
// after every launch (the seam's `trustRoot`). The sixth scene connects a same-user process reparented to launchd and
// sees it cut off before any hello; the seventh trusts nothing and runs a live session whose engine is a stub
// (test/support/cua-engine-stub.mjs) that starts a connector as its child, which MAWS lets in on the engine's pid from
// the session's status.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { BrowserAgentActivity } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import { connectFakeHost, type FakeHost } from '../test/support/cua-fake-host';
import { invoke, value } from './support/c7-replay';
import { browserIn, tabsOf } from './support/browser-scene';
import { launchMaws, onLaunched, REPO_ROOT, type MawsLaunch } from './support/launch';
import { startProfileDaemon } from './support/profile-daemon'; // P5 O5 M5
import { cuaSocketDir } from '@shared/daemon/files'; // P5 O5 M5
import { daemonCuaSocketPath } from '@shared/browser/cua-socket'; // P5 O5 M5
// P5 O17 M8 start
import { symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { daemonPaths, renderCuaSocketDir } from '@shared/daemon/files';
import { BROWSER_ENGINE_CAPABILITY } from '@shared/host/socket-protocol';
import { reachMachine } from '../src/mawsd/machine-client';
import type { ConnectorControl } from '../test/support/cua-engine';
import { latencyBudgets } from './support/latency';
import { answered, BEFORE_M7, ENGINE_HOST_BROWSER_WORK, PAGE_MARKER, SCREENCAST, startHeadlessScene, startPages as startHeadlessPages, type HeadlessScene } from './support/headless-browser';
// P5 O17 M8 end
import { collectMainOutput } from './support/browser-import-scene';
import { closeScene, launchScene, scratchProject, seedTranscripts, show } from './support/maws-tools';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { FIXTURE_ENGINE_VERSION } from '../test/support/engine-pin';
// cua #90 start
import { profilePartition } from '@shared/browser/tab';
import { buildChromeUserData } from '../test/support/chrome-profile';
// cua #90 end

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
    cua: {
      socketPathFor(appSessionId: string): string | null;
      inspect(): { peerModule: string; sessions: Record<string, { connections: number; held: number; leased: string[]; refused: number }> };
      trustRoot(pid: number): boolean;
    };
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
  inspect: () => maws.app.evaluate(() => (globalThis as unknown as Seam).__maws_browser.cua.inspect().sessions),
  // this test process (where the fake hosts run) made a root every session's socket lets in, after each launch
  trustThisProcess: async () => expect(await maws.app.evaluate((_electron, pid) => (globalThis as unknown as Seam).__maws_browser.cua.trustRoot(pid), process.pid)).toBe(true),
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
  const maws = await launchMaws({ userData, env: { MAWS_HARNESS: '0' } });
  const hosts: FakeHost[] = [];
  try {
    const app = seam(maws);
    await app.trustThisProcess();
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

    // detach undoes the agent's state (answered once the page reads its parked size again), and the attachment ends with the last lease
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
  const maws = await launchMaws({ userData, env: { MAWS_HARNESS: '0' } });
  let host: FakeHost | null = null;
  try {
    const app = seam(maws);
    await app.trustThisProcess();
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

    // cua #103: after 3 s the takeover grace ends, but human ownership stays until the same command resumes
    await maws.page.waitForTimeout(3_100); // exercise expiry without an acting command
    expect(await app.control(tab)).toBe('human');
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

test('the Browser panel follows the agent: a lease\'s first acting command opens the shown session\'s Browser tool, and the agent\'s tab is not selected; after a restart the session\'s activity lists as before', async () => {
  const tmp = process.env.TMPDIR;
  process.env.TMPDIR = '/tmp'; // the scratch profile under /tmp: a Unix socket path is short
  const scratch = scratchProject({ titles: ['E13: the panel follows the agent'], label: 'cua-panel' });
  if (tmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = tmp;
  const pages = await startPages();
  let host: FakeHost | undefined;
  const listed = async (page: Page, id: AppSessionId) => value(await invoke(page, 'browser.agent.activities.list', { appSessionId: id })).activities;
  let before: BrowserAgentActivity[] | undefined;
  try {
    const s = await launchScene(scratch);
    try {
      const [id] = s.ids as [AppSessionId];
      await show(s, id);
      const app = seam(s.maws);
      await app.trustThisProcess();
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
      await expect.poll(async () => (await listed(s.page, id)).map((a) => a.activity.kind)).toEqual(['tabOpened', 'navigated']);
      before = await listed(s.page, id);
    } finally {
      await closeScene(s);
    }
    // cua board #93: what the agent did outlives the app; a restart lists the session's activity as the quit left it
    const again = await launchScene(scratch, s.ids);
    try {
      await seam(again.maws).trustThisProcess();
      const [id] = again.ids as [AppSessionId];
      expect(before).toBeDefined();
      expect(await listed(again.page, id)).toEqual(before);
    } finally {
      await closeScene(again);
    }
  } finally {
    await host?.close();
    await pages.close();
    rmSync(scratch.root, { recursive: true, force: true });
  }
});

test('the person\'s own navigations of a leased idle tab are theirs: ⌘R in the page and Reload from the window make no agent row', async () => {
  const userData = mkdtempSync('/tmp/mcua-e2e-');
  const pages = await startPages();
  const maws = await launchMaws({ userData, env: { MAWS_HARNESS: '0' } });
  let host: FakeHost | null = null;
  try {
    const app = seam(maws);
    await app.trustThisProcess();
    await maws.page.evaluate(() => {
      const w = window as unknown as { __acts: unknown[]; maws: { on(name: string, listener: (payload: unknown) => void): () => void } };
      w.__acts = [];
      w.maws.on('browser.agent.activity', (payload) => void w.__acts.push(payload));
    });
    const kinds = () => maws.page.evaluate(() => (window as unknown as { __acts: { activity: { kind: string } }[] }).__acts.map((a) => a.activity.kind));
    host = await connectFakeHost((await app.socketPathFor(A))!);
    // the page loaded before the lease and read only through it: the tab stays idle, as at the owner's sitting
    const created = await host.request<{ id: number }>('tabs.create', { url: pages.url('/'), group: { key: 's', title: 'cua' } });
    await host.waitFor('tabs.updated', (p) => p.tabId === created.id && p.status === 'complete' && String(p.url).startsWith(pages.origin));
    await host.request('debugger.attach', { tabId: created.id });
    const tab = (await app.inspect())[A]!.leased[0]!;
    const send = cdp(host, created.id);
    await send('Page.enable');
    expect(await app.control(tab)).toBe('idle');
    const committed = () => host!.notifications.filter((n) => n.method === 'debugger.event' && n.params.method === 'Page.frameNavigated').length;

    // ⌘R pressed in the page, as the OS delivers it (keys.ts takes the chord and reloads)
    let before = committed();
    expect(await app.sendInput(tab, { type: 'keyDown', keyCode: 'R', modifiers: ['meta'] })).toBe(true);
    expect(await app.sendInput(tab, { type: 'keyUp', keyCode: 'R', modifiers: ['meta'] })).toBe(true);
    await expect.poll(committed).toBeGreaterThan(before);
    await maws.page.waitForTimeout(300);
    expect(await kinds()).toEqual(['tabOpened']);

    // past the hand-back window, the chrome's Reload (`browser.tabs.navigate` from the window)
    await maws.page.waitForTimeout(3_200);
    before = committed();
    expect(await maws.page.evaluate((id) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke('browser.tabs.navigate', { tabId: id, to: 'reload' }), tab)).toMatchObject({ ok: true, value: { accepted: true } });
    await expect.poll(committed).toBeGreaterThan(before);
    await maws.page.waitForTimeout(300);
    expect(await kinds()).toEqual(['tabOpened']);
    expect(await app.control(tab)).toBe('idle');
  } finally {
    await host?.close();
    await maws.cleanup();
    await pages.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

// cua #90 start
test('a person\'s bookmark click on a leased idle tab is theirs: no agent row, and the agent\'s acting command in the hand-back window is refused; the agent\'s own navigation still makes its row', async () => {
  const userData = mkdtempSync('/tmp/mcua-e2e-');
  const chromeDir = mkdtempSync('/tmp/mcua-chrome-');
  const pages = await startPages();
  const chrome = buildChromeUserData(chromeDir, { bookmarksOrigin: pages.origin });
  const maws = await launchMaws({
    userData,
    env: { MAWS_HARNESS: '0', MAWS_E2E_CHROME_USER_DATA: chrome.dir, MAWS_E2E_KEYCHAIN: `file:${chrome.passwordFile}` },
  });
  let host: FakeHost | null = null;
  try {
    const app = seam(maws);
    await app.trustThisProcess();
    // Default imported with its bookmarks alone, and made the profile new tabs open in
    const { inspectionId } = value(await invoke(maws.page, 'browser.import.inspect', { userDataDir: chrome.dir, profileDir: 'Default' }));
    value(await invoke(maws.page, 'browser.import.start', { inspectionId, categories: { history: false, cookies: false, extensions: false, bookmarks: true }, extensionIds: [], allowUnverifiedExtensions: false }));
    await expect.poll(async () => value(await invoke(maws.page, 'browser.import.list', undefined)).profiles.map((record) => record.bookmarks?.count ?? null), { timeout: 30_000 }).toEqual([46]);
    value(await invoke(maws.page, 'settings.set', { browser: { profile: 'Default' } }));
    const partition = profilePartition('Default');
    const a = value(await invoke(maws.page, 'browser.bookmarks.tree', { partition })).tree.bar.children[0]!;
    expect(a).toMatchObject({ kind: 'url', name: 'A', url: chrome.profiles.Default.bookmarks!.urls.A });

    await maws.page.evaluate(() => {
      const w = window as unknown as { __acts: unknown[]; maws: { on(name: string, listener: (payload: unknown) => void): () => void } };
      w.__acts = [];
      w.maws.on('browser.agent.activity', (payload) => void w.__acts.push(payload));
    });
    const kinds = () => maws.page.evaluate(() => (window as unknown as { __acts: { activity: { kind: string } }[] }).__acts.map((act) => act.activity.kind));
    host = await connectFakeHost((await app.socketPathFor(A))!);
    const created = await host.request<{ id: number }>('tabs.create', { url: pages.url('/'), group: { key: 's', title: 'cua' } });
    await host.waitFor('tabs.updated', (p) => p.tabId === created.id && p.status === 'complete' && String(p.url).startsWith(pages.origin));
    await host.request('debugger.attach', { tabId: created.id });
    const tab = (await app.inspect())[A]!.leased[0]!;
    expect(value(await invoke(maws.page, 'browser.tabs.list', {})).tabs.find((t) => t.tabId === tab)?.partition).toBe(partition);
    const send = cdp(host, created.id);
    await send('Page.enable');
    expect(await app.control(tab)).toBe('idle');
    const committed = () => host!.notifications.filter((n) => n.method === 'debugger.event' && n.params.method === 'Page.frameNavigated').length;

    // the person clicks the bar's A: the tab loads it as theirs
    const before = committed();
    expect(await invoke(maws.page, 'browser.bookmarks.open', { tabId: tab, nodeId: a.id, how: 'current' })).toMatchObject({ ok: true });
    await expect.poll(committed).toBeGreaterThan(before);
    // the agent's acting command in the hand-back window: the takeover gate holds it and refuses it as the person's
    await expect(send('Runtime.evaluate', { expression: `document.title = 'agent'; 1`, returnByValue: true }, { timeoutMs: 3_000 })).rejects.toThrow('A person is using this tab; wait and retry');
    expect(await app.control(tab)).toBe('human');
    expect(await kinds()).toEqual(['tabOpened']); // no agent row for the person's bookmark

    // handed back, the agent's own navigation makes its row
    await maws.page.waitForTimeout(3_100); // exercise expiry without an acting command
    expect(await app.control(tab)).toBe('human');
    await send('Page.navigate', { url: pages.url('/frames.html') });
    await expect.poll(kinds, { timeout: 5_000 }).toEqual(['tabOpened', 'navigated']);
  } finally {
    await host?.close();
    await maws.cleanup();
    await pages.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(chromeDir, { recursive: true, force: true });
  }
});
// cua #90 end


// Socket peer authentication start (cua docs/doperpowers/specs/2026-10-09-maws-socket-peer-auth-design.md, M2)
const CONNECTOR = join(REPO_ROOT, 'test/support/cua-connector.mjs');
const ENGINE_STUB = join(REPO_ROOT, 'test/support/cua-engine-stub.mjs');
type ConnectorReport = { pid: number; hello: Record<string, unknown> | null; closed: boolean };
const reportOf = (path: string): ConnectorReport | null => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ConnectorReport) : null);

// A red in a case that keeps a witness carries its own cause (gate-offload Decision Log 140 (d); the :493 reds had none,
// main's lines never reaching the job log): what the case noted as it went, then main's [browser] lines from launch to
// close, printed once the app has closed and so in full.
let witness: { mainOutput: () => string; noted: string[] } | null = null;
test.afterEach(async () => {
  const kept = witness;
  witness = null;
  const info = test.info();
  if (!kept || info.status === info.expectedStatus) return;
  const lines = kept.mainOutput().split('\n').filter((line) => line.includes('[browser]'));
  const text = [...kept.noted, `main's [browser] lines (${lines.length}):`, ...lines].join('\n');
  console.log(`[browser-cua witness] ${info.titlePath.at(-1)}\n${text}`);
  await info.attach('witness', { body: text, contentType: 'text/plain' });
});

test('a same-user process outside every session\'s tree is cut off before the hello: an orphaned connector is refused, the trusted host keeps its connection', async () => {
  const userData = mkdtempSync('/tmp/mcua-e2e-');
  const work = mkdtempSync('/tmp/mcua-orphan-');
  const kept = (witness = { mainOutput: () => '', noted: [] as string[] });
  const maws = await onLaunched((launched) => (kept.mainOutput = collectMainOutput(launched)), () => launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1' } }));
  let host: FakeHost | null = null;
  try {
    const app = seam(maws);
    await app.trustThisProcess();
    const path = (await app.socketPathFor(A))!;
    host = await connectFakeHost(path);
    const atHello = (await app.inspect())[A];
    kept.noted.push(`read once the hello was heard: ${JSON.stringify(atHello)}; the fake host's socket: ${JSON.stringify(host.socketState())}`);
    if (atHello?.connections !== 1) kept.noted.push(`read again: ${JSON.stringify((await app.inspect())[A])}; the fake host's socket: ${JSON.stringify(host.socketState())}`);
    expect(atHello).toMatchObject({ connections: 1, refused: 0 });

    // a connector started in a subshell that exits at once, so it runs under launchd when it connects (the Terminal's `nc`)
    const report = join(work, 'orphan.json');
    execFileSync('/bin/sh', ['-c', '(sleep 0.2; exec "$0" "$@") &', process.execPath, CONNECTOR, path, report], { stdio: 'ignore' }); // paths as arguments, never pasted
    await expect.poll(() => reportOf(report), { timeout: 10_000 }).toMatchObject({ closed: true });
    expect(reportOf(report)).toMatchObject({ hello: null, closed: true });
    expect((await app.inspect())[A]).toMatchObject({ connections: 1, refused: 1 });
    expect(await host.request('tabs.query')).toEqual([]); // the trusted host is untouched
  } finally {
    await host?.close();
    await maws.cleanup();
    rmSync(userData, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test('with no trusted root, a live session\'s own engine tree is let in: the connector its engine starts hears the hello, on the engine\'s pid from the session\'s status', async () => {
  const root = realpathSync(mkdtempSync('/tmp/mcua-live-'));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  const userData = join(root, 'user-data');
  mkdirSync(repo);
  mkdirSync(userData);
  const [engineSessionId] = seedTranscripts(config, repo, ['the cua engine stub']);
  // the engine binary: a wrapper naming this Node, which the engine host probes with --version and spawns per launch
  const bin = join(root, 'cua-engine');
  const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`; // as test/support/plugin-cli-stub.ts quotes its wrapper
  writeFileSync(bin, `#!/bin/sh\nMAWS_CUA_STUB_VERSION=${quote(FIXTURE_ENGINE_VERSION)} exec ${quote(process.execPath)} ${quote(ENGINE_STUB)} "$@"\n`, { mode: 0o755 });
  const maws = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1', CLAUDE_CONFIG_DIR: config, MAWS_E2E_ENGINE_BIN: bin } });
  try {
    const app = seam(maws); // nothing trusted: only the session's engine is a root
    let id = '';
    await expect
      .poll(async () => (id = value(await invoke(maws.page, 'session.list', {})).sessions.find((s) => s.engineSessionId === engineSessionId)?.appId ?? ''), { timeout: 15_000 })
      .not.toBe('');
    const path = (await app.socketPathFor(id))!;
    const launch = { ...launchDefaults(id as AppSessionId, repo), gateway: 'direct' as const, extraSettings: { env: { CUA_BROWSER_BACKENDS: path } } };
    expect(value(await invoke(maws.page, 'session.launch', { spec: launch }))).toMatchObject({ status: 'launching' });

    const report = join(repo, 'cua-connector.json');
    await expect.poll(() => reportOf(report), { timeout: 15_000 }).toMatchObject({ hello: { extensionInstanceId: `maws:${id}` }, closed: false });
    expect((await app.inspect())[id]).toMatchObject({ connections: 1, refused: 0 });
    // the connector is the engine's child, and the engine is the pid the session's status names
    const enginePid = value(await invoke(maws.page, 'session.status', { appSessionId: id as AppSessionId })).pid;
    expect(enginePid).not.toBeNull();
    expect(Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(reportOf(report)!.pid)], { encoding: 'utf8' }).trim())).toBe(enginePid);
  } finally {
    await maws.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
// Socket peer authentication end

// P5 O5 M5 start (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M5, Interfaces §H; acceptance 3): on the daemon
// shape a launch is told `mawsd`'s own socket for its session, which listens only while a tab engine (the app) is
// attached, checks the engine's peer itself and relays the connection to the app's socket for the session, where the
// app admits `mawsd` by its exact instance. The engine is the stub above, its connector in retry mode
// (MAWS_CUA_CONNECTOR_RETRY=1), which retries an unreachable or lost socket as cua's host does. Nothing is trusted: only
// each session's engine is a root.
type RetryingReport = ConnectorReport & { socket: string; refused: number; hellos: number; closes: number; connected: boolean; leases?: number };
const retryingOf = (path: string) => reportOf(path) as RetryingReport | null;
const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

// A scratch root with a repository, an engine store seeded with `titles`' transcripts and the stub engine's wrapper
function liveRoot(titles: string[], { retry, lease = false }: { retry: boolean; lease?: boolean }) {
  const root = realpathSync(mkdtempSync('/tmp/mcua-d-'));
  const repo = join(root, 'repo');
  const config = join(root, 'claude-config');
  const userData = join(root, 'user-data');
  mkdirSync(repo);
  mkdirSync(userData);
  const engineSessionIds = seedTranscripts(config, repo, titles);
  const bin = join(root, 'cua-engine');
  writeFileSync(bin, `#!/bin/sh\nMAWS_CUA_STUB_VERSION=${quoted(FIXTURE_ENGINE_VERSION)}${retry ? ' MAWS_CUA_CONNECTOR_RETRY=1' : ''}${lease ? ' MAWS_CUA_CONNECTOR_LEASE=1' : ''} exec ${quoted(process.execPath)} ${quoted(ENGINE_STUB)} "$@"\n`, { mode: 0o755 });
  return { root, repo, config, userData, engineSessionIds, bin };
}
// a seeded transcript's session, once the index lists it
type Listed = { sessions: { appId: string; engineSessionId: string | null }[] };
async function sessionOf(list: () => Promise<Listed>, engineSessionId: string): Promise<AppSessionId> {
  let id = '';
  await expect.poll(async () => (id = (await list()).sessions.find((s) => s.engineSessionId === engineSessionId)?.appId ?? ''), { timeout: 30_000, message: 'the seeded session listed' }).not.toBe('');
  return id as AppSessionId;
}
const launchSpec = (id: AppSessionId, repo: string, cuaSocket: string) => ({ ...launchDefaults(id, repo), gateway: 'direct' as const, extraSettings: { env: { CUA_BROWSER_BACKENDS: cuaSocket } } });
const daemonSocketOf = (userData: string, id: AppSessionId) => daemonCuaSocketPath(cuaSocketDir(userData), id)!;
const mawsdLogOf = (userData: string) => (existsSync(join(userData, 'mawsd', 'mawsd.log')) ? readFileSync(join(userData, 'mawsd', 'mawsd.log'), 'utf8') : '');

test('on the daemon shape the engine\'s connector reaches the app through mawsd\'s socket: checked by mawsd against the engine, admitted by the app as mawsd\'s own relay', async () => {
  const live = liveRoot(['the cua engine stub, through mawsd'], { retry: true });
  const maws = await launchMaws({ userData: live.userData, env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1', CLAUDE_CONFIG_DIR: live.config, MAWS_E2E_ENGINE_BIN: live.bin } });
  try {
    const app = seam(maws);
    const id = await sessionOf(async () => value(await invoke(maws.page, 'session.list', {})), live.engineSessionIds[0]!);
    const path = daemonSocketOf(live.userData, id);
    expect(path.startsWith(`${live.userData}/mawsd/cua/`), 'the daemon\'s cua directory').toBe(true);
    expect(value(await invoke(maws.page, 'session.capabilities', { appSessionId: id }))).toMatchObject({ browser: { available: true } });
    // session.launch is the engine host's raw command: the spec names the socket, as the spine's start and resume name
    // its browserSocket (spine-root.ts, launch-mapping.ts; daemon-cua.test.ts pins the daemon's path there)
    expect(value(await invoke(maws.page, 'session.launch', { spec: launchSpec(id, live.repo, path) }))).toMatchObject({ status: 'launching' });

    const report = join(live.repo, 'cua-connector.json');
    await expect.poll(() => retryingOf(report)?.hellos ?? 0, { timeout: 20_000, message: 'the connector hears the hello through the relay' }).toBeGreaterThan(0);
    expect(retryingOf(report)).toMatchObject({ socket: path, hello: { extensionInstanceId: `maws:${id}` }, connected: true });
    expect((await app.inspect())[id]).toMatchObject({ connections: 1, refused: 0 }); // the app let mawsd's relay in
    const enginePid = value(await invoke(maws.page, 'session.status', { appSessionId: id })).pid;
    expect(Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(retryingOf(report)!.pid)], { encoding: 'utf8' }).trim()), 'the connector is the engine\'s child').toBe(enginePid);
    expect(mawsdLogOf(live.userData)).not.toContain(`cua socket of ${id}: refused`);
  } finally {
    await maws.cleanup();
    rmSync(live.root, { recursive: true, force: true });
  }
});

// P5 O17 M8 (fix 1): O17's §I reading with no app. Before O17 M7 no engine host lists host.browserWork, so the session
// reads the old-host reason and nothing listens for it (the route `none`); from M7 it reads the screencast and the broker
// serves cua cold at once. Either way the app's attachment serves it, its quit mid-lease cuts it cleanly, and its
// relaunch serves it again on the same socket: the counts below are read against what the connector had before each.
test('a session launched with no app reads O17’s no-app capability until the app attaches, then is served; the app\'s quit mid-lease cuts it cleanly, and its relaunch serves it again on the same socket', async () => {
  test.setTimeout(240_000);
  const live = liveRoot([], { retry: true, lease: true });
  // the daemon reads its own scratch engine store (<profile>/claude-config): the transcript is seeded there before it starts
  let seeded = '';
  const daemon = await startProfileDaemon({ userData: live.userData, env: { MAWS_E2E_ENGINE_BIN: live.bin }, prepare: ({ claudeConfigDir }) => void ([seeded] = seedTranscripts(claudeConfigDir, live.repo, ['the cua engine stub, before any app'])) });
  const launches: MawsLaunch[] = [];
  const noApp = ENGINE_HOST_BROWSER_WORK ? SCREENCAST : { available: false, reason: expect.stringMatching(/^the engine host on .+ predates browser work holds; it is replaced when idle$/) };
  try {
    const id = await sessionOf(() => daemon.request<Listed>('session.list', {}), seeded);
    const path = daemonSocketOf(live.userData, id);
    const capability = async () => (await daemon.request<{ browser: { available: boolean; reason?: string } }>('session.capabilities', { appSessionId: id })).browser;
    expect(await capability(), 'O17’s reading with no app').toMatchObject(noApp);
    expect(await daemon.request('session.launch', { spec: launchSpec(id, live.repo, path) })).toMatchObject({ status: 'launching' });
    const report = join(live.repo, 'cua-connector.json');
    if (ENGINE_HOST_BROWSER_WORK) {
      await expect.poll(() => retryingOf(report)?.hellos ?? 0, { timeout: 20_000, message: 'the broker serves cua cold with no app' }).toBeGreaterThan(0);
      expect(existsSync(path), 'the session’s cold listener').toBe(true);
    } else {
      await expect.poll(() => retryingOf(report)?.refused ?? 0, { timeout: 20_000, message: 'cua\'s host finds nothing listening while no app is attached' }).toBeGreaterThan(1);
      expect(retryingOf(report)).toMatchObject({ hellos: 0, connected: false });
      expect(existsSync(path), 'nothing listens').toBe(false);
    }

    const beforeApp = retryingOf(report)!;
    const first = await launchMaws({ userData: live.userData, keepConfigHome: true, env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1', MAWS_E2E_ENGINE_BIN: live.bin } });
    launches.push(first);
    await expect.poll(async () => (await seam(first).inspect())[id]?.connections ?? 0, { timeout: 20_000, message: 'served once the app attaches' }).toBe(1);
    expect(retryingOf(report)!.hellos!, 'a hello from the app’s side').toBeGreaterThan(beforeApp.hellos!);
    expect(value(await invoke(first.page, 'session.capabilities', { appSessionId: id }))).toMatchObject({ browser: { available: true, viewed: 'local' } });
    // mid-lease: cua's host holds a tab of the session's browser with its debugger attached
    await expect.poll(async () => (await seam(first).inspect())[id]?.leased.length ?? 0, { timeout: 20_000, message: 'the lease taken through the relay' }).toBe(1);
    expect((await seam(first).inspect())[id]).toMatchObject({ connections: 1, refused: 0, leased: [expect.any(String)] });
    const served = retryingOf(report)!;

    // the app quits mid-lease: its quit completes, and cua's host loses the connection within the poll (no hang)
    const exited = new Promise<void>((done) => first.app.process().once('exit', () => done()));
    await first.app.evaluate(({ app: electron }) => electron.quit());
    await exited;
    await expect.poll(() => retryingOf(report)?.closes ?? 0, { timeout: 10_000, message: 'the relayed connection ends with the app, the lease with it' }).toBeGreaterThan(served.closes!);
    if (ENGINE_HOST_BROWSER_WORK) {
      await expect.poll(capability, { timeout: 10_000, message: 'the screencast again with no app' }).toEqual(SCREENCAST);
      await expect.poll(() => existsSync(path), { timeout: 5_000, message: 'the session listens cold again' }).toBe(true);
    } else {
      expect(retryingOf(report)).toMatchObject({ connected: false });
      await expect.poll(() => existsSync(path), { timeout: 5_000, message: 'the socket stops listening' }).toBe(false);
      expect(await capability()).toMatchObject(noApp);
    }

    const away = retryingOf(report)!;
    const second = await launchMaws({ userData: live.userData, keepConfigHome: true, env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1', MAWS_E2E_ENGINE_BIN: live.bin } });
    launches.push(second);
    await expect.poll(async () => (await seam(second).inspect())[id]?.connections ?? 0, { timeout: 20_000, message: 'served again after the relaunch, on the path the engine was told at its launch' }).toBe(1);
    expect(retryingOf(report)).toMatchObject({ connected: true, hello: { extensionInstanceId: `maws:${id}` } });
    expect(retryingOf(report)!.hellos!).toBeGreaterThan(away.hellos!);
    await expect.poll(async () => (await seam(second).inspect())[id]?.leased.length ?? 0, { timeout: 20_000, message: 'a lease again, in the relaunched app' }).toBe(1);
    expect((await seam(second).inspect())[id]).toMatchObject({ connections: 1, leased: [expect.any(String)] });
    expect(mawsdLogOf(live.userData)).not.toContain(`cua socket of ${id}: refused`);
  } finally {
    for (const launch of launches.reverse()) await launch.cleanup().catch((error: unknown) => console.error(error));
    await daemon.stop().catch((error: unknown) => console.error(error));
    rmSync(live.root, { recursive: true, force: true });
  }
});

test('one session\'s engine cannot reach another session\'s tab engine directly: its connector at B\'s app socket is refused, while B\'s own reaches it through mawsd\'s relay', async () => {
  const live = liveRoot(['session B of two'], { retry: false });
  const repoA = join(live.root, 'repo-a');
  mkdirSync(repoA);
  const [engineA] = seedTranscripts(live.config, repoA, ['session A of two']);
  const maws = await launchMaws({ userData: live.userData, env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1', CLAUDE_CONFIG_DIR: live.config, MAWS_E2E_ENGINE_BIN: live.bin } });
  try {
    const app = seam(maws);
    const list = async () => value(await invoke(maws.page, 'session.list', {}));
    const a = await sessionOf(list, engineA!);
    const b = await sessionOf(list, live.engineSessionIds[0]!);
    // B through mawsd, as the spine tells every launch on the daemon shape
    expect(value(await invoke(maws.page, 'session.launch', { spec: launchSpec(b, live.repo, daemonSocketOf(live.userData, b)) }))).toMatchObject({ status: 'launching' });
    const reportB = join(live.repo, 'cua-connector.json');
    await expect.poll(() => reportOf(reportB)?.hello ?? null, { timeout: 20_000, message: 'B\'s connector served through the relay' }).toMatchObject({ extensionInstanceId: `maws:${b}` });
    // A told B's app socket directly: a descendant of A's engine and not mawsd, so B's socket refuses it before the hello
    const appSocketB = (await app.socketPathFor(b))!;
    expect(value(await invoke(maws.page, 'session.launch', { spec: launchSpec(a, repoA, appSocketB) }))).toMatchObject({ status: 'launching' });
    const reportA = join(repoA, 'cua-connector.json');
    await expect.poll(() => reportOf(reportA), { timeout: 20_000, message: 'A\'s connector cut off' }).toMatchObject({ hello: null, closed: true });
    expect((await app.inspect())[b]).toMatchObject({ connections: 1, refused: 1 });
    expect(reportOf(reportB)).toMatchObject({ closed: false }); // B's relayed connection is untouched
  } finally {
    await maws.cleanup();
    rmSync(live.root, { recursive: true, force: true });
  }
});
// P5 O5 M5 end

// P5 O17 M8 start (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8's scenes 1 to 5 and 8; acceptance 1, 3, 4, 5
// and 9): the agent's browser with no app. Each scene is a profile's `mawsd` with no app (./support/headless-browser.ts),
// its sessions started through the ordinary start path on the cua engine stub that comes ready, whose connector is cua's
// host, driven over its control socket; `daemon.status`'s render entry counts the render host's starts, browser sessions
// and tabs. A scene that needs a real engine host listing `host.browserWork` (M7) skips with BEFORE_M7 until this build's
// engine host lists it: then no real engine host selects the headless route.
const QUIET_MS = 15_000; // the render host's quiet period under these scenes (MAWS_RENDER_QUIET_MS)
const CUA_BROWSER_START_MS = 4_000; // cua's bound on its browser's start, from the first real primitive to the tab
const LONG_QUIET_MS = 120_000; // a scene that must find the render host still running
const appCuaSocket = (userData: string, id: AppSessionId) => join(userData, 'browser', 'cua', `${id}.sock`);
const launchOver = (scene: HeadlessScene) => launchMaws({ userData: scene.userData, keepConfigHome: true, env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1', MAWS_E2E_ENGINE_BIN: scene.bin } });
const quitApp = async (maws: MawsLaunch) => {
  const exited = new Promise<void>((done) => maws.app.process().once('exit', () => done()));
  await maws.app.evaluate(({ app: electron }) => electron.quit());
  await exited;
};
const workHold = async (scene: HeadlessScene, id: AppSessionId) => ((await scene.sessionStatus(id)).work as { holds?: { browser?: string } } | undefined)?.holds?.browser;
const evaluated = async (cua: ConnectorControl, tabId: number, expression: string) =>
  ((await answered(`Runtime.evaluate ${expression}`, cua.call<{ result: { value: unknown } }>('debugger.sendCommand', { debuggee: { tabId }, method: 'Runtime.evaluate', params: { expression, returnByValue: true }, timeoutMs: 10_000 }))).result.value);

test('O17 scene 1, the first browser: with no app a session through the start path reads the screencast; cua is answered cold, its creation sequence starts the render host within 4 s and reaches 127.0.0.1; the render host ends after its quiet period while cua stays connected', async () => {
  test.skip(!ENGINE_HOST_BROWSER_WORK, BEFORE_M7);
  test.setTimeout(180_000);
  const within = latencyBudgets(); // the load the run starts under (e2e/support/latency.ts)
  const pages = await startHeadlessPages();
  const scene = await startHeadlessScene({ env: { MAWS_RENDER_QUIET_MS: String(QUIET_MS) } });
  try {
    expect(await scene.render(), 'no render host at the daemon’s start').toMatchObject({ starts: 0, pid: null });
    const repo = scene.repo(0);
    const id = await scene.start(repo);
    expect((await scene.capabilities(id)).browser, 'before Chromium starts').toEqual(SCREENCAST);
    const cua = await scene.connector(repo);
    await expect.poll(() => scene.report(repo)?.hellos ?? 0, { timeout: 15_000, message: 'the broker greets cua' }).toBeGreaterThan(0);
    expect(scene.report(repo)).toMatchObject({ socket: scene.daemonSocket(id), hello: { extensionInstanceId: `maws:${id}`, protocolVersion: 1, profileName: 'MAWS' }, connected: true });
    expect(await answered('tabs.query', cua.call('tabs.query')), 'answered cold: no live tab engine, no tabs hidden').toEqual([]);
    expect(await scene.status(), 'nothing started, no artifact made or fetched').toMatchObject({ render: { starts: 0 }, artifacts: { requests: 0 } });

    const created = await answered('cua’s creation sequence', cua.sequence(pages.url('/')));
    const startMs = created.steps.filter((step) => step.method === 'windows.create' || step.method === 'tabs.create').reduce((sum, step) => sum + step.ms, 0);
    // cua's CUA_BROWSER_START_MS, a latency the machine's load reaches (Chromium's start): the load-aware budget
    within('O17 the creation sequence to its tab', startMs, CUA_BROWSER_START_MS, `the first real primitive through to the tab within CUA_BROWSER_START_MS (${JSON.stringify(created.steps)})`);
    expect(created.screenshotBytes, 'a screenshot through the lease').toBeGreaterThan(0);
    expect(await evaluated(cua, created.tabId, 'document.querySelector("#marker").textContent'), 'the page from 127.0.0.1').toBe(PAGE_MARKER);
    expect(await scene.render()).toMatchObject({ starts: 1, browserSessions: 1, browserTabs: 1, pid: expect.any(Number) });
    await answered('Page.navigate', cua.call('debugger.sendCommand', { debuggee: { tabId: created.tabId }, method: 'Page.navigate', params: { url: pages.url('/still') }, timeoutMs: 10_000 }));
    await expect.poll(() => evaluated(cua, created.tabId, 'document.title').catch(() => null), { message: 'navigated' }).toBe('still');
    await answered('tabs.remove', cua.call('tabs.remove', { tabId: created.tabId }));
    await expect.poll(async () => (await scene.render()).browserTabs, { message: 'the tab closed' }).toBe(0);

    await expect.poll(scene.mawsdLog, { timeout: QUIET_MS + 30_000, message: 'the quiet period ends the render host' }).toContain(`[render] quiet for ${QUIET_MS / 1000} s: ending the render host`);
    await expect.poll(async () => (await scene.render()).pid, { timeout: 15_000, message: 'the render host gone' }).toBeNull();
    const hellos = scene.report(repo)!.hellos!;
    await expect.poll(async () => (await cua.state()).connected === true && (await cua.state()).hellos! >= hellos, { timeout: 15_000, message: 'cua still connected, to the broker' }).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2_000)); // a few of cua's retry intervals
    expect(await answered('tabs.query', cua.call('tabs.query')), 'answered cold again').toEqual([]);
    expect((await scene.render()).starts, 'nothing started Chromium again').toBe(1);
    cua.close();
  } finally {
    await scene.stop();
    await pages.close();
  }
});

test('O17 scene 2, handover: the app attaching during a start and during an active lease with a command in flight and an export, a quit and a reattach, and the app’s leaving, after which cua is answered cold with no Chromium start', async () => {
  test.skip(!ENGINE_HOST_BROWSER_WORK, BEFORE_M7);
  test.setTimeout(360_000);
  const pages = await startHeadlessPages();
  // MAWS_E2E_BROWSER_START_HOLD (mawsd's e2e seam): the first headless start waits for the first app's attachment
  const scene = await startHeadlessScene({ engine: { retryMs: 5_000 /* cua's CLIENT_RETRY_MS */, lifeMs: 600_000 }, env: { MAWS_RENDER_QUIET_MS: String(LONG_QUIET_MS), MAWS_E2E_BROWSER_START_HOLD: '1' } });
  const launches: MawsLaunch[] = [];
  try {
    const repo = scene.repo(0);
    const id = await scene.start(repo);
    const cua = await scene.connector(repo);
    await expect.poll(() => scene.report(repo)?.hellos ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
    const servedByApp = async (maws: MawsLaunch) => {
      await expect.poll(async () => (await seam(maws).inspect())[id]?.connections ?? 0, { timeout: 30_000, message: 'the app serves the session’s cua connection' }).toBe(1);
      expect((await scene.capabilities(id)).browser).toEqual({ available: true, viewed: 'local' });
    };

    await test.step('the app attaches during a start: the held start is settled by the handover, its trigger lost, nothing started, and cua is served by the app', async () => {
      const creating = cua.sequence(pages.url('/'));
      await expect.poll(scene.mawsdLog, { timeout: 15_000, message: 'the start is held until an app attaches' }).toContain(`[browser] e2e: the start of ${id} held until an app attaches`);
      expect((await scene.render()).starts, 'nothing started while held').toBe(0);
      const first = await launchOver(scene);
      launches.push(first);
      const outcome = await creating;
      expect(outcome, 'the pending creation ends with its connection, unanswered').toMatchObject({ ok: false, error: 'lost' });
      expect(scene.mawsdLog(), 'the hold released by the attachment').toContain('[browser] e2e: the held starts released by an app’s attachment');
      await servedByApp(first);
      const after = await scene.render();
      expect({ starts: after.starts, sessions: after.browserSessions ?? 0, tabs: after.browserTabs ?? 0 }, 'the released start began nothing: no Chromium, no session, no tab').toEqual({ starts: 0, sessions: 0, tabs: 0 });
      await quitApp(first);
    });

    await test.step('during an active lease, a command in flight and an export: the command is lost, the export completes, and cua is served by the app within its 5 s cycle', async () => {
      await expect.poll(async () => (await cua.state()).connected, { timeout: 15_000, message: 'cua back on the broker' }).toBe(true);
      const created = await answered('cua’s creation sequence', cua.sequence(pages.url('/')));
      expect(await scene.render()).toMatchObject({ browserSessions: 1, browserTabs: 1 });
      const artifact = await scene.daemon.request<{ artifact: { id: string } }>('artifacts.create', { kind: 'html', title: 'Handover export', content: { bytes: new TextEncoder().encode('<!doctype html><title>x</title><p>handover</p>'), name: 'index.html' } });
      const inFlight = cua.call('debugger.sendCommand', { debuggee: { tabId: created.tabId }, method: 'Runtime.evaluate', params: { expression: 'new Promise((r) => setTimeout(r, 30000))', awaitPromise: true }, timeoutMs: 60_000 });
      const exporting = scene.daemon.request<{ path: string }>('artifacts.export', { artifactId: artifact.artifact.id, format: 'pdf' });
      const second = await launchOver(scene);
      launches.push(second);
      const lost = await inFlight;
      const lostAt = Date.now();
      expect(lost, 'the command in flight ends with its connection').toMatchObject({ ok: false, error: 'lost' });
      expect((await exporting).path.startsWith(join(scene.userData, 'artifacts', artifact.artifact.id, 'exports')), 'the export completes').toBe(true);
      await servedByApp(second);
      expect(Date.now() - lostAt, 'served within cua’s 5 s retry, and the poll’s slack').toBeLessThan(5_000 + 3_000);
      await expect.poll(async () => (await scene.render()).browserTabs ?? 0, { message: 'the session’s headless tabs closed' }).toBe(0);
      await quitApp(second);
    });

    await test.step('a quit and a reattach serve it again; when the app leaves, the next tabs.query is answered cold and nothing starts Chromium', async () => {
      const third = await launchOver(scene);
      launches.push(third);
      await servedByApp(third);
      const starts = (await scene.render()).starts;
      await quitApp(third);
      await expect.poll(async () => (await scene.capabilities(id)).browser, { message: 'the screencast again with no app' }).toEqual(SCREENCAST);
      await expect.poll(async () => (await cua.state()).connected, { timeout: 15_000, message: 'cua back on the broker' }).toBe(true);
      await expect.poll(async () => { const answer = await cua.call('tabs.query'); return answer.ok ? answer.result : answer.error; }, { timeout: 15_000 }).toEqual([]); // prettier-ignore
      expect((await scene.render()).starts, 'no Chromium start for an inventory').toBe(starts);
    });
    cua.close();
  } finally {
    for (const launch of launches.reverse()) await launch.cleanup().catch((error: unknown) => console.error(error));
    await scene.stop();
    await pages.close();
  }
});

test('O17 scene 3, the recovery close: cua killed holding the session’s last tab; the next cua of the session closes it, the count and the hold clear, and the render host ends after its quiet period', async () => {
  test.skip(!ENGINE_HOST_BROWSER_WORK, BEFORE_M7);
  test.setTimeout(180_000);
  const pages = await startHeadlessPages();
  const scene = await startHeadlessScene({ engine: { respawn: true }, env: { MAWS_RENDER_QUIET_MS: String(QUIET_MS) } });
  try {
    const repo = scene.repo(0);
    const id = await scene.start(repo);
    const first = await scene.connector(repo);
    const created = await answered('cua’s creation sequence', first.sequence(pages.url('/')));
    await expect.poll(() => workHold(scene, id), { message: 'the engine host holds the session for its tab' }).toBe('held');
    const killed = scene.report(repo)!.pid;
    first.close();
    process.kill(killed, 'SIGKILL');
    await expect.poll(() => { const report = scene.report(repo); return report !== null && report.pid !== killed && (report.hellos ?? 0) > 0; }, { timeout: 20_000, message: 'the engine starts cua again' }).toBe(true); // prettier-ignore
    expect((await scene.render()).browserTabs, 'the tab outlives its creator').toBe(1);
    const next = await scene.connector(repo);
    const tabs = await answered('tabs.query', next.call<{ id: number; url: string }[]>('tabs.query'));
    expect(tabs.map((tab) => tab.url), 'the new connection of the session finds the tab').toEqual([pages.url('/')]);
    await answered('tabs.remove of the orphan', next.call('tabs.remove', { tabId: tabs[0]!.id }));
    await expect.poll(async () => (await scene.render()).browserTabs, { message: 'no tab left' }).toBe(0);
    await expect.poll(() => workHold(scene, id), { message: 'the hold cleared' }).toBeUndefined();
    await expect.poll(scene.mawsdLog, { timeout: QUIET_MS + 30_000, message: 'the render host ends after its quiet period' }).toContain(`[render] quiet for ${QUIET_MS / 1000} s: ending the render host`);
    expect(created.tabId).toBeGreaterThan(0);
    next.close();
  } finally {
    await scene.stop();
    await pages.close();
  }
});

test('O17 scene 4, an engine’s exit and an engine-host restart: the exit closes the session’s tab and both holds, a resume re-prepares in the running render host; `mawsd restart --engine-host` keeps a held tab and both holds', async () => {
  test.skip(!ENGINE_HOST_BROWSER_WORK, BEFORE_M7);
  test.setTimeout(300_000);
  const pages = await startHeadlessPages();
  const scene = await startHeadlessScene({ engine: { lifeMs: 600_000 }, env: { MAWS_RENDER_QUIET_MS: String(LONG_QUIET_MS) } });
  try {
    const repo = scene.repo(0);
    const id = await scene.start(repo);
    let cua = await scene.connector(repo);
    await answered('cua’s creation sequence', cua.sequence(pages.url('/')));
    await expect.poll(() => workHold(scene, id)).toBe('held');
    const starts = (await scene.render()).starts;

    await test.step('the engine exits holding a tab: the tab closes and both holds clear; a resume’s next tabs.create re-prepares in the running render host', async () => {
      const pid = (await scene.sessionStatus(id)).pid!;
      cua.close();
      process.kill(pid, 'SIGTERM');
      await expect.poll(async () => (await scene.sessionStatus(id)).process, { timeout: 20_000, message: 'the engine exited' }).toBe('exited');
      await expect.poll(async () => (await scene.render()).browserTabs ?? 0, { message: 'its headless tab closed' }).toBe(0);
      await expect.poll(() => workHold(scene, id), { message: 'the engine host’s hold cleared' }).toBeUndefined();
      expect(await scene.daemon.request('session.start', { appSessionId: id, message: { content: 'resume', display: 'resume' }, options: { gateway: 'direct' } })).toMatchObject({ status: 'starting' });
      await expect.poll(async () => { const st = await scene.sessionStatus(id); return st.process === 'ready' && st.pid !== pid && st.turn === null; }, { timeout: 60_000, message: 'resumed' }).toBe(true); // prettier-ignore
      cua = await scene.connector(repo);
      await expect.poll(() => scene.report(repo)?.pid !== undefined && (scene.report(repo)?.hellos ?? 0) > 0, { timeout: 15_000 }).toBe(true);
      await answered('cua’s creation sequence after the resume', cua.sequence(pages.url('/')));
      expect(await scene.render(), 'the running render host prepared it again').toMatchObject({ starts, browserSessions: 1, browserTabs: 1 });
    });

    await test.step('`mawsd restart --engine-host` with a held tab: the engine, its tab and both holds survive', async () => {
      const pid = (await scene.sessionStatus(id)).pid;
      // the hold as each status read gives it through the handover: `held`, or `unknown` while the adopted session awaits
      // mawsd's first snapshot, never absent (the review's test, scene 6, at e2e: nothing may release it meanwhile)
      const seen = new Set<string>();
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          const status = await scene.sessionStatus(id).catch(() => null);
          if (status !== null && status.process !== 'exited') seen.add(String((status.work as { holds?: { browser?: string } } | undefined)?.holds?.browser));
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      })();
      const restarted = await scene.daemon.cli(['restart', '--engine-host']);
      expect(restarted.status, restarted.stderr || restarted.stdout).toBe(0);
      await expect.poll(async () => (await scene.sessionStatus(id).catch(() => null))?.pid ?? null, { timeout: 60_000, message: 'the session’s engine adopted by the successor' }).toBe(pid);
      expect(await scene.render()).toMatchObject({ starts, browserTabs: 1 });
      await expect.poll(() => workHold(scene, id), { timeout: 20_000, message: 'the successor holds the session once mawsd’s first snapshot applies' }).toBe('held');
      sampling = false;
      await sampler;
      expect([...seen].filter((hold) => hold !== 'held' && hold !== 'unknown'), `the hold through the handover (${[...seen].join(', ')})`).toEqual([]);
      expect((await answered('tabs.query', cua.call<{ url: string }[]>('tabs.query'))).map((tab) => tab.url)).toEqual([pages.url('/')]);
    });
    cua.close();
  } finally {
    await scene.stop();
    await pages.close();
  }
});

test('O17 scene 5, O5 M5’s scene 3 extended: A’s relay works while A’s engine-side peer reaches neither B’s render-host socket nor, once the app attaches, B’s app socket', async () => {
  test.skip(!ENGINE_HOST_BROWSER_WORK, BEFORE_M7);
  test.setTimeout(240_000);
  const pages = await startHeadlessPages();
  const scene = await startHeadlessScene({ repos: 2, engine: { lifeMs: 600_000 }, env: { MAWS_RENDER_QUIET_MS: String(LONG_QUIET_MS) } });
  const launches: MawsLaunch[] = [];
  try {
    const [repoA, repoB] = [scene.repo(0), scene.repo(1)];
    const a = await scene.start(repoA, 'session A');
    const b = await scene.start(repoB, 'session B');
    const cuaA = await scene.connector(repoA);
    const cuaB = await scene.connector(repoB);
    await answered('A’s creation sequence', cuaA.sequence(pages.url('/')));
    await answered('B’s creation sequence', cuaB.sequence(pages.url('/')));
    const renderB = scene.renderSocket(b)!;
    expect(existsSync(renderB), 'B’s render-host socket listens').toBe(true);
    expect(await answered('A dials B’s render-host socket', cuaA.probe(renderB)), 'refused before any hello: only mawsd’s relay is admitted').toEqual({ hello: null, closed: true });
    expect((await answered('A’s own relay', cuaA.call<unknown[]>('tabs.query'))).length, 'A’s relay still works').toBe(1);

    const maws = await launchOver(scene);
    launches.push(maws);
    await expect.poll(async () => (await seam(maws).inspect())[b]?.connections ?? 0, { timeout: 30_000, message: 'B served by the app' }).toBe(1);
    await expect.poll(async () => (await seam(maws).inspect())[a]?.connections ?? 0, { timeout: 30_000, message: 'A served by the app' }).toBe(1);
    expect(await answered('A dials B’s app socket', cuaA.probe(appCuaSocket(scene.userData, b))), 'refused: A descends from A’s engine, not mawsd').toEqual({ hello: null, closed: true });
    await expect.poll(async () => { const answer = await cuaA.call('tabs.query'); return answer.ok; }, { timeout: 15_000, message: 'A’s relay to the app works' }).toBe(true); // prettier-ignore
    expect((await seam(maws).inspect())[b], 'B’s socket refused A once').toMatchObject({ connections: 1, refused: 1 });
    cuaA.close();
    cuaB.close();
  } finally {
    for (const launch of launches.reverse()) await launch.cleanup().catch((error: unknown) => console.error(error));
    await scene.stop();
    await pages.close();
  }
});

test('O17 scene 8, sockets: a tab engine that is not selected for a session has every reply refused by mawsd, and a symlinked cua directory of the app serves no session', async () => {
  test.setTimeout(180_000);
  const scene = await startHeadlessScene();
  let maws: MawsLaunch | null = null;
  try {
    const id = 'o17-scene-8-session' as AppSessionId;
    // a client of machine.sock saying hello as a tab engine, selected for nothing: its stale or foreign replies
    const reached = await reachMachine(daemonPaths(scene.userData), { build: 'e2e-o17-stale-engine', capabilities: [BROWSER_ENGINE_CAPABILITY] });
    if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}`);
    try {
      const refused = async (name: string, input: unknown) => {
        const answer = await reached.link.request(name, input);
        return answer.ok ? 'answered' : answer.error.code;
      };
      expect(await refused('browserEngine.state', { appSessionId: id, inventory: { tabs: [], selected: null, state: 'ready' } })).toBe('forbidden_sender');
      expect(await refused('browserEngine.work', { appSessionId: id, held: true })).toBe('forbidden_sender');
      expect(await refused('browserEngine.work', { appSessionId: id, held: false })).toBe('forbidden_sender');
      expect(await refused('browserEngine.answer', { id: 'stale-1', result: { ok: true, value: null } })).toBe('invalid_input');
      expect(await refused('browserEngine.frame', { subscriptionId: 'stale-1', frame: { tabId: 'b_000000000000', seq: 1, capturedAt: 0, width: 1, height: 1, viewport: { width: 1, height: 1 }, jpegBase64: 'AA==' } })).toBe('forbidden_sender');
      expect(await refused('browserEngine.ended', { subscriptionId: 'stale-1', reason: 'tab_closed' })).toBe('forbidden_sender');
    } finally {
      reached.link.close();
    }

    // the app's cua directory a symlink to a directory of this user: refused at the start, no session's socket made
    const elsewhere = join(scene.root, 'elsewhere');
    mkdirSync(elsewhere, { mode: 0o700 });
    mkdirSync(join(scene.userData, 'browser'), { recursive: true });
    symlinkSync(elsewhere, join(scene.userData, 'browser', 'cua'));
    maws = await launchOver(scene);
    expect(await seam(maws).socketPathFor(id), 'no socket for any session').toBeNull();
    expect(readdirSync(elsewhere), 'nothing made through the link').toEqual([]);
  } finally {
    await maws?.cleanup().catch((error: unknown) => console.error(error));
    await scene.stop();
  }
});

test('O17 scene 8, sockets (the render host’s root): an engine-side peer dialling a session’s render-host socket directly is refused, and a symlinked render-host cua directory makes no socket and starts no tab', async () => {
  test.skip(!ENGINE_HOST_BROWSER_WORK, BEFORE_M7);
  test.setTimeout(180_000);
  const pages = await startHeadlessPages();
  const scene = await startHeadlessScene({ env: { MAWS_RENDER_QUIET_MS: String(LONG_QUIET_MS) } });
  try {
    const repo = scene.repo(0);
    const id = await scene.start(repo);
    const cua = await scene.connector(repo);
    await answered('cua’s creation sequence', cua.sequence(pages.url('/')));
    expect(await answered('the session’s own engine-side peer dials its render-host socket', cua.probe(scene.renderSocket(id)!)), 'only mawsd’s relay is admitted there').toEqual({ hello: null, closed: true });
    cua.close();
  } finally {
    await scene.stop();
  }

  const linked = await startHeadlessScene({ env: { MAWS_RENDER_QUIET_MS: String(LONG_QUIET_MS) } });
  try {
    const renderDir = renderCuaSocketDir(linked.userData, tmpdir());
    const elsewhere = join(linked.root, 'elsewhere');
    mkdirSync(elsewhere, { mode: 0o700 });
    rmSync(renderDir, { recursive: true, force: true });
    symlinkSync(elsewhere, renderDir);
    const repo = linked.repo(0);
    const id = await linked.start(repo);
    const cua = await linked.connector(repo);
    const created = await cua.sequence(pages.url('/'));
    expect(created.ok, 'the creation fails with its reason, never an invented success').toBe(false);
    expect(readdirSync(elsewhere), 'no socket made through the link').toEqual([]);
    expect((await linked.render()).browserTabs ?? 0).toBe(0);
    expect(existsSync(linked.daemonSocket(id)), 'the session’s cold listener stays').toBe(true);
    cua.close();
  } finally {
    await linked.stop();
    await pages.close();
  }
});
// P5 O17 M8 end
