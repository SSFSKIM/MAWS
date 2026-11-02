// The remote bench's handle on main's links (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7 and
// Interfaces §S): installed as `globalThis.__maws_remote_bench` under MAWS_E2E=1 in a build that is not packaged, and read
// by e2e/remote-latency.spec.ts through Playwright's `app.evaluate`. It reads the links and sends their pings; it grants
// nothing, and changes nothing the machine checks.
//
// - machines: each RL2 link's machine, name, reported state, carrier and whether its peer listed `rl2.pong-clock`;
// - ping: `count` sequential pings on a machine's link (link.ts `ping`), each answered with its pong's stamps or null;
// - probe: a link's probe, as the network watch makes one when the network returns (the forced drop's restore);
// - drop and release, the live bench's resume (e2e:remote-latency-live), with no routing touched: `drop` closes the
//   link's current channel as a loss and holds the link off its machine (link.ts `benchHold`: no attempt, no retry, no
//   probe), so the machine's session writes a turn while the link is down; `release` lifts the hold (an attempt at once,
//   as a network's return makes one) and answers the instant of the link's next `up` on this Mac's wall clock, which
//   the renderer's Date.now reads too, with the carrier it came up over; `unhold` lifts a hold unconditionally (the
//   bench's `finally`), and the seam's removal as the app closes lifts every hold it made. A link with no channel is
//   not held. Only the bench's own app calls them, on its scratch profile;
// - mark and transitions, the live bench's carrier watch: from a mark (and afresh from a release's `up`, the resume's
//   own drop being no switch), every change the link reports of its state or carrier, with its instant, so a case whose
//   link moved while it was timed is voided.
//
// And the live bench's relay case (e2e:remote-latency-live): MAWS_E2E_REMOTE_CARRIER=relay, under the same two
// conditions, refuses every direct dial at once, so each link comes up through the hub, as on a network with no tailnet
// path. Like the development session's directMap it changes only where a dial goes, never what the link checks.
import type { MachineRef } from '@shared/machine/ref';
import type { LinkState } from '../manager';
import { peerLists } from './capabilities';
import type { ByteDuplex } from '../../../../apps/org-protocol/src/index.ts';
import type { Carrier, PongStamps, ProbeReason, RemoteLink } from './link';

/** One change the link reported, on this Mac's wall clock. */
export interface Transition {
  at: number;
  state: LinkState;
  carrier: Carrier | null;
}

export interface RemoteBenchSeam {
  machines(): { ref: MachineRef; name: string; state: LinkState; carrier: Carrier | null; clock: boolean }[];
  ping(ref: MachineRef, count: number, timeoutMs?: number): Promise<(PongStamps | null)[]>;
  probe(ref: MachineRef, reason: ProbeReason): void;
  drop(ref: MachineRef): boolean;
  release(ref: MachineRef, timeoutMs?: number): Promise<{ upAt: number; carrier: Carrier | null } | null>;
  /** The hold lifted whatever the link's state, waiting for nothing: the bench's `finally`. */
  unhold(ref: MachineRef): void;
  /** The link's changes recorded from now on, the record so far dropped. */
  mark(ref: MachineRef): void;
  /** The link's changes since its mark, or since its last release's `up`. */
  transitions(ref: MachineRef): Transition[];
  /** Every hold this seam made lifted and every watch stopped: its removal, as the app closes. */
  dispose(): void;
}

declare global {
  var __maws_remote_bench: RemoteBenchSeam | undefined;
}

export function remoteBenchSeam(deps: { machines(): readonly { ref: MachineRef }[]; link(ref: MachineRef): RemoteLink | null; now?(): number }): RemoteBenchSeam {
  const now = deps.now ?? Date.now;
  const held = new Set<MachineRef>();
  const lift = (ref: MachineRef) => {
    if (!held.delete(ref)) return;
    deps.link(ref)?.benchRelease();
  };
  const linkOf = (ref: MachineRef): RemoteLink => {
    const link = deps.link(ref);
    if (link === null) throw new Error(`no RL2 link to machine ${ref}`);
    return link;
  };
  // one listener per watched link: the record, and whether the next `up` (a release's) begins it afresh
  const watches = new Map<MachineRef, { seen: Transition[]; freshAtUp: boolean; stop: () => void }>();
  const watch = (ref: MachineRef) => {
    const known = watches.get(ref);
    if (known !== undefined) return known;
    const link = linkOf(ref);
    const watched = { seen: [] as Transition[], freshAtUp: false, stop: () => {} };
    watched.stop = link.onState((state) => {
      if (watched.freshAtUp && state === 'up') {
        watched.freshAtUp = false;
        watched.seen = [];
        return;
      }
      watched.seen.push({ at: now(), state, carrier: link.carrier() });
    });
    watches.set(ref, watched);
    return watched;
  };
  return {
    machines: () =>
      deps.machines().flatMap(({ ref }) => {
        const link = deps.link(ref);
        return link === null ? [] : [{ ref, name: link.name, state: link.state(), carrier: link.carrier(), clock: peerLists(link, 'rl2.pong-clock') }];
      }),
    async ping(ref, count, timeoutMs) {
      const link = linkOf(ref);
      const answers: (PongStamps | null)[] = [];
      for (let i = 0; i < count; i += 1) answers.push(await link.ping(timeoutMs === undefined ? {} : { timeoutMs }));
      return answers;
    },
    probe: (ref, reason) => linkOf(ref).probe(reason),
    drop(ref) {
      const holding = linkOf(ref).benchHold();
      if (holding) held.add(ref);
      return holding;
    },
    unhold: lift,
    mark(ref) {
      const watched = watch(ref);
      watched.seen = [];
      watched.freshAtUp = false;
    },
    transitions: (ref) => [...(watches.get(ref)?.seen ?? [])],
    dispose: () => {
      [...held].forEach(lift);
      for (const watched of watches.values()) watched.stop();
    },
    release(ref, timeoutMs = 60_000) {
      const link = linkOf(ref);
      // a link that still reports up is reconnecting within its grace, whose `up` again would be heard by no one
      if (link.state() === 'up') return Promise.reject(new Error(`the link to ${ref} still reports up: release it once it is down`));
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          stop();
          resolve(null);
        }, timeoutMs);
        const stop = link.onState((state) => {
          if (state !== 'up') return;
          const upAt = now();
          clearTimeout(timer);
          stop();
          resolve({ upAt, carrier: link.carrier() });
        });
        watch(ref).freshAtUp = true;
        held.delete(ref);
        link.benchRelease();
      });
    },
  };
}

/** Installs the seam under MAWS_E2E=1 in a build that is not packaged; returns its removal. */
export function installRemoteBenchSeam(env: NodeJS.ProcessEnv, packaged: boolean, deps: Parameters<typeof remoteBenchSeam>[0]): () => void {
  if (env.MAWS_E2E !== '1' || packaged) return () => {};
  const seam = remoteBenchSeam(deps);
  globalThis.__maws_remote_bench = seam;
  return () => {
    seam.dispose();
    if (globalThis.__maws_remote_bench === seam) delete globalThis.__maws_remote_bench;
  };
}

/** MAWS_E2E_REMOTE_CARRIER=relay under MAWS_E2E=1 in an unpackaged build: a direct dial that is refused at once; else null. */
export function relayOnlyDial(env: NodeJS.ProcessEnv, packaged: boolean): ((url: string, timeoutMs: number) => Promise<ByteDuplex>) | null {
  if (env.MAWS_E2E !== '1' || packaged || env.MAWS_E2E_REMOTE_CARRIER !== 'relay') return null;
  return () => Promise.reject(new Error('the direct carrier is off (MAWS_E2E_REMOTE_CARRIER=relay)'));
}
