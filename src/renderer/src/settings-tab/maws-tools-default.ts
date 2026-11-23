// The machine's default set of MAWS's tools for a new session, as Settings › Sessions reads and chooses it and the
// composer learns whether a machine honours the choice (board ticket 421, docs/doperpowers/plans/2026-11-23-tool-choice.md,
// D4 and Interfaces §G, §H). The renderer's `settings.*` does not carry it: it goes through the machine's own
// `machineSettings.*`, whose answers carry `mawsTools` from ticket 421 on; absent, the machine's spine predates the choice,
// its sessions get every tool, and no control offers one. Choosing writes `machine-session-defaults.json` on the spine.
import { useEffect, useState } from 'react';
import type { MawsBridge } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { MawsToolSet } from '@shared/maws/tool-set';
import { ipc } from '../ipc/client';
import { MAWS_TOOLS } from './copy';

/** A machine's default set (this machine's unless one is named: a session's is its own machine's); null when its spine
 *  predates the choice or the read failed. */
export async function readMawsTools(client: MawsBridge = ipc, machine: MachineRef = client.localMachine): Promise<MawsToolSet | null> {
  const result = await client.invoke('machineSettings.get', undefined, { machine });
  if (!result.ok) {
    console.warn('[settings] machineSettings.get failed', result.error);
    return null;
  }
  return result.value.mawsTools ?? null;
}

/** `machine`'s default set, read once per mount and machine: undefined until the read answers, null when its spine
 *  predates the choice or the read failed, which is also the sign that it would not honour a set sent to it. */
export function useMachineMawsTools(machine: MachineRef, client: MawsBridge = ipc): MawsToolSet | null | undefined {
  const [read, setRead] = useState<{ machine: MachineRef; set: MawsToolSet | null } | null>(null);
  useEffect(() => {
    let live = true;
    void readMawsTools(client, machine).then((set) => live && setRead({ machine, set }));
    return () => {
      live = false;
    };
  }, [client, machine]);
  return read !== null && read.machine === machine ? read.set : undefined;
}

/** Chooses this machine's default set; a spine that answers without one dropped the choice. */
export async function chooseMawsTools(set: MawsToolSet, client: MawsBridge = ipc): Promise<{ ok: true; set: MawsToolSet } | { ok: false; error: string }> {
  const result = await client.invoke('machineSettings.set', { patch: {}, mawsTools: set }, { machine: client.localMachine });
  if (!result.ok) return { ok: false, error: result.error.message };
  return result.value.mawsTools === undefined ? { ok: false, error: MAWS_TOOLS.dropped } : { ok: true, set: result.value.mawsTools };
}
