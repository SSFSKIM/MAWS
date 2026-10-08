import { afterEach, describe, expect, it } from 'vitest';
import { BROWSER_CURSOR_CHANNEL } from '@shared/browser/cursor';
import { CURSOR_HIDE_GRACE_MS, PERSON_USING_TAB } from './presence';
import { harness, takeDown } from './server.fake';

// What the person sees and keeps while an agent drives a tab through cua (the in-app browser spec of 2026-10-08, M3),
// through the real socket: the takeover gate on acting commands, control and the cursor by lease, the activity told to
// the windows (never typed text), the panel's badge, the chooser left off on disconnect, the agent's downloads.

afterEach(takeDown);

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function leasedTab(h: ReturnType<typeof harness>, group?: { key: string; title: string }) {
  const host = await h.host();
  const created = await host.request<{ id: number }>('tabs.create', { url: 'about:blank', ...(group && { group }) });
  const entry = h.store.all().at(-1)!;
  await host.request('debugger.attach', { tabId: created.id });
  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000) =>
    host.request<T>('debugger.sendCommand', { debuggee: { tabId: created.id }, method, params, timeoutMs });
  return { host, id: created.id, entry, send, cdp: h.cdp(entry) };
}

describe('the takeover gate through a lease', () => {
  it('a Runtime.callFunctionOn while the person holds the tab is held, then refused within its deadline, never sent; a screenshot passes and leaves control human', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    h.store.setControl(t.entry.tab.tabId, 'human');
    const started = Date.now();
    await expect(t.send('Runtime.callFunctionOn', { functionDeclaration: 'function(){}' }, 500)).rejects.toThrow(PERSON_USING_TAB);
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(380);
    expect(waited).toBeLessThan(500); // answered before the command's own deadline cancels it
    expect(t.cdp.methods()).not.toContain('Runtime.callFunctionOn');
    expect(await t.send('Page.captureScreenshot', { format: 'jpeg' })).toEqual({ echoed: 'Page.captureScreenshot' });
    expect(t.entry.tab.control).toBe('human');
  });

  it('an acting command within 3 s of the person\'s touch on an idle tab is held and the tab reads human; Hand back lets it through', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    t.entry.input.emit({ kind: 'mouse', source: 'human', at: Date.now() });
    expect(t.entry.tab.control).toBe('idle');
    const sent = t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    await settle();
    expect(t.entry.tab.control).toBe('human');
    expect(t.cdp.methods()).not.toContain('Input.dispatchMouseEvent');
    h.store.setControl(t.entry.tab.tabId, 'idle'); // Hand back
    expect(await sent).toEqual({ echoed: 'Input.dispatchMouseEvent' });
    expect(t.entry.tab.control).toBe('agent');
  });

  it('Target.closeTarget during takeover is held, then refused: the person\'s page never vanishes under their hands', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    const target = (await t.host.request<{ targetId: string; tabId: number }[]>('debugger.getTargets')).find((x) => x.tabId === t.id)!;
    h.store.setControl(t.entry.tab.tabId, 'human');
    await expect(t.send('Target.closeTarget', { targetId: target.targetId }, 400)).rejects.toThrow(PERSON_USING_TAB);
    expect(h.store.entry(t.entry.tab.tabId)).toBe(t.entry);
  });

  it('an acting command makes the tab the agent\'s; letting go of the lease returns it to idle and hides the cursor; cursor.move draws', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 6 });
    expect(t.entry.tab.control).toBe('agent');
    expect(await t.host.request('cursor.move', { tabId: t.id, x: 40, y: 50 })).toEqual({});
    const page = h.page(t.entry);
    expect(page.sentToPage).toContainEqual({ channel: BROWSER_CURSOR_CHANNEL, message: { kind: 'move', x: 40, y: 50 } });
    await t.host.request('debugger.detach', { tabId: t.id });
    expect(t.entry.tab.control).toBe('idle');
    expect(page.sentToPage.at(-1)).toEqual({ channel: BROWSER_CURSOR_CHANNEL, message: { kind: 'hide' } });
  });

  it("an agent's screenshot is forwarded only after the cursor's hide and its grace; the next mouse event draws the cursor again", async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 6 });
    await t.host.request('cursor.move', { tabId: t.id, x: 40, y: 50 });
    const page = h.page(t.entry);
    const order: [string, number][] = [];
    const send = page.send.bind(page);
    page.send = (channel: string, message: unknown) => {
      order.push([(message as { kind: string }).kind, Date.now()]);
      send(channel, message);
    };
    const capture = t.cdp.sendCommand.bind(t.cdp);
    t.cdp.sendCommand = (method: string, params?: unknown, sessionId?: string) => {
      order.push([method, Date.now()]);
      return capture(method, params, sessionId);
    };
    expect(await t.send('Page.captureScreenshot', { format: 'jpeg' })).toEqual({ echoed: 'Page.captureScreenshot' });
    const shot = order.filter(([what]) => what === 'hide' || what === 'Page.captureScreenshot');
    expect(shot.map(([what]) => what)).toEqual(['hide', 'Page.captureScreenshot']);
    expect(shot[1]![1] - shot[0]![1]).toBeGreaterThanOrEqual(CURSOR_HIDE_GRACE_MS - 5); // timer granularity
    await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 7, y: 8 });
    expect(page.sentToPage.at(-1)).toEqual({ channel: BROWSER_CURSOR_CHANNEL, message: { kind: 'move', x: 7, y: 8 } });
  });
});

describe("the vendor's screenshot is a screencast first (BS:43892-44050; the spec's final-review rule)", () => {
  // tab.screenshot() and the AX state's screenshot bound the screencast to the viewport (css mode, BS:43985-44016); the
  // vendor's device-mode capture of the surface after each cell (its response metadata, BS:65063) does not
  const VIEWPORT_SCREENCAST = { everyNthFrame: 1, format: 'jpeg', maxHeight: 800, maxWidth: 1280, quality: 80 };
  const SURFACE_SCREENCAST = { everyNthFrame: 1, format: 'jpeg', quality: 80 };

  it('its commands read: an idle tab stays idle, and while the person holds the tab they pass at once and leave it human', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    await t.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
    await t.send('Page.screencastFrameAck', { sessionId: 1 });
    await t.send('Page.stopScreencast');
    expect(t.entry.tab.control).toBe('idle');
    h.store.setControl(t.entry.tab.tabId, 'human');
    const started = Date.now();
    expect(await t.send('Page.startScreencast', { format: 'jpeg' }, 500)).toEqual({ echoed: 'Page.startScreencast' });
    expect(await t.send('Page.stopScreencast', {}, 500)).toEqual({ echoed: 'Page.stopScreencast' });
    expect(Date.now() - started).toBeLessThan(380); // never held for the person
    expect(t.entry.tab.control).toBe('human');
  });

  it('Page.startScreencast is forwarded only after the cursor\'s hide and its grace', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 6 });
    await t.host.request('cursor.move', { tabId: t.id, x: 40, y: 50 });
    const page = h.page(t.entry);
    const order: [string, number][] = [];
    const send = page.send.bind(page);
    page.send = (channel: string, message: unknown) => {
      order.push([(message as { kind: string }).kind, Date.now()]);
      send(channel, message);
    };
    const command = t.cdp.sendCommand.bind(t.cdp);
    t.cdp.sendCommand = (method: string, params?: unknown, sessionId?: string) => {
      order.push([method, Date.now()]);
      return command(method, params, sessionId);
    };
    await t.send('Page.startScreencast', VIEWPORT_SCREENCAST);
    const shot = order.filter(([what]) => what === 'hide' || what === 'Page.startScreencast');
    expect(shot.map(([what]) => what)).toEqual(['hide', 'Page.startScreencast']);
    expect(shot[1]![1] - shot[0]![1]).toBeGreaterThanOrEqual(CURSOR_HIDE_GRACE_MS - 5); // timer granularity
    // the vendor's own unbounded capture after a cell (its response metadata, which nobody is shown): the cursor stays
    order.length = 0;
    await t.send('Page.stopScreencast');
    await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 7, y: 8 });
    await t.send('Page.startScreencast', SURFACE_SCREENCAST);
    expect(order.map(([what]) => what)).toEqual(['Page.stopScreencast', 'move', 'Input.dispatchMouseEvent', 'Page.startScreencast']);
  });

  it('one Screenshot row per screenshot: at the first frame after a start, or at a capture, so the 2 s fallback is one row', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    const frame = (sessionId: number) => t.cdp.event('Page.screencastFrame', { data: 'AAAA', sessionId, metadata: { timestamp: Date.now() / 1000 } });
    // the screencast answers: frames after the start, one row
    await t.send('Page.startScreencast', VIEWPORT_SCREENCAST);
    frame(1);
    frame(2);
    await t.send('Page.stopScreencast');
    await t.send('Page.screencastFrameAck', { sessionId: 2 });
    frame(3); // late, after the stop
    await settle();
    expect(h.activities().map((a) => a.activity)).toEqual([{ kind: 'tabOpened', url: 'about:blank' }, { kind: 'screenshot' }]);
    // no frame within the vendor's 2 s: it stops the screencast and captures instead, one row
    await t.send('Page.startScreencast', VIEWPORT_SCREENCAST);
    await t.send('Page.stopScreencast');
    await t.send('Page.captureScreenshot', { format: 'jpeg' });
    await settle();
    expect(h.activities().map((a) => a.activity).filter((a) => a.kind === 'screenshot')).toHaveLength(2);
    // the vendor's own unbounded capture of the surface after a cell is not the agent's screenshot: no row
    await t.send('Page.startScreencast', SURFACE_SCREENCAST);
    frame(4);
    await t.send('Page.stopScreencast');
    await settle();
    expect(h.activities().map((a) => a.activity).filter((a) => a.kind === 'screenshot')).toHaveLength(2);
    // the frames reached the host as any event does
    expect(t.host.notifications.filter((n) => n.method === 'debugger.event' && n.params.method === 'Page.screencastFrame')).toHaveLength(4);
  });
});

describe('the agent\'s activity, told to the windows', () => {
  it('a tab opened, a navigation, a labelled click, typing as a count (never the text), a key, a screenshot, a tab closed; in the connection\'s session', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    t.cdp.replies['DOM.getNodeForLocation'] = { backendNodeId: 9 };
    t.cdp.replies['DOM.describeNode'] = { node: { localName: 'button', nodeName: 'BUTTON' } };
    t.cdp.replies['Accessibility.getPartialAXTree'] = { nodes: [{ name: { value: 'Submit' } }] };
    t.cdp.event('Page.frameNavigated', { frame: { id: t.cdp.frameId, url: 'https://shop.test/cart', loaderId: 'L' } });
    t.cdp.event('Page.frameNavigated', { frame: { id: 'CHILD', parentId: t.cdp.frameId, url: 'https://ads.test/' } });
    await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 100, y: 80, button: 'left', clickCount: 1 });
    await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 100, y: 80, button: 'left', clickCount: 1 });
    await t.send('Input.insertText', { text: 'hunter2-secret' });
    await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', text: '\r' });
    await t.send('Page.captureScreenshot', { format: 'jpeg' });
    const target = (await t.host.request<{ targetId: string; tabId: number }[]>('debugger.getTargets')).find((x) => x.tabId === t.id)!;
    await t.send('Target.closeTarget', { targetId: target.targetId });
    await settle();
    // the press's node is asked before the press reaches the page
    const methods = t.cdp.methods();
    expect(methods.indexOf('DOM.getNodeForLocation')).toBeLessThan(methods.indexOf('Input.dispatchMouseEvent'));
    expect(t.cdp.sent.find((c) => c.method === 'DOM.getNodeForLocation')!.params).toMatchObject({ x: 100, y: 80, ignorePointerEventsNone: false }); // the cursor's overlay is never the node
    expect(h.activities().map((a) => a.activity)).toEqual([
      { kind: 'tabOpened', url: 'about:blank' },
      { kind: 'navigated', url: 'https://shop.test/cart', title: '' },
      { kind: 'clicked', x: 100, y: 80, label: 'button Submit' },
      { kind: 'typed', chars: 14 },
      { kind: 'key', key: 'Enter' },
      { kind: 'screenshot' },
      { kind: 'tabClosed', url: 'about:blank' },
    ]);
    expect(new Set(h.activities().map((a) => `${a.appSessionId}/${a.tabId}`))).toEqual(new Set([`A/${t.entry.tab.tabId}`]));
    expect(JSON.stringify(h.emitted)).not.toContain('hunter2'); // typed text never leaves main
    // kept for the app's life, as told: what a window lists when the session's transcript mounts
    expect(h.backend.activities('A' as never)).toEqual(h.activities());
    expect(h.backend.activities('B' as never)).toEqual([]);
  });

  it('a navigation while the person holds the tab is theirs, not reported: human, or idle and touched within 3 s', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    const navigate = (url: string) => t.cdp.event('Page.frameNavigated', { frame: { id: t.cdp.frameId, url, loaderId: 'L' } });
    h.store.setControl(t.entry.tab.tabId, 'human');
    navigate('https://person.test/human');
    h.store.setControl(t.entry.tab.tabId, 'idle');
    t.entry.input.emit({ kind: 'mouse', source: 'human', at: Date.now() }); // the agent-idle timer lapsed; the person clicks a link
    navigate('https://person.test/idle-touched');
    t.entry.input.lastHumanAt = Date.now() - 3_100;
    navigate('https://shop.test/agent-timer'); // idle, nobody near: the agent's own page work
    await settle();
    expect(h.activities().map((a) => a.activity).filter((a) => a.kind === 'navigated')).toEqual([{ kind: 'navigated', url: 'https://shop.test/agent-timer', title: '' }]);
  });

  it('a click whose node cannot be named in time is told with no label', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    t.cdp.hang.add('DOM.getNodeForLocation');
    await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 2, clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(h.activities().map((a) => a.activity).at(-1)).toEqual({ kind: 'clicked', x: 1, y: 2, label: null });
  });
});

describe('the panel\'s badge', () => {
  it('a tab created in a group shows "agent", the group\'s name once the agent names it, nothing once ungrouped or let go', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h, { key: 's1', title: 'cua' });
    expect(t.entry.tab.agentBadge).toBe('agent');
    await t.host.request('group.title', { windowId: 7, key: 's1', title: 'Checkout flow' });
    expect(t.entry.tab.agentBadge).toBe('Checkout flow');
    await t.host.request('tabs.ungroup', { tabId: t.id });
    expect(t.entry.tab.agentBadge).toBeNull();
    const second = await t.host.request<{ id: number }>('tabs.create', { url: 'about:blank', group: { key: 's1', title: 'Checkout flow' } });
    const entry = h.store.all().at(-1)!;
    expect([second.id > t.id, entry.tab.agentBadge]).toEqual([true, 'Checkout flow']);
    await t.host.close();
    await settle();
    expect(entry.tab.agentBadge).toBeNull(); // the person's tab now
    expect(h.store.entry(entry.tab.tabId)).toBe(entry);
  });
});

describe('the file chooser and the agent\'s downloads', () => {
  it('a disconnect during a file-chooser wait switches interception off, so the person\'s next file-input click opens the picker', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    await t.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await t.host.close();
    await settle();
    expect(t.cdp.sent.filter((c) => c.method === 'Page.setInterceptFileChooserDialog').map((c) => c.params)).toEqual([{ enabled: true }, { enabled: false }]);
  });

  it('reports a leased tab\'s download to its host in Chrome\'s shape, tells the windows its end, and records a completed one only', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    expect(h.backend.downloads.owns(t.entry)).toBe(true);
    const end = h.backend.downloads.started(t.entry, { url: 'http://127.0.0.1:9/r', finalUrl: 'http://127.0.0.1:9/report.pdf', path: '/Users/o/Downloads/cua-report.pdf' });
    const created = await t.host.waitFor('downloads.created');
    expect(created.params).toEqual({ id: expect.any(Number), url: 'http://127.0.0.1:9/r', finalUrl: 'http://127.0.0.1:9/report.pdf', filename: '/Users/o/Downloads/cua-report.pdf', state: 'in_progress' });
    end({ state: 'completed', path: '/Users/o/Downloads/cua-report.pdf', bytes: 7741 });
    expect((await t.host.waitFor('downloads.changed')).params).toEqual({ id: created.params.id, filename: '/Users/o/Downloads/cua-report.pdf', state: 'complete' });
    const cancelled = h.backend.downloads.started(t.entry, { url: 'http://127.0.0.1:9/b', finalUrl: 'http://127.0.0.1:9/b', path: '/Users/o/Downloads/b.bin' });
    cancelled({ state: 'cancelled', path: '/Users/o/Downloads/b.bin', bytes: 0 });
    expect((await t.host.waitFor('downloads.changed', (p) => p.id !== created.params.id)).params).toMatchObject({ state: 'interrupted', error: 'USER_CANCELED' });
    await settle();
    expect(h.recorded).toEqual([{ appSessionId: 'A', tabId: t.entry.tab.tabId, path: '/Users/o/Downloads/cua-report.pdf', filename: 'cua-report.pdf', url: 'http://127.0.0.1:9/report.pdf', bytes: 7741 }]);
    expect(h.activities().map((a) => a.activity).filter((a) => a.kind === 'download')).toEqual([
      { kind: 'download', filename: 'cua-report.pdf', state: 'complete' },
      { kind: 'download', filename: 'b.bin', state: 'cancelled' },
    ]);
    expect(h.backend.downloads.owns(h.personTab())).toBe(false); // a tab under no lease: the person's
  });

  it('a leased tab\'s download is the agent\'s only while the person does not hold it (the rule dialogs and navigations follow)', async () => {
    const h = harness({ presence: true });
    const t = await leasedTab(h);
    const { tabId } = t.entry.tab;
    expect(h.backend.downloads.owns(t.entry)).toBe(true); // idle, nobody near: the agent's own page work
    t.entry.input.emit({ kind: 'mouse', source: 'human', at: Date.now() }); // the person touched the idle tab
    expect(t.entry.tab.control).toBe('idle');
    expect(h.backend.downloads.owns(t.entry)).toBe(false);
    t.entry.input.lastHumanAt = Date.now() - 3_100;
    expect(h.backend.downloads.owns(t.entry)).toBe(true);
    h.store.setControl(tabId, 'human');
    expect(h.backend.downloads.owns(t.entry)).toBe(false);
    h.store.setControl(tabId, 'agent');
    expect(h.backend.downloads.owns(t.entry)).toBe(true);
  });
});
