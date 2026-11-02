// P5 O17 M7 fix 4 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M7; the architect's scope exception to R4): who
// spawned this engine host, read from its own launch rather than from anything its predecessor left. `mawsd` names
// itself in its spawn's environment (daemon.ts, the engine host's transport); main's spawn, and a `mawsd` from before
// fix 4, name nobody. The engine host takes the variable at start (index.ts), before any environment is captured or
// built, so no session host or engine launch inherits it. browser-work.ts reads the answer: in a host `mawsd` spawned,
// an adoption's `unknown` is a lost link's, which main's direct link does not clear.
export const ENGINE_HOST_SPAWNER_ENV = 'MAWS_ENGINE_HOST_SPAWNER';

// Whether `mawsd` spawned this host; the variable is removed from `env` either way
export function takeSpawnedByMawsd(env: NodeJS.ProcessEnv): boolean {
  const spawner = env[ENGINE_HOST_SPAWNER_ENV];
  delete env[ENGINE_HOST_SPAWNER_ENV];
  return spawner === 'mawsd';
}

// The landing fix wave: in a host `mawsd` spawned, its parent while that `mawsd` lives, as browser work's first producer
// (pid and start, '' for a start ps cannot read), read once at start; a later declaring hello replaces it. None in a host
// main spawned (main produces nothing). One already reparented to launchd (ppid 1) was spawned by a `mawsd` that is gone,
// its render host with it: its producer is one that reads dead (pid 0 names no process), so its lost holds settle.
const GONE: { pid: number; procStart: string } = { pid: 0, procStart: '' };
export function spawnerProcess(spawnedByMawsd: boolean, ppid: number, procStartOf: (pid: number) => string | null): { pid: number; procStart: string } | null {
  if (!spawnedByMawsd) return null;
  if (ppid === 1) return GONE;
  return { pid: ppid, procStart: procStartOf(ppid) ?? '' };
}
