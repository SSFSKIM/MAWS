// The device's RL2 capabilities (P5 O7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §M): every
// addition to RL2's vocabulary this build reads and sends, listed in its `h1` (`identity.capabilities`, which the org
// sessions fill from here). The link sends an addition only to a peer whose `h2` listed it, and refuses the request
// locally (`not-offered`) otherwise, since the peer would close the channel on it. Each milestone that adds one appends it
// here and moves `RL2_PROTOCOL.minor`. The endpoint's own list is src/endpoint/capabilities.ts.
import type { Executor } from '../../../../apps/org-protocol/src/index.ts';

export const DEVICE_CAPABILITIES = [
  // M2: `query.executor` may be `machine`, the services' ledger, which `session.acquire` and M4's writes go to.
  'rl2.executor.machine',
  // M4: a `call` may name the session a path-class read is made from (`session`; the endpoint's `checkout` rule).
  'rl2.call-session',
  // M4: a `sub` may name a feed (`feed`): a session's `checkout` feed (git, files and scm changes), M6's `attention`.
  'rl2.feeds',
  // M4 (acceptance 12): `session.events` may carry `maxBytes`, and answers `omitted` for an item alone past it.
  'rl2.events-budget',
  // M3: `query.executor` may be `pty-host`, the pty host's ledger, which a remote terminal's acts go to.
  'rl2.executor.pty-host',
  // M3: the stream kinds (§N), a terminal's bytes and a forwarded port's connections, opened under their acts.
  'rl2.streams',
  // M5a: a `sub` may name the machine's `artifacts` feed (artifact and library changes, no session).
  'rl2.artifacts',
  // M5a: a call's `input` and `output` and an act's `args` and `result` may carry bytes in json-bytes' tagged form.
  'rl2.bytes',
  // M5b: the read open (§N): a stream with no `op`, an artifact page's request (`http`) or its document (`document`),
  // sent only to an endpoint that listed it; the endpoint's `streamOpened.http` and its refusal `read-only`.
  'rl2.read-open',
  // M7: the link reads `pong`'s `received` and `sent` (the machine's clock) from an endpoint that listed it, and keeps
  // each pong's stamps for the remote bench (link.ts `pongs`, `ping`).
  'rl2.pong-clock',
  // M5c: the client port across the channel: the endpoint's `client` (a machine service's request of this device: a
  // consent page to open) and this device's `clientAnswer`.
  'rl2.client-port',
  // M5c (round 3): a remote dashboard's snapshot holds (`artifacts.holdAssets`, `releaseAssets`), asked by main alone and
  // only of an endpoint that listed it; without it the dashboard draws unheld (src/main/dashboard/holds.ts).
  'rl2.asset-holds',
  // P5 O17 M9a: the agent's browser on a session (O17's Interfaces §K): a `browser.screencast` stream (its frames, its
  // controls), opened only on an endpoint that listed it, and a session's `browser.inventory` feed; else `not-offered`.
  'rl2.browser-screencast',
] as const;
export type Capability = (typeof DEVICE_CAPABILITIES)[number];

/**
 * The endpoint's additions this device sends without reading anything new back, so it lists none of them in its own
 * `h1`: P5 O7 M8's `rl2.upload-blocks` (`session.send`'s `uploads`); 2026-11-06's `rl2.spawn-home` (`session.spawn`'s
 * `checkout: '~'`, which the machine menu offers only where the endpoint listed it: MachineState's `capabilities`).
 */
export type EndpointCapability = 'rl2.upload-blocks' | 'rl2.spawn-home';

/** Whether the peer of the current channel listed `capability` in its handshake; false while no channel is current. */
export function peerLists(link: { peerCapabilities(): readonly string[] | null }, capability: Capability | EndpointCapability): boolean {
  return link.peerCapabilities()?.includes(capability) === true;
}

/** The capability a peer must list before an act or a query names `executor`; RL2's first three need none. */
const EXECUTOR_CAPABILITY: Readonly<Partial<Record<Executor, string>>> = { machine: 'rl2.executor.machine', 'pty-host': 'rl2.executor.pty-host' };

/** Whether a peer that listed `capabilities` reads acts and queries for `executor`. */
export function peerTakesExecutor(executor: Executor, capabilities: readonly string[]): boolean {
  const needed = EXECUTOR_CAPABILITY[executor];
  return needed === undefined || capabilities.includes(needed);
}
