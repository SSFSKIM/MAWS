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
import { join, resolve } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import { assertSafeAppSessionId } from '@shared/engine/app-session-id';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { SessionStateStore } from '@shared/engine/session-state-store';
import type { LaunchResult } from '@shared/ipc/schema/session';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import type { BinaryCheck } from './binary-info';
import { JOURNAL_MAX_BYTES, JournalWriter } from './journal';
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { buildLaunch, LaunchSpecConflict, RELAY_URL, type LaunchPlan } from './launch';
import type { ProcessTable } from './process-table';
import { replayEngine } from './replay-transport';
import { EngineSession } from './session';
import { FileDeliverableStore } from './deliverables/store'; // E1
import type { EngineTransport } from './transport';

export const REPLAY_PRELUDE = 'test/fixtures/engine/replay-handshake.jsonl'; // relative to the launcher's cwd

export interface LauncherDeps {
  userData: string;
  replayEnabled: boolean;
  replayRowMs?: number; // E10: the replay transport's pause before each `in` row (the e2e pacing seam)
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
  hasClient?: () => boolean; // E10: the runtime's, handed to each session's bridges
}

function readJournal(path: string): JournalRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseJournalRow(JSON.parse(line)));
}

export function createLauncher(deps: LauncherDeps): (spec: LaunchSpec) => Promise<LaunchResult> {
  let prelude: JournalRow[] | null = null;
  const refused = (reason: Extract<LaunchResult, { status: 'refused' }>['reason'], message: string): LaunchResult => ({ status: 'refused', reason, message });

  return async (spec) => {
    assertSafeAppSessionId(spec.appSessionId); // before anything names a file after it (M5 review)
    if (spec.replay !== null && !deps.replayEnabled) return refused('replay_disabled', 'replay launches need MAWS_ENGINE_REPLAY=1');
    const liveNow = deps.table.get(spec.appSessionId);
    if (liveNow && liveNow.lifecycle !== 'exited') return refused('already_live', `process is ${liveNow.lifecycle}`);

    let captured: Record<string, string> = {};
    let journal: JournalRow[] | null = null;
    let relayHealth: RelayHealth | undefined;
    let engine: { bin: string; engineVersion: string; declaresSystemPromptSnapshot?: boolean }; // P2-C: the flag's declaration
    if (spec.replay !== null) {
      const fixture = resolve(deps.cwd, spec.replay);
      journal = readJournal(fixture); // throws on a missing or malformed fixture: the command fails `internal`
      prelude ??= readJournal(resolve(deps.cwd, REPLAY_PRELUDE));
      engine = { bin: fixture, engineVersion: TESTED_ENGINE_VERSION };
    } else {
      const [binary, relay, env] = await Promise.all([deps.binaryProbe(), spec.gateway === 'gateway' ? deps.checkRelay(false) : Promise.resolve(null), deps.captureEnv()]);
      // W13: a missing binary and one that printed no version refuse; a version other than the tested one never does
      if (!binary.ok || binary.version === null) return refused('binary_missing', binary.error ?? `no engine binary at ${binary.path}`);
      if (relay && !relay.ok) return { status: 'relay_unreachable', health: relay };
      captured = env;
      relayHealth = relay ?? undefined;
      engine = { bin: binary.path, engineVersion: binary.version, declaresSystemPromptSnapshot: binary.declaresSystemPromptSnapshot }; // P2-C
    }

    let plan: LaunchPlan;
    try {
      plan = buildLaunch(spec, captured, { relayUrl: RELAY_URL, ...engine });
    } catch (error) {
      if (error instanceof LaunchSpecConflict) return refused('settings_conflict', error.message);
      throw error;
    }

    const replay = journal;
    const spawn = replay !== null ? () => replayEngine(appReplayHandshake(replay, spec.trust), { prelude: prelude!, surfaceReads: true /* R2 */, rowDelayMs: deps.replayRowMs /* E10 */ }) : deps.spawn;
    const outcome = deps.table.reserve(spec.appSessionId, () => {
      const session = new EngineSession({
        spec, plan, spawn, store: deps.store, appVersion: deps.appVersion, relayHealth, log: (message) => deps.log(`${spec.appSessionId}: ${message}`),
        journal: new JournalWriter(journalDir(deps.userData, spec.appSessionId), plan.launchId, { maxBytes: JOURNAL_MAX_BYTES }),
        // C12 start: the budget policy's stateful servers (keepAlive), and `process_exit` for the first launch after a release
        statefulMcpServers: () => deps.table.statefulMcpServers,
        reconnectTrigger: deps.table.takeReleased(spec.appSessionId) ? 'process_exit' : 'user',
        // C12 end
        deliverables: (onWritten) => new FileDeliverableStore(deps.userData, { onWritten }), // E1: the maws tools' records under <userData>/deliverables; E2: announced
        hasClient: deps.hasClient, // E10: the bridges fail fast with no app connected
      });
      deps.wire(session, plan, spec);
      return session;
    });
    if (outcome.status === 'refused') return outcome; // a launch that raced this one to the reservation
    return { status: 'launching', session: outcome.session.status() };
  };
}

export function journalDir(userData: string, appSessionId: AppSessionId): string {
  assertSafeAppSessionId(appSessionId);
  return join(userData, 'engine-host', 'journal', appSessionId);
}
