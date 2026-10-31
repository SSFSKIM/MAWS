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
] as const;
export type Capability = (typeof DEVICE_CAPABILITIES)[number];

/** Whether the peer of the current channel listed `capability` in its handshake; false while no channel is current. */
export function peerLists(link: { peerCapabilities(): readonly string[] | null }, capability: Capability): boolean {
  return link.peerCapabilities()?.includes(capability) === true;
}

/** The capability a peer must list before an act or a query names `executor`; RL2's first three need none. */
const EXECUTOR_CAPABILITY: Readonly<Partial<Record<Executor, string>>> = { machine: 'rl2.executor.machine' };

/** Whether a peer that listed `capabilities` reads acts and queries for `executor`. */
export function peerTakesExecutor(executor: Executor, capabilities: readonly string[]): boolean {
  const needed = EXECUTOR_CAPABILITY[executor];
  return needed === undefined || capabilities.includes(needed);
}
