// The RL2 link's timing (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §G): one
// object, each field overridable in tests. The bucket mirrors the endpoint's direct listener (`HANDSHAKE_LIMITS.perSource`)
// and the resume window its `RESUME_MS`; timing.test.ts holds both equal to the endpoint's constants.

export interface RemoteTiming {
  /** How long the direct carrier's WebSockets race before the relay is taken (P5 §3's short timeout). */
  DIRECT_DIAL_MS: number;
  /** Direct handshakes per machine: a burst, refilling at `perMinute`, as the listener allows one source address. */
  DIRECT_BUCKET: { burst: number; perMinute: number };
  /** While on the relay, how often the direct carrier is tried again. */
  DIRECT_RECHECK_MS: number;
  /** The endpoint record's fetch from the hub. */
  RECORD_FETCH_MS: number;
  /** How long `up` survives a lost channel while an attempt runs. */
  UP_GRACE_MS: number;
  /** The delays before each attempt after a loss, the last repeated; each jittered by `BACKOFF_JITTER`. */
  BACKOFF_MS: readonly number[];
  BACKOFF_JITTER: number;
  /** Past this since the loss, attempts come every `SLOW_RETRY_MS` (the endpoint keeps a dropped channel's interest this long). */
  RESUME_WINDOW_MS: number;
  SLOW_RETRY_MS: number;
  /** A silent period: after this long without a message, a `ping`; two in a row without a `pong` end the channel. */
  PING_SILENCE_MS: readonly [number, number];
  /** A probe's `ping` is answered within this, or the channel is lost (`timeout`). */
  PROBE_PONG_MS: number;
  /** How often the network watch reads the interface addresses. */
  NETWORK_POLL_MS: number;
  CALL_TIMEOUT_MS: number;
  /** An act is sent, or resealed, only within this of its creation (`FRESH_MS`). */
  ACT_FRESH_MS: number;
  /** No `ack` within this on a live channel: the act is ambiguous, and asked after. */
  ACK_TIMEOUT_MS: number;
  /** No `done` within this after `accepted`: asked after. */
  DONE_QUERY_MS: number;
  /** The delays between queries that answer `in-progress` or `unavailable`, the last repeated. */
  QUERY_BACKOFF_MS: readonly number[];
  SUB_INITIAL_CREDIT: number;
  /** Credit goes back once this many bytes were delivered, or `CREDIT_BATCH_MS` after the first undelivered byte. */
  CREDIT_BATCH_BYTES: number;
  CREDIT_BATCH_MS: number;
}

/** How many subscriptions the endpoint allows one channel (its `MAX_SUBS`); one more is `ended('busy')` without a round trip. */
export const MAX_SUBS = 64;

export const REMOTE_TIMING: RemoteTiming = {
  DIRECT_DIAL_MS: 1000,
  DIRECT_BUCKET: { burst: 3, perMinute: 5 },
  DIRECT_RECHECK_MS: 60_000,
  RECORD_FETCH_MS: 2000,
  UP_GRACE_MS: 2000,
  BACKOFF_MS: [0, 1000, 2000, 4000, 5000],
  BACKOFF_JITTER: 0.2,
  RESUME_WINDOW_MS: 120_000,
  SLOW_RETRY_MS: 30_000,
  PING_SILENCE_MS: [5000, 7000],
  PROBE_PONG_MS: 2000,
  NETWORK_POLL_MS: 2000,
  CALL_TIMEOUT_MS: 10_000,
  ACT_FRESH_MS: 60_000,
  ACK_TIMEOUT_MS: 10_000,
  DONE_QUERY_MS: 60_000,
  QUERY_BACKOFF_MS: [1000, 2000, 4000, 8000, 15_000],
  SUB_INITIAL_CREDIT: 1024 * 1024,
  CREDIT_BATCH_BYTES: 256 * 1024,
  CREDIT_BATCH_MS: 250,
};

/** `REMOTE_TIMING` with a test's overrides. */
export const timingOf = (overrides: Partial<RemoteTiming> = {}): RemoteTiming => ({ ...REMOTE_TIMING, ...overrides });

/**
 * A token bucket: `burst` tokens, refilling at `perMinute`. The link takes one for each direct handshake, so its attempts
 * stay inside the listener's per-source limit and never spend the token the next probe needs.
 */
export class TokenBucket {
  #tokens: number;
  #at: number;
  constructor(
    private readonly limit: { burst: number; perMinute: number },
    private readonly now: () => number,
  ) {
    this.#tokens = limit.burst;
    this.#at = now();
  }

  take(): boolean {
    const at = this.now();
    this.#tokens = Math.min(this.limit.burst, this.#tokens + ((at - this.#at) * this.limit.perMinute) / 60_000);
    this.#at = at;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}
