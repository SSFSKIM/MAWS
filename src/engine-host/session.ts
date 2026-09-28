// EngineSession (charter §4.1, §4.2, §4.4, §4.6; C3 execution document, Interfaces, M3 and M4): the object that wires
// one engine process — transport, control client, normaliser, permission broker, the app queue and `!` mode — runs the
// initialize handshake, the gateway verification read, grant re-application on a resume and queue recovery, and ends
// the process through the termination ladder. Its one invariant: every row is journaled before it is normalised, and
// the normaliser is the only source of events. Every stdout frame, every frame we write (through `record`, which the
// one OutboundWriter per process also uses), every stderr line, and the `meta` rows the host writes (spawn,
// initialize, status check, init_failed, reconnect, queue, notices, the normaliser's own warnings, exit) pass through
// `record`, which journals the row and then normalises it; nothing here builds an event. What the frames say about the
// process lives in SessionStatusTracker (session-status.ts); the queue in MessageQueue (queue.ts).
import { randomUUID } from 'node:crypto';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid, RequestId } from '@shared/graph/ids';
import type { RequestAnswer } from '@shared/engine/answers';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { QueueEntry, QueueState, SendContent, SessionStateStore } from '@shared/engine/session-state-store';
import type { EngineSessionStatus } from '@shared/engine/status';
import { HookCallbackRequestSchema, type GetStatusResponse, type InitializeRequest, type InterruptResponse } from '@shared/wire/control';
import type { ControlRequestFrame, UserInputFrame } from '@shared/wire/frames';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import { BashMode } from './bash-mode';
import { DECLARED_DIALOG_KINDS, PermissionBroker } from './broker';
import { endSession, getStatus, initialize, interrupt, setPermissionMode } from './controls';
import { EMPTY_GRANTS, reapply, recordFromResponse, type GrantSnapshot } from './grants';
import { HostHookRegistry } from './host-hooks';
import { RELAY_URL, spawnMeta, type LaunchPlan } from './launch';
import { Normalizer, type NormalizerWarning } from './normalizer';
import { JournalClosed, OutboundWriter } from './outbound-writer';
import { keepAliveReasons } from './process-table';
import { MessageQueue } from './queue';
import { ControlClient, ControlError } from './rpc';
import { SessionStatusTracker, type Catalog } from './session-status';
import { MemorySessionStateStore } from './store/memory-session-state-store';
import type { EngineTransport, TransportItem, TransportProblem } from './transport';

export { HostHookRegistry } from './host-hooks';
export type { Catalog } from './session-status';

// The termination ladder's waits (Exit policy): the end_session grace, then SIGTERM, then SIGKILL; 7 s worst case.
export const LADDER_MS = { endSession: 3_000, term: 3_000, kill: 1_000 } as const;
// How long stdout's end waits for a write still in flight before failing it and ending the process (M3 re-review 3).
export const EOF_WRITE_WAIT_MS = 3_000;
const STDERR_TAIL_LINES = 20;
const TERMINAL_LIFECYCLE = new Set(['completed', 'cancelled', 'discarded', 'refused']);

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
  appVersion?: string;
  log?: (message: string) => void;
}

export type ExitReason = 'quit' | 'stop' | 'archive' | 'crash' | 'unknown';
export interface ExitSummary { code: number | null; signal: string | null; reason: ExitReason; lostAttentionCount: number }
export interface StopResult { exited: boolean; code: number | null; signal: string | null }
export interface SendResult { messageUuid: MessageUuid | null; disposition: 'sent' | 'queued'; queueId: string; entry: QueueEntry }

interface Listeners {
  events: (events: SessionEvent[]) => void;
  status: (status: EngineSessionStatus) => void;
  brokerItems: (items: AttentionItem[]) => void;
  queue: (queue: QueueState) => void;
  exited: (summary: ExitSummary) => void;
}

type ProcessState = EngineSessionStatus['process'];
type Frame = Record<string, unknown> & { type?: unknown; subtype?: unknown };

// `delivered` settles when the deny response's write settles: the operation is staged before the write so a `result`
// racing the write continuation finds it, and the sequence waits on delivery before sending anything (M3 review).
interface ClearAndImplement { phase: 'awaiting_result' | 'clearing' | 'awaiting_clear'; plan: string; clearUuid: MessageUuid | null; delivered: Promise<boolean> }

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
  private readonly reconnect: boolean;
  private readonly log: (message: string) => void;
  private readonly listeners: { [K in keyof Listeners]: Set<Listeners[K]> } = { events: new Set(), status: new Set(), brokerItems: new Set(), queue: new Set(), exited: new Set() };
  private readonly eventLog: SessionEvent[] = [];
  private readonly pendingWarnings: NormalizerWarning[] = [];
  private readonly stderrTail: string[] = [];
  private readonly launchedAt = new Date().toISOString();

  private transport: EngineTransport | null = null;
  private client: ControlClient | null = null;
  private writer: OutboundWriter | null = null;
  private readonly held: TransportItem[] = []; // inbound frames read while an out write was in flight (M3 re-review)
  private starting: Promise<void> | null = null;
  private processState: ProcessState = 'starting';
  private exitInfo: EngineSessionStatus['exit'] = null;
  private stopReason: 'stop' | 'archive' | 'quit' | null = null;
  private handshakeDone = false;
  private initFailed = false;
  private ladder: Promise<StopResult> | null = null;
  private killed = false; // the ladder reached SIGKILL
  private journalClosed = false;
  private lastEventSeq = 0;
  private lastStatusSignature = '';
  private grants: GrantSnapshot;
  private clear: ClearAndImplement | null = null;
  private pendingPlan: string | null = null; // a clear_and_implement plan kept for retry after the mode restore failed

  constructor(private readonly opts: EngineSessionOptions) {
    this.spec = opts.spec;
    this.plan = opts.plan;
    this.journal = opts.journal;
    this.store = opts.store ?? new MemorySessionStateStore();
    this.hooks = opts.hooks ?? new HostHookRegistry();
    this.grants = opts.grants ?? EMPTY_GRANTS;
    this.reconnect = opts.reconnect ?? (opts.spec.resume !== null && !opts.spec.resume.fork);
    this.log = opts.log ?? ((message) => console.warn(`[engine-host ${opts.spec.appSessionId}] ${message}`));
    this.exited = new Promise((resolve) => (this.resolveExited = resolve));
    this.tracker = new SessionStatusTracker(opts.spec, () => this.touch());
    this.normalizer = new Normalizer({ appSessionId: opts.spec.appSessionId, launchId: opts.plan.launchId, sessionId: opts.plan.sessionId, warn: (w) => this.pendingWarnings.push(w) });
    this.broker = new PermissionBroker({
      appSessionId: opts.spec.appSessionId,
      client: { respond: (requestId, response, opts) => (this.client ? this.client.respond(requestId, response, opts) : Promise.reject(new Error('no engine process'))) },
      meta: (frame) => this.record('meta', frame),
      onAttention: (items) => {
        this.emit('brokerItems', items);
        this.touch();
      },
      onGrant: (updates) => {
        const next = recordFromResponse(this.grants, updates);
        if (next === this.grants) return;
        this.grants = next;
        this.store.saveGrants(this.spec.appSessionId, next).catch((error: unknown) => this.log(`grants not saved: ${messageOf(error)}`));
        this.opts.onGrants?.(next);
        this.touch();
      },
      sessionId: () => this.normalizer.state.sessionId,
      isExiting: () => this.processState === 'exiting' || this.processState === 'exited',
    });
    const writeFrame = (frame: Parameters<OutboundWriter['write']>[0]) => (this.writer ? this.writer.write(frame) : Promise.reject(new Error('no engine process')));
    this.queue = new MessageQueue({
      appSessionId: opts.spec.appSessionId,
      store: this.store,
      write: writeFrame,
      meta: (frame) => this.record('meta', frame),
      // a host sequence that writes its own prompts (clear and implement) holds the queue like an open turn
      turnOpen: () => this.processState !== 'exited' && (this.normalizer.state.currentTurn !== null || this.clear !== null),
      canWrite: () => this.processState === 'ready',
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
    const { entry, disposition } = await this.queue.send(content);
    return { messageUuid: entry.messageUuid, disposition, queueId: entry.queueId, entry };
  }

  steer(content: SendContent): Promise<{ messageUuid: MessageUuid }> {
    return this.queue.steer(content);
  }

  // Pauses the app queue first ("queue paused because you interrupted"), so the turn.ended the interrupt causes
  // releases nothing, then interrupts the engine; `cancelEngineQueued` maps to the engine queue's `cancel_queued`.
  async interrupt(opts: { cancelEngineQueued: boolean }): Promise<{ stillQueued: string[]; cancelled: string[] }> {
    const client = this.readyClient();
    await this.queue.pause('interrupt');
    const response: InterruptResponse = await interrupt(client, { reason: 'user-cancel', cancel_queued: opts.cancelEngineQueued });
    return { stillQueued: [...response.still_queued], cancelled: [...(response.cancelled ?? [])] };
  }

  // `!`: answered at the `bash_command` write; the echo and its receipt follow as events.
  bash(command: string): Promise<{ commandUuid: MessageUuid }> {
    return this.bashMode.run(command);
  }

  async answer(requestId: RequestId, answer: RequestAnswer): Promise<'delivered' | 'not_pending' | 'write_failed'> {
    const item = this.broker.item(requestId);
    if (answer.kind !== 'plan' || answer.outcome !== 'clear_and_implement' || item?.kind !== 'plan' || item.attention.state !== 'pending') return this.broker.answer(requestId, answer);
    const plan = (item.request.request.input as { plan?: unknown } | undefined)?.plan;
    let settle!: (ok: boolean) => void;
    const staged: ClearAndImplement = { phase: 'awaiting_result', plan: typeof plan === 'string' ? plan : '', clearUuid: null, delivered: new Promise((resolve) => (settle = resolve)) };
    const previous = { clear: this.clear, pendingPlan: this.pendingPlan };
    this.clear = staged;
    this.pendingPlan = null;
    let outcome: Awaited<ReturnType<PermissionBroker['answer']>> = 'write_failed';
    try {
      outcome = await this.broker.answer(requestId, answer);
      return outcome;
    } finally {
      settle(outcome === 'delivered');
      if (outcome !== 'delivered' && this.clear === staged && staged.phase === 'awaiting_result') {
        this.clear = previous.clear; // rolled back: the engine never received the deny
        this.pendingPlan = previous.pendingPlan;
      }
      this.touch();
    }
  }

  // Ends the process through the termination ladder; `graceMs` (the end_session wait) is capped at 3 s.
  stop(reason: 'stop' | 'archive' | 'quit' = 'stop', opts: { graceMs?: number } = {}): Promise<StopResult> {
    if (this.processState === 'exited') return Promise.resolve(this.stopResult());
    this.stopReason ??= reason;
    return this.terminate(true, Math.min(opts.graceMs ?? LADDER_MS.endSession, LADDER_MS.endSession));
  }

  // True once the termination ladder had to send SIGKILL (engine.shutdown's `forced` count).
  get forcedKill(): boolean {
    return this.killed;
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

  events(): SessionEvent[] {
    return [...this.eventLog];
  }

  brokerItems(): AttentionItem[] {
    return this.broker.snapshot();
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
    return {
      appSessionId: this.spec.appSessionId, engineSessionId, pid: this.transport?.pid ?? null, launchId: this.plan.launchId, launchedAt: this.launchedAt,
      taskListId: env.CLAUDE_CODE_TASK_LIST_ID ?? engineSessionId ?? null, // C8's ask: the list the engine's task tools read (SPEC 20)
      cwd: this.spec.cwd, pendingPlan: this.pendingPlan,
      process: this.processState, exit: this.exitInfo, engineState: tracked.engineState, activity: tracked.activity,
      // every open turn was opened by a turn.started the tracker saw, so its id is that event's
      turn: turn && turnId ? { id: turnId, origin: turn.origin, startedAt: turn.startedAt, acceptedAt: turn.acceptedAt, userMessageUuids: [...turn.userMessageUuids] } : null,
      model: { requested: this.spec.model, resolved: tracked.resolvedModel }, effort: this.spec.effort,
      permissionMode: tracked.permissionMode, prePlanMode: tracked.prePlanMode,
      gateway: { mode: this.plan.gateway, ...tracked.gateway },
      subagentModel: env.CLAUDE_CODE_SUBAGENT_MODEL ?? null,
      modelOverrides: Object.fromEntries(Object.entries(env).filter(([key]) => /^ANTHROPIC_DEFAULT_[A-Z0-9_]+_MODEL$/.test(key))),
      engineVersion: tracked.engineVersion ?? this.plan.engineVersion, fileCheckpointing: env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING === '1',
      fastMode: tracked.fastMode, plugins: tracked.plugins, pluginErrors: tracked.pluginErrors, pluginWarnings: tracked.pluginWarnings,
      backgroundTasks: tracked.backgroundTasks, grants: [...this.grants.allow], mcpServers: tracked.mcpServers, heldPeerMessages: tracked.heldPeerMessages,
      pendingRequests: this.broker.live, queue: { length: this.queue.queuedCount, paused: this.queue.isPaused },
      keepAlive: keepAliveReasons({ turnOpen: turn !== null, backgroundTasks: tracked.backgroundTasks.length, grants: this.grants.allow.length, mcpServers: tracked.mcpServers, heldPeerMessages: tracked.heldPeerMessages.length }),
      memory: tracked.memory,
      journalPath: this.journal.path, hostHooks: this.hooks.ids(), lastEventSeq: this.lastEventSeq,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The one path rows take: journal, then normalise, then deliver

  private record(direction: JournalDirection, frame: unknown): JournalRow {
    if (this.journalClosed) throw new JournalClosed(`${direction} row`);
    const row = this.journal.row(direction, frame);
    const events = this.normalizer.push(row);
    for (const w of this.pendingWarnings.splice(0)) this.record('meta', { event: w.event, rowSeq: w.seq, detail: w.detail }); // journaled and normalised like any row; they yield no events
    if (events.length > 0) {
      this.lastEventSeq = row.seq;
      this.eventLog.push(...events);
      this.emit('events', events);
      this.react(events);
    }
    return row;
  }

  private async run(): Promise<void> {
    await this.loadState();
    if (this.reconnect) this.record('meta', { event: 'reconnect', phase: 'attempting', attempt: 1, maxAttempts: 1, trigger: 'user', reason: null });
    this.record('meta', spawnMeta(this.plan, { appVersion: this.opts.appVersion ?? 'unknown' }));
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
    writer.onIdle(() => this.drainHeld());
    writer.onJournalFailure((error) => {
      // the journal no longer records what was sent: end the process as for a transport error
      this.log(`journal write failed: ${error.message}; ending the process`);
      void this.terminate(false);
    });
    const client = new ControlClient(transport, { row: (direction, frame) => this.record(direction, frame) }, this.plan.launchId, { warn: this.log, writer });
    this.client = client;
    client.onInbound((req) => this.inbound(req));
    client.onLateResponse((late) =>
      this.record('meta', { event: 'notice', level: 'warning', key: `late_response:${late.subtype}:${late.requestId}`, text: `${late.subtype} answered after its deadline; it may have applied after the error you saw.` }),
    );
    const reading = this.readLoop(transport);
    const draining = this.stderrLoop(transport);
    void Promise.all([reading, draining])
      .then(() => transport.exited)
      .then((exit) => this.handleExit(exit))
      .catch((error: unknown) => this.log(`exit not handled: ${messageOf(error)}`));
    this.setProcess('initializing');
    this.touch();

    const request: InitializeRequest = { supportedDialogKinds: [...DECLARED_DIALOG_KINDS], perTaskStopAffordance: true };
    const hooks = this.hooks.forInitialize();
    if (hooks) request.hooks = hooks;
    if (this.spec.trust) request.workspaceTrust = this.spec.trust;
    let init;
    try {
      init = await initialize(client, request);
    } catch (error) {
      this.initializeFailed(error);
      return;
    }
    if (this.processState !== 'initializing') return;
    this.handshakeDone = true;
    this.record('meta', { event: 'initialize', current_permission_mode: init.current_permission_mode, session_state: init.session_state ?? null, hooks_applied: init.hooks_applied ?? null, workspace_trust_recorded: init.workspace_trust_recorded ?? null });
    if (this.reconnect) this.record('meta', { event: 'reconnect', phase: 'reconnected', attempt: 1, maxAttempts: 1, trigger: 'user', reason: null });
    this.tracker.initialize(init);

    await this.verifyGateway();
    if (this.spec.resume !== null && this.grants.allow.length > 0 && this.processState === 'initializing') {
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
    if (this.processState === 'initializing') this.setProcess('ready');
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
    this.store.saveLaunchSpec(this.spec.appSessionId, this.spec).catch((error: unknown) => this.log(`launch spec not saved: ${messageOf(error)}`));
  }

  // Causal order (M3 re-review): a frame read while one of our writes is in flight may be the engine's reply to it,
  // and the write's own row is journaled only when the write settles; such frames wait in `held` (in memory: stdout is
  // never paused, so the child can always write) and are processed, in arrival order, right after that row.
  private async readLoop(transport: EngineTransport): Promise<void> {
    for await (const item of transport.frames) {
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
  }

  private drainHeld(force = false): void {
    while (this.held.length > 0 && (force || !this.writer?.busy)) this.processItem(this.held.shift()!);
  }

  private processItem(item: TransportItem): void {
    try {
      if (item.error) {
        this.transportProblem(item.error);
        return;
      }
      const row = this.record('in', item.frame);
      const frame = item.frame as Frame;
      this.tracker.observe(frame, typeof frame.timestamp === 'string' ? frame.timestamp : row.at);
      this.broker.observe(item.frame);
      this.bashMode.observe(item.frame);
      this.client?.observe(item.frame);
      this.touch();
    } catch (error) {
      this.log(`frame not processed: ${messageOf(error)}`);
    }
  }

  private async stderrLoop(transport: EngineTransport): Promise<void> {
    for await (const line of transport.stderr) {
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
        // the queue first: while a host sequence (clear and implement) still holds the session, it releases nothing
        this.queue.onTurnEnded(event).catch((error: unknown) => this.log(`queue release failed: ${messageOf(error)}`));
        if ((event.origin === 'human' || event.origin === null) && this.processState === 'ready') void this.verifyGateway();
        this.advanceClear('turn_ended');
      } else if (event.kind === 'command.lifecycle') {
        this.queue.onLifecycle(event);
        if (this.clear?.clearUuid === event.commandUuid && TERMINAL_LIFECYCLE.has(event.state)) this.advanceClear('clear_done');
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
    const autoModeServer = server === 'Enabled' ? 'enabled' : server === 'Disabled' ? 'disabled' : 'unknown';
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

  // Plan outcome "clear context and implement" (Interfaces, Broker): after the plan turn's result, restore the pre-plan
  // mode, send `/clear`, and once /clear's turn has ended (or its command finished) send the plan as a new prompt.
  private advanceClear(trigger: 'turn_ended' | 'clear_done'): void {
    const clear = this.clear;
    if (!clear) return;
    if (clear.phase === 'awaiting_result' && trigger === 'turn_ended') {
      clear.phase = 'clearing';
      void this.runClear(clear);
    } else if (clear.phase === 'awaiting_clear') {
      this.clear = null;
      this.writeUser(`Implement this plan:\n\n${clear.plan}`).catch((error: unknown) => this.log(`plan prompt not written: ${messageOf(error)}`));
    }
  }

  private async runClear(clear: ClearAndImplement): Promise<void> {
    const client = this.client;
    const abandon = () => {
      if (this.clear === clear) this.clear = null;
    };
    if (!(await clear.delivered) || !client || this.processState !== 'ready') return abandon();
    try {
      await setPermissionMode(client, { mode: this.tracker.prePlanMode ?? 'default' });
    } catch (error) {
      // Stop here: sending /clear and the plan would run it in plan mode. The plan stays on the status for a retry.
      this.notice('plan:mode_restore_failed', `The mode before plan mode could not be restored: ${messageOf(error)}`);
      abandon();
      this.pendingPlan = clear.plan;
      this.touch();
      return;
    }
    if (this.clear !== clear || this.processState !== 'ready') return;
    const uuid = randomUUID() as MessageUuid;
    clear.clearUuid = uuid;
    clear.phase = 'awaiting_clear';
    await this.writeUser('/clear', uuid).catch((error: unknown) => this.log(`/clear not written: ${messageOf(error)}`));
  }

  private async writeUser(content: UserInputFrame['message']['content'], uuid: MessageUuid = randomUUID() as MessageUuid): Promise<MessageUuid> {
    const writer = this.writer;
    if (!writer) throw new Error('no engine process');
    const frame: UserInputFrame = { type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' } };
    await writer.write(frame); // journaled once the bytes reached the pipe, `write_failed` otherwise (M3 review)
    return uuid;
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
    if (this.reconnect) this.record('meta', { event: 'reconnect', phase: 'failed', attempt: 1, maxAttempts: 1, trigger: 'user', reason: detail });
  }

  private terminate(endSessionFirst: boolean, graceMs: number = LADDER_MS.endSession): Promise<StopResult> {
    this.ladder ??= this.runLadder(endSessionFirst, graceMs);
    return this.ladder;
  }

  private async runLadder(endSessionFirst: boolean, graceMs: number): Promise<StopResult> {
    const transport = this.transport;
    if (!transport || this.processState === 'exited') return this.stopResult();
    this.setProcess('exiting');
    if (endSessionFirst && this.handshakeDone && this.client) {
      endSession(this.client, { reason: this.stopReason ?? 'stop' }).catch(() => {}); // the exit is the answer that matters
      if (await this.waitExit(graceMs)) return this.stopResult();
    }
    transport.endInput();
    transport.kill('SIGTERM');
    if (await this.waitExit(LADDER_MS.term)) return this.stopResult();
    this.killed = true;
    transport.kill('SIGKILL');
    await this.waitExit(LADDER_MS.kill);
    return this.stopResult();
  }

  private waitExit(ms: number): Promise<boolean> {
    return Promise.race([
      this.exited.then(() => true),
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  }

  private stopResult(): StopResult {
    return { exited: this.processState === 'exited', code: this.exitInfo?.code ?? null, signal: this.exitInfo?.signal ?? null };
  }

  // The OS reported the exit (after stdout and stderr drained): the broker counts its losses, the queue retires what the
  // process took with it (its notices journaled first), the exit row is journaled with them, and only then is the
  // process `exited` and the reservation free.
  private handleExit(exit: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (this.processState === 'exited') return;
    if (!this.handshakeDone && !this.initFailed && this.stopReason === null) this.writeInitFailed('the process exited before answering initialize', 'exited');
    const reason: ExitReason = this.stopReason ?? (this.initFailed ? 'crash' : exit.code === 0 && exit.signal === null ? 'unknown' : 'crash');
    const { lost } = this.broker.processExited();
    this.client?.close('the process exited');
    this.clear = null;
    this.bashMode.processExited();
    this.tracker.dispose();
    // A process that never became ready never loaded the queue: nothing of this launch is in it to retire.
    const queueSettled = this.handshakeDone ? this.queue.onProcessExited(reason) : Promise.resolve();
    queueSettled.catch((error: unknown) => this.log(`queue not settled at exit: ${messageOf(error)}`));
    this.record('meta', { event: 'exit', code: exit.code, signal: exit.signal, reason, lostAttentionCount: lost, peakTreeRssKiB: this.tracker.peakTreeRssKiB });
    this.exitInfo = { code: exit.code, signal: exit.signal, reason, at: new Date().toISOString() };
    this.setProcess('exited');
    this.journalClosed = true;
    void this.journal.close();
    const summary: ExitSummary = { code: exit.code, signal: exit.signal, reason, lostAttentionCount: lost };
    this.resolveExited(summary);
    this.emit('exited', summary);
  }

  // ---------------------------------------------------------------------------------------------------------------------

  private setProcess(state: ProcessState): void {
    if (this.processState === state || this.processState === 'exited') return;
    this.processState = state;
    this.touch();
  }

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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
