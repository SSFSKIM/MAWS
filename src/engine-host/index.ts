// The engine host (charter §4.1): the process that owns the Claude Code processes. It serves C1's ping and the engine
// host's X2 surface (C3). It imports `electron` only through C1's runHost. W13 (D-1 as amended 2026-10-01): it runs the
// user's installed Claude Code, resolved per launch to a real path (binary-info.ts).
// E10: one bundle, two modes, decided at load: `process.parentPort` present → `utility` (an Electron utility process
// forked by main, served over a MessagePort, as before); `--detached <supervisorDir>` in argv → `detached` (the
// supervisor: the Electron binary as Node, outliving the app, served over a Unix socket; detached.ts).
import { idleCollector } from '@shared/host/idle-collect';
import { hostPing, runHost, type HostOn, type HostRegister } from '@shared/host/runtime';
import { captureShellEnvironment } from '@shared/host/shell-env';
// C3 start
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os'; // P5 O16 M2
import { registerEngineIpc, type EngineIpc } from './ipc';
import type { ProcessTable } from './process-table'; // W7
import { JOURNAL_MAX_AGE_DAYS, scheduleJournalPruning } from './journal';
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
import { readMachineRole } from './role'; // P5 O2 M2
import { buildIdOf, isAlive, procStartOf } from './supervisor-files';
import { signalOrphan, type LiveRow } from './live-ledger'; // P5 O16 M2; M3: LiveRow
import { gateSocketPath, hostsDirOf, sessionHostBinary, sessionHostPaths } from './holder/files'; // P5 O16 M2; M3: sessionHostPaths
import { adoptHosted, releaseHost, startSessionHost } from './holder/transport'; // P5 O16 M2; M3: adoptHosted, releaseHost
import { liveHosts, pruneHostLogs, readRoster, removeHostFiles } from './holder/roster'; // P5 O16 M3
import { adoptable, adoptAll } from './holder/adopt'; // P5 O16 M3
import { MAX_LINE_CHARS } from './transport'; // P5 O16 M3
import { readFileSync } from 'node:fs'; // P5 O16 M3
import type { AppSessionId } from '@shared/graph/ids'; // P5 O16 M3
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
import { registerAttachment } from './attachment'; // P5 O3-D M3
import { Gate } from './holder/gate'; // O16 M5

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
let startJournalPruning: ((alsoKeep: () => readonly string[]) => void) | null = null; // P5 O16 M3: set by the register

// P5 O16 M2: what every session host of this engine host is started and reached with
const sessionHostDeps = (dir: string) => ({ hostsDir: hostsDirOf(dir), binary: sessionHostBinary(entryFile), userData: userData!, tmpdir: tmpdir(), log: (line: string) => console.log(`[session-host] ${line}`), child: { isAlive, procStartOf, signal: signalOrphan } });
// P5 O16 M3: a session host's token, written beside it by the launch that started it
const tokenOf = (dir: string, holderId: string): string => readFileSync(sessionHostPaths(hostsDirOf(dir), holderId, { userData: userData!, tmpdir: tmpdir() }).token, 'utf8').trim();

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
  // P5 O3-D M3 (Interfaces §D): the app's presence, which the app-bound gates below read: told by `host.attachment` when
  // the client declared it (`mawsd`, the permanent client), the connection otherwise (main's direct link, a utility port)
  // P5 O5 M4 (Interfaces §F): and whether a client answers render requests, the capture and export bridges' gate
  const attachment = registerAttachment(on, client);
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): agents' dataset refreshes, asked of main by id alone;
  // the sessions' tools ask, main reads (artifacts.*) and answers (maws.*), route E's starts claim; the app's going ends them
  // (P5 O4 M2, Interfaces §D: the connectors' presence, which for a client listing `host.connectors` is its connection)
  const datasetRefresh = hostDatasetRefresh(emit, client.connectorsPresence);
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
  // O16 M5 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §E): the gate, OX10's server, on both
  // shapes (no observer connects on a replay); every hosted launch's environment names it (MAWS_HOLDER_SOCKET). A gate
  // that cannot listen leaves every observer absent (logged), and the releases then follow owner Q1's rule.
  const gatePath = supervisorDir === undefined ? gateSocketPath(join(userData, 'supervisor'), userData, tmpdir()) : gateSocketPath(supervisorDir, dirname(supervisorDir), tmpdir());
  const gate = new Gate({ log: (line) => console.log(`[supervisor] ${line}`) });
  let gateFailed = false; // the status names the path from the start, and null once its listen failed
  gate.listen(gatePath).catch((error: unknown) => {
    gateFailed = true;
    console.warn(`[supervisor] the gate could not listen at ${gatePath}: ${error instanceof Error ? error.message : String(error)}`);
  });
  const idle = idleCollector({ log: (line) => console.log(`[supervisor] ${line}`), quiet: () => supervision?.quiet() ?? false }); // P5 Decision Log 124's lever: a collection at each entry into Supervision's quiet, asked again as it collects
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
      void gate.close(); // O16 M5: once no session is left to release
      documents?.close(); // P3-A
    },
    duringShutdown: async () => {
      idle.stop(); // every exit runs this body (main's quit, a stop-all, the detached exit order): no collection after
      await connectors?.closeDirect(); // P3-HD M2: route D's owned processes, ended beside the sessions
    },
    userData, replayEnabled: process.env.MAWS_ENGINE_REPLAY === '1', appVersion: HOST_VERSION,
    replayRowMs: replayRowDelayMs(process.env), // E10: the e2e pacing seam
    replayTranscripts: replayTranscriptProjects(process.env), // P3-F L242: a replay's transcript, into the e2e scratch store only
    diskEvents: (id, request, quiet) => fs.eventsSnapshot(id, null, request, quiet) /* C4 */, heldElsewhere: (id, since) => fs.heldElsewhere(id, since) /* W7 */,
    onConnect: client.onConnect, hasClient: client.hasClient, // E10: the connect burst; a refused batch told from a client gone
    appAttached: client.presence.attached, // P5 O3-D M3: the bridges ask only an attached app
    rendersAnswered: attachment.answersRenders, // P5 O5 M4: the capture and export bridges ask a client that renders, app or no app
    artifacts: () => store, // P3-A (M6)
    datasetRefresh, // E3
    gate, // O16 M5
    // P5 O16 M2 (D8): on the detached and daemon shapes every live launch runs under a session host, this build's binary
    // (Decision Log 161), its child signalled by the orphan sweep's own rule if the host is lost; every hosted launch's
    // MAWS_HOLDER_SOCKET names the gate (O16 M5: the one path both milestones compute, holder/files.ts)
    holder:
      supervisorDir === undefined
        ? undefined
        : {
            start: (launchId) => startSessionHost(launchId, sessionHostDeps(supervisorDir)),
            gateSocket: gatePath,
            // P5 O16 M3: the token the launch that started the host wrote beside it
            adopt: async (entry, checkpoint, startMs) => {
              const { transport, fence } = await adoptHosted({ ...entry, appSessionId: entry.appSessionId ?? '' }, { ...sessionHostDeps(supervisorDir), startMs, token: tokenOf(supervisorDir, entry.holderId), checkpoint, maxLineChars: MAX_LINE_CHARS });
              return { transport, fence };
            },
            release: (entry, startMs) => releaseHost(entry, { log: (line) => console.log(`[session-host] ${line}`), startMs, token: tokenOf(supervisorDir, entry.holderId) }),
          },
  });
  ({ table } = ipc);
  table.startSampling();
  // A follow lives while some client holds its session open, and FOLLOW_RELEASE_MS after (fs/service.ts)
  const interested = table;
  fs.watchInterest({ set: () => interested.interest(), onChange: (listener) => interested.onHoldChanged(listener) });
  // C3 end
  // P3-H H3b: route E's engine leg and the grant store's commands, main's alone; ended when the app goes (P5 O3-D M3), or,
  // for a client listing `host.connectors`, at its connection's end (P5 O4 M2, Interfaces §D)
  connectors = registerConnectors(on, emit, client.connectorsPresence, { sessions: table, store, datasetRefresh, deliveryConfig: { userData, captureEnv: captureShellEnvironment } }); // WR 76/78: cold owner delivery; E3: its registry
  // C3: journal pruning at host start (E10: here, so a detached candidate that finds the lock held prunes nothing; and
  // every 24 h after, keeping every launch the table holds a row for, since a supervisor outlives the app by days)
  // P5 O16 M3 (D25): a detached host's starts once its adoptions have ended (`adoptAtStart`), keeping every launch a
  // roster entry names as well, adopted or not, so a hosted launch older than the age limit is never pruned under its host
  const rows = table;
  startJournalPruning = (alsoKeep) => {
    scheduleJournalPruning(join(userData, 'engine-host', 'journal'), {
      keep: () => new Set([...rows.list().map((session) => session.status().launchId), ...alsoKeep()]),
      log: (line) => console.warn(`[engine-host] ${line}`),
    });
  };
  if (supervisorDir === undefined) startJournalPruning(() => []);
  // E10: registered after the engine ipc, so the status ends the connect burst
  supervision = new Supervision({
    mode,
    identity: { pid: process.pid, startedAt: new Date().toISOString(), buildId: buildIdOf(entryFile), protocol: SOCKET_PROTOCOL, wire: wireFingerprint(), socketPath: null, logPath: null },
    table, plugins: ipc.plugins, shutdown: ipc.shutdown,
    role: readMachineRole(), // P5 O2 M2: read once, at the start
    emit: (status) => emit('host.supervisorStatus', status),
    log: (line) => console.log(`[supervisor] ${line}`),
    collector: idle,
    startup: designSystems.ready, // the register's gate: no collection lands mid-seed
    gate: { path: () => (gateFailed ? null : gatePath), counts: () => rows.gateCounts() }, // O16 M5
    handingOver: () => datasetRefresh.handOver(), // P5 O16 M3b fix wave 4: a refresh in flight fails, retryable
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
    shutdown: async (graceMs, mode) => {
      await served().ipc.shutdown(graceMs, mode); // engine.shutdown's body; P5 O16 M3b: detaching the hosted rows but at a stop-all
    },
    life: {
      started: (identity, exit) => served().supervision.started(identity, exit),
      clientChanged: (connected) => served().supervision.clientChanged(connected),
      exitAsked: (when, from) => served().supervision.exitAsked(when, from), // P5 O16 M3b
      // Task 2.5: the sweep ended; the table records this supervisor's own ledger from now on, and the status the count
      orphansSwept: (killed, recordLive) => {
        const { ipc, supervision } = served();
        ipc.table.recordLive(recordLive);
        supervision.orphansSwept(killed);
      },
    },
    adopt: () => adoptAtStart(dir),
  });
}

// P5 O16 M3 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3; D10, D25, D46): the start's adoption, run in the
// detached entry's `listening` step. Synchronously: the roster read; the session host logs no entry names pruned once
// past the journals' age (D46); each dead host's files removed and its live child handed to the sweep; a row held for
// each live host adopted. Then the adoptions, in the background; once they have ended, the holds of the failed ones
// released, the failures counted in the status and journal pruning scheduled.
function adoptAtStart(dir: string): { liveHolders: ReadonlySet<string>; deadHostChildren: readonly LiveRow[] } {
  const engine = ipc!; // the register ran before the listen (the detached entry's order)
  const life = supervision!;
  const hostsDir = hostsDirOf(dir);
  const log = (line: string) => console.log(`[supervisor] ${line}`);
  const roster = readRoster(hostsDir, log);
  const prunedLogs = pruneHostLogs(hostsDir, new Set(roster.map((entry) => entry.holderId)), { maxAgeDays: JOURNAL_MAX_AGE_DAYS });
  if (prunedLogs > 0) log(`${prunedLogs} session host log(s) past ${JOURNAL_MAX_AGE_DAYS} days pruned`);
  const { live, dead } = liveHosts(roster, { isAlive, procStartOf });
  const deadHostChildren: LiveRow[] = dead.flatMap((entry) => (entry.child !== null && entry.exit === null ? [{ appSessionId: entry.appSessionId ?? '', pid: entry.child.pid, procStart: entry.child.procStart, launchId: entry.holderId, holderId: entry.holderId }] : []));
  for (const entry of dead) {
    log(`session host ${entry.holderId} (pid ${entry.pid}) is gone: its files removed`);
    removeHostFiles(hostsDir, entry);
  }
  const held = adoptable(live).take.flatMap((entry) => (entry.appSessionId !== null && entry.child !== null ? [entry.appSessionId as AppSessionId] : []));
  engine.table.holdForAdoption(held);
  void adoptAll(live, { adopt: (entry) => engine.adopt(entry), log }).then((outcome) => {
    for (const id of held) engine.table.adoptionEnded(id); // the adopted ones reserved theirs already
    if (live.length > 0) log(`adoption: ${outcome.adopted.length} of ${live.length} live session host(s) adopted, ${outcome.failed.length} not`);
    life.adoptionsEnded(outcome.failed.length);
    startJournalPruning?.(() => readRoster(hostsDir, () => {}).map((entry) => entry.holderId));
  });
  return { liveHolders: new Set(live.map((entry) => entry.holderId)), deadHostChildren };
}
// E10 end
