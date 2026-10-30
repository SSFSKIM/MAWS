// The machine's identity in main's root (P5 O6 M1, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md; OX2):
// the profile's `MachineRef`, read or minted at startup into `<userData>/machine.json` through the module O2's `mawsd`
// shares (src/shared/machine/identity-file.ts), and `machine.identity`, registered with the `machine` owner's embedded
// binding. No Electron: O3 registers the same handler in `mawsd`'s runtime.
import type { ServiceHandler } from '@shared/spine/bus';
import { readOrMintMachineRef } from '@shared/machine/identity-file';
import type { MachineIdentity } from '@shared/ipc/schema/machine';
import type { CommandName } from '@shared/ipc/schema';
import { machineEnrollment, machineName, machineProject, type Enrollment } from '@shared/machine/identity'; // P5 O3-D M2 (D16): shared, so mawsd's front answers cold

export interface MachineIdentityDeps {
  userData: string;
  env: NodeJS.ProcessEnv;
  hostname: string;
  register: <N extends CommandName>(name: N, handler: ServiceHandler<N>) => void; // the `machine` owner's: registerMachineHandler in main's root
  enrollment?: () => Enrollment | null; // P5 O6 M5: `machineEnrollment` (none until O10); tests inject one
}

// Throws, naming the path, on a malformed identity file: startup stops rather than re-address everything kept.
export function startMachineIdentity({ userData, env, hostname, register, enrollment = machineEnrollment }: MachineIdentityDeps): MachineIdentity {
  const ref = readOrMintMachineRef(userData);
  const name = machineName(env, hostname);
  // P5 O6 M5 (OX3): the machine's own project, `machine:<ref>`, named after it; sminos's machine project id once enrolled.
  const identity: MachineIdentity = { ref, name, project: machineProject(ref, name, enrollment()) };
  register('machine.identity', () => identity);
  return identity;
}
