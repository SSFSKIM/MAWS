// DX8 — the session plane as the shell hands it to the depth panel (DC6): one DX4 subscription per transcript, kept
// whole by the hub client. A consumer never sees a gap in `n`, a frame of a subscription it gave up, or a dropped
// socket: the client turns each discontinuity into `interrupted` and subscribes again, and a fresh snapshot follows.
import type { JsonObject, JsonValue, ReadErrorCode, SessionBodies, SessionMessage, SubscriptionKind } from 'desk-hub/protocol';

/** One transcript: a session's main thread (`agentId` null) or one of its subagents. */
export type SessionTarget = { machine: string; session: string; agentId: string | null };

/**
 * The messages a subscription delivers to its listener: everything of DX4's subscription kinds but `end` and `read` —
 * `usage` (context use and cost, main-transcript subscriptions only) and `output` (a task's output tail, answering
 * `output()`) passed through like the rest; a `read`'s answer settles the promise `read()` returned instead.
 */
export type SubscriptionMessage = SessionMessage<Exclude<SubscriptionKind, 'end' | 'read'>>;

export interface SubscriptionListener {
  /** In order: `snapshot` (n 0) first, then n = 1, 2, … with no gap. */
  message(message: SubscriptionMessage): void;
  /**
   * A discontinuity the client recovers from (a gap in `n`, a dropped socket, a hub restart, the bridge's own
   * `end {discontinuity}`): nothing more follows on the subscription as it was, and what it delivered stays valid as far
   * as it went — rows are never taken back, so a consumer may keep drawing them. The client subscribes again, and a
   * fresh snapshot (n 0) follows once the hub answers; the consumer merges it into what it holds. Until it does, nothing
   * asked of the subscription (`rows`, `diff`, `output`) is answered: ask again once the fresh snapshot is in.
   */
  interrupted(): void;
  /** The hub ended the subscription, or the client cannot serve it; nothing follows. Subscribe again to resume. */
  end(body: SessionBodies['end']): void;
  /**
   * P5 O9 M9: an ask the plane could not carry to the machine (another machine's link down when it was asked), with
   * why: no answer follows, and the subscription stands, so the consumer clears what waited and asks again once the
   * plane delivers again. The hub's client never calls it (an ask it cannot carry waits for the fresh snapshot instead).
   */
  unanswered?(ask: UnansweredAsk, message: string): void;
  /**
   * P5 O9 M9: the plane's transport is back after a pause (another machine's link): nothing was lost, no snapshot
   * follows, and the subscription goes on as it was; never a discontinuity. An ask it could not carry is asked again.
   */
  resumed?(): void;
}

export type UnansweredAsk = { kind: 'rows' } | { kind: 'diff' } | { kind: 'output'; taskId: string };

export interface Subscription {
  /** Older rows before row `before`, newest first; they arrive as a `rows` message. */
  rows(before: string, limit: number): void;
  /**
   * The session's working-tree diff against its base branch, computed on request and answered as a `diff` message; a
   * main-transcript subscription's only (`agentId` null), and nothing is sent on an agent's.
   */
  diff(): void;
  /**
   * The last `tail` bytes of a background task's output file, read on request and answered as an `output` message in
   * one of DX4's four variants; on a main or an agent subscription (a job belongs to the loop whose rows started it).
   * `tail` is brought within 1 to 524288 bytes; a `taskId` the engine never spells (`isTaskId`) is not asked for.
   */
  output(taskId: string, tail: number): void;
  /**
   * A read of the session (the desk control surface spec, §5): one DX3 `read` on the subscription, and its DX4 answer
   * correlated by id, which never reaches the listener. Resolves with the answer's `result`; rejects with a `ReadError`
   * carrying the answer's `error`, `timeout` past 15 s (the machine's own 10 s and the hops), `interrupted` when the
   * subscription dropped or closed before the answer (ask again once a fresh snapshot is in), and `unsupported` at once
   * on a subagent's subscription (every M0 kind is the main transcript's).
   */
  read(what: string, args?: JsonObject): Promise<JsonValue>;
  /** Ends the subscription; the listener hears nothing more. */
  close(): void;
}

/** Why a read was not answered: the machine's codes (DX4 `read`'s `error`), or `interrupted`, this browser's own. */
export class ReadError extends Error {
  override readonly name = 'ReadError';
  constructor(
    readonly code: ReadErrorCode | 'interrupted',
    message: string,
  ) {
    super(message);
  }
}

export interface SessionPlane {
  subscribe(target: SessionTarget, listener: SubscriptionListener): Subscription;
}
