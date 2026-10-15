// DX2 — machine ↔ hub. One connection per machine, opened outbound and multiplexing its projects: an SSE stream down
// (`GET /machine/stream`), held by the machine's `Machine` object, and frames up by POST (`POST /machine/frames`, one
// JSON frame per line), each addressed to a project and routed by the Worker to that `Project` object.
import type { LogEvent, Vector } from './log';
import type { Part } from './parts';
import type { Rpc, RpcOutcome } from './rpc';
import type { Raised, SessionMessage } from './session';

/**
 * The `Machine` object writes a `hb` frame this often; the daemon treats a stream silent for three periods as dead, and
 * answers each `hb` with an `hb-ack` up. Only the daemon's traffic renews the machine's lease (M3): the hub's own
 * heartbeat never does, so a suspended daemon or a half-open stream lapses.
 */
export const HEARTBEAT_MS = 15_000;

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
    | 'stale-generation';
  writer?: string;
  seq?: number;
  message: string;
};

/** Hub → machine, one per SSE event (`event: <t>`, `data: <the frame's JSON>`). */
export type DownFrame =
  /** First on every stream. `generation` counts this machine's streams; a newer one supersedes every older one. */
  | { t: 'welcome'; org: string; machine: string; generation: number; heartbeat_ms: number }
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
  | Part;

/**
 * Why a daemon refused an event the hub sent it (DX1): its code does not verify (`bad-code`, which includes a `hub/`
 * event whose position fails its shape and an event transplanted from another project), its nonce was seen before
 * (`seen-nonce`), or it is not a log event the daemon can read (`bad-shape`).
 */
export type RejectionReason = 'bad-code' | 'seen-nonce' | 'bad-shape';

/** A daemon's report of an event it refused; the hub keeps it in the project's audit record and shows it to browsers. */
export type Rejection = {
  /** The event's position as it arrived. */
  event: { writer: string; seq: number };
  /** Its `mac.nonce`, when it had one. */
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
  /** Opens a project on this stream: the machine's vector, and the project's name from `.smns`. */
  | { t: 'hello'; project: string; name: string; have: Vector }
  /** Only the machine's own writers' events (and `legacy/` from the archive machine), each writer's in seq order. */
  | { t: 'events'; project: string; events: LogEvent[] }
  /** A result the daemon's ledger holds; republished after every reconnect until `rpc-ack`. */
  | { t: 'rpc-result'; project: string; nonce: string; outcome: RpcOutcome }
  | { t: 'session'; message: SessionMessage }
  /** The machine's complete pending set for the project, sent after every reconnect; anything missing is dropped. */
  | { t: 'pending'; project: string; raised: Raised[] }
  | Part;
