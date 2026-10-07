// EngineSession (charter §4.1, §4.2, §4.4, §4.6; C3 execution document, Interfaces, M3 and M4): the object that wires
// one engine process — transport, control client, normaliser, permission broker, the app queue and `!` mode — runs the
// initialize handshake, the gateway verification read, grant re-application on a resume and queue recovery, and ends
// the process through the termination ladder (session-ladder.ts). Its one invariant: every row is journaled before it is normalised, and
// the normaliser is the only source of events. Every stdout frame, every frame we write (through `record`, which the
// one OutboundWriter per process also uses), every stderr line, and the `meta` rows the host writes (spawn,
// initialize, status check, init_failed, reconnect, queue, notices, the normaliser's own warnings, exit) pass through
// `record`, which journals the row and then normalises it; nothing here builds an event. What the frames say about the
// process lives in SessionStatusTracker (session-status.ts); the queue in MessageQueue (queue.ts); the plan outcome
// "clear context and implement" in ClearAndImplementSequence (session-clear.ts).
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid, RequestId } from '@shared/graph/ids';
import type { AutoModeRefusalCode, PermissionMode } from '@shared/graph/enums';
import type { RequestAnswer } from '@shared/engine/answers';
import type { Effort, LaunchSpec } from '@shared/engine/launch-spec';
import type { QueueEntry, QueueState, SendContent, SessionStateStore } from '@shared/engine/session-state-store';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SurfaceAnswer } from '@shared/engine/surface'; // R2
import { HookCallbackRequestSchema, type GetStatusResponse, type InterruptResponse, type ReloadPluginsResponse } from '@shared/wire/control';
import type { ControlRequestFrame } from '@shared/wire/frames';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import { BashMode } from './bash-mode';
import { PermissionBroker } from './broker';
import { appInitialize } from '@shared/engine/initialize';
import { cancelAsyncMessage, endSession, getContextUsage, getStatus, initialize, interrupt, REQUEST_TIMEOUT_MS, requestClassOf, setPermissionMode } from './controls';
import { EMPTY_GRANTS, reapply, recordFromResponse, type GrantSnapshot } from './grants';
import { ENGINE_COMPAT_NOTICE_KEY, EngineCompatWatch } from './engine-compat'; // W13
import { HostHookRegistry } from './host-hooks';
import { RELAY_URL, spawnMeta, type LaunchPlan } from './launch';
import { Normalizer, type NormalizerWarning } from './normalizer';
import { JournalClosed, OutboundWriter, type WriteOptions } from './outbound-writer';
import { MessageQueue, type SteerPriority } from './queue';
// C12 start
import { hardReasons } from './budget';
// C12 end
import { ControlClient, ControlError } from './rpc';
import { ClearAndImplementSequence } from './session-clear';
import { LADDER_MS, TerminationLadder, type ExitReason, type ExitSummary, type StopResult } from './session-ladder';
import { isPermissionMode, SessionStatusTracker, type Catalog } from './session-status';
import { SESSION_START_HOOK_MS, sessionStartHookMs } from './session-start-hooks';
import { MemorySessionStateStore } from './store/memory-session-state-store';
import { SessionSurface } from './surface'; // R2
// E1 start
import type { MawsArtifactCapturedResult, MawsPaneAnswerResult } from '@shared/ipc/schema/maws';
import { askAnswersProblem, askSteerText, type PendingAsk } from '@shared/maws/ask';
import type { AskAnswer, AskResult } from '@shared/maws/tools';
import { MemoryDeliverableStore, type DeliverableChange, type DeliverableWriter, type OnDeliverableWritten } from './deliverables/store';
import { AskAnswerMismatch } from './tool-server/ask';
import { askAttentionItem, AskTable, type AskCancelReason } from './tool-server/asks';
import { PaneBridge, type PaneShowRequest } from './tool-server/panes';
import { MawsToolServer, toolText } from './tool-server/server';
import { mawsTools } from './tool-server/tools';
// E1 end
// E3 start
import type { SideQuestionRequest } from '@shared/wire/control';
import { SideQuestionLog } from './side-questions';
// E3 end
// E2 start
import { CAPTURE_ANSWER_MS } from '@shared/maws/panes';
import type { ArtifactCaptureRequest, CaptureBridge } from './tool-server/artifacts';
import { HostBridge } from './tool-server/bridge';
// E2 end
// E4c start
import { tmpdir } from 'node:os';
import type { MawsBrowserAnswerResult } from '@shared/ipc/schema/maws';
import type { BrowserWaitReason } from '@shared/maws/browser';
import { BrowserBridge, type BrowserRequest } from './tool-server/browser-bridge';
// E4c end
import type { EngineTransport, TransportItem, TransportProblem } from './transport';

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
  reconnectTrigger?: 'user' | 'process_exit';
  // C12 end
  sessionStartHookMs?: (plan: LaunchPlan) => Promise<number>; // debt wave 6: the hooks' bound; read from the settings by default
  // E1: where the `maws` tools record deliverables (the launcher's FileDeliverableStore; in memory by default). E2: built
  // with the session's announcement, so every write the store settles reaches the windows as `deliverables.changed`.
  deliverables?: (onWritten: OnDeliverableWritten) => DeliverableWriter;
  // E10: whether an app is connected to the engine host (the runtime's); `show_pane` and `artifact_screenshot` fail at
  // once with `appNotOpen` while it is false. Absent, always connected.
  hasClient?: () => boolean;
  // E4c start: where main writes a browser screenshot (the launcher's userData: host and main derive the same path from
  // it; a session without one, in tests, names paths under the temp directory), and the runtime's notice that the app
  // went (the browser bridge settles its pending requests `appNotOpen`; absent, it never goes)
  userData?: string;
  onClientGone?: (hook: () => void) => () => void;
  // E4c end
}

// C12: the budget and the sum a release was made at (X6 `exit.release`, X1 `process.exited.budget`)
export interface BudgetRelease { limitKiB: number; totalKiB: number }

export interface SendResult { messageUuid: MessageUuid | null; disposition: 'sent' | 'queued'; queueId: string; entry: QueueEntry }

interface Listeners {
  events: (events: SessionEvent[]) => void;
  status: (status: EngineSessionStatus) => void;
  brokerItems: (items: AttentionItem[]) => void;
  queue: (queue: QueueState) => void;
  exited: (summary: ExitSummary) => void;
  catalog: (catalog: Catalog) => void; // C7: the whole catalogue, whenever its revision moved
  models: (models: unknown[]) => void; // C10: the initialize response's model list, for the catalogue cache
  paneShow: (request: PaneShowRequest & { appSessionId: LaunchSpec['appSessionId'] }) => void; // E1: `show_pane` asks the windows (maws.pane.show)
  // E2 start: the store wrote a record (deliverables.changed); `artifact_screenshot` asks main to capture (maws.artifact.capture)
  deliverableChanged: (change: { appSessionId: LaunchSpec['appSessionId']; id: string; change: DeliverableChange }) => void;
  artifactCapture: (request: ArtifactCaptureRequest & { appSessionId: LaunchSpec['appSessionId'] }) => void;
  // E2 end
  // E4c start: a browser tool asks main (maws.browser.request); the host tells main to stop one (maws.browser.cancel)
  browserRequest: (request: BrowserRequest & { appSessionId: LaunchSpec['appSessionId'] }) => void;
  browserCancel: (cancel: { appSessionId: LaunchSpec['appSessionId']; requestId: RequestId }) => void;
  // E4c end
}

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
  // E1: the `maws` MCP server the engine handshakes over `mcp_message`, and the bridge `show_pane` opens panes through
  readonly toolServer: MawsToolServer;
  private readonly panes: PaneBridge;
  private readonly captures: CaptureBridge; // E2: the bridge `artifact_screenshot` asks main through
  private readonly browser: BrowserBridge; // E4c: the bridge the browser tools ask main through
  private readonly askTable: AskTable; // E1 M2: the asks waiting for the human (host memory, G6)
  private askItems = new Map<string, AttentionItem>(); // E1 M4b: the blocking asks' attention items, published with the broker's
  readonly sideQuestions = new SideQuestionLog(); // E3: this process's `/btw` exchanges (host memory, X13)
  private readonly reconnect: boolean;
  private readonly log: (message: string) => void;
  private readonly listeners: { [K in keyof Listeners]: Set<Listeners[K]> } = { events: new Set(), status: new Set(), brokerItems: new Set(), queue: new Set(), exited: new Set(), catalog: new Set() /* C7 */, models: new Set() /* C10 */, paneShow: new Set() /* E1 */, deliverableChanged: new Set(), artifactCapture: new Set() /* E2 */, browserRequest: new Set(), browserCancel: new Set() /* E4c */ };
  private readonly pendingWarnings: NormalizerWarning[] = [];
  private readonly stderrTail: string[] = [];
  private readonly storeWrites = new Set<Promise<void>>();
  private readonly launchedAt = new Date().toISOString();

  private transport: EngineTransport | null = null;
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
    this.tracker = new SessionStatusTracker(opts.spec, () => this.touch());
    this.surface = new SessionSurface({ log: this.log, touch: () => this.touch() }); // R2
    // E1 start: served from construction on, since the engine's MCP handshake begins before initialize is answered (E0a Q1)
    this.panes = new PaneBridge({ show: (request) => this.emit('paneShow', { appSessionId: opts.spec.appSessionId, ...request }), hasClient: opts.hasClient /* E10 */ });
    this.captures = new HostBridge({ send: (request) => this.emit('artifactCapture', { appSessionId: opts.spec.appSessionId, ...request }), answerMs: CAPTURE_ANSWER_MS, hasClient: opts.hasClient /* E10 */ }); // E2
    const announce: OnDeliverableWritten = (record, change) => this.emit('deliverableChanged', { appSessionId: record.appSessionId, id: record.id, change }); // E2
    // E4c start: a deadline paused while main waits on the person or a cover; main told to stop what no one awaits
    this.browser = new BrowserBridge({
      send: (request) => this.emit('browserRequest', { appSessionId: opts.spec.appSessionId, ...request }),
      cancel: (requestId) => this.emit('browserCancel', { appSessionId: opts.spec.appSessionId, requestId }),
      connected: opts.hasClient,
      onClientGone: opts.onClientGone,
    });
    // E4c end
    this.askTable = new AskTable({
      onChange: () => {
        this.publishAsks(); // E1 M4b
        this.touch();
      },
    });
    this.toolServer = new MawsToolServer({
      tools: mawsTools({
        deliverables: opts.deliverables?.(announce) ?? new MemoryDeliverableStore({ onWritten: announce }), bridge: this.panes, capture: this.captures /* E2 */,
        asks: this.askTable, askCancelled: (ask, reason) => this.askCancelled(ask, reason),
        browser: this.browser, userData: opts.userData ?? tmpdir() /* E4c */,
      }),
      respond: (requestId, response, writeOpts) => this.respond(requestId, response, writeOpts),
      cwd: () => this.tracker.engineCwd ?? this.spec.cwd,
      appSessionId: opts.spec.appSessionId,
      version: opts.appVersion ?? 'unknown',
      log: this.log,
      onChange: () => this.touch(),
    });
    // E1 end
    this.normalizer = new Normalizer({ appSessionId: opts.spec.appSessionId, launchId: opts.plan.launchId, sessionId: opts.plan.sessionId, warn: (w) => this.pendingWarnings.push(w) });
    this.broker = new PermissionBroker({
      appSessionId: opts.spec.appSessionId,
      client: { respond: (requestId, response, opts) => (this.client ? this.client.respond(requestId, response, opts) : Promise.reject(new Error('no engine process'))) },
      meta: (frame) => this.record('meta', frame),
      onAttention: (items) => {
        this.emit('brokerItems', [...items, ...this.askItems.values()]); // E1 M4b: with the blocking asks'
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
      meta: (frame) => this.record('meta', frame),
      // a host sequence that writes its own prompts (clear and implement) holds the queue like an open turn, and so does a
      // prompt written but not yet started (a `now` steer preempts the running turn and runs next: M6 live 3.7)
      turnOpen: () => this.processState !== 'exited' && (this.normalizer.state.currentTurn !== null || this.normalizer.state.unstartedPrompts.size > 0 || this.clearAndImplement.holding),
      canWrite: () => this.processState === 'ready',
      cancel: async (messageUuid) => (await cancelAsyncMessage(this.readyClient(), { message_uuid: messageUuid })).cancelled === true, // W1
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
    await this.queue.pause('interrupt');
    if (opts.holdEngineQueued) await this.queue.holdAll();
    const response: InterruptResponse = await interrupt(client, { reason: 'user-cancel', cancel_queued: opts.cancelEngineQueued });
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

  // E1: a window's answer to a `show_pane` (`maws.pane.answer`); the first one wins.
  answerPane(requestId: RequestId, result: MawsPaneAnswerResult): 'delivered' | 'not_pending' {
    return this.panes.answer(requestId, result);
  }

  // E2: main's answer to an `artifact_screenshot` capture (`maws.artifact.captured`); the first one wins.
  answerCapture(requestId: RequestId, result: MawsArtifactCapturedResult): 'delivered' | 'not_pending' {
    return this.captures.answer(requestId, result);
  }

  // E4c start: main's answer to a browser tool's request (`maws.browser.answer`), the first one wins; and its report
  // that the request waits on the person or a cover, or no longer does (`maws.browser.waiting`), which pauses or
  // re-arms the request's deadline.
  answerBrowser(requestId: RequestId, result: MawsBrowserAnswerResult): 'delivered' | 'not_pending' {
    return this.browser.answer(requestId, result);
  }

  browserWaiting(requestId: RequestId, waiting: BrowserWaitReason | null): 'delivered' | 'not_pending' {
    return this.browser.waiting(requestId, waiting);
  }
  // E4c end

  // E1 M2: the asks waiting for the human (`maws.asks.list`), pending or being answered.
  asks(): PendingAsk[] {
    return this.askTable.list();
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

  // E1 M2 (residue 12): the human's answers to one ask (`maws.ask.answer`), checked against its questions first (a
  // mismatch throws AskAnswerMismatch and writes nothing), then claimed, written, and committed only once the write
  // settled: a blocking ask's call is answered with the AskResult (committed at the flushed row), an async ask's answers
  // go as a `next` steer whose write carries `maws_ask_answered` as its preface. A refused write releases the ask
  // (`write_failed`, still pending, so the human can retry); a live journal failure does not (answerNotWritten); an exit
  // meanwhile cancels it with the rest.
  async answerAsk(askId: string, answers: AskAnswer[]): Promise<'delivered' | 'not_pending' | 'write_failed'> {
    const held = this.askTable.get(askId);
    if (held === null) return 'not_pending';
    const problem = askAnswersProblem(held.questions, answers);
    if (problem !== null) throw new AskAnswerMismatch(`ask ${askId}: ${problem}`);
    const ask = this.askTable.claim(askId);
    if (ask === null) return 'not_pending';
    this.markUsed();
    if (ask.blocking) {
      const result: AskResult = { status: 'answered', askId, answers };
      const written = toolText(result);
      try {
        await this.toolServer.reply(ask.requestId, written, { flushed: () => this.askTable.commit(askId, written) });
      } catch (error) {
        return this.answerNotWritten(askId, error);
      }
      this.askTable.commit(askId, written); // a client that does not call `flushed` still ends committed
      return 'delivered';
    }
    // the meta row rides the steer's own write as its preface: journaled just before the steer's row, and only if the
    // write succeeded, under the writer's journal-failure handling
    try {
      await this.queue.steer(askSteerText(askId, ask.questions, answers), { priority: 'next', preface: [{ event: 'maws_ask_answered', askId, toolUseId: ask.toolUseId, answers }] });
    } catch (error) {
      return this.answerNotWritten(askId, error);
    } finally {
      this.touch();
    }
    this.askTable.commit(askId);
    return 'delivered';
  }

  // E1 M2: an answer whose write failed. A refused write releases the ask for a retry. A journal failure while live
  // (the frame may have reached the engine, only its row is missing) leaves it claimed: the writer has already ended
  // the process through the journal-failure path, a retry could deliver the answers twice, and the exit cancels it.
  private answerNotWritten(askId: string, error: unknown): 'write_failed' {
    if (!(error instanceof JournalWriteFailed)) this.askTable.release(askId);
    return 'write_failed';
  }

  // E1 M2: an ask nobody will answer any more (the engine withdrew its call, or the process ended): journaled, since no
  // frame carries the fact.
  private askCancelled(ask: PendingAsk, reason: AskCancelReason): void {
    try {
      this.record('meta', { event: 'maws_ask_cancelled', askId: ask.askId, toolUseId: ask.toolUseId, reason });
    } catch (error) {
      this.log(`maws_ask_cancelled for ${ask.askId} not journaled: ${messageOf(error)}`);
    }
  }

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

  // E8 (D-13): a successful reload_plugins answer, published as the status an init frame would publish.
  noteReload(answer: ReloadPluginsResponse): void {
    this.tracker.applyReload(answer);
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

  // The session's attention list: the broker's items, then the blocking asks' (E1 M4b).
  brokerItems(): AttentionItem[] {
    return [...this.broker.snapshot(), ...this.askItems.values()];
  }

  // E1 M4b (the architect's ruling 1): the attention list again whenever the blocking asks held changed (one opened,
  // was answered or was cancelled); an async ask, or a claim or release that leaves the set alone, publishes nothing.
  // An item is built once per ask, so its fields never move between publications.
  private publishAsks(): void {
    const blocking = this.askTable.list().filter((ask) => ask.blocking);
    if (blocking.length === this.askItems.size && blocking.every((ask) => this.askItems.has(ask.askId))) return;
    this.askItems = new Map(blocking.map((ask) => [ask.askId, this.askItems.get(ask.askId) ?? askAttentionItem(ask, this.spec.appSessionId, this.normalizer.state.sessionId)]));
    this.emit('brokerItems', this.brokerItems());
  }

  // The command catalogue C7's `session.catalog` answers from (coordinator, C7's asks).
  catalog(): Catalog {
    return this.tracker.catalog();
  }

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
      fastMode: tracked.fastMode, plugins: tracked.plugins, pluginErrors: tracked.pluginErrors, pluginWarnings: tracked.pluginWarnings,
      backgroundTasks: tracked.backgroundTasks, grants: [...this.grants.allow], mcpServers: tracked.mcpServers, heldPeerMessages: tracked.heldPeerMessages,
      pendingRequests: this.broker.live + (this.client?.pending ?? 0) + this.toolServer.inFlight + this.askTable.asyncCount /* E1 */, queue: { length: this.queue.queuedCount, paused: this.queue.isPaused },
      keepAlive: [], busy: this.busy, lastUsedAt: this.lastUsedAt, // C12: keepAlive from the hard reasons below
      memory: tracked.memory,
      journalPath: this.journal.path, hostHooks: this.hooks.ids(), lastEventSeq: this.lastEventSeq,
      trust: { attested: this.spec.trust !== null, recorded: this.trustRecorded }, // C10
      ...(this.surface.attached && { uiSurface: { clientId: this.surface.clientId } }), // R2
    };
    // C12: what an exit would lose, by the budget policy's rules (an exited process holds nothing)
    if (status.process !== 'exited') status.keepAlive = hardReasons(status, this.opts.statefulMcpServers?.() ?? NO_SERVERS);
    return status;
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
    const events = this.normalizer.push(row);
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
    await this.loadState();
    // The launch's first status (`starting`) goes out before its first row (a resume's `reconnect`, the spawn row, a
    // spawn failure's exit), so a consumer folding events only under a live status never sees a launch's events
    // against no status or the previous launch's `exited` (C5's second re-check). Emitted after the state load's await,
    // where the first status went before, so the launch command's answer still goes out ahead of it.
    this.touch();
    if (this.stopReason !== null || this.processState === 'exited') {
      this.handleExit({ code: null, signal: null }); // stopped while the state loaded: never spawn (idempotent)
      return;
    }
    if (this.reconnect) this.record('meta', { event: 'reconnect', phase: 'attempting', ...this.attempt, trigger: this.reconnectTrigger, reason: this.spec.retry?.reason ?? null });
    if (this.spec.retry) this.notice('launch:retry', `${this.spec.retry.reason} Trying once more (attempt ${this.spec.retry.attempt} of ${this.spec.retry.maxAttempts}).`); // C3 corrective
    this.record('meta', spawnMeta(this.plan, { appVersion: this.opts.appVersion ?? 'unknown' }));
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
    const client = new ControlClient(transport, { row: (direction, frame) => this.record(direction, frame) }, this.plan.launchId, { warn: this.log, writer });
    this.client = client;
    client.onInbound((req) => this.inbound(req));
    client.onInboundCancel((requestId) => this.toolServer.cancel(requestId)); // E1: the engine withdrew a tool call
    // A late read applied nothing, and a host-issued one (the gateway and context reads) showed no error to anyone: only a
    // late mutation gets the notice (debt wave 3 review).
    client.onLateResponse((late) => {
      if (requestClassOf(late.subtype) === 'read') return;
      this.record('meta', { event: 'notice', level: 'warning', key: `late_response:${late.subtype}:${late.requestId}`, text: `${late.subtype} answered after its deadline; it may have applied after the error you saw.` });
    });
    const reading = this.readLoop(transport);
    const draining = this.stderrLoop(transport);
    void Promise.all([reading, draining])
      .then(() => transport.exited)
      .then((exit) => this.handleExit(exit))
      .catch((error: unknown) => this.log(`exit not handled: ${messageOf(error)}`));
    this.setProcess('initializing');
    this.touch();
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

    const request = appInitialize(this.spec.trust ?? undefined);
    const hooks = this.hooks.forInitialize();
    if (hooks) request.hooks = hooks;
    let init;
    try {
      init = await initialize(client, request, {
        onWritten: (requestId) => {
          this.initializeId = requestId;
          this.extendInitialize(); // hook frames read while the write was in flight
        },
      });
    } catch (error) {
      this.initializeFailed(error);
      return;
    }
    if (this.processState !== 'initializing') return;
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

    await this.verifyGateway();
    await this.fallBackFromAuto(client, init); // W3
    if ((this.spec.resume !== null || this.inheritedGrants /* C10 */) && this.grants.allow.length > 0 && this.processState === 'initializing') {
      try {
        await reapply(client, this.grants);
      } catch (error) {
        this.notice('grants:reapply_failed', `Session grants could not be re-applied after the resume: ${messageOf(error)}`);
      }
    }
    if (this.processState !== 'initializing') return;
    try {
      await this.queue.recover();
    } catch (error) {
      // a queue that cannot be loaded or saved is an initialization failure, never a live process stuck initializing (M4 review)
      this.initializeFailed(new Error(`the session's queue could not be recovered: ${messageOf(error)}`));
      return;
    }
    if (this.processState !== 'initializing') return;
    this.setProcess('ready');
    void this.sampleContext(); // `ctx` from the start, a resume's whole context included, not only after the first turn
  }

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

  // The grant snapshot (unless the caller passed one) and the launch spec, from and to the SessionStateStore.
  private async loadState(): Promise<void> {
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
      this.heard();
      if (this.writer?.busy || this.held.length > 0) this.held.push(item);
      else this.processItem(item);
    }
    // Stdout EOF and a write's callback are independent (M3 re-review 2): wait for outstanding writes to settle
    // before releasing what they hold. Once the process has exited, or after EOF_WRITE_WAIT_MS with the process still
    // alive (a wedged child), settle the rest as write_failed, so no response row precedes its request row, no out
    // row can follow the exit row, and a wedged child is ended through the ladder instead of holding the session open.
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
    if (!processExited) void this.terminate(false);
  }

  private drainHeld(force = false): void {
    while (this.held.length > 0 && (force || !this.writer?.busy)) this.processItem(this.held.shift()!);
  }

  // A frame the journal could not take is never acted on (no request reaches the broker, no response settles a
  // request): the journal no longer records what the engine said, so the process ends as for a failed out row.
  private processItem(item: TransportItem): void {
    try {
      if (item.error) {
        this.transportProblem(item.error);
        return;
      }
      const row = this.record('in', item.frame);
      const frame = item.frame as Frame;
      if (!this.handshakeDone) this.hookBeforeAnswer(frame);
      this.tracker.observe(frame, typeof frame.timestamp === 'string' ? frame.timestamp : row.at);
      if (frame.type === 'system') this.publishCatalog(); // C7: only system/init and system/commands_changed move the catalogue
      // R2: an init that advertises the surface after an initialize answer that did not
      if (this.handshakeDone && this.client && frame.type === 'system' && frame.subtype === 'init' && Array.isArray(frame.capabilities)) void this.surface.attach(this.client, frame.capabilities as string[]);
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
    for await (const line of transport.stderr) {
      this.heard();
      this.stderrTail.push(line);
      if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift();
      try {
        this.record('stderr', { text: line });
      } catch (error) {
        this.log(`stderr line not journaled: ${messageOf(error)}`);
      }
    }
  }

  private transportProblem(problem: TransportProblem): void {
    switch (problem.kind) {
      case 'parse_error':
        this.record('meta', { event: 'parse_error', message: problem.message, length: problem.length, typeGuess: problem.typeGuess });
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
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Inbound requests

  private inbound(req: ControlRequestFrame): void {
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
        this.toolServer.accept(req);
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
    for (const event of events) {
      if (event.parentToolUseId !== null) continue;
      if (event.kind === 'turn.started') {
        this.tracker.turnStarted(event.id);
      } else if (event.kind === 'turn.ended' && !event.isEchoReceipt) {
        this.lastUsedAt = new Date().toISOString(); // C12: a turn's end is use, on the host's clock like every other (the status goes out with the frame's touch)
        // the queue first: while a host sequence (clear and implement) still holds the session, it releases nothing
        this.queue.onTurnEnded(event).catch((error: unknown) => this.log(`queue release failed: ${messageOf(error)}`));
        if ((event.origin === 'human' || event.origin === null) && this.processState === 'ready') void this.verifyGateway();
        if (this.processState === 'ready') void this.sampleContext();
        this.clearAndImplement.turnEnded(!event.isError && event.result === 'success');
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
      this.log(`get_status failed: ${messageOf(error)}`);
      return;
    }
    if (this.processState === 'exited') return;
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
  // into `context.sample` from its journal row; a failed read samples nothing and the last sample stands.
  private async sampleContext(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await getContextUsage(client, { detail: 'summary' });
    } catch (error) {
      this.log(`get_context_usage failed: ${messageOf(error)}`);
    }
  }

  // C3 corrective: the reconnect rows' attempt, main's retry of a silent resume (`spec.retry`) or the one attempt
  private get attempt(): { attempt: number; maxAttempts: number } {
    return { attempt: this.spec.retry?.attempt ?? 1, maxAttempts: this.spec.retry?.maxAttempts ?? 1 };
  }

  // C12: `process_exit` for the first launch of an id after its release (the process table's released ids), else `user`
  private get reconnectTrigger(): 'user' | 'process_exit' {
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
    if (this.hooksBeforeAnswer === null || this.initializeId === null) return;
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
  private initializeFailed(error: unknown): void {
    if (this.processState !== 'initializing') return; // exited before the response (handled at the exit) or stopped
    this.writeInitFailed(messageOf(error), error instanceof ControlError ? error.code : null);
    void this.terminate(false);
  }

  private writeInitFailed(message: string, code: string | null): void {
    this.initFailed = true;
    const detail = this.stderrTail.length > 0 ? `${message}\n${this.stderrTail.join('\n')}` : message;
    this.record('meta', { event: 'init_failed', message: detail, code });
    if (this.reconnect) this.record('meta', { event: 'reconnect', phase: 'failed', ...this.attempt, trigger: this.reconnectTrigger, reason: detail });
  }

  // The process's one ladder (session-ladder.ts); with no process yet it answers the stop result at once.
  private terminate(endSessionFirst: boolean, graceMs?: number): Promise<StopResult> {
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
    this.heard(); // C3 corrective: the bound ends with the process
    if (!this.handshakeDone && !this.initFailed && this.stopReason === null) this.writeInitFailed('the process exited before answering initialize', 'exited');
    const reason: ExitReason = this.stopReason ?? (this.initFailed ? 'crash' : exit.code === 0 && exit.signal === null ? 'unknown' : 'crash');
    const { lost: lostApprovals } = this.broker.processExited();
    // E1 M5 fix: a blocking ask still published is attention lost like a pending AskUserQuestion (the architect's ruling
    // 1), counted before the tool server aborts it; `lostAskCount` names the asks among them (absent when none)
    const lostAsks = this.askItems.size;
    const lost = lostApprovals + lostAsks;
    // E1: every tool call in flight is aborted (no pipe takes its answer) and every pane request settles
    this.toolServer.processExited(); // a blocking ask's call aborts with it, cancelling the ask (meta row)
    this.panes.processExited();
    this.captures.processExited(); // E2
    this.browser.processExited(); // E4c: main told to stop each; the bridge stops following the app
    for (const ask of this.askTable.cancelAll('exit')) this.askCancelled(ask, 'exit'); // E1 M2: the async asks, before the exit row
    this.sideQuestions.processExited(new Date().toISOString()); // E3: no answer comes once the process is gone
    this.client?.close('the process exited');
    this.clearAndImplement.processExited();
    this.bashMode.processExited();
    this.surface.processExited(); // R2
    this.tracker.dispose();
    // A process that never became ready never loaded the queue: nothing of this launch is in it to retire.
    const queueSettled = this.handshakeDone ? this.queue.onProcessExited(reason) : Promise.resolve();
    queueSettled.catch((error: unknown) => this.log(`queue not settled at exit: ${messageOf(error)}`));
    const release = reason === 'budget' ? this.release : null; // C12
    try {
      this.record('meta', { event: 'exit', code: exit.code, signal: exit.signal, reason, lostAttentionCount: lost, ...(lostAsks > 0 ? { lostAskCount: lostAsks } : {}), peakTreeRssKiB: this.tracker.peakTreeRssKiB, budget: release /* C12 */ });
    } catch (error) {
      this.log(`exit not journaled: ${messageOf(error)}`);
    }
    this.exitInfo = { code: exit.code, signal: exit.signal, reason, at: new Date().toISOString(), release };
    this.setProcess('exited');
    this.journalClosed = true;
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
