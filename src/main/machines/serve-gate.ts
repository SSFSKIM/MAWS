// The stand-in's gate (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The stand-in"; P5 Decision
// Log 21's conditions). O3 deletes this file with serve-standin.ts: profile B's own `mawsd` then serves the link surface.
//
// A packaged build never serves its machine services, whatever its environment says; a build that is not packaged serves
// them only when started with MAWS_MACHINE_SERVE=1 (tests and dev runs). The composition root constructs the stand-in
// behind this alone.
export function machineServeAllowed({ packaged, env }: { packaged: boolean; env: NodeJS.ProcessEnv }): boolean {
  if (packaged) return false;
  return env.MAWS_MACHINE_SERVE === '1';
}
