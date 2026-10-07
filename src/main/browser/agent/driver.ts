// The per-tab Playwright driver (E4c execution document, Design §4; A-19, A-33 item 6; Decision Log 1, 2, 33, 34 (a), 35):
// for one tab, the CDP bridge over its TabDebugger, Playwright connected through the bridge's in-process transport
// (Decision Log 57: no socket), and the one page the bridge announces. Made on the first tool call that needs the page (playwright-core is required then, never at startup) and
// kept across navigations and process swaps; dropped when the debugger detaches (a renderer crash) or Playwright's page
// closes, so the next call builds a fresh one; closed at once when the tab's page goes.
//
// The idle close: a driver whose tab's debugger saw no command for BROWSER_BRIDGE_IDLE_MS (anyone's command counts:
// E4b's import and E4d's crop hold it as Playwright's do) while the tab is not busy (the agent holds it or a request is
// pending) first turns auto-attach off on the page session, since Playwright's `waitForDebuggerOnStart: true` would
// otherwise pause every new cross-site frame and worker once nobody resumes them, then closes the bridge (Playwright hears its
// transport close) and detaches the debugger only when focus emulation is off; under 'on' the attachment is
// E4a's to keep. The mode is the one `startBrowser` computed from its env (`focusEmulationMode`), never the default.
//
// A person's JavaScript dialog is never Playwright's to answer: a no-op `dialog` listener stops its auto-dismiss, and
// the dialog itself is the `-run-dialog` wrap's (dialogs.ts).
import { createRequire } from 'node:module';
import type * as PlaywrightCore from 'playwright-core';
import { BROWSER_ACTION_TIMEOUT_MS, BROWSER_ANSWER_MS, BROWSER_BRIDGE_IDLE_MS } from '@shared/maws/browser';
import type { TabDebugger } from '../debugger';
import type { TabEntry } from '../tabs';
import type { FocusEmulationMode } from '../visibility';
import { startCdpBridge, type CdpBridge } from './bridge';

const CONNECT_TIMEOUT_MS = 10_000;
const AUTO_ATTACH_OFF = { autoAttach: false, waitForDebuggerOnStart: false, flatten: true };

export type Playwright = Pick<typeof PlaywrightCore, 'chromium'>;

export interface Driver {
  readonly entry: TabEntry;
  readonly browser: PlaywrightCore.Browser;
  readonly page: PlaywrightCore.Page;
  readonly bridge: CdpBridge;
}

// The e2e seam's reading (Interfaces): no driver, one connected, or one the idle rule closed.
export type DriverState = 'none' | 'connected' | 'idle-closed';

export interface DriversDeps {
  focusEmulation: FocusEmulationMode;
  busy(entry: TabEntry): boolean; // the agent holds the tab or a request is pending for it: never idle-closed
  loadPlaywright?(): Playwright;
  startBridge?: typeof startCdpBridge;
  idleMs?: number;
  log?(line: string): void;
}

interface Slot {
  entry: TabEntry;
  debugger: TabDebugger;
  connecting: Promise<Driver> | null;
  driver: Driver | null;
  closed: boolean; // the tab's page went while connecting
  idle: ReturnType<typeof setTimeout> | null;
  stops: (() => void)[];
}

// Lazily, from the asar's node_modules (114 ms, E4-0 (6)); playwright-core is a production dependency, never bundled.
function loadPlaywrightCore(): Playwright {
  return createRequire(__filename)('playwright-core') as Playwright;
}

export class Drivers {
  private readonly slots = new Map<string, Slot>();
  private readonly idleClosed = new Set<string>();
  private playwright: Playwright | null = null;
  private readonly idleMs: number;

  constructor(private readonly deps: DriversDeps) {
    this.idleMs = deps.idleMs ?? BROWSER_BRIDGE_IDLE_MS;
  }

  // The tab's driver, connected on first use; callers that ask while it connects share the connection.
  for(entry: TabEntry): Promise<Driver> {
    const { tabId } = entry.tab;
    let slot = this.slots.get(tabId);
    if (slot && slot.debugger !== entry.debugger) {
      void this.drop(slot); // the tab has a new page (resumed after a suspension): the old connection is stale
      slot = undefined;
    }
    if (slot?.driver) return Promise.resolve(slot.driver);
    if (slot?.connecting) return slot.connecting;
    if (!entry.debugger || !entry.view) return Promise.reject(new Error('the tab has no page'));
    const fresh: Slot = { entry, debugger: entry.debugger, connecting: null, driver: null, closed: false, idle: null, stops: [] };
    this.slots.set(tabId, fresh);
    fresh.connecting = this.connect(fresh).then(
      (driver) => {
        fresh.connecting = null;
        return driver;
      },
      (error: unknown) => {
        fresh.connecting = null;
        if (this.slots.get(tabId) === fresh) this.slots.delete(tabId);
        throw error;
      },
    );
    return fresh.connecting;
  }

  state(tabId: string): DriverState {
    if (this.slots.get(tabId)?.driver) return 'connected';
    return this.idleClosed.has(tabId) ? 'idle-closed' : 'none';
  }

  // The tab's page is going (closed, suspended, its session deleted): the connection ends at once; E4a detaches.
  async close(tabId: string): Promise<void> {
    this.idleClosed.delete(tabId);
    const slot = this.slots.get(tabId);
    if (!slot) return;
    slot.closed = true; // a connection under way gives up at its next step
    if (slot.connecting) await slot.connecting.catch(() => {});
    await this.drop(slot); // a connection that completed meanwhile ends here
  }

  async stop(): Promise<void> {
    await Promise.all([...this.slots.keys()].map((tabId) => this.close(tabId)));
  }

  // The tab's session exited (Design §4): its driver ends at once, as the idle close ends one (the auto-attach reset,
  // then the detach when focus emulation is off), rather than after BROWSER_BRIDGE_IDLE_MS.
  async retire(tabId: string): Promise<void> {
    const slot = this.slots.get(tabId);
    if (!slot) return;
    slot.closed = true; // a connection under way tears itself down at its next step
    if (slot.connecting) return void (await slot.connecting.catch(() => {}));
    const driver = slot.driver;
    this.release(slot);
    if (driver) await this.teardown(slot.debugger, driver.bridge);
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  private async connect(slot: Slot): Promise<Driver> {
    const { entry } = slot;
    const tabClosed = () => new Error('the tab closed while MAWS attached to it');
    this.playwright ??= (this.deps.loadPlaywright ?? loadPlaywrightCore)();
    let bridge: CdpBridge | null = null;
    let browser: PlaywrightCore.Browser;
    let page: PlaywrightCore.Page | undefined;
    try {
      await slot.debugger.attach(); // idempotent: E4a's attachment, shared
      if (slot.closed) throw tabClosed();
      bridge = await (this.deps.startBridge ?? startCdpBridge)(slot.debugger, entry.view!.webContents, { log: this.deps.log });
      if (slot.closed) throw tabClosed();
      browser = await this.playwright.chromium.connectOverCDP(bridge.connect(), { timeout: CONNECT_TIMEOUT_MS });
      if (slot.closed) throw tabClosed();
      page = browser.contexts()[0]?.pages()[0];
      if (!page) throw new Error('the bridge announced no page');
    } catch (error) {
      // Playwright may have set `waitForDebuggerOnStart` before it failed, and the attachment is this attempt's to give
      // back: the idle close's teardown (Decision Log 1, 34 (a))
      await this.teardown(slot.debugger, bridge);
      throw error;
    }
    page.setDefaultTimeout(BROWSER_ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(BROWSER_ANSWER_MS);
    page.on('dialog', () => {}); // Decision Log 33, 35: never Playwright's auto-dismiss
    const driver: Driver = { entry, browser, page: page!, bridge: bridge! };
    slot.driver = driver;
    this.idleClosed.delete(entry.tab.tabId);
    page.on('close', () => {
      if (slot.driver === driver) void this.drop(slot);
    });
    slot.stops.push(
      slot.debugger.onCommand(() => this.arm(slot)),
      slot.debugger.onDetach(() => void this.drop(slot)), // a crash (E4a's store detaches) or anyone's detach
    );
    this.arm(slot);
    return driver;
  }

  private arm(slot: Slot): void {
    if (slot.idle) clearTimeout(slot.idle);
    slot.idle = setTimeout(() => {
      slot.idle = null;
      if (this.deps.busy(slot.entry)) this.arm(slot);
      else void this.idleClose(slot);
    }, this.idleMs);
  }

  private async idleClose(slot: Slot): Promise<void> {
    const driver = slot.driver;
    if (!driver || this.slots.get(slot.entry.tab.tabId) !== slot) return;
    this.release(slot);
    this.idleClosed.add(slot.entry.tab.tabId);
    // the reset is not a use of the page, and the detach that may follow is this close's own: both unobserved (released)
    await this.teardown(slot.debugger, driver.bridge);
  }

  // Ends a connection that leaves the page alive: auto-attach off while attached (no new frame or worker waits for a
  // debugger nobody runs), then the bridge closed, detaching only when focus emulation is off (under 'on' the attachment
  // is E4a's). With no bridge (it never started) the detach is the debugger's own.
  private async teardown(dbg: TabDebugger, bridge: CdpBridge | null): Promise<void> {
    const detach = this.deps.focusEmulation === 'off';
    if (dbg.attached) await dbg.send('Target.setAutoAttach', AUTO_ATTACH_OFF).catch(() => {});
    if (bridge) await bridge.close({ detach }).catch((error: unknown) => this.deps.log?.(`the CDP bridge did not close cleanly: ${String(error)}`));
    else if (detach) dbg.detach();
  }

  // A crash, Playwright's page closing, the tab going: the connection ends and nothing of it is kept.
  private async drop(slot: Slot): Promise<void> {
    if (this.slots.get(slot.entry.tab.tabId) !== slot) return;
    slot.closed = true; // a connection still under way ends at its next step rather than outside the map
    const driver = slot.driver;
    this.release(slot);
    if (driver) await driver.bridge.close({ detach: false }).catch((error: unknown) => this.deps.log?.(`the CDP bridge did not close cleanly: ${String(error)}`));
  }

  private release(slot: Slot): void {
    this.slots.delete(slot.entry.tab.tabId);
    for (const stop of slot.stops.splice(0)) stop();
    if (slot.idle) clearTimeout(slot.idle);
    slot.idle = null;
    slot.driver = null;
  }
}
