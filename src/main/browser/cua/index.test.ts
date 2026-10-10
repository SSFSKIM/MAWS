import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebContents, WebContentsView } from 'electron';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import { connectFakeHost } from '../../../../test/support/cua-fake-host';
import { TabStore } from '../tabs';
import { startCuaBackend } from './index';
import type { AppSessionId } from '@shared/graph/ids';
import { A, B, FakeContents, fakeView, harness, S, takeDown, testPeer, tracked } from './server.fake';

// The primitive server (the in-app browser spec of 2026-10-08, M2): a real socket per app session, MAWS's real TabStore
// and TabDebugger over fake views whose webContents.debugger records every command, and the fake host of
// test/support/cua-fake-host.ts on the other end, as cua's host would be. The fake host runs in this process, which every
// stand trusts as a root (the socket peer authentication spec of 2026-10-09, M2; admission.test.ts drives the check).

afterEach(takeDown);

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('the socket and the hello', () => {
  it('listens per app session at <userData>/browser/cua/<id>.sock in a 0700 directory swept of stale sockets, and says hello at once', async () => {
    const root = mkdtempSync('/tmp/mcua-');
    tracked.roots.push(root);
    mkdirSync(join(root, 'browser', 'cua'), { recursive: true });
    writeFileSync(join(root, 'browser', 'cua', 'gone.sock'), '');
    const store = new TabStore({ emit: () => undefined, createView: () => fakeView() as unknown as WebContentsView, resolvePartition: () => DEFAULT_PARTITION, schedule: () => {} });
    const backend = startCuaBackend({ store, windows: () => [], reaches: (a, b) => a === b, userData: root, version: '1.2.3', log: () => {}, peer: testPeer() });
    tracked.backends.push(backend);
    expect(existsSync(join(root, 'browser', 'cua', 'gone.sock'))).toBe(false);
    expect(statSync(join(root, 'browser', 'cua')).mode & 0o777).toBe(0o700);
    const path = backend.socketPathFor(A)!;
    expect(path).toBe(join(root, 'browser', 'cua', 'A.sock'));
    expect(backend.socketPathFor(A)).toBe(path); // one server per session
    const host = await connectFakeHost(path);
    tracked.hosts.push(host);
    expect(host.hello).toEqual({ extensionId: 'maws', extensionInstanceId: 'maws:A', version: '1.2.3', protocolVersion: 1, profileName: 'MAWS' });
    backend.dispose();
    await host.closed;
    expect(existsSync(path)).toBe(false);
  });

  it('refuses a socket path longer than macOS allows, rather than listening somewhere else', () => {
    const h = harness();
    expect(h.backend.socketPathFor('x'.repeat(120) as AppSessionId)).toBeNull();
  });
});

describe('tabs and windows', () => {
  it('lists the session\'s reachable tabs (its own and, for a side thread, its parent\'s) and refuses any other by Chrome\'s wording', async () => {
    const h = harness();
    const mine = h.personTab(A, 'https://a.test/');
    h.personTab(B, 'https://b.test/');
    const a = await h.host(A);
    const listed = await a.request<{ id: number; url: string; active: boolean; groupId: number; windowId: number }[]>('tabs.query');
    expect(listed).toEqual([{ id: 1, windowId: 7, url: 'https://a.test/', title: '', active: true, groupId: -1, status: 'loading' }]);
    expect(await a.request('tabs.get', { tabId: 1 })).toMatchObject({ id: 1, url: 'https://a.test/' });
    await expect(a.request('tabs.get', { tabId: 99 })).rejects.toThrow('No tab with id: 99');
    const side = await h.host(S);
    expect((await side.request<{ url: string }[]>('tabs.query')).map((t) => t.url)).toEqual(['https://a.test/']);
    const b = await h.host(B);
    expect((await b.request<{ url: string }[]>('tabs.query')).map((t) => t.url)).toEqual(['https://b.test/']);
    await expect(b.request('debugger.attach', { tabId: 1 + 0 })).resolves.toBeDefined(); // B's own id 1 is B's tab
    expect(h.cdp(mine).attached).toBe(false);
  });

  // cua #90 (the whole-branch review): an extension's options page MAWS opened as a tab runs in the extension's origin, with
  // its storage, its background and its host permissions; the agent never names or reaches it, as it never reaches the
  // extension's popups, background pages or service workers
  it('never lists, names or leases an internal tab (an extension\'s options page); its replacement by an ordinary tab is an ordinary tab', async () => {
    const h = harness();
    const options = h.store.entry(h.store.open({
      appSessionId: A, url: 'chrome-extension://nenbjdahllkkbfanbpfmmdacjencdfpg/options.html', select: true,
      internal: { kind: 'extension', extensionId: 'nenbjdahllkkbfanbpfmmdacjencdfpg', title: 'MAWS probe extension · Options' },
    }).tab.tabId)!;
    const person = h.personTab(A, 'https://a.test/');
    const a = await h.host(A);
    expect((await a.request<{ id: number; url: string }[]>('tabs.query')).map((t) => [t.id, t.url])).toEqual([[1, 'https://a.test/']]);
    expect((await a.request<{ tabId: number }[]>('debugger.getTargets')).map((t) => t.tabId)).toEqual([1]);
    for (const tabId of [0, 2, 3]) {
      await expect(a.request('tabs.get', { tabId })).rejects.toThrow(`No tab with id: ${tabId}`);
      await expect(a.request('debugger.attach', { tabId })).rejects.toThrow(`No tab with id: ${tabId}`);
    }
    h.store.update(options.tab.tabId, { title: 'Options' });
    await settle();
    expect(a.notifications.filter((n) => n.method === 'tabs.updated')).toEqual([]);
    expect(h.cdp(options).attached).toBe(false);
    // Navigator.leaveInternal: a new ordinary tab opens, then the internal tab closes; the host never heard of it
    const { tab } = h.store.open({ appSessionId: A, url: 'https://docs.test/help', select: true });
    h.store.close(options.tab.tabId);
    await settle();
    expect(a.notifications.filter((n) => n.method === 'tabs.removed')).toEqual([]);
    const listed = await a.request<{ id: number; url: string }[]>('tabs.query');
    expect(listed.map((t) => t.url)).toEqual(['https://a.test/', 'https://docs.test/help']);
    const replacement = listed.find((t) => t.url === 'https://docs.test/help')!;
    expect(await a.request('debugger.attach', { tabId: replacement.id })).toEqual({ alreadyHeld: false });
    expect(h.cdp(h.store.entry(tab.tabId)!).attached).toBe(true);
    expect(h.cdp(person).attached).toBe(false);
  });

  it('creates a tab in the session\'s panel unselected, reserved to the connection, in its group; windows are the app\'s', async () => {
    const h = harness();
    const person = h.personTab();
    const a = await h.host();
    expect(await a.request('windows.query')).toEqual([{ id: 7, focused: true, type: 'normal' }]);
    expect(await a.request('windows.create', { focused: false })).toEqual({ id: 7 });
    const created = await a.request<{ id: number; windowId: number; active: boolean; groupId: number }>('tabs.create', { url: 'about:blank', windowId: 7, group: { key: 's1', title: 'cua' }, guard: true });
    expect(created).toMatchObject({ windowId: 7, active: false, groupId: 1, url: 'about:blank' });
    expect(h.store.list(A).selected[A]).toBe(person.tab.tabId);
    expect(h.store.all()).toHaveLength(2);
    expect(await a.request('tabs.guard', { tabId: created.id })).toEqual({});
    expect(await a.request('group.title', { windowId: 7, key: 's1', title: 'agent' })).toEqual({});
    expect(await a.request('tabs.ungroup', { tabId: created.id })).toEqual({});
    expect(await a.request('tabs.get', { tabId: created.id })).toMatchObject({ groupId: -1 });
    expect(await a.request('cursor.move', { tabId: created.id, x: 1, y: 2 })).toEqual({});
  });
});

describe('leases, reservations and the command filter', () => {
  it('attaches through a lease, passes page commands, refuses the filtered ones, and wants a lease for any command', async () => {
    const h = harness();
    const tab = h.personTab();
    const a = await h.host();
    const id = await h.idOf(a, tab);
    await expect(a.request('debugger.sendCommand', { debuggee: { tabId: id }, method: 'Runtime.evaluate', params: {} })).rejects.toThrow(`Debugger is not attached to the tab with id: ${id}.`);
    expect(await a.request('debugger.attach', { tabId: id })).toEqual({ alreadyHeld: false });
    expect(await a.request('debugger.attach', { tabId: id })).toEqual({ alreadyHeld: true });
    expect([tab.debugger!.leases, h.backend.holds(tab.tab.tabId), h.changes]).toEqual([1, true, [tab.tab.tabId]]);
    expect(await a.request('debugger.sendCommand', { debuggee: { tabId: id }, method: 'Runtime.evaluate', params: { expression: '1' }, timeoutMs: 5000 })).toEqual({ echoed: 'Runtime.evaluate' });
    for (const method of ['Browser.getVersion', 'Storage.getCookies', 'Target.createTarget', 'Target.setDiscoverTargets']) {
      await expect(a.request('debugger.sendCommand', { debuggee: { tabId: id }, method, params: {} })).rejects.toThrow(`Method not allowed: ${method}`);
    }
    expect(h.cdp(tab).methods()).toEqual(['Runtime.evaluate']);
    expect(await a.request('debugger.detach', { tabId: id })).toEqual({});
    expect([tab.debugger!.leases, h.cdp(tab).attached, h.backend.holds(tab.tab.tabId)]).toEqual([0, false, false]);
    await expect(a.request('debugger.detach', { tabId: id })).rejects.toThrow('Debugger is not attached to the tab with id');
  });

  it('counts leases across two connections: a tab under one connection\'s lease is refused to the other until it lets go', async () => {
    const h = harness();
    const tab = h.personTab();
    const one = await h.host();
    const two = await h.host();
    const id1 = await h.idOf(one, tab);
    const id2 = await h.idOf(two, tab);
    await one.request('debugger.attach', { tabId: id1 });
    await expect(two.request('debugger.attach', { tabId: id2 })).rejects.toThrow('Tab is held by another agent session');
    expect(tab.debugger!.leases).toBe(1);
    await one.request('debugger.detach', { tabId: id1 });
    expect(await two.request('debugger.attach', { tabId: id2 })).toEqual({ alreadyHeld: false });
    expect(tab.debugger!.leases).toBe(1);
  });

  it('a tab created through a connection stays reserved to it after its host detaches; only that connection may close it, and never a person\'s tab', async () => {
    const h = harness();
    const person = h.personTab();
    const one = await h.host();
    const two = await h.host();
    const created = await one.request<{ id: number }>('tabs.create', { url: 'about:blank' });
    await one.request('debugger.attach', { tabId: created.id });
    await one.request('debugger.detach', { tabId: created.id }); // the host's timeout detach
    const theirs = (await two.request<{ id: number; url: string }[]>('tabs.query')).find((t) => t.url === 'about:blank')!;
    await expect(two.request('debugger.attach', { tabId: theirs.id })).rejects.toThrow('Tab is held by another agent session');
    await expect(two.request('tabs.remove', { tabId: theirs.id })).rejects.toThrow('Tab is not owned by this agent session');
    const personId = await h.idOf(one, person);
    await expect(one.request('tabs.remove', { tabId: personId })).rejects.toThrow('Tab is not owned by this agent session');
    expect(await one.request('tabs.remove', { tabId: created.id })).toEqual({});
    expect(h.store.all().map((e) => e.tab.tabId)).toEqual([person.tab.tabId]);
    await one.waitFor('tabs.removed', (p) => p.tabId === created.id);
  });

  it('a connection that closes leaves its created tabs to the person: another connection may then claim them', async () => {
    const h = harness();
    const one = await h.host();
    const two = await h.host();
    await one.request('tabs.create', { url: 'about:blank' });
    await one.close();
    await settle();
    const theirs = (await two.request<{ id: number }[]>('tabs.query'))[0]!;
    expect(await two.request('debugger.attach', { tabId: theirs.id })).toEqual({ alreadyHeld: false });
  });

  it('leases a tab another owner holds attached (focus emulation): its implicit lease is its own and outlives the host\'s', async () => {
    const h = harness();
    const tab = h.personTab();
    await tab.debugger!.attach('focus');
    const a = await h.host();
    const id = await h.idOf(a, tab);
    expect(await a.request('debugger.attach', { tabId: id })).toEqual({ alreadyHeld: false });
    await a.request('debugger.detach', { tabId: id });
    expect([tab.debugger!.heldBy('focus'), tab.debugger!.attached]).toEqual([true, true]);
  });
});

describe('the agent state reset', () => {
  const TOGGLES: [string, Record<string, unknown>][] = [
    ['Fetch.enable', {}],
    ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }],
    ['Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false }],
    ['Emulation.setFocusEmulationEnabled', { enabled: true }],
    ['Page.setInterceptFileChooserDialog', { enabled: true }],
  ];

  it('on detach with MAWS\'s focus emulation on: every toggle undone but focus emulation\'s, and the attachment stays MAWS\'s', async () => {
    const h = harness();
    const tab = h.personTab();
    await tab.debugger!.attach('focus');
    const a = await h.host();
    const id = await h.idOf(a, tab);
    await a.request('debugger.attach', { tabId: id });
    for (const [method, params] of TOGGLES) await a.request('debugger.sendCommand', { debuggee: { tabId: id }, method, params });
    h.cdp(tab).sent.splice(0);
    await a.request('debugger.detach', { tabId: id });
    expect(h.cdp(tab).sent.map((c) => [c.method, c.params])).toEqual([
      ['Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }],
      ['Page.setInterceptFileChooserDialog', { enabled: false }],
      ['Fetch.disable', {}],
      ['Emulation.clearDeviceMetricsOverride', {}],
    ]);
    expect([h.cdp(tab).attached, tab.debugger!.leases]).toEqual([true, 1]);
  });

  it('on disconnect: held commands cancelled, every toggle undone, the lease released and the tab left open', async () => {
    const h = harness();
    const tab = h.personTab();
    const a = await h.host();
    const id = await h.idOf(a, tab);
    await a.request('debugger.attach', { tabId: id });
    for (const [method, params] of TOGGLES) await a.request('debugger.sendCommand', { debuggee: { tabId: id }, method, params });
    h.cdp(tab).hang.add('Runtime.evaluate');
    void a.request('debugger.sendCommand', { debuggee: { tabId: id }, method: 'Runtime.evaluate', params: {} }).catch(() => {});
    await settle();
    expect(h.backend.inspect().sessions).toMatchObject({ A: { connections: 1, held: 1, leased: [tab.tab.tabId] } });
    h.cdp(tab).sent.splice(0);
    await a.close();
    await settle();
    expect(h.backend.inspect().sessions).toMatchObject({ A: { connections: 0, held: 0, leased: [] } });
    expect(h.cdp(tab).methods()).toEqual(['Target.setAutoAttach', 'Page.setInterceptFileChooserDialog', 'Fetch.disable', 'Emulation.clearDeviceMetricsOverride', 'Emulation.setFocusEmulationEnabled']);
    expect([h.cdp(tab).attached, tab.debugger!.leases, h.store.all()]).toEqual([false, 0, [tab]]);
  });

  it('an attach while the previous lease is still being let go (a hung undo) waits for that release, then holds a fresh lease', async () => {
    const h = harness();
    const tab = h.personTab();
    const a = await h.host();
    const id = await h.idOf(a, tab);
    await a.request('debugger.attach', { tabId: id });
    await a.request('debugger.sendCommand', { debuggee: { tabId: id }, method: 'Fetch.enable', params: {} });
    h.cdp(tab).hang.add('Fetch.disable'); // the undo never answers: the release waits out its bound
    const detaching = a.request('debugger.detach', { tabId: id });
    await settle();
    expect(await a.request('debugger.attach', { tabId: id })).toEqual({ alreadyHeld: false });
    await detaching;
    expect(await a.request('debugger.sendCommand', { debuggee: { tabId: id }, method: 'Runtime.evaluate', params: {} })).toEqual({ echoed: 'Runtime.evaluate' });
    expect([tab.debugger!.leases, h.backend.holds(tab.tab.tabId)]).toEqual([1, true]);
  });

  it('a held command is cancelled when its deadline passes and when its tab is detached', async () => {
    const h = harness();
    const tab = h.personTab();
    const a = await h.host();
    const id = await h.idOf(a, tab);
    await a.request('debugger.attach', { tabId: id });
    h.cdp(tab).hang.add('Runtime.evaluate');
    await expect(a.request('debugger.sendCommand', { debuggee: { tabId: id }, method: 'Runtime.evaluate', params: {}, timeoutMs: 30 })).rejects.toThrow('Command cancelled: deadline');
    const waiting = a.request('debugger.sendCommand', { debuggee: { tabId: id }, method: 'Runtime.evaluate', params: {} });
    await settle();
    await a.request('debugger.detach', { tabId: id });
    await expect(waiting).rejects.toThrow('Command cancelled: detached');
  });
});

describe('targets, events and closing', () => {
  it('Target.closeTarget closes a tab the connection holds and owns; any other target is not found, a person\'s tab is not owned', async () => {
    const h = harness();
    const person = h.personTab();
    const a = await h.host();
    const created = await a.request<{ id: number }>('tabs.create', { url: 'about:blank' });
    const agentTab = h.store.all().find((e) => e !== person)!;
    const agentCdp = h.cdp(agentTab);
    await a.request('debugger.attach', { tabId: created.id });
    const targets = await a.request<{ targetId: string; tabId: number; type: string; attached: boolean }[]>('debugger.getTargets');
    const page = targets.find((t) => t.tabId === created.id)!;
    expect(page).toMatchObject({ targetId: agentCdp.frameId, type: 'page', attached: true });
    await expect(a.request('debugger.sendCommand', { debuggee: { tabId: created.id }, method: 'Target.closeTarget', params: { targetId: 'NOT-A-TARGET' } })).rejects.toThrow('No target with given id found');
    const personId = await h.idOf(a, person);
    await a.request('debugger.attach', { tabId: personId });
    await expect(a.request('debugger.sendCommand', { debuggee: { tabId: personId }, method: 'Target.closeTarget', params: { targetId: h.cdp(person).frameId } })).rejects.toThrow('Tab is not owned by this agent session');
    await expect(a.request('debugger.sendCommand', { debuggee: { tabId: personId }, method: 'Page.close', params: {} })).rejects.toThrow('Tab is not owned by this agent session');
    expect(await a.request('debugger.sendCommand', { debuggee: { tabId: created.id }, method: 'Target.closeTarget', params: { targetId: page.targetId } })).toEqual({ success: true });
    expect(h.store.all()).toEqual([person]);
    expect(agentCdp.methods()).not.toContain('Target.closeTarget');
  });

  it('forwards a leased tab\'s events, its auto-attached children by session and, once attached by target id, by target', async () => {
    const h = harness();
    const tab = h.personTab();
    const a = await h.host();
    const id = await h.idOf(a, tab);
    await a.request('debugger.attach', { tabId: id });
    const cdp = h.cdp(tab);
    cdp.event('Page.frameNavigated', { frame: { id: cdp.frameId } });
    await a.waitFor('debugger.event', (p) => p.method === 'Page.frameNavigated');
    expect(a.notifications.at(-1)!.params).toEqual({ debuggee: { tabId: id }, method: 'Page.frameNavigated', params: { frame: { id: cdp.frameId } } });
    cdp.event('Target.attachedToTarget', { sessionId: 'C1', targetInfo: { targetId: 'T1', type: 'iframe', title: '', url: 'https://x.test/' }, waitingForDebugger: false });
    await a.waitFor('debugger.event', (p) => p.method === 'Target.attachedToTarget');
    expect((await a.request<{ targetId: string; tabId: number }[]>('debugger.getTargets')).find((t) => t.targetId === 'T1')).toMatchObject({ type: 'iframe', tabId: id, attached: true });
    await expect(a.request('debugger.attach', { targetId: 'T9' })).rejects.toThrow('No target with given id found');
    expect(await a.request('debugger.attach', { targetId: 'T1' })).toEqual({});
    expect(await a.request('debugger.sendCommand', { debuggee: { targetId: 'T1' }, method: 'Runtime.enable', params: {} })).toEqual({ echoed: 'Runtime.enable' });
    expect(cdp.sent.at(-1)).toMatchObject({ method: 'Runtime.enable', sessionId: 'C1' });
    await expect(a.request('debugger.sendCommand', { debuggee: { tabId: id }, sessionId: 'C9', method: 'Runtime.enable', params: {} })).rejects.toThrow('No session with given id');
    cdp.event('Runtime.executionContextCreated', { context: { id: 3 } }, 'C1');
    await a.waitFor('debugger.event', (p) => (p.debuggee as { targetId?: string }).targetId === 'T1');
    expect(a.notifications.filter((n) => n.params.method === 'Runtime.executionContextCreated').map((n) => [n.params.debuggee, n.params.sessionId])).toEqual([
      [{ tabId: id }, 'C1'],
      [{ targetId: 'T1' }, undefined],
    ]);
    await expect(a.request('debugger.sendCommand', { debuggee: { tabId: id }, method: 'Target.attachToTarget', params: { targetId: 'ELSEWHERE', flatten: true } })).rejects.toThrow('No target with given id found');
    cdp.event('Target.detachedFromTarget', { sessionId: 'C1', targetId: 'T1' });
    await a.waitFor('debugger.detached', (p) => (p.debuggee as { targetId?: string }).targetId === 'T1');
  });

  it('a crashed page answers the lease\'s target_closed detach, and the next attach attaches again', async () => {
    const h = harness();
    const tab = h.personTab();
    const a = await h.host();
    const id = await h.idOf(a, tab);
    await a.request('debugger.attach', { tabId: id });
    h.store.rendererGone(tab.tab.tabId, 'crashed');
    expect((await a.waitFor('debugger.detached')).params).toEqual({ debuggee: { tabId: id }, reason: 'target_closed' });
    expect(h.backend.holds(tab.tab.tabId)).toBe(false);
    expect(await a.request('debugger.attach', { tabId: id })).toEqual({ alreadyHeld: false });
  });

  it('a leased tab\'s window.open child is announced as tabs.adopted and reserved to that connection', async () => {
    const h = harness();
    const one = await h.host();
    const two = await h.host();
    const created = await one.request<{ id: number }>('tabs.create', { url: 'about:blank' });
    await one.request('debugger.attach', { tabId: created.id });
    const opener = h.store.all()[0]!;
    h.store.adoptChild(opener, { url: 'about:blank', select: false, webContents: new FakeContents('FRAME-child') as unknown as WebContents });
    const adopted = await one.waitFor('tabs.adopted');
    expect(adopted.params).toEqual({ openerTabId: created.id, tabId: 2, url: 'about:blank' });
    const theirs = (await two.request<{ id: number }[]>('tabs.query')).at(-1)!;
    await expect(two.request('debugger.attach', { tabId: theirs.id })).rejects.toThrow('Tab is held by another agent session');
    expect(two.notifications.some((n) => n.method === 'tabs.adopted')).toBe(false);
  });

  it('a person\'s pop-up resumed later under a leased opener is not taken for a new window', async () => {
    const h = harness();
    const opener = h.personTab();
    const child = h.store.adoptChild(opener, { url: 'https://child.test/', select: false, webContents: new FakeContents('FRAME-p') as unknown as WebContents });
    h.store.suspend(child.tab.tabId);
    const a = await h.host();
    await a.request('debugger.attach', { tabId: await h.idOf(a, opener) });
    h.store.load(child.tab.tabId, 'https://child.test/');
    await settle();
    expect(a.notifications.some((n) => n.method === 'tabs.adopted')).toBe(false);
    expect((await a.request<{ id: number; url: string }[]>('tabs.query')).length).toBe(2);
  });
});
