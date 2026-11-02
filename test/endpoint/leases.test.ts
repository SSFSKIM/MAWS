// A lease's re-authorization (P5 O7 M5c1 fix wave 1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "O4's
// surfaces: leases, the window, delivery on the machine"). A lease is decided again at every change that can move its
// decision (the artifact cache's drops: a caps refresh, a new head, a record change, a relink), and a decision is used
// only in the step it is still the latest change's: one taken before a change since is taken again, after the retry
// delay, never at once and never past the last delay. Through `Leases` alone, with authorization a stand-in: what these
// prove is the order of decisions and changes, which an integrated run can't place.
import { afterEach, describe, expect, it } from 'vitest';
import { endableClientRef, type EndableClientRef } from '@shared/ipc/client';
import type { ArtifactRanks } from '../../src/endpoint/artifacts';
import type { Decision } from '../../src/endpoint/authorize';
import type { RemoteChannel } from '../../src/endpoint/channels';
import { Leases } from '../../src/endpoint/leases';
import { until } from './sub-harness';

const RETRIES = [20, 20, 20];
const made: Leases[] = [];
afterEach(() => {
  for (const leases of made.splice(0)) leases.stop();
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Leases over a stand-in authorization (`decide`, asked once per decision) and a cache whose drops the test fires. */
function setup(decide: (n: number) => Promise<Decision>) {
  const drops = new Set<() => void>();
  const artifacts = {
    onDropped: (listener: () => void) => (drops.add(listener), () => void drops.delete(listener)),
    // the placement is the machine's to give and it can't now: an owner's decision doesn't rest on it
    of: async () => ({ resolved: { kind: 'refused', reason: 'unavailable' }, current: () => true }),
  } as unknown as ArtifactRanks;
  const closes: Array<{ input: unknown; client: unknown }> = [];
  let decisions = 0;
  const leases = new Leases({
    authorize: () => decide(++decisions),
    dispatch: async (_owner, name, input, client) => {
      if (name === 'connectors.close') closes.push({ input, client });
      return { ok: true, value: { closed: true } } as never;
    },
    artifacts,
    now: () => Date.now(),
    log: () => {},
    recheckRetryMs: RETRIES,
  });
  made.push(leases);
  const client: EndableClientRef = endableClientRef('channel-1');
  const channel = { closed: false, client, member: 'm', device: 'd', clientClass: 'desktop', key: 'k' } as unknown as RemoteChannel;
  return { leases, channel, client, closes, decided: () => decisions, drop: () => [...drops].forEach((listener) => listener()) };
}

describe('a lease decided again', () => {
  it('rests a machine owner’s lease on its own decision, whose placement can’t be had: a bounded number of decisions, the lease kept', async () => {
    const { leases, channel, client, closes, decided, drop } = setup(async () => {
      await pause(1);
      return { ok: true }; // the owner's standing, taken with no placement
    });
    leases.opened(channel, 'art-1', 'lease-1');
    await pause(150);
    expect(decided()).toBe(1);
    // a burst of changes is decided again, not once per change at once
    for (let i = 0; i < 5; i++) drop();
    await pause(150);
    expect(decided()).toBeLessThanOrEqual(3);
    expect(leases.lease(client, 'lease-1')).toBe('art-1');
    expect(closes).toEqual([]);
  });

  it('asks an unanswerable decision again only after each retry delay, and closes the lease after the last', async () => {
    const { leases, channel, client, closes, decided } = setup(async () => ({ ok: false, reason: 'unavailable' }));
    leases.opened(channel, 'art-1', 'lease-1');
    await pause(5);
    expect(decided()).toBe(1);
    await until(() => closes.length === 1, 'the close', 2000);
    expect(decided()).toBe(RETRIES.length + 1);
    expect(closes[0]).toEqual({ input: { leaseId: 'lease-1' }, client });
    expect(leases.lease(client, 'lease-1')).toBeNull();
  });

  it('keeps a lease re-granted between a refusal’s making and its use: the refusal predates the change, so it is decided again', async () => {
    let refuse!: () => void;
    const { leases, channel, client, closes, decided, drop } = setup((n) =>
      n === 1 ? new Promise<Decision>((resolve) => (refuse = () => resolve({ ok: false, reason: 'grade' }))) : Promise.resolve({ ok: true }),
    );
    leases.opened(channel, 'art-1', 'lease-1');
    await until(() => refuse !== undefined, 'the first decision asked');
    drop(); // the share given again (or the artifact relinked) while the refusal was being made
    refuse();
    await pause(100);
    expect(decided()).toBe(2);
    expect(closes).toEqual([]);
    expect(leases.lease(client, 'lease-1')).toBe('art-1');
  });

  it('closes a lease a refusal no change has overtaken, in the step it is decided, under the channel’s ref', async () => {
    const { leases, channel, client, closes } = setup(async () => ({ ok: false, reason: 'grade' }));
    leases.opened(channel, 'art-1', 'lease-1');
    await until(() => closes.length === 1, 'the close');
    expect(closes[0]).toEqual({ input: { leaseId: 'lease-1' }, client });
    expect(leases.lease(client, 'lease-1')).toBeNull();
  });
});
