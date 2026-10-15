// DX3 — browser ↔ hub. WebSockets with JSON text frames: one to a project's `Project` object for its view
// (`/api/projects/<id>/socket`), one to the org's `Registry` for the grid (`/api/registry/socket`). Browsers see project
// offsets, never writer vectors.
import type { HumanEvent, LogEvent } from './log';
import type { Refusal } from './machine';
import type { Part } from './parts';
import type { Rpc, RpcOutcome, RpcState } from './rpc';
import type { Delivery, MachinePresence, Raised, SessionMessage } from './session';

/** Browser → hub over a project socket. */
export type ProjectUp =
  /** Every event with an offset above `after`, then `caught-up`, then live. 0 is the start. */
  | { t: 'resume'; after: number }
  /** A sealed web `human`; the hub assigns `writer` (`hub/<member>`), `seq`, and `ts`, and answers `human-ack`. */
  | { t: 'human'; event: HumanEvent }
  | { t: 'rpc'; rpc: Rpc }
  /** `sub` is the browser's own random id (128 bits, base64url), unique at the machine. */
  | { t: 'subscribe'; machine: string; session: string; sub: string }
  | { t: 'unsubscribe'; sub: string }
  | { t: 'rows'; sub: string; before: string; limit: number }
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
  /** A refusal the hub reports to the project's browsers (the audit record of what it refused), or to the sender. */
  | { t: 'refused'; refusal: Refusal & { nonce?: string; machine?: string } }
  | Part;

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
