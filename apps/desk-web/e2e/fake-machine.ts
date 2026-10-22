// DC3's fake machine, as the depth acceptance meets it (the DC6 plan's M3): its committed recording (`TWO_SUBAGENTS`,
// a real haiku session through DC2's bridge with two subagents) replayed by its own DX4 producer (`SessionDepth`, the
// fake machine's `session.ts`: subscribe before snapshot, the watermark, a block leaving the snapshot at its
// `block-row`, `step-end`, the subagent tree, `usage`, `diff`, older pages, its race hooks), with DC5's DX3 double
// standing for the hub's relay, which DC3's own G5 suite proves on the local runtime. Every coupling of the browser
// suites to the fake machine is in this file.
//
// `FakeMachine` itself speaks DX2 to a hub, and the desk's gated browser lane has none (DC5's local-hub suite is outside
// the gate, and its first setup is a one-time ceremony per hub state), so this drives the producer without the network
// (accepted by the composite's writer; recomposition's walk covers DX2). The double answers a `diff` request itself, numbered
// on the subscription, so the producer's subscription messages are renumbered by the double (`sendSub`) and the
// double is handed the recording's diff to answer with, as the producer's `diff` would.
//
// DC9 replays `SESSION_VIEW` with `producer: 'dc8'`: the widened `subagents` body, `jobs` and `mcp` in the snapshot and
// as they change, and `output` answered on a subscription from the recording's `tasks/`; the subscription stays open after
// the replayed session ends, answering `rows` and `output`. The defaults (`TWO_SUBAGENTS`, `dc3`) are DC6's.
//
// DC10: it answers a `stop` for its session as the machine does — `unknown-task` for a job its index does not hold as
// running, else `TaskStop`'s call and result written to the job's loop (`SessionDepth.stopJob`), so the job turns
// `stopped` on the session's own body, and `done` — each nonce once, a retry answered from its ledger.
//
// Desk ticket #57: the machine's stream replaced while its lease holds (`replaceStream`, the hub ending its subscriptions
// `machine-offline`), and every snapshot cut to a budget (`budget`), so a reader can page older rows in before it.
//
// The desk control surface's M0, from `producer: 'm0'`: the session's presence carries its bridge's capabilities and the
// machine's its `desk` (`machineDesk`, for the suite's `setMachines`); a `read` is answered on its subscription
// (`SessionDepth.read`); a `command` RPC is answered as the machine answers it — an older producer has no such RPC, a
// session whose bridge lacks the op is `unsupported`, the bridge's route check (`commands`, over the vendored route
// table) refuses it `failed` with its reason, else `queued`, its `op` start and end after it, the end at the turn's end
// when one runs (H-queue), and a rename written to the log as `titled`. A `stale` session (its mod loaded before the
// update) carries no capabilities until `reload`, and `stale` again withdraws them (a presence whose capabilities shrink).
import { Commands, loadRecording, M0_SMINOS, M1_SMINOS, opMessages, producerAtLeast, refusalMessage, SessionDepth, TWO_SUBAGENTS, type CommandPlan, type CommandScript, type Producer, type Recording, type SnapshotOptions, type Step } from 'desk-hub/fake-machine';
import { RPC_NAMES, type DeskCapabilities, type JsonObject, type Raised, type Rpc, type RpcOutcome, type SessionMessage, type TaskOutput } from 'desk-hub/protocol';
import type { HubDouble } from '../test/double/hub-double';

export class FakeMachineReplay {
  readonly recording: Recording;
  readonly depth: SessionDepth;
  /** How many steps of the timeline have been applied. */
  played = 0;
  /** Holds each `rows` request until `releaseRows`, so a suite can look at the view while a page is on its way. */
  holdRows = false;
  private readonly heldRows: Array<{ sub: string; before: string; limit: number }> = [];
  /** An `output` answer a suite puts in the machine's place for a task (a race the recording cannot stage); else none. */
  answerOutput: ((taskId: string) => TaskOutput | null) | null = null;
  /** A stop's outcome a suite puts in the machine's place (the engine's error, a refusal); else the machine's own. */
  answerStop: ((taskId: string) => RpcOutcome | null) | null = null;
  /** Holds each `stop` until `releaseStops`, so a suite can look at the row while it is on its way. */
  holdStops = false;
  private readonly heldStops: Array<Rpc<'stop'>> = [];
  /** The bridge's route check and each command's scripted outcome (`commands.ts`). */
  private readonly commands: Commands;
  /** Commands queued while the main turn runs, finished when it ends (H-queue). */
  private readonly queuedCommands: Array<{ nonce: string; plan: Extract<CommandPlan, { ok: true }> }> = [];
  private readonly producer: Producer;
  /** Each stop's and command's outcome by nonce: a retry is answered from here and never runs anything twice. */
  private readonly ledger = new Map<string, RpcOutcome>();
  /** The next subscription's snapshot hooks (`raceNextSnapshot`'s `advance` and `overlap`) and its scope, used once. */
  private nextSnapshot: { agentId: string | null; options: SnapshotOptions } | null = null;
  /** About how many bytes of rows every snapshot carries (the producer's own budget by default): older rows come as pages. */
  private readonly budget: number | undefined;
  private cursor = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly hub: HubDouble,
    readonly where: { project: string; machine: string },
    options: { recording?: string | Recording; producer?: Producer; budget?: number; commands?: CommandScript; stale?: boolean } = {},
  ) {
    // A recording by its directory, or one a suite built in memory (a recorded one with rows of its own appended).
    this.recording = typeof options.recording === 'object' ? options.recording : loadRecording(options.recording ?? TWO_SUBAGENTS);
    this.budget = options.budget;
    this.producer = options.producer ?? 'dc3';
    this.depth = new SessionDepth(this.recording.session, this.recording, (message) => this.relay(message), where, true, 'main', this.producer);
    this.depth.stale = options.stale ?? false;
    this.commands = new Commands(options.commands, undefined, producerAtLeast(this.producer, 'm1'));
    this.hub.diffs.set(this.recording.session, { base: 'main', text: this.depth.diffText });
    this.timer = setInterval(() => this.poll(), 5);
  }

  get session(): string {
    return this.recording.session;
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** The session's presence as its machine reports it (DX4 `presence`, outside any subscription). */
  sendPresence(): void {
    const { project, machine } = this.where;
    this.hub.sendSession(project, { project, machine, session: this.session, kind: 'presence', sub: null, n: null, body: this.depth.presenceBody() });
  }

  /** What the machine's own presence carries of the desk's controls (an M0 producer's), for the suite's `setMachines`. */
  get machineDesk(): { desk?: DeskCapabilities } {
    return producerAtLeast(this.producer, 'm0') ? { desk: { sminos: producerAtLeast(this.producer, 'm1') ? M1_SMINOS : M0_SMINOS, rpcs: [...RPC_NAMES], reads: [] } } : {};
  }

  /**
   * The session's mod reloaded (`/reload-plugins` typed in its terminal) or, with `stale`, its capabilities withdrawn:
   * its presence says so at once.
   */
  reload(stale = false): void {
    this.depth.stale = stale;
    if (!stale) this.depth.commandCatalog('reload-plugins');
    this.sendPresence();
  }

  /** The recorded question (the ask mod's blocking one), raised on the hub as the machine raised it, `toolUseId` and all. */
  async raiseRecordedQuestion(): Promise<Raised> {
    const step = this.recording.steps.find((s) => s.k === 'raised' && s.draft.tool === 'AskUserQuestion');
    if (step?.k !== 'raised') throw new Error('the recording raised no question');
    return this.hub.raise(this.where.project, this.where.machine, { ...step.draft, session: this.session });
  }

  /** The `message` events the session's machine logged, as recorded (`src` naming the transcript row and span). */
  recordedMessages(): JsonObject[] {
    return this.recording.steps.flatMap((s) => (s.k === 'log' && s.event.kind === 'message' && s.event.session === undefined && String(s.event.writer ?? '').endsWith(this.session) ? [s.event] : []));
  }

  /** Applies the next `count` steps of the timeline. */
  step(count = 1): void {
    for (let i = 0; i < count && this.played < this.recording.steps.length; i++) this.apply(this.recording.steps[this.played++]);
  }

  /** Applies steps through the first one `match` accepts at or after the cursor (all of them when none does). */
  playThrough(match: (step: Step) => boolean = () => false): Step | null {
    while (this.played < this.recording.steps.length) {
      const step = this.recording.steps[this.played++];
      this.apply(step);
      if (match(step)) return step;
    }
    return null;
  }

  /** Answers the `rows` requests held so far; how many there were. */
  releaseRows(): number {
    const held = this.heldRows.splice(0);
    for (const { sub, before, limit } of held) this.depth.page(sub, before, limit);
    return held.length;
  }

  /** How many stops are held, waiting for `releaseStops` (the machine reads the hub's frames every few ms). */
  get stopsHeld(): number {
    return this.heldStops.length;
  }

  /** Answers the stops held so far; how many there were. */
  releaseStops(): number {
    const held = this.heldStops.splice(0);
    for (const rpc of held) this.stopJob(rpc);
    return held.length;
  }

  /** The browser's socket drops: the hub forgets its subscriptions, and so does the machine. */
  drop(): void {
    this.hub.dropConnections();
    this.depth.forgetAll();
  }

  /**
   * The machine's stream to the hub is replaced while its lease holds (a daemon restart, a stale generation): the hub
   * ends each subscription the machine served `machine-offline`, its presence never going offline, and the new stream
   * holds none of them.
   */
  replaceStream(): void {
    const { project } = this.where;
    for (const sub of this.depth.openSubs()) if (this.hub.subscriptions(project).some((s) => s.sub === sub)) this.hub.sendSub(project, sub, 'end', { reason: 'machine-offline' });
    this.depth.forgetAll();
  }

  /** While the next snapshot of `agentId`'s transcript is built, `advance` more steps are applied; with `overlap` the
   * live part is also handed what the snapshot holds (as `raceNextSnapshot` does). */
  raceNextSnapshot(options: { agentId?: string | null; advance?: number; overlap?: boolean }): void {
    this.nextSnapshot = { agentId: options.agentId ?? null, options: { overlap: options.overlap, duringSnapshot: async () => this.step(options.advance ?? 0) } };
  }

  /** The timeline's index of the first chunk of the block whose row is `uuid` (named by its `block-row`). */
  firstChunkOf(uuid: string): number {
    const named = this.recording.steps.find((s) => s.k === 'block-row' && s.body.uuid === uuid);
    if (named?.k !== 'block-row') throw new Error(`no block-row names ${uuid}`);
    const { turnId, agentId, step, index } = named.body;
    return this.recording.steps.findIndex((s) => s.k === 'chunk' && s.turnId === turnId && s.agentId === agentId && s.step === step && s.chunk.index === index);
  }

  /** The main transcript's rows a fresh load at this point draws, by uuid, oldest first. */
  rowsSoFar(agentId: string | null = null): string[] {
    return (this.depth.rows.get(agentId ?? 'main') ?? []).map((row) => row.uuid);
  }

  /** The subscriptions the machine serves, by scope. */
  subscriptions(agentId: string | null = null): number {
    return this.hub.subscriptions(this.where.project).filter((s) => s.session === this.session && s.agentId === agentId && this.depth.holds(s.sub)).length;
  }

  /** What the hub relays: a subscription's messages in the order the producer sent them, numbered by the double. */
  private relay(message: SessionMessage): void {
    if (message.sub === null) return this.hub.sendSession(this.where.project, message);
    if (!this.hub.subscriptions(this.where.project).some((s) => s.sub === message.sub)) return;
    this.hub.sendSub(this.where.project, message.sub, message.kind as never, message.body as never);
  }

  private apply(step: Step): void {
    const running = this.depth.mainTurn;
    this.depth.apply(step);
    if (step.k === 'presence') this.sendPresence();
    if (running !== null && this.depth.mainTurn === null) for (const { nonce, plan } of this.queuedCommands.splice(0)) void this.finishCommand(nonce, plan);
  }

  /** A command the double forwarded, answered as the machine answers it (the module's header). */
  private command(rpc: Rpc<'command'>): void {
    const { project, machine } = this.where;
    if (this.hub.rpcState(project, rpc.nonce) !== 'forwarded') return;
    const known = this.ledger.get(rpc.nonce);
    if (known) return this.hub.answerRpc(project, rpc.nonce, known);
    const failed = (code: 'bad-shape' | 'unsupported' | 'failed', message: string): RpcOutcome => ({ state: 'failed', error: { code, message } });
    let plan: CommandPlan | null = null;
    let outcome: RpcOutcome;
    if (!producerAtLeast(this.producer, 'm0')) outcome = failed('bad-shape', 'no RPC "command"');
    else if (!this.depth.capabilities?.ops.includes('command')) outcome = failed('unsupported', "the session's bridge takes no commands: its plugin loaded before the update");
    else {
      plan = this.commands.plan(rpc.args.name, rpc.args.args ?? '', this.session, machine, this.depth.catalog);
      outcome = plan.ok ? { state: 'done', result: { queued: true, route: plan.route, id: plan.id } } : failed('failed', refusalMessage(plan));
    }
    this.ledger.set(rpc.nonce, outcome);
    this.hub.answerRpc(project, rpc.nonce, outcome);
    if (!plan?.ok) return;
    this.hub.sendSession(project, opMessages(this.where, this.session, rpc.nonce, plan).start);
    if (this.depth.mainTurn !== null) this.queuedCommands.push({ nonce: rpc.nonce, plan });
    else void this.finishCommand(rpc.nonce, plan);
  }

  private async finishCommand(nonce: string, plan: Extract<CommandPlan, { ok: true }>): Promise<void> {
    const { project, machine } = this.where;
    this.hub.sendSession(project, opMessages(this.where, this.session, nonce, plan).end);
    this.depth.commandCatalog(plan.name);
    const { title } = plan.outcome;
    if (title !== undefined) await this.hub.append(project, { writer: `${machine}/${this.session}`, kind: 'titled', session: this.session, title });
  }

  /** A stop the double forwarded (one it failed at once, offline or stale, never reaches a machine). */
  private stopJob(rpc: Rpc<'stop'>): void {
    const { project } = this.where;
    if (this.hub.rpcState(project, rpc.nonce) !== 'forwarded') return;
    let outcome = this.ledger.get(rpc.nonce);
    if (!outcome) {
      const { taskId } = rpc.args;
      outcome =
        this.answerStop?.(taskId) ??
        (this.depth.stopJob(taskId)
          ? { state: 'done', result: { taskId } }
          : { state: 'failed', error: { code: 'unknown-task', message: `${taskId} is not a running job of ${this.session}` } });
      this.ledger.set(rpc.nonce, outcome);
    }
    this.hub.answerRpc(project, rpc.nonce, outcome);
  }

  private poll(): void {
    while (this.cursor < this.hub.up.length) {
      const { project, frame } = this.hub.up[this.cursor++];
      if (project !== this.where.project) continue;
      if (frame.t === 'subscribe' && frame.session === this.session) {
        const raced = this.nextSnapshot?.agentId === frame.agentId ? this.nextSnapshot : null;
        if (raced) this.nextSnapshot = null;
        void this.depth.subscribe(frame.sub, frame.agentId, { budget: this.budget, ...raced?.options });
      } else if (frame.t === 'unsubscribe') this.depth.end(frame.sub, 'unsubscribed');
      else if (frame.t === 'rows') {
        if (this.holdRows) this.heldRows.push({ sub: frame.sub, before: frame.before, limit: frame.limit });
        else this.depth.page(frame.sub, frame.before, frame.limit);
      }
      else if (frame.t === 'rpc' && frame.rpc.rpc === 'stop' && frame.rpc.args.session === this.session) {
        if (this.holdStops) this.heldStops.push(frame.rpc);
        else this.stopJob(frame.rpc);
      }
      else if (frame.t === 'rpc' && frame.rpc.rpc === 'command' && frame.rpc.args.session === this.session) this.command(frame.rpc);
      else if (frame.t === 'read') this.depth.read(frame.sub, frame.id, frame.what);
      else if (frame.t === 'output') {
        const forced = this.answerOutput?.(frame.taskId);
        if (forced) this.hub.sendSub(this.where.project, frame.sub, 'output', forced);
        else this.depth.output(frame.sub, frame.taskId, frame.tail);
      }
    }
  }
}
