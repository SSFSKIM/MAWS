// P5 O17 M7 fix 4: who spawned this engine host, read once from its own launch and taken out of its environment
import { describe, expect, it } from 'vitest';
import { ENGINE_HOST_SPAWNER_ENV, takeSpawnedByMawsd } from './spawner';

describe('the engine host\'s spawner (P5 O17 M7 fix 4)', () => {
  it('reads mawsd from the variable mawsd sets, and takes it out of the environment so no child inherits it', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/Users/x', [ENGINE_HOST_SPAWNER_ENV]: 'mawsd' };
    expect(takeSpawnedByMawsd(env)).toBe(true);
    expect(env).toEqual({ HOME: '/Users/x' });
  });

  it('without it (main\'s spawn, a mawsd from before fix 4), or with any other value: not mawsd, and nothing is left', () => {
    expect(takeSpawnedByMawsd({ HOME: '/Users/x' })).toBe(false);
    const env: NodeJS.ProcessEnv = { [ENGINE_HOST_SPAWNER_ENV]: 'main' };
    expect(takeSpawnedByMawsd(env)).toBe(false);
    expect(env).toEqual({});
  });
});
