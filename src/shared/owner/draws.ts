// Who draws a session's to-human view (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md,
// Interfaces §A; decisions 1 to 5). Pure. At every moment one side draws, the to-human mod or MAWS's mirror, never both
// and never neither, and an advertisement that cannot be known is never read as "MAWS draws" for a live launch:
// - an installation draws MAWS's view at 9 only by its declaration (`maws-surface.json`, read by
//   src/services/owner/declaration.ts), never by its version;
// - a launch advertises 9 only when every applicable installation declares it (and the cutover's switch is on), 8 where
//   MAWS draws, and nothing with the lane off;
// - the advertisement is reserved in the index before the launch is sent and bound to its id after (`Reservation`); the
//   host cannot say what a running launch was given, so the reservation is the record of it;
// - `drawnBy` follows from what the row says of the running launch, the engine's status of it, and the loaded plugin.
import type { EngineSessionStatus } from '../engine/status';
import { TO_HUMAN_MOD_ROUTE } from './contract';
import type { ContractSource } from './state';

export type DrawnBy = 'mod' | 'maws';
export type Advertisement = 9 | 8 | null; // null: the launch carried none (the lane off, or a style that carries no tool)

// A launch's advertisement as the index keeps it: `launchId` null until the host answered and the bind was written;
// `plugin`, whether the launch found an applicable, enabled installation of the mod whose hooks load.
export interface Reservation {
  launchId: string | null;
  number: Advertisement;
  plugin: boolean;
  at: string;
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

// What the session's stored row says the running launch `live` carried. `row` is null when the session has no owner row
// or the row cannot be read; its `desired` and `launchId` are the last decided launch's, which an earlier build also
// writes, and `advertised` this build's reservation.
export function advertisementOf(row: { launchId: string | null; desired: ContractSource | null; advertised: Reservation | null } | null, live: string): Known {
  if (row === null) return { known: false };
  const reserved = row.advertised;
  // bound to the running launch: its own record
  if (reserved !== null && reserved.launchId === live) return { known: true, number: reserved.number, plugin: reserved.plugin };
  // not bound, and the running launch is not the one the row last recorded: the host accepted it and the bind was never
  // written (the daemon stopped between the two)
  if (reserved !== null && reserved.launchId === null && live !== row.launchId) return { known: true, number: reserved.number, plugin: reserved.plugin };
  // the running launch is the row's own and no reservation is bound to it: an earlier build's launch, or one made before
  // any reservation, which advertised as the desired state says (8 wherever the lane carried anything)
  if (row.launchId !== null && live === row.launchId && row.desired !== null) return { known: true, number: row.desired === 'off' ? null : 8, plugin: null };
  return { known: false };
}

// Who draws, for the advertisement the running launch carried, the engine's status of that launch (null: none, the
// session at rest) and the loaded plugin (null until this launch reported its plugins; `present`, a loaded plugin named
// `to-human`; `declares`, its declaration read at its reported path).
export function drawnBy(advertisement: Known, status: { launchId: string; process: EngineSessionStatus['process'] } | null, loaded: { present: boolean; declares: boolean } | null): DrawnBy {
  if (status === null || status.process === 'exiting' || status.process === 'exited') return 'maws'; // at rest
  if (!advertisement.known) return loaded === null || loaded.present ? 'mod' : 'maws'; // decision 4: never "MAWS draws" on a guess
  switch (advertisement.number) {
    case 8:
      return 'maws'; // every installation steps aside at 8
    case 9:
      return loaded === null || (loaded.present && loaded.declares) ? 'mod' : 'maws';
    case null:
      // no advertisement: the mod draws as in a terminal wherever it loads (decision 5)
      return loaded === null ? (advertisement.plugin === true ? 'mod' : 'maws') : loaded.present ? 'mod' : 'maws';
  }
}
