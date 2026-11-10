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
  /** M6b's. How often the rows read each machine's channel listings (`endpoint.listings`) while its link is up. */
  ROWS_CHANNEL_MS: number;
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
  /** M4a's. A pairing code this Mac makes lives this long: `deployment admin pair`'s maximum, the hub's entry TTL. */
  PAIR_TTL_MS: number;
  /** How often a pairing reads the target member's pending entries (`pair`'s 2 s). */
  PAIR_POLL_MS: number;
  /** M4b's. How often an enrollment reads its machine's posted key (`enroll`'s 5 s, `ENROLL_POLL_MS` in admin.ts). */
  ENROLL_POLL_MS: number;
  /** M7a's. A project's channel lives this long after its last tab closes. */
  CHANNEL_RELEASE_MS: number;
  /** A project's cache keeps the newest events up to both bounds, by offset (M7a's *The cache*). */
  CHANNEL_CACHE_EVENTS: number;
  /** The file's UTF-8 bytes. */
  CHANNEL_CACHE_BYTES: number;
  /** A channel's changes are coalesced this long before its cache is written, and before `org.channel.changed`. */
  CHANNEL_WRITE_MS: number;
  CHANNEL_COALESCE_MS: number;
  /**
   * M7b's. Each machine's to-human entries a project's channel keeps, the newest by time up to both bounds (M7b's Main
   * bullet: 500), in `<project>.machines.json`; the bytes are the entries' JSON in UTF-8, so a run of the journal's longest
   * texts (64 KiB each) can't make one machine's share of the file or of the tab's answer more than this.
   */
  CHANNEL_MACHINE_ENTRIES: number;
  CHANNEL_MACHINE_BYTES: number;
  /**
   * M4c's. The hub's provisioning-key list is read when the Org page is shown (at an `org.view`) only once its last read
   * started this long ago, so the page's own re-reads don't ask the hub at each `org.changed`.
   */
  KEYS_FRESH_MS: number;
  /**
   * P5 O15 M2b §G (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): the Registry feed and each Project
   * socket send a protocol ping this often from their `open`, the period of mawsd's own heartbeat to the hub, so a dead
   * socket is found within 20 s; a ping with no pong within HUB_PONG_MS drops it (the pongs took 8 to 64 ms on staging).
   */
  HUB_PING_MS: number;
  HUB_PONG_MS: number;
  /** An open made while the reach's window is open is given this long to be answered (wsSocket's 10 s otherwise). */
  HUB_WINDOW_OPEN_MS: number;
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
  ROWS_CHANNEL_MS: 60_000,
  WEEKLY_DUE_DAYS: 7,
  ASK_GAP_MS: 86_400_000,
  WEEKLY_CHECK_MS: 3_600_000,
  DELIVERY_RETRY_MS: 3_600_000,
  DELIVERY_MAX_BYTES: 524_288,
  PAIR_TTL_MS: 600_000,
  PAIR_POLL_MS: 2_000,
  ENROLL_POLL_MS: 5_000,
  CHANNEL_RELEASE_MS: 30_000,
  CHANNEL_CACHE_EVENTS: 5_000,
  CHANNEL_CACHE_BYTES: 8 * 1024 * 1024,
  CHANNEL_WRITE_MS: 1_000,
  CHANNEL_COALESCE_MS: 100,
  CHANNEL_MACHINE_ENTRIES: 500,
  CHANNEL_MACHINE_BYTES: 4 * 1024 * 1024,
  KEYS_FRESH_MS: 30_000,
  HUB_PING_MS: 15_000,
  HUB_PONG_MS: 5_000,
  HUB_WINDOW_OPEN_MS: 2_000,
});

export const orgTiming = (overrides: Partial<OrgTiming> = {}): OrgTiming => ({ ...ORG_TIMING, ...overrides });
