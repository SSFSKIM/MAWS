// P5 O7 M3 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Forwarding"; P5 Decision Log 108's A6): a
// loopback link out of another machine's session names that machine's own loopback (a dev server there), so it opens in
// the in-app browser through a port forwarded over the machine's link, never on this Mac's localhost:
//
// - the rule (`forwardOf`): a link the shared loopback rule forwards, out of a session on another machine; and a loopback
//   link of such a session that is no forward (another scheme, the rest of 127/8, an IPv4-mapped host: `loopbackElsewhere`), which names
//   that machine's loopback all the same, so it opens nowhere;
// - the open (`openForward`, the Browser tool's): `remote.forward.open` on this app, then the page on the local
//   listener's port, in the session's browser, reusing a tab already at that URL;
// - the mark (`forwardMarkOf`): main keeps `tab.forward` for a tab it opened at a forward's listener (persisted, and
//   re-forwarded at a restored tab's first load), and the tab is "forwarded from <machine>" while its page is on that
//   listener. No listener is closed from here: main closes them with the machine's link and at quit, and a page's
//   history and a round trip through another site come back to the same local port;
// - a refused open, kept per session and drawn in place of the pane (pages/ForwardFailed.tsx) while the session's
//   selected tab is the one it was over, with a retry.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { BrowserTab, BrowserTabForward } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import type { IpcError } from '@shared/ipc/errors';
import type { MawsBridge } from '@shared/ipc/schema';
import { isAddress, machineOf } from '@shared/machine/address';
import { forwardedUrl, isLoopbackLink, loopbackPort } from '@shared/machine/loopback-link';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../../ipc/client';
import { BROWSER_COPY } from './copy';
import { browser, sessionTabs } from './store';

export interface ForwardTarget {
  machine: MachineRef;
  port: number; // on the machine's loopback
}

export interface ForwardFailure {
  url: string; // the link as written
  forward: ForwardTarget;
  error: IpcError;
  selected: string | null; // the session's selected tab when it failed: the page shows over that one only
  requestId?: string;
}

export interface ForwardsState {
  failures: ReadonlyMap<AppSessionId, ForwardFailure>;
}

export const forwards = createStore<ForwardsState>()(() => ({ failures: new Map() }));
export const useForwards = <T>(selector: (state: ForwardsState) => T): T => useStore(forwards, selector);

// Tests: forget every failure.
export function resetForwards(): void {
  forwards.setState({ failures: new Map() });
}

/** The forward a link out of a session opens through: a loopback link of a session on another machine; else null. */
export function forwardOf(appSessionId: AppSessionId, url: string, local: MachineRef = ipc.localMachine): ForwardTarget | null {
  if (!isAddress(appSessionId) || machineOf(appSessionId) === local) return null;
  const port = loopbackPort(url); // the shared rule's forwardable test
  return port === null ? null : { machine: machineOf(appSessionId), port };
}

/** The machine whose loopback a link out of its session names when that link cannot be forwarded; else null. */
export function loopbackElsewhere(appSessionId: AppSessionId, url: string, local: MachineRef = ipc.localMachine): MachineRef | null {
  if (!isAddress(appSessionId) || machineOf(appSessionId) === local || loopbackPort(url) !== null) return null;
  return isLoopbackLink(url) ? machineOf(appSessionId) : null; // the shared rule's never-open-here test
}

/** The forward a tab's page is served through: main's `tab.forward`, while the page is on that forward's listener. */
export function forwardMarkOf(tab: Pick<BrowserTab, 'url' | 'forward'>): BrowserTabForward | null {
  const { forward } = tab;
  if (forward === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(tab.url);
  } catch {
    return null;
  }
  return parsed.hostname === '127.0.0.1' && parsed.port === String(forward.localPort) ? forward : null;
}

function setFailure(appSessionId: AppSessionId, failure: ForwardFailure | null): void {
  const failures = new Map(forwards.getState().failures);
  if (failure) failures.set(appSessionId, failure);
  else if (!failures.delete(appSessionId)) return;
  forwards.setState({ failures });
}

export const dismissForwardFailure = (appSessionId: AppSessionId): void => setFailure(appSessionId, null);

/** Opens the forward, then the link's page on its local port in the session's browser; a refusal is kept for its pane. */
export async function openForward(client: MawsBridge, appSessionId: AppSessionId, url: string, forward: ForwardTarget, requestId?: string): Promise<void> {
  const opened = await client.invoke('remote.forward.open', forward);
  if (!opened.ok) {
    const { selected } = sessionTabs(browser.getState(), appSessionId);
    setFailure(appSessionId, { url, forward, error: opened.error, selected, ...(requestId !== undefined && { requestId }) });
    return;
  }
  const { localPort } = opened.value;
  setFailure(appSessionId, null); // main marks the tab it opens at the listener (`tab.forward`)
  const request = { appSessionId, url: forwardedUrl(url, localPort), select: true, reuse: 'url' as const, ...(requestId !== undefined && { requestId }) };
  const result = await client.invoke('browser.tabs.open', request);
  if (!result.ok) console.warn(`[browser] opening the forwarded page refused: ${result.error.message}`);
}

/** The failed open of the session's browser, asked again. */
export function retryForward(client: MawsBridge, appSessionId: AppSessionId): Promise<void> {
  const failure = forwards.getState().failures.get(appSessionId);
  return failure ? openForward(client, appSessionId, failure.url, failure.forward, failure.requestId) : Promise.resolve();
}

const refusalOf = (error: IpcError): unknown => (typeof error.issues === 'object' && error.issues !== null ? (error.issues as { refusal?: unknown }).refusal : undefined);

/** What a refused `remote.forward.open` says (M3b's contract): the machine away, the grade, an older endpoint, the sheet. */
export function forwardErrorWords(error: IpcError, machine: string): string {
  const copy = BROWSER_COPY.forwarded;
  if (error.code === 'host_unavailable') return copy.unreachable(machine);
  if (error.code === 'internal') {
    const refusal = refusalOf(error);
    if (refusal === 'grade') return copy.notAllowed(machine);
    if (refusal === 'not-offered') return copy.notOffered(machine);
    if (refusal === 'step-up-cancelled') return copy.cancelled;
  }
  return error.message; // a timeout's pending words, as main says them
}
