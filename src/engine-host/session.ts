// EngineSession (charter §4.1, §4.2, §4.4, §4.6; C3 execution document, Interfaces and M3): the object that wires one
// engine process — transport, control client, normaliser and permission broker — runs the initialize handshake, the
// gateway verification read, grant re-application on a resume and turn tracking, and ends the process through the
// termination ladder. Its one invariant: every row is journaled before it is normalised, and the normaliser is the
// only source of events. Every stdout frame, every frame we write (through `record`, which the control client's sink
// also uses), every stderr line, and the `meta` rows this file writes (spawn, initialize, status check, init_failed,
// reconnect, notices, the normaliser's own warnings, exit) pass through `record`, which journals the row and then
// normalises it; nothing here builds an event. M4 replaces the interim `send` (written at once) with the app queue.
import { randomUUID } from 'node:crypto';
import type { AttentionItem } from '@shared/graph/attention';
import { PERMISSION_MODES, type PermissionMode } from '@shared/graph/enums';
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid, RequestId } from '@shared/graph/ids';
import type { RequestAnswer } from '@shared/engine/answers';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import { HookCallbackRequestSchema, type GetStatusResponse, type InitializeRequest } from '@shared/wire/control';
import type { ControlRequestFrame, UserInputFrame } from '@shared/wire/frames';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import { DECLARED_DIALOG_KINDS, PermissionBroker } from './broker';
import { endSession, getStatus, initialize, setPermissionMode } from './controls';
import { EMPTY_GRANTS, reapply, recordFromResponse, type GrantSnapshot } from './grants';
import { HostHookRegistry } from './host-hooks';
import { RELAY_URL, spawnMeta, type LaunchPlan } from './launch';
import { Normalizer, type NormalizerWarning } from './normalizer';
import { ControlClient, ControlError } from './rpc';
import type { EngineTransport, TransportProblem } from './transport';

export { HostHookRegistry } from './host-hooks';

// The termination ladder's waits (Exit policy): the end_session grace, then SIGTERM, then SIGKILL; 7 s worst case.
export const LADDER_MS = { endSession: 3_000, term: 3_000, kill: 1_000 } as const;
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
  hooks?: HostHookRegistry;
  grants?: GrantSnapshot; // the snapshot to re-apply on a resume (M4 loads it from the SessionStateStore)
  onGrants?: (snapshot: GrantSnapshot) => void; // every change, for persistence (M4)
  reconnect?: boolean; // journal session.reconnect rows; default: a non-fork resume
  appVersion?: string;
  log?: (message: string) => void;
}

export type ExitReason = 'quit' | 'stop' | 'archive' | 'crash' | 'unknown';
export interface ExitSummary { code: number | null; signal: string | null; reason: ExitReason; lostAttentionCount: number }
export interface StopResult { exited: boolean; code: number | null; signal: string | null }
export interface Catalog { commands: unknown[]; agents: unknown[]; skills: unknown[]; terminalSlashCommands: unknown[]; revision: number }

interface Listeners {
  events: (events: SessionEvent[]) => void;
  status: (status: EngineSessionStatus) => void;
  brokerItems: (items: AttentionItem[]) => void;
  exited: (summary: ExitSummary) => void;
}

type ProcessState = EngineSessionStatus['process'];
type Frame = Record<string, unknown> & { type?: unknown; subtype?: unknown };

interface ClearAndImplement { phase: 'awaiting_result' | 'clearing' | 'awaiting_clear'; plan: string; clearUuid: MessageUuid | null }

export class EngineSession {
  readonly exited: Promise<ExitSummary>;
  private resolveExited!: (summary: ExitSummary) => void;
  private readonly spec: LaunchSpec;
  private readonly plan: LaunchPlan;
  private readonly journal: SessionJournal;
  private readonly hooks: HostHookRegistry;
  private readonly normalizer: Normalizer;
  private readonly broker: PermissionBroker;
  private readonly reconnect: boolean;
  private readonly log: (message: string) => void;
  private readonly listeners: { [K in keyof Listeners]: Set<Listeners[K]> } = { events: new Set(), status: new Set(), brokerItems: new Set(), exited: new Set() };
  private readonly eventLog: SessionEvent[] = [];
  private readonly pendingWarnings: NormalizerWarning[] = [];
  private readonly stderrTail: string[] = [];
  private readonly launchedAt = new Date().toISOString();

  private transport: EngineTransport | null = null;
  private client: ControlClient | null = null;
  private starting: Promise<void> | null = null;
  private processState: ProcessState = 'starting';
  private exitInfo: EngineSessionStatus['exit'] = null;
  private stopReason: 'stop' | 'archive' | 'quit' | null = null;
  private handshakeDone = false;
  private initFailed = false;
  private ladder: Promise<StopResult> | null = null;
  private journalClosed = false;
  private lastEventSeq = 0;
  private lastStatusSignature = '';

  // state the frames and the handshake feed into the status
  private engineState: EngineSessionStatus['engineState'] = 'unknown';
  private activity: EngineSessionStatus['activity'] = null;
  private requestedMode: PermissionMode;
  private effectiveMode: PermissionMode;
  private modeKnown = false;
  private prePlanMode: PermissionMode | null = null;
  private resolvedModel: string | null = null;
  private engineVersion: string | null = null;
  private mcpServers: EngineSessionStatus['mcpServers'] = [];
  private gateway: Omit<EngineSessionStatus['gateway'], 'mode'> = { baseUrl: null, verified: 'pending', autoModeServer: 'unknown', localLaneObserved: false };
  private grants: GrantSnapshot;
  private catalogState: Catalog = { commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 0 };
  private clear: ClearAndImplement | null = null;

  constructor(private readonly opts: EngineSessionOptions) {
    this.spec = opts.spec;
    this.plan = opts.plan;
    this.journal = opts.journal;
    this.hooks = opts.hooks ?? new HostHookRegistry();
    this.grants = opts.grants ?? EMPTY_GRANTS;
    this.reconnect = opts.reconnect ?? (opts.spec.resume !== null && !opts.spec.resume.fork);
    this.log = opts.log ?? ((message) => console.warn(`[engine-host ${opts.spec.appSessionId}] ${message}`));
    this.requestedMode = opts.spec.permissionMode ?? 'default';
    this.effectiveMode = this.requestedMode;
    this.exited = new Promise((resolve) => (this.resolveExited = resolve));
    this.normalizer = new Normalizer({ appSessionId: opts.spec.appSessionId, launchId: opts.plan.launchId, sessionId: opts.plan.sessionId, warn: (w) => this.pendingWarnings.push(w) });
    this.broker = new PermissionBroker({
      appSessionId: opts.spec.appSessionId,
      client: { respond: (requestId, response) => (this.client ? this.client.respond(requestId, response) : Promise.reject(new Error('no engine process'))) },
      meta: (frame) => this.record('meta', frame),
      onAttention: (items) => {
        this.emit('brokerItems', items);
        this.touch();
      },
      onGrant: (updates) => {
        const next = recordFromResponse(this.grants, updates);
        if (next === this.grants) return;
        this.grants = next;
        this.opts.onGrants?.(next);
        this.touch();
      },
      sessionId: () => this.normalizer.state.sessionId,
      isExiting: () => this.processState === 'exiting' || this.processState === 'exited',
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Public surface

  on<K extends keyof Listeners>(name: K, listener: Listeners[K]): () => void {
    this.listeners[name].add(listener);
    return () => this.listeners[name].delete(listener);
  }

  // Spawn → initialize → get_status (gateway verification) → grant re-application on a resume → ready. Idempotent;
  // never rejects: a failure is journaled (`init_failed`) and ends the process through the ladder.
  start(): Promise<void> {
    this.starting ??= this.run().catch((error: unknown) => this.log(`start failed: ${messageOf(error)}`));
    return this.starting;
  }

  // M3's interim send: the querying `user` frame is written at once (M4's queue replaces this).
  async send(content: UserInputFrame['message']['content']): Promise<{ messageUuid: MessageUuid }> {
    if (this.processState !== 'ready') throw new Error(`session ${this.spec.appSessionId} is not ready (${this.processState})`);
    return { messageUuid: await this.writeUser(content) };
  }

  async answer(requestId: RequestId, answer: RequestAnswer): Promise<'delivered' | 'not_pending' | 'write_failed'> {
    const item = this.broker.item(requestId);
    const outcome = await this.broker.answer(requestId, answer);
    if (outcome === 'delivered' && answer.kind === 'plan' && answer.outcome === 'clear_and_implement' && item) {
      const plan = (item.request.request.input as { plan?: unknown } | undefined)?.plan;
      this.clear = { phase: 'awaiting_result', plan: typeof plan === 'string' ? plan : '', clearUuid: null };
    }
    return outcome;
  }

  // Ends the process through the termination ladder; `graceMs` (the end_session wait) is capped at 3 s.
  stop(reason: 'stop' | 'archive' | 'quit' = 'stop', opts: { graceMs?: number } = {}): Promise<StopResult> {
    if (this.processState === 'exited') return Promise.resolve(this.stopResult());
    this.stopReason ??= reason;
    return this.terminate(true, Math.min(opts.graceMs ?? LADDER_MS.endSession, LADDER_MS.endSession));
  }

  events(): SessionEvent[] {
    return [...this.eventLog];
  }

  brokerItems(): AttentionItem[] {
    return this.broker.snapshot();
  }

  // The command catalogue C7's `session.catalog` answers from (coordinator, C7's asks).
  catalog(): Catalog {
    return { ...this.catalogState };
  }

  status(): EngineSessionStatus {
    const turn = this.normalizer.state.currentTurn;
    const keepAlive: EngineSessionStatus['keepAlive'] = [];
    if (turn) keepAlive.push('turn');
    if (this.grants.allow.length > 0) keepAlive.push('grants');
    if (this.mcpServers.some((s) => s.status === 'connected')) keepAlive.push('mcp_connected');
    const env = this.plan.env;
    return {
      appSessionId: this.spec.appSessionId, engineSessionId: this.normalizer.state.sessionId ?? this.plan.sessionId, pid: this.transport?.pid ?? null, launchId: this.plan.launchId, launchedAt: this.launchedAt,
      process: this.processState, exit: this.exitInfo, engineState: this.engineState, activity: this.activity,
      turn: turn ? { origin: turn.origin, startedAt: turn.startedAt, acceptedAt: turn.acceptedAt, userMessageUuids: [...turn.userMessageUuids] } : null,
      model: { requested: this.spec.model, resolved: this.resolvedModel }, effort: this.spec.effort,
      permissionMode: { requested: this.requestedMode, effective: this.effectiveMode, refusal: null }, prePlanMode: this.prePlanMode,
      gateway: { mode: this.plan.gateway, ...this.gateway },
      subagentModel: env.CLAUDE_CODE_SUBAGENT_MODEL ?? null,
      modelOverrides: Object.fromEntries(Object.entries(env).filter(([key]) => /^ANTHROPIC_DEFAULT_[A-Z0-9_]+_MODEL$/.test(key))),
      engineVersion: this.engineVersion ?? this.plan.engineVersion, fileCheckpointing: env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING === '1',
      backgroundTasks: [], grants: [...this.grants.allow], mcpServers: [...this.mcpServers], heldPeerMessages: [],
      pendingRequests: this.broker.live, queue: { length: 0, paused: false }, keepAlive,
      memory: { rssKiB: null, treeRssKiB: null, sampledAt: null },
      journalPath: this.journal.path, hostHooks: this.hooks.ids(), lastEventSeq: this.lastEventSeq,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The one path rows take: journal, then normalise, then deliver

  private record(direction: JournalDirection, frame: unknown): JournalRow {
    if (this.journalClosed) throw new Error(`journal closed: ${direction} row not recorded after the exit`);
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
    const client = new ControlClient(transport, { row: (direction, frame) => this.record(direction, frame) }, this.plan.launchId, { warn: this.log });
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
    this.setMode(init.current_permission_mode);
    if (this.spec.permissionMode === null && isPermissionMode(init.current_permission_mode)) this.requestedMode = init.current_permission_mode;
    this.setCatalog({ commands: init.commands, agents: init.agents ?? [] });

    await this.verifyGateway();
    if (this.spec.resume !== null && this.grants.allow.length > 0 && this.processState === 'initializing') {
      try {
        await reapply(client, this.grants);
      } catch (error) {
        this.notice('grants:reapply_failed', `Session grants could not be re-applied after the resume: ${messageOf(error)}`);
      }
    }
    if (this.processState === 'initializing') this.setProcess('ready');
  }

  private async readLoop(transport: EngineTransport): Promise<void> {
    for await (const item of transport.frames) {
      try {
        if (item.error) {
          this.transportProblem(item.error);
          continue;
        }
        this.record('in', item.frame);
        this.track(item.frame as Frame);
        this.broker.observe(item.frame);
        this.client?.observe(item.frame);
        this.touch();
      } catch (error) {
        this.log(`frame not processed: ${messageOf(error)}`);
      }
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
  // What the rows mean for the status, and what the host does next

  private track(frame: Frame): void {
    if (frame.type === 'system') {
      switch (frame.subtype) {
        case 'init': {
          if (typeof frame.parent_tool_use_id === 'string' && frame.parent_tool_use_id.length > 0) return;
          if (typeof frame.model === 'string') this.resolvedModel = frame.model;
          if (typeof frame.claude_code_version === 'string') this.engineVersion = frame.claude_code_version;
          if (typeof frame.permissionMode === 'string') this.setMode(frame.permissionMode);
          if (Array.isArray(frame.mcp_servers)) {
            this.mcpServers = (frame.mcp_servers as { name?: unknown; status?: unknown; source?: unknown }[]).map((s) => ({ name: String(s.name), status: String(s.status), source: typeof s.source === 'string' ? s.source : null }));
          }
          this.setCatalog({ skills: Array.isArray(frame.skills) ? frame.skills : [], terminalSlashCommands: Array.isArray(frame.terminal_slash_commands) ? frame.terminal_slash_commands : [] });
          return;
        }
        case 'status':
          this.activity = frame.status === 'compacting' || frame.status === 'requesting' ? frame.status : null;
          if (typeof frame.permissionMode === 'string') this.setMode(frame.permissionMode);
          return;
        case 'session_state_changed':
          if (frame.state === 'idle' || frame.state === 'running' || frame.state === 'requires_action') this.engineState = frame.state;
          return;
        case 'commands_changed':
          if (Array.isArray(frame.commands)) this.setCatalog({ commands: frame.commands });
          return;
        case 'informational':
          if (typeof frame.content === 'string' && /classifier/i.test(frame.content)) this.gateway.localLaneObserved = true; // the engine's own classifier lane (§19)
          return;
      }
      return;
    }
    if (frame.type === 'stream_event') {
      const delta = (frame.event as { type?: unknown; delta?: { safeguard_results?: unknown } } | undefined)?.delta;
      if (Array.isArray(delta?.safeguard_results) && (delta.safeguard_results as { status?: { type?: unknown } }[]).some((r) => r.status?.type === 'unavailable')) this.gateway.localLaneObserved = true;
    }
  }

  // The pre-plan mode is captured whenever the effective mode moves into plan from a known other mode, from any source
  // (initialize response, system/init, system/status), so clear_and_implement knows what to restore.
  private setMode(mode: string): void {
    if (!isPermissionMode(mode)) return;
    if (mode === 'plan' && this.modeKnown && this.effectiveMode !== 'plan') this.prePlanMode = this.effectiveMode;
    this.effectiveMode = mode;
    this.modeKnown = true;
  }

  private setCatalog(patch: Partial<Omit<Catalog, 'revision'>>): void {
    const next = { ...this.catalogState, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.catalogState)) return;
    this.catalogState = { ...next, revision: this.catalogState.revision + 1 };
  }

  private react(events: SessionEvent[]): void {
    for (const event of events) {
      if (event.kind === 'turn.ended' && event.parentToolUseId === null && !event.isEchoReceipt) {
        if ((event.origin === 'human' || event.origin === null) && this.processState === 'ready') void this.verifyGateway();
        this.advanceClear('turn_ended');
      } else if (event.kind === 'command.lifecycle' && this.clear?.clearUuid === event.commandUuid && TERMINAL_LIFECYCLE.has(event.state)) {
        this.advanceClear('clear_done');
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
    const wasMismatch = this.gateway.verified === 'mismatch';
    this.gateway = { ...this.gateway, baseUrl, autoModeServer, verified };
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
    if (!client || this.processState !== 'ready') return;
    try {
      await setPermissionMode(client, { mode: this.prePlanMode ?? 'default' });
    } catch (error) {
      this.notice('plan:mode_restore_failed', `The mode before plan mode could not be restored: ${messageOf(error)}`);
    }
    if (this.clear !== clear || this.processState !== 'ready') return;
    const uuid = randomUUID() as MessageUuid;
    clear.clearUuid = uuid;
    clear.phase = 'awaiting_clear';
    await this.writeUser('/clear', uuid).catch((error: unknown) => this.log(`/clear not written: ${messageOf(error)}`));
  }

  private async writeUser(content: UserInputFrame['message']['content'], uuid: MessageUuid = randomUUID() as MessageUuid): Promise<MessageUuid> {
    const transport = this.transport;
    if (!transport) throw new Error('no engine process');
    const frame: UserInputFrame = { type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' } };
    this.record('out', frame);
    await transport.write(frame);
    return uuid;
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

  // The OS reported the exit (after stdout and stderr drained): the broker counts its losses, the exit row is
  // journaled with them, and only then is the process `exited` and the reservation free.
  private handleExit(exit: { code: number | null; signal: NodeJS.Signals | null }): void {
    if (this.processState === 'exited') return;
    if (!this.handshakeDone && !this.initFailed && this.stopReason === null) this.writeInitFailed('the process exited before answering initialize', 'exited');
    const reason: ExitReason = this.stopReason ?? (this.initFailed ? 'crash' : exit.code === 0 && exit.signal === null ? 'unknown' : 'crash');
    const { lost } = this.broker.processExited();
    this.client?.close('the process exited');
    this.clear = null;
    this.record('meta', { event: 'exit', code: exit.code, signal: exit.signal, reason, lostAttentionCount: lost });
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

function isPermissionMode(mode: string): mode is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(mode);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
