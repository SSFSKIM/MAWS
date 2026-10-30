// Main → renderer events (X2). Every payload is validated before it is sent; an invalid one is logged and dropped
// here rather than thrown, since emitters run inside Electron and host callbacks where a throw has no one to catch it.
// P5 O6 M2 (OX2): every event carries the machine it came from, as the message's last argument: `emit` and `emitTo` the
// local machine (src/main/machine/local.ts), `emitFrom` another machine's, relayed by its link (M3). A main whose local
// machine is not bound (a unit test's) sends none, which the renderer reads as local.
import { eventChannel, type EventName, type EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import { boundLocalMachine } from '../machine/local';
import { appWindows } from '../windows'; // E2: a capture window is not the app's page

// Sends to every live app window; returns whether the payload was valid and sent.
export function emit<N extends EventName>(name: N, payload: EventPayload<N>): boolean {
  const sent = toWindows(name, payload, boundLocalMachine());
  if (!sent.ok) return false;
  for (const tap of taps.get(name) ?? []) tap(sent.value); // C5: onEmitted, below
  return true;
}

// P5 O6 M2: another machine's event, to the windows only. No `onEmitted` tap hears it: main's own services act on their
// own machine's events alone.
export function emitFrom<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): boolean {
  return toWindows(name, payload, machine).ok;
}

type Page = { send(channel: string, ...args: unknown[]): void; isDestroyed(): boolean };
const send = (page: Pick<Page, 'send'>, channel: string, value: unknown, machine: MachineRef | null) =>
  machine === null ? page.send(channel, value) : page.send(channel, value, machine);

// Validates and sends; an invalid payload is logged and nothing is sent.
function toWindows(name: EventName, payload: unknown, machine: MachineRef | null): ReturnType<typeof validateEventPayload> {
  const checked = validateEventPayload(name, payload);
  if (!checked.ok) {
    console.error(`[ipc] refused to emit invalid ${name}`, checked.issues);
    return checked;
  }
  for (const win of appWindows()) {
    if (!win.webContents.isDestroyed()) send(win.webContents, eventChannel(name), checked.value, machine);
  }
  return checked;
}

// P4-B2 K6: to one app page only, validated as `emit` validates (the Edit menu's Undo and Redo go to the page holding the
// focus, since another window's page would answer from its own focused element); false, and nothing sent, otherwise.
export function emitTo<N extends EventName>(page: Page, name: N, payload: EventPayload<N>): boolean {
  const checked = validateEventPayload(name, payload);
  if (!checked.ok) {
    console.error(`[ipc] refused to emit invalid ${name}`, checked.issues);
    return false;
  }
  if (page.isDestroyed()) return false;
  send(page, eventChannel(name), checked.value, boundLocalMachine());
  for (const tap of taps.get(name) ?? []) tap(checked.value);
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
