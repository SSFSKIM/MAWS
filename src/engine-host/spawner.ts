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
