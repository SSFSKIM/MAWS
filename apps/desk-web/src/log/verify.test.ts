// Every log event is verified before it is drawn (§6): DX1's vectors pass under their project, its negatives fail, and
// what is not an event at all fails too.
import { describe, expect, it } from 'vitest';
import { importOrgKey, type OrgKey } from 'desk-hub/protocol';
import { DUAL_VECTORS, LOG_NEGATIVES, LOG_VECTORS, VECTOR_KEY, VECTOR_PROJECT } from '../../test/vectors';
import { verifyLogEvent } from './verify';

const key = (): Promise<OrgKey> => importOrgKey(VECTOR_KEY);

describe('verifyLogEvent', () => {
  it('passes every log vector under its project', async () => {
    const k = await key();
    expect(LOG_VECTORS.length).toBeGreaterThan(0);
    for (const v of LOG_VECTORS) expect(await verifyLogEvent(k, v.project, v.event), v.name).toEqual({ ok: true });
  });

  it('fails every negative: an altered field, a fresh nonce, another project, a hub/ position out of shape, a variant spelling', async () => {
    const k = await key();
    expect(LOG_NEGATIVES.length).toBeGreaterThan(0);
    for (const v of LOG_NEGATIVES) expect(await verifyLogEvent(k, v.project, v.event), v.name).toEqual({ ok: false, reason: 'bad-code' });
  });

  it("passes a dual-coded event, whose mac covers the v2 sig it carries, and fails it once the sig is touched", async () => {
    expect(DUAL_VECTORS.length).toBeGreaterThan(0);
    for (const v of DUAL_VECTORS) {
      const k = await importOrgKey(v.orgKey);
      expect(await verifyLogEvent(k, v.project, v.event), v.name).toEqual({ ok: true });
      const sig = v.event.sig!;
      expect(await verifyLogEvent(k, v.project, { ...v.event, sig: { ...sig, value: `${sig.value.slice(0, -2)}AA` } }), v.name).toEqual({ ok: false, reason: 'bad-code' });
    }
  });

  it('fails what is not an event', async () => {
    const k = await key();
    const good = LOG_VECTORS[0].event;
    for (const bad of [null, 'text', [good], { ...good, seq: '42' }, { ...good, writer: undefined }, { ...good, kind: 7 }, { ...good, mac: undefined }]) {
      expect(await verifyLogEvent(k, VECTOR_PROJECT, bad)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  // P5 O18 D5: the hub keeps a content-free tombstone at a position it withheld, and serves it in its writer's stream
  // so readers continue past it. It is no event and no forgery: neither drawn nor reported.
  it('reads a withheld tombstone as withheld, and one with anything more as malformed', async () => {
    const k = await key();
    expect(await verifyLogEvent(k, VECTOR_PROJECT, { writer: 'mini/s1', seq: 3, withheld: true })).toEqual({ ok: false, reason: 'withheld' });
    expect(await verifyLogEvent(k, VECTOR_PROJECT, { writer: 'mini/s1', seq: 3, withheld: true, text: 'hi' })).toEqual({ ok: false, reason: 'malformed' });
  });
});
