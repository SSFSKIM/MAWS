// The org session's clocks (P5 O8, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §H). Each is a
// field of `OrgTiming`, so a test shortens it through `timing` rather than waiting it out.
export interface OrgTiming {
  /** The whole login transfer, the browser trip included (the spike's 15 minutes). */
  LOGIN_WAIT_MS: number;
  /** One long poll of the transfer service (`cloudflared`'s). */
  TRANSFER_POLL_MS: number;
  /** The wait before polling the transfer again after a non-200 answer below 500. */
  TRANSFER_RETRY_MS: number;
  /** How often registration reads the chain while it waits for the approving device. */
  APPROVAL_POLL_MS: number;
  /** One hub request's bound. */
  FETCH_TIMEOUT_MS: number;
  /**
   * How long a token fresh from the login may be refused by Access before it is believed (staging answered 401 for 5 s
   * to about a minute after a login, O11 M8), and the waits between tries within it.
   */
  FRESH_TOKEN_GRACE_MS: number;
  FRESH_TOKEN_RETRY_MS: readonly number[];
  /** The Registry feed's reconnect waits, the last repeated; each jittered by ±`FEED_JITTER`. */
  FEED_BACKOFF_MS: readonly number[];
  FEED_JITTER: number;
  /** How often the session reads the head, the transitions and the certificates with no `since`. */
  CERTS_REFRESH_MS: number;
  /** A token reads expired this long before its JWT's `exp`. */
  TOKEN_SKEW_MS: number;
  /** The Org section's warning tone for the head's age. */
  HEAD_WARN_DAYS: number;
  /** M2's. */
  ROWS_COALESCE_MS: number;
  ROWS_CACHE_WRITE_MS: number;
  UNVERIFIED_MAX: number;
  /** M3's. The weekly successor is due once the held head is this many days old (Q6). */
  WEEKLY_DUE_DAYS: number;
  /** The least time between two asks with Touch ID, and between two notifications (Q6's once a day). */
  ASK_GAP_MS: number;
  /** How often the weekly asking checks, while no window is focused, whether to notify. */
  WEEKLY_CHECK_MS: number;
  /** How often an owed delivery is sent again, besides at its machine's next link up. */
  DELIVERY_RETRY_MS: number;
  /**
   * The most bytes one `endpoint.state` run carries, from the receiving side: the run reaches the endpoint as one RL2
   * message, capped at MESSAGE_MAX_BYTES (4 MiB, org-protocol's channel.ts) and held by the endpoint's calls at that cap
   * less 1 KiB (src/endpoint/calls.ts). An eighth of it, which leaves margin for the call's envelope and the transitions.
   */
  DELIVERY_MAX_BYTES: number;
}

export const ORG_TIMING: Readonly<OrgTiming> = Object.freeze({
  LOGIN_WAIT_MS: 900_000,
  TRANSFER_POLL_MS: 60_000,
  TRANSFER_RETRY_MS: 1_000,
  APPROVAL_POLL_MS: 3_000,
  FETCH_TIMEOUT_MS: 10_000,
  FRESH_TOKEN_GRACE_MS: 120_000,
  FRESH_TOKEN_RETRY_MS: [2_000, 4_000, 8_000, 16_000],
  FEED_BACKOFF_MS: [1_000, 2_000, 4_000, 8_000, 16_000, 30_000],
  FEED_JITTER: 0.2,
  CERTS_REFRESH_MS: 600_000,
  TOKEN_SKEW_MS: 60_000,
  HEAD_WARN_DAYS: 21,
  ROWS_COALESCE_MS: 100,
  ROWS_CACHE_WRITE_MS: 1_000,
  UNVERIFIED_MAX: 1_024,
  WEEKLY_DUE_DAYS: 7,
  ASK_GAP_MS: 86_400_000,
  WEEKLY_CHECK_MS: 3_600_000,
  DELIVERY_RETRY_MS: 3_600_000,
  DELIVERY_MAX_BYTES: 524_288,
});

export const orgTiming = (overrides: Partial<OrgTiming> = {}): OrgTiming => ({ ...ORG_TIMING, ...overrides });
