// DX3 — browser ↔ hub. WebSockets with JSON text frames: one to a project's `Project` object for its view
// (`/api/projects/<id>/socket`), one to the org's `Registry` for the grid (`/api/registry/socket`). Browsers see project
// offsets, never writer vectors.
import type { RegistryAppFrame } from 'org-protocol';
import type { ProjectKind } from './identity';
import type { JsonObject } from './json';
import type { HumanEvent, LogEvent } from './log';
import type { Refusal, Rejection } from './machine';
import { FRAME_LIMIT, utf8Length, type Part } from './parts';
import type { Rpc, RpcOutcome, RpcState } from './rpc';
import type { Delivery, MachinePresence, Raised, SessionMessage, Settled } from './session';

/** Browser → hub over a project socket. */
export type ProjectUp =
  /** The events with an offset above `after` (0 is the start), one page of about 1 MiB: then `caught-up` and live, or
   * `more` when events remain, answered by `resume` from its offset. */
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
  /**
   * The last `tail` bytes of a background task's output file, answered as DX4 `output` on that sub; valid on a main or
   * an agent sub (a job belongs to the loop whose rows started it). `taskId` as the engine spells a task id and `tail`
   * 1 to `OUTPUT_TAIL_MAX` (`isTaskId`, `isOutputTail`), else `bad-shape`. Read on request, never pushed; what is absent
   * or refused comes back as the answer's own variant, never as a hub refusal.
   */
  | { t: 'output'; sub: string; taskId: string; tail: number }
  /**
   * A read of the session (the desk control surface spec, §5): nothing on the machine changes, and the answer comes as
   * DX4 `read` on that sub with this `id`. `id` the browser's own, 1 to 64 characters; `what` a read kind,
   * `[a-z-]{1,32}`; `args` absent or an object of at most 4 KiB as JSON (`readShapeError`), else `bad-shape`. A sub the
   * socket does not hold is passed over quietly, as `diff` is; a kind or a bridge the machine lacks comes back as the
   * answer's `error`, never as a hub refusal.
   */
  | { t: 'read'; sub: string; id: string; what: string; args?: JsonObject }
  /** Whether this tab shows the project; a visible tab of a member holds back that member's pushes. */
  | { t: 'visibility'; visible: boolean }
  | Part;

/**
 * The most bytes (UTF-8 of its JSON text) a frame a browser sends as parts joins to. The largest a browser sends is a
 * `human` or an RPC, each at most 1 MiB (DX1's event bound, and DX6's), and a few bytes of frame around it: this is
 * four times that, and holds what one set costs the object to join, parse and check to a few times it. The hub refuses
 * a set past it `too-large`, unread, so it can name no request the frame carried: a browser sends none.
 */
export const BROWSER_SET_LIMIT = 4 * FRAME_LIMIT;

/**
 * The most parts a browser's set is: a frame of BROWSER_SET_LIMIT cut at FRAME_LIMIT takes at most 9, since a slice of
 * its text at most doubles as a part carries it (a quote or a backslash escaped). A set of more is refused at its
 * first part, before any of it is held: a set's slots cost the object whatever their data.
 */
export const BROWSER_SET_PARTS = (2 * BROWSER_SET_LIMIT) / FRAME_LIMIT + 1;

/** The most bytes an `output` asks for, so its answer fits one frame. */
export const OUTPUT_TAIL_MAX = 524_288;

/** A task id as the engine spells one: what an `output` names, and nothing a path could be made of. */
export const isTaskId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

/** A tail an `output` may ask for: a whole number of bytes from 1 to `OUTPUT_TAIL_MAX`. */
export const isOutputTail = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= OUTPUT_TAIL_MAX;

/** The most bytes (UTF-8 of its JSON text) a `read`'s `args` take. */
export const READ_ARGS_MAX = 4096;

/** Why a `read` frame is not one the hub carries (DX3), or null: its `id`, its `what`, and its `args`. */
export function readShapeError(frame: { id?: unknown; what?: unknown; args?: unknown }): string | null {
  const { id, what, args } = frame;
  if (typeof id !== 'string' || id.length < 1 || id.length > 64) return 'a read names its id, 1 to 64 characters';
  if (typeof what !== 'string' || !/^[a-z-]{1,32}$/.test(what)) return 'a read names its kind, [a-z-]{1,32}';
  if (args === undefined) return null;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return "a read's args are an object";
  if (utf8Length(JSON.stringify(args)) > READ_ARGS_MAX) return `a read's args are at most ${READ_ARGS_MAX} bytes`;
  return null;
}

/** Hub → browser over a project socket. */
export type ProjectDown =
  /** First on every socket: who the hub admitted, and the project's latest offset. */
  | { t: 'welcome'; project: string; member: string; head: number }
  | { t: 'log'; events: Array<{ offset: number; event: LogEvent }> }
  | { t: 'caught-up'; offset: number }
  /** This page of the backlog ends at `offset` (the last sent) and more remain: send `resume {after: offset}`. The socket
   * gets live `log` frames only from its `caught-up` on. */
  | { t: 'more'; offset: number }
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

/** The grid's row for one project. `machines` and `machines_online` count the machines that hold it (a checkout or a
 * session), never those that only follow it (DX2 `hello.follow`). `live` counts the sessions whose presence names a
 * process (`record` not null) on those machines, online or offline (a sleeping laptop's sessions are still its), a
 * revoked machine's never: the web shows a project with `live` or `waiting` by default. A retired machine project has no
 * row. */
export type ProjectSummary = {
  id: string;
  name: string;
  kind: ProjectKind;
  machines: number;
  machines_online: number;
  working: number;
  waiting: number;
  live: number;
};

/**
 * An enrolled machine as the org's directory lists it (DX2 `org`): online while any project of the org holds a fresh
 * lease of it, a follow lease included; `seen` is when that last changed at the Registry, ISO 8601 UTC with
 * milliseconds — when it came online, for an online machine, and when it went offline, for an offline one — and null
 * for a machine never reported online.
 */
export type MachineSummary = { name: string; online: boolean; seen: string | null };

/** Hub → browser over the registry socket. A frame above `FRAME_LIMIT` (a grid of many projects) comes as numbered parts,
 * joined as on a project socket. */
export type GridDown = { t: 'grid'; projects: ProjectSummary[] } | { t: 'summary'; project: ProjectSummary } | Part;

/**
 * Everything the registry socket sends: the grid, and since O11 M7, to a socket opened as an app's (`?app=1`), the app's
 * frames after it (OX8, `org-protocol`'s `RegistryAppFrame`): the org state's head version and every listing the hub
 * holds, in bounded pages, then a `state` notice at each accepted state and a `listing` as each is stored. Desk-web opens
 * its grid without the query and gets the grid alone.
 */
export type RegistryDown = GridDown | RegistryAppFrame;

/**
 * What a push carries (encrypted for the device, RFC 8291): only what points to a card, since the service worker holds
 * no org key and so cannot check anything it would draw. `alias` is the session's, from its feed's latest `from` (null
 * when the hub holds none); `request` names a raised request, `event` a `<message>` or a `question` log event. A
 * `permission` carries `request`, a `message` `event`, and a `question` either: `request` when a bridge raised the ask,
 * `event` when the log's event reported it first, or alone (MAWS's async ask is never raised).
 */
export type PushNotice = {
  v: 1;
  project: string;
  /** The project's name, as the grid shows it. */
  name: string;
  session: string;
  alias: string | null;
  kind: 'question' | 'permission' | 'message';
  request?: string;
  event?: { writer: string; seq: number };
  /** The org's waiting count with this push's own event counted: the sum of the grid's `ProjectSummary.waiting`, for
   * the app icon's badge. */
  waiting: number;
};
