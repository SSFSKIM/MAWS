// Who draws a session's to-human view (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md,
// Interfaces §A; decisions 1 to 5). Pure. At every moment one side draws, the to-human mod or MAWS's mirror, never both
// and never neither, and an advertisement that cannot be known is never read as "MAWS draws" for a live launch:
// - an installation draws MAWS's view at 9 only by its declaration (`maws-surface.json`, read by
//   src/services/owner/declaration.ts), never by its version;
// - a launch advertises 9 only when every applicable installation declares it (and the cutover's switch is on), 8 where
//   MAWS draws, and nothing with the lane off;
// - the advertisement is reserved in the index before the launch is sent and bound to its id after (`Reservation`); the
//   host cannot say what a running launch was given, so the reservation is the record of it. The row keeps two slots:
//   the reservation last bound, and at most one not yet bound (which carries the bound one as its `prior`);
// - `drawnBy` follows from what the row says of the running launch (§A's table A), the engine's state of it and the
//   loaded plugin (table B). A cell reads `maws` only on evidence that the mod draws no view; a guess reads `mod`.
import type { EngineSessionStatus } from '../engine/status';
import { TO_HUMAN_MOD_ROUTE } from './contract';
import type { ContractSource } from './state';

export type DrawnBy = 'mod' | 'maws';
export type Advertisement = 9 | 8 | null; // null: the launch carried none (the lane off, or a style that carries no tool)

// A launch's advertisement as the index keeps it: `launchId` null until the host answered and the bind was written;
// `plugin`, whether the launch found an applicable, enabled installation of the mod whose hooks load; `prior`, while
// this one is unbound, the reservation bound last (§A, "Two slots").
export interface Reservation {
  launchId: string | null;
  number: Advertisement;
  plugin: boolean;
  at: string;
  prior?: { launchId: string; number: Advertisement; plugin: boolean };
}

export type Known = { known: true; number: Advertisement; plugin: boolean | null } | { known: false };

// The parsed declaration says the installation's view draws on a client's surface from `toHumanView.drawsFrom`: it
// declares for the advertisement `at` when that is an integer not above it. Anything else does not declare.
export function declaresDrawing(file: unknown, at: number): boolean {
  if (typeof file !== 'object' || file === null || Array.isArray(file)) return false;
  const view = (file as { toHumanView?: unknown }).toHumanView;
  if (typeof view !== 'object' || view === null || Array.isArray(view)) return false;
  const from = (view as { drawsFrom?: unknown }).drawsFrom;
  return typeof from === 'number' && Number.isInteger(from) && from <= at;
}

// The number a launch carries: nothing when the lane carries nothing; 9 when the switch is on, at least one installation
// applies and every one that applies declares; else 8. `route` is the cutover's switch (the tests inject it).
export function advertisementFor(lane: boolean, installations: readonly { declares: boolean }[], route: boolean = TO_HUMAN_MOD_ROUTE): Advertisement {
  if (!lane) return null;
  return route && installations.length > 0 && installations.every((installation) => installation.declares) ? 9 : 8;
}

// What the session's stored row says the running launch `live` carried (§A, table A). `row` is null when the session
// has no owner row or the row cannot be read; its `launchId` (the recorded launch) and `desired` are the last recorded
// launch's, which an earlier build also writes, and `advertised` this build's two slots.
export function advertisementOf(row: { launchId: string | null; desired: ContractSource | null; advertised: Reservation | null } | null, live: string): Known {
  if (row === null) return { known: false }; // A1
  const reserved = row.advertised;
  const slot = reserved === null ? null : reserved.launchId !== null ? reserved : (reserved.prior ?? null);
  if (slot !== null && slot.launchId === live) return { known: true, number: slot.number, plugin: slot.plugin }; // A2
  if (row.launchId !== null && live === row.launchId) {
    // A3: an earlier build's launch, or this build's after its reservation's write failed: 8, or nothing with the lane off
    return row.desired === null ? { known: false } /* A5 */ : { known: true, number: row.desired === 'off' ? null : 8, plugin: null };
  }
  return { known: false }; // A4: an unbound reservation is no evidence of what an unrecorded launch carried
}

// Who draws (§A, table B), for the advertisement the running launch carried, the engine's status of that launch (null:
// none, the session at rest) and the loaded plugin (null until this launch reported its plugins; `present`, a loaded
// plugin named `to-human`; `declares`, its declaration read at its reported path, a read outstanding or failed passed
// as declaring: B5).
export function drawnBy(advertisement: Known, status: { launchId: string; process: EngineSessionStatus['process'] } | null, loaded: { present: boolean; declares: boolean } | null): DrawnBy {
  if (status === null || status.process === 'exiting' || status.process === 'exited') return 'maws'; // B1: at rest
  if (!advertisement.known) return loaded === null || loaded.present ? 'mod' : 'maws'; // B12 to B14 (decision 4): never "MAWS draws" on a guess
  switch (advertisement.number) {
    case 8:
      return 'maws'; // B2: every installation steps aside at 8
    case 9:
      return loaded === null || (loaded.present && loaded.declares) ? 'mod' : 'maws'; // B3 to B7
    case null:
      // no advertisement: the mod draws as in a terminal wherever it loads (decision 5); before the plugins report, only
      // a launch that found no installation whose hooks load is MAWS's (B8, B9)
      return loaded === null ? (advertisement.plugin === false ? 'maws' : 'mod') : loaded.present ? 'mod' : 'maws';
  }
}
