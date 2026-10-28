// The RL2 links' source for the connection manager (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "The roster and the manager", Interfaces §C): the roster of machines a handshake can succeed with, one eager link per
// machine on it, and the network watch.
//
// The roster: every ref in the held head's `machines` and every `machine` of the view's certificates, this machine's
// left out, each kept when `machineKeys` answers at least one key for it, the check `openChannel` makes against `h2`, so a
// contested ref, a dead certificate and a revoked key are all left out. A machine is named by its entry, else by its live
// certificate's name. It is recomputed at each change of the org session and at each certificate's delegation expiry,
// and is empty signed out.
//
// The network watch reads the non-internal interface addresses every NETWORK_POLL_MS while any link exists, and probes
// every link (`network`) when the set changes. Electron-free: wake, unlock and focus reach `probeAll` from index.ts.
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import { machineKeys, verifyMachineCert } from '../../../../apps/org-protocol/src/index.ts';
import type { MachineRef } from '@shared/machine/ref';
import type { OrgSession, SignedIn } from '../../org/session';
import type { MachineLink } from '../manager';
import { createEndpointRecords, ENDPOINT_RECORDS_FILE } from './endpoint-records';
import { createRemoteLink, nextCertExpiry, timeoutAt, type ProbeReason, type RemoteLink, type RemoteLinkDeps } from './link';
import { REMOTE_TIMING } from './timing';

export interface RemoteSource {
  /** The roster: the head's machines and live certificates, local and contested refs left out. */
  machines(): readonly { ref: MachineRef; name: string }[];
  onChanged(listener: () => void): () => void;
  /** A RemoteLink; the source keeps it for `link`. */
  connect(machine: { ref: MachineRef; name: string }): MachineLink;
}

export type RemoteSourceDeps = {
  session: OrgSession;
  /** This machine: never on its own roster. */
  local: MachineRef;
  userData: string;
  log(line: string): void;
  now?(): number;
  networkPollMs?: number;
  /** os.networkInterfaces by default. */
  interfaces?(): NodeJS.Dict<NetworkInterfaceInfo[]>;
  linkDeps?: Partial<RemoteLinkDeps>;
};

type Roster = { ref: MachineRef; name: string }[];

/** The machines a handshake can succeed with under `signedIn`'s view (see the header). */
export async function rosterOf(signedIn: SignedIn | null, local: MachineRef, now: Date): Promise<Roster> {
  if (signedIn === null) return [];
  const head = signedIn.view.head().state;
  const certificates = signedIn.view.certificates();
  const names = new Map<string, string>();
  for (const entry of head.machines) names.set(entry.ref, entry.name);
  const candidates = new Set<string>([...head.machines.map((m) => m.ref), ...certificates.certs.map((c) => c.body.machine)]);
  const roster: Roster = [];
  for (const ref of candidates) {
    if (ref === local) continue;
    const { keys } = await machineKeys(head, ref, certificates, now);
    if (keys.length === 0) continue;
    let name = names.get(ref);
    if (name === undefined) {
      for (const cert of certificates.certs) {
        if (cert.body.machine === ref && (await verifyMachineCert(head, cert, now)).ok) {
          name = cert.body.name;
          break;
        }
      }
    }
    roster.push({ ref: ref as MachineRef, name: name ?? ref });
  }
  return roster.sort((a, b) => a.ref.localeCompare(b.ref));
}

/** The set of non-internal addresses, as one comparable string. */
function addressesOf(table: NodeJS.Dict<NetworkInterfaceInfo[]>): string {
  const out: string[] = [];
  for (const infos of Object.values(table)) for (const info of infos ?? []) if (!info.internal) out.push(info.address);
  return out.sort().join(' ');
}

export function createRemoteSource(deps: RemoteSourceDeps): RemoteSource & {
  link(machine: MachineRef): RemoteLink | null;
  probeAll(reason: ProbeReason): void;
  close(): void;
} {
  const now = deps.now ?? Date.now;
  const log = (line: string) => deps.log(`remote: ${line}`);
  const interfaces = deps.interfaces ?? networkInterfaces;
  const pollMs = deps.networkPollMs ?? REMOTE_TIMING.NETWORK_POLL_MS;
  const records = createEndpointRecords({ file: join(deps.userData, ENDPOINT_RECORDS_FILE), now, log });
  const links = new Map<MachineRef, RemoteLink & { rename(name: string): void }>();
  const listeners = new Set<() => void>();
  let roster: Roster = [];
  let closed = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let seen = '';

  function watchNetwork(): void {
    if (links.size > 0 && poll === null && !closed) {
      seen = addressesOf(interfaces());
      poll = setInterval(() => {
        const next = addressesOf(interfaces());
        if (next === seen) return;
        seen = next;
        log('the network changed: probing every machine');
        for (const link of links.values()) link.probe('network');
      }, pollMs);
      poll.unref?.();
    } else if ((links.size === 0 || closed) && poll !== null) {
      clearInterval(poll);
      poll = null;
    }
  }

  // Recomputed in order, so an older head's roster never lands after a newer one's.
  let recompute: Promise<void> = Promise.resolve();
  let clearExpiry: (() => void) | null = null;
  function refresh(): void {
    recompute = recompute.then(async () => {
      if (closed) return;
      const signedIn = deps.session.current();
      // A certificate leaves the roster when its delegation expires, with no change to the session: recomputed then.
      clearExpiry?.();
      const at = signedIn === null ? null : nextCertExpiry(signedIn.view.head().state, signedIn.view.certificates(), now());
      clearExpiry = at === null ? null : timeoutAt(at, now, refresh);
      let next: Roster;
      try {
        next = await rosterOf(signedIn, deps.local, new Date(now()));
      } catch (error) {
        return log(`the roster could not be read: ${(error as Error).message}`);
      }
      const same = next.length === roster.length && next.every((m, i) => m.ref === roster[i].ref && m.name === roster[i].name);
      if (same) return;
      roster = next;
      for (const machine of next) links.get(machine.ref)?.rename(machine.name);
      for (const ref of [...links.keys()]) if (!next.some((m) => m.ref === ref)) links.delete(ref); // the manager closes it
      for (const listener of [...listeners]) listener();
      watchNetwork();
    });
  }
  const unsubscribe = deps.session.onChanged(refresh);
  refresh();

  return {
    machines: () => roster,
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    connect(machine) {
      const link = createRemoteLink({ machine, session: deps.session, records, now, log: deps.log, ...deps.linkDeps });
      links.set(machine.ref, link);
      watchNetwork();
      return link;
    },
    link: (ref) => links.get(ref) ?? null,
    probeAll(reason) {
      for (const link of links.values()) link.probe(reason);
    },
    close() {
      closed = true;
      unsubscribe();
      clearExpiry?.();
      clearExpiry = null;
      for (const link of links.values()) link.close();
      links.clear();
      watchNetwork();
    },
  };
}
