// The endpoint's RL2 capabilities (P5 O7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §M): every
// addition to RL2's vocabulary this build reads and sends, listed in its `h2`. A device sends a new message kind, a new
// `executor`, a new optional field an older endpoint would find malformed, or a stream, only to an endpoint whose `h2`
// listed it, since an older one would close the channel; each milestone that adds one appends it here and moves
// `RL2_PROTOCOL.minor`. The device's own list is src/main/machines/remote/capabilities.ts.
export const ENDPOINT_CAPABILITIES = [
  // M2: `query.executor` may be `machine`, the services' ledger (`machine.op`, `machine.opQuery`).
  'rl2.executor.machine',
  // M4: a `call` may name its session (`session`), which the `checkout` target rule reads (git.*'s reads).
  'rl2.call-session',
  // M4: a `sub` may name a feed (`feed`, §R): `checkout` here; `attention` is read and refused `not-offered` until M6.
  'rl2.feeds',
  // M4 (acceptance 12): `session.events` takes `maxBytes` and answers `omitted` (the registry this build's front reads).
  'rl2.events-budget',
  // M3: `query.executor` may be `pty-host`, the pty host's ledger (`pty.opQuery`), which `pty.spawn`, `.attach`, `.kill`
  // and `.listFor` go to.
  'rl2.executor.pty-host',
  // M3: the stream kinds (`streamOpen` … `streamClose`, §N): a terminal's bytes and a forwarded port's connections.
  'rl2.streams',
] as const;
