// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3); the ledger's E3 hold-IPC
// row): main's holds over a dashboard's snapshot bytes. A window's (`artifacts.holdDatasets` / `releaseDatasets`, the
// source sheet's captured snapshots and the painted cache's): main takes the engine host's main-only hold
// (`artifacts.holdAssets`) and answers a handle it mints, bound to the asking client; only that client releases it, and
// the client's end (its page closing, navigating or crashing) releases every hold it took (H's lease rule,
// src/main/connectors).
// The host's id never reaches a window, and the shared host connection is never a window's authority. A Download's
// (`holdAsset` below): main's own, through the dialog and the copy. When the host's connection goes, the host released
// every hold it took (src/engine-host/dashboards/holds.ts), so main forgets them; a window's later release still
// answers that its handle was released.
import { randomUUID } from 'node:crypto';
import type { ClientId, ClientRef } from '@shared/ipc/client';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { CommandFailure, type registerMainHandler } from '../ipc/router';

export interface DatasetHoldsDeps {
  call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>; // the engine host's commands
  log?: (line: string) => void;
}

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

export function createDatasetHolds({ call, log = (line) => console.warn(`[dashboard] ${line}`) }: DatasetHoldsDeps) {
  const holds = new Map<string, { owner: ClientId; assetHoldId: string | null }>(); // by the window's handle
  const owners = new Map<ClientId, Set<string>>(); // each live client's handles, from its first hold until it ends
  let hostGeneration = 0;

  const releaseOnHost = (assetHoldId: string) =>
    void call('artifacts.releaseAssets', { assetHoldId }).then(
      (result) => {
        if (!result.ok) log(`a hold was not released: ${result.error.message}`);
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
      if (entry?.assetHoldId) releaseOnHost(entry.assetHoldId);
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

  return {
    async hold({ artifactId, refs }: CommandInput<'artifacts.holdDatasets'>, client: ClientRef): Promise<CommandOutput<'artifacts.holdDatasets'>> {
      const id = follow(client);
      const asked = hostGeneration;
      const held = await call('artifacts.holdAssets', { artifactId, refs });
      if (!held.ok) throw new CommandFailure(held.error);
      const followed = owners.get(id); // gone once the client ended meanwhile, and never followed again
      if (!followed || hostGeneration !== asked) {
        if (hostGeneration === asked) releaseOnHost(held.value.assetHoldId);
        throw new Error('the window that asked for this hold has gone');
      }
      const holdId = randomUUID();
      holds.set(holdId, { owner: id, assetHoldId: held.value.assetHoldId });
      followed.add(holdId);
      return { holdId };
    },
    async release({ holdId }: CommandInput<'artifacts.releaseDatasets'>, client: ClientRef): Promise<CommandOutput<'artifacts.releaseDatasets'>> {
      const entry = holds.get(holdId);
      if (!entry || entry.owner !== client.id) return { released: false };
      holds.delete(holdId);
      owners.get(entry.owner)?.delete(holdId);
      if (entry.assetHoldId) {
        const result = await call('artifacts.releaseAssets', { assetHoldId: entry.assetHoldId });
        if (!result.ok) throw new CommandFailure(result.error);
      }
      return { released: true };
    },
    /** The host's connection went: it released every hold it took. */
    hostLost(): void {
      hostGeneration += 1;
      for (const entry of holds.values()) entry.assetHoldId = null;
    },
  };
}

export function registerDatasetHolds(register: typeof registerMainHandler, deps: DatasetHoldsDeps & { onHostLost(listener: () => void): () => void }): () => void {
  const holds = createDatasetHolds(deps);
  register('artifacts.holdDatasets', (input, { client }) => holds.hold(input, client));
  register('artifacts.releaseDatasets', (input, { client }) => holds.release(input, client));
  return deps.onHostLost(() => holds.hostLost());
}
