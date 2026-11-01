// P5 O7 M3 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Forwarding"; P5 Decision Log 108's A6): a
// loopback link out of another machine's session names that machine's own loopback (a dev server there), so it opens in
// the in-app browser through a port forwarded over the machine's link, never on this Mac's localhost:
//
// - the rule (`forwardOf`): a link the shared loopback rule forwards, out of a session on another machine;
// - the open (`openForward`, the Browser tool's): `remote.forward.open` on this app, then the page on the local
//   listener's port, in the session's browser, reusing a tab already at that URL;
// - the forwards this page opened, by local port, so a tab at `127.0.0.1:<localPort>` is marked "forwarded from
//   <machine>" for as long as its page is there; kept in the window's session storage, so a reload of the page keeps the
//   marks of the listeners main still holds. No listener is closed from here: main closes them with the machine's link
//   and at quit, and a page's history and a round trip through another site come back to the same local port;
// - a refused open, kept per session and drawn in place of the pane (pages/ForwardFailed.tsx) while the session's
//   selected tab is the one it was over, with a retry.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { IpcError } from '@shared/ipc/errors';
import type { MawsBridge } from '@shared/ipc/schema';
import { isAddress, machineOf } from '@shared/machine/address';
import { forwardedUrl, loopbackPort } from '@shared/machine/loopback-link';
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
  ports: ReadonlyMap<number, ForwardTarget>; // by the local listener's port
  failures: ReadonlyMap<AppSessionId, ForwardFailure>;
}

const STORAGE_KEY = 'maws.browser.forwards';

function storedPorts(): Map<number, ForwardTarget> {
  try {
    const rows = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]') as [number, ForwardTarget][];
    return new Map(rows.filter(([port, target]) => Number.isInteger(port) && typeof target?.machine === 'string' && Number.isInteger(target.port)));
  } catch {
    return new Map();
  }
}

export const forwards = createStore<ForwardsState>()(() => ({ ports: storedPorts(), failures: new Map() }));
export const useForwards = <T>(selector: (state: ForwardsState) => T): T => useStore(forwards, selector);

// Tests: forget every forward and failure, and what the window kept.
export function resetForwards(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  forwards.setState({ ports: new Map(), failures: new Map() });
}

/** The forward a link out of a session opens through: a loopback link of a session on another machine; else null. */
export function forwardOf(appSessionId: AppSessionId, url: string, local: MachineRef = ipc.localMachine): ForwardTarget | null {
  if (!isAddress(appSessionId) || machineOf(appSessionId) === local) return null;
  const port = loopbackPort(url); // the shared rule's one call here
  return port === null ? null : { machine: machineOf(appSessionId), port };
}

/** The forward a page is served through, when its URL is on the local listener of a forward this page opened. */
export function forwardMarkOf(url: string, ports: ReadonlyMap<number, ForwardTarget>): ForwardTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.hostname === '127.0.0.1' && parsed.port !== '' ? (ports.get(Number(parsed.port)) ?? null) : null;
}

function remember(localPort: number, forward: ForwardTarget): void {
  const ports = new Map([...forwards.getState().ports].filter(([, kept]) => kept.machine !== forward.machine || kept.port !== forward.port));
  ports.set(localPort, forward);
  forwards.setState({ ports });
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ports]));
  } catch {
    // a window that keeps nothing loses only the marks at its next reload
  }
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
  remember(localPort, forward);
  setFailure(appSessionId, null);
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
