// DX3 — browser ↔ hub. WebSockets with JSON text frames: one to a project's `Project` object for its view
// (`/api/projects/<id>/socket`), one to the org's `Registry` for the grid (`/api/registry/socket`). Browsers see project
// offsets, never writer vectors.
import type { HumanEvent, LogEvent } from './log';
import type { Refusal, Rejection } from './machine';
import type { Part } from './parts';
import type { Rpc, RpcOutcome, RpcState } from './rpc';
import type { Delivery, MachinePresence, Raised, SessionMessage, Settled } from './session';

/** Browser → hub over a project socket. */
export type ProjectUp =
  /** Every event with an offset above `after`, then `caught-up`, then live. 0 is the start. */
  | { t: 'resume'; after: number }
  /** A sealed web `human`; the hub assigns `writer` (`hub/<member>`), `seq`, and `ts`, and answers `human-ack`. */
  | { t: 'human'; event: HumanEvent }
  | { t: 'rpc'; rpc: Rpc }
  /**
   * `sub` is the browser's own random id (128 bits, base64url), unique at the machine. The scope is one transcript:
   * the session's main one (`agentId` null) or one subagent's (DX2's `subscribe`).
   */
  | { t: 'subscribe'; machine: string; session: string; agentId: string | null; sub: string }
  | { t: 'unsubscribe'; sub: string }
  | { t: 'rows'; sub: string; before: string; limit: number }
  /** The session's working-tree diff, answered as DX4 `diff` on that sub; a main-transcript sub's only (`agentId` null).
   * Computed on request, never pushed. */
  | { t: 'diff'; sub: string }
  /** Whether this tab shows the project; a visible tab of a member holds back that member's pushes. */
  | { t: 'visibility'; visible: boolean }
  | Part;

/** Hub → browser over a project socket. */
export type ProjectDown =
  /** First on every socket: who the hub admitted, and the project's latest offset. */
  | { t: 'welcome'; project: string; member: string; head: number }
  | { t: 'log'; events: Array<{ offset: number; event: LogEvent }> }
  | { t: 'caught-up'; offset: number }
  | { t: 'human-ack'; nonce: string; offset: number; writer: string; seq: number }
  | { t: 'session'; message: SessionMessage }
  /**
   * The project's pending set: on connect, and again whenever it changes (a raise, a settlement, a machine's
   * republish, a `deadline` passing). `terminal_only` is the hub's, by its own clock: the request's `deadline` passed,
   * so it stays pending but only the terminal can answer it, and the web draws it as waiting in the terminal.
   */
  | { t: 'pending'; requests: PendingRequest[] }
  /** The latest outcome per event and recipient, on connect; later ones arrive as `session` messages. */
  | { t: 'deliveries'; deliveries: Delivery[] }
  | { t: 'machines'; machines: Array<{ machine: string } & MachinePresence> }
  | { t: 'rpc-state'; nonce: string; state: RpcState; outcome?: RpcOutcome }
  /** A refusal of the hub's own, recorded in the project's audit record: to the sender and to the project's browsers. */
  | { t: 'refused'; refusal: AuditEntry & Refusal & { nonce?: string; machine?: string; member?: string } }
  /** A daemon's report of an event it refused (DX2 `rejected`), recorded in the audit record and shown to every browser. */
  | { t: 'rejected'; rejection: AuditEntry & Rejection & { machine: string } }
  /** A decision on a pending request, recorded in the audit record from the bridge's `settled`, and shown to every browser. */
  | { t: 'decided'; decision: AuditEntry & Decision }
  | Part;

/**
 * Who decided a pending request, and how, as the audit record keeps it: the bridge's `settled` verbatim (its code
 * verifies: the side the engine used, never the web's attempt), the machine and session it came from, and the `raised`
 * it settled, verbatim, or null when the hub no longer held it.
 */
export type Decision = { machine: string; session: string; settled: Settled; raised: Raised | null };

/**
 * An entry of the project's audit record: `id` its place in the record (rising; a browser that sees an entry twice
 * keeps one), `at` when the hub recorded it.
 */
export type AuditEntry = { id: number; at: string };

export type PendingRequest = { machine: string; raised: Raised; terminal_only: boolean };

/** The grid's row for one project. */
export type ProjectSummary = {
  id: string;
  name: string;
  machines: number;
  machines_online: number;
  working: number;
  waiting: number;
};

/** Hub → browser over the registry socket. */
export type GridDown = { t: 'grid'; projects: ProjectSummary[] } | { t: 'summary'; project: ProjectSummary };

/**
 * What a push carries (encrypted for the device, RFC 8291): only what points to a card, since the service worker holds
 * no org key and so cannot check anything it would draw. `alias` is the session's, from its feed's latest `from` (null
 * when the hub holds none); `request` names a raised request, `event` a `<message>`.
 */
export type PushNotice = {
  v: 1;
  project: string;
  session: string;
  alias: string | null;
  kind: 'question' | 'permission' | 'message';
  request?: string;
  event?: { writer: string; seq: number };
};
