// The cards list's rows (P5 O13 M5), and the store the app reads them from: per cut-over machine (machines.ts) its name
// and whether its endpoint is online, and per session of the signed-in member's that waits on it its pending count, as
// the hub's `presence` on the machine's socket last gave it (carrier.ts), with the title and lane its verified listing
// gives (listings-store.ts). A session the presence counts but no verified listing names, or whose listing names other
// owners, is not drawn: nothing then says it is the member's, or which lane to subscribe on. While the machine's socket
// is down its last presence stands, so an offline machine keeps its rows.
//
// The store is the app's entry's (the top bar's dot reads it) and holds plain data only; the device's part (watch.ts,
// in its own chunk) fills it. The frozen views read its machines' names for the freeze's one seam (M6, `movedToMaws`).
import { machineNameKey } from 'desk-hub/protocol';
import type { Listing, RelayPresence, Signed } from 'org-protocol';
import { create } from 'zustand';
import type { CutOverMachine } from './machines';

export type BoardSession = { session: string; title: string; lane: 'A' | 'B'; project: string; pending: number };
/** `online` null: the hub has not said yet (no presence since the socket opened). */
export type BoardMachine = { ref: string; name: string; online: boolean | null; sessions: BoardSession[] };

/** Each machine's last presence: whether its endpoint is online (null before any), and the counts it gave. */
export type Presences = Map<string, { online: boolean | null; pending: RelayPresence['pending'] }>;

export function boardOf(machines: CutOverMachine[], presences: Presences, listings: Map<string, Signed<Listing>>, member: string): BoardMachine[] {
  return machines.map(({ ref, name }) => {
    const presence = presences.get(ref);
    const sessions: BoardSession[] = [];
    for (const [session, { pending }] of Object.entries(presence?.pending ?? {})) {
      const fields = listings.get(`${ref}/${session}`)?.body.fields;
      if (pending <= 0 || fields === undefined || !fields.owners.includes(member) || fields.project === null) continue;
      sessions.push({ session, title: fields.title, lane: fields.lane, project: fields.project, pending });
    }
    sessions.sort((a, b) => a.title.localeCompare(b.title) || a.session.localeCompare(b.session));
    return { ref, name, online: presence?.online ?? null, sessions };
  });
}

/** How many requests wait on the board, all machines together. */
export const waitingOn = (board: BoardMachine[]): number => board.reduce((n, m) => n + m.sessions.reduce((k, s) => k + s.pending, 0), 0);

/**
 * Whether `machine` (a DX session's machine, by the name its log gives) is one of the cut-over machines named `names`:
 * the same name without regard to case, as the hub and the org state compare names (`machineNameKey`).
 */
export function movedToMaws(machine: string, names: readonly string[]): boolean {
  const key = machineNameKey(machine);
  return names.some((name) => machineNameKey(name) === key);
}

export type CardsBoard = {
  /** Whether the device's part is watching (a listed device): until then the list has nothing to say of machines. */
  watching: boolean;
  machines: BoardMachine[];
};

export const useCardsBoard = create<CardsBoard>()(() => ({ watching: false, machines: [] }));
