import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_ACTION_TIMEOUT_MS, BROWSER_ANSWER_MS, BROWSER_BRIDGE_IDLE_MS } from '@shared/maws/browser';
import type { CommandPhase } from '../debugger';
import type { TabEntry } from '../tabs';
import type { CdpBridge } from './bridge';
import { Drivers, type DriversDeps } from './driver';

// The per-tab driver (E4c Design §4; Decision Log 1, 34 (a), 35): a fake bridge and a fake playwright-core injected, the
// tab's TabDebugger a fake that records what goes through it and lets the test observe commands and detach it.

class FakeDebugger {
  attached = false;
  readonly sent: { method: string; params: unknown }[] = [];
  readonly order: string[];
  private readonly observers = new Set<(phase: CommandPhase) => void>();
  private readonly detachListeners = new Set<(reason: string) => void>();
  constructor(order: string[]) {
    this.order = order;
  }
  attach = vi.fn(async () => {
    this.attached = true;
  });
  detach = vi.fn(() => {
    if (!this.attached) return;
    this.attached = false;
    for (const listener of [...this.detachListeners]) listener('detached');
  });
  send = vi.fn(async (method: string, params?: unknown) => {
    this.sent.push({ method, params });
    this.order.push(`send ${method}`);
    this.command(method);
    return {};
  });
  onCommand(observer: (phase: CommandPhase) => void) {
    this.observers.add(observer);
    return () => void this.observers.delete(observer);
  }
  onDetach(listener: (reason: string) => void) {
    this.detachListeners.add(listener);
    return () => void this.detachListeners.delete(listener);
  }
  // another holder's command (E4b's import, E4d's crop) or Playwright's through the bridge
  command(method = 'Runtime.evaluate') {
    for (const observer of [...this.observers]) observer({ phase: 'send', id: 1, method, params: undefined, sessionId: '', at: 0 });
  }
  crash(reason = 'crashed') {
    this.attached = false;
    for (const listener of [...this.detachListeners]) listener(reason);
  }
}

function fakePlaywright(order: string[]) {
  const pages: ReturnType<typeof fakePage>[] = [];
  const browsers: { on: ReturnType<typeof vi.fn>; contexts: () => unknown[] }[] = [];
  function fakePage() {
    const listeners = new Map<string, (() => void)[]>();
    return {
      setDefaultTimeout: vi.fn(),
      setDefaultNavigationTimeout: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => void listeners.set(event, [...(listeners.get(event) ?? []), listener])),
      fire: (event: string) => listeners.get(event)?.forEach((listener) => listener()),
      listeners,
    };
  }
  const connectOverCDP = vi.fn(async (transport: { name: string }) => {
    order.push(`connect ${transport.name}`);
    const page = fakePage();
    pages.push(page);
    const browser = { on: vi.fn(), contexts: () => [{ pages: () => [page] }] };
    browsers.push(browser);
    return browser;
  });
  return { module: { chromium: { connectOverCDP } }, connectOverCDP, pages, browsers };
}

function harness(focusEmulation: 'on' | 'off' = 'off') {
  const order: string[] = [];
  const playwright = fakePlaywright(order);
  const loadPlaywright = vi.fn(() => playwright.module as never);
  const bridges: (CdpBridge & { close: ReturnType<typeof vi.fn> })[] = [];
  let bridgeCount = 0;
  const startBridge = vi.fn(async () => {
    const n = ++bridgeCount;
    const bridge = {
      connect: vi.fn(() => ({ name: `transport-${n}`, send: vi.fn(), close: vi.fn() })),
      pageSessionId: 'maws-bridge-page-1',
      stats: {} as never,
      connected: true,
      close: vi.fn(async ({ detach }: { detach: boolean }) => {
        order.push(`bridge ${n} close detach=${detach}`);
        if (detach) entries.get('b_000000000001')?.debugger?.detach();
      }),
    };
    bridges.push(bridge);
    return bridge;
  });
  const busy = new Set<string>();
  const entries = new Map<string, TabEntry>();
  const entry = (tabId = 'b_000000000001') => {
    let found = entries.get(tabId);
    if (!found) {
      const dbg = new FakeDebugger(order);
      found = { tab: { tabId, control: 'idle' }, view: { webContents: { id: 1 } }, debugger: dbg } as unknown as TabEntry;
      entries.set(tabId, found);
    }
    return found;
  };
  const dbg = (tabId = 'b_000000000001') => entry(tabId).debugger as unknown as FakeDebugger;
  const deps: DriversDeps = { focusEmulation, busy: (e) => busy.has(e.tab.tabId), loadPlaywright, startBridge };
  const drivers = new Drivers(deps);
  return { drivers, order, playwright, loadPlaywright, startBridge, bridges, busy, entry, dbg };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Drivers: connecting (Design §4)', () => {
  it('loads playwright-core only for the first driver, connects through the bridge and keeps the one page', async () => {
    const h = harness();
    expect(h.loadPlaywright).not.toHaveBeenCalled();
    expect(h.drivers.state('b_000000000001')).toBe('none');
    const driver = await h.drivers.for(h.entry());
    expect(h.startBridge).toHaveBeenCalledWith(h.dbg(), h.entry().view!.webContents, expect.anything());
    expect(h.playwright.connectOverCDP).toHaveBeenCalledWith(expect.objectContaining({ name: 'transport-1' }), { timeout: 10_000 }); // in process (Decision Log 57)
    const page = h.playwright.pages[0];
    expect(driver.page).toBe(page);
    expect(page.setDefaultTimeout).toHaveBeenCalledWith(BROWSER_ACTION_TIMEOUT_MS);
    expect(page.setDefaultNavigationTimeout).toHaveBeenCalledWith(BROWSER_ANSWER_MS);
    // a no-op dialog listener, so Playwright never auto-dismisses a person's dialog (Decision Log 33, 35)
    expect(page.listeners.get('dialog')).toHaveLength(1);
    expect(h.drivers.state('b_000000000001')).toBe('connected');

    expect(await h.drivers.for(h.entry())).toBe(driver);
    await h.drivers.for(h.entry('b_000000000002'));
    expect(h.loadPlaywright).toHaveBeenCalledTimes(1);
    expect(h.startBridge).toHaveBeenCalledTimes(2);
  });

  it('shares one connection between callers that ask at once', async () => {
    const h = harness();
    const [one, two] = await Promise.all([h.drivers.for(h.entry()), h.drivers.for(h.entry())]);
    expect(one).toBe(two);
    expect(h.startBridge).toHaveBeenCalledTimes(1);
  });

  it('closes the bridge when the connection fails, and tries afresh on the next call', async () => {
    const h = harness();
    h.playwright.connectOverCDP.mockRejectedValueOnce(new Error('Browser.getVersion: the page is no longer attached'));
    await expect(h.drivers.for(h.entry())).rejects.toThrow('no longer attached');
    expect(h.bridges[0].close).toHaveBeenCalledWith({ detach: false });
    expect(h.drivers.state('b_000000000001')).toBe('none');
    await h.drivers.for(h.entry());
    expect(h.drivers.state('b_000000000001')).toBe('connected');
  });

  it('refuses a tab with no page', async () => {
    const h = harness();
    const entry = h.entry();
    entry.view = null;
    await expect(h.drivers.for(entry)).rejects.toThrow('the tab has no page');
    expect(h.startBridge).not.toHaveBeenCalled();
  });
});

describe('Drivers: the idle close (Decision Log 1, 34 (a))', () => {
  it("with focus emulation off: after 5 min without a command, resets auto-attach first, then closes and detaches", async () => {
    const h = harness('off');
    await h.drivers.for(h.entry());
    await vi.advanceTimersByTimeAsync(BROWSER_BRIDGE_IDLE_MS - 1);
    expect(h.bridges[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.dbg().sent).toEqual([{ method: 'Target.setAutoAttach', params: { autoAttach: false, waitForDebuggerOnStart: false, flatten: true } }]);
    expect(h.order.slice(-2)).toEqual(['send Target.setAutoAttach', 'bridge 1 close detach=true']);
    expect(h.dbg().attached).toBe(false);
    expect(h.drivers.state('b_000000000001')).toBe('idle-closed');

    // the next call connects afresh
    const driver = await h.drivers.for(h.entry());
    expect(driver.page).toBe(h.playwright.pages[1]);
    expect(h.drivers.state('b_000000000001')).toBe('connected');
  });

  it('with focus emulation on: closes the connection but keeps the attachment', async () => {
    const h = harness('on');
    await h.drivers.for(h.entry());
    await vi.advanceTimersByTimeAsync(BROWSER_BRIDGE_IDLE_MS);
    expect(h.order.slice(-2)).toEqual(['send Target.setAutoAttach', 'bridge 1 close detach=false']);
    expect(h.dbg().attached).toBe(true);
    expect(h.drivers.state('b_000000000001')).toBe('idle-closed');
  });

  it("counts every command the tab's debugger sees, another holder's included", async () => {
    const h = harness();
    await h.drivers.for(h.entry());
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    h.dbg().command('Network.getCookies'); // E4b's import, say
    await vi.advanceTimersByTimeAsync(BROWSER_BRIDGE_IDLE_MS - 1);
    expect(h.drivers.state('b_000000000001')).toBe('connected');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.drivers.state('b_000000000001')).toBe('idle-closed');
  });

  it('never closes while the agent holds the tab or a request is pending for it', async () => {
    const h = harness();
    await h.drivers.for(h.entry());
    h.busy.add('b_000000000001');
    await vi.advanceTimersByTimeAsync(3 * BROWSER_BRIDGE_IDLE_MS);
    expect(h.drivers.state('b_000000000001')).toBe('connected');
    h.busy.delete('b_000000000001');
    await vi.advanceTimersByTimeAsync(BROWSER_BRIDGE_IDLE_MS);
    expect(h.drivers.state('b_000000000001')).toBe('idle-closed');
  });
});

describe('Drivers: crash and close (Design §4, §11)', () => {
  it('drops the driver when the debugger detaches (a renderer crash), and builds a fresh one next time', async () => {
    const h = harness();
    await h.drivers.for(h.entry());
    h.dbg().crash();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.bridges[0].close).toHaveBeenCalledWith({ detach: false });
    expect(h.drivers.state('b_000000000001')).toBe('none');
    await vi.advanceTimersByTimeAsync(BROWSER_BRIDGE_IDLE_MS);
    expect(h.dbg().sent).toEqual([]); // no idle close for a dropped driver
    await h.drivers.for(h.entry());
    expect(h.startBridge).toHaveBeenCalledTimes(2);
  });

  it("drops the driver when Playwright's page closes", async () => {
    const h = harness();
    await h.drivers.for(h.entry());
    h.playwright.pages[0].fire('close');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.drivers.state('b_000000000001')).toBe('none');
  });

  it("closes at once when the tab's page goes, leaving the detach to E4a", async () => {
    const h = harness();
    await h.drivers.for(h.entry());
    await h.drivers.close('b_000000000001');
    expect(h.bridges[0].close).toHaveBeenCalledWith({ detach: false });
    expect(h.drivers.state('b_000000000001')).toBe('none');
    expect(h.dbg().sent).toEqual([]);
  });

  it('closes a driver still connecting when its tab goes', async () => {
    const h = harness();
    let release!: () => void;
    h.playwright.connectOverCDP.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ on: vi.fn(), contexts: () => [{ pages: () => [{ setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(), on: vi.fn() }] }] } as never);
        }),
    );
    const pending = h.drivers.for(h.entry());
    await vi.advanceTimersByTimeAsync(0);
    const closed = h.drivers.close('b_000000000001');
    release();
    await expect(pending).rejects.toThrow('the tab closed');
    await closed;
    expect(h.bridges[0].close).toHaveBeenCalledWith({ detach: false });
    expect(h.drivers.state('b_000000000001')).toBe('none');
  });

  it('stop closes every driver', async () => {
    const h = harness();
    await h.drivers.for(h.entry());
    await h.drivers.for(h.entry('b_000000000002'));
    await h.drivers.stop();
    expect(h.bridges.map((bridge) => bridge.close.mock.calls)).toEqual([[[{ detach: false }]], [[{ detach: false }]]]);
  });
});
