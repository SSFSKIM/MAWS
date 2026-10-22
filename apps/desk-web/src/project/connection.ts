// One open project: its log (kept and verified by `ProjectLog`), its live state from the session plane — presence per
// session, machines, the pending set, the hub's refusals — the conversation's state (`Conversation`: requests,
// deliveries, RPCs, the outbox, compactions, a command's op), and the socket that feeds them. The socket starts only once the browser's
// record is read, so its first resume is after the last offset the record holds. What the web issues — a `human`, an
// RPC — is sealed here with the org key (DX1, DX6) and never leaves unsealed. A session's message or question arriving
// live is timed from its `ts` until it is verified and drawn (`latency/latency.ts`), and so are an RPC until its
// result, the project from its start until its backlog is caught up and verified, and the socket from a drop, from the
// tab shown again, or from the browser back online, until it is caught up and verified after the reconnect.
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  inputSha256,
  newNonce,
  seal,
  sealRpc,
  verify,
  type Delivery,
  type HumanDraft,
  type MachinePresence,
  type OrgKey,
  type PendingRequest,
  type ProjectDown,
  type Raised,
  type Recipient,
  type RpcArgs,
  type RpcDraft,
  type RpcName,
  type SessionMessage,
  type SessionPresence,
  type Settled,
} from 'desk-hub/protocol';
import { latency, RETURN_WINDOW_MS } from '../latency/latency';
import type { LogRecord } from '../log/record';
import { ProjectLog, type ProjectLogState } from '../log/project-log';
import { HumanRefused, ProjectClient, type ConnectionStatus } from '../hub/project-client';
import { Conversation, type RequestRecord } from './conversation';

const JS_HEARTBEAT_MS = 2_000;
const SUSPENSION_GAP_MS = 10_000;

export type LiveState = {
  status: ConnectionStatus;
  /**
   * The hub has welcomed this connection and not dropped it since: only then is an RPC sent, and only then do the
   * controls that act on presence act (presence and the pending set from before a drop may no longer hold).
   */
  connected: boolean;
  /** The backlog after the latest resume has arrived. */
  caughtUp: boolean;
  /** The most recent completed join replay (including command ops), kept across drops for terminal receipt fallback. */
  caughtUpAt: number | null;
  presence: Record<string, SessionPresence>;
  machines: Record<string, MachinePresence>;
  /** The pending set as the hub sent it, each request's code checked; only a verified one is drawn or counted. */
  pending: Array<PendingRequest & { verified: boolean }>;
  /**
   * The project's audit record as this tab has seen it, by entry id (an entry seen twice is kept once): the hub's own
   * refusals and the daemons' rejections of events they were sent.
   */
  audit: AuditItem[];
};

export type AuditItem =
  | { kind: 'refused'; entry: Extract<ProjectDown, { t: 'refused' }>['refusal'] }
  | { kind: 'rejected'; entry: Extract<ProjectDown, { t: 'rejected' }>['rejection'] };

export type ConnectionOptions = { base: string; record: LogRecord; delay?: (attempt: number) => number };

export class NoKey extends Error {
  constructor() {
    super('this browser holds no org key');
  }
}

export class ProjectConnection {
  readonly log: ProjectLog;
  readonly live: StoreApi<LiveState> = createStore<LiveState>(() => ({ status: 'connecting', connected: false, caughtUp: false, caughtUpAt: null, presence: {}, machines: {}, pending: [], audit: [] }));
  readonly conversation: Conversation;
  readonly client: ProjectClient;
  private key: OrgKey | null = null;
  private started = false;
  private stopped = false;
  private pendingRaw: PendingRequest[] = [];
  /** The hub's head at the latest `welcome`: a request seen before the backlog is in belongs at least there. */
  private head = 0;
  /** Live log events from a session, by offset, with their `ts`, until they verify and are drawn (`latency.ts`). */
  private readonly untold = new Map<number, number>();
  /** When the project started (`latency.ts`'s project open), until its first catch-up. */
  private startedAt: number | null = null;
  /** When the welcomed socket dropped (`latency.ts`'s socket gap), until it is caught up again. */
  private droppedAt: number | null = null;
  /** The tab shown again or the browser back online (`latency.ts`): when, and whether a reconnect after it was welcomed. */
  private returned: { kind: 'wake' | 'online'; at: number; welcomed: boolean } | null = null;
  /**
   * The offset the latest catch-up reached, while its backlog awaits verification: the catch-up's samples are drawn once
   * no entry up to it is pending (a view draws only verified entries). A newer welcome, a drop or a stop clears it, so a
   * catch-up of a superseded connection is never drawn; its starts stay for the next one.
   */
  private caughtUpTo: number | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastPulse = Date.now();
  private frozen = false;

  constructor(
    readonly project: string,
    options: ConnectionOptions,
  ) {
    this.log = new ProjectLog(project, options.record);
    this.conversation = new Conversation(project, () => (this.live.getState().caughtUp ? this.log.held() : Math.max(this.log.held(), this.head)));
    this.client = new ProjectClient({
      base: options.base,
      project,
      delay: options.delay,
      handlers: {
        beforeFrame: this.frameCurrent,
        held: () => this.log.held(),
        welcome: (frame) => {
          this.caughtUpTo = null;
          const back = this.returned;
          if (back) this.returned = performance.now() - back.at <= RETURN_WINDOW_MS ? { ...back, welcomed: true } : null;
          const replaced = this.log.welcome(frame.head);
          this.head = frame.head;
          // Presence from before the drop may no longer hold; until the hub sends it again a session's group reads the
          // log's last `state`, which is the record for exactly that case.
          this.live.setState({ connected: true, caughtUp: false, presence: {} });
          // A hub holding another log (started afresh) reported nothing that belongs to it: the conversation starts over.
          if (replaced) this.conversation.reset();
          this.conversation.restart();
        },
        log: (entries) => {
          // A session's message or question, live (the backlog after a resume is not timed): timed until it is drawn.
          if (this.live.getState().caughtUp)
            for (const { offset, event } of entries) if ((event.kind === 'message' || event.kind === 'question') && !event.writer.startsWith('hub/')) this.untold.set(offset, Date.parse(event.ts));
          this.log.receive(entries);
          for (const { event } of entries) {
            const nonce = (event.mac as { nonce?: unknown } | undefined)?.nonce;
            if (event.kind === 'human' && typeof nonce === 'string') this.conversation.outboxStored(nonce);
          }
        },
        caughtUp: () => {
          this.live.setState({ caughtUp: true, caughtUpAt: Date.now() });
          this.caughtUpTo = this.log.held();
          this.verifiedUp(this.log.store.getState());
        },
        session: (message) => this.session(message),
        machines: (machines) => this.live.setState({ machines: Object.fromEntries(machines.map(({ machine, ...presence }) => [machine, presence])) }),
        pending: (requests) => {
          this.pendingRaw = requests;
          this.conversation.pendingSet(requests);
          void this.checkPending();
        },
        deliveries: (deliveries) => {
          // On connect the hub names no machine for them; a live `delivery` message does.
          for (const delivery of deliveries) this.conversation.delivery(null, delivery);
        },
        // A decision this tab may not have seen raised (one settled before it connected, replayed after caught-up): its
        // card is placed after the log as it stood when the hub recorded the decision.
        decided: (decision) => this.conversation.decided(decision, this.log.offsetAt(decision.at)),
        refused: (entry) => this.record({ kind: 'refused', entry }),
        rejected: (entry) => this.record({ kind: 'rejected', entry }),
        status: (status) => {
          if (status === 'connecting') this.caughtUpTo = null;
          if (status === 'connecting' && this.live.getState().connected) this.droppedAt ??= performance.now();
          this.live.setState(status === 'connecting' ? { status, connected: false } : { status });
        },
      },
    });
    this.client.onRpcState((frame) => {
      latency.rpcState(frame.nonce, frame.state);
      this.conversation.rpcState(frame.nonce, frame.state, frame.outcome);
    });
    this.log.store.subscribe((state) => {
      this.told(state);
      this.verifiedUp(state);
    });
  }

  /** The session events awaited that the log now has a verdict on: each verified one is drawn at the next frame. */
  private told(state: ProjectLogState): void {
    if (this.untold.size === 0) return;
    const oldest = Math.min(...this.untold.keys());
    for (let i = state.entries.length - 1; i >= 0 && state.entries[i].offset >= oldest; i--) {
      const { offset, verdict } = state.entries[i];
      const ts = this.untold.get(offset);
      if (ts === undefined || verdict === 'pending') continue;
      this.untold.delete(offset);
      if (verdict === 'ok' && !state.locked) latency.drawn('session.message', ts, true);
    }
    while (this.untold.size > 64) this.untold.delete(this.untold.keys().next().value!);
  }

  /** Reads the browser's record, then opens the socket; a second call does nothing. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.startedAt = performance.now();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.shown);
      this.lastPulse = Date.now();
      this.heartbeat = setInterval(this.pulse, JS_HEARTBEAT_MS);
      document.addEventListener('freeze', this.freezing);
      document.addEventListener('resume', this.resumed);
      addEventListener('pageshow', this.restored);
      addEventListener('online', this.online);
    }
    await this.log.load();
    if (!this.stopped) this.client.start();
  }

  stop(): void {
    this.stopped = true;
    this.caughtUpTo = null;
    this.client.stop();
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.shown);
      document.removeEventListener('freeze', this.freezing);
      document.removeEventListener('resume', this.resumed);
      removeEventListener('pageshow', this.restored);
      removeEventListener('online', this.online);
    }
  }

  // Returns and catch-ups (`latency.ts`).

  private readonly frameCurrent = (): boolean => {
    if (typeof document === 'undefined' || (!this.frozen && Date.now() - this.lastPulse < SUSPENSION_GAP_MS)) return true;
    // Buffered WebSocket tasks can run before both the heartbeat and visibility event. Do not spend that wake
    // window reducing/rendering stale chunks; latch the gap and let a current snapshot replace this generation.
    this.frozen = true;
    if (document.visibilityState === 'visible') this.shown();
    return false;
  };

  private readonly pulse = () => {
    const now = Date.now();
    // WebKit has no freeze/resume events. Latch a wall-clock gap before updating the heartbeat: buffered network
    // callbacks can run before visibilitychange, but cannot erase evidence that JavaScript was suspended.
    if (now - this.lastPulse >= SUSPENSION_GAP_MS) this.frozen = true;
    this.lastPulse = now;
    if (this.frozen && document.visibilityState === 'visible') this.shown();
  };

  private readonly shown = () => {
    if (document.visibilityState !== 'visible') return;
    if (!this.frozen && Date.now() - this.lastPulse < SUSPENSION_GAP_MS) return;
    this.frozen = false;
    this.lastPulse = Date.now();
    this.returned = { kind: 'wake', at: performance.now(), welcomed: false };
    this.client.reconnect();
  };

  private readonly freezing = () => { this.frozen = true; };
  private readonly resumed = () => { this.frozen = true; this.shown(); };
  private readonly restored = (event: PageTransitionEvent) => { if (event.persisted) this.resumed(); };

  private readonly online = () => {
    this.frozen = false;
    this.lastPulse = Date.now();
    this.returned = { kind: 'online', at: performance.now(), welcomed: false };
    this.client.reconnect();
  };

  /**
   * The hub's backlog is in and every entry up to it verified: the project's first catch-up, a dropped socket's, and a
   * return's, each drawn at the next frame.
   */
  private verifiedUp(state: ProjectLogState): void {
    const upTo = this.caughtUpTo;
    if (upTo === null || state.entries.some((e) => e.offset <= upTo && e.verdict === 'pending')) return;
    this.caughtUpTo = null;
    if (this.startedAt !== null) latency.drawn('project.caught-up', this.startedAt, false, this.project);
    if (this.droppedAt !== null) latency.drawn('socket.gap', this.droppedAt, false, this.project);
    if (this.returned?.welcomed) latency.drawn(this.returned.kind === 'wake' ? 'wake.caught-up' : 'online.caught-up', this.returned.at, false, this.project);
    this.startedAt = null;
    this.droppedAt = null;
    if (this.returned?.welcomed) this.returned = null;
  }

  setKey(key: OrgKey | null): void {
    this.key = key;
    this.log.setKey(key);
    this.conversation.setKey(key);
    void this.checkPending();
  }

  // What the web issues.

  /**
   * A web `human` (DX3): sealed by `member`, kept in the outbox until the log holds it (or the hub refuses it), and
   * resent after every reconnect until the hub acknowledges it. Resolves with its nonce once sent.
   */
  async say(member: string, to: '*' | Recipient[], text: string, wake: boolean): Promise<string> {
    const key = this.requireKey();
    const draft: HumanDraft = { kind: 'human', from: 'human', member, to, text, created: new Date().toISOString(), ...(wake && { wake: true }) };
    const event = await seal(key, 'log', this.project, draft);
    const nonce = event.mac.nonce;
    this.conversation.outboxAdd({ nonce, to, text, wake, state: 'sending' });
    this.client.sendHuman(event).catch((error: unknown) => {
      if (error instanceof HumanRefused) this.conversation.outboxRefused(nonce, `${error.refusal.reason}${error.refusal.message ? `: ${error.refusal.message}` : ''}`);
    });
    return nonce;
  }

  /**
   * A sealed DX6 RPC to `machine`; resolves with its nonce (its id) once sent, or once refused as `not-connected` when
   * the project socket is down (nothing is held for later: see `ProjectClient.sendRpc`).
   */
  async rpc<N extends RpcName>(member: string, machine: string, name: N, args: RpcArgs[N], request?: string): Promise<string> {
    const key = this.requireKey();
    const draft = { rpc: name, project: this.project, machine, member, created: new Date().toISOString(), nonce: newNonce(), args } as RpcDraft;
    latency.rpcSent(draft.nonce, name);
    const rpc = await sealRpc(key, draft);
    this.conversation.rpcSent(rpc, request);
    if (!this.client.sendRpc(rpc)) {
      latency.rpcState(rpc.nonce, 'failed');
      this.conversation.rpcNotConnected(rpc.nonce);
    }
    return rpc.nonce;
  }

  /**
   * Runs a slash command in a bridged session (the desk control surface's DX6 `command`): `name` as typed after the
   * slash, `args` the rest (none when blank). `busy`: a turn runs, so the outcome waits for it, and its time is kept
   * apart (`latency.ts`'s `op.ran.busy`).
   */
  async command(member: string, machine: string, session: string, name: string, args: string, busy: boolean, outlives?: string): Promise<string> {
    const nonce = await this.rpc(member, machine, 'command', { session, name, ...(args.trim() && { args: args.trim() }) });
    const state = this.conversation.store.getState().rpcs[nonce]?.state;
    if (state !== 'not-connected' && state !== 'failed') this.conversation.rememberCommand(nonce, machine, session, name, outlives);
    latency.commandSent(nonce, busy);
    return nonce;
  }

  /** Allow or deny a pending permission prompt, with the digest of exactly the request as drawn. */
  async decide(member: string, request: RequestRecord, decision: 'allow' | 'deny', message?: string): Promise<string> {
    const digest = await digestOf(request.raised);
    return this.rpc(member, request.machine, 'decide', { session: request.raised.session, digest, decision, ...(message && { message }) }, request.key);
  }

  /** Answer a pending question, with the digest of exactly the request as drawn. */
  async answer(member: string, request: RequestRecord, answers: Record<string, string>): Promise<string> {
    const digest = await digestOf(request.raised);
    return this.rpc(member, request.machine, 'answer', { session: request.raised.session, digest, answers }, request.key);
  }

  /** Sends an RPC again exactly as it was sealed — the same nonce, the same bytes — as DX6 has a retry do. */
  retryRpc(nonce: string): void {
    const entry = this.conversation.store.getState().rpcs[nonce];
    if (!entry) return;
    this.conversation.retrying(nonce);
    this.client.resendRpc(entry.rpc);
  }

  // Internals.

  private requireKey(): OrgKey {
    if (!this.key) throw new NoKey();
    return this.key;
  }

  private record(item: AuditItem): void {
    this.live.setState((s) => (s.audit.some((a) => a.entry.id === item.entry.id) ? s : { audit: [...s.audit, item].sort((a, b) => a.entry.id - b.entry.id) }));
  }

  private session(message: SessionMessage): void {
    switch (message.kind) {
      case 'presence': {
        const presence = message.body as SessionPresence;
        this.live.setState((s) => ({ presence: { ...s.presence, [message.session as string]: presence } }));
        return;
      }
      case 'machine': {
        const presence = message.body as MachinePresence;
        this.live.setState((s) => ({ machines: { ...s.machines, [message.machine]: presence } }));
        return;
      }
      case 'raised':
        this.conversation.raised(message.machine, message.body as Raised);
        return;
      case 'settled':
        this.conversation.settled(message.machine, message.session as string, message.body as Settled);
        return;
      case 'delivery':
        this.conversation.delivery(message.machine, message.body as Delivery);
        return;
      case 'compact':
        this.conversation.compact(message.session, message.body);
        return;
      case 'op':
        this.conversation.op(message.session, message.body);
        return;
      default:
        return;
    }
  }

  private async checkPending(): Promise<void> {
    const requests = this.pendingRaw;
    const key = this.key;
    const checked = await Promise.all(requests.map(async (r) => ({ ...r, verified: key !== null && (await verify(key, 'raised', this.project, r.raised)) })));
    if (requests === this.pendingRaw && key === this.key) this.live.setState({ pending: checked });
  }
}

/** The digest an answer or a decision carries (DX1): the request as the browser drew it. */
export async function digestOf(raised: Raised) {
  return { session: raised.session, request: raised.request, tool: raised.tool, input_sha256: await inputSha256(raised.input) };
}
