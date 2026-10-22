// The project socket (DX3): `/api/projects/<id>/socket`. On every connection, after the hub's `welcome`, it resumes
// after the last offset the browser holds — so a drop, a deploy, or a reload never replays from the start and never
// skips — and sends again everything the hub has not acknowledged: a web `human` until its `human-ack`, an RPC until
// the hub reports its result. A new RPC is refused while the socket is not welcomed; a `human` is held until it is. It
// also serves the session plane (DX8's `SessionPlane`): DX4 subscriptions whose messages reach their listener in order,
// re-subscribed after any discontinuity. The hops of #57's instrument it sees (`latency/latency.ts`: a `human` to its
// acknowledgement and its delivery, the reconnects) are recorded as their frames arrive.
import {
  BROWSER_SET_LIMIT,
  newNonce,
  utf8Length,
  type HumanEvent,
  type PendingRequest,
  type ProjectDown,
  type ProjectUp,
  type Rpc,
  type RpcOutcome,
  type SessionBodies,
  type SessionMessage,
  type LogEvent,
  type Delivery,
  type MachinePresence,
  type JsonObject,
  type JsonValue,
  type ReadAnswer,
  isTaskId,
  OUTPUT_TAIL_MAX,
  SUBSCRIPTION_KINDS,
} from 'desk-hub/protocol';
import { catalogs, catalogKey } from '../state/catalog';
import type { Catalog } from 'desk-hub/protocol';
import { latency } from '../latency/latency';
import { ReadError, type SessionPlane, type SessionTarget, type Subscription, type SubscriptionListener, type SubscriptionMessage } from '../shell/session-plane';
import { backoff, HubSocket, type ConnectionStatus } from './socket';

/** How often a visible tab says so again: a third of the 90 s the hub counts a socket as visible after the last. */
const VISIBLE_REPEAT_MS = 30_000;

/** DX3's `rows` takes a `limit` from 1 to 1000; the hub refuses anything else as `bad-shape`, into the audit record. */
const rowsLimit = (limit: number) => Math.min(1000, Math.max(1, Math.trunc(limit) || 1));

/** DX3's `output` takes a `tail` from 1 to 524288 bytes, refused `bad-shape` otherwise, as `rows`'s `limit` is. */
const outputTail = (tail: number) => Math.min(OUTPUT_TAIL_MAX, Math.max(1, Math.trunc(tail) || 1));

/**
 * A frame the hub would refuse unread: its parts would join past BROWSER_SET_LIMIT (DX3), so the refusal could name no
 * request the frame carried, and the request would wait on. This client ends such a request itself instead, as the hub
 * ends one too large.
 */
const unread = (frame: ProjectUp) => utf8Length(JSON.stringify(frame)) > BROWSER_SET_LIMIT;
const UNREAD_MESSAGE = `not sent: past the ${BROWSER_SET_LIMIT / 2 ** 20} MiB the hub reads from a browser`;

export type { ConnectionStatus } from './socket';

export type Welcome = Extract<ProjectDown, { t: 'welcome' }>;
export type RpcStateFrame = Extract<ProjectDown, { t: 'rpc-state' }>;
export type HumanAck = { offset: number; writer: string; seq: number };
export type HubRefusal = Extract<ProjectDown, { t: 'refused' }>['refusal'];

/**
 * A web `human` the hub refused (its `refused` named the send's nonce), or one too large to send (`too-large`, refused
 * here): it is not stored and is never sent again.
 */
export class HumanRefused extends Error {
  constructor(readonly refusal: Pick<HubRefusal, 'reason' | 'message'>) {
    super(`the message was refused: ${refusal.reason}${refusal.message ? `, ${refusal.message}` : ''}`);
  }
}

export type ProjectHandlers = {
  /** False while a suspended page is replacing this generation; discard it before expensive state dispatch. */
  beforeFrame?(): boolean;
  /** The offset of the last event the browser holds for the project; the client resumes after it. */
  held(): number;
  /** Before the client resumes: the owner may reconcile what it holds with the hub's `head` here. */
  welcome?(frame: Welcome): void;
  log?(entries: Array<{ offset: number; event: LogEvent }>): void;
  caughtUp?(offset: number): void;
  /** DX4 messages outside any subscription: presence, machine, raised, settled, delivery. */
  session?(message: SessionMessage): void;
  pending?(requests: PendingRequest[]): void;
  deliveries?(deliveries: Delivery[]): void;
  machines?(machines: Array<{ machine: string } & MachinePresence>): void;
  /** The hub's own refusals, as its audit record has them. */
  refused?(refusal: HubRefusal): void;
  /** A daemon's report of an event it refused (DX2's `rejected`), as the audit record has it. */
  rejected?(rejection: Extract<ProjectDown, { t: 'rejected' }>['rejection']): void;
  /** A decision on a pending request, as the audit record has it: live, and replayed after every `caught-up`. */
  decided?(decision: Extract<ProjectDown, { t: 'decided' }>['decision']): void;
  status?(status: ConnectionStatus): void;
};

export type ProjectClientOptions = {
  /** The hub's origin as a WebSocket URL (`wss://desk.example`). */
  base: string;
  project: string;
  handlers: ProjectHandlers;
  delay?: (attempt: number) => number;
  frameLimit?: number;
  /**
   * The wait before subscribing again after an `end {discontinuity}` that came first, at `n` 0 (the bridge could not
   * take a snapshot yet), by how many came in a row from 0; the socket's backoff by default.
   */
  resubscribeDelay?: (attempt: number) => number;
  /** How long a read waits for its answer (`READ_TIMEOUT_MS` by default). */
  readTimeoutMs?: number;
};

type OpenSubscription = {
  target: SessionTarget;
  listener: SubscriptionListener;
  sub: string | null;
  next: number;
  /** Discontinuities at `n` 0 in a row: the backoff's attempt. A snapshot resets it. */
  failedStarts: number;
  catalogSent?: number;
  retry: ReturnType<typeof setTimeout> | null;
  /** The reads asked on the sub open now, by id, until each is answered, times out, or the sub is lost. */
  reads: Map<string, PendingRead>;
};

type PendingRead = { what: string; sent: number; resolve: (result: JsonValue) => void; reject: (error: ReadError) => void; timer: ReturnType<typeof setTimeout> };

/** How long a read waits for its answer: the machine's own 10 s (`COMMAND_WAIT_MS`) and the hops (the spec, §5). */
const READ_TIMEOUT_MS = 15_000;

const IN_SUB = new Set<string>(SUBSCRIPTION_KINDS);

export class ProjectClient implements SessionPlane {
  private readonly socket: HubSocket<ProjectDown, ProjectUp>;
  private welcomed = false;
  /** This client has been welcomed before: a welcome after a drop is a reconnect (`latency.ts` counts them). */
  private welcomedBefore = false;
  private visible: boolean | null = null;
  private repeat: ReturnType<typeof setInterval> | null = null;
  private readonly humans = new Map<string, { event: HumanEvent; resolve: (ack: HumanAck) => void; reject: (error: HumanRefused) => void }>();
  /** Called once no `human` is left unacknowledged. */
  private readonly humansSent = new Set<() => void>();
  private readonly rpcs = new Map<string, Rpc>();
  private readonly rpcListeners = new Set<(frame: RpcStateFrame) => void>();
  private readonly subs = new Set<OpenSubscription>();

  constructor(private readonly options: ProjectClientOptions) {
    this.socket = new HubSocket({
      url: `${options.base}/api/projects/${encodeURIComponent(options.project)}/socket`,
      open: () => {},
      frame: (frame) => { if (options.handlers.beforeFrame?.() !== false) this.receive(frame); },
      status: (status) => {
        if (status === 'connecting') this.disconnected();
        options.handlers.status?.(status);
      },
      delay: options.delay,
      frameLimit: options.frameLimit,
    });
  }

  start(): void {
    this.socket.start();
  }

  /** Rotate the wire on wake: welcome replays receipts and every active subscription gets a fresh snapshot. */
  reconnect(): void {
    this.socket.restart();
  }

  stop(): void {
    if (this.repeat !== null) clearInterval(this.repeat);
    this.repeat = null;
    this.socket.stop();
  }

  /**
   * Sends a sealed web `human`. Resolves when the hub has stored it (`human-ack`), sending it again after each reconnect
   * until then; rejects with `HumanRefused` when the hub refuses it, after which it is never sent again, and at once,
   * sending nothing, when the hub would refuse it unread.
   */
  sendHuman(event: HumanEvent): Promise<HumanAck> {
    if (unread({ t: 'human', event })) return Promise.reject(new HumanRefused({ reason: 'too-large', message: UNREAD_MESSAGE }));
    return new Promise((resolve, reject) => {
      this.humans.set(event.mac.nonce, { event, resolve, reject });
      latency.humanSent(event.mac.nonce, event.wake === true);
      if (this.welcomed) this.socket.send({ t: 'human', event });
    });
  }

  /** Whether a `human` sent through this client is still waiting for the hub's acknowledgement (or refusal). */
  holdsHumans(): boolean {
    return this.humans.size > 0;
  }

  /** Calls `done` once no `human` is left waiting: at once when none is. */
  whenHumansSent(done: () => void): void {
    if (this.humans.size === 0) done();
    else this.humansSent.add(done);
  }

  /**
   * Sends a newly sealed RPC, again after each reconnect, until the hub reports its result (`done` or `failed`). False,
   * and nothing kept, when the socket is not welcomed: the hub queues nothing for an absent party (it fails an offline
   * machine's at once), and an RPC is a decision for the moment it was made — an Interrupt held until a later welcome
   * could stop a later turn. Kept only once the socket took it: a connection already closing (its close not yet
   * handled, so the welcome still stands) takes nothing, and the RPC is refused like any other. One the hub would refuse
   * unread is not sent and fails at once, as the hub fails a malformed one (`rpc-state` `failed` `bad-shape`): true, the
   * RPC settled.
   */
  sendRpc(rpc: Rpc): boolean {
    if (unread({ t: 'rpc', rpc })) {
      const outcome: RpcOutcome = { state: 'failed', error: { code: 'bad-shape', message: UNREAD_MESSAGE } };
      for (const listener of this.rpcListeners) listener({ t: 'rpc-state', nonce: rpc.nonce, state: 'failed', outcome });
      return true;
    }
    if (!this.welcomed || !this.socket.send({ t: 'rpc', rpc })) return false;
    this.rpcs.set(rpc.nonce, rpc);
    return true;
  }

  /**
   * Sends an RPC already sent once again, exactly as sealed (an `uncertain` one's retry, DX6): kept and sent after
   * each reconnect until its result, as when it was first sent.
   */
  resendRpc(rpc: Rpc): void {
    this.rpcs.set(rpc.nonce, rpc);
    if (this.welcomed) this.socket.send({ t: 'rpc', rpc });
  }

  onRpcState(listener: (frame: RpcStateFrame) => void): () => void {
    this.rpcListeners.add(listener);
    return () => this.rpcListeners.delete(listener);
  }

  /**
   * Whether this tab shows the project; the hub holds back the member's pushes while one does. `visible` is repeated
   * every 30 s while it holds, because the hub counts a socket as visible only for 90 s after the last (composite
   * ad82c3b2): a phone put to sleep before its hidden report got out stops holding pushes back on its own.
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.welcomed) this.socket.send({ t: 'visibility', visible });
    if (this.repeat !== null) clearInterval(this.repeat);
    this.repeat = visible ? setInterval(() => this.welcomed && this.socket.send({ t: 'visibility', visible: true }), VISIBLE_REPEAT_MS) : null;
  }

  subscribe(target: SessionTarget, listener: SubscriptionListener): Subscription {
    const open: OpenSubscription = { target, listener, sub: null, next: 0, failedStarts: 0, retry: null, reads: new Map() };
    this.subs.add(open);
    if (this.welcomed) this.sendSubscribe(open);
    return {
      rows: (before, limit) => {
        if (open.sub && this.subs.has(open)) this.socket.send({ t: 'rows', sub: open.sub, before, limit: rowsLimit(limit) });
      },
      diff: () => {
        if (open.sub && this.subs.has(open) && open.target.agentId === null) this.socket.send({ t: 'diff', sub: open.sub });
      },
      output: (taskId, tail) => {
        if (open.sub && this.subs.has(open) && isTaskId(taskId)) this.socket.send({ t: 'output', sub: open.sub, taskId, tail: outputTail(tail) });
      },
      read: (what, args) => this.read(open, what, args),
      close: () => {
        if (open.retry) clearTimeout(open.retry);
        open.retry = null;
        this.lostReads(open);
        if (!this.subs.delete(open)) return;
        if (open.sub && this.welcomed) this.socket.send({ t: 'unsubscribe', sub: open.sub });
      },
    };
  }

  /** One read on the sub open now, settled by its answer's id; see `Subscription.read`. */
  private read(open: OpenSubscription, what: string, args?: JsonObject): Promise<JsonValue> {
    if (open.target.agentId !== null) return Promise.reject(new ReadError('unsupported', `${what} is the main transcript's`));
    if (!open.sub || !this.subs.has(open) || !this.welcomed) return Promise.reject(new ReadError('interrupted', 'the subscription is not live: ask again once it is'));
    const id = newNonce();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        open.reads.delete(id);
        reject(new ReadError('timeout', `no answer within ${(this.options.readTimeoutMs ?? READ_TIMEOUT_MS) / 1000} s`));
      }, this.options.readTimeoutMs ?? READ_TIMEOUT_MS);
      open.reads.set(id, { what, sent: performance.now(), resolve, reject, timer });
      this.socket.send({ t: 'read', sub: open.sub!, id, what, ...(args && { args }) });
    });
  }

  /** The answer to a read: its promise settles, and the instrument times it. A late or unknown id is passed over. */
  private readAnswered(open: OpenSubscription, answer: ReadAnswer): void {
    const pending = open.reads.get(answer.id);
    if (!pending) return;
    open.reads.delete(answer.id);
    clearTimeout(pending.timer);
    latency.readAnswered(pending.what, performance.now() - pending.sent);
    if (answer.error) pending.reject(new ReadError(answer.error.code, answer.error.message));
    else {
      if (pending.what === 'catalog' && answer.result) catalogs.accept(catalogKey(this.options.project, open.target.session), answer.result as unknown as Catalog);
      pending.resolve(answer.result ?? null);
    }
  }

  /** The sub the reads were asked on is gone: none of them will be answered on it. */
  private lostReads(open: OpenSubscription): void {
    for (const pending of open.reads.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ReadError('interrupted', 'the subscription was interrupted before the answer: ask again'));
    }
    open.reads.clear();
  }

  private humanSettled(): void {
    if (this.humans.size > 0) return;
    const done = [...this.humansSent];
    this.humansSent.clear();
    for (const call of done) call();
  }

  private disconnected(): void {
    if (!this.welcomed) return;
    this.welcomed = false;
    catalogs.invalidateProject(this.options.project);
    for (const open of this.subs) {
      if (open.retry) clearTimeout(open.retry); // the next welcome subscribes every open one again
      open.retry = null;
      if (open.sub === null) continue;
      open.sub = null;
      this.lostReads(open);
      open.listener.interrupted();
    }
  }

  private sendSubscribe(open: OpenSubscription): void {
    open.sub = newNonce();
    open.next = 0;
    const { machine, session, agentId } = open.target;
    open.catalogSent = performance.now();
    if (agentId === null) catalogs.invalidate(catalogKey(this.options.project, session));
    this.socket.send({ t: 'subscribe', machine, session, agentId, sub: open.sub });
    if (agentId === null && catalogs.get(catalogKey(this.options.project, session)).catalog) {
      latency.record('catalog.ready', performance.now() - open.catalogSent, session);
      open.catalogSent = undefined;
    }
  }

  private receive(frame: ProjectDown): void {
    const { handlers } = this.options;
    switch (frame.t) {
      case 'welcome':
        if (frame.project !== this.options.project) {
          this.socket.restart();
          return;
        }
        handlers.welcome?.(frame);
        this.welcomed = true;
        if (this.welcomedBefore) latency.count('socket.reconnects');
        this.welcomedBefore = true;
        this.socket.send({ t: 'resume', after: handlers.held() });
        if (this.visible !== null) this.socket.send({ t: 'visibility', visible: this.visible });
        for (const event of [...this.humans.values()].map((h) => h.event)) this.socket.send({ t: 'human', event });
        for (const rpc of this.rpcs.values()) this.socket.send({ t: 'rpc', rpc });
        for (const open of this.subs) this.sendSubscribe(open);
        return;
      case 'log': {
        const held = handlers.held();
        const fresh = frame.events.filter((entry) => entry.offset > held);
        if (fresh.length > 0) handlers.log?.(fresh);
        return;
      }
      case 'more':
        // One page of the backlog is in and more remain (DX3): ask for the next. Only `caught-up` is caught up.
        this.socket.send({ t: 'resume', after: frame.offset });
        return;
      case 'caught-up':
        handlers.caughtUp?.(frame.offset);
        return;
      case 'human-ack': {
        const waiting = this.humans.get(frame.nonce);
        if (!waiting) return;
        this.humans.delete(frame.nonce);
        latency.humanAcked(frame.nonce, frame);
        waiting.resolve({ offset: frame.offset, writer: frame.writer, seq: frame.seq });
        this.humanSettled();
        return;
      }
      case 'rpc-state':
        // `forwarded` is interim and `uncertain` not final: the RPC is kept (and sent again after a reconnect, which the
        // hub answers from its record) until a result, so the one the daemon republishes has something to land on.
        if (frame.state === 'done' || frame.state === 'failed') this.rpcs.delete(frame.nonce);
        for (const listener of this.rpcListeners) listener(frame);
        return;
      case 'session':
        if (IN_SUB.has(frame.message.kind)) this.receiveInSub(frame.message);
        else {
          if (frame.message.kind === 'delivery') {
            const { event, outcome } = frame.message.body as Delivery;
            latency.delivery(event, outcome);
          }
          handlers.session?.(frame.message);
        }
        return;
      case 'pending':
        handlers.pending?.(frame.requests);
        return;
      case 'deliveries':
        for (const { event, outcome } of frame.deliveries) latency.delivery(event, outcome);
        handlers.deliveries?.(frame.deliveries);
        return;
      case 'machines':
        handlers.machines?.(frame.machines);
        return;
      case 'refused': {
        const nonce = frame.refusal.nonce;
        const waiting = nonce === undefined ? undefined : this.humans.get(nonce);
        if (waiting) {
          this.humans.delete(nonce!);
          waiting.reject(new HumanRefused(frame.refusal));
          this.humanSettled();
        }
        handlers.refused?.(frame.refusal);
        return;
      }
      case 'rejected':
        handlers.rejected?.(frame.rejection);
        return;
      case 'decided':
        handlers.decided?.(frame.decision);
        return;
      default:
        return;
    }
  }

  private receiveInSub(message: SessionMessage): void {
    const open = [...this.subs].find((o) => o.sub !== null && o.sub === message.sub);
    if (!open) return; // a subscription given up or closed
    if (message.n !== open.next) {
      // A gap: give this sub up and take a fresh snapshot under a new one.
      this.socket.send({ t: 'unsubscribe', sub: open.sub! });
      this.lostReads(open);
      open.listener.interrupted();
      this.sendSubscribe(open);
      return;
    }
    open.next++;
    if (message.kind === 'snapshot') open.failedStarts = 0;
    if (open.target.agentId === null && (message.kind === 'snapshot' || message.kind === 'catalog')) {
      const key = catalogKey(this.options.project, open.target.session);
      const catalog = message.kind === 'catalog' ? message.body as Catalog : (message.body as SessionBodies['snapshot']).catalog;
      if (catalog) {
        catalogs.accept(key, catalog);
        if (open.catalogSent !== undefined) latency.record('catalog.ready', performance.now() - open.catalogSent, open.target.session);
        open.catalogSent = undefined;
      } else catalogs.invalidate(key);
    }
    if (message.kind === 'read') return this.readAnswered(open, message.body as ReadAnswer);
    if (message.kind === 'end') {
      this.lostReads(open);
      // An `end` may come first, at n 0, when the sub ended before a snapshot could be taken (DX4, composite cd2667d8).
      const body = message.body as SessionBodies['end'];
      if (body.reason === 'discontinuity') {
        // The bridge's stream lost events (DX4): the live part no longer follows the snapshot. Take a fresh one — at
        // once after a snapshot, and after a growing wait when none could be taken, so a bridge still starting is not
        // asked again and again.
        open.listener.interrupted();
        if (message.n !== 0) {
          this.sendSubscribe(open);
          return;
        }
        open.sub = null;
        const failed = open.failedStarts;
        open.failedStarts++;
        const wait = (this.options.resubscribeDelay ?? backoff)(failed);
        open.retry = setTimeout(() => {
          open.retry = null;
          if (this.subs.has(open) && this.welcomed && open.sub === null) this.sendSubscribe(open);
        }, wait);
        return;
      }
      this.subs.delete(open);
      open.listener.end(body);
      return;
    }
    open.listener.message(message as SubscriptionMessage);
  }
}
