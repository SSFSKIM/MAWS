// `session.launch` (C3 execution document, X2 table, M5): the refusals, then one EngineSession reserved in the process
// table. In order: a replay spec needs MAWS_ENGINE_REPLAY=1 (a packaged app cannot be pointed at a fixture); a live
// reservation is refused `already_live`; a live launch resolves and probes the binary (W13: the installed Claude Code,
// its real path and `--version`), checks the relay (gateway launches only) and captures the login-shell environment, in
// parallel so the command stays inside the bridge's deadline; the plan is built on the probe's answer (a protected
// `--settings` key or a pinned id on a plain resume is `settings_conflict`); and the session is
// reserved and started, answering at once with its status (readiness arrives as `session.status`). A replay launch
// never touches the binary, the relay or the shell: nothing is spawned, the replay transport stands in for the process
// with the handshake prelude, and the rest of the adapter runs as it would live; its plan names the fixture as its
// binary and the tested version as its engine's.
import { appReplayHandshake } from './replay-handshake';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import { assertSafeAppSessionId } from '@shared/engine/app-session-id';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { RelayHealth } from '@shared/engine/relay-health';
import { HostCommandError } from '@shared/host/runtime'; // P5 O16 M2
import type { SessionStateStore } from '@shared/engine/session-state-store';
import type { LaunchResult } from '@shared/ipc/schema/session';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import type { BinaryCheck } from './binary-info';
import { JOURNAL_MAX_BYTES, JournalWriter, ownerOnlyJournalDirectory } from './journal'; // P3-HD: ownerOnlyJournalDirectory
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { buildLaunch, LaunchSpecConflict, RELAY_URL, type LaunchPlan } from './launch';
import type { ProcessTable } from './process-table';
import { replayEngine } from './replay-transport';
import { seedOnFirstUser } from './replay-transcript'; // P3-F L242
import { EngineSession } from './session';
import { MAX_LINE_CHARS, type EngineTransport } from './transport';
import { HostStartFailed, type StartedHost } from './holder/transport'; // P5 O16 M2
import { unsettledPrompts } from './prompt-history'; // P2-C
import type { ObservedFactsService } from './observed-facts'; // P2-A
import type { ArtifactStore } from './documents/store'; // P3-A (M6)
import type { DatasetRefreshRequests } from './connectors/dataset-requests'; // E3
import { captureLocalKey, type ConnectorLocalKey } from './connectors/local-key'; // P3-HD

export const REPLAY_PRELUDE = 'test/fixtures/engine/replay-handshake.jsonl'; // relative to the launcher's cwd

export interface LauncherDeps {
  userData: string;
  replayEnabled: boolean;
  replayRowMs?: number; // E10: the replay transport's pause before each `in` row (the e2e pacing seam)
  // P3-F L242: the e2e scratch store's projects directory a replay seeds its session's transcript into when it takes the
  // first prompt (./replay-transcript.ts); null or absent outside C10's replay seam
  replayTranscripts?: string | null;
  cwd: string; // resolves a relative replay path and the prelude
  table: ProcessTable;
  store: SessionStateStore;
  binaryProbe: () => Promise<BinaryCheck>;
  checkRelay: (force: boolean) => Promise<RelayHealth>;
  captureEnv: () => Promise<Record<string, string>>;
  spawn: (plan: LaunchPlan) => EngineTransport;
  appVersion: string;
  log: (message: string) => void;
  wire: (session: EngineSession, plan: LaunchPlan, spec: LaunchSpec) => void; // attaches the session's listeners before it starts
  appAttached?: () => boolean; // E10: handed to each session's bridges (P5 O3-D M3: the app's presence)
  observedFacts?: ObservedFactsService; // P2-A (X17): each launch records what the engine reports
  artifacts?: () => ArtifactStore | null; // P3-A (M6): the artifact store the sessions' artifact tools write through
  datasetRefresh?: Pick<DatasetRefreshRequests, 'ask'>; // E3: the registry the sessions' dataset refreshes ask main through
  // P3-HD: the local-scope key of a live launch's cwd, captured beside the probes, before the spawn (bounded, never failing
  // the launch: a failure is an unidentified key); tests inject it
  captureLocalKey?: (cwd: string) => Promise<ConnectorLocalKey>;
  // P5 O16 M2 (D8, D51): on the detached and daemon shapes, the session host every live launch runs under, started
  // before its row is reserved; `gateSocket` is the launch's MAWS_HOLDER_SOCKET. Absent (the embedded shape), the
  // direct spawn; a replay never has one.
  holder?: { start: (launchId: string) => Promise<StartedHost>; gateSocket: string };
}

function readJournal(path: string): JournalRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseJournalRow(JSON.parse(line)));
}

// `artifactScope` (P2-E1, D10): a side thread's ancestors, nearest first, whose artifacts its tools also resolve; handed
// to the session for this launch only, never stored.
export function createLauncher(deps: LauncherDeps): (spec: LaunchSpec, artifactScope?: readonly AppSessionId[]) => Promise<LaunchResult> {
  let prelude: JournalRow[] | null = null;
  const refused = (reason: Extract<LaunchResult, { status: 'refused' }>['reason'], message: string): LaunchResult => ({ status: 'refused', reason, message });

  const launch = async (spec: LaunchSpec, artifactScope: readonly AppSessionId[] = []): Promise<LaunchResult> => {
    assertSafeAppSessionId(spec.appSessionId); // before anything names a file after it (M5 review)
    if (spec.replay !== null && !deps.replayEnabled) return refused('replay_disabled', 'replay launches need MAWS_ENGINE_REPLAY=1');
    const liveNow = deps.table.get(spec.appSessionId);
    if (liveNow && liveNow.lifecycle !== 'exited') return refused('already_live', `process is ${liveNow.lifecycle}`);

    let captured: Record<string, string> = {};
    let journal: JournalRow[] | null = null;
    let relayHealth: RelayHealth | undefined;
    let connectorLocalKey: ConnectorLocalKey | undefined; // P3-HD: live launches only
    let engine: { bin: string; engineVersion: string; declaresSystemPromptSnapshot?: boolean; declaresAwaitInitialize?: boolean }; // P2-C, P5 O16 M2: the flags' declarations
    if (spec.replay !== null) {
      const fixture = resolve(deps.cwd, spec.replay);
      journal = readJournal(fixture); // throws on a missing or malformed fixture: the command fails `internal`
      prelude ??= readJournal(resolve(deps.cwd, REPLAY_PRELUDE));
      engine = { bin: fixture, engineVersion: TESTED_ENGINE_VERSION };
    } else {
      const [binary, relay, env, localKey] = await Promise.all([
        deps.binaryProbe(), spec.gateway === 'gateway' ? deps.checkRelay(false) : Promise.resolve(null), deps.captureEnv(),
        (deps.captureLocalKey ?? captureLocalKey)(spec.cwd).catch((): ConnectorLocalKey => ({ kind: 'unidentified', why: 'unreadable' })), // P3-HD
      ]);
      // W13: a missing binary and one that printed no version refuse; a version other than the tested one never does
      if (!binary.ok || binary.version === null) return refused('binary_missing', binary.error ?? `no engine binary at ${binary.path}`);
      if (relay && !relay.ok) return { status: 'relay_unreachable', health: relay };
      captured = env;
      relayHealth = relay ?? undefined;
      connectorLocalKey = localKey; // P3-HD
      engine = { bin: binary.path, engineVersion: binary.version, declaresSystemPromptSnapshot: binary.declaresSystemPromptSnapshot, declaresAwaitInitialize: binary.declaresAwaitInitialize }; // P2-C; P5 O16 M2 (D20, D48)
    }

    spec = await withParentBudget(spec, artifactScope, deps); // P2-F wave S (S-budget)

    const hosting = spec.replay === null ? (deps.holder ?? null) : null; // P5 O16 M2
    let plan: LaunchPlan;
    try {
      // spawned by this host (ipc.ts spawnEngine), or by its session host, whose pid replaces the placeholder below
      plan = buildLaunch(spec, captured, { relayUrl: RELAY_URL, spawnerPid: hosting ? 0 : process.pid, ...engine, ...(hosting && { holder: { gateSocket: hosting.gateSocket } }) });
    } catch (error) {
      if (error instanceof LaunchSpecConflict) return refused('settings_conflict', error.message);
      throw error;
    }

    // P5 O16 M2 (D8, D51): the session host starts before the row is reserved, so one that fails answers the launch with
    // `host_unavailable` naming its log, and nothing is spawned directly. It is the engine's parent: SMNS_MEMBER names it.
    let host: StartedHost | null = null;
    if (hosting) {
      try {
        host = await hosting.start(plan.launchId);
      } catch (error) {
        if (!(error instanceof HostStartFailed)) throw error;
        deps.log(`${spec.appSessionId}: ${error.message}`);
        throw new HostCommandError({ code: 'host_unavailable', message: error.message });
      }
      plan = { ...plan, env: { ...plan.env, SMNS_MEMBER: String(host.pid) } };
    }

    const replay = journal;
    const projects = deps.replayTranscripts ?? null; // P3-F L242
    const onFirstUser =
      projects === null
        ? undefined
        : seedOnFirstUser(projects, { cwd: plan.cwd, sessionId: plan.sessionId, engineVersion: plan.engineVersion, permissionMode: spec.permissionMode }, (message) => deps.log(`${spec.appSessionId}: ${message}`));
    const hosted = host;
    const spawn =
      replay !== null
        ? () => replayEngine(appReplayHandshake(replay, spec.trust), { prelude: prelude!, surfaceReads: true /* R2 */, rowDelayMs: deps.replayRowMs /* E10 */, onFirstUser })
        : hosted !== null
          ? (hostedPlan: LaunchPlan) => hosted.transport(hostedPlan, { appSessionId: spec.appSessionId, maxLineChars: MAX_LINE_CHARS }) // P5 O16 M2
          : deps.spawn;
    let outcome: ReturnType<ProcessTable['reserve']>;
    try {
      outcome = deps.table.reserve(spec.appSessionId, () => {
        const released = deps.table.takeReleased(spec.appSessionId); // C12; P5 O2 M2: also what the work state starts from
        const session = new EngineSession({
          spec, plan, spawn, store: deps.store, appVersion: deps.appVersion, relayHealth, log: (message) => deps.log(`${spec.appSessionId}: ${message}`),
          journal: openSessionJournal(deps.userData, spec.appSessionId, plan.launchId), // P3-HD
          // C12 start: the budget policy's stateful servers (keepAlive), and `process_exit` for the first launch after a release
          statefulMcpServers: () => deps.table.statefulMcpServers,
          reconnectTrigger: released ? 'process_exit' : 'user',
          // C12 end
          // P5 O2 M2: a resume after a release starts its crons known and empty; any other resume, unknown until its first Stop
          launchKind: spec.resume === null ? 'fresh' : released ? 'resumed_after_release' : 'resumed',
          appAttached: deps.appAttached, // E10: the bridges fail fast with no app attached
          unsettledPrompts: () => unsettledPrompts(journalDir(deps.userData, spec.appSessionId), plan.launchId), // P2-C
          observedFacts: deps.observedFacts, // P2-A
          artifactScope, // P2-E1
          artifacts: deps.artifacts, // P3-A (M6)
          datasetRefresh: deps.datasetRefresh, // E3
          connectorLocalKey, // P3-HD
          // P5 O16 M2: the session host, named in the spawn row and the status; released if the session ends unspawned
          ...(hosted && { holder: { pid: hosted.pid, holderId: hosted.holderId, binary: hosted.binary }, unspawned: () => hosted.abandon() }),
        });
        deps.wire(session, plan, spec);
        return session;
      });
    } catch (error) {
      hosted?.abandon(); // P5 O16 M2: a host whose launch got no row launches nothing
      throw error;
    }
    if (outcome.status === 'refused') {
      hosted?.abandon(); // P5 O16 M2
      return outcome; // a launch that raced this one to the reservation
    }
    return { status: 'launching', session: outcome.session.status() };
  };
  // the table holds it from its entry (P5 Decision Log 124: no collection lands on its preparation, which has no row yet)
  return (spec, artifactScope) => deps.table.preparing(() => launch(spec, artifactScope));
}

// P2-F wave S (S-budget; the owner's D7, Q12 as ruled 2026-10-11): a side thread takes its parent's numeric
// `--max-budget-usd` when the parent's last launch carried one and the thread's own spec names none: the same number, not
// a share of an aggregate, and no default where the parent had none. A side thread is the launch whose artifact scope
// names its ancestors (nearest first, so the first is its parent; a fork the human made, a resume of a root and every
// other launch has none); the parent's spec is the one the host stored at its last start (`saveLaunchSpec`), so a
// parent that has exited, or a thread of a thread, reads the same. An unreadable parent spec leaves the thread as it was.
async function withParentBudget(spec: LaunchSpec, artifactScope: readonly AppSessionId[], deps: Pick<LauncherDeps, 'store' | 'log'>): Promise<LaunchSpec> {
  const parent = artifactScope[0];
  if (spec.maxBudgetUsd !== null || parent === undefined) return spec;
  try {
    const maxBudgetUsd = (await deps.store.loadLaunchSpec(parent))?.maxBudgetUsd ?? null;
    return maxBudgetUsd === null ? spec : { ...spec, maxBudgetUsd };
  } catch (error) {
    deps.log(`${spec.appSessionId}: the budget of its parent ${parent} was not read: ${messageOf(error)}`);
    return spec;
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function journalDir(userData: string, appSessionId: AppSessionId): string {
  assertSafeAppSessionId(appSessionId);
  return join(userData, 'engine-host', 'journal', appSessionId);
}

// P3-HD start (P3 co-work Decision Logs 97 and 98): a launch's journal, with the journal root owner-only as well as the
// session directory and files the writer keeps so.
export function openSessionJournal(userData: string, appSessionId: AppSessionId, launchId: string): JournalWriter {
  const dir = journalDir(userData, appSessionId);
  ownerOnlyJournalDirectory(dirname(dir));
  return new JournalWriter(dir, launchId, { maxBytes: JOURNAL_MAX_BYTES });
}
// P3-HD end
