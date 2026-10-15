// One open project: its log (kept and verified by `ProjectLog`), its live state from the session plane — presence per
// session, machines, the pending set, the hub's refusals — and the socket that feeds both. The socket starts only
// once the browser's record is read, so its first resume is after the last offset the record holds.
import { createStore, type StoreApi } from 'zustand/vanilla';
import { verify, type MachinePresence, type OrgKey, type PendingRequest, type ProjectDown, type SessionMessage, type SessionPresence } from 'desk-hub/protocol';
import type { LogRecord } from '../log/record';
import { ProjectLog } from '../log/project-log';
import { ProjectClient, type ConnectionStatus } from '../hub/project-client';

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

export class ProjectConnection {
  readonly log: ProjectLog;
  readonly live: StoreApi<LiveState> = createStore<LiveState>(() => ({ status: 'connecting', caughtUp: false, presence: {}, machines: {}, pending: [], audit: [] }));
  readonly client: ProjectClient;
  private key: OrgKey | null = null;
  private started = false;
  private stopped = false;
  private pendingRaw: PendingRequest[] = [];

  constructor(
    readonly project: string,
    options: ConnectionOptions,
  ) {
    this.log = new ProjectLog(project, options.record);
    this.client = new ProjectClient({
      base: options.base,
      project,
      delay: options.delay,
      handlers: {
        held: () => this.log.held(),
        welcome: (frame) => {
          this.log.welcome(frame.head);
          // Presence from before the drop may no longer hold; until the hub sends it again a session's group reads the
          // log's last `state`, which is the record for exactly that case.
          this.live.setState({ caughtUp: false, presence: {} });
        },
        log: (entries) => this.log.receive(entries),
        caughtUp: () => this.live.setState({ caughtUp: true }),
        session: (message) => this.session(message),
        machines: (machines) => this.live.setState({ machines: Object.fromEntries(machines.map(({ machine, ...presence }) => [machine, presence])) }),
        pending: (requests) => {
          this.pendingRaw = requests;
          void this.checkPending();
        },
        refused: (entry) => this.record({ kind: 'refused', entry }),
        rejected: (entry) => this.record({ kind: 'rejected', entry }),
        status: (status) => this.live.setState({ status }),
      },
    });
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
    void this.checkPending();
  }

  private record(item: AuditItem): void {
    this.live.setState((s) => (s.audit.some((a) => a.entry.id === item.entry.id) ? s : { audit: [...s.audit, item].sort((a, b) => a.entry.id - b.entry.id) }));
  }

  private session(message: SessionMessage): void {
    if (message.kind === 'presence') {
      const presence = message.body as SessionPresence;
      this.live.setState((s) => ({ presence: { ...s.presence, [message.session as string]: presence } }));
    } else if (message.kind === 'machine') {
      const presence = message.body as MachinePresence;
      this.live.setState((s) => ({ machines: { ...s.machines, [message.machine]: presence } }));
    }
    // raised, settled, and delivery are the conversation's (M3); the pending set arrives whole in `pending`.
  }

  private async checkPending(): Promise<void> {
    const requests = this.pendingRaw;
    const key = this.key;
    const checked = await Promise.all(requests.map(async (r) => ({ ...r, verified: key !== null && (await verify(key, 'raised', this.project, r.raised)) })));
    if (requests === this.pendingRaw && key === this.key) this.live.setState({ pending: checked });
  }
}
