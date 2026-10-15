// The project socket (DX3): `/api/projects/<id>/socket`. On every connection, after the hub's `welcome`, it resumes
// after the last offset the browser holds — so a drop, a deploy, or a reload never replays from the start and never
// skips — and sends again everything the hub has not acknowledged: a web `human` until its `human-ack`, an RPC until
// the hub reports a state for it. It also serves the session plane (DX8's `SessionPlane`): DX4 subscriptions whose
// messages reach their listener in order, re-subscribed after any discontinuity.
import {
  newNonce,
  type HumanEvent,
  type PendingRequest,
  type ProjectDown,
  type ProjectUp,
  type Rpc,
  type SessionBodies,
  type SessionMessage,
  type LogEvent,
  type Delivery,
  type MachinePresence,
  SUBSCRIPTION_KINDS,
} from 'desk-hub/protocol';
import type { SessionPlane, SessionTarget, Subscription, SubscriptionListener, SubscriptionMessage } from '../shell/session-plane';
import { backoff, HubSocket, type ConnectionStatus } from './socket';

/** How often a visible tab says so again: a third of the 90 s the hub counts a socket as visible after the last. */
const VISIBLE_REPEAT_MS = 30_000;

/** DX3's `rows` takes a `limit` from 1 to 1000; the hub refuses anything else as `bad-shape`, into the audit record. */
const rowsLimit = (limit: number) => Math.min(1000, Math.max(1, Math.trunc(limit) || 1));

export type { ConnectionStatus } from './socket';

export type Welcome = Extract<ProjectDown, { t: 'welcome' }>;
export type RpcStateFrame = Extract<ProjectDown, { t: 'rpc-state' }>;
export type HumanAck = { offset: number; writer: string; seq: number };
export type HubRefusal = Extract<ProjectDown, { t: 'refused' }>['refusal'];

/** A web `human` the hub refused (its `refused` named the send's nonce): it is not stored and is never sent again. */
export class HumanRefused extends Error {
  constructor(readonly refusal: HubRefusal) {
    super(`the hub refused the message: ${refusal.reason}${refusal.message ? `, ${refusal.message}` : ''}`);
  }
}

export type ProjectHandlers = {
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
};

type OpenSubscription = {
  target: SessionTarget;
  listener: SubscriptionListener;
  sub: string | null;
  next: number;
  /** Discontinuities at `n` 0 in a row: the backoff's attempt. A snapshot resets it. */
  failedStarts: number;
  retry: ReturnType<typeof setTimeout> | null;
};

const IN_SUB = new Set<string>(SUBSCRIPTION_KINDS);

export class ProjectClient implements SessionPlane {
  private readonly socket: HubSocket<ProjectDown, ProjectUp>;
  private welcomed = false;
  private visible: boolean | null = null;
  private repeat: ReturnType<typeof setInterval> | null = null;
  private readonly humans = new Map<string, { event: HumanEvent; resolve: (ack: HumanAck) => void; reject: (error: HumanRefused) => void }>();
  private readonly rpcs = new Map<string, Rpc>();
  private readonly rpcListeners = new Set<(frame: RpcStateFrame) => void>();
  private readonly subs = new Set<OpenSubscription>();

  constructor(private readonly options: ProjectClientOptions) {
    this.socket = new HubSocket({
      url: `${options.base}/api/projects/${encodeURIComponent(options.project)}/socket`,
      open: () => {},
      frame: (frame) => this.receive(frame),
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

  stop(): void {
    if (this.repeat !== null) clearInterval(this.repeat);
    this.repeat = null;
    this.socket.stop();
  }

  /**
   * Sends a sealed web `human`. Resolves when the hub has stored it (`human-ack`), sending it again after each reconnect
   * until then; rejects with `HumanRefused` when the hub refuses it, after which it is never sent again.
   */
  sendHuman(event: HumanEvent): Promise<HumanAck> {
    return new Promise((resolve, reject) => {
      this.humans.set(event.mac.nonce, { event, resolve, reject });
      if (this.welcomed) this.socket.send({ t: 'human', event });
    });
  }

  /** Sends a sealed RPC, again after each reconnect, until the hub reports its result (`done` or `failed`). */
  sendRpc(rpc: Rpc): void {
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
    const open: OpenSubscription = { target, listener, sub: null, next: 0, failedStarts: 0, retry: null };
    this.subs.add(open);
    if (this.welcomed) this.sendSubscribe(open);
    return {
      rows: (before, limit) => {
        if (open.sub && this.subs.has(open)) this.socket.send({ t: 'rows', sub: open.sub, before, limit: rowsLimit(limit) });
      },
      diff: () => {
        if (open.sub && this.subs.has(open) && open.target.agentId === null) this.socket.send({ t: 'diff', sub: open.sub });
      },
      close: () => {
        if (open.retry) clearTimeout(open.retry);
        open.retry = null;
        if (!this.subs.delete(open)) return;
        if (open.sub && this.welcomed) this.socket.send({ t: 'unsubscribe', sub: open.sub });
      },
    };
  }

  private disconnected(): void {
    if (!this.welcomed) return;
    this.welcomed = false;
    for (const open of this.subs) {
      if (open.retry) clearTimeout(open.retry); // the next welcome subscribes every open one again
      open.retry = null;
      if (open.sub === null) continue;
      open.sub = null;
      open.listener.reset();
    }
  }

  private sendSubscribe(open: OpenSubscription): void {
    open.sub = newNonce();
    open.next = 0;
    const { machine, session, agentId } = open.target;
    this.socket.send({ t: 'subscribe', machine, session, agentId, sub: open.sub });
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
      case 'caught-up':
        handlers.caughtUp?.(frame.offset);
        return;
      case 'human-ack': {
        const waiting = this.humans.get(frame.nonce);
        if (!waiting) return;
        this.humans.delete(frame.nonce);
        waiting.resolve({ offset: frame.offset, writer: frame.writer, seq: frame.seq });
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
        else handlers.session?.(frame.message);
        return;
      case 'pending':
        handlers.pending?.(frame.requests);
        return;
      case 'deliveries':
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
      open.listener.reset();
      this.sendSubscribe(open);
      return;
    }
    open.next++;
    if (message.kind === 'snapshot') open.failedStarts = 0;
    if (message.kind === 'end') {
      // An `end` may come first, at n 0, when the sub ended before a snapshot could be taken (DX4, composite cd2667d8).
      const body = message.body as SessionBodies['end'];
      if (body.reason === 'discontinuity') {
        // The bridge's stream lost events (DX4): the live part no longer follows the snapshot. Take a fresh one — at
        // once after a snapshot, and after a growing wait when none could be taken, so a bridge still starting is not
        // asked again and again.
        open.listener.reset();
        if (message.n !== 0) {
          this.sendSubscribe(open);
          return;
        }
        open.sub = null;
        const wait = (this.options.resubscribeDelay ?? backoff)(open.failedStarts++);
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
