// Every log event is verified before it is drawn (§6): DX1's vectors pass under their project, its negatives fail, and
// what is not an event at all fails too.
import { describe, expect, it } from 'vitest';
import { importOrgKey, type OrgKey } from 'desk-hub/protocol';
import { LOG_NEGATIVES, LOG_VECTORS, VECTOR_KEY, VECTOR_PROJECT } from '../../test/vectors';
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

  it('fails what is not an event', async () => {
    const k = await key();
    const good = LOG_VECTORS[0].event;
    for (const bad of [null, 'text', [good], { ...good, seq: '42' }, { ...good, writer: undefined }, { ...good, kind: 7 }, { ...good, mac: undefined }]) {
      expect(await verifyLogEvent(k, VECTOR_PROJECT, bad)).toEqual({ ok: false, reason: 'malformed' });
    }
  });
});
