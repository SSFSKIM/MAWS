// The page server's clocks and deadlines (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §J), on the
// daemon's run path with serve.ts; a test shortens any of them through `SheetPageOptions.timing`.
export interface SheetPageTiming {
  heartbeatMs: number; // the timer's tick: an owed replace of the browsers' file tried again (T10); the registration from M3 (X4)
  portRetryMs: number; // a taken port tried again (T4)
  codeTtlMs: number; // a pairing code's life (T8)
  helloMs: number; // each step of the live connection's opening (§L)
  pingMs: number; // a live connection's ping
  silentMs: number; // a live connection heard nothing for this long is ended
  lastSeenGrainMs: number; // a browser's lastSeenAt is written at most this often (T10)
  credentialIdleMs: number; // a credential unused this long is refused (T10)
  headersMs: number; // Node's headersTimeout
  requestMs: number; // Node's requestTimeout
  keepAliveMs: number; // Node's keepAliveTimeout
  checkMs: number; // Node's connectionsCheckingInterval: the deadlines above are enforced at its ticks
  refreshMs: number; // while a paired live connection is open, the holders are brought up to date this often (the discovery wake's freshness)
  stallMs: number; // a connection with bytes queued that its peer took none of for this long is ended (checked every checkMs)
}

export const SHEET_PAGE_TIMING: SheetPageTiming = {
  heartbeatMs: 10_000,
  portRetryMs: 30_000,
  codeTtlMs: 300_000,
  helloMs: 5_000,
  pingMs: 20_000,
  silentMs: 45_000,
  lastSeenGrainMs: 3_600_000,
  credentialIdleMs: 90 * 24 * 3_600_000,
  headersMs: 10_000,
  requestMs: 30_000,
  keepAliveMs: 5_000,
  checkMs: 1_000,
  refreshMs: 30_000,
  stallMs: 10_000,
};
