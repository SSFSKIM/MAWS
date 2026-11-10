// New chat in a project with no folder on this Mac (docs/doperpowers/plans/2026-11-10-project-registry.md, M11: "+ Session"
// offers the project's locations from the record; design §6): the row's "+" and its menu's New chat open a New chat tab
// with no project here whose machine menu has already chosen the project's location elsewhere (remote-spawn.ts's target,
// a place chosen on that machine), so Send starts the session there as any New chat sent to another machine does.
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import { createSession } from '../keymap/actions-runtime';
import { useRemoteSpawn, type SpawnTarget } from '../sessions/remote-spawn';
import type { RegistryProject } from '../stores/registry';

/**
 * Where the project's New chat starts: its first location whose folder is there, on a machine up over RL2 where the
 * member may start sessions (unknown rights grey nothing: the machine decides at the Send); null for none now.
 */
export function registrySpawnTarget(project: RegistryProject, machines: ReadonlyMap<MachineRef, MachineState>): SpawnTarget | null {
  for (const location of project.locations) {
    const machine = machines.get(location.machine);
    if (machine === undefined || machine.local || machine.state !== 'up' || (machine.carrier !== 'direct' && machine.carrier !== 'relay')) continue;
    if (location.state !== undefined || (machine.rights !== undefined && !machine.rights.includes('spawn'))) continue;
    return { machine: machine.ref, name: machine.name, checkout: location.path, key: null, label: project.name };
  }
  return null;
}

/** Opens a New chat tab with no project here, its machine and place there chosen; null when no tab opened. */
export async function newChatElsewhere(target: SpawnTarget): Promise<AppSessionId | null> {
  const tab = await createSession(null);
  if (tab !== null) useRemoteSpawn.getState().choose(tab, target);
  return tab;
}
