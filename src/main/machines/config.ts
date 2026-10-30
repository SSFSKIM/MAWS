// Which other machines this app links to (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md,
// "Configuration"). MAWS_LOCAL_MACHINES is a `:`-separated list of profile directories, each another profile's
// `<userData>` on this Mac, whose `mawsd` serves its machine (P5 O3-D M6; it named the stand-in's serve directory
// before). It is honoured only when the build is not packaged, and otherwise ignored with one log line, so in
// production, until O10's sources (the org state, RL2 endpoints), the connection manager holds only the local machine.
import { isAbsolute, normalize } from 'node:path';

export function configuredMachines({ packaged, env, log }: { packaged: boolean; env: NodeJS.ProcessEnv; log(line: string): void }): string[] {
  const listed = env.MAWS_LOCAL_MACHINES ?? '';
  if (listed === '') return [];
  if (packaged) {
    log('MAWS_LOCAL_MACHINES is ignored: a packaged build links to no other profile');
    return [];
  }
  const dirs = new Set<string>();
  for (const entry of listed.split(':')) {
    if (entry === '') continue;
    if (!isAbsolute(entry)) {
      log(`MAWS_LOCAL_MACHINES: skipped ${entry}, which is not an absolute path`);
      continue;
    }
    dirs.add(normalize(entry).replace(/(.)\/+$/, '$1'));
  }
  return [...dirs];
}
