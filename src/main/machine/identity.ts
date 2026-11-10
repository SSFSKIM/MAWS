// The profile's machine identity in main (P5 O6 M1, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md; OX2;
// P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, M2 "The absence checks"): the profile's
// `MachineRef`, read or minted into `<userData>/machine.json` by whichever of the app and `mawsd` runs first (the module
// both share, src/shared/machine/identity-file.ts), and the machine's display name. `machine.identity` itself is
// `mawsd`'s to answer: main registers no handler for it.
import { machineName } from '@shared/machine/identity';
import { readOrMintMachineRef } from '@shared/machine/identity-file';
import type { MachineRef } from '@shared/machine/ref';

// Throws, naming the path, on a malformed identity file: startup stops rather than re-address everything kept.
export function readMachineIdentity({ userData, env, hostname }: { userData: string; env: NodeJS.ProcessEnv; hostname: string }): { ref: MachineRef; name: string } {
  return { ref: readOrMintMachineRef(userData), name: machineName(env, hostname) };
}
