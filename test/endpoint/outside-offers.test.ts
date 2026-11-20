// The two older builds a peer can be, at the endpoint's offer table and capability list (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, condition (g), §A's pairings; M2's
// "The older tables"): build F (`f1852de3a`, on the owner's machines) and master before U6e (`2c7044231`). Each peer's
// `src/endpoint/offers.ts` and `capabilities.ts` are committed copies under test/cross-build/peers/<commit>/
// (endpoint-offers.ts, endpoint-capabilities.ts), made by that folder's generate.sh, so this suite needs no git history
// and never skips. It lives among the endpoint's suites, the one place a suite may reach inside the endpoint module
// (eslint.config.js), since it runs this build's authorizer over each table. Over each
// peer's own table, this build's authorizer answers an owner's act of each of the four names `not-offered`, and the peer
// lists no `rl2.outside-files`, so a device of this build sends it none of them.
import { describe, expect, it } from 'vitest';
import { OUTSIDE_ACTS, OUTSIDE_FILES_CAPABILITY, TERMINAL_ACT } from '@shared/files/outside';
import { ENDPOINT_CAPABILITIES } from '../../src/endpoint/capabilities';
import { OFFERS, type Offers } from '../../src/endpoint/offers';
import { ENDPOINT_CAPABILITIES as capabilitiesMaster } from '../cross-build/peers/2c7044231/endpoint-capabilities';
import { OFFERS as offersMaster } from '../cross-build/peers/2c7044231/endpoint-offers';
import { ENDPOINT_CAPABILITIES as capabilitiesF } from '../cross-build/peers/f1852de3a/endpoint-capabilities';
import { OFFERS as offersF } from '../cross-build/peers/f1852de3a/endpoint-offers';
import { outsideWorld } from './outside-world';

const PEERS: Array<{ build: string; offers: Offers; capabilities: readonly string[]; last: string }> = [
  { build: 'f1852de3a', offers: offersF, capabilities: capabilitiesF, last: 'rl2.channel' },
  { build: '2c7044231', offers: offersMaster, capabilities: capabilitiesMaster, last: 'rl2.session-acts' },
];

describe.each(PEERS)('an endpoint of $build', ({ offers, capabilities, last }) => {
  it('is the table and the list of that build: a terminal’s row, capabilities up to its last', () => {
    expect(offers.commands[TERMINAL_ACT]).toEqual({ kind: 'act', executor: 'pty-host', target: 'machine' });
    expect(capabilities.at(-1)).toBe(last);
  });

  it('has no row for any of the four names and does not list the capability', () => {
    expect(OUTSIDE_ACTS.filter((name) => Object.hasOwn(offers.commands, name))).toEqual([]);
    expect(capabilities).not.toContain(OUTSIDE_FILES_CAPABILITY);
  });

  it('answers an owner’s act of each `not-offered` over its own table, where this build’s table admits it', async () => {
    const peer = await outsideWorld({ offers });
    const ours = await outsideWorld();
    for (const name of OUTSIDE_ACTS) {
      expect([name, await peer.decide(name, peer.callers.owner)]).toEqual([name, { ok: false, reason: 'not-offered' }]);
      expect([name, (await ours.decide(name, ours.callers.owner)).ok]).toEqual([name, true]);
    }
    // its terminal is the owner's as on this build: the table, not the caller, refuses the four
    expect((await peer.decide(TERMINAL_ACT, peer.callers.owner)).ok).toBe(true);
  });
});

it('is read against this build’s, which offers the four and lists the capability', () => {
  for (const name of OUTSIDE_ACTS) expect(Object.hasOwn(OFFERS.commands, name), name).toBe(true);
  expect(ENDPOINT_CAPABILITIES).toContain(OUTSIDE_FILES_CAPABILITY);
});
