// Delegations, machine certificates, listings and endpoint records (O11 M4; RL §5.3, RL6): a provisioning key re-issued
// as a delegation enrolls a VM whose certificate, signed with the delegation's key, the hub stores at its counted use
// and serves beside the state; the VM's listings and endpoint record are stored at their newest and served to members;
// a certificate that would contest a live one is refused with the conflict and its remedies; and removing the
// delegation from the state stops its machines' records from being accepted.
import { generateSigningKey, keyId, type EndpointRecord, type Listing, type MachineCert, type Signed, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { certify, endpointRecord, enrollDelegated, listing, machineFetch, mintRef, redeemDelegated, retirement, type DelegationKey, type V2Machine } from '../fake-machine/org';
import { delegationFor, type Listings, type MachineEndpoint, type OrgStateView, type ProvisioningKeyRecord } from '../src/protocol/identity';
import { provisioningKey, refusal } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, newDevice, next, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let a1: TestDevice;
let A: string;
let head: SignedOrgState;
let delegation: DelegationKey;
let secret: string;
const PROJECT = '5b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const SESSION = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';

async function accept(edit: Parameters<typeof next>[1]): Promise<void> {
  const s = await signedBy(await next(head, edit), a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = s;
}
const view = async (path = '/api/org/state', who: Parameters<LocalHub['fetchAs']>[0] = ADMIN) => (await (await hub.fetchAs(who, path)).json()) as OrgStateView;
type Stored = { ok: true; value: unknown } | { ok: false; status: number; error: string; message?: string };
const outcome = (r: Stored) => (r.ok ? 'stored' : `${r.status} ${r.error}`);
const storeListing = async (l: Signed<Listing>) => outcome(await hub.registryRpc<Stored>('storeListing', l));
const storeEndpoint = async (r: Signed<EndpointRecord>) => outcome(await hub.registryRpc<Stored>('storeEndpoint', r));
const fields = (owners: string[], title = 'a session'): Listing['fields'] => ({ owners, project: PROJECT, lane: 'B', state: 'idle', title });

beforeAll(async () => {
  hub = await startLocalHub();
  a1 = await newDevice('a1');
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  head = await signedBy(await genesis(ORG, A, ADMIN, a1, await generateSigningKey()), a1);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
  const key = await provisioningKey(hub, ADMIN, { label: 'devcloud', prefix: 'vm-', max_uses: null, offline_revoke_s: null });
  secret = key.token;
  delegation = { id: key.id, key: await generateSigningKey() };
  await accept((s) => s.delegations.push(delegationFor(key.key, delegation.key.pub, 'org')));
});
afterAll(() => hub?.close());

describe('a provisioning key re-issued as a delegation', () => {
  it('is listed with the delegation’s key and owners from the head', async () => {
    const keys = ((await (await hub.fetchAs(ADMIN, '/api/provisioning-keys')).json()) as { keys: ProvisioningKeyRecord[] }).keys;
    expect(keys.find((k) => k.id === delegation.id)?.delegation).toEqual({ pub: delegation.key.pub, owners: 'org' });
  });
});

describe('a delegated VM', () => {
  let vm: V2Machine & { cert: Signed<MachineCert> };
  let recreated: V2Machine & { cert: Signed<MachineCert> };

  it('posts its certificate at the use its redemption counted, which the hub serves beside the state to members and machines', async () => {
    vm = await enrollDelegated(hub.url, secret, 'vm-one', delegation);
    expect(vm.use).toBe(1);
    expect(vm.ref.startsWith(`${delegation.id}_`)).toBe(true);
    expect((await view()).certificates).toEqual({ certs: [vm.cert], retirements: [] });
    expect((await view('/machine/org/state', vm.credentials)).certificates.certs).toEqual([vm.cert]);
    // The same certificate again is answered as before.
    expect((await machineFetch(hub.url, vm.credentials, '/machine/cert', vm.cert)).status).toBe(200);
  });

  it('is refused a certificate for another name, another delegation, another use, or another for its key', async () => {
    const post = async (cert: Signed<MachineCert>) => refusal(await machineFetch(hub.url, vm.credentials, '/machine/cert', cert));
    expect(await post(await certify({ ...vm, name: 'vm-other' }, delegation))).toBe('403 not-yours');
    expect(await post(await certify({ ...vm, use: 2 }, delegation))).toBe('409 wrong-use');
    const stranger = { id: 'f'.repeat(32), key: await generateSigningKey() };
    expect(await post(await certify({ ...vm, ref: mintRef(stranger.id) }, stranger))).toBe('403 not-yours');
    const forged = await certify(vm, { id: delegation.id, key: await generateSigningKey() });
    expect(await post(forged)).toBe('409 unknown-signer');
    expect(await post(await certify({ ...vm, ref: mintRef(delegation.id) }, delegation))).toBe('409 conflict');
    expect(await post({ body: { ...vm.cert.body, extra: 1 }, sig: vm.cert.sig } as unknown as Signed<MachineCert>)).toBe('400 malformed');
  });

  it('publishes listings stored at their highest revision and served to members with its endpoint record', async () => {
    const l1 = await listing(vm, SESSION, 1, fields([A]));
    expect(await storeListing(l1)).toBe('stored');
    expect(await storeListing(l1)).toBe('stored');
    expect(await storeListing(await listing(vm, SESSION, 1, fields([A], 'changed')))).toBe('409 stale-listing');
    const l2 = await listing(vm, SESSION, 2, fields([A], 'later'));
    expect(await storeListing(l2)).toBe('stored');
    expect(await storeListing(l1)).toBe('409 stale-listing');

    const e1 = await endpointRecord(vm, ['100.64.0.7:7443'], '2026-10-27T00:00:00.000Z');
    expect(await storeEndpoint(e1)).toBe('stored');
    expect(await storeEndpoint(await endpointRecord(vm, ['100.64.0.8:7443'], '2026-10-26T00:00:00.000Z'))).toBe('409 stale-endpoint');
    const listings = (await (await hub.fetchAs(ADMIN, `/api/listings?project=${PROJECT}`)).json()) as Listings;
    expect(listings).toEqual({ listings: [l2], endpoints: [e1] });
    expect(((await (await hub.fetchAs(ADMIN, '/api/listings?project=another')).json()) as Listings).listings).toEqual([]);
    for (const at of [vm.ref, 'vm-one', 'VM-ONE']) {
      const response = await hub.fetchAs(ADMIN, `/api/machines/${at}/endpoint`);
      expect(((await response.json()) as MachineEndpoint).record).toEqual(e1);
    }
    expect(await refusal(await hub.fetchAs(ADMIN, '/api/machines/nobody/endpoint'))).toBe('404 no-endpoint');
  });

  it('never lets a lower revision or an older record, submitted at once, overwrite a newer one', async () => {
    const LATER = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
    const listings = await Promise.all(Array.from({ length: 20 }, (_, i) => listing(vm, LATER, 100 - i, fields([A]))));
    await hub.registryRpcs(listings.map((l) => ({ method: 'storeListing', args: [l] })));
    const kept = ((await (await hub.fetchAs(ADMIN, '/api/listings')).json()) as Listings).listings.find((l) => l.body.session === LATER);
    expect(kept?.body.revision).toBe(100);
    const records = await Promise.all(Array.from({ length: 20 }, (_, i) => endpointRecord(vm, ['100.64.0.7:7443'], new Date(Date.UTC(2026, 9, 28, 0, 0, 20 - i)).toISOString())));
    await hub.registryRpcs(records.map((r) => ({ method: 'storeEndpoint', args: [r] })));
    expect(((await (await hub.fetchAs(ADMIN, `/api/machines/${vm.ref}/endpoint`)).json()) as MachineEndpoint).record).toEqual(records[0]);
  });

  it('refuses records signed by another key, forged, or of a machine with no key', async () => {
    const stranger: SigningKey = await generateSigningKey();
    expect(await storeListing(await listing({ ...vm, key: stranger }, SESSION, 9, fields([A])))).toBe('403 unknown-signer');
    const forged = await listing(vm, SESSION, 9, fields([A]));
    forged.body.fields.title = 'forged';
    expect(await storeListing(forged)).toBe('403 bad-signature');
    expect(await storeEndpoint(await endpointRecord({ ...vm, ref: mintRef(), key: stranger }, ['x']))).toBe('403 not-listed');
    expect(await storeListing({ body: { org: ORG }, sig: forged.sig } as unknown as Signed<Listing>)).toBe('400 malformed');
  });

  it('recreated under its old name is refused while its predecessor’s certificate is live, naming the conflict and the remedies', async () => {
    expect((await hub.fetchAs(ADMIN, '/api/machines/vm-one', { method: 'DELETE' })).status).toBe(200);
    const again = await redeemDelegated(hub.url, secret, 'vm-one', delegation);
    expect(again.use).toBe(2);
    const cert = await certify(again, delegation);
    const response = await machineFetch(hub.url, again.credentials, '/machine/cert', cert);
    expect(response.status).toBe(409);
    const answer = (await response.json()) as { error: string; message: string; conflicts: unknown[] };
    expect(answer.error).toBe('contested');
    expect(answer.conflicts).toEqual([{ ref: vm.ref, name: 'vm-one', keyId: await keyId(vm.key.pub), holder: 'certificate' }]);
    expect(answer.message).toMatch(/fresh name/);
    expect(answer.message).toMatch(/retir/);
    expect(answer.message).toMatch(/revok/);
    expect((await view()).certificates.certs).toEqual([vm.cert]);
    recreated = { ...again, cert };
  });

  it('takes its old name once its predecessor’s certificate is retired by the delegation’s key', async () => {
    const other = { id: 'e'.repeat(32), key: await generateSigningKey() };
    expect(await refusal(await hub.fetchAs(ADMIN, '/api/org/cert-retirements', { body: await retirement(ORG, vm.key, other) }))).toBe('409 unknown-signer');
    const retired = await retirement(ORG, vm.key, delegation);
    expect((await hub.fetchAs(ADMIN, '/api/org/cert-retirements', { body: retired })).status).toBe(201);
    // Again, from a machine: answered as held, kept once.
    expect((await machineFetch(hub.url, recreated.credentials, '/machine/cert-retirements', retired)).status).toBe(200);
    expect((await view()).certificates.retirements).toEqual([retired]);
    expect((await machineFetch(hub.url, recreated.credentials, '/machine/cert', recreated.cert)).status).toBe(201);
    expect((await view()).certificates.certs).toEqual([vm.cert, recreated.cert]);
    vm = recreated;
    expect(await storeListing(await listing(vm, SESSION, 3, fields([A])))).toBe('stored');
  });

  it('stops being accepted once the delegation leaves the state, its key revoked, and no new certificate is admitted', async () => {
    // The step that drops a delegation moves its key to `revoked` (RL DL 24).
    const kid = await keyId(delegation.key.pub);
    await accept((s) => {
      s.delegations = [];
      s.revoked.push({ keyId: kid, holder: { delegation: delegation.id, prefix: 'vm-' } });
    });
    expect(await storeListing(await listing(vm, SESSION, 4, fields([A])))).toBe('403 not-listed');
    expect(await storeEndpoint(await endpointRecord(vm, ['100.64.0.9:7443']))).toBe('403 not-listed');
    const late = await redeemDelegated(hub.url, secret, 'vm-two', delegation);
    expect(await refusal(await machineFetch(hub.url, late.credentials, '/machine/cert', await certify(late, delegation)))).toBe('409 not-listed');
  });
});
