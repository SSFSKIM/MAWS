// The browser's tabs on a forwarded port (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Forwarding"): a loopback link out of a session on another machine opens in the in-app browser on this Mac's listener
// of that machine's port (main's `remote.forward.open`, src/main/lane-b/remote-forward.ts). The tab keeps which forward
// it shows (`BrowserTab.forward`: the machine, its port and the listener's port), persisted with it.
//
// - `opened`: a tab `browser.tabs.open` opened at a forward's listener (`http(s)://127.0.0.1:<localPort>/…`, a listener
//   live now) records that forward.
// - `route`, the tab store's load seam: a load of a forwarded tab at its listener's URL whose listener is gone (a
//   relaunch) opens the forward again first, and loads the same path on the new listener once it answers. Lazily, at
//   the tab's first load, never at restore: a non-owner confirms the act, and at launch nobody asked for the page. A
//   refused or failed open marks the tab `failed` with main's words (the pane's error page; its Retry loads again, which
//   opens again). A listener still live under another port moves the tab there at once. A load elsewhere (the person
//   navigated away from the forward) is left alone.
import { ipcError } from '@shared/ipc/errors';
import type { CommandResult } from '@shared/ipc/schema';
import type { BrowserTab, BrowserTabForward } from '@shared/browser/tab';
import type { MachineRef } from '@shared/machine/ref';
import type { TabStore } from './tabs';

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

export function forwardedTabs({ store, forwards, log }: { store: Pick<TabStore, 'entry' | 'update' | 'load'>; forwards: BrowserForwards; log(line: string): void }): ForwardedTabs {
  const reopening = new Set<string>();

  async function reopen(tabId: string, forward: BrowserTabForward, url: string): Promise<void> {
    reopening.add(tabId);
    store.update(tabId, { loading: true, failed: null });
    const result = await forwards.open(forward.machine, forward.port).catch(
      (error: unknown): CommandResult<'remote.forward.open'> => ({ ok: false, error: ipcError('internal', error instanceof Error ? error.message : String(error)) }),
    );
    reopening.delete(tabId);
    if (store.entry(tabId) === undefined) return; // closed meanwhile
    if (!result.ok) {
      log(`[browser] tab ${tabId}: port ${forward.port} on ${forward.machine} could not be forwarded again: ${result.error.message}`);
      store.update(tabId, { loading: false, failed: { message: result.error.message } });
      return;
    }
    store.update(tabId, { forward: { ...forward, localPort: result.value.localPort } });
    store.load(tabId, onPort(url, result.value.localPort));
  }

  return {
    opened(tab) {
      const localPort = localPortOf(tab.url);
      const forward = localPort === null ? null : forwards.at(localPort);
      if (forward === null || localPort === null) return;
      const was = tab.forward;
      if (was?.machine === forward.machine && was.port === forward.port && was.localPort === localPort) return;
      store.update(tab.tabId, { forward: { ...forward, localPort } });
    },
    route(tab, url) {
      const { forward } = tab;
      if (forward === undefined || localPortOf(url) !== forward.localPort) return url;
      const live = forwards.listening(forward.machine, forward.port);
      if (live === forward.localPort) return url;
      if (live !== null) {
        store.update(tab.tabId, { forward: { ...forward, localPort: live } });
        return onPort(url, live);
      }
      if (!reopening.has(tab.tabId)) void reopen(tab.tabId, forward, url);
      return null;
    },
  };
}
