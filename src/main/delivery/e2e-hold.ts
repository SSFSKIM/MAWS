// The e2e's hold on Send to's export phase: @shared/delivery/export-hold (P5 O7 M5c: shared with the machine's
// `delivery.send`, src/services/delivery/), for main's shim (./send.ts).
export { exportHeldFor, HOLD_MAX_MS, type HoldDeps } from '@shared/delivery/export-hold';
