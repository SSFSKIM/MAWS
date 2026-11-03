// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3); the ledger's E3 hold-IPC
// row): main's holds over a dashboard's snapshot bytes. A window's (`artifacts.holdDatasets` / `releaseDatasets`, the
// source sheet's captured snapshots and the painted cache's): main takes the engine host's main-only hold
// (`artifacts.holdAssets`) and answers a handle it mints, bound to the asking client; only that client releases it, and
// the client's end (its page closing, navigating or crashing) releases every hold it took (H's lease rule,
// src/services/connectors).
// The host's id never reaches a window, and the shared host connection is never a window's authority. A Download's
// (`holdAsset` below): main's own, through the dialog and the copy. When the host's connection goes, the host released
// every hold it took (src/engine-host/dashboards/holds.ts), so main forgets them; a window's later release still
// answers that its handle was released.
//
// P5 O7 M5c round 3 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "O4's surfaces"): an artifact on
// another machine is held on that machine, over its link (`callMainOverLink`, main's own allow-list of main-only names).
// The machine is the router's `ctx.target` (the renderer's client sends every artifact-keyed invoke to the artifact's
// machine, and the router answers `holdDatasets` here for any machine); the endpoint keeps the hold for the channel it was asked on and releases every one at that channel's end
// (src/endpoint/asset-holds.ts). So each remote hold is the channel's current when asked (the peer's list, one per
// channel), and only that channel is asked to release it: once it ended, the endpoint released the hold, and main asks
// nothing. The window learns it through the machine's `artifacts.resync` at the next channel's feed (the renderer's
// per-machine invalidation), so its reader holds again there. A machine whose endpoint doesn't list `rl2.asset-holds`
// (an older build) draws unheld: main answers a handle that holds nothing, and says so once for the machine. This Mac's
// host's going touches no remote hold.
import { randomUUID } from 'node:crypto';
import { ipcError } from '@shared/ipc/errors';
import type { ClientId, ClientRef } from '@shared/ipc/client';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { CommandFailure, type registerMainHandler } from '../ipc/router';
import { callMainOverLink } from '../machines/remote/dispatch';
import type { RemoteLink } from '../machines/remote/link';

/** The capability of an endpoint that keeps a device's snapshot holds (src/endpoint/capabilities.ts). */
const ASSET_HOLDS = 'rl2.asset-holds';

export interface DatasetHoldsDeps {
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>; // the engine host's commands
  log?: (line: string) => void;
  /** P5 O7 M5c: the link to another machine, null while the org lists none. */
  remote?(machine: MachineRef): Pick<RemoteLink, 'name' | 'peerCapabilities' | 'call'> | null;
}

/**
 * A window's hold: this Mac's host's id (`machine` null), or a machine's, with the channel it was taken on (`on`, its
 * peer's list); `assetHoldId` null once nothing is held for it (the host went, or a machine draws unheld).
 */
type Entry = { owner: ClientId; assetHoldId: string | null; machine: MachineRef | null; on: readonly string[] | null };

/** One main-owned hold over `ref` of `artifactId` (a Download's), released once (idempotent). */
export async function holdAsset(call: DatasetHoldsDeps['call'], artifactId: string, ref: string, log: (line: string) => void = (line) => console.warn(`[dashboard] ${line}`)): Promise<{ release(): Promise<void> }> {
  const held = await call('artifacts.holdAssets', { artifactId, refs: [ref] });
  if (!held.ok) throw new CommandFailure(held.error);
  let released: Promise<void> | null = null;
  return {
    release: () =>
      (released ??= call('artifacts.releaseAssets', { assetHoldId: held.value.assetHoldId }).then(
        () => {},
        (error: unknown) => log(`a download's hold was not released: ${error instanceof Error ? error.message : String(error)}`),
      )),
  };
}

export function createDatasetHolds({ call, log = (line) => console.warn(`[dashboard] ${line}`), remote = () => null }: DatasetHoldsDeps) {
  const holds = new Map<string, Entry>(); // by the window's handle
  const owners = new Map<ClientId, Set<string>>(); // each live client's handles, from its first hold until it ends
  const unheld = new Set<MachineRef>(); // the machines said to draw unheld
  let hostGeneration = 0;

  /** The hold's release, asked of what holds it: this Mac's host, or its machine's channel while that is current. */
  const releaseHeld = async (entry: Entry): Promise<CommandResult<'artifacts.releaseAssets'> | null> => {
    const { assetHoldId, machine, on } = entry;
    if (assetHoldId === null) return null;
    if (machine === null) return call('artifacts.releaseAssets', { assetHoldId });
    const link = remote(machine);
    if (link === null || link.peerCapabilities() !== on) return null; // the channel ended: the endpoint released it
    return callMainOverLink(link, 'artifacts.releaseAssets', { assetHoldId });
  };
  const releaseInBackground = (entry: Entry) =>
    void releaseHeld(entry).then(
      (result) => {
        if (result !== null && !result.ok) log(`a hold was not released: ${result.error.message}`);
      },
      (error: unknown) => log(`a hold was not released: ${error instanceof Error ? error.message : String(error)}`),
    );
  // The client ended (its page closed, navigated, crashed): every hold it took goes with it.
  const endOwner = (id: ClientId) => {
    const followed = owners.get(id);
    owners.delete(id);
    for (const holdId of followed ?? []) {
      const entry = holds.get(holdId);
      holds.delete(holdId);
      if (entry) releaseInBackground(entry);
    }
  };
  const follow = (client: ClientRef): ClientId => {
    const { id } = client;
    if (owners.has(id)) return id;
    owners.set(id, new Set());
    client.onGone(() => endOwner(id));
    if (!owners.has(id)) throw new Error('the window has closed'); // it had ended already
    return id;
  };

  /** A handle for `entry`, kept for its window. */
  const keep = (followed: Set<string>, entry: Entry): CommandOutput<'artifacts.holdDatasets'> => {
    const holdId = randomUUID();
    holds.set(holdId, entry);
    followed.add(holdId);
    return { holdId };
  };
  const gone = () => new Error('the window that asked for this hold has gone');

  /** This Mac's artifact, held on its engine host. */
  async function holdHere(id: ClientId, artifactId: string, refs: string[]): Promise<CommandOutput<'artifacts.holdDatasets'>> {
    const asked = hostGeneration;
    const held = await call('artifacts.holdAssets', { artifactId, refs });
    if (!held.ok) throw new CommandFailure(held.error);
    const followed = owners.get(id); // gone once the client ended meanwhile, and never followed again
    const entry: Entry = { owner: id, assetHoldId: held.value.assetHoldId, machine: null, on: null };
    if (!followed || hostGeneration !== asked) {
      if (hostGeneration === asked) releaseInBackground(entry);
      throw gone();
    }
    return keep(followed, entry);
  }

  /** Another machine's artifact, held on that machine for the channel current now (or unheld, by an older endpoint). */
  async function holdThere(id: ClientId, machine: MachineRef, artifactId: string, refs: string[]): Promise<CommandOutput<'artifacts.holdDatasets'>> {
    const link = remote(machine);
    const on = link?.peerCapabilities() ?? null;
    if (link === null || on === null) throw new CommandFailure(ipcError('host_unavailable', `artifacts.holdDatasets: machine ${link?.name ?? machine} is not reachable`));
    if (!on.includes(ASSET_HOLDS)) {
      if (!unheld.has(machine)) {
        unheld.add(machine);
        log(`${link.name}'s endpoint keeps no snapshot holds for this Mac (it lists no ${ASSET_HOLDS}): its dashboards draw unheld`);
      }
      const followed = owners.get(id);
      if (!followed) throw gone();
      return keep(followed, { owner: id, assetHoldId: null, machine, on });
    }
    const held = await callMainOverLink(link, 'artifacts.holdAssets', { artifactId, refs });
    if (!held.ok) throw new CommandFailure(held.error);
    // Kept or let go in this one step: a channel that ended meanwhile took the hold with it (the endpoint released it).
    const entry: Entry = { owner: id, assetHoldId: held.value.assetHoldId, machine, on };
    if (link.peerCapabilities() !== on) throw new CommandFailure(ipcError('host_unavailable', `artifacts.holdDatasets: the connection to ${link.name} was made again while the hold was asked`));
    const followed = owners.get(id);
    if (!followed) {
      releaseInBackground(entry);
      throw gone();
    }
    return keep(followed, entry);
  }

  return {
    /** `machine`: the artifact's, when it is another machine's (the router's `ctx.target`); null for this Mac's. */
    async hold({ artifactId, refs }: CommandInput<'artifacts.holdDatasets'>, client: ClientRef, machine: MachineRef | null = null): Promise<CommandOutput<'artifacts.holdDatasets'>> {
      const id = follow(client);
      return machine === null ? holdHere(id, artifactId, refs) : holdThere(id, machine, artifactId, refs);
    },
    async release({ holdId }: CommandInput<'artifacts.releaseDatasets'>, client: ClientRef): Promise<CommandOutput<'artifacts.releaseDatasets'>> {
      const entry = holds.get(holdId);
      if (!entry || entry.owner !== client.id) return { released: false };
      holds.delete(holdId);
      owners.get(entry.owner)?.delete(holdId);
      const result = await releaseHeld(entry);
      if (result !== null && !result.ok) throw new CommandFailure(result.error);
      return { released: true };
    },
    /** This Mac's host's connection went: it released every hold it took (another machine's are that machine's). */
    hostLost(): void {
      hostGeneration += 1;
      for (const entry of holds.values()) if (entry.machine === null) entry.assetHoldId = null;
    },
  };
}

export function registerDatasetHolds(register: typeof registerMainHandler, deps: DatasetHoldsDeps & { local: MachineRef; onHostLost(listener: () => void): () => void }): () => void {
  const holds = createDatasetHolds(deps);
  register('artifacts.holdDatasets', (input, { client, target }) => holds.hold(input, client, target === deps.local ? null : target));
  register('artifacts.releaseDatasets', (input, { client }) => holds.release(input, client));
  return deps.onHostLost(() => holds.hostLost());
}
