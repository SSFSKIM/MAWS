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
  return true;
}
