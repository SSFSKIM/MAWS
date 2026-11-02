// The remote bench's handle on main's links (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7 and
// Interfaces §S): installed as `globalThis.__maws_remote_bench` under MAWS_E2E=1 in a build that is not packaged, and read
// by e2e/remote-latency.spec.ts through Playwright's `app.evaluate`. It reads the links and sends their pings; it grants
// nothing, and changes nothing the machine checks.
//
// - machines: each RL2 link's machine, name, reported state, carrier and whether its peer listed `rl2.pong-clock`;
// - ping: `count` sequential pings on a machine's link (link.ts `ping`), each answered with its pong's stamps or null;
// - probe: a link's probe, as the network watch makes one when the network returns (the forced drop's restore).
//
// And the live bench's relay case (e2e:remote-latency-live): MAWS_E2E_REMOTE_CARRIER=relay, under the same two
// conditions, refuses every direct dial at once, so each link comes up through the hub, as on a network with no tailnet
// path. Like the development session's directMap it changes only where a dial goes, never what the link checks.
import type { MachineRef } from '@shared/machine/ref';
import type { LinkState } from '../manager';
import { peerLists } from './capabilities';
import type { ByteDuplex } from '../../../../apps/org-protocol/src/index.ts';
import type { Carrier, PongStamps, ProbeReason, RemoteLink } from './link';

export interface RemoteBenchSeam {
  machines(): { ref: MachineRef; name: string; state: LinkState; carrier: Carrier | null; clock: boolean }[];
  ping(ref: MachineRef, count: number, timeoutMs?: number): Promise<(PongStamps | null)[]>;
  probe(ref: MachineRef, reason: ProbeReason): void;
}

declare global {
  var __maws_remote_bench: RemoteBenchSeam | undefined;
}

export function remoteBenchSeam(deps: { machines(): readonly { ref: MachineRef }[]; link(ref: MachineRef): RemoteLink | null }): RemoteBenchSeam {
  const linkOf = (ref: MachineRef): RemoteLink => {
    const link = deps.link(ref);
    if (link === null) throw new Error(`no RL2 link to machine ${ref}`);
    return link;
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
  };
}

/** Installs the seam under MAWS_E2E=1 in a build that is not packaged; returns its removal. */
export function installRemoteBenchSeam(env: NodeJS.ProcessEnv, packaged: boolean, deps: Parameters<typeof remoteBenchSeam>[0]): () => void {
  if (env.MAWS_E2E !== '1' || packaged) return () => {};
  const seam = remoteBenchSeam(deps);
  globalThis.__maws_remote_bench = seam;
  return () => {
    if (globalThis.__maws_remote_bench === seam) delete globalThis.__maws_remote_bench;
  };
}

/** MAWS_E2E_REMOTE_CARRIER=relay under MAWS_E2E=1 in an unpackaged build: a direct dial that is refused at once; else null. */
export function relayOnlyDial(env: NodeJS.ProcessEnv, packaged: boolean): ((url: string, timeoutMs: number) => Promise<ByteDuplex>) | null {
  if (env.MAWS_E2E !== '1' || packaged || env.MAWS_E2E_REMOTE_CARRIER !== 'relay') return null;
  return () => Promise.reject(new Error('the direct carrier is off (MAWS_E2E_REMOTE_CARRIER=relay)'));
}
