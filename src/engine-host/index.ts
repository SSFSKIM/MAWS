// The engine host (charter §4.1): the process that owns the Claude Code processes. It serves C1's ping and the engine
// host's X2 surface (C3). It imports `electron` only through C1's runHost. W13 (D-1 as amended 2026-10-01): it runs the
// user's installed Claude Code, resolved per launch to a real path (binary-info.ts).
// E10: one bundle, two modes, decided at load: `process.parentPort` present → `utility` (an Electron utility process
// forked by main, served over a MessagePort, as before); `--detached <supervisorDir>` in argv → `detached` (the
// supervisor: the Electron binary as Node, outliving the app, served over a Unix socket; detached.ts).
import { hostPing, runHost, type HostRegister } from '@shared/host/runtime';
// C3 start
import { join } from 'node:path';
import { registerEngineIpc, type EngineIpc } from './ipc';
import type { ProcessTable } from './process-table'; // W7
import { JOURNAL_KEEP_PER_SESSION, JOURNAL_MAX_AGE_DAYS, pruneJournals } from './journal';
// C3 end
// C4 start
import { registerFs } from './fs/register';
// C4 end
// E10 start
import { runDetached } from './detached';
import { openSupervisorLog } from './supervisor-log';
// E10 end

const HOST_VERSION = __MAWS_VERSION__;

// C3 start: the app's userData directory, forwarded by main in the environment the host is started with (the host
// protocol's `hello` carries no fields, and a utility process has no `app.getPath`). Without it the host would write
// its journals and state files nowhere it could find again, so it refuses to start.
const userData = process.env.MAWS_USER_DATA;
if (!userData) throw new Error('the engine host needs MAWS_USER_DATA (main forwards app.getPath("userData"))');
// C3 end

let ipc: EngineIpc | null = null; // E10: the detached entry reaches the table through it

const register: HostRegister = (on, emit, client) => {
  // C3: journal pruning at host start (E10: here, so a detached candidate that finds the lock held prunes nothing)
  void pruneJournals(join(userData, 'engine-host', 'journal'), { keepPerSession: JOURNAL_KEEP_PER_SESSION, maxAgeDays: JOURNAL_MAX_AGE_DAYS }).catch((error: unknown) =>
    console.warn(`[engine-host] journal pruning failed: ${error instanceof Error ? error.message : String(error)}`),
  );
  on('engine.ping', async () => hostPing(HOST_VERSION));
  // C4 start: the filesystem state service (fs.*) over the engine's store, read-only; C3's `session.events` answers an
  // app session with no process here from it (`diskEvents` below).
  // W7: a registry record of one of the process table's live pids is MAWS's own, never a holder
  let table: ProcessTable | null = null;
  const fs = registerFs(on, emit, process.env, { ownPids: () => new Set(table?.list().flatMap((s) => (s.pid !== null && s.lifecycle !== 'exited' ? [s.pid] : [])) ?? []) });
  // C4 end
  // C3 start
  ipc = registerEngineIpc(on, emit, {
    userData, replayEnabled: process.env.MAWS_ENGINE_REPLAY === '1', appVersion: HOST_VERSION,
    diskEvents: (id) => fs.eventsSnapshot(id, null) /* C4 */, heldElsewhere: (id, since) => fs.heldElsewhere(id, since) /* W7 */,
    onConnect: client.onConnect, hasClient: client.hasClient, // E10: the connect burst; a refused batch told from a client gone
  });
  ({ table } = ipc);
  table.startSampling();
  // C3 end
};

// E10 start
const DEFAULT_IDLE_EXIT_MS = 10 * 60_000; // until main's host.configure (M2) says otherwise
const detachedAt = process.argv.indexOf('--detached');

// `process.parentPort` is Electron's, present only in a utility process; under ELECTRON_RUN_AS_NODE it is undefined.
if ((process as { parentPort?: unknown }).parentPort) {
  runHost(HOST_VERSION, register);
} else if (detachedAt !== -1 && process.argv[detachedAt + 1]) {
  const dir = process.argv[detachedAt + 1];
  runDetached(HOST_VERSION, register, {
    dir,
    modulePath: process.argv[1],
    idleExitMs: DEFAULT_IDLE_EXIT_MS,
    log: openSupervisorLog(dir),
    counts: () => {
      const rows = ipc?.table.list() ?? [];
      return { liveSessions: rows.filter((row) => row.lifecycle !== 'exited').length, rows: rows.length };
    },
    shutdown: async (graceMs) => {
      await ipc?.shutdown(graceMs); // engine.shutdown's body
    },
  });
} else {
  throw new Error('the engine host runs as a utility process (process.parentPort) or detached (--detached <supervisorDir>)');
}
// E10 end
