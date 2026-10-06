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
import { scheduleJournalPruning } from './journal';
import { replayRowDelayMs } from './replay-transport'; // E10
// C3 end
// C4 start
import { registerFs } from './fs/register';
// C4 end
// E10 start
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { runDetached } from './detached';
import { Supervision } from './supervision';
import { buildIdOf } from './supervisor-files';
import { openSupervisorLog } from './supervisor-log';
// E10 end

const HOST_VERSION = __MAWS_VERSION__;

// C3 start: the app's userData directory, forwarded by main in the environment the host is started with (the host
// protocol's `hello` carries no fields, and a utility process has no `app.getPath`). Without it the host would write
// its journals and state files nowhere it could find again, so it refuses to start.
const userData = process.env.MAWS_USER_DATA;
if (!userData) throw new Error('the engine host needs MAWS_USER_DATA (main forwards app.getPath("userData"))');
// C3 end

// E10 start: the mode, decided at load. `process.parentPort` is Electron's, present only in a utility process; under
// ELECTRON_RUN_AS_NODE it is undefined.
const detachedAt = process.argv.indexOf('--detached');
const supervisorDir = detachedAt === -1 ? undefined : process.argv[detachedAt + 1];
const mode = (process as { parentPort?: unknown }).parentPort ? 'utility' : supervisorDir ? 'detached' : null;
if (mode === null) throw new Error('the engine host runs as a utility process (process.parentPort) or detached (--detached <supervisorDir>)');
// This bundle's entry file, whose bytes are the build id: the detached spawn names it as the script; a utility process
// is forked from it, so it is this module's own file.
const entryFile = mode === 'detached' ? process.argv[1] : __filename;
let ipc: EngineIpc | null = null; // the detached entry reaches the table through it
let supervision: Supervision | null = null; // the host.* commands and the supervisor's clocks
// E10 end

const register: HostRegister = (on, emit, client) => {
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
    replayRowMs: replayRowDelayMs(process.env), // E10: the e2e pacing seam
    diskEvents: (id) => fs.eventsSnapshot(id, null) /* C4 */, heldElsewhere: (id, since) => fs.heldElsewhere(id, since) /* W7 */,
    onConnect: client.onConnect, hasClient: client.hasClient, // E10: the connect burst; a refused batch told from a client gone
  });
  ({ table } = ipc);
  table.startSampling();
  // C3 end
  // C3: journal pruning at host start (E10: here, so a detached candidate that finds the lock held prunes nothing; and
  // every 24 h after, keeping every launch the table holds a row for, since a supervisor outlives the app by days)
  const rows = table;
  scheduleJournalPruning(join(userData, 'engine-host', 'journal'), {
    keep: () => new Set(rows.list().map((session) => session.status().launchId)),
    log: (line) => console.warn(`[engine-host] ${line}`),
  });
  // E10: registered after the engine ipc, so the status ends the connect burst
  supervision = new Supervision({
    mode,
    identity: { pid: process.pid, startedAt: new Date().toISOString(), buildId: buildIdOf(entryFile), protocol: SOCKET_PROTOCOL, wire: wireFingerprint(), socketPath: null, logPath: null },
    table, plugins: ipc.plugins, shutdown: ipc.shutdown,
    emit: (status) => emit('host.supervisorStatus', status),
    log: (line) => console.log(`[supervisor] ${line}`),
  });
  supervision.register(on, client);
};

// E10 start
if (mode === 'utility') {
  runHost(HOST_VERSION, register);
} else {
  const dir = supervisorDir!;
  // The entry runs the register (createHostRuntime) before it listens, so every call below finds both; one that does
  // not is a broken ordering and fails loudly rather than doing nothing.
  const served = (): { ipc: EngineIpc; supervision: Supervision } => {
    if (!ipc || !supervision) throw new Error('the detached entry called into the engine host before its register ran');
    return { ipc, supervision };
  };
  runDetached(HOST_VERSION, register, {
    dir,
    modulePath: entryFile,
    log: openSupervisorLog(dir),
    counts: () => {
      const { liveSessions, rows } = served().supervision.status(); // the status's live-row rule, in one place
      return { liveSessions, rows };
    },
    shutdown: async (graceMs) => {
      await served().ipc.shutdown(graceMs); // engine.shutdown's body
    },
    life: {
      started: (identity, exit) => served().supervision.started(identity, exit),
      clientChanged: (connected) => served().supervision.clientChanged(connected),
      exitWhenIdle: () => served().supervision.armExitWhenIdle(true),
      // Task 2.5: the sweep ended; the table records this supervisor's own ledger from now on, and the status the count
      orphansSwept: (killed, recordLive) => {
        const { ipc, supervision } = served();
        ipc.table.recordLive(recordLive);
        supervision.orphansSwept(killed);
      },
    },
  });
}
// E10 end
