// The engine host (charter §4.1): the process that owns the Claude Code processes. It serves C1's ping and the engine
// host's X2 surface (C3). It imports `electron` only through C1's runHost. W13 (D-1 as amended 2026-10-01): it runs the
// user's installed Claude Code, resolved per launch to a real path (binary-info.ts).
// E10: one bundle, two modes, decided at load: `process.parentPort` present → `utility` (an Electron utility process
// forked by main, served over a MessagePort, as before); `--detached <supervisorDir>` in argv → `detached` (the
// supervisor: the Electron binary as Node, outliving the app, served over a Unix socket; detached.ts).
import { hostPing, runHost, type HostOn, type HostRegister } from '@shared/host/runtime';
import { captureShellEnvironment } from '@shared/host/shell-env';
// C3 start
import { join } from 'node:path';
import { registerEngineIpc, type EngineIpc } from './ipc';
import type { ProcessTable } from './process-table'; // W7
import { scheduleJournalPruning } from './journal';
import { replayRowDelayMs } from './replay-transport'; // E10
import { replayTranscriptProjects } from './replay-transcript'; // P3-F L242
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
// P3-A start
import { openDocuments, type Documents } from './documents';
import { timed } from './documents/host-work'; // P4-R6
import { registerArtifacts } from './documents/register'; // M4
// P3-A end
// P3-L start
import { registerLibrary } from './library'; // M2
// P3-L end
import { registerDocumentKind } from './documents/kinds/document'; // P3-B
import { documentPerfSeamRequested, startDocumentPerfSeam } from './documents/kinds/document-perf'; // P3-B M9: the scale gate's seam (e2e only)
// P3-D start
import { registerDesignSystems } from './design-systems'; // M6
// P3-D end
// P3-C start
import { registerPresentations } from './presentations'; // M3
import { presentationsScaleSeamRequested, startPresentationsScaleSeam } from './presentations/scale-seam'; // M10: the scale gate's seam (e2e only)
// P3-C end
import { registerDashboards } from './dashboards'; // P3-E (E2 M2)
import { dashboardE2eSeamRequested, startDashboardE2eSeam } from './dashboards/e2e-seam'; // P3-E (E2 M6): the acceptance seam (e2e only)
// P3-E start
import { registerDesigns } from './designs'; // E1's M2
// P3-E end
import { registerGoogleFaces } from './presentations/google-faces'; // P4-B2 D19
import { registerConnectors } from './connectors/register'; // P3-H H3b
import { hostDatasetRefresh } from './connectors/dataset-requests'; // E3

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
let documents: Documents | null = null; // P3-A: the artifact store (M4's IPC and document ports; M5 and M6 serve it too)

const register: HostRegister = (untimedOn, emit, client) => {
  // P4-R6: each request's synchronous part recorded as the host's work while a scale seam watches (documents/host-work.ts)
  const on: HostOn = (name, handler) => untimedOn(name, (input, ctx) => timed('request', () => handler(input, ctx), () => name));
  on('engine.ping', async () => hostPing(HOST_VERSION));
  // C4 start: the filesystem state service (fs.*) over the engine's store, read-only; C3's `session.events` answers an
  // app session with no process here from it (`diskEvents` below).
  // W7: a registry record of one of the process table's live pids is MAWS's own, never a holder
  let table: ProcessTable | null = null;
  const fs = registerFs(on, emit, process.env, { ownPids: () => new Set(table?.list().flatMap((s) => (s.pid !== null && s.lifecycle !== 'exited' ? [s.pid] : [])) ?? []) });
  // C4 end
  // P3-A: the artifact store and its document service, closed at the end of engine.shutdown's body, which both modes run
  // on the way out (utility: main's quit; detached: the exit order and host.stopAll). M4: `artifacts.*`, `spaces.*` and
  // the document ports main posts on the parent port; a store that failed to open answers `unavailable`.
  documents = openDocuments(userData);
  if (documents) registerDocumentKind(documents.store); // P3-B: the document kind's hooks on every document update
  if (documents && documentPerfSeamRequested(process.env)) startDocumentPerfSeam(documents.store, join(userData, 'document-perf')); // P3-B M9: the scale gate's seam, MAWS_E2E=1 and MAWS_DOCUMENT_PERF=1 only
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): agents' dataset refreshes, asked of main by id alone;
  // the sessions' tools ask, main reads (artifacts.*) and answers (maws.*), route E's starts claim; main's going ends them
  const datasetRefresh = hostDatasetRefresh(emit, client);
  const artifacts = registerArtifacts(on, emit, client, { documents, env: process.env, datasetRefresh });
  const store = documents?.store ?? null; // M6: the artifact tools' store (a session's tools answer `unavailable` without one)
  // P3-L: main's library reads, the linked-directory mirror and (M6b) the X12 import at store open
  const library = registerLibrary(on, { documents, deliverablesDir: join(userData, 'deliverables'), e2e: process.env.MAWS_E2E === '1' });
  const designSystems = registerDesignSystems({ on, documents }); // P3-D: the kind's adapter, its mirror writer, the create context, the seeded defaults and the windows' designSystems.* reads
  const presentations = registerPresentations({ documents, chain: designSystems.chain, refresh: library.refresh }); // P3-C: the deck's adapter and its mirror writer, kept fresh under its governing system (Decision Log 29)
  if (documents && presentationsScaleSeamRequested(process.env)) startPresentationsScaleSeam(documents.store, join(userData, 'presentations-scale')); // P3-C M10: the scale gate's seam, MAWS_E2E=1 and MAWS_PRESENTATIONS_SCALE=1 only
  const dashboards = registerDashboards({ documents }); // P3-E (E2 M2): the dashboard kind's adapter and its derived change index
  if (documents && dashboardE2eSeamRequested(process.env)) startDashboardE2eSeam(documents.store, join(userData, 'dashboard-e2e'), undefined, datasetRefresh); // P3-E (E2 M6): the agent's tools for the dashboard e2e groups, MAWS_E2E=1 and MAWS_DASHBOARD_E2E=1 only; E3 M4: with the host's refresh registry
  const designs = registerDesigns({ documents, chain: designSystems.chain, refresh: library.refresh }); // P3-E (E1's M2): the design's adapter (its legacy migration among its hooks) and its mirror writer, kept fresh under its governing system
  const googleFaces = registerGoogleFaces({ documents }); // P4-B2 D19: a deck's or a design's named Google Fonts face fetched once into its assets (OFL only), under the host's egress rule
  let connectors: { close(): void; closeDirect(): Promise<void> } | null = null; // P3-H H3b: below, over the process table
  // C3 start
  ipc = registerEngineIpc(on, emit, {
    afterShutdown: () => {
      connectors?.close(); // P3-H H3b: no connector operation or outcome outlives the sessions
      artifacts.close(); // P3-A
      library.close(); // P3-L
      designSystems.close(); // P3-D
      presentations.close(); // P3-C
      dashboards.close(); // P3-E
      designs.close(); // P3-E
      googleFaces.close(); // P4-B2
      documents?.close(); // P3-A
    },
    duringShutdown: async () => connectors?.closeDirect(), // P3-HD M2: route D's owned processes, ended beside the sessions
    userData, replayEnabled: process.env.MAWS_ENGINE_REPLAY === '1', appVersion: HOST_VERSION,
    replayRowMs: replayRowDelayMs(process.env), // E10: the e2e pacing seam
    replayTranscripts: replayTranscriptProjects(process.env), // P3-F L242: a replay's transcript, into the e2e scratch store only
    diskEvents: (id) => fs.eventsSnapshot(id, null) /* C4 */, heldElsewhere: (id, since) => fs.heldElsewhere(id, since) /* W7 */,
    onConnect: client.onConnect, hasClient: client.hasClient, // E10: the connect burst; a refused batch told from a client gone
    artifacts: () => store, // P3-A (M6)
    datasetRefresh, // E3
  });
  ({ table } = ipc);
  table.startSampling();
  // C3 end
  // P3-H H3b: route E's engine leg and the grant store's commands, main's alone; ended when main's client goes
  connectors = registerConnectors(on, emit, client, { sessions: table, store, datasetRefresh, deliveryConfig: { userData, captureEnv: captureShellEnvironment } }); // WR 76/78: cold owner delivery; E3: its registry
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
  return designSystems.ready; // one bounded startup admission gate, before any request handler may run
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
