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
  // M5a: a `sub` may name the machine's `artifacts` feed (§R): its artifact and library changes, cut by the artifact rule.
  'rl2.artifacts',
  // M5a: a call's `input` and `output` and an act's `args` and `result` carry bytes in json-bytes' tagged form
  // (`{"$bytes": "<base64>"}`, `$plain` escaped): decoded and encoded here only for a device that listed it (bytes.ts).
  'rl2.bytes',
  // M5b: the read open (§N): a `streamOpen` with no `op` of the kinds `http` (an artifact page's request) and `document`
  // (an artifact's document channel), admitted by a stream row of the offer table; `streamOpened.http`; the refusal
  // `read-only`, sent only in answer to a read open. A read open from a device that listed none of it is `malformed`.
  'rl2.read-open',
  // M7: `pong` carries this machine's clock at the ping's arrival (`received`) and the pong's send (`sent`), which the
  // remote bench reads to place the machine's clock against the device's. Optional fields an older device passes by.
  'rl2.pong-clock',
  // M5c: the client port across the channel: `client` (a machine service's request for the asking device, posted only to
  // a device that listed it) and the device's `clientAnswer` (client-port.ts).
  'rl2.client-port',
  // M5c (round 3): a remote dashboard's snapshot holds, main's link's calls `artifacts.holdAssets` and `releaseAssets`,
  // which this endpoint keeps per channel (asset-holds.ts); a device asks them only of an endpoint that listed it.
  'rl2.asset-holds',
  // P5 O17 M9a (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §K): the agent's browser on a session.
  // The read open's `browser.screencast` kind (its `browser` fields, `streamOpened.browser`, the frame envelope, the
  // controls `ack` and `input`, the refusals `engine-changed` and `control-busy`), the act `machine.browserControl` and a
  // session's `browser.inventory` feed. A screencast open from a device that listed none of it is `malformed`.
  'rl2.browser-screencast',
  // P5 O7 M8 ("The attachment"): `session.send`'s `uploads`, files of the session's upload root this endpoint reads into
  // the send as document blocks before the engine host sees it (send-uploads.ts); a device names them only to an
  // endpoint that listed it, since an older one holds the send's args to a schema without them (`malformed`).
  'rl2.upload-blocks',
  // 2026-11-06 (the New chat's machine first): `session.spawn`'s `checkout: '~'` (HOME_CHECKOUT) from a machine owner, a
  // chat in this machine's home with no project (policy.ts' `spawnRefusal`); a device's menu offers it only on an endpoint
  // that listed it, since an older one answers it `unknown-checkout`.
  'rl2.spawn-home',
  // 2026-11-06 (the remote lane A drill-in): a lane A session's `full` stream may name one subagent's transcript (`sub`'s
  // `agentId`), held as an upstream subscription of that agent's own in sminos (plane-a.ts), its `rows`, `output` and
  // `read` asked of that transcript; a device names one only to an endpoint that listed it, since an older one passes the
  // field by and would serve the main transcript in its place.
  'rl2.agent-scope',
  // P5 O8 M7b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Decision Log "M7b's channel feed"): a `sub` may name
  // the machine's `channel` feed with its `project` (channel-feed.ts): that project's to-human entries the member views, a
  // snapshot of the newest page and each new one after it. A device opens it only on an endpoint that listed it: an older
  // one reads the sub `malformed` and closes the channel.
  'rl2.channel',
  // The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, M9; Interfaces §G): this endpoint serves
  // `session.projects.link`, `relocate`, `resolve`, `update` and `remove`, and `addFolder`'s `into` and `own`; a device
  // sends a machine none of them, nor `remove`'s `expect`, unless its `h2` listed it (PROJECT_ACTS_CAPABILITY).
  'rl2.project-acts',
  // The UX wave (U9, UC-7.4; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md): this endpoint offers the
  // session acts `session.archive`, `session.update` (an unarchive alone), `session.rename`, `attention.acknowledge`,
  // `session.steer.cancel` and `maws.pane.answer`, and the archived sessions' read `session.list {includeArchived: true}`;
  // a device sends a machine none of them unless its `h2` listed it (SESSION_ACTS_CAPABILITY), since an older one has no
  // row for them and answers `not-offered`.
  'rl2.session-acts',
] as const;
