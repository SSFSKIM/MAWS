// The certificate set's signatures verified once (records.ts `signedOnce`, keys.ts's key ids): a verdict that turns on
// `now` or on the set is judged again at each call, whatever was verified before. The same set at two `now`s across
// its delegation's expiry, a retirement added in a new set and dropped again, and a copy of a verified certificate
// with another body each give the verdict a verifier holding no cache would.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signEvent, verifyEvent } from '../src/events.ts';
import { generateSigningKey, keyId, type SigningKey } from '../src/keys.ts';
import { machineSigners, signRecord, verifyMachineCert } from '../src/records.ts';
import { SIGNING_DOMAINS, type Certificates, type MachineCert, type OrgState, type Signed } from '../src/types.ts';

const ORG = 'org-cache';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const D = 'd'.repeat(32);
const EXPIRES = '2026-11-20T12:00:00.000Z';
const before = new Date(Date.parse(EXPIRES) - 60_000);
const after = new Date(Date.parse(EXPIRES) + 60_000);

function state(delegation: SigningKey): OrgState {
  return {
    org: ORG,
    version: 2,
    prev: null,
    issued: '2026-11-01T00:00:00.000Z',
    root: { keys: [], recoveryPub: delegation.pub },
    members: [],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [{ id: D, pub: delegation.pub, prefix: 'vm-', expires: EXPIRES, maxUses: 10, offlineRevokeS: 0, owners: 'org' }],
    projects: [],
  };
}

const cert = (delegation: SigningKey, machine: SigningKey, ref: string, name: string, use: number): Promise<Signed<MachineCert>> =>
  signRecord(SIGNING_DOMAINS.machineCert, { org: ORG, machine: `${D}_${ref.repeat(22)}`, name, pub: machine.pub, delegation: D, use, issued: '2026-11-01T00:00:00.000Z' }, delegation.privateKey, delegation.pub);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the certificate set, its signatures verified once', () => {
  it('judges liveness at each now: the same set across its delegation’s expiry, and back', async () => {
    const delegation = await generateSigningKey();
    const [one, two] = [await generateSigningKey(), await generateSigningKey()];
    const s = state(delegation);
    // Two live certificates bearing one name under two refs contest it; once expired, neither contests.
    const set: Certificates = { certs: [await cert(delegation, one, 'a', 'vm-x', 1), await cert(delegation, two, 'b', 'vm-x', 2)], retirements: [] };
    expect(await verifyMachineCert(s, set.certs[0], before)).toEqual({ ok: true });
    expect(await machineSigners(s, 'vm-x', set, before)).toEqual([]);
    expect(await verifyMachineCert(s, set.certs[0], after)).toEqual({ ok: false, code: 'expired' });
    expect(await machineSigners(s, 'vm-x', set, after)).toEqual([
      { pub: one.pub, notAfter: EXPIRES },
      { pub: two.pub, notAfter: EXPIRES },
    ]);
    expect(await verifyMachineCert(s, set.certs[0], before)).toEqual({ ok: true });
    expect(await machineSigners(s, 'vm-x', set, before)).toEqual([]);
  });

  it('judges each set by its own retirements: one added in a new set, then the first set again', async () => {
    const delegation = await generateSigningKey();
    const machine = await generateSigningKey();
    const s = state(delegation);
    const first: Certificates = { certs: [await cert(delegation, machine, 'a', 'vm-one', 1)], retirements: [] };
    const created = '2026-11-20T10:00:00.000Z';
    const event = await signEvent({ org: ORG, project: P }, { ts: created, created, writer: 'vm-one/human', seq: 1, kind: 'human', text: 'hi' }, machine.privateKey, machine.pub);
    expect(await verifyEvent({ org: ORG, project: P }, s, event, first, before)).toEqual({ ok: true });
    const retirement = await signRecord(SIGNING_DOMAINS.certRetire, { org: ORG, keyId: await keyId(machine.pub), notAfter: '2026-11-20T09:00:00.000Z' }, delegation.privateKey, delegation.pub);
    const second: Certificates = { certs: first.certs, retirements: [retirement] };
    expect(await verifyEvent({ org: ORG, project: P }, s, event, second, before)).toEqual({ ok: false, code: 'expired' });
    expect(await verifyEvent({ org: ORG, project: P }, s, event, first, before)).toEqual({ ok: true });
    // A retirement the delegation didn't sign retires nothing, though a signed one with its body was verified.
    const forged: Certificates = { certs: first.certs, retirements: [{ ...retirement, body: { ...retirement.body, notAfter: '2026-11-20T08:00:00.000Z' } }] };
    expect(await verifyEvent({ org: ORG, project: P }, s, event, forged, before)).toEqual({ ok: true });
  });

  it('verifies a copy of a verified certificate with another body afresh, and under another delegation key', async () => {
    const delegation = await generateSigningKey();
    const machine = await generateSigningKey();
    const s = state(delegation);
    const genuine = await cert(delegation, machine, 'a', 'vm-one', 1);
    expect(await verifyMachineCert(s, genuine, before)).toEqual({ ok: true });
    expect(await verifyMachineCert(s, { ...genuine, body: { ...genuine.body, name: 'vm-two' } }, before)).toEqual({ ok: false, code: 'bad-signature' });
    // The same record against a state whose delegation has another key: not its signer.
    const other = await generateSigningKey();
    const moved: OrgState = { ...s, delegations: [{ ...s.delegations[0], pub: other.pub }] };
    expect(await verifyMachineCert(moved, genuine, before)).toEqual({ ok: false, code: 'unknown-signer' });
    expect(await verifyMachineCert(s, genuine, before)).toEqual({ ok: true });
  });

  it('keys a verification by what it verified: a record changed during its awaits keys nothing it was not', async () => {
    const delegation = await generateSigningKey();
    const machine = await generateSigningKey();
    const s = state(delegation);
    const genuine = await cert(delegation, machine, 'a', 'vm-one', 1);
    const forgedBody = { ...genuine.body, name: 'vm-two' };
    // A forged record, made genuine while it is being verified: its verdict is the forgery's, and the forgery stays one.
    const record: Signed<MachineCert> = { body: forgedBody, sig: { ...genuine.sig } };
    const judging = verifyMachineCert(s, record, before);
    record.body = genuine.body;
    expect(await judging).toEqual({ ok: false, code: 'bad-signature' });
    expect(await verifyMachineCert(s, { body: forgedBody, sig: genuine.sig }, before)).toEqual({ ok: false, code: 'bad-signature' });
    // A genuine one forged while verified: its success is keyed under the genuine inputs alone.
    const other = await cert(delegation, machine, 'b', 'vm-three', 2);
    const turning: Signed<MachineCert> = { body: other.body, sig: { ...other.sig } };
    const judged = verifyMachineCert(s, turning, before);
    turning.sig.value = genuine.sig.value;
    expect(await judged).toEqual({ ok: true });
    expect(await verifyMachineCert(s, { body: other.body, sig: { kid: other.sig.kid, value: genuine.sig.value } }, before)).toEqual({ ok: false, code: 'bad-signature' });
  });

  it('answers a fresh verdict each time, which a caller may change', async () => {
    const delegation = await generateSigningKey();
    const s = state(delegation);
    const genuine = await cert(delegation, await generateSigningKey(), 'a', 'vm-one', 1);
    const first = await verifyMachineCert(s, genuine, before);
    (first as { ok: boolean }).ok = false;
    const second = await verifyMachineCert(s, genuine, before);
    expect(second).toEqual({ ok: true });
    expect(second).not.toBe(first);
  });

  it('keeps no failure: a retirement whose check WebCrypto failed once retires on the next check', async () => {
    const delegation = await generateSigningKey();
    const machine = await generateSigningKey();
    const s = state(delegation);
    const created = '2026-11-20T10:00:00.000Z';
    const event = await signEvent({ org: ORG, project: P }, { ts: created, created, writer: 'vm-one/human', seq: 1, kind: 'human', text: 'hi' }, machine.privateKey, machine.pub);
    const retirement = await signRecord(SIGNING_DOMAINS.certRetire, { org: ORG, keyId: await keyId(machine.pub), notAfter: '2026-11-20T09:00:00.000Z' }, delegation.privateKey, delegation.pub);
    const set: Certificates = { certs: [await cert(delegation, machine, 'a', 'vm-one', 1)], retirements: [retirement] };
    await verifyMachineCert(s, set.certs[0], before); // the certificate's own signature verified and kept
    const verify = crypto.subtle.verify.bind(crypto.subtle);
    let failures = 1;
    vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args: Parameters<SubtleCrypto['verify']>) => {
      if (failures > 0 && args[3] instanceof Uint8Array && new TextDecoder().decode(args[3]).startsWith(`${SIGNING_DOMAINS.certRetire}\n`)) {
        failures--;
        throw new Error('transient');
      }
      return verify(...args);
    });
    expect(await verifyEvent({ org: ORG, project: P }, s, event, set, before)).toEqual({ ok: true });
    expect(await verifyEvent({ org: ORG, project: P }, s, event, set, before)).toEqual({ ok: false, code: 'expired' });
  });

  it('keeps the key id of a point only: an input of another length is derived each time', async () => {
    const point = (await generateSigningKey()).pub;
    const long = 'A'.repeat(4000);
    const digest = vi.spyOn(crypto.subtle, 'digest');
    await keyId(point);
    await keyId(point);
    expect(digest).toHaveBeenCalledTimes(1);
    digest.mockClear();
    expect(await keyId(long)).toBe(await keyId(long));
    expect(digest).toHaveBeenCalledTimes(2);
  });

  it('views a certificate by the body it authenticated: one replaced while the set is judged lends it no key', async () => {
    const delegation = await generateSigningKey();
    const machine = await generateSigningKey();
    const intruder = await generateSigningKey();
    const s = state(delegation);
    const genuine = await cert(delegation, machine, 'a', 'vm-one', 1);
    const record: Signed<MachineCert> = { body: genuine.body, sig: genuine.sig };
    const set: Certificates = { certs: [record], retirements: [] };
    const judging = machineSigners(s, 'vm-one', set, after);
    record.body = { ...genuine.body, pub: intruder.pub };
    expect(await judging).toEqual([{ pub: machine.pub, notAfter: EXPIRES }]);
    // Judged again as it now stands: a body its delegation never signed, so no signer at all.
    expect(await machineSigners(s, 'vm-one', set, after)).toEqual([]);
  });
});

