// The browser's tabs on a forwarded port (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Forwarding"): a loopback link out of a session on another machine opens in the in-app browser on this Mac's listener
// of that machine's port (main's `remote.forward.open`, src/main/lane-b/remote-forward.ts). The tab keeps which forward
// it shows (`BrowserTab.forward`: the machine, its port and the listener's port), persisted with it.
//
// - Provenance is main's listener ownership, read again whenever the tab's page moves: at `browser.tabs.open`
//   (`opened`), at each committed navigation (a new document or an in-page move), and when a page's `window.open` child
//   is made. A URL on a live listener takes that forward; a URL on the tab's own listener's port while that listener is
//   gone (its link dropped) keeps the forward it has; any other URL clears it. So a tab moved from one forward's page to
//   another's names the second, and one that left every forward names none, before a relaunch reads it.
// - `route`, the tab store's load seam: a load of a forwarded tab at its listener's URL whose listener is gone (a
//   relaunch) opens the forward again first, and loads the page on the new listener once it answers. Lazily, at the
//   tab's first load, never at restore: a non-owner confirms the act, and at launch nobody asked for the page. A load
//   asked while the open is pending replaces the one parked (the latest wins); a load elsewhere, or any navigation that
//   moved the tab meanwhile, makes the open's answer stale, and a stale answer touches nothing. A refused or failed open
//   marks the tab `failed` with main's words (the pane's error page; its Retry loads again, which opens again). A
//   listener still live under another port moves the tab there at once.
import { ipcError } from '@shared/ipc/errors';
import type { CommandResult } from '@shared/ipc/schema';
import type { BrowserTab, BrowserTabForward } from '@shared/browser/tab';
import type { MachineRef } from '@shared/machine/ref';
import type { TabEntry, TabStore } from './tabs';

/** Remote lane B's forwards (src/main/lane-b/remote-forward.ts), as the browser reads and opens them. */
export interface BrowserForwards {
  open(machine: MachineRef, port: number): Promise<CommandResult<'remote.forward.open'>>;
  /** The port of this Mac's listener of the machine's port, while one listens. */
  listening(machine: MachineRef, port: number): number | null;
  /** The machine's port the listener at `localPort` forwards, while it listens. */
  at(localPort: number): { machine: MachineRef; port: number } | null;
}

export interface ForwardedTabs {
  opened(tab: BrowserTab): void;
  route(tab: BrowserTab, url: string): string | null;
}

/** The listener's port a URL on this Mac's loopback names, or null for any other URL. */
function localPortOf(url: string): number | null {
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname !== '127.0.0.1' || parsed.port === '') return null;
    return Number(parsed.port);
  } catch {
    return null;
  }
}

function onPort(url: string, localPort: number): string {
  const parsed = new URL(url);
  parsed.port = String(localPort);
  return parsed.toString();
}

const same = (a: BrowserTabForward | undefined, b: BrowserTabForward | undefined) => a?.machine === b?.machine && a?.port === b?.port && a?.localPort === b?.localPort;

type Store = Pick<TabStore, 'entry' | 'update' | 'load' | 'onUpdated' | 'onViewCreated'>;

export function forwardedTabs({ store, forwards, log }: { store: Store; forwards: BrowserForwards; log(line: string): void }): ForwardedTabs {
  /** Each tab's load waiting for its forward to open again: the latest URL asked, and the tab's URL when it was parked. */
  const parked = new Map<string, { url: string; shown: string }>();
  const reopening = new Set<string>();

  /** The forward a page at `url` shows, read from the listeners; see the module comment for a gone listener. */
  function provenance(url: string, was: BrowserTabForward | undefined): BrowserTabForward | undefined {
    const localPort = localPortOf(url);
    if (localPort === null) return undefined;
    const owner = forwards.at(localPort);
    if (owner !== null) return { ...owner, localPort };
    return was?.localPort === localPort ? was : undefined;
  }
  function reread(entry: TabEntry, url: string): void {
    const forward = provenance(url, entry.tab.forward);
    if (!same(forward, entry.tab.forward)) store.update(entry.tab.tabId, { forward });
  }
  // every committed navigation (TabStore sets `committedUrl` before it patches the tab); a restored tab has none yet
  const committed = new WeakMap<TabEntry, string>();
  store.onUpdated((entry) => {
    const url = entry.committedUrl;
    if (url === null || committed.get(entry) === url) return;
    committed.set(entry, url);
    reread(entry, url);
  });
  // a page's `window.open` child, at its first URL
  store.onViewCreated((entry) => {
    if (entry.openerTabId !== null && entry.tab.url !== '') reread(entry, entry.tab.url);
  });

  async function reopen(tabId: string, forward: BrowserTabForward): Promise<void> {
    reopening.add(tabId);
    store.update(tabId, { loading: true, failed: null });
    const result = await forwards.open(forward.machine, forward.port).catch(
      (error: unknown): CommandResult<'remote.forward.open'> => ({ ok: false, error: ipcError('internal', error instanceof Error ? error.message : String(error)) }),
    );
    reopening.delete(tabId);
    const want = parked.get(tabId);
    parked.delete(tabId);
    const entry = store.entry(tabId);
    if (entry === undefined || want === undefined || entry.tab.url !== want.shown) return; // closed, or moved on meanwhile: stale
    if (!result.ok) {
      log(`[browser] tab ${tabId}: port ${forward.port} on ${forward.machine} could not be forwarded again: ${result.error.message}`);
      store.update(tabId, { loading: false, failed: { message: result.error.message } });
      return;
    }
    store.update(tabId, { forward: { ...forward, localPort: result.value.localPort } });
    store.load(tabId, onPort(want.url, result.value.localPort));
  }

  return {
    opened(tab) {
      const entry = store.entry(tab.tabId);
      if (entry !== undefined) reread(entry, tab.url);
    },
    route(tab, url) {
      const { forward } = tab;
      const live = forward === undefined || localPortOf(url) !== forward.localPort ? undefined : forwards.listening(forward.machine, forward.port);
      if (forward === undefined || live === undefined || live === forward.localPort) {
        parked.delete(tab.tabId); // a newer load: whatever was parked is stale
        return url;
      }
      if (live !== null) {
        parked.delete(tab.tabId);
        store.update(tab.tabId, { forward: { ...forward, localPort: live } });
        return onPort(url, live);
      }
      parked.set(tab.tabId, { url, shown: tab.url });
      if (!reopening.has(tab.tabId)) void reopen(tab.tabId, forward);
      return null;
    },
  };
}
