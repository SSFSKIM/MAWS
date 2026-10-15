// One open project: its log (kept and verified by `ProjectLog`), its live state from the session plane — presence per
// session, machines, the pending set, the hub's refusals — the conversation's state (`Conversation`: requests,
// deliveries, RPCs, the outbox, compactions), and the socket that feeds them. The socket starts only once the browser's
// record is read, so its first resume is after the last offset the record holds. What the web issues — a `human`, an
// RPC — is sealed here with the org key (DX1, DX6) and never leaves unsealed.
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
import type { LogRecord } from '../log/record';
import { ProjectLog } from '../log/project-log';
import { HumanRefused, ProjectClient, type ConnectionStatus } from '../hub/project-client';
import { Conversation, type RequestRecord } from './conversation';

export type LiveState = {
  status: ConnectionStatus;
  /** The backlog after the latest resume has arrived. */
  caughtUp: boolean;
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
  readonly live: StoreApi<LiveState> = createStore<LiveState>(() => ({ status: 'connecting', caughtUp: false, presence: {}, machines: {}, pending: [], audit: [] }));
  readonly conversation: Conversation;
  readonly client: ProjectClient;
  private key: OrgKey | null = null;
  private started = false;
  private stopped = false;
  private pendingRaw: PendingRequest[] = [];
  /** The hub's head at the latest `welcome`: a request seen before the backlog is in belongs at least there. */
  private head = 0;

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
        held: () => this.log.held(),
        welcome: (frame) => {
          this.log.welcome(frame.head);
          this.head = frame.head;
          // Presence from before the drop may no longer hold; until the hub sends it again a session's group reads the
          // log's last `state`, which is the record for exactly that case.
          this.live.setState({ caughtUp: false, presence: {} });
          this.conversation.restart();
        },
        log: (entries) => {
          this.log.receive(entries);
          for (const { event } of entries) {
            const nonce = (event.mac as { nonce?: unknown } | undefined)?.nonce;
            if (event.kind === 'human' && typeof nonce === 'string') this.conversation.outboxStored(nonce);
          }
        },
        caughtUp: () => this.live.setState({ caughtUp: true }),
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
        status: (status) => this.live.setState({ status }),
      },
    });
    this.client.onRpcState((frame) => this.conversation.rpcState(frame.nonce, frame.state, frame.outcome));
  }

  /** Reads the browser's record, then opens the socket; a second call does nothing. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.log.load();
    if (!this.stopped) this.client.start();
  }

  stop(): void {
    this.stopped = true;
    this.client.stop();
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

  /** A sealed DX6 RPC to `machine`; resolves with its nonce (its id) once sent. */
  async rpc<N extends RpcName>(member: string, machine: string, name: N, args: RpcArgs[N], request?: string): Promise<string> {
    const key = this.requireKey();
    const draft = { rpc: name, project: this.project, machine, member, created: new Date().toISOString(), nonce: newNonce(), args } as RpcDraft;
    const rpc = await sealRpc(key, draft);
    this.conversation.rpcSent(rpc, request);
    this.client.sendRpc(rpc);
    return rpc.nonce;
  }

  /** Allow or deny a pending permission prompt, with the digest of exactly the request as drawn. */
  async decide(member: string, request: RequestRecord, decision: 'allow' | 'deny', message?: string): Promise<string> {
    const digest = await digestOf(request.raised);
    return this.rpc(member, request.machine, 'decide', { session: request.raised.session, digest, decision, ...(message && { message }) }, request.request);
  }

  /** Answer a pending question, with the digest of exactly the request as drawn. */
  async answer(member: string, request: RequestRecord, answers: Record<string, string>): Promise<string> {
    const digest = await digestOf(request.raised);
    return this.rpc(member, request.machine, 'answer', { session: request.raised.session, digest, answers }, request.request);
  }

  /** Sends an RPC again exactly as it was sealed — the same nonce, the same bytes — as DX6 has a retry do. */
  retryRpc(nonce: string): void {
    const entry = this.conversation.store.getState().rpcs[nonce];
    if (!entry) return;
    this.conversation.retrying(nonce);
    this.client.sendRpc(entry.rpc);
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
        this.conversation.settled(message.machine, message.body as Settled);
        return;
      case 'delivery':
        this.conversation.delivery(message.machine, message.body as Delivery);
        return;
      case 'compact':
        this.conversation.compact(message.session, message.body);
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
