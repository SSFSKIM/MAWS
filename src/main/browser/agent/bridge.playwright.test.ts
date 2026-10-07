import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Server } from 'node:net';
import type * as PlaywrightCore from 'playwright-core';
import { expect, it, vi } from 'vitest';
import { TabDebugger } from '../debugger';
import { startCdpBridge } from './bridge';

// Decision Log 57 against the pinned playwright-core itself (no Electron): `chromium.connectOverCDP(transport)` takes the
// bridge's in-process transport, attaches to the one page the bridge announces, and every page command it sends reaches
// the page through `TabDebugger.send`; no listening socket is opened; closing the bridge disconnects Playwright.

class FakeElectronDebugger extends EventEmitter {
  attachedTo: string | null = null;
  attach(version: string) {
    this.attachedTo = version;
  }
  detach() {
    this.attachedTo = null;
  }
  isAttached() {
    return this.attachedTo !== null;
  }
  async sendCommand(method: string): Promise<unknown> {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'FRAME-MAIN', loaderId: 'L', url: 'about:blank', securityOrigin: '', mimeType: 'text/html' }, childFrames: [] } };
    return {};
  }
}

it('real playwright-core connects in process through the bridge and finds the one page', async () => {
  const listen = vi.spyOn(Server.prototype, 'listen');
  const raw = new FakeElectronDebugger();
  const tabDebugger = new TabDebugger({ debugger: raw, isDestroyed: () => false } as never);
  const send = vi.spyOn(tabDebugger, 'send');
  const bridge = await startCdpBridge(tabDebugger, { getTitle: () => '', getURL: () => 'about:blank', getUserAgent: () => 'MAWS-UA', focus: () => {} });
  const playwright = createRequire(__filename)('playwright-core') as typeof PlaywrightCore;

  const browser = await playwright.chromium.connectOverCDP(bridge.connect(), { timeout: 5_000 });
  expect(browser.contexts()[0]?.pages()).toHaveLength(1);
  const forwarded = send.mock.calls.map(([method]) => method);
  expect(forwarded).toEqual(expect.arrayContaining(['Page.enable', 'Runtime.enable', 'Target.setAutoAttach']));
  expect(bridge.stats.forwarded).toBe(forwarded.length);
  expect(bridge.stats.blocked).toEqual([]);

  const disconnected = new Promise<void>((resolve) => browser.once('disconnected', () => resolve()));
  await bridge.close({ detach: false });
  await disconnected;
  expect(browser.isConnected()).toBe(false);
  expect(listen).not.toHaveBeenCalled();
  listen.mockRestore();
}, 15_000);
