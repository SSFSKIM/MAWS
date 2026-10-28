// One writer for the machine's data (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §2, binding; contract
// O3X2): the process that runs the spine takes `<profile>/spine.lock` before it opens any file §1 gives the spine (the
// index, `machine-settings.json`, intents, bootstraps, deletions, the prompt history, the attention fallback) and holds
// it for its life. It is O2's `takeLock` over its own file name, so liveness is a pid with its start time and a stale
// lock (a dead pid, or a live pid with another start time) is broken the way the supervisor's is. Until O3-D that
// process is always main, which takes it after settling the launch's shape and before it migrates or writes either
// settings file or opens the index, waiting a few seconds for a holder that is exiting. A candidate that still finds a
// live holder runs with the spine refused for its run: none of the spine's services starts, the index is opened
// unavailable, the machine settings are read but never written, and the client half runs; the reason names the holder's
// pid and build, is logged once and is carried in `host.status`. Its next start tries again.
import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { isAlive, procStartOf, readLock, takeLock, type LockDeps, type LockFile } from '../../engine-host/supervisor-files';

export const SPINE_LOCK = 'spine.lock';
export const SPINE_LOCK_NAMES = { lock: SPINE_LOCK, breaker: `${SPINE_LOCK}.break` } as const;
export const SPINE_LOCK_WAIT_MS = 5_000; // a holder that is exiting: an app whose single-instance lock has gone, still in its last steps
export const SPINE_LOCK_RETRY_MS = 250;

export interface SpineLock {
  refused: string | null; // why this run may not run the spine, or null when it holds the lock
  holder: LockFile | null; // the live holder that refused it
  release(): void; // removes the lock if it is still this process's; nothing for a refused run
}

const defaultDeps = (): LockDeps => ({ fs: nodeFs, isAlive, procStartOf, now: () => Date.now(), sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) });

// `build` is what the lock records of this process (main's version and commit), for a refused candidate's reason.
export async function takeSpineLock(
  profile: string,
  { build, waitMs = SPINE_LOCK_WAIT_MS, deps = defaultDeps(), log = (line: string) => console.error(line) }: { build: string; waitMs?: number; deps?: LockDeps; log?: (line: string) => void },
): Promise<SpineLock> {
  const mine = { protocol: SOCKET_PROTOCOL, buildId: build, socketPath: '' }; // the spine listens on no socket of its own
  const deadline = deps.now() + waitMs;
  for (;;) {
    if ((await takeLock(profile, mine, deps, SPINE_LOCK_NAMES)) === 'taken') break;
    if (deps.now() >= deadline) {
      const holder = readLock(profile, deps.fs, SPINE_LOCK);
      const refused = `${SPINE_LOCK} is held by pid ${holder?.pid ?? 'unknown'} (build ${holder?.buildId || 'unknown'}), so this run starts none of the machine's services and writes none of its files`;
      log(`[spine] ${refused}`);
      return { refused, holder, release: () => {} };
    }
    await deps.sleep(SPINE_LOCK_RETRY_MS);
  }
  const pid = deps.pid ?? process.pid;
  const written = readLock(profile, deps.fs, SPINE_LOCK);
  const procStart = written?.pid === pid ? written.procStart : '';
  return {
    refused: null,
    holder: null,
    release: () => {
      const lock = readLock(profile, deps.fs, SPINE_LOCK);
      if (lock === null || lock.pid !== pid || lock.procStart !== procStart) return; // broken meanwhile and taken by another
      try {
        deps.fs.unlinkSync(join(profile, SPINE_LOCK));
      } catch {
        // already gone
      }
    },
  };
}
