// The project channel's verification (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's
// *Verification* and Proves for verify.test.ts): a device's `human` verified by its signature alone, its member the
// author; a machine's v2 event with its attested owners; a forged event failing and verifying at a head that admits its
// signer; DX1 history `migrated` under a machine's attestation, `legacy` past it or under none, and other bytes at a
// covered position never `migrated`; a withheld tombstone skipped. Real signed states, events and records, made with the
// protocol package's own signing.
import { describe, expect, it } from 'vitest';
import { generateSigningKey } from '../../../../apps/org-protocol/src/index.ts';
import { ChannelOrg as Org, ORG, S1, type Machine } from '../../../../test/org/channel-world';
import { checkpointOf, eventHash, judgeEvent, recheckCheckpoint } from './verify';

const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('');

describe("a device's human", () => {
  it('verifies by its signature alone, its author the writer\'s member as the held head names them', async () => {
    const o = await Org.make();
    const words = await o.human(o.B, o.bDevice, 1, 'hello from Ana');
    expect(await judgeEvent(words, o.judging())).toEqual({ label: 'verified', author: { id: o.B, email: 'ana@example.com', name: 'Ana' } });
    const mine = await o.human(o.A, o.app, 1, 'hi');
    expect(await judgeEvent(mine, o.judging())).toEqual({ label: 'verified', author: { id: o.A, email: 'sam.owner@example.com', name: 'Sam' } });
  });

  it("fails when its writer's member is not the event's member, whoever signed it", async () => {
    const o = await Org.make();
    const elsewhere = await o.human(o.B, o.bDevice, 1, 'mine, filed as A', o.A);
    expect(await judgeEvent(elsewhere, o.judging())).toMatchObject({ failed: expect.any(String) });
  });

  it("fails when another member's device signed it", async () => {
    const o = await Org.make();
    const forged = await o.human(o.A, o.bDevice, 1, 'B signing as A');
    expect(await judgeEvent(forged, o.judging())).toMatchObject({ failed: expect.any(String) });
  });
});

describe("a machine's v2 event", () => {
  it('verifies with its attested owners, named from the held head', async () => {
    const o = await Org.make();
    expect(await judgeEvent(await o.say(o.mini, 1, 'hello'), o.judging())).toEqual({
      label: 'verified',
      owners: [{ id: o.A, email: 'sam.owner@example.com', name: 'Sam' }],
    });
  });

  it('verifies without owners when its attestation claims an owner the machine lacks', async () => {
    const o = await Org.make();
    expect(await judgeEvent(await o.say(o.mini, 1, 'B owns me', [o.B]), o.judging())).toEqual({ label: 'verified' });
  });

  it('fails when its signer is no key of the writer, then verifies at a head that lists that key', async () => {
    const o = await Org.make();
    const studio: Machine = { name: 'studio', ref: `studio${random(20)}`, key: await generateSigningKey() };
    const event = await o.say(studio, 1, 'before my enrollment');
    expect(await judgeEvent(event, o.judging())).toMatchObject({ failed: expect.any(String) });
    await o.adopt((s) => {
      s.machines.push({ name: 'studio', ref: studio.ref, pub: studio.key.pub, owners: [o.A] });
      s.machineNames.push({ name: 'studio', ref: studio.ref });
    });
    expect(await judgeEvent(event, o.judging())).toEqual({ label: 'verified', owners: [{ id: o.A, email: 'sam.owner@example.com', name: 'Sam' }] });
  });

  it('fails when its text was changed after signing', async () => {
    const o = await Org.make();
    const event = { ...(await o.say(o.mini, 1, 'original')), text: 'altered' };
    expect(await judgeEvent(event, o.judging())).toMatchObject({ failed: expect.any(String) });
  });
});

describe('DX1 history', () => {
  async function attested(o: Org, count = 3) {
    const events = Array.from({ length: count }, (_, i) => o.dx1('oldmini', i + 1));
    const record = await o.attest(events);
    const cp = await checkpointOf(record, events, o.judging());
    return { events, record, cp };
  }

  it("reads `migrated` with the attesting machine's name under a checkpoint its record and events verify", async () => {
    const o = await Org.make();
    const { events, cp } = await attested(o);
    expect(cp).toMatchObject({ writer: events[0].writer, upTo: 3, by: { ref: o.mini.ref, name: 'mini' } });
    const checkpoints = new Map([[cp!.writer, cp!]]);
    for (const event of events) expect(await judgeEvent(event, o.judging(checkpoints))).toEqual({ label: 'migrated', by: 'mini' });
  });

  it('reads `legacy` past its upTo, and under no attestation', async () => {
    const o = await Org.make();
    const { cp } = await attested(o);
    const checkpoints = new Map([[cp!.writer, cp!]]);
    expect(await judgeEvent(o.dx1('oldmini', 4), o.judging(checkpoints))).toEqual({ label: 'legacy' });
    expect(await judgeEvent(o.dx1('other', 1, 'unattested', S1), o.judging(checkpoints))).toEqual({ label: 'legacy' });
    expect(await judgeEvent(o.dx1('oldmini', 1), o.judging())).toEqual({ label: 'legacy' });
  });

  it('never reads other bytes at a covered position `migrated`: they fail', async () => {
    const o = await Org.make();
    const { cp } = await attested(o);
    const forged = o.dx1('oldmini', 2, 'not what mini attested');
    expect(await judgeEvent(forged, o.judging(new Map([[cp!.writer, cp!]])))).toMatchObject({ failed: expect.any(String) });
  });

  it("makes no checkpoint from a record the events don't fold to, from one missing a position, or from another project's", async () => {
    const o = await Org.make();
    const events = [o.dx1('oldmini', 1), o.dx1('oldmini', 2)];
    const record = await o.attest(events);
    expect(await checkpointOf(record, [events[0], o.dx1('oldmini', 2, 'swapped')], o.judging())).toBeNull();
    expect(await checkpointOf(record, [events[1]], o.judging())).toBeNull();
    expect(await checkpointOf(record, events, { ...o.judging(), ctx: { org: ORG, project: '2f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0' } })).toBeNull();
  });

  it("binds each covered position to the hash of the exact event that passed, and re-checks the record's signer alone", async () => {
    const o = await Org.make();
    const { events, cp } = await attested(o, 2);
    expect(cp!.hashes).toEqual({ '1': eventHash(events[0]), '2': eventHash(events[1]) });
    expect(await recheckCheckpoint(cp!, o.judging())).toBe(true);
    // a head that revokes the attesting machine's key leaves the record without a signer
    await o.adopt((s) => {
      s.machines = s.machines.filter((m) => m.ref !== o.mini.ref);
    });
    expect(await recheckCheckpoint(cp!, o.judging())).toBe(false);
  });
});

describe('the rest', () => {
  it('skips a withheld tombstone', async () => {
    const o = await Org.make();
    expect(await judgeEvent({ writer: `mini/${S1}`, seq: 4, withheld: true }, o.judging())).toBeNull();
  });

  it('fails an event with neither a signature nor a code, and one without a position', async () => {
    const o = await Org.make();
    expect(await judgeEvent({ writer: `mini/${S1}`, seq: 1, kind: 'say', text: 'bare' }, o.judging())).toMatchObject({ failed: 'malformed' });
    expect(await judgeEvent({ kind: 'say' }, o.judging())).toMatchObject({ failed: 'malformed' });
  });
});
