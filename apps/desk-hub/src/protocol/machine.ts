// DX2 — machine ↔ hub. One connection per machine, opened outbound and multiplexing its projects: an SSE stream down
// (`GET /machine/stream`), held by the machine's `Machine` object, and frames up by POST (`POST /machine/frames`, one
// JSON frame per line), each addressed to a project and routed by the Worker to that `Project` object.
import type { MachineSummary } from './browser';
import type { ProjectKind } from './identity';
import type { JsonObject } from './json';
import type { LogEvent, Vector } from './log';
import type { Part } from './parts';
import type { Rpc, RpcOutcome } from './rpc';
import type { Raised, SessionMessage } from './session';

/**
 * The `Machine` object writes a `hb` frame this often; the daemon treats a stream silent for three periods as dead, and
 * answers each `hb` with an `hb-ack` up. Only the daemon's traffic renews the machine's lease (M3): the hub's own
 * heartbeat never does, so a suspended daemon or a half-open stream lapses. This is the deployed hub's; a hub may be
 * configured with another (the local command's is shorter), and `welcome.heartbeat_ms` says which a stream has.
 */
export const HEARTBEAT_MS = 15_000;

/**
 * How long a machine stays online in a project after its last renewal (the `hello` that opened the project on the
 * stream, then each `hb-ack` of that stream's generation): three heartbeat periods, the same span after which the
 * daemon gives its stream up as dead. A lease that lapses puts the machine offline. The close of the stream it belongs
 * to ends what that stream carried at once (its subscriptions end and its forwarded RPCs without a result become
 * `uncertain`) and holds the machine online for one more heartbeat period, for its next stream's `hello` to take the
 * lease over; past that it lapses (Project's `closed`).
 */
export const LEASE_MS = 3 * HEARTBEAT_MS;

/** The lease in heartbeat periods, whatever the heartbeat (the local command configures a shorter one). */
export const LEASE_PERIODS = LEASE_MS / HEARTBEAT_MS;

/** A POST body holds at most this many bytes (each frame in it at most FRAME_LIMIT). */
export const POST_LIMIT = 4 * 1024 * 1024;

/** The header a POST carries: the generation of the stream it belongs to (from `welcome`). */
export const GENERATION_HEADER = 'X-Desk-Generation';

export type Refusal = {
  reason:
    | 'writer-not-yours' // a writer outside `<machine>/`, or `legacy/` from a machine not the project's archive machine
    | 'conflict' // a payload at an existing (writer, seq) whose canonical form differs
    | 'gap' // a seq not one past the writer's last; answered by `resend`
    | 'bad-shape'
    | 'too-large'
    | 'stale-generation'
    | 'not-open' // any frame but `hello` for a project this stream has not opened with `hello`
    | 'bad-signature' // a v2 event whose `sig` the org state does not verify for its writer (the message names the verdict)
    | 'state-unavailable'; // a v2 event the hub could not check, the org state unreadable: send it again
  writer?: string;
  seq?: number;
  message: string;
};

/**
 * A frame of a POST the hub refused whole, named in the POST's answer (MAWS #88). `index` is the frame's place among
 * the POST's frames from 0, in the numbering `frames` counts: each non-blank line is one frame, each `part` one, and a
 * set joined in this POST is named by its last part. The same refusal still goes down the stream.
 */
export type RefusedFrame = { index: number; reason: Refusal['reason'] };

/**
 * The answer to a POST the hub took up. `frames` counts the frames it applied, refused ones included; `refused` names
 * those of them it refused whole, in POST order, and is empty when it refused none (an answer without it is from a hub
 * older than MAWS #88). A `409 stale-generation` or `503 delivery-failed` that counts `frames` carries `refused` too.
 */
export type PostAnswer = { ok: true; frames: number; refused: RefusedFrame[] };

/** Hub → machine, one per SSE event (`event: <t>`, `data: <the frame's JSON>`). */
export type DownFrame =
  /**
   * First on every stream. `generation` counts this machine's streams; a newer one supersedes every older one. `kinds`:
   * every DX4 session kind this hub lists (`SESSION_KINDS`); a daemon sends a kind the desk control surface adds
   * (`read`, `op`, `catalog`) only when it is listed, and a welcome without `kinds` is a hub older than that, to which
   * none is sent.
   */
  | { t: 'welcome'; org: string; machine: string; generation: number; heartbeat_ms: number; kinds?: string[] }
  | { t: 'hb'; at: string }
  /** The answer to `hello`: the hub's vector for the project, and whether this machine writes its archive. */
  | { t: 'have'; project: string; have: Vector; archive: boolean }
  /** Events the machine lacks, each writer's in seq order, then live as they arrive. */
  | { t: 'events'; project: string; events: LogEvent[] }
  | { t: 'resend'; project: string; writer: string; from: number }
  | { t: 'refused'; project: string; refusal: Refusal }
  | { t: 'rpc'; rpc: Rpc }
  /** The hub recorded this result; the daemon stops republishing it. */
  | { t: 'rpc-ack'; project: string; nonce: string }
  /**
   * Serve a DX4 subscription, scoped to one transcript: the session's main one (`agentId` null) or one subagent's. The
   * snapshot and every `rows` page come from that transcript alone; a main-scope sub also carries every agent's
   * chunks and the subagent tree, an agent-scope sub that agent's rows and chunks.
   */
  | { t: 'subscribe'; project: string; session: string; agentId: string | null; sub: string }
  | { t: 'unsubscribe'; project: string; sub: string }
  /** Older transcript rows for a subscription, before the row `before`, newest first, from the sub's transcript. */
  | { t: 'rows'; project: string; session: string; agentId: string | null; sub: string; before: string; limit: number }
  /** The session's working-tree diff against its base branch, answered as DX4 `diff` on the sub (a main-scope sub's). */
  | { t: 'diff'; project: string; session: string; sub: string }
  /**
   * The browser's `output` (DX3), carried with the sub's route: answer DX4 `output` on the sub with the last `tail`
   * bytes of the task's output file, under DX4's containment rule. A daemon older than DC8 passes it by.
   */
  | { t: 'output'; project: string; session: string; agentId: string | null; sub: string; taskId: string; tail: number }
  /**
   * The browser's `read` (DX3), carried with the sub's route: answer DX4 `read {id, what, result | error}` on the sub,
   * from the session's bridge (or, for a kind the plane serves itself, the plane). A daemon older than the desk control
   * surface's M0 passes it by.
   */
  | { t: 'read'; project: string; session: string; agentId: string | null; sub: string; id: string; what: string; args?: JsonObject }
  | OrgFrame
  | Part;

/** A project of the org's directory: a hub project (a `.smns` names it) or an enrolled machine's own, which names its
 * machine; a retired one is a revoked machine's, kept for its log. */
export type OrgProject = { id: string; name: string; kind: ProjectKind; machine?: string; retired: boolean };

/**
 * The org's directory: every project the Registry holds and every enrolled machine. Second on every stream, after
 * `welcome` and before anything else; again whenever the Registry registers a project, retires or reactivates one, a
 * machine is enrolled or revoked, or a machine's online state changes. Each is the directory whole: the latest
 * replaces every earlier one. A daemon older than the org directory passes it by.
 */
export type OrgFrame = { t: 'org'; projects: OrgProject[]; machines: MachineSummary[] };

/**
 * Why a daemon refused an event the hub sent it (DX1): its code does not verify (`bad-code`, which includes a `hub/`
 * event whose position fails its shape and an event transplanted from another project), its nonce was seen before
 * (`seen-nonce`), it is not a log event the daemon can read (`bad-shape`), or its code verifies but the daemon already
 * holds a different event at that `(writer, seq)` (`conflict`; in a `hub/` feed, the hub re-sequenced one). Whatever
 * the reason, the refused position is spent on that daemon: its `hello` vector moves past it, and the hub, which
 * streams strictly beyond the vector a daemon sends, never sends it again.
 */
export type RejectionReason = 'bad-code' | 'seen-nonce' | 'bad-shape' | 'conflict';

/**
 * A daemon's report of an event it refused; the hub keeps it in the project's audit record and shows it to browsers.
 * The event is named by what it carried, never by anything the daemon makes up: its position when it had one, its
 * `mac.nonce` when it had one, either or both. An event that carried neither is still reported (`event` null, no
 * `nonce`), so the refusal shows; `message` then says what it was.
 */
export type Rejection = {
  /**
   * The event's `writer` and `seq` exactly as they arrived, when `writer` was a string and `seq` a number (however
   * wrong otherwise: a `hub/` writer that fails its shape is reported as it came); null when either was missing or of
   * another type.
   */
  event: { writer: string; seq: number } | null;
  /** Its `mac.nonce` exactly as it arrived, when that was a string. */
  nonce?: string;
  reason: RejectionReason;
  message?: string;
};

/** Machine → hub, one per line of a POST body. */
export type UpFrame =
  /** The answer to each `hb`: the stream's `generation` and the answered heartbeat's `at`. The one frame that renews the
   * machine's lease, fenced by the generation. */
  | { t: 'hb-ack'; generation: number; at: string }
  /** An event the daemon refused on import (it kept it out of its log). Distinct from the hub's own `refused`. */
  | ({ t: 'rejected'; project: string } & Rejection)
  /**
   * Opens a project on this stream: the machine's vector, and the project's name from `.smns`. `follow: true` says the
   * machine holds no checkout and no session of the project and opens it only to read and deliver (the org's
   * directory): its lease starts and renews as any, but counts toward none of the project's machines, and it posts no
   * presence. A hello without it (or `false`) holds the project, as before; a later hello on the stream changes which.
   */
  | { t: 'hello'; project: string; name: string; have: Vector; follow?: boolean }
  /** Only the machine's own writers' events (and `legacy/` from the archive machine), each writer's in seq order. */
  | { t: 'events'; project: string; events: LogEvent[] }
  /** A result the daemon's ledger holds; republished after every reconnect until `rpc-ack`. */
  | { t: 'rpc-result'; project: string; nonce: string; outcome: RpcOutcome }
  | { t: 'session'; message: SessionMessage }
  /** The machine's complete pending set for the project, sent after every reconnect; anything missing is dropped. */
  | { t: 'pending'; project: string; raised: Raised[] }
  | Part;

// ---- RL1 (O11 M6; Interfaces §C, whose own frames are org-protocol's relay.ts) ------------------------------------------

/** The endpoint's one WebSocket (RL1), with its Access service token as DX2's stream. */
export const MACHINE_SOCKET_PATH = '/machine/socket';
/** A member's (or device's) WebSocket to a machine's object, for channels; `<machine>` is its ref or its name. */
export const APP_SOCKET_PATH = /^\/api\/machines\/([^/]+)\/socket$/;

/**
 * The DX2 frames RL1 carries up, beside its own: the log plane alone. RL1 machines send no DX4/DX6 session-plane frame
 * (`session`, `pending`, `rpc-result`), which travel in channels; the hub refuses one `422 not-on-rl1`.
 */
export type Rl1LogUp = Extract<UpFrame, { t: 'hello' | 'events' | 'rejected' }> | Part;
/** The DX2 frames RL1 carries down: the log plane's answers and fan-out. A project's session-plane frame for a machine
 * on RL1 is not sent to it. */
export type Rl1LogDown = Extract<DownFrame, { t: 'have' | 'events' | 'resend' | 'refused' }>;
export const RL1_LOG_DOWN: ReadonlySet<string> = new Set<Rl1LogDown['t']>(['have', 'events', 'resend', 'refused']);
export const RL1_LOG_UP: ReadonlySet<string> = new Set<Rl1LogUp['t']>(['hello', 'events', 'rejected', 'part']);
/** DX2's up frames that are not RL1's: refused on RL1 `422 not-on-rl1`. */
export const NOT_ON_RL1: ReadonlySet<string> = new Set<UpFrame['t'] | 'hb-ack'>(['session', 'pending', 'rpc-result', 'hb-ack']);
