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
  type Refusal,
  type Rpc,
  type SessionMessage,
  type LogEvent,
  type Delivery,
  type MachinePresence,
  SUBSCRIPTION_KINDS,
} from 'desk-hub/protocol';
import type { SessionPlane, SessionTarget, Subscription, SubscriptionListener, SubscriptionMessage } from '../shell/session-plane';
import { HubSocket, type ConnectionStatus } from './socket';

export type { ConnectionStatus } from './socket';

export type Welcome = Extract<ProjectDown, { t: 'welcome' }>;
export type RpcStateFrame = Extract<ProjectDown, { t: 'rpc-state' }>;
export type HumanAck = { offset: number; writer: string; seq: number };

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
  refused?(refusal: Refusal & { nonce?: string; machine?: string }): void;
  status?(status: ConnectionStatus): void;
};

export type ProjectClientOptions = {
  /** The hub's origin as a WebSocket URL (`wss://desk.example`). */
  base: string;
  project: string;
  handlers: ProjectHandlers;
  delay?: (attempt: number) => number;
  frameLimit?: number;
};

type OpenSubscription = { target: SessionTarget; listener: SubscriptionListener; sub: string | null; next: number };

const IN_SUB = new Set<string>(SUBSCRIPTION_KINDS);

export class ProjectClient implements SessionPlane {
  private readonly socket: HubSocket<ProjectDown, ProjectUp>;
  private welcomed = false;
  private visible: boolean | null = null;
  private readonly humans = new Map<string, { event: HumanEvent; resolve: (ack: HumanAck) => void }>();
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
    this.socket.stop();
  }

  /** Sends a sealed web `human`; resolves when the hub has stored it, sending it again after each reconnect until then. */
  sendHuman(event: HumanEvent): Promise<HumanAck> {
    return new Promise((resolve) => {
      this.humans.set(event.mac.nonce, { event, resolve });
      if (this.welcomed) this.socket.send({ t: 'human', event });
    });
  }

  /** Sends a sealed RPC, again after each reconnect, until the hub reports a state for its nonce. */
  sendRpc(rpc: Rpc): void {
    this.rpcs.set(rpc.nonce, rpc);
    if (this.welcomed) this.socket.send({ t: 'rpc', rpc });
  }

  onRpcState(listener: (frame: RpcStateFrame) => void): () => void {
    this.rpcListeners.add(listener);
    return () => this.rpcListeners.delete(listener);
  }

  /** Whether this tab shows the project; the hub holds back the member's pushes while one does. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.welcomed) this.socket.send({ t: 'visibility', visible });
  }

  subscribe(target: SessionTarget, listener: SubscriptionListener): Subscription {
    const open: OpenSubscription = { target, listener, sub: null, next: 0 };
    if (target.agentId !== null) {
      // DX3 as `desk-hub/protocol` has it subscribes to a session only; the agent-scoped subscription arrives with
      // DC3's amendment (the composite's Decision Log), merged in from smns-erb.
      queueMicrotask(() => listener.end({ reason: 'error', message: 'a subagent subscription waits for DX3 to carry agentId' }));
      return { rows: () => {}, close: () => {} };
    }
    this.subs.add(open);
    if (this.welcomed) this.sendSubscribe(open);
    return {
      rows: (before, limit) => {
        if (open.sub && this.subs.has(open)) this.socket.send({ t: 'rows', sub: open.sub, before, limit });
      },
      close: () => {
        if (!this.subs.delete(open)) return;
        if (open.sub && this.welcomed) this.socket.send({ t: 'unsubscribe', sub: open.sub });
      },
    };
  }

  private disconnected(): void {
    if (!this.welcomed) return;
    this.welcomed = false;
    for (const open of this.subs) {
      if (open.sub === null) continue;
      open.sub = null;
      open.listener.reset();
    }
  }

  private sendSubscribe(open: OpenSubscription): void {
    open.sub = newNonce();
    open.next = 0;
    this.socket.send({ t: 'subscribe', machine: open.target.machine, session: open.target.session, sub: open.sub });
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
        this.rpcs.delete(frame.nonce);
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
      case 'refused':
        handlers.refused?.(frame.refusal);
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
    if (message.kind === 'end') {
      this.subs.delete(open);
      open.listener.end(message.body as { reason: 'unsubscribed' | 'machine-offline' | 'session-ended' | 'error'; message?: string });
      return;
    }
    open.listener.message(message as SubscriptionMessage);
  }
}
