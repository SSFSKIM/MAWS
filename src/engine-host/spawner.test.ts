// P5 O17 M7 fix 4: who spawned this engine host, read once from its own launch and taken out of its environment
import { describe, expect, it } from 'vitest';
import { ENGINE_HOST_SPAWNER_ENV, spawnerProcess, takeSpawnedByMawsd } from './spawner';
import { isAlive, isSameProcess, procStartOf as psProcStart } from './supervisor-files';

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

  // The landing fix wave: the spawner as browser work's first producer, read once at start
  it('a host mawsd spawned records its parent, pid and start (\'\' when unreadable); one main spawned records nothing; one already reparented to launchd records a producer that reads dead; neither reads a start', () => {
    const reads: number[] = [];
    const procStartOf = (pid: number) => (reads.push(pid), pid === 4242 ? 'Mon Nov  2 09:00:00 2026' : null);
    expect(spawnerProcess(true, 4242, procStartOf)).toEqual({ pid: 4242, procStart: 'Mon Nov  2 09:00:00 2026' });
    expect(spawnerProcess(true, 4343, procStartOf)).toEqual({ pid: 4343, procStart: '' });
    reads.length = 0;
    expect(spawnerProcess(false, 4100, procStartOf)).toBeNull(); // main's spawn: main produces nothing
    const gone = spawnerProcess(true, 1, procStartOf); // reparented to launchd: the mawsd that spawned it is already gone
    expect(gone).not.toBeNull();
    expect(isSameProcess(gone!, { isAlive, procStartOf: psProcStart })).toBe(false); // a producer that reads dead
    expect(reads).toEqual([]);
  });
});
