// EngineSession (charter §4.1, §4.2, §4.4, §4.6; C3 execution document, Interfaces, M3 and M4): the object that wires
// one engine process — transport, control client, normaliser, permission broker, the app queue and `!` mode — runs the
// initialize handshake, the gateway verification read, grant re-application on a resume and queue recovery, and ends
// the process through the termination ladder (session-ladder.ts). Its one invariant: every row is journaled before it is normalised, and
// the normaliser is the only source of events. Every stdout frame, every frame we write (through `record`, which the
// one OutboundWriter per process also uses), every stderr line, and the `meta` rows the host writes (spawn,
// initialize, status check, init_failed, reconnect, queue, notices, the normaliser's own warnings, exit) pass through
// `record`, which journals the row and then normalises it; nothing here builds an event. What the frames say about the
// process lives in SessionStatusTracker (session-status.ts); the queue in MessageQueue (queue.ts); the plan outcome
// "clear context and implement" in ClearAndImplementSequence (session-clear.ts); the `maws` tool server, its bridges and
// the asks in SessionMaws (session-maws.ts).
import { readFileSync, realpathSync } from 'node:fs'; // P5 O16 M3
import { dirname, join } from 'node:path'; // P5 O16 M3
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid, RequestId } from '@shared/graph/ids';
import { HANDOVER_REINIT_FAILED, type AutoModeRefusalCode, type ExitCause, type PermissionMode } from '@shared/graph/enums';
import type { RequestAnswer } from '@shared/engine/answers';
import type { Effort, LaunchSpec } from '@shared/engine/launch-spec';
import type { CronRecord, QueueEntry, QueueState, SendContent, SessionStateStore } from '@shared/engine/session-state-store';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SurfaceAnswer } from '@shared/engine/surface'; // R2
import { HookCallbackRequestSchema, type GetStatusResponse, type InterruptResponse, type ReloadPluginsResponse } from '@shared/wire/control';
import type { ControlRequestFrame } from '@shared/wire/frames';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import { BashMode } from './bash-mode';
import { PermissionBroker } from './broker';
import { appInitialize } from '@shared/engine/initialize';
import { cancelAsyncMessage, endSession, getContextUsage, getStatus, initialize, interrupt, mcpStatus, REQUEST_TIMEOUT_MS, requestClassOf, setMaxThinkingTokens, setPermissionMode } from './controls';
import { EMPTY_GRANTS, reapply, recordFromResponse, type GrantSnapshot } from './grants';
import { ENGINE_COMPAT_NOTICE_KEY, EngineCompatWatch } from './engine-compat'; // W13
import { HostHookRegistry, isStopCallbackId, registerStopHook } from './host-hooks';
import type { LaunchKind } from './work-state'; // P5 O2 M2
import { DurableCronSource, type ReadTextFile } from './durable-crons'; // P5 O2 M2
import { REAP_TERM_MS, type ReapView } from './holder/reap'; // O16 M5
import { expectedArgv } from './holder/descendants'; // O16 M5, D52
import { RELAY_URL, spawnMeta, type LaunchPlan } from './launch';
import { HostMap } from './holder/checkpoint'; // P5 O16 M2
import { launchRows, OutstandingSet, type Outstanding } from './holder/restore'; // P5 O16 M3
import { UnsettledFold } from './prompt-history'; // P5 O16 M3
import { resolveStorePaths, slugOf } from './fs/paths'; // P5 O16 M3: the reseed's transcript
import { cancelledCallOf, readMcpMessage, toolCallOf } from '@shared/maws/rpc'; // P5 O16 M3: the barrier and the disposal
import { Normalizer, type NormalizerWarning } from './normalizer';
import { JournalClosed, OutboundWriter, type WriteOptions } from './outbound-writer';
import { MessageQueue, type SteerPriority } from './queue';
// C12 start
import { hardReasons } from './budget';
// C12 end
import { ControlClient, ControlError, ControlTimeout } from './rpc';
import { ClearAndImplementSequence } from './session-clear';
import { LADDER_MS, TerminationLadder, type ExitReason, type ExitSummary, type StopResult } from './session-ladder';
import { isPermissionMode, SessionStatusTracker, type Catalog } from './session-status';
import { SESSION_START_HOOK_MS, sessionStartHookMs } from './session-start-hooks';
import { MemorySessionStateStore } from './store/memory-session-state-store';
import { SessionSurface } from './surface'; // R2
// E1 start (E11: the wiring in session-maws.ts)
import type { MawsArtifactCapturedResult, MawsArtifactExportAnswer, MawsDownloadRecorded, MawsPaneAnswerResult } from '@shared/ipc/schema/maws';
import type { PendingAsk } from '@shared/maws/ask';
import type { AskAnswer } from '@shared/maws/tools';
import { SessionMaws, type MawsListeners } from './session-maws';
// E1 end
// E3 start
import type { SideQuestionRequest } from '@shared/wire/control';
import { SideQuestionLog } from './side-questions';
// E3 end
import type { EngineTransport, TransportItem, TransportProblem } from './transport';
// P2-A start (2026-10-09; X17)
import type { ObservedFactsAnswer } from '@shared/engine/observed-facts';
import type { ObservedFactsRecorder, ObservedFactsService } from './observed-facts';
import type { ArtifactStore } from './documents/store'; // P3-A (M6)
import type { DatasetRefreshRequests } from './connectors/dataset-requests'; // E3
// P2-A end
import { connectorLaunchContext, type ConnectorLaunchContext } from './connectors/provenance'; // P3-HD
import type { ConnectorLocalKey } from './connectors/local-key'; // P3-HD

export { HostHookRegistry } from './host-hooks';
export type { Catalog } from './session-status';
export { LADDER_MS, type ExitReason, type ExitSummary, type StopResult } from './session-ladder';
// How long stdout's end waits for a write still in flight before failing it and ending the process (M3 re-review 3).
export const EOF_WRITE_WAIT_MS = 3_000;
// C3 corrective (2026-09-30 ledger): how long a starting engine may say nothing at all (no stdout frame, no stderr line)
// before the launch is failed. A healthy start writes within half a second; the C12 pre-run's stalled resumes wrote
// nothing for 120 s, dying of SIGTERM's default action, so before the engine had even installed its signal handler.
// An engine that has written anything keeps the long class's initialize deadline, since SessionStart hooks, which the
// engine runs before it reads `initialize`, may legitimately take minutes and announce themselves with `hook_started`.
export const FIRST_OUTPUT_MS = 30_000;
// Debt wave 5: 2.1.283 runs SessionStart hooks before it reads `initialize`, so each hook frame it streams first restarts
// `initialize`'s deadline: the long class from the frame, plus the hooks' bound while a hook it reported started has not
// reported back (debt wave 6: the largest SessionStart `timeout` the launch's settings configure, at least 600 s).
export { SESSION_START_HOOK_MS } from './session-start-hooks';
const STDERR_TAIL_LINES = 20;

// What the session journals through: JournalWriter satisfies it; tests use an in-memory journal.
export interface SessionJournal {
  row(direction: JournalDirection, frame: unknown): JournalRow;
  readonly path: string;
  close(): Promise<void>;
  // P5 O16 M2: what a hosted launch's host map needs (holder/checkpoint.ts): the last row's seq and the file rows go to now
  readonly lastSeq?: number;
  readonly currentPath?: string;
}

export interface EngineSessionOptions {
  spec: LaunchSpec;
  plan: LaunchPlan;
  spawn: (plan: LaunchPlan) => EngineTransport; // spawnEngine, or a replay transport under test and MAWS_ENGINE_REPLAY
  journal: SessionJournal;
  store?: SessionStateStore; // the queue, the grant snapshot and the last launch spec (FileSessionStateStore in production; in memory by default)
  hooks?: HostHookRegistry;
  grants?: GrantSnapshot; // the snapshot to re-apply on a resume; loaded from the store when absent
  onGrants?: (snapshot: GrantSnapshot) => void; // every change, after it was handed to the store
  reconnect?: boolean; // journal session.reconnect rows; default: a non-fork resume
  relayHealth?: RelayHealth; // the check that let a gateway launch spawn (M5): journaled after the spawn row
  appVersion?: string;
  log?: (message: string) => void;
  // C12 start: the stateful MCP servers of the budget policy, read at every status (the status's keepAlive); and the
  // trigger this launch's reconnect rows carry, `process_exit` for the first launch after a release
  statefulMcpServers?: () => ReadonlySet<string>;
  reconnectTrigger?: 'user' | 'process_exit' | 'host_restart'; // P5 O16 M3: host_restart, an adoption's
  // C12 end
  // P5 O2 M2: what the work state starts from (work-state.ts): the launcher's `resumed_after_release` for the first launch
  // after a release; absent, `fresh` without a resume and `resumed` with one
  launchKind?: LaunchKind;
  scheduledTasksFile?: ReadTextFile; // P5 O2 M2: the durable crons' file read (durable-crons.ts); the disk by default
  sessionStartHookMs?: (plan: LaunchPlan) => Promise<number>; // debt wave 6: the hooks' bound; read from the settings by default
  // E10: whether an app is attached to the engine host (P5 O3-D M3: the runtime's AppPresence); `show_pane` and
  // `artifact_screenshot` fail at once with `appNotOpen` while it is false. Absent, always attached.
  appAttached?: () => boolean;
  // P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §F): `artifact_screenshot`'s and
  // `artifact_export`'s gate, a client that answers render requests (the attachment's `answersRenders`: an attached app,
  // or a post-O5 `mawsd` whose render seam answers them). Absent, `appAttached`.
  rendersAnswered?: () => boolean;
  // P2-C (2026-10-09): the steers earlier launches left unstated when the host died with them (the launcher's read of
  // the session's journals), abandoned as rows at the queue's recovery. Absent, none.
  unsettledPrompts?: () => Promise<MessageUuid[]>;
  // P2-A (X17): the host's observed facts; this launch's recorder is fed every row the session journals and writes the
  // facts beside the state file. Absent (the conformance suites, unit tests), nothing is recorded.
  observedFacts?: ObservedFactsService;
  // P2-E1 (D10): a side thread's ancestors, nearest first, whose artifacts its artifact tools also resolve (main's
  // `artifactScopeOf`, sent beside the spec by `session.launch`; never stored). Absent or empty for any other session.
  artifactScope?: readonly AppSessionId[];
  // P3-A (M6): the engine host's artifact store, which the artifact tools write through (null when it failed to open);
  // its turn version is written at each of the session's turn ends. Absent, the artifact tools answer `unavailable`.
  artifacts?: () => ArtifactStore | null;
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): the host's registry an agent's dataset refresh
  // asks main through. Absent, `artifact_dataset`'s refresh answers `unavailable`.
  datasetRefresh?: Pick<DatasetRefreshRequests, 'ask'>;
  // P3-HD: the local-scope `projects` key the launcher captured before this launch spawned (connectors/local-key.ts);
  // host-private, for route D's observations only. Absent (a replay, a test), local scope stays engine-only.
  connectorLocalKey?: ConnectorLocalKey;
  // P5 O16 M2: the session host this launch runs under (started before the row was reserved, D51), named in the spawn
  // row; and what to do with it when the session ends without ever spawning (stopped first): release it
  holder?: { pid: number; holderId: string; binary: string };
  unspawned?: () => void;
  // P5 O16 M3 (Interfaces §D; D24, D26, D37): a process an earlier engine host launched, which `spawn` hands back as the
  // session host's transport already attached at `fence` and reading from the checkpoint's frontier (adoptHosted).
  // Nothing is spawned; the journal is the launch's own, resumed; whether an interrupt was owed and the observer seen
  // come from the state file.
  adopted?: AdoptedLaunch;
  reinitializeMs?: number; // P5 O16 M3a fix wave 1: the adopted re-initialize's wait before it logs and waits on (tests)
}

// P5 O16 M3a fix wave 1 (D58): how long an adopted engine's re-initialize is waited for before the wait is logged and
// renewed. Never a failure: the engine answers control requests between the steps of its turn, so an engine the
// handover found mid-turn can sit on the answer for as long as one step runs (a Bash call up to its 600 s ceiling)
// under the load of the handover itself, well above a fresh initialize's 120 s long class. Expiry with the process alive
// only logs and keeps waiting; a definite failure (an error answer, the output closed, the process gone) ends it.
export const ADOPTED_REINITIALIZE_MS = 600_000;
// P5 O16 M3b: told once, at the first renewal, so a session the handover found deep in a step says why it waits
export const REINITIALIZE_SLOW = 'The engine has not answered since the update; it is still running and may be in a long step. Stop ends it.';

// P5 O16 M3a fix wave 1: why an adoption did not become a served session. `abandoned`: it failed before its first
// write (the fold or the queue's restore), so its session host and engine were left running for the next start.
export class AdoptionFailed extends Error {
  constructor(message: string, readonly abandoned: boolean) {
    super(message);
    this.name = 'AdoptionFailed';
  }
}

// P5 O16 M3a fix wave 2: a test seam, null in production. `beforeFold` runs synchronously as an adoption's fold begins,
// while the fold holds the event loop, so a test can make the session host's ring overflow under a reader that reads
// nothing, deterministically (holder/adoption.test.ts); a throw is a failed fold.
export const adoptionTestSeams: { beforeFold: ((launchId: string) => void) | null } = { beforeFold: null };

export interface AdoptedLaunch {
  fence: number;
  frontier: number;
  owedInterrupt: boolean;
  observerSeen: boolean;
}

// C12: the budget and the sum a release was made at (X6 `exit.release`, X1 `process.exited.budget`)
export interface BudgetRelease { limitKiB: number; totalKiB: number }

export interface SendResult { messageUuid: MessageUuid | null; disposition: 'sent' | 'queued'; queueId: string; entry: QueueEntry }

interface SessionListeners {
  events: (events: SessionEvent[]) => void;
  status: (status: EngineSessionStatus) => void;
  brokerItems: (items: AttentionItem[]) => void;
  queue: (queue: QueueState) => void;
  exited: (summary: ExitSummary) => void;
  catalog: (catalog: Catalog) => void; // C7: the whole catalogue, whenever its revision moved
  models: (models: unknown[]) => void; // C10: the initialize response's model list, for the catalogue cache
}
// E1, E2: paneShow, artifactCapture; P3-A M7: artifactExport (session-maws.ts)
type Listeners = SessionListeners & MawsListeners;

type ProcessState = EngineSessionStatus['process'];
type Frame = Record<string, unknown> & { type?: unknown; subtype?: unknown };

export class EngineSession {
  readonly exited: Promise<ExitSummary>;
  readonly queue: MessageQueue;
  private resolveExited!: (summary: ExitSummary) => void;
  private readonly spec: LaunchSpec;
  private readonly plan: LaunchPlan;
  private readonly journal: SessionJournal;
  private readonly store: SessionStateStore;
  private readonly hooks: HostHookRegistry;
  private readonly normalizer: Normalizer;
  private readonly broker: PermissionBroker;
  private readonly tracker: SessionStatusTracker;
  private readonly bashMode: BashMode;
  private readonly ladder: TerminationLadder;
  private readonly clearAndImplement: ClearAndImplementSequence;
  private readonly compat = new EngineCompatWatch(); // W13: one notice per session process
  readonly surface: SessionSurface; // R2: the remote surface MAWS attaches as
  private readonly maws: SessionMaws; // E1: the `maws` tool server, its bridges and the asks (session-maws.ts)
  private readonly observed: ObservedFactsRecorder | null; // P2-A (X17)
  readonly sideQuestions = new SideQuestionLog(); // E3: this process's `/btw` exchanges (host memory, X13)
  private readonly reconnect: boolean;
  private readonly log: (message: string) => void;
  private readonly listeners: { [K in keyof Listeners]: Set<Listeners[K]> } = { events: new Set(), status: new Set(), brokerItems: new Set(), queue: new Set(), exited: new Set(), catalog: new Set() /* C7 */, models: new Set() /* C10 */, paneShow: new Set() /* E1 */, artifactCapture: new Set() /* E2 */, artifactExport: new Set() /* P3-A M7 */ };
  private readonly pendingWarnings: NormalizerWarning[] = [];
  private readonly stderrTail: string[] = [];
  private readonly storeWrites = new Set<Promise<void>>();
  private readonly launchedAt = new Date().toISOString();

  private transport: EngineTransport | null = null;
  private hostMap: HostMap | null = null; // P5 O16 M2: a hosted launch's map of host sequences to journal rows
  // P5 O16 M2 (D12): the newest interrupt's number, and its request id once it timed out (its late answer clears the mark)
  private readonly owedInterrupt: { generation: number; lateRequestId: string | null } = { generation: 0, lateRequestId: null };
  private client: ControlClient | null = null;
  private writer: OutboundWriter | null = null;
  private readonly held: TransportItem[] = []; // inbound frames read while an out write was in flight (M3 re-review)
  private starting: Promise<void> | null = null;
  private processState: ProcessState = 'starting';
  private exitInfo: EngineSessionStatus['exit'] = null;
  private stopReason: 'stop' | 'archive' | 'quit' | 'budget' | 'idle' | null = null; // C12: 'budget'; E10: 'idle'
  // C12 start: the release a budget stop carries until the exit; the last use (the launch until the first command)
  private release: BudgetRelease | null = null;
  private lastUsedAt: string;
  // C12 end
  private handshakeDone = false;
  private silence: ReturnType<typeof setTimeout> | null = null; // C3 corrective: the first-output bound, until anything is read
  // debt wave 5: the initialize request once written, and the SessionStart hooks reported started and not yet back
  private initializeId: RequestId | null = null;
  private hooksBeforeAnswer: Set<string> | null = null; // null until the first hook frame
  private hookBoundMs = SESSION_START_HOOK_MS; // debt wave 6: the launch's configured bound once read
  private initFailed = false;
  private exitCause: ExitCause | null = null; // P5 O16 M3b (D58a): the adopted re-initialize's failure, carried by the end
  private journalClosed = false;
  private lastEventSeq = 0;
  private lastStatusSignature = '';
  private grants: GrantSnapshot;
  private requestedModel: string | null; // the launch spec's, until `session.setModel` (M5)
  private requestedEffort: Effort | null; // the launch spec's, until `session.setEffort` (M5)
  private publishedCatalogRevision = 0; // C7: the tracker's catalogue revision last published (0: nothing yet)
  // C10 start: the initialize response's `workspace_trust_recorded` (status.trust.recorded), and whether the snapshot
  // was inherited from `spec.inheritGrantsFrom` (then it is re-applied like a resume's)
  private trustRecorded: boolean | null = null;
  private inheritedGrants = false;
  // C10 end
  private kept = false; // P5 O2 M2: the owner's Keep running mark, from the store at the launch and `session.setKeep`
  private readonly durableCrons: DurableCronSource; // P5 O2 M2: the durable crons and the engine session ids they match
  // O16 M5 start: the reap's view and inputs (holder/reap.ts): its state and the gate's observer, the work under the
  // engine as last read, an idle reap the engine ignored (until the next Stop), the stdio MCP servers' command lines
  // (`mcp_status`, read once for the launch), and whether this launch's observer was saved as seen
  private reapView: ReapView | null = null;
  private descendants: number | null = 0;
  private reapIgnored = false;
  private reaping = false; // P5 O16 M3b fix wave 2: an idle reap between its end_session and its verdict
  private mcpServerCommands: string[][] | null = null;
  private mcpRead: Promise<void> | null = null;
  private observerSaved = false;
  // O16 M5 end
  // P5 O16 M3 start: an adoption's state. The barrier: the outstanding set from the fold until the replay has caught up
  // (null otherwise; while it is set no inbound request is dispatched but the `maws` server's protocol service); the
  // fold running (nothing is told); `host_attach` written; the queue adopted; the turn ends whose release waits for the
  // re-initialize; the last conversation message the journal holds (where a gap's reseed starts reading)
  private outstanding: OutstandingSet | null = null;
  private folding = false;
  private attachRecorded = false;
  private queueAdopted = false;
  private readonly deferredTurnEnds: Extract<SessionEvent, { kind: 'turn.ended' }>[] = [];
  private releaseDeferred: boolean; // an adopted process's queue releases nothing until its re-initialize is done
  private lastMessageUuid: string | null = null;
  private thinkingDisplayRequestId: RequestId | null = null; // the startup display preference's request, whose late answer warns nobody
  // fix wave 1: the dispatch gate from the catch-up until the re-initialize is answered (the requests it holds, in order;
  // null when open); the re-initialize's renewing wait; the adoption's outcome
  private handshakeHeld: ControlRequestFrame[] | null = null;
  private reinitializeWait: ReturnType<typeof setTimeout> | null = null;
  // P5 O16 M3b (D9, D34): the handover's freeze (nothing more consumed from the transport), the drain's waiters, the
  // engine's exit while frozen (the successor reads it), and the detach under way
  private frozen = false;
  private readonly drainWaiters: (() => void)[] = [];
  private exitedWhileFrozen = false;
  private detaching: Promise<void> | null = null;
  private leftHandover = false; // fix wave 1: taken back from the handover by a deliberate stop; never detached
  readonly adoption: Promise<void>;
  private settleAdoption: (error: AdoptionFailed | null) => void = () => {};
  // P5 O16 M3 end

  constructor(private readonly opts: EngineSessionOptions) {
    this.spec = opts.spec;
    this.plan = opts.plan;
    this.journal = opts.journal;
    this.store = opts.store ?? new MemorySessionStateStore();
    this.hooks = opts.hooks ?? new HostHookRegistry();
    this.grants = opts.grants ?? EMPTY_GRANTS;
    this.requestedModel = opts.spec.model;
    this.requestedEffort = opts.spec.effort;
    this.reconnect = opts.reconnect ?? (opts.spec.resume !== null && !opts.spec.resume.fork);
    this.log = opts.log ?? ((message) => console.warn(`[engine-host ${opts.spec.appSessionId}] ${message}`));
    this.exited = new Promise((resolve) => (this.resolveExited = resolve));
    this.lastUsedAt = this.launchedAt; // C12
    this.observerSaved = opts.adopted?.observerSeen ?? false; // P5 O16 M3 (D53): already in the state file
    this.releaseDeferred = opts.adopted !== undefined; // P5 O16 M3
    // fix wave 1: settled once, at ready or at the failure; a launch that adopts nothing has nothing to wait for
    this.adoption = opts.adopted === undefined ? Promise.resolve() : new Promise<void>((resolve, reject) => {
      let settled = false;
      this.settleAdoption = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
    });
    this.adoption.catch(() => {}); // the launcher observes it; never an unhandled rejection here
    // P5 O2 M2: the durable crons, in the scheduled-tasks file of the spawn directory or the engine's current one
    this.durableCrons = new DurableCronSource({
      engineSessionId: opts.plan.sessionId, dirs: () => [this.plan.cwd, this.tracker.engineCwd ?? this.spec.cwd], read: opts.scheduledTasksFile, log: this.log,
      loadLineage: () => this.store.loadEngineSessionIds(this.spec.appSessionId),
      saveLineage: (ids) => this.storeWrite(this.store.saveEngineSessionIds(this.spec.appSessionId, ids), 'engine session ids'),
    });
    this.tracker = new SessionStatusTracker(opts.spec, () => this.touch(), { // P5 O2 M2: the work state's start and sources
      launchKind: opts.launchKind, durableCrons: () => this.durableCrons.read(), log: this.log,
      onCronRecord: (record) => { // P5 Decision Log 49: tracked and logged here, its outcome the tracker's to retry on
        const write = this.store.saveCronRecord(this.spec.appSessionId, record);
        this.storeWrite(write, 'cron record');
        return write;
      },
    });
    // P5 O2 M2: the Stop callback, every launch's (host-hooks.ts): its `session_crons` into the work state, answered at once
    registerStopHook(this.hooks, (input) => {
      this.tracker.stopped(input);
      if (this.reapIgnored) { // O16 M5: the engine ran a turn to its end after ignoring an idle reap: its exit is its own again
        this.reapIgnored = false;
        if (this.stopReason === 'idle') this.stopReason = null;
      }
      this.touch();
      return {};
    });
    this.surface = new SessionSurface({ log: this.log, touch: () => this.touch() }); // R2
    // E1: served from construction on, since the engine's MCP handshake begins before initialize is answered (E0a Q1)
    this.maws = new SessionMaws({
      appSessionId: opts.spec.appSessionId, appVersion: opts.appVersion, appAttached: opts.appAttached, rendersAnswered: opts.rendersAnswered /* P5 O5 M4 */, artifactScope: opts.artifactScope /* P2-E1 */, artifacts: opts.artifacts /* P3-A */, datasetRefresh: opts.datasetRefresh /* E3 */,
      emit: (name, payload) => this.emit(name, payload),
      respond: (requestId, response, writeOpts) => this.respond(requestId, response, writeOpts),
      cwd: () => this.tracker.engineCwd ?? this.spec.cwd,
      sessionId: () => this.normalizer.state.sessionId,
      fromSubagent: (toolUseId) => this.normalizer.fromSubagent(toolUseId), // P2-C3: the call's frame was journaled first
      publishAttention: () => this.emit('brokerItems', this.brokerItems()),
      steer: (content, steerOpts) => this.queue.steer(content, steerOpts),
      meta: (frame) => void this.record('meta', frame),
      journalFailed: (error) => error instanceof JournalWriteFailed,
      markUsed: () => this.markUsed(),
      touch: () => this.touch(),
      log: this.log,
    });
    this.normalizer = new Normalizer({ appSessionId: opts.spec.appSessionId, launchId: opts.plan.launchId, sessionId: opts.plan.sessionId, warn: (w) => this.pendingWarnings.push(w) });
    // P2-A (X17): its base (what earlier launches observed) loads now, before this launch's first write
    this.observed = opts.observedFacts?.recorder({ appSessionId: opts.spec.appSessionId, launchId: opts.plan.launchId, engineSessionId: () => this.normalizer.state.sessionId ?? this.plan.sessionId }) ?? null;
    this.broker = new PermissionBroker({
      appSessionId: opts.spec.appSessionId,
      client: { respond: (requestId, response, opts) => (this.client ? this.client.respond(requestId, response, opts) : Promise.reject(new Error('no engine process'))) },
      meta: (frame) => this.record('meta', frame),
      onAttention: (items) => {
        this.emit('brokerItems', [...items, ...this.maws.attention()]); // E1 M4b: with the blocking asks'
        this.touch();
      },
      onGrant: (updates) => {
        const next = recordFromResponse(this.grants, updates);
        if (next === this.grants) return;
        this.grants = next;
        this.storeWrite(this.store.saveGrants(this.spec.appSessionId, next), 'grants');
        this.opts.onGrants?.(next);
        this.touch();
      },
      sessionId: () => this.normalizer.state.sessionId,
      isExiting: () => this.processState === 'exiting' || this.processState === 'exited',
    });
    this.ladder = new TerminationLadder({
      exited: this.exited,
      hasExited: () => this.processState === 'exited',
      markExiting: () => this.setProcess('exiting'),
      endSession: () => {
        if (!this.handshakeDone || !this.client) return false;
        this.surface.detach(this.client); // R2: off the roster first, on the same pipe
        // C12: `budget` is MAWS's own reason and never goes to the engine; a release ends the process as a stop does
        endSession(this.client, { reason: this.stopReason === 'budget' || this.stopReason === 'idle' /* E10 */ || this.stopReason === null ? 'stop' : this.stopReason }).catch(() => {}); // the exit is the answer that matters
        return true;
      },
      stopResult: () => this.stopResult(),
    });
    this.clearAndImplement = new ClearAndImplementSequence({
      client: () => this.client,
      isReady: () => this.processState === 'ready',
      prePlanMode: () => this.tracker.prePlanMode,
      write: (frame) => {
        const writer = this.writer;
        if (!writer) throw new Error('no engine process');
        return writer.write(frame);
      },
      notice: (key, text) => this.notice(key, text),
      touch: () => this.touch(),
      released: () => {
        void this.queue.onSequenceEnded().catch((error: unknown) => this.log(`queue release after sequence failed: ${messageOf(error)}`));
      },
      log: this.log,
    });
    const writeFrame = (frame: Parameters<OutboundWriter['write']>[0], writeOpts?: WriteOptions) => (this.writer ? this.writer.write(frame, writeOpts) : Promise.reject(new Error('no engine process')));
    this.queue = new MessageQueue({
      appSessionId: opts.spec.appSessionId,
      store: this.store,
      write: writeFrame,
      prepare: (content) => this.maws.withLinkedReads(content), // P4-A3: a submission goes with the reads of the artifacts it links
      meta: (frame) => this.record('meta', frame),
      // a host sequence that writes its own prompts (clear and implement) holds the queue like an open turn, and so does a
      // prompt written but not yet started (a `now` steer preempts the running turn and runs next: M6 live 3.7)
      turnOpen: () => this.processState !== 'exited' && (this.normalizer.state.currentTurn !== null || this.normalizer.state.unstartedPrompts.size > 0 || this.clearAndImplement.holding),
      canWrite: () => this.processState === 'ready',
      cancel: async (messageUuid) => (await cancelAsyncMessage(this.readyClient(), { message_uuid: messageUuid })).cancelled === true, // W1
      unsettled: opts.unsettledPrompts, // P2-C
      onPauseChange: (paused) => this.clearAndImplement.setPaused(paused),
      onChange: (queue) => {
        this.emit('queue', queue);
        this.touch();
      },
      log: this.log,
    });
    this.bashMode = new BashMode({
      cwd: () => this.tracker.engineCwd ?? this.spec.cwd,
      write: writeFrame,
      notice: (key, text) => this.notice(key, text),
      canWrite: () => this.processState === 'ready',
      log: this.log,
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Public surface

  on<K extends keyof Listeners>(name: K, listener: Listeners[K]): () => void {
    this.listeners[name].add(listener);
    return () => this.listeners[name].delete(listener);
  }

  // Spawn → initialize → get_status (gateway verification) → grant re-application on a resume → queue recovery →
  // ready. Idempotent; never rejects: a failure is journaled (`init_failed`) and ends the process through the ladder.
  start(): Promise<void> {
    this.starting ??= this.run().catch((error: unknown) => this.log(`start failed: ${messageOf(error)}`));
    return this.starting;
  }

  // Every send is a queue entry: submitted now when the session is not busy, queued otherwise (M4).
  async send(content: SendContent): Promise<SendResult> {
    if (this.processState !== 'ready') throw new Error(`session ${this.spec.appSessionId} is not ready (${this.processState})`);
    this.markUsed(); // C12
    const { entry, disposition } = await this.queue.send(content);
    return { messageUuid: entry.messageUuid, disposition, queueId: entry.queueId, entry };
  }

  // C12: a steer is use, and the prompt it writes is busy until the engine starts it
  async steer(content: SendContent, opts: { priority?: SteerPriority } = {}): Promise<{ messageUuid: MessageUuid }> {
    this.markUsed();
    try {
      return await this.queue.steer(content, opts);
    } finally {
      this.touch();
    }
  }

  // Pauses the app queue first ("queue paused because you interrupted"), so the turn.ended the interrupt causes
  // releases nothing, then interrupts the engine; `cancelEngineQueued` maps to the engine queue's `cancel_queued`.
  // W1: `holdEngineQueued` is the plain stop's: between the pause and the interrupt, every waiting `next` steer is held
  // in the app queue (MessageQueue.holdAll), so nothing runs after the stop; without it (Esc, Send now) the engine
  // starts a waiting steer as its own turn once the running one ends.
  async interrupt(opts: { cancelEngineQueued: boolean; holdEngineQueued?: boolean }): Promise<{ stillQueued: string[]; cancelled: string[] }> {
    const client = this.readyClient();
    this.markUsed(); // C12
    // P5 O16 M2 (D12): under a session host the interrupt is owed from before its write until its answer (or a failed
    // write), so an adopter after a crash in between sends it first. The mark is on disk before anything moves, or the
    // command fails with nothing written (fail closed). The newest interrupt owns it: a request left unanswered keeps it
    // until that request's own late answer, and an older request's answer never clears a newer one's.
    const owed = this.transport?.holder !== undefined;
    const generation = ++this.owedInterrupt.generation;
    if (owed) {
      this.owedInterrupt.lateRequestId = null;
      await this.store.saveOwedInterrupt(this.spec.appSessionId, true);
    }
    const settleOwed = () => {
      if (owed && generation === this.owedInterrupt.generation) this.storeWrite(this.store.saveOwedInterrupt(this.spec.appSessionId, false), 'owed interrupt');
    };
    let response: InterruptResponse;
    try {
      await this.queue.pause('interrupt');
      if (opts.holdEngineQueued) await this.queue.holdAll();
      response = await interrupt(client, { reason: 'user-cancel', cancel_queued: opts.cancelEngineQueued });
    } catch (error) {
      if (!(error instanceof ControlTimeout)) settleOwed();
      else if (owed && generation === this.owedInterrupt.generation) this.owedInterrupt.lateRequestId = error.requestId;
      throw error;
    }
    settleOwed();
    return { stillQueued: [...response.still_queued], cancelled: [...(response.cancelled ?? [])] };
  }

  // `!`: answered at the `bash_command` write; the echo and its receipt follow as events.
  // C12: a `!` command is use, and busy until its output is replayed or the process exits
  async bash(command: string): Promise<{ commandUuid: MessageUuid }> {
    this.markUsed();
    try {
      return await this.bashMode.run(command);
    } finally {
      this.touch();
    }
  }

  async answer(requestId: RequestId, answer: RequestAnswer): Promise<'delivered' | 'not_pending' | 'write_failed'> {
    this.markUsed(); // C12
    const item = this.broker.item(requestId);
    if (answer.kind !== 'plan' || answer.outcome !== 'clear_and_implement' || item?.kind !== 'plan' || item.attention.state !== 'pending') return this.broker.answer(requestId, answer);
    return this.clearAndImplement.stage((item.request.request.input as { plan?: unknown } | undefined)?.plan, () => this.broker.answer(requestId, answer));
  }

  // R2: the renderer's answer to one of the engine's requests to the surface (`session.ui.answer`).
  answerSurface(requestId: RequestId, answer: SurfaceAnswer): Promise<'delivered' | 'not_pending'> {
    return this.surface.answer(requestId, answer, this.respond);
  }

  private readonly respond = (requestId: RequestId, response: unknown, opts?: WriteOptions): Promise<void> => (this.client ? this.client.respond(requestId, response, opts) : Promise.reject(new Error('no engine process')));

  // E1, E2, E4c: the `maws` commands' answers and reads (session-maws.ts says what each does)
  answerPane(requestId: RequestId, result: MawsPaneAnswerResult): 'delivered' | 'not_pending' {
    return this.maws.answerPane(requestId, result);
  }

  answerCapture(requestId: RequestId, result: MawsArtifactCapturedResult): 'delivered' | 'not_pending' {
    return this.maws.answerCapture(requestId, result);
  }

  answerExport(requestId: RequestId, answer: MawsArtifactExportAnswer): 'delivered' | 'not_pending' {
    return this.maws.answerExport(requestId, answer); // P3-A M7
  }

  // E13: an agent's finished download through cua, as a File artifact once per path (P3-L M6b)
  recordDownload(download: MawsDownloadRecorded): Promise<'recorded' | 'duplicate'> {
    return this.maws.recordDownload(download);
  }

  asks(): PendingAsk[] {
    return this.maws.asks();
  }

  answerAsk(askId: string, answers: AskAnswer[]): Promise<'delivered' | 'not_pending' | 'write_failed'> {
    return this.maws.answerAsk(askId, answers);
  }

  // E3 start: a side question (`session.sideQuestion`), sent through the caller's operation table with the log's
  // history and entered in the log under the operation id its request was written under; the table's completion
  // settles it (ipc.ts). E11: a retry names the failed entry it replaces.
  async sideQuestion(question: string, start: (request: SideQuestionRequest) => Promise<{ opId: string }>, retryOf?: string): Promise<{ opId: string }> {
    const ask = this.sideQuestions.ask(question, new Date().toISOString(), retryOf);
    const receipt = await start(ask.history === undefined ? { question } : { question, history: ask.history });
    ask.bind(receipt.opId);
    return receipt;
  }
  // E3 end

  // Ends the process through the termination ladder; `graceMs` (the end_session wait) is capped at 3 s. Before the
  // process is spawned there is nothing to ladder: the reason is recorded, `run()` sees it and ends the session with no
  // process (a stop before `start()` ends it at once), and the answer is that exit (whole-branch review).
  // C12: the stop precedence. A release (`budget`, the process table's act, with the budget and sum it was made at)
  // never replaces a recorded reason; an explicit stop, archive or quit replaces a recorded release, so an archive or
  // quit during a release's ladder exits as itself; explicit reasons keep the first among themselves. The one ladder
  // already running keeps its end_session.
  // E10: `idle`, the supervisor's idle-row release, is a release like the budget's (MAWS's own reason, `stop` on the
  // wire, never replacing a recorded reason, replaced by an explicit one) with no budget detail.
  stop(reason?: 'stop' | 'archive' | 'quit' | 'idle', opts?: { graceMs?: number }): Promise<StopResult>;
  stop(reason: 'budget', opts: { graceMs?: number; release: BudgetRelease }): Promise<StopResult>;
  stop(reason: 'stop' | 'archive' | 'quit' | 'budget' | 'idle' = 'stop', opts: { graceMs?: number; release?: BudgetRelease } = {}): Promise<StopResult> {
    if (this.processState === 'exited') return this.exited.then(() => this.stopResult()); // its store writes settled too
    // P5 O16 M3b fix wave 1: a deliberate stop (a user's, an archive, a stop-all or quit) of a row frozen for the handover
    // takes it back from the handover and runs the ladder, so its engine ends as asked; a release (idle, budget) waits
    // for the successor. A row already detached is the successor's: nothing here can reach its process.
    if (this.frozen) {
      if (reason === 'idle' || reason === 'budget' || !this.thaw(`stop (${reason})`)) {
        this.log(`stop (${reason}) asked during the handover: left to the successor`);
        return Promise.resolve(this.stopResult());
      }
    }
    if (reason === 'budget' || reason === 'idle') {
      if (this.stopReason === null) {
        this.stopReason = reason;
        this.release = reason === 'budget' ? (opts.release ?? null) : null;
      }
    } else if (this.stopReason === null || this.stopReason === 'budget' || this.stopReason === 'idle') {
      this.stopReason = reason;
      this.release = null;
    }
    if (!this.transport) {
      if (this.starting === null) this.handleExit({ code: null, signal: null });
      return this.exited.then(() => this.stopResult());
    }
    return this.terminate(true, Math.min(opts.graceMs ?? LADDER_MS.endSession, LADDER_MS.endSession));
  }

  // O16 M5 start (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §F; D15): the reap's signal, once
  // the reap (holder/reap.ts) found the session verified empty and its fence armed or no observer ever seen. `idle` is a
  // path of its own, never the ladder (memoised, it marks the process exiting and closes stdin before SIGTERM, which an
  // engine that ignored the signal could not survive): end_session with the ladder's grace, then one SIGTERM, then
  // REAP_TERM_MS for the exit; stdin is never closed, no SIGKILL follows, the process state is left alone. An exit within
  // it is an `idle` release through the exit path; past it the session goes on (`ignored`) with its work unknown
  // (`reap_term_ignored`) and its stop reason `idle`, so a later exit is still the release, until the next Stop clears
  // both. An explicit stop meanwhile takes over through the ladder. `budget` runs `stop('budget')`'s ladder (charter §4.4).
  async reap(reason: 'idle' | 'budget', release?: BudgetRelease): Promise<'exited' | 'ignored'> {
    if (reason === 'budget') {
      await this.stop('budget', { release: release ?? { limitKiB: 0, totalKiB: 0 } });
      return this.processState === 'exited' ? 'exited' : 'ignored';
    }
    const transport = this.transport;
    const client = this.client;
    if (this.processState === 'exited') return 'exited';
    if (transport === null || client === null || this.processState !== 'ready') return 'ignored';
    if (this.stopReason === null) this.stopReason = 'idle';
    const taken = async (): Promise<'exited' | null> => {
      if (this.processState === 'exiting') await this.exited; // an explicit stop took over through the ladder
      return this.processState === 'exited' ? 'exited' : null;
    };
    this.reaping = true;
    try {
      this.reapRow('end_session');
      endSession(client, { reason: 'stop' }).catch(() => {}); // the exit is the answer that matters
      if (await this.exitWithin(LADDER_MS.endSession) || await taken()) return 'exited';
      this.reapRow('term');
      transport.kill('SIGTERM');
      if (await this.exitWithin(REAP_TERM_MS) || await taken()) return 'exited';
      this.reapRow('term_ignored');
      this.reapIgnored = true;
      this.tracker.termIgnored();
      this.touch();
      return 'ignored';
    } finally {
      this.reaping = false;
    }
  }

  private reapRow(phase: 'end_session' | 'term' | 'term_ignored'): void {
    try {
      this.record('meta', { event: 'reap', phase });
    } catch (error) {
      this.log(`reap ${phase} not journaled: ${messageOf(error)}`);
    }
  }

  private exitWithin(ms: number): Promise<boolean> {
    if (this.processState === 'exited') return Promise.resolve(true);
    return Promise.race([
      this.exited.then(() => true),
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  }

  // The reap's state and the gate's observer, which the status carries; an observer seen and then silent or gone is
  // unknown work (`observer_unhealthy`). The table's first, at the reservation, is not told (`touch` false): the launch's
  // answer goes out before its first status.
  noteReap(view: ReapView, touch = true): void {
    this.reapView = { ...view };
    this.tracker.observer(view.observer === 'unhealthy');
    if (touch) this.touch();
  }

  // The work under the engine as the table's last tree read counted it.
  noteDescendants(read: number | 'unreadable'): void {
    this.descendants = read === 'unreadable' ? null : read;
    this.tracker.descendantsRead(read !== 'unreadable');
    this.touch();
  }

  // Every engine session id the process has carried (the gate keys an observer's hello against them).
  engineSessionIds(): ReadonlySet<string> {
    return this.durableCrons.ids();
  }

  // The launch's stdio MCP servers as their processes' argv (holder/descendants.ts `expectedArgv`: `[command, ...args]`, or
  // a `#!` script's interpreter line before it), the registration the descendant veto reads; null until read.
  mcpCommands(): string[][] | null {
    return this.mcpServerCommands;
  }

  // Reads them from `mcp_status` (M0's question 4: `get_settings` carries none), once for the launch; asked when the
  // tree first shows a child of the engine, a failure asked again at the next such read.
  readMcpCommands(): Promise<void> {
    const client = this.client;
    if (this.mcpServerCommands !== null || client === null || this.processState !== 'ready') return Promise.resolve();
    this.mcpRead ??= mcpStatus(client, {}).then(
      (answer) => {
        this.mcpServerCommands = answer.mcpServers.flatMap((server) => {
          const config = (server as { config?: { type?: unknown; command?: unknown; args?: unknown } }).config;
          if (config?.type !== 'stdio' || typeof config.command !== 'string') return [];
          // P5 O16 M3a fix wave 1: a rebuilt environment's PATH is not the engine's, so a bare command resolved through
          // it could match the wrong process; it is left unmatched instead, and its process counts as work
          if (this.plan.environmentRebuilt === true && !config.command.includes('/')) return [];
          const argv = [config.command, ...(Array.isArray(config.args) ? config.args.filter((a): a is string => typeof a === 'string') : [])];
          return [expectedArgv(argv, { path: this.plan.env.PATH, cwd: this.plan.cwd })]; // D52: as the kernel runs it, through the launch's PATH
        });
      },
      (error: unknown) => this.log(`mcp_status for the descendant veto failed: ${messageOf(error)}`),
    ).finally(() => {
      this.mcpRead = null;
    });
    return this.mcpRead;
  }

  // The gate saw this process's observer bridge: kept in the state file, once per launch, so an adopter restores it (D37).
  observerSeen(): void {
    if (this.observerSaved) return;
    this.observerSaved = true;
    this.storeWrite(this.store.saveObserverSeen(this.spec.appSessionId, this.plan.launchId), 'observer seen');
  }

  // P5 O16 M3 (D37, D53): an adopted process whose observer the state file says was seen: the gate starts it unhealthy
  get observerSeenBefore(): boolean {
    return this.opts.adopted?.observerSeen === true;
  }
  // O16 M5 end

  // True once the termination ladder had to send SIGKILL (engine.shutdown's `forced` count).
  get forcedKill(): boolean {
    return this.ladder.killed;
  }

  // The process's state alone (`status().process`, without building the whole status).
  get lifecycle(): ProcessState {
    return this.processState;
  }

  // C12: the host has work in flight (the status's `busy`): the queue's own predicate, a `!` command not yet answered,
  // or a held clear-and-implement. An exited process holds nothing.
  get busy(): boolean {
    return this.processState !== 'exited' && (this.queue.busy || this.bashMode.hasPending || this.clearAndImplement.holding);
  }

  // C12 start: the human used the session (the X2 handlers call it for a mode, model, effort or thinking change and a
  // `#` note; send, steer, interrupt, `!` and answers mark it here), which orders the budget's releases; and the budget
  // policy's stateful servers changed, which may change keepAlive
  markUsed(): void {
    this.lastUsedAt = new Date().toISOString();
    this.touch();
  }

  policyChanged(): void {
    this.touch();
  }
  // C12 end

  // What the human asked for through X2 once the engine accepted (or, for a mode, refused) it (M5): the status reports
  // it as requested; the resolved model and the effective mode still come from the frames.
  noteRequested(patch: { permissionMode?: { mode: PermissionMode; refusal: AutoModeRefusalCode | null; effective: string | null }; model?: string | null; effort?: Effort | null }): void {
    if (patch.permissionMode) this.tracker.requestMode(patch.permissionMode.mode, patch.permissionMode.refusal, patch.permissionMode.effective);
    if (patch.model !== undefined) this.requestedModel = patch.model;
    if (patch.effort !== undefined) this.requestedEffort = patch.effort;
    this.touch();
  }

  // set_cwd can succeed without another system/init (pass2/trust-no-attestation).
  noteCwd(cwd: string): void {
    this.tracker.engineCwd = cwd;
    this.touch();
  }

  // E8 (D-13): a successful reload_plugins answer, published as the status and the catalogue an init frame would publish.
  noteReload(answer: ReloadPluginsResponse): void {
    this.tracker.applyReload(answer);
    this.publishCatalog();
    this.touch();
  }

  // The process's control client (null before spawn), for the per-subtype calls later milestones build on (M4's
  // rewind, M5's reads); every request it writes goes through the session's journal and inbound gate.
  get control(): ControlClient | null {
    return this.client;
  }

  // The engine process's pid, for the process table's memory sampler.
  get pid(): number | null {
    return this.transport?.pid ?? null;
  }

  recordMemory(sample: EngineSessionStatus['memory']): void {
    if (this.processState === 'exited') return;
    this.tracker.recordMemory(sample);
    this.touch();
  }

  // E11: whether the broker retired this request id (its tombstone), so the stream keeps no event for its re-delivery.
  requestRetired(requestId: string): boolean {
    return this.broker.retiredReason(requestId as RequestId) !== null;
  }

  // P2-A (X17): what `engine.observedFacts` answers while this row is in the table, live or exited: the facts earlier
  // launches observed merged with this launch's. Null without a recorder.
  observedFacts(): Promise<ObservedFactsAnswer | null> {
    return this.observed ? this.observed.answer() : Promise.resolve(null);
  }

  // The session's attention list: the broker's items, then the blocking asks' (E1 M4b).
  brokerItems(): AttentionItem[] {
    return [...this.broker.snapshot(), ...this.maws.attention()];
  }

  // The command catalogue C7's `session.catalog` answers from (coordinator, C7's asks).
  catalog(): Catalog {
    return this.tracker.catalog();
  }

  // P3-HD start: the launch facts route D's observations are tied to (connectors/provenance.ts): this launch's id, its
  // spawn cwd, the environment its plan handed the engine, the flag settings MAWS passed it and the local-scope key
  // captured before it spawned. Host-only: never part of `status()`, a journal row or an IPC answer.
  // P5 O16 M3a fix wave 1 (D58): an adopted launch's environment was rebuilt, never the one the engine runs with, so it
  // attests nothing: its launch identity is unknown (null)
  connectorLaunchContext(): ConnectorLaunchContext | null {
    if (this.plan.environmentRebuilt === true) return null;
    this.launchContext ??= connectorLaunchContext({ appSessionId: this.spec.appSessionId, launchId: this.plan.launchId, cwd: this.plan.cwd, environment: this.plan.env, flagSettings: this.plan.flagSettings, localKey: this.opts.connectorLocalKey });
    return this.launchContext;
  }
  private launchContext: ConnectorLaunchContext | undefined;
  // P3-HD end

  status(): EngineSessionStatus {
    const turn = this.normalizer.state.currentTurn;
    const tracked = this.tracker.snapshot();
    const turnId = this.tracker.turnEventId;
    const env = this.plan.env;
    const engineSessionId = this.normalizer.state.sessionId ?? this.plan.sessionId;
    const status: EngineSessionStatus = {
      appSessionId: this.spec.appSessionId, engineSessionId, pid: this.transport?.pid ?? null, launchId: this.plan.launchId, launchedAt: this.launchedAt,
      taskListId: env.CLAUDE_CODE_TASK_LIST_ID ?? engineSessionId ?? null, // C8's ask: the list the engine's task tools read (SPEC 20)
      cwd: this.tracker.engineCwd ?? this.spec.cwd, pendingPlan: this.clearAndImplement.pendingPlan,
      process: this.processState, exit: this.exitInfo, engineState: tracked.engineState, activity: tracked.activity,
      // every open turn was opened by a turn.started the tracker saw, so its id is that event's
      turn: turn && turnId ? { id: turnId, origin: turn.origin, startedAt: turn.startedAt, acceptedAt: turn.acceptedAt, userMessageUuids: [...turn.userMessageUuids] } : null,
      model: { requested: this.requestedModel, resolved: tracked.resolvedModel }, effort: this.requestedEffort,
      permissionMode: tracked.permissionMode, prePlanMode: tracked.prePlanMode,
      gateway: { mode: this.plan.gateway, ...tracked.gateway },
      subagentModel: env.CLAUDE_CODE_SUBAGENT_MODEL ?? null,
      modelOverrides: Object.fromEntries(Object.entries(env).filter(([key]) => /^ANTHROPIC_DEFAULT_[A-Z0-9_]+_MODEL$/.test(key))),
      engineVersion: tracked.engineVersion ?? this.plan.engineVersion, fileCheckpointing: env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING === '1',
      bin: this.plan.bin, // W13: the spawn row's
      fastMode: tracked.fastMode, plugins: tracked.plugins, pluginErrors: tracked.pluginErrors, pluginWarnings: tracked.pluginWarnings, pluginsObservedAt: tracked.pluginsObservedAt, // P2-A
      backgroundTasks: tracked.backgroundTasks, grants: [...this.grants.allow], mcpServers: tracked.mcpServers, heldPeerMessages: tracked.heldPeerMessages,
      pendingRequests: this.broker.live + (this.client?.pending ?? 0) + this.maws.pending /* E1 */, queue: { length: this.queue.queuedCount, paused: this.queue.isPaused },
      keepAlive: [], busy: this.busy, lastUsedAt: this.lastUsedAt, // C12: keepAlive from the hard reasons below
      memory: tracked.memory,
      journalPath: this.journal.path, hostHooks: this.hooks.ids(), lastEventSeq: this.lastEventSeq,
      trust: { attested: this.spec.trust !== null, recorded: this.trustRecorded }, // C10
      work: { ...tracked.work, descendants: this.transport?.pid == null ? 0 : this.descendants }, kept: this.kept, // P5 O2 M2; O16 M5: descendants
      ...(this.surface.attached && { uiSurface: { clientId: this.surface.clientId } }), // R2
      ...(tracked.published && { published: tracked.published }), // P5 E312
      ...(this.reapView && { reap: { ...this.reapView } }), // O16 M5
      holder: this.holderStatus(), // P5 O16 M2
    };
    // C12: what an exit would lose, by the budget policy's rules (an exited process holds nothing)
    if (status.process !== 'exited') status.keepAlive = hardReasons(status, this.opts.statefulMcpServers?.() ?? NO_SERVERS);
    return status;
  }

  // P5 O16 M2 (Interfaces §D): the session host this process runs under, null on a direct or replay launch; `pid` is the
  // host's, the status's own `pid` the engine's
  private holderStatus(): EngineSessionStatus['holder'] {
    const holder = this.transport?.holder ?? (this.opts.holder ? { pid: this.opts.holder.pid, holderId: this.opts.holder.holderId } : null);
    return holder ? { pid: holder.pid, holderId: holder.holderId, adopted: this.opts.adopted !== undefined /* P5 O16 M3 */ } : null;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The one path rows take: journal, then normalise, then deliver

  private record(direction: JournalDirection, frame: unknown): JournalRow {
    if (this.journalClosed) throw new JournalClosed(`${direction} row`);
    let row: JournalRow;
    try {
      row = this.journal.row(direction, frame);
    } catch (error) {
      throw new JournalWriteFailed(error);
    }
    this.observed?.row(row); // P2-A (X17): the facts are read from the rows as journaled, as recovery reads them
    this.outstanding?.observe(row); // P5 O16 M3: the barrier's set sees every row until the replay has caught up
    this.noteMessage(row); // P5 O16 M3
    const events = this.normalizer.push(row);
    this.durableCrons.note(this.normalizer.state.sessionId); // P5 O2 M2: every id the process carries joins the lineage
    for (const w of this.pendingWarnings.splice(0)) this.record('meta', { event: w.event, rowSeq: w.seq, detail: w.detail }); // journaled and normalised like any row; they yield no events
    if (events.length > 0) {
      this.lastEventSeq = row.seq;
      this.emit('events', events);
      this.react(events);
      // W13: the engine's own output that MAWS did not understand, from a version newer than tested, says so once,
      // after what raised it (the running version is init's, else the probe's at spawn)
      const compat = direction === 'in' ? this.compat.observe(events, this.tracker.engineVersion ?? this.plan.engineVersion) : null;
      if (compat !== null) this.notice(ENGINE_COMPAT_NOTICE_KEY, compat);
    }
    return row;
  }

  private async run(): Promise<void> {
    // P5 O16 M3: an adopted process's transport is the session host's, attached and reading already; it is the
    // session's from the start, so a stop meanwhile runs the ladder against it
    const adopted = this.opts.adopted;
    if (adopted) this.transport = this.opts.spawn(this.plan);
    await this.loadState();
    // The launch's first status (`starting`) goes out before its first row (a resume's `reconnect`, the spawn row, a
    // spawn failure's exit), so a consumer folding events only under a live status never sees a launch's events
    // against no status or the previous launch's `exited` (C5's second re-check). Emitted after the state load's await,
    // where the first status went before, so the launch command's answer still goes out ahead of it.
    this.touch();
    if (adopted) return this.adopt(adopted);
    if (this.stopReason !== null || this.processState === 'exited') {
      this.handleExit({ code: null, signal: null }); // stopped while the state loaded: never spawn (idempotent)
      return;
    }
    if (this.reconnect) this.record('meta', { event: 'reconnect', phase: 'attempting', ...this.attempt, trigger: this.reconnectTrigger, reason: this.spec.retry?.reason ?? null });
    if (this.spec.retry) this.notice('launch:retry', `${this.spec.retry.reason} Trying once more (attempt ${this.spec.retry.attempt} of ${this.spec.retry.maxAttempts}).`); // C3 corrective
    this.record('meta', spawnMeta(this.plan, { appVersion: this.opts.appVersion ?? 'unknown', holder: this.opts.holder }));
    void (this.opts.sessionStartHookMs ?? sessionStartHookMs)(this.plan).then(
      (ms) => {
        this.hookBoundMs = ms;
        if (this.hooksBeforeAnswer !== null && this.hooksBeforeAnswer.size > 0) this.extendInitialize(); // read after a hook started
      },
      (error: unknown) => this.log(`could not read the SessionStart hooks' timeouts: ${messageOf(error)}`),
    );
    if (this.opts.relayHealth) this.record('meta', { event: 'relay_health', ...this.opts.relayHealth });
    let transport: EngineTransport;
    try {
      transport = this.opts.spawn(this.plan);
    } catch (error) {
      this.record('meta', { event: 'transport_error', message: messageOf(error), code: 'spawn_error' });
      this.handleExit({ code: null, signal: null });
      return;
    }
    this.transport = transport;
    const client = this.connect(transport);
    this.silence = setTimeout(() => {
      this.silence = null;
      try {
        this.initializeFailed(new ControlError('initialize', `${this.plan.launchId}-1` as RequestId, `the engine wrote nothing in the ${FIRST_OUTPUT_MS / 1000} s after it started; initialize was not answered`, 'no_output'));
      } catch (error) {
        // a timer has no caller to take the throw: the journal refused the init_failed row, and the ladder still runs
        this.log(`init_failed not journaled: ${messageOf(error)}; ending the process`);
        void this.terminate(false);
      }
    }, FIRST_OUTPUT_MS);
    await this.handshake(client);
  }

  // The process's writer, control client and read loops, and the exit they end in; `initializing` from here.
  // P5 O16 M3 (D26): an adopted writer's `fence`, which names its requests apart from the old manager's.
  private connect(transport: EngineTransport, fence?: number): ControlClient {
    if (transport.holder !== undefined) this.hostMap = new HostMap(); // P5 O16 M2
    // One writer for every out frame of this process (requests, answers, user frames); the read loop holds inbound
    // frames while any of its writes is in flight and journals them after the write's own row.
    const writer = new OutboundWriter(transport, { row: (direction, frame) => this.record(direction, frame) });
    this.writer = writer;
    writer.onIdle(() => {
      this.drainHeld();
      this.touch(); // outstanding controls protect liveness even when their out rows produce no graph event
    });
    writer.onJournalFailure((error) => {
      // the journal no longer records what was sent: end the process as for a transport error
      this.log(`journal write failed: ${error.message}; ending the process`);
      void this.terminate(false);
    });
    const client = new ControlClient(transport, { row: (direction, frame) => this.record(direction, frame) }, this.plan.launchId, { warn: this.log, writer, fence });
    this.client = client;
    client.onInbound((req) => this.inbound(req));
    client.onInboundCancel((requestId) => {
      this.maws.cancel(requestId); // E1: the engine withdrew a tool call
      // fix wave 1: a request the handshake's gate holds, withdrawn before it was dispatched, is never dispatched
      if (this.handshakeHeld !== null) this.handshakeHeld = this.handshakeHeld.filter((req) => req.request_id !== requestId);
    });
    // Host-issued reads and the startup display preference showed no error to anyone; only a human's late mutation
    // gets a notice that it may have applied after the reported failure.
    client.onLateResponse((late) => {
      if (requestClassOf(late.subtype) === 'read' || late.requestId === this.thinkingDisplayRequestId) return;
      this.record('meta', { event: 'notice', level: 'warning', key: `late_response:${late.subtype}:${late.requestId}`, text: `${late.subtype} answered after its deadline; it may have applied after the error you saw.` });
    });
    const reading = this.readLoop(transport);
    const draining = this.stderrLoop(transport);
    void Promise.all([reading, draining])
      .then(() => transport.exited)
      .then((exit) => this.handleExit(exit))
      .catch((error: unknown) => this.log(`exit not handled: ${messageOf(error)}`));
    if (this.processState === 'starting') this.setProcess('initializing'); // a stop during an adoption's fold is exiting already
    this.touch();
    return client;
  }

  // initialize → get_status (gateway verification) → grant re-application on a resume → queue recovery → ready.
  // P5 O16 M3: an adopted process's is a resume's handshake on a live process: the app's hooks again (the engine retired
  // the old callbacks, D48), no auto fallback, no grant re-application (the engine kept them) and no queue recovery
  // (the queue was adopted); then the turn ends the replay saw release the queue as they would have.
  private async handshake(client: ControlClient): Promise<void> {
    const adopted = this.opts.adopted !== undefined;
    const request = appInitialize(this.spec.trust ?? undefined);
    const hooks = this.hooks.forInitialize();
    if (hooks) request.hooks = hooks;
    let init;
    try {
      const reinitializeMs = this.opts.reinitializeMs ?? ADOPTED_REINITIALIZE_MS;
      init = await initialize(client, request, {
        // fix wave 2: an adopted re-initialize is known from its issue, before its write is queued: its answer can be
        // read and drained before the write resolves (D49's registration), and its non-destructive wait covers the
        // whole pending exchange, the write's backpressure included (D58)
        onIssued: (requestId) => {
          if (!adopted) return;
          this.initializeId = requestId;
          this.broker.awaitRedelivery(requestId); // D49: what its answer lists the engine still holds
          this.awaitReinitialize(client, requestId, reinitializeMs);
        },
        onWritten: (requestId) => {
          this.initializeId = requestId;
          this.extendInitialize(); // hook frames read while the write was in flight
        },
        ...(adopted && { timeoutMs: 2 * reinitializeMs }), // renewed by awaitReinitialize before it can expire
      });
    } catch (error) {
      this.initializeFailed(error);
      return;
    } finally {
      if (this.reinitializeWait !== null) clearTimeout(this.reinitializeWait);
      this.reinitializeWait = null;
    }
    if (this.processState !== 'initializing' || this.frozen) return; // fix wave 1: a freeze ends the handshake here
    this.handshakeDone = true;
    this.record('meta', { event: 'initialize', current_permission_mode: init.current_permission_mode, session_state: init.session_state ?? null, hooks_applied: init.hooks_applied ?? null, workspace_trust_recorded: init.workspace_trust_recorded ?? null });
    if (this.reconnect) this.record('meta', { event: 'reconnect', phase: 'reconnected', ...this.attempt, trigger: this.reconnectTrigger, reason: null });
    this.tracker.initialize(init);
    this.publishCatalog(); // C7
    // C10 start: trust into the status; the model list to the catalogue cache
    this.trustRecorded = init.workspace_trust_recorded ?? null;
    if (Array.isArray(init.models)) this.emit('models', init.models);
    // C10 end
    await this.surface.attach(client, init.capabilities); // R2: as the desktop surface, when the engine speaks ui_surface_v1
    if (this.frozen) return; // P5 O16 M3b fix wave 1

    // Visibility only: null preserves the engine's thinking budget (2.1.309 probe). Queue it before the gateway read,
    // but never hold readiness or a prompt for its acknowledgement.
    void setMaxThinkingTokens(client, { max_thinking_tokens: null, thinking_display: 'summarized' }, {
      onWritten: (requestId) => { this.thinkingDisplayRequestId = requestId; },
    }).catch((error: unknown) => this.log(`Reasoning summaries could not be enabled: ${messageOf(error)}`));
    await this.verifyGateway();
    if (this.frozen) return; // P5 O16 M3b fix wave 1: frozen meanwhile (a second handover): the successor's handshake
    if (!adopted) await this.fallBackFromAuto(client, init); // W3
    if (!adopted && (this.spec.resume !== null || this.inheritedGrants /* C10 */) && this.grants.allow.length > 0 && this.processState === 'initializing') {
      try {
        await reapply(client, this.grants);
      } catch (error) {
        this.notice('grants:reapply_failed', `Session grants could not be re-applied after the resume: ${messageOf(error)}`);
      }
    }
    if (this.processState !== 'initializing' || this.frozen) return; // fix wave 1: a freeze ends the handshake here
    if (!adopted) {
      try {
        await this.queue.recover();
      } catch (error) {
        // a queue that cannot be loaded or saved is an initialization failure, never a live process stuck initializing (M4 review)
        this.initializeFailed(new Error(`the session's queue could not be recovered: ${messageOf(error)}`));
        return;
      }
      if (this.processState !== 'initializing' || this.frozen) return; // fix wave 1: a freeze ends the handshake here
    }
    if (this.frozen) return; // P5 O16 M3b fix wave 1: never ready, nothing held dispatched, once frozen
    this.setProcess('ready');
    void this.sampleContext(); // `ctx` from the start, a resume's whole context included, not only after the first turn
    if (adopted) {
      // fix wave 1: the gate opens; what it held is dispatched in order, as if it had arrived now
      const held = this.handshakeHeld ?? [];
      this.handshakeHeld = null;
      for (const req of held) this.inbound(req);
      this.settleAdoption(null);
      await this.releaseAfterAdoption();
    }
  }

  // fix wave 2 (D42): a `notifications/cancelled` naming the JSON-RPC id of a `tools/call` the same server was sent, held
  // by the handshake's gate: the engine's MCP client dropped it, so it is never dispatched (an ask never raised, an
  // effectful call never run), as the fold's outstanding set drops one.
  private withdrawHeldCall(req: ControlRequestFrame): void {
    if (this.handshakeHeld === null || req.request.subtype !== 'mcp_message') return;
    const rpcId = cancelledCallOf(readMcpMessage(req.request));
    if (rpcId === null) return;
    const server = (req.request as { server_name?: unknown }).server_name;
    this.handshakeHeld = this.handshakeHeld.filter((held) => {
      const sent = held.request as { subtype: string; server_name?: unknown; message?: { id?: unknown; method?: unknown } };
      return !(sent.subtype === 'mcp_message' && sent.server_name === server && sent.message?.method === 'tools/call' && sent.message.id === rpcId);
    });
  }

  // fix wave 1 (D58): the adopted re-initialize's wait. At each `ms` with the request still unanswered and the process
  // alive, the wait is logged and its deadline renewed: a slow engine is never a failed one.
  private awaitReinitialize(client: ControlClient, requestId: RequestId, ms: number): void {
    const started = Date.now();
    let told = false;
    const renew = () => {
      this.reinitializeWait = setTimeout(() => {
        this.reinitializeWait = null;
        if (this.handshakeDone || this.processState !== 'initializing') return;
        this.log(`re-initialize after the handover unanswered after ${Math.round((Date.now() - started) / 1000)} s; the engine is alive, still waiting`);
        if (!told) this.notice('holder:reinitialize-slow', REINITIALIZE_SLOW); // P5 O16 M3b: once
        told = true;
        client.extendDeadline(requestId, 2 * ms, 'the last renewal of the adopted re-initialize');
        renew();
      }, ms);
      this.reinitializeWait.unref?.();
    };
    renew();
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // P5 O16 M3b: the handover (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D9, D34, D41)

  // A process under a session host, which a handover detaches; the direct and replay transports have none.
  get hosted(): boolean {
    return this.transport?.holder !== undefined;
  }

  // The `maws` calls the drain waits for: every tool's but `ask`, each until its answer's write settled.
  inFlightThroughDelivery(): number {
    return this.maws.inFlightThroughDelivery();
  }

  // The freeze, one synchronous step: nothing more is consumed from the transport (no record read from here is journaled,
  // acknowledged or dispatched; the host keeps it in its ring and the successor replays it live), what was read and not
  // yet processed is dropped, the first-output and re-initialize clocks stop, and the writer writes nothing but answers
  // (a call's result, a hook's or a human's answer already on its way), so the engine's requests in flight still settle.
  freeze(): void {
    if (this.frozen || this.leftHandover || this.processState === 'exited') return;
    this.frozen = true;
    this.held.length = 0;
    // fix wave 1: the adopted handshake's gate is dropped with it: a held request was journaled, so the successor's fold
    // finds it outstanding and disposes of it by its table; nothing here dispatches it
    if (this.handshakeHeld !== null) this.handshakeHeld = [];
    this.heard();
    if (this.reinitializeWait !== null) clearTimeout(this.reinitializeWait);
    this.reinitializeWait = null;
    this.writer?.restrict((frame) => frame.type === 'control_response', 'the engine host is handing the session over');
    void this.transport?.exited.then(() => {
      this.exitedWhileFrozen = true;
      this.checkDrained();
    });
    this.log(`frozen for the handover, ${this.inFlightThroughDelivery()} calls in flight`);
  }

  // Resolves at the first moment the frozen row holds no call in flight (checked at each retirement), or once its engine
  // has exited (nothing more can be answered).
  drained(): Promise<void> {
    if (this.isDrained()) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  private isDrained(): boolean {
    return this.exitedWhileFrozen || this.inFlightThroughDelivery() === 0;
  }

  private checkDrained(): void {
    if (this.frozen && this.isDrained()) for (const resolve of this.drainWaiters.splice(0)) resolve();
  }

  // Fix wave 1: a row frozen and not yet detached, taken back from the handover for a deliberate stop. It leaves the drain
  // (its waiters resolve: it holds nothing for the successor), the writer writes again, what the engine said while it
  // was frozen is not read back (the row is ending), and an exit it already made is handled now. False when it cannot
  // be taken back: not frozen, or its detach has begun.
  private thaw(why: string): boolean {
    if (!this.frozen || this.detaching !== null) return false;
    this.frozen = false;
    this.leftHandover = true;
    this.writer?.restrict(null);
    this.log(`taken back from the handover: ${why}`);
    for (const resolve of this.drainWaiters.splice(0)) resolve();
    const transport = this.transport;
    if (this.exitedWhileFrozen && transport) void transport.exited.then((exit) => this.handleExit(exit));
    return true;
  }

  // Fix wave 1: whether the row left the handover for a stop (the drain does not detach it; the exit order stops it).
  get takenBack(): boolean {
    return this.leftHandover;
  }

  // Fix wave 1: a stop or release whose ladder is under way: a handover freezes nothing that is ending. Fix wave 2: the
  // termination itself, not the reason it keeps: an idle reap both of whose signals were ignored keeps `idle` for a later
  // exit while its engine runs on, ready, so it is frozen and detached like any other row.
  get ending(): boolean {
    return this.processState === 'exiting' || this.reaping;
  }

  // The row let go for the successor: the writer's in-flight writes awaited (bounded by EOF_WRITE_WAIT_MS), the
  // `host_detach` row, the journal and the map closed, then the final ack and the connection ended without `release`, so
  // the session host and its engine run on. A row frozen before its adoption connected writes no row (the journal is
  // still the old manager's). The process has not exited: no exit row, no `exited`.
  detach(reason: 'handover' | 'exit'): Promise<void> {
    if (this.leftHandover) return Promise.resolve(); // fix wave 1: taken back for a stop; the exit order stops it
    this.freeze();
    if (!this.frozen) return Promise.resolve(); // exited already
    this.detaching ??= this.detachNow(reason);
    return this.detaching;
  }

  private async detachNow(reason: 'handover' | 'exit'): Promise<void> {
    const writer = this.writer;
    if (writer?.busy) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settled = await Promise.race([writer.whenIdle().then(() => true), new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), EOF_WRITE_WAIT_MS)))]);
      clearTimeout(timer);
      if (!settled) {
        this.log(`a write did not settle within ${EOF_WRITE_WAIT_MS / 1000} s of the detach; the successor reads what the host applied`);
        writer.failPending('the engine host detached before the write settled');
      }
    }
    const holder = this.transport?.holder;
    if (writer !== null) {
      try {
        this.record('meta', { event: 'host_detach', reason, holderId: holder?.holderId ?? null, fence: holder?.fence ?? null });
      } catch (error) {
        this.log(`host_detach not journaled: ${messageOf(error)}`);
      }
    }
    this.journalClosed = true;
    this.hostMap?.close();
    this.tracker.dispose();
    this.transport?.detach?.({ ack: true });
    await this.journal.close().catch((error: unknown) => this.log(`journal not closed: ${messageOf(error)}`));
    this.log(`detached (${reason}): its session host and engine run on for the successor`);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // P5 O16 M3: adoption (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D24, D26, D32, D49)

  // The restore fold, the queue's adoption, the restored attention published once, then the reconnect row and the read
  // loops: the ring's replay is journaled and normalised as any record is, its requests held by the barrier until the
  // replay has caught up (`caughtUp`).
  private async adopt(adopted: AdoptedLaunch): Promise<void> {
    const transport = this.transport!;
    // fix wave 1: partial reader state is never trusted; a fold or a queue restore that fails is a failed adoption
    let evidence: { written: ReadonlySet<string>; unended: MessageUuid[]; ended: ReadonlySet<string> };
    try {
      evidence = this.fold();
    } catch (error) {
      this.abandonAdoption(`the journal could not be folded: ${messageOf(error)}`);
      return;
    }
    try {
      await this.queue.adopt(evidence);
      this.queueAdopted = true;
    } catch (error) {
      this.abandonAdoption(`the queue could not be restored: ${messageOf(error)}`);
      return;
    }
    if (this.frozen) return; // P5 O16 M3b: handed over before it connected; the next successor adopts it
    this.sideQuestions.adopted(new Date().toISOString());
    this.emit('brokerItems', this.brokerItems()); // the fold told nothing: the restored list, once
    this.publishCatalog();
    this.record('meta', { event: 'reconnect', phase: 'attempting', ...this.attempt, trigger: this.reconnectTrigger, reason: null });
    this.connect(transport, adopted.fence);
    if (this.stopReason !== null) void this.terminate(true); // stopped while the journal was folded
  }

  // Every row of the launch's journal, every file in order, fed to the session's readers with nothing told, written or
  // dispatched (D24): the normaliser's state (its events dropped), the status tracker and the work state's evidence (the
  // turn edges, the Stops, the cron tools and the task snapshots in journal order, D32), the broker, `!` mode, the
  // side-question log, the observed facts and the engine session ids. The outstanding set becomes the barrier. Answers
  // the queue's evidence: the user frames written, the steers no row ended, and the submissions a main-lane turn end
  // names (fix wave 1). A gap an earlier adoption journaled leaves the work unknown until a later Stop (fix wave 1).
  private fold(): { written: ReadonlySet<string>; unended: MessageUuid[]; ended: ReadonlySet<string> } {
    const outstanding = new OutstandingSet();
    const unsettled = new UnsettledFold();
    const written = new Set<string>();
    const ended = new Set<string>();
    this.folding = true;
    this.tracker.restoring = true;
    try {
      adoptionTestSeams.beforeFold?.(this.plan.launchId);
      for (const row of launchRows(dirname(this.journal.path), this.plan.launchId)) {
        outstanding.observe(row);
        unsettled.push(row);
        this.observed?.row(row);
        this.noteMessage(row);
        const events = this.normalizer.push(row);
        this.pendingWarnings.length = 0; // journaled, once, by the old manager
        this.durableCrons.note(this.normalizer.state.sessionId);
        if (events.length > 0) this.lastEventSeq = row.seq;
        const frame = (row.frame ?? {}) as Frame;
        if (row.direction === 'in') {
          this.tracker.observe(frame, typeof frame.timestamp === 'string' ? frame.timestamp : row.at);
          this.observeStop(frame);
        } else if (row.direction === 'out' && frame.type === 'user' && typeof frame.uuid === 'string') written.add(frame.uuid);
        else if (row.direction === 'meta' && frame.event === 'host_attach' && frame.replayed === 'gap') this.tracker.gap();
        for (const event of events) {
          if (event.parentToolUseId !== null) continue;
          if (event.kind === 'turn.started') this.tracker.turnStarted(event.id);
          else if (event.kind === 'turn.ended' && !event.isEchoReceipt) {
            this.tracker.turnEnded();
            for (const uuid of event.userMessageUuids) ended.add(uuid);
          }
        }
        this.broker.restore(row);
        this.bashMode.restore(row);
        this.sideQuestions.restore(row);
      }
    } finally {
      this.folding = false;
      this.tracker.restoring = false;
    }
    this.outstanding = outstanding;
    return { written, unended: unsettled.unsettled(), ended };
  }

  // fix wave 1: an adoption that failed before its first write: logged with its cause, never served, and its session host
  // and engine left running (the transport detached, nothing killed or released), so the next start adopts them again.
  // The journal stays the old manager's: no row of this engine host's is written.
  private abandonAdoption(cause: string): void {
    this.log(`the adoption failed: ${cause}; its session host and engine are left running`);
    this.transport?.detach?.();
    this.tracker.dispose();
    this.journalClosed = true;
    void this.journal.close().catch((error: unknown) => this.log(`journal not closed: ${messageOf(error)}`));
    const summary: ExitSummary = { code: null, signal: null, reason: 'unknown', lostAttentionCount: 0 };
    this.exitInfo = { code: null, signal: null, reason: 'unknown', at: new Date().toISOString(), release: null };
    this.setProcess('exited');
    this.settleAdoption(new AdoptionFailed(`the adoption failed: ${cause}`, true));
    this.resolveExited(summary);
    this.emit('exited', summary);
  }

  // A Stop the engine asked of the old manager's callback, or of one the barrier holds: the work state's evidence, applied
  // where it stands in the journal; its answer was the old manager's, or is the disposal's `{}`.
  private observeStop(frame: Frame): void {
    if (frame.type !== 'control_request') return;
    const parsed = HookCallbackRequestSchema.safeParse((frame as { request?: unknown }).request);
    if (parsed.success && isStopCallbackId(parsed.data.callback_id)) this.tracker.stopped(parsed.data.input);
  }

  // The barrier's exception: the `maws` server's protocol service (its `initialize`, `tools/list`, notifications, another
  // server's name), which has no effect and which the engine's MCP handshake may wait on.
  private static protocolService(req: ControlRequestFrame): boolean {
    if (req.request.subtype !== 'mcp_message') return false;
    const message = readMcpMessage(req.request);
    return !(message.kind === 'request' && message.method === 'tools/call');
  }

  // The ring's replay has caught up: `host_attach` (an exact replay's; a gap's was written at the gap), the barrier lifts
  // and every request left outstanding is disposed of by Interfaces §D's table; then the owed interrupt, then the
  // handshake. From here the session dispatches live.
  private async caughtUp(): Promise<void> {
    const outstanding = this.outstanding;
    if (outstanding === null) return;
    this.outstanding = null;
    const adopted = this.opts.adopted!;
    if (!this.attachRecorded) {
      this.attachRecorded = true;
      this.record('meta', { event: 'host_attach', holderId: this.transport?.holder?.holderId ?? null, fence: adopted.fence, frontier: adopted.frontier, replayed: 'exact', firstSeq: null });
    }
    const left = outstanding.result();
    this.handshakeHeld = []; // fix wave 1: the gate stays closed through the owed interrupt and the re-initialize
    this.dispose(left);
    if (left.outbound.length > 0) this.log(`${left.outbound.length} request(s) of the previous engine host were never answered; a late answer to one is dropped`);
    const client = this.client;
    if (this.processState !== 'initializing' || client === null) return;
    if (adopted.owedInterrupt) await this.sendOwedInterrupt(client);
    await this.handshake(client);
  }

  private dispose(left: Outstanding): void {
    const client = this.client!;
    for (const { request: req } of left.inbound) {
      const requestId = req.request_id as RequestId;
      switch (req.request.subtype) {
        case 'mcp_message': {
          const message = readMcpMessage(req.request);
          // an ask is raised again under its request id, so the human's answer settles the engine's own call; any other
          // tool call may have acted, so it is answered with the orphan text and never run again
          if (message.kind === 'request' && message.method === 'tools/call' && toolCallOf(message.params).name !== 'ask') this.maws.orphaned(req);
          else this.maws.accept(req);
          break;
        }
        case 'hook_callback': // an earlier callback's (the re-initialize registers its own): no opinion
          client.respond(requestId, {}).catch((error: unknown) => this.log(`hook_callback ${requestId} not answered: ${messageOf(error)}`));
          break;
        case 'can_use_tool':
        case 'elicitation':
        case 'request_user_dialog':
          this.broker.accept(req); // pending already when the fold restored it; the engine's redelivery is the same id (D49)
          break;
        case 'ui_copy':
        case 'ui_prompt_read':
        case 'ui_prompt_fill':
        case 'ui_prompt_suggest':
          break; // the handshake's surface attach re-attaches the surface, as after a system/init
        default:
          client.respondError(requestId, `MAWS does not handle ${req.request.subtype}`).catch((error: unknown) => this.log(`error answer not written: ${messageOf(error)}`));
      }
    }
    for (const { request } of left.asyncAsks) this.maws.restoreAsyncAsk(request, new Date().toISOString());
    if (left.inbound.length > 0 || left.asyncAsks.length > 0) this.emit('brokerItems', this.brokerItems());
  }

  // D12: the interrupt the old manager owed, before anything else of this writer's; its answer settles the mark, a
  // timeout keeps it until the late answer (settleOwedInterrupt).
  private async sendOwedInterrupt(client: ControlClient): Promise<void> {
    const generation = ++this.owedInterrupt.generation;
    try {
      await interrupt(client, { reason: 'user-cancel', cancel_queued: false });
    } catch (error) {
      this.log(`the owed interrupt failed: ${messageOf(error)}`);
      if (error instanceof ControlTimeout && generation === this.owedInterrupt.generation) {
        this.owedInterrupt.lateRequestId = error.requestId;
        return;
      }
    }
    if (generation === this.owedInterrupt.generation) this.storeWrite(this.store.saveOwedInterrupt(this.spec.appSessionId, false), 'owed interrupt');
  }

  // Ready: the turn ends the replay saw, then the head as after any sequence.
  private async releaseAfterAdoption(): Promise<void> {
    this.releaseDeferred = false;
    for (const event of this.deferredTurnEnds.splice(0)) {
      if (this.frozen) return; // P5 O16 M3b fix wave 1
      await this.queue.onTurnEnded(event).catch((error: unknown) => this.log(`queue release failed: ${messageOf(error)}`));
    }
    if (this.frozen) return;
    await this.queue.onSequenceEnded().catch((error: unknown) => this.log(`queue release after adoption failed: ${messageOf(error)}`));
  }

  // The last conversation message the journal holds (an engine `user` or `assistant` frame of the main lane, or a `user`
  // frame written to it, or the last record a reseed restored, fix wave 1): where a gap's reseed reads the transcript from.
  private noteMessage(row: JournalRow): void {
    const f = row.frame as Frame & { uuid?: unknown; parent_tool_use_id?: unknown; event?: unknown; rows?: unknown };
    if (row.direction === 'meta' && f?.event === 'transcript_reseed' && Array.isArray(f.rows)) {
      const lastRow = (f.rows as { uuid?: unknown }[]).at(-1);
      if (typeof lastRow?.uuid === 'string') this.lastMessageUuid = lastRow.uuid;
      return;
    }
    if (typeof f?.uuid !== 'string' || (f.type !== 'user' && f.type !== 'assistant')) return;
    if (row.direction === 'out' || (row.direction === 'in' && (f.parent_tool_use_id === null || f.parent_tool_use_id === undefined))) this.lastMessageUuid = f.uuid;
  }

  // Holder design §3.3 (D23): output lost from the session host's ring is the conversation's, restored from the engine's
  // own transcript: its main-lane `user` and `assistant` records after the last message the journal holds, journaled as
  // one `transcript_reseed` row the normaliser maps as the disk reader does. True when the transcript was read from that
  // message (the rows may be none); false when it could not be (no message, no file, the message not in it).
  private reseed(): boolean {
    const after = this.lastMessageUuid;
    if (after === null) return false;
    const cwd = this.tracker.engineCwd ?? this.plan.cwd;
    const engineSessionId = this.normalizer.state.sessionId ?? this.plan.sessionId;
    let text: string;
    try {
      let real = cwd;
      try {
        real = realpathSync(cwd);
      } catch {
        // the directory is gone: its name is the slug's
      }
      text = readFileSync(join(resolveStorePaths(this.plan.env).projects, slugOf(real), `${engineSessionId}.jsonl`), 'utf8');
    } catch (error) {
      this.log(`the gap's transcript could not be read: ${messageOf(error)}`);
      return false;
    }
    const records: Record<string, unknown>[] = [];
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        const record = JSON.parse(line) as unknown;
        if (record !== null && typeof record === 'object') records.push(record as Record<string, unknown>);
      } catch {
        // a torn last line: the engine is writing it
      }
    }
    const from = records.findIndex((r) => r.uuid === after);
    if (from === -1) {
      this.log(`the gap's transcript does not hold message ${after}; nothing is reseeded`);
      return false;
    }
    const rows = records.slice(from + 1).filter((r) => (r.type === 'user' || r.type === 'assistant') && r.isSidechain !== true && typeof r.uuid === 'string');
    if (rows.length > 0) this.record('meta', { event: 'transcript_reseed', rows }); // its row moves lastMessageUuid (noteMessage)
    return true;
  }
  // P5 O16 M3 end

  // W3 (charter D-18 and §5.1 as amended 2026-10-01): a spec that asked for auto and an initialize that answered another
  // mode is the engine refusing auto at launch, which it does without a code (pass2/auto-haiku seq 4). Before the
  // session is ready the host sets the spec's fallback with `set_permission_mode` (pass3/w3-auto-fallback seq 7-9: it
  // takes acceptEdits after the refusal) and keeps auto requested with the refusal in words: a model the catalogue does
  // not mark `supportsAutoMode: true` is `auto_mode_model`, anything else `auto_mode_unavailable`. A fallback the engine
  // refuses leaves the engine's mode and says so in a notice; the composer says the rest from the status.
  private async fallBackFromAuto(client: ControlClient, init: { current_permission_mode: string; models?: unknown[] }): Promise<void> {
    const fallback = this.spec.permissionFallback ?? null;
    if (this.spec.permissionMode !== 'auto' || fallback === null || fallback === 'auto' || init.current_permission_mode === 'auto' || this.processState !== 'initializing') return;
    const asked = this.spec.model ?? 'default';
    const row = (init.models ?? []).find((m): m is { value: string; resolvedModel?: unknown; supportsAutoMode?: unknown } => typeof m === 'object' && m !== null && ((m as { value?: unknown }).value === asked || (m as { resolvedModel?: unknown }).resolvedModel === asked));
    const refusal: AutoModeRefusalCode = row !== undefined && row.supportsAutoMode !== true ? 'auto_mode_model' : 'auto_mode_unavailable';
    try {
      const effective = init.current_permission_mode === fallback ? fallback : (await setPermissionMode(client, { mode: fallback })).mode;
      this.tracker.fallBack(isPermissionMode(effective) ? effective : fallback, refusal);
    } catch (error) {
      this.tracker.fallBack(isPermissionMode(init.current_permission_mode) ? init.current_permission_mode : 'default', refusal);
      this.notice('permission:fallback_failed', `Auto mode isn't available for this session, and ${fallback} could not be set: ${messageOf(error)}`);
    }
  }

  // P5 O2 M2: the owner's Keep running mark (`session.setKeep`, which persists it first); it exempts the idle release only
  setKept(kept: boolean): void {
    this.kept = kept;
    this.touch();
  }

  // The grant snapshot (unless the caller passed one), the keep mark, the engine session ids and the launch spec, from
  // and to the SessionStateStore.
  private async loadState(): Promise<void> {
    try {
      this.kept = await this.store.loadKeep(this.spec.appSessionId); // P5 O2 M2
    } catch (error) {
      this.log(`keep mark not loaded: ${messageOf(error)}`);
    }
    await this.durableCrons.load(); // P5 O2 M2: the lineage, then a resume's cron record and read of the durable crons
    let cronRecord: CronRecord | null = null;
    try {
      cronRecord = await this.store.loadCronRecord(this.spec.appSessionId); // P5 Decision Log 49
    } catch (error) {
      this.log(`cron record not loaded: ${messageOf(error)}`);
    }
    this.tracker.launched(cronRecord);
    if (this.opts.grants === undefined) {
      try {
        this.grants = await this.store.loadGrants(this.spec.appSessionId);
      } catch (error) {
        this.log(`grants not loaded: ${messageOf(error)}`);
      }
    }
    // C10 start: a fork's empty snapshot is seeded from the conversation it copies and saved as its own, so the human
    // does not answer twice and a later resume of the fork re-applies it by the fork's own id
    if (this.spec.inheritGrantsFrom !== null && this.grants.allow.length === 0) {
      try {
        const inherited = await this.store.loadGrants(this.spec.inheritGrantsFrom);
        if (inherited.allow.length > 0) {
          this.grants = inherited;
          this.inheritedGrants = true;
          this.storeWrite(this.store.saveGrants(this.spec.appSessionId, inherited), 'grants');
        }
      } catch (error) {
        this.log(`grants of ${this.spec.inheritGrantsFrom} not inherited: ${messageOf(error)}`);
      }
    }
    // C10 end
    this.storeWrite(this.store.saveLaunchSpec(this.spec.appSessionId, this.spec), 'launch spec');
  }

  // Causal order (M3 re-review): a frame read while one of our writes is in flight may be the engine's reply to it,
  // and the write's own row is journaled only when the write settles; such frames wait in `held` (in memory: stdout is
  // never paused, so the child can always write) and are processed, in arrival order, right after that row.
  private async readLoop(transport: EngineTransport): Promise<void> {
    let processExited = false;
    void transport.exited.then(() => { processExited = true; });
    for await (const item of transport.frames) {
      if (this.frozen) continue; // P5 O16 M3b: left in the host's ring for the successor
      this.heard();
      if (this.writer?.busy || this.held.length > 0) this.held.push(item);
      else this.processItem(item);
    }
    // Stdout EOF and a write's callback are independent (M3 re-review 2): wait for outstanding writes to settle
    // before releasing what they hold. Once the process has exited, or after EOF_WRITE_WAIT_MS with the process still
    // alive (a wedged child), settle the rest as write_failed, so no response row precedes its request row, no out
    // row can follow the exit row, and a wedged child is ended through the ladder instead of holding the session open.
    if (this.frozen) return; // P5 O16 M3b: the stream ended at the detach; the engine runs on for the successor
    const writer = this.writer;
    if (writer?.busy) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        writer.whenIdle().then(() => 'idle' as const),
        transport.exited.then(() => 'exited' as const),
        new Promise<'wedged'>((resolve) => (timer = setTimeout(() => resolve('wedged'), EOF_WRITE_WAIT_MS))),
      ]);
      clearTimeout(timer);
      if (outcome === 'exited') writer.failPending('the process exited before the write settled');
      if (outcome === 'wedged') {
        writer.failPending(`stdout ended and the write did not settle within ${EOF_WRITE_WAIT_MS / 1000} s`);
        void this.terminate(false);
      }
    }
    this.drainHeld(true);
    // EOF also wins when an aborted write releases the gate: no more frames can
    // report its stalled_write problem, and a live child still needs the ladder.
    await Promise.resolve(); // an exit can close stdout and settle exited in the same turn
    // fix wave 1 (D58): an adopted engine's output closed with its re-initialize unanswered is a definite failure
    if (!processExited && this.opts.adopted && this.initializeId !== null && !this.handshakeDone && this.processState === 'initializing') this.reinitializeFailed('the engine\'s output closed before it answered', 'closed');
    if (!processExited) void this.terminate(false);
  }

  private drainHeld(force = false): void {
    if (this.frozen) return; // P5 O16 M3b: dropped at the freeze
    while (this.held.length > 0 && (force || !this.writer?.busy)) this.processItem(this.held.shift()!);
  }

  // A frame the journal could not take is never acted on (no request reaches the broker, no response settles a
  // request): the journal no longer records what the engine said, so the process ends as for a failed out row.
  private processItem(item: TransportItem): void {
    try {
      if (item.error) {
        this.transportProblem(item.error, item.hseq);
        return;
      }
      const row = this.recordHosted('in', item.frame, item.hseq);
      const frame = item.frame as Frame;
      if (!this.handshakeDone) this.hookBeforeAnswer(frame);
      this.tracker.observe(frame, typeof frame.timestamp === 'string' ? frame.timestamp : row.at);
      if (frame.type === 'system') this.publishCatalog(); // C7: only system/init and system/commands_changed move the catalogue
      // R2: an init that advertises the surface after an initialize answer that did not
      if (this.handshakeDone && this.client && frame.type === 'system' && frame.subtype === 'init' && Array.isArray(frame.capabilities)) void this.surface.attach(this.client, frame.capabilities as string[]);
      this.settleOwedInterrupt(frame); // P5 O16 M2
      if (this.outstanding !== null) this.observeStop(frame); // P5 O16 M3: the barrier holds the Stop's dispatch, not its evidence
      this.broker.observe(item.frame);
      this.bashMode.observe(item.frame);
      this.client?.observe(item.frame);
      this.touch();
    } catch (error) {
      if (error instanceof JournalWriteFailed) this.inboundJournalFailed(error);
      else this.log(`frame not processed: ${messageOf(error)}`);
    }
  }

  // The out path's rule (OutboundWriter.settle) for an inbound row: `transport_error { journal_failed }` if the journal
  // can still take it, then the ladder without end_session (whole-branch review).
  // P5 O16 M2 (D12): a timed-out interrupt's answer, however late, settles the durable mark it holds. Matched here
  // rather than through RPC's late table, which forgets a request after LATE_TABLE_MS while the mark lasts until the
  // answer (or a newer interrupt takes it over).
  private settleOwedInterrupt(frame: Frame): void {
    const requestId = this.owedInterrupt.lateRequestId;
    if (requestId === null || frame.type !== 'control_response') return;
    if ((frame.response as { request_id?: unknown } | undefined)?.request_id !== requestId) return;
    this.owedInterrupt.lateRequestId = null;
    this.storeWrite(this.store.saveOwedInterrupt(this.spec.appSessionId, false), 'owed interrupt');
  }

  private inboundJournalFailed(error: JournalWriteFailed): void {
    try {
      this.record('meta', { event: 'transport_error', code: 'journal_failed', message: `journal write failed: ${error.message}` });
    } catch {
      /* the journal cannot take that row either; the log line and the ladder still report it */
    }
    this.log(`journal write failed on an inbound frame: ${error.message}; ending the process`);
    void this.terminate(false);
  }

  private async stderrLoop(transport: EngineTransport): Promise<void> {
    for await (const { text: line, hseq } of transport.stderr) {
      if (this.frozen) continue; // P5 O16 M3b: left in the host's ring for the successor
      this.heard();
      this.stderrTail.push(line);
      if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift();
      try {
        this.recordHosted('stderr', { text: line }, hseq);
      } catch (error) {
        // P5 O16 M2 (D39): under the host map a hosted stderr row that failed is a journal failure like an `in` row's,
        // since a silent miss would let the map certify the wrong row; the direct transport's stays lenient
        if (hseq !== undefined && this.hostMap !== null && error instanceof JournalWriteFailed) this.inboundJournalFailed(error);
        else this.log(`stderr line not journaled: ${messageOf(error)}`);
      }
    }
  }

  private transportProblem(problem: TransportProblem, hseq?: number): void {
    switch (problem.kind) {
      case 'parse_error':
        this.recordHosted('meta', { event: 'parse_error', message: problem.message, length: problem.length, typeGuess: problem.typeGuess }, hseq);
        return;
      case 'replay_mismatch':
        this.record('meta', { event: 'replay_mismatch', message: problem.message, ...(problem.replay ?? {}) });
        return;
      case 'replay_unrecorded_read': // not a problem: the replay answered a read its fixture never recorded (no event)
        this.record('meta', { event: 'replay_unrecorded_read', message: problem.message, ...(problem.read ?? {}) });
        if (problem.read) this.client?.answeredByStandIn(problem.read.requestId); // E11: its empty answer warns nothing
        return;
      case 'stalled_write':
        this.record('meta', { event: 'transport_error', message: problem.message, code: 'stalled_write' });
        void this.terminate(false); // stdin was aborted; let the engine flush before forced cleanup
        return;
      case 'line_budget':
        this.record('meta', { event: 'transport_error', message: problem.message, code: 'line_budget', length: problem.length });
        void this.terminate(false); // the transport already killed the process; the ladder marks it exiting
        return;
      case 'spawn_error':
        this.record('meta', { event: 'transport_error', message: problem.message, code: 'spawn_error' });
        return;
      // P5 O16 M2: the session host died with the process's pipes; the transport has ended the stream and the process
      case 'host_lost':
        this.record('meta', { event: 'transport_error', message: problem.message, code: 'host_lost' });
        return;
      // D45: a reconnect to a live host, or an adoption (M3), found output gone from its ring: the gap is journaled, the
      // conversation reseeded from the engine's transcript (M3, D23) with a notice, the map says the lost sequences are
      // accounted for, and the frontier passes them; the work state is unknown until the next Stop (D32)
      case 'host_gap': {
        const gap = problem.gap!;
        this.attachRecorded = true;
        this.record('meta', { event: 'host_attach', holderId: gap.holderId, fence: gap.fence, frontier: gap.frontier, replayed: 'gap', firstSeq: gap.firstSeq });
        const restored = this.reseed();
        const when = this.outstanding !== null ? 'the engine host was restarting' : 'the engine host reconnected to the session host';
        this.notice('holder:gap', restored ? `Some output was lost while ${when}; the conversation was restored from the transcript.` : `Some output was lost while ${when}; the conversation may be missing part of it.`);
        this.tracker.gap();
        try {
          this.hostMap?.lost(gap.firstSeq - 1, this.journalFile());
        } catch (error) {
          throw new JournalWriteFailed(error); // D39: the map's failure is the journal's (processItem ends the process)
        }
        for (let seq = gap.lostFrom; seq < gap.firstSeq; seq += 1) this.transport?.journaled?.(seq);
        return;
      }
      // P5 O16 M3: an adoption's replay of the ring is over (no problem: the barrier lifts)
      case 'host_caught_up':
        void this.caughtUp().catch((error: unknown) => this.log(`the adoption's handshake failed: ${messageOf(error)}`));
        return;
    }
  }

  // P5 O16 M2 (Interfaces §C; D23, D39): a row of a hosted record. Its map line `<hseq> <the row's seq>` is appended
  // before the row, so an ack never covers a record whose line and row are not both on disk; a row whose append failed
  // is retracted (its seq belongs to whatever row lands next); once written, the transport is told, which advances the
  // acknowledged frontier. A retraction that cannot be written closes the journal first, so no later row reuses the seq.
  private recordHosted(direction: JournalDirection, frame: unknown, hseq: number | undefined): JournalRow {
    const map = this.hostMap;
    if (hseq === undefined || map === null) return this.record(direction, frame);
    if (this.journalClosed) throw new JournalClosed(`${direction} row`);
    try {
      map.line(hseq, (this.journal.lastSeq ?? 0) + 1, this.journalFile());
    } catch (error) {
      throw new JournalWriteFailed(error);
    }
    let row: JournalRow;
    try {
      row = this.record(direction, frame);
    } catch (error) {
      if (error instanceof JournalWriteFailed) {
        try {
          map.retract(hseq, this.journalFile());
        } catch (retraction) {
          this.journalClosed = true;
          this.log(`the host map's retraction of record ${hseq} failed (${messageOf(retraction)}); the journal is closed`);
        }
      } else if (!(error instanceof JournalClosed)) this.transport?.journaled?.(hseq); // the row is on disk; what failed came after it
      throw error;
    }
    this.transport?.journaled?.(hseq);
    return row;
  }

  private journalFile(): string {
    return this.journal.currentPath ?? this.journal.path;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Inbound requests

  private inbound(req: ControlRequestFrame): void {
    // P5 O16 M3 (D24): an adoption's barrier holds every request (the outstanding set disposes of it at the catch-up) but
    // the `maws` server's protocol service
    if (this.outstanding !== null) {
      if (EngineSession.protocolService(req)) this.maws.accept(req);
      return;
    }
    // fix wave 1: from the catch-up until the re-initialize is answered, the rest wait in order (responses correlate);
    // fix wave 2: the protocol service's `notifications/cancelled` withdraws a call the gate holds (D42's correlation)
    if (this.handshakeHeld !== null) {
      if (!EngineSession.protocolService(req)) {
        this.handshakeHeld.push(req);
        return;
      }
      this.withdrawHeldCall(req);
    }
    switch (req.request.subtype) {
      case 'hook_callback':
        void this.runHook(req);
        return;
      case 'can_use_tool':
      case 'elicitation':
      case 'request_user_dialog':
        this.broker.accept(req);
        return;
      // R2: the engine's requests to the attached surface, for the renderer to answer
      case 'ui_copy':
      case 'ui_prompt_read':
      case 'ui_prompt_fill':
      case 'ui_prompt_suggest':
        this.surface.accept(req, this.respond);
        return;
      // E1 start: the `maws` server's JSON-RPC traffic (the server answers another server's name itself)
      case 'mcp_message':
        this.maws.accept(req);
        return;
      // E1 end
      default:
        this.log(`inbound ${req.request.subtype} request ${req.request_id} is not handled; answering an error`);
        this.client?.respondError(req.request_id as RequestId, `MAWS does not handle ${req.request.subtype}`).catch((error: unknown) => this.log(`error answer not written: ${messageOf(error)}`));
    }
  }

  private async runHook(req: ControlRequestFrame): Promise<void> {
    const client = this.client!;
    const requestId = req.request_id as RequestId;
    try {
      const parsed = HookCallbackRequestSchema.safeParse(req.request);
      const hook = parsed.success ? this.hooks.get(parsed.data.callback_id) : undefined;
      if (!parsed.success || !hook) {
        this.log(`hook_callback for unknown callback ${String(req.request.callback_id)}; answering {} (no opinion)`);
        await client.respond(requestId, {});
        return;
      }
      let response: unknown;
      try {
        response = await hook(parsed.data.input, { requestId, toolUseId: parsed.data.tool_use_id ?? parsed.data.input.tool_use_id ?? null });
      } catch (error) {
        await client.respondError(requestId, `host hook failed: ${messageOf(error)}`);
        return;
      }
      await client.respond(requestId, response ?? {});
    } catch (error) {
      this.log(`hook_callback ${requestId} not answered: ${messageOf(error)}`);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // What the events mean for the host's next step

  private react(events: SessionEvent[]): void {
    this.maws.observe(events); // P4-A2 (X35): every lane's, an artifact call shown as its input streams
    for (const event of events) {
      if (event.parentToolUseId !== null) continue;
      if (event.kind === 'turn.started') {
        this.tracker.turnStarted(event.id);
      } else if (event.kind === 'turn.ended' && !event.isEchoReceipt) {
        this.tracker.turnEnded(); // P5 O2 M2: the work state's turn edge
        this.lastUsedAt = new Date().toISOString(); // C12: a turn's end is use, on the host's clock like every other (the status goes out with the frame's touch)
        // the queue first: while a host sequence (clear and implement) still holds the session, it releases nothing
        // P5 O16 M3: an adopted process's turn ends before its re-initialize wait for it (nothing can be written yet)
        if (this.releaseDeferred) this.deferredTurnEnds.push(event);
        else this.queue.onTurnEnded(event).catch((error: unknown) => this.log(`queue release failed: ${messageOf(error)}`));
        if ((event.origin === 'human' || event.origin === null) && this.processState === 'ready') void this.verifyGateway();
        if (this.processState === 'ready') void this.sampleContext();
        this.clearAndImplement.turnEnded(!event.isError && event.result === 'success');
        this.maws.turnEnded(); // P3-A (M6): the turn's artifact edits become `turn` versions
      } else if (event.kind === 'command.lifecycle') {
        this.queue.onLifecycle(event);
        this.clearAndImplement.commandLifecycle(event.commandUuid, event.state);
      }
    }
  }

  // "Verified routed by get_status" (Interfaces, Process table): the Session section's `Anthropic base URL` row and
  // the Environment section's `Auto mode server` row; read at startup and after each human turn's result.
  private async verifyGateway(): Promise<void> {
    const client = this.client;
    if (!client) return;
    let status: GetStatusResponse;
    try {
      status = await getStatus(client, {});
    } catch (error) {
      if (!this.frozen) this.log(`get_status failed: ${messageOf(error)}`);
      return;
    }
    if (this.processState === 'exited' || this.frozen) return; // P5 O16 M3b fix wave 1: nothing recorded once frozen
    const rows = (title: string) => status.sections.find((s) => s.title === title)?.rows ?? [];
    const baseUrl = rows('Session').find((r) => r.label === 'Anthropic base URL')?.value ?? null;
    const server = rows('Environment').find((r) => r.label === 'Auto mode server')?.value;
    // the row follows the current mode (it reads Disabled in `default`: M6 live 3.9), so it names the lane only in auto
    const autoModeServer = this.tracker.effectiveMode !== 'auto' ? this.tracker.gateway.autoModeServer : server === 'Enabled' ? 'enabled' : server === 'Disabled' ? 'disabled' : 'unknown';
    const expected = this.plan.env.ANTHROPIC_BASE_URL ?? RELAY_URL;
    const verified = this.plan.gateway === 'gateway' ? (baseUrl === expected ? 'routed' : 'mismatch') : baseUrl === null ? 'direct' : 'mismatch';
    const wasMismatch = this.tracker.gateway.verified === 'mismatch';
    this.tracker.gateway = { ...this.tracker.gateway, baseUrl, autoModeServer, verified };
    this.record('meta', { event: 'status_check', baseUrl, autoModeServer, verified });
    if (verified === 'mismatch' && !wasMismatch) {
      this.notice('gateway:mismatch', this.plan.gateway === 'gateway' ? `This session is not routed through ClaudeUsage: get_status reports ${baseUrl ?? 'no custom base URL'}.` : `This direct session reports a custom base URL (${baseUrl}).`);
    }
    this.touch();
  }

  // The status line's `ctx` once ready and after every turn (debt wave 3): the engine's context read, whose answer the normaliser turns
  // into `context.sample` from its journal row; a failed read samples nothing and the last sample stands. E11: a read a
  // replay never recorded is logged by nothing but its journal row.
  private async sampleContext(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await getContextUsage(client, { detail: 'summary' });
    } catch (error) {
      if (!(error instanceof ControlError && error.code === 'replay_unrecorded')) this.log(`get_context_usage failed: ${messageOf(error)}`);
    }
  }

  // C3 corrective: the reconnect rows' attempt, main's retry of a silent resume (`spec.retry`) or the one attempt
  private get attempt(): { attempt: number; maxAttempts: number } {
    return { attempt: this.spec.retry?.attempt ?? 1, maxAttempts: this.spec.retry?.maxAttempts ?? 1 };
  }

  // C12: `process_exit` for the first launch of an id after its release (the process table's released ids), else `user`
  private get reconnectTrigger(): 'user' | 'process_exit' | 'host_restart' {
    return this.opts.reconnectTrigger ?? 'user';
  }

  private readyClient(): ControlClient {
    if (this.processState !== 'ready' || !this.client) throw new Error(`session ${this.spec.appSessionId} is not ready (${this.processState})`);
    return this.client;
  }

  private notice(key: string, text: string): void {
    this.record('meta', { event: 'notice', level: 'warning', key, text });
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Failure, the ladder and exit

  // Debt wave 5: a hook frame before the initialize answer (SessionStart hooks, which 2.1.283 runs before it reads
  // initialize) restarts the answer's deadline, so the hooks' own time never counts against the long class.
  private hookBeforeAnswer(frame: Frame): void {
    if (this.processState !== 'initializing' || frame.type !== 'system') return;
    if (frame.subtype !== 'hook_started' && frame.subtype !== 'hook_progress' && frame.subtype !== 'hook_response') return;
    this.hooksBeforeAnswer ??= new Set();
    if (typeof frame.hook_id === 'string') {
      if (frame.subtype === 'hook_response') this.hooksBeforeAnswer.delete(frame.hook_id);
      else this.hooksBeforeAnswer.add(frame.hook_id);
    }
    this.extendInitialize();
  }

  private extendInitialize(): void {
    if (this.hooksBeforeAnswer === null || this.initializeId === null || this.opts.adopted) return; // fix wave 1: an adopted one's wait is awaitReinitialize's
    const running = this.hooksBeforeAnswer.size > 0 ? this.hookBoundMs : 0;
    this.client?.extendDeadline(this.initializeId, running + REQUEST_TIMEOUT_MS.long, 'the last SessionStart hook frame');
  }

  // The engine wrote something: the first-output bound is met (C3 corrective).
  private heard(): void {
    if (this.silence === null) return;
    clearTimeout(this.silence);
    this.silence = null;
  }

  // A failed initialize (error response, ControlTimeout, transport error before the response): `init_failed` with the
  // stderr seen so far, then the ladder without its end_session rung; `exited { crash }` only at the real exit.
  // P5 O16 M3a fix wave 1 (D58): an adopted engine's failed re-initialize ends it the same way, its cause named.
  private initializeFailed(error: unknown): void {
    if (this.processState !== 'initializing') return; // exited before the response (handled at the exit) or stopped
    if (this.frozen) return; // P5 O16 M3b fix wave 1: frozen (the transport detached or the answer left unread): the successor's
    const code = error instanceof ControlError ? error.code : null;
    if (this.opts.adopted) this.reinitializeFailed(messageOf(error), code);
    else this.writeInitFailed(messageOf(error), code);
    void this.terminate(false);
  }

  // P5 O16 M3b (D58a): the end's own cause rides its rows (init_failed, the failed reconnect, the exit), so the
  // normaliser tells it once, at the exit, and the session service resumes it
  private reinitializeFailed(cause: string, code: string | null): void {
    const message = `re-initialize after the handover failed: ${cause}`;
    this.log(message);
    this.exitCause = { kind: HANDOVER_REINIT_FAILED, detail: message };
    this.writeInitFailed(message, code);
    this.settleAdoption(new AdoptionFailed(message, false));
  }

  private writeInitFailed(message: string, code: string | null): void {
    this.initFailed = true;
    const detail = this.stderrTail.length > 0 ? `${message}\n${this.stderrTail.join('\n')}` : message;
    const cause = this.exitCause ? { cause: this.exitCause } : {}; // P5 O16 M3b (D58a)
    this.record('meta', { event: 'init_failed', message: detail, code, ...cause });
    if (this.reconnect) this.record('meta', { event: 'reconnect', phase: 'failed', ...this.attempt, trigger: this.reconnectTrigger, reason: detail, ...cause });
  }

  // The process's one ladder (session-ladder.ts); with no process yet it answers the stop result at once.
  private terminate(endSessionFirst: boolean, graceMs?: number): Promise<StopResult> {
    if (this.frozen) return Promise.resolve(this.stopResult()); // P5 O16 M3b: the successor's process now
    return this.ladder.terminate(this.transport, endSessionFirst, graceMs);
  }

  private stopResult(): StopResult {
    return { exited: this.processState === 'exited', code: this.exitInfo?.code ?? null, signal: this.exitInfo?.signal ?? null };
  }

  // The OS reported the exit (after stdout and stderr drained): the broker counts its losses, the queue retires what the
  // process took with it (its notices journaled first), the exit row is journaled with them, and only then is the
  // process `exited` and the reservation free.
  private handleExit(exit: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (this.processState === 'exited') return;
    if (this.frozen) return; // P5 O16 M3b: an exit after the freeze is the successor's to read and journal
    this.heard(); // C3 corrective: the bound ends with the process
    // P5 O16 M3: an adopted process answered its first initialize long ago; an exit before the re-initialize is no init failure
    if (!this.handshakeDone && !this.initFailed && this.stopReason === null && !this.opts.adopted) this.writeInitFailed('the process exited before answering initialize', 'exited');
    // fix wave 1 (D58): an adopted engine gone with its re-initialize unanswered is that re-initialize's failure
    if (this.opts.adopted && this.initializeId !== null && !this.handshakeDone && !this.initFailed && this.stopReason === null) this.reinitializeFailed('the process exited before it answered', 'exited');
    const reason: ExitReason = this.stopReason ?? (this.initFailed ? 'crash' : exit.code === 0 && exit.signal === null ? 'unknown' : 'crash');
    const { lost: lostApprovals } = this.broker.processExited();
    // E1 M5 fix: a blocking ask still published is attention lost like a pending AskUserQuestion (the architect's ruling
    // 1), counted before the tool server aborts it; `lostAskCount` names the asks among them (absent when none). E1: every
    // tool call, pane and capture settles, and the async asks are cancelled before the exit row.
    const lostAsks = this.maws.processExited();
    const lost = lostApprovals + lostAsks;
    this.sideQuestions.processExited(new Date().toISOString()); // E3: no answer comes once the process is gone
    this.client?.close('the process exited');
    this.clearAndImplement.processExited();
    this.bashMode.processExited();
    this.surface.processExited(); // R2
    this.tracker.dispose();
    // A process that never became ready never loaded the queue: nothing of this launch is in it to retire.
    const queueSettled = this.handshakeDone || this.queueAdopted /* P5 O16 M3 */ ? this.queue.onProcessExited(reason) : Promise.resolve();
    queueSettled.catch((error: unknown) => this.log(`queue not settled at exit: ${messageOf(error)}`));
    const release = reason === 'budget' ? this.release : null; // C12
    try {
      this.record('meta', { event: 'exit', code: exit.code, signal: exit.signal, reason, lostAttentionCount: lost, ...(lostAsks > 0 ? { lostAskCount: lostAsks } : {}), peakTreeRssKiB: this.tracker.peakTreeRssKiB, budget: release /* C12 */, ...(this.exitCause && { cause: this.exitCause }) /* P5 O16 M3b */ });
    } catch (error) {
      this.log(`exit not journaled: ${messageOf(error)}`);
    }
    this.exitInfo = { code: exit.code, signal: exit.signal, reason, at: new Date().toISOString(), release, ...(this.exitCause && { cause: this.exitCause }) /* P5 O16 M3b */ };
    this.settleAdoption(new AdoptionFailed(`the adopted process exited (${reason}) before it was ready`, false)); // fix wave 1: no-op once ready
    if (this.observed) this.storeWrite(this.observed.flush(true), 'observed facts'); // P2-A: issued before the exited status
    this.setProcess('exited');
    this.journalClosed = true;
    this.hostMap?.close(); // P5 O16 M2
    if (this.transport === null) this.opts.unspawned?.(); // P5 O16 M2: a session host that never launched is released
    void this.journal.close().catch((error: unknown) => this.log(`journal not closed: ${messageOf(error)}`));
    const summary: ExitSummary = { code: exit.code, signal: exit.signal, reason, lostAttentionCount: lost };
    // `exited` (and so `stop()`) settles once the exit's store writes have landed, so an archive's `forget` is the last
    // write and nothing recreates the state file after it (fix-wave follow-up)
    void (async () => {
      await queueSettled.catch(() => {});
      await this.queue.settled();
      while (this.storeWrites.size > 0) await Promise.allSettled([...this.storeWrites]);
      this.resolveExited(summary);
      this.emit('exited', summary);
    })();
  }

  // A store write the exit waits for (grants, the launch spec); a failure is logged, never thrown.
  private storeWrite(write: Promise<void>, what: string): void {
    const tracked = write.catch((error: unknown) => this.log(`${what} not saved: ${messageOf(error)}`));
    this.storeWrites.add(tracked);
    void tracked.then(() => this.storeWrites.delete(tracked));
  }

  // ---------------------------------------------------------------------------------------------------------------------

  private setProcess(state: ProcessState): void {
    if (this.processState === state || this.processState === 'exited') return;
    this.processState = state;
    this.touch();
  }

  // C7 start: the catalogue's publication (C7 execution document, Interfaces "Catalogue protocol"): after the tracker took
  // the initialize response or a system frame, the whole catalogue goes out once per revision it moved to; an identical
  // frame moves nothing (the tracker's rule), so nothing is published for it. The journal is never re-parsed.
  private publishCatalog(): void {
    const catalog = this.tracker.catalog();
    if (catalog.revision === this.publishedCatalogRevision) return;
    this.publishedCatalogRevision = catalog.revision;
    this.emit('catalog', catalog);
  }
  // C7 end

  // Emits `status` when anything but the event counter changed.
  private touch(): void {
    this.checkDrained(); // P5 O16 M3b: a call's retirement reaches the drain through here
    if (this.folding) return; // P5 O16 M3: the fold tells nothing; the adoption's first status follows it
    const status = this.status();
    const signature = JSON.stringify({ ...status, lastEventSeq: 0 });
    if (signature === this.lastStatusSignature) return;
    this.lastStatusSignature = signature;
    this.emit('status', status);
  }

  private emit<K extends keyof Listeners>(name: K, payload: Parameters<Listeners[K]>[0]): void {
    for (const listener of this.listeners[name]) {
      try {
        (listener as (p: typeof payload) => void)(payload);
      } catch (error) {
        this.log(`${name} listener failed: ${messageOf(error)}`);
      }
    }
  }
}

// The session's journal refused a row while live (disk full, …); the message is the journal's own.
class JournalWriteFailed extends Error {
  constructor(cause: unknown) {
    super(messageOf(cause), { cause });
    this.name = 'JournalWriteFailed';
  }
}

const NO_SERVERS: ReadonlySet<string> = new Set(); // C12

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
