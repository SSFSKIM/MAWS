// The phase-1 routes gone from the hub (P5 O14 M5b, Interfaces §E): DX2's `/machine/stream` and `/machine/frames` and
// the org key's `POST /api/org/keys` and `DELETE /api/org/keys/<id>` answer 404 from the Worker, behind Access as every
// route is, naming nothing of what was there; a browser's DX6 `rpc` frame on a project socket is answered
// `refused {reason: 'retired'}`, recorded nowhere and sent to no machine, the socket left open for the frozen views'
// reads. What stays: `GET /api/org/keys` (the copies' list, then `410 retired` once purged), and enrollment, where a v1
// and a v2 token redeem alike, the hub never seeing a code's prefix.
import { base64urlEncode, generateSigningKey, keyId, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeEndpoint } from '../fake-machine/endpoint';
import { enrollV2, machineFetch, type V2Machine } from '../fake-machine/org';
import { newNonce } from '../src/protocol/codes';
import { encodeEnrollmentCodeV2, type MachineSelf, type WrappedKeys } from '../src/protocol/identity';
import { BrowserClient, enroll, refusal, waitFor } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, newDevice, next, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
let A: string;
/** A v2 machine the org state lists, on RL1. */
let mini: V2Machine;
const PROJECT = '5b0e1d2c-3f40-4a5b-8c6d-7e8f9a0b1c2d';

async function accept(edit: Parameters<typeof next>[1]): Promise<void> {
  const s = await signedBy(await next(head, edit), a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = s;
}

async function v2(name: string): Promise<V2Machine> {
  const response = await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} });
  const { token } = (await response.json()) as { token: string };
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token, roots: [await keyId(a1.stepUp!.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  return enrollV2(code, name);
}

/** The Worker's own 404: JSON naming nothing of the route, with the build header every answer of the Worker carries. */
async function workerNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(response.headers.get('X-Desk-Build')).toBe('dev');
  expect((await response.json()) as unknown).toEqual({ error: 'not-found' });
}

beforeAll(async () => {
  hub = await startLocalHub();
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  head = await signedBy(await genesis(ORG, A, ADMIN, a1, recovery), a1);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
  mini = await v2('mini');
  await accept((s) => {
    s.machines.push({ name: 'mini', ref: mini.ref, pub: mini.key.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref: mini.ref });
  });
});
afterAll(() => hub?.close());

describe("DX2's routes", () => {
  it('answer 404 from the Worker to an enrolled v1 machine, its credential still good', async () => {
    const v1 = await enroll(hub, ADMIN, 'phase-one');
    await workerNotFound(await hub.fetchAs(v1, '/machine/stream'));
    await workerNotFound(await hub.fetchAs(v1, '/machine/frames', { body: '{"t":"hb-ack","generation":1}\n', headers: { 'X-Desk-Generation': '1' } }));
    const self = await hub.fetchAs(v1, '/machine/enrollment');
    expect(self.status).toBe(200);
    expect(((await self.json()) as MachineSelf).machine).toBe('phase-one');
  });

  it('answer 404 from the Worker to a v2 credential too, never the v2-credential refusal that stood for them', async () => {
    await workerNotFound(await machineFetch(hub.url, mini.credentials, '/machine/stream'));
    await workerNotFound(await machineFetch(hub.url, mini.credentials, '/machine/frames', { t: 'hb-ack', generation: 1 }));
  });

  it('stay behind Access: a request with no credential, or one Access does not hold, never reaches the Worker', async () => {
    expect(await refusal(await hub.fetchAs(null, '/machine/stream'))).toBe('403 access-denied');
    expect(await refusal(await hub.fetchAs({ clientId: 'nobody.access', clientSecret: 'x' }, '/machine/frames', { body: '' }))).toBe('401 access');
  });
});

describe("the org key's routes", () => {
  it('answer 404 from the Worker for a POST and a DELETE, while GET still lists the copies the hub holds', async () => {
    await hub.seedWrappedKey();
    await workerNotFound(await hub.fetchAs(ADMIN, '/api/org/keys', { body: { method: 'passphrase', label: 'x' } }));
    const listed = await hub.fetchAs(ADMIN, '/api/org/keys');
    expect(listed.status).toBe(200);
    const { keys } = (await listed.json()) as WrappedKeys;
    expect(keys).toHaveLength(1);
    await workerNotFound(await hub.fetchAs(ADMIN, `/api/org/keys/${keys[0].id}`, { method: 'DELETE', body: { auth: 'x' } }));
    expect(((await (await hub.fetchAs(ADMIN, '/api/org/keys')).json()) as WrappedKeys).keys).toHaveLength(1);
  });

  it('leave GET answering 410 retired once the copies are purged on the head’s word', async () => {
    await accept((s) => void (s.legacyRetired = { version: s.version, at: s.issued }));
    expect((await hub.fetchAs(ADMIN, '/api/org/keys/purge', { method: 'POST' })).status).toBe(200);
    expect(await refusal(await hub.fetchAs(ADMIN, '/api/org/keys'))).toBe('410 retired');
    await workerNotFound(await hub.fetchAs(ADMIN, '/api/org/keys', { body: {} }));
    await workerNotFound(await hub.fetchAs(ADMIN, '/api/org/keys/0123', { method: 'DELETE', body: {} }));
  });
});

describe("a browser's rpc frame", () => {
  it('is answered refused retired to its sender alone: no record, no audit, nothing to the machine, the socket open', async () => {
    const endpoint = new FakeEndpoint({ hub: hub.url, credentials: mini.credentials, ref: mini.ref });
    await endpoint.connect();
    await endpoint.project(PROJECT, 'retired-rpc');
    const sender = await BrowserClient.open(hub, ADMIN, PROJECT);
    const other = await BrowserClient.open(hub, ADMIN, PROJECT);
    const toMachine = endpoint.frames.length;
    const nonce = newNonce();
    const rpc = { rpc: 'interrupt', project: PROJECT, machine: 'mini', member: A, created: new Date().toISOString(), nonce, args: { session: 'x' }, mac: base64urlEncode(new Uint8Array(32)) };
    sender.send({ t: 'rpc', rpc } as never);
    const answered = await sender.next((f) => f.t === 'refused', 'the refusal');
    expect(answered).toEqual({ t: 'refused', refusal: { reason: 'retired', nonce, message: expect.stringMatching(/retired/) as string } });
    // A frame that is no RPC at all is answered the same: DX6 is gone, not checked.
    sender.send({ t: 'rpc', rpc: 7 } as never);
    await waitFor(() => (sender.frames.filter((f) => f.t === 'refused').length === 2 ? true : undefined));
    // The socket serves its reads on: a resume is answered.
    sender.send({ t: 'resume', after: 0 });
    await sender.next((f) => f.t === 'caught-up', 'caught-up');
    expect(sender.frames.some((f) => f.t === 'rpc-state')).toBe(false);
    expect(other.frames.some((f) => f.t === 'refused' || f.t === 'rpc-state')).toBe(false);
    expect(endpoint.frames.slice(toMachine)).toEqual([]);
    expect(await hub.projectRpcs(PROJECT)).toBe(0);
    // Nothing was audited: a browser resuming now is shown no refusal.
    const late = await BrowserClient.open(hub, ADMIN, PROJECT);
    late.send({ t: 'resume', after: 0 });
    await late.next((f) => f.t === 'caught-up', 'caught-up');
    expect(late.frames.some((f) => f.t === 'refused')).toBe(false);
    for (const b of [sender, other, late]) b.close();
    endpoint.close();
  });
});

describe('enrollment', () => {
  it('still redeems a v1 token and a v2 token at the same route, each credential admitted', async () => {
    const v1 = await enroll(hub, ADMIN, 'still-v1');
    expect((await hub.fetchAs(v1, '/machine/enrollment')).status).toBe(200);
    const moved = await v2('still-v2');
    expect((await machineFetch(hub.url, moved.credentials, '/machine/enrollment')).status).toBe(200);
  });
});
