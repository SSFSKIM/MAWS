// The device's watch over the cut-over machines (P5 O13 M5), while the device is listed: the machines the org state
// resolves (machines.ts), each with its Machine socket open (carrier.ts, one per machine for the tab's life) for the
// hub's `presence`, and the board (board.ts) drawn again whenever the head, the certificates, a listing or a presence
// moves, and again when a delegated machine's delegation expires (a clock transition no org change announces). A machine
// that leaves the org has its socket closed; stopping closes them all and empties the board.
import type { Certificates, Listing, RelayPresence, Signed, SignedOrgState } from 'org-protocol';
import { boardOf, useCardsBoard, type Presences } from './board';
import type { MachineSocket } from './carrier';
import { cutOverMachines, type CutOverMachine } from './machines';

export type WatchDeps = {
  member: string;
  org: { ready: boolean; head(): SignedOrgState; certificates(): Certificates; onChange(listener: () => void): () => void };
  listings: { listings(): Map<string, Signed<Listing>>; onChange(listener: () => void): () => void };
  socketFor(ref: string): MachineSocket;
  board?: typeof useCardsBoard;
  /** The clock and its timer (the browser's by default). */
  clock?: { now(): Date; after(ms: number, run: () => void): () => void };
};

/** The longest timer a browser keeps (2^31 - 1 ms, some 24 days): a later expiry is rescheduled from there. */
const LONGEST_MS = 2 ** 31 - 1;

const browserClock = {
  now: () => new Date(),
  after: (ms: number, run: () => void) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

export function watchCards(deps: WatchDeps): () => void {
  const board = deps.board ?? useCardsBoard;
  const clock = deps.clock ?? browserClock;
  let stopped = false;
  let expiry: (() => void) | null = null;
  let machines: CutOverMachine[] = [];
  let generation = 0;
  const presences: Presences = new Map();
  const watched = new Map<string, { socket: MachineSocket; off: () => void }>();

  const draw = () => {
    if (!stopped) board.setState({ watching: true, machines: boardOf(machines, presences, deps.listings.listings(), deps.member) });
  };
  const heard = (ref: string, presence: RelayPresence | null) => {
    const before = presences.get(ref);
    // The socket down: the machine can't be reached from here, and the counts it last gave stand.
    if (presence === null) presences.set(ref, { online: before === undefined ? null : false, pending: before?.pending ?? {} });
    else presences.set(ref, { online: presence.online, pending: presence.pending });
    draw();
  };
  const resolve = async () => {
    const mine = ++generation;
    if (!deps.org.ready) return;
    const at = clock.now();
    const now = await cutOverMachines(deps.org.head(), deps.org.certificates(), at);
    if (stopped || mine !== generation) return;
    machines = now;
    expiry?.();
    expiry = null;
    const until = Math.min(...now.flatMap((m) => (m.until === null ? [] : [Date.parse(m.until)])));
    if (Number.isFinite(until)) expiry = clock.after(Math.min(Math.max(0, until - at.getTime()), LONGEST_MS), settle);
    const refs = new Set(now.map((m) => m.ref));
    for (const [ref, { socket, off }] of watched) {
      if (refs.has(ref)) continue;
      off();
      socket.close();
      watched.delete(ref);
      presences.delete(ref);
    }
    for (const { ref } of now) {
      if (watched.has(ref)) continue;
      const socket = deps.socketFor(ref);
      watched.set(ref, { socket, off: socket.onPresence((presence) => heard(ref, presence)) });
      const presence = socket.presence();
      if (presence !== null) presences.set(ref, { online: presence.online, pending: presence.pending });
    }
    draw();
  };
  const settle = () => void resolve().catch((error: unknown) => console.error('desk: resolving the cut-over machines', error));

  const offOrg = deps.org.onChange(settle);
  const offListings = deps.listings.onChange(draw);
  settle();
  return () => {
    stopped = true;
    expiry?.();
    offOrg();
    offListings();
    for (const { socket, off } of watched.values()) {
      off();
      socket.close();
    }
    watched.clear();
    board.setState({ watching: false, machines: [] });
  };
}
