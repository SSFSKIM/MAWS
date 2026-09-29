// Main → renderer events (X2). Every payload is validated before it is sent; an invalid one is logged and dropped
// here rather than thrown, since emitters run inside Electron and host callbacks where a throw has no one to catch it.
import { BrowserWindow } from 'electron';
import { eventChannel, type EventName, type EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';

// Sends to every live app window; returns whether the payload was valid and sent.
export function emit<N extends EventName>(name: N, payload: EventPayload<N>): boolean {
  const checked = validateEventPayload(name, payload);
  if (!checked.ok) {
    console.error(`[ipc] refused to emit invalid ${name}`, checked.issues);
    return false;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(eventChannel(name), checked.value);
  }
  for (const tap of taps.get(name) ?? []) tap(checked.value); // C5: onEmitted, below
  return true;
}

// ---- C5: onEmitted ----------------------------------------------------------------------------------------------------
// A main-side tap on what main tells the renderer: called with every payload `emit` validated, whether or not a window
// is open. The read model sees `attention.changed` this way, from whichever service emits it (C3's attention service
// in launch mode `index`, the stub source in `scenario`), with no call into the read model from that service.
const taps = new Map<EventName, Set<(payload: unknown) => void>>();

export function onEmitted<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void {
  let set = taps.get(name);
  if (!set) taps.set(name, (set = new Set()));
  const entry = listener as (payload: unknown) => void;
  set.add(entry);
  return () => set.delete(entry);
}
// ---- end C5 -----------------------------------------------------------------------------------------------------------
