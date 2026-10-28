// When the device's part of the app starts (P5 O13 M3). Its modules — the protocol package's verification with them —
// are a chunk of their own (./start.ts), started at the app's start only on a browser that is a device already (a
// record in IndexedDB's `device` store), and otherwise when the Device panel opens. So the desk on a browser that never
// pairs never loads them, and no chunk of the app loads at start that the first screen did not ask for (the retained
// tab's chunk recovery, e2e/chunk-recovery.spec.ts, meets the build as it did before).
import type { Me } from '../hub/me';
import { loadChunk } from '../pwa/load-chunk';
import { idbDeviceStore } from './device-store';

type Started = { org: string; ready: Promise<void>; stop: (() => void) | null; cancelled: boolean };

let started: Started | null = null;

/** Starts the device for `me`'s org, once; a start already under way or done for it is answered as is. */
export function bootDevice(me: Me): Promise<void> {
  if (started?.org === me.org.id) return started.ready;
  stopDevice();
  const entry: Started = { org: me.org.id, ready: Promise.resolve(), stop: null, cancelled: false };
  entry.ready = loadChunk(() => import('./start')).then((m) => {
    if (!entry.cancelled) entry.stop = m.startDevice(me);
  });
  started = entry;
  return entry.ready;
}

export function stopDevice(): void {
  if (started === null) return;
  started.cancelled = true;
  started.stop?.();
  started = null;
}

/** Whether this browser keeps a device record for `org`. */
export async function isDevice(org: string): Promise<boolean> {
  return (await idbDeviceStore().load(org)) !== null;
}
