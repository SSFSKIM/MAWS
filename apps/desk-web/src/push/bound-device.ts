// The org-state device this browser's push subscription is bound to (P5 O13 M3, Decision Log 41): its `web-cards`
// device while the head lists it, set by the device (src/cards/start.ts), null otherwise. Apart from the device's own
// modules so the push code, which the grid's first load carries, never pulls the protocol package in with it.
let bound: string | null = null;

export const boundPushDevice = (): string | null => bound;

export function bindPushDevice(device: string | null): void {
  bound = device;
}
