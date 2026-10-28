// A machine's v2 enrollment (O11 M4; RL §5.3): after redeeming as today, the machine posts its own key and its ref with
// the MAC under the code's pairing secret; the enrolling member's device fetches them and checks the MAC, and the hub
// shows the machine listed once a state lists that key, apart from its hub confirmation. An active machine re-enrolls
// in place under a token that names it.
import { base64urlEncode, generateSigningKey, keyId, verifyEnrollmentMac, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrollV2, machineFetch, type V2Machine } from '../fake-machine/org';
import { encodeEnrollmentCodeV2, type EnrollmentKey, type MachineView } from '../src/protocol/identity';
import { enrollmentToken, MachineClient, refusal, waitFor } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, newDevice, next, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
const MEMBER = 'member@example.com';

beforeAll(async () => {
  hub = await startLocalHub();
  await hub.addMember('other-admin@example.com', 'admin');
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
});
afterAll(() => hub?.close());

/** The pairing secret the app adds to the code, and the code it builds around a fresh token. */
async function code(machine?: string): Promise<{ text: string; k: Uint8Array; token: string }> {
  const k = crypto.getRandomValues(new Uint8Array(32));
  const response = await hub.fetchAs(ADMIN, '/api/enrollments', { body: machine === undefined ? {} : { machine } });
  if (response.status !== 201) throw new Error(`enrollment: ${response.status} ${await response.text()}`);
  const { token } = (await response.json()) as { token: string };
  const roots = [await keyId(a1.stepUp!.pub)];
  return { text: encodeEnrollmentCodeV2({ hub: hub.url, token, roots, recoveryPub: recovery.pub, k: base64urlEncode(k), ...(machine === undefined ? {} : { machine }) }), k, token };
}
/**
 * A phase-1 machine's credential: a token redeemed with no key posted after it (a DX2 machine's, or a cutover undone);
 * with `replacing`, a token that re-enrolls that active machine in place.
 */
async function redeemV1(machine: string, replacing?: string): Promise<V2Machine['credentials']> {
  const token = replacing === undefined ? await enrollmentToken(hub, ADMIN) : (await code(replacing)).token;
  const response = await hub.fetchAs(null, '/machine/enroll', { body: { token, machine } });
  expect(response.status).toBe(200);
  const redeemed = (await response.json()) as { client_id: string; client_secret: string };
  return { clientId: redeemed.client_id, clientSecret: redeemed.client_secret };
}
const keyOf = (enrollment: string, who = ADMIN) => hub.fetchAs(who, `/api/enrollments/${enrollment}/key`);
const machines = async () => ((await (await hub.fetchAs(ADMIN, '/api/machines')).json()) as { machines: MachineView[] }).machines;
const machineNamed = async (name: string) => (await machines()).find((m) => m.name === name);

describe('a v2 machine', () => {
  let mini: V2Machine;
  let k: Uint8Array;

  it('posts its key and ref with the MAC once redeemed, and is hub-confirmed by that request', async () => {
    const c = await code();
    k = c.k;
    mini = await enrollV2(c.text, 'mini');
    expect(mini.enrollment).toMatch(/^[0-9a-f]{32}$/);
    expect(await machineNamed('mini')).toMatchObject({ state: 'active', key: { ref: mini.ref, pub: mini.key.pub, listed: false } });
  });

  it("is fetched by its enrolling member, whose device's check of the MAC passes, and by no one else", async () => {
    const response = await keyOf(mini.enrollment);
    expect(response.status).toBe(200);
    const key = (await response.json()) as EnrollmentKey;
    expect(key).toMatchObject({ enrollment: mini.enrollment, machine: 'mini', pub: mini.key.pub, ref: mini.ref });
    expect(await verifyEnrollmentMac(k, { name: key.machine, machinePub: key.pub, ref: key.ref, tokenId: key.enrollment }, key.mac)).toBe(true);
    // A key the hub substituted fails the device's check.
    const other = await generateSigningKey();
    expect(await verifyEnrollmentMac(k, { name: key.machine, machinePub: other.pub, ref: key.ref, tokenId: key.enrollment }, key.mac)).toBe(false);
    expect(await refusal(await keyOf(mini.enrollment, 'other-admin@example.com'))).toBe('403 not-yours');
    expect(await refusal(await keyOf('0'.repeat(32)))).toBe('404 unknown-enrollment');
  });

  it('keeps one key per enrollment: the same again is answered, another refused', async () => {
    const mac = ((await (await keyOf(mini.enrollment)).json()) as EnrollmentKey).mac;
    expect((await machineFetch(hub.url, mini.credentials, '/machine/key', { pub: mini.key.pub, ref: mini.ref, mac })).status).toBe(200);
    const other = await generateSigningKey();
    expect(await refusal(await machineFetch(hub.url, mini.credentials, '/machine/key', { pub: other.pub, ref: mini.ref, mac }))).toBe('409 key-posted');
  });

  it.each([
    ['no body', undefined],
    ['a key that is not a point', { pub: 'abc', ref: 'r'.repeat(22), mac: base64urlEncode(new Uint8Array(32)) }],
    ['a ref outside its grammar', { pub: 'KEY', ref: 'short', mac: base64urlEncode(new Uint8Array(32)) }],
    ['a MAC that is not 32 bytes', { pub: 'KEY', ref: 'r'.repeat(22), mac: base64urlEncode(new Uint8Array(16)) }],
    ['an unknown field', { pub: 'KEY', ref: 'r'.repeat(22), mac: base64urlEncode(new Uint8Array(32)), org: ORG }],
  ])('refuses %s', async (_label, body) => {
    const fresh = await enrollV2((await code()).text, `shape-${Math.random().toString(36).slice(2, 8)}`);
    const filled = body && { ...body, pub: body.pub === 'KEY' ? fresh.key.pub : body.pub };
    expect(await refusal(await machineFetch(hub.url, fresh.credentials, '/machine/key', filled ?? '', 'POST'))).toBe('400 bad-shape');
  });

  it('is not yet posted for an enrollment redeemed without a key', async () => {
    const token = await enrollmentToken(hub, ADMIN);
    const response = await hub.fetchAs(null, '/machine/enroll', { body: { token, machine: 'v1-machine' } });
    const redeemed = (await response.json()) as { enrollment: string };
    expect(await refusal(await keyOf(redeemed.enrollment))).toBe('404 no-key');
    expect((await machineNamed('v1-machine'))?.key).toBeUndefined();
  });

  it('is listed once a state lists its ref with its key, and not when the state holds another key', async () => {
    head = await signedBy(await genesis(ORG, ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id, ADMIN, a1, recovery), a1);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
    const stranger = await generateSigningKey();
    const first = await signedBy(
      await next(head, (s) => {
        s.machines = [{ name: 'mini', ref: mini.ref, pub: stranger.pub, owners: [s.members[0].id] }];
        s.machineNames.push({ name: 'mini', ref: mini.ref });
      }),
      a1,
    );
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: first })).status).toBe(201);
    head = first;
    expect(await machineNamed('mini')).toMatchObject({ state: 'active', key: { listed: false } });
    // The entry's key becomes the machine's own; the stranger's retires in the same step (RL5).
    const rekeyed = await next(head, (s) => {
      s.machines = [{ name: 'mini', ref: mini.ref, pub: mini.key.pub, owners: [s.members[0].id] }];
    });
    rekeyed.retired.push({ keyId: await keyId(stranger.pub), pub: stranger.pub, notAfter: new Date().toISOString(), holder: { machine: mini.ref } });
    const listed = await signedBy(rekeyed, a1);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: listed })).status).toBe(201);
    head = listed;
    expect(await machineNamed('mini')).toMatchObject({ state: 'active', key: { listed: true } });
  });
});

describe('re-enrolling an active machine in place', () => {
  it('takes a token that names it, refused for a name no active machine holds', async () => {
    expect(await refusal(await hub.fetchAs(ADMIN, '/api/enrollments', { body: { machine: 'nobody' } }))).toBe('409 unknown-machine');
    expect(await refusal(await hub.fetchAs(ADMIN, '/api/enrollments', { body: { machine: 'hub' } }))).toBe('400 bad-shape');
    expect(await refusal(await hub.fetchAs(MEMBER, '/api/enrollments', { body: {} }))).toMatch(/^403 /);
  });

  // The machine re-enrolled from DX2, as a cutover does (a v2 credential opens no stream of its own, O14 M5a).
  it('replaces the credential: the old one is refused, the machine keeps its name and project, and posts its new key', async () => {
    const credentials = await redeemV1('studio');
    const first = { credentials, enrollment: (await machineNamed('studio'))!.enrollment };
    const old = new MachineClient(hub, 'studio', first.credentials);
    await old.connect();
    // Another name under a token that names `studio` is refused, and binds nothing.
    const c = await code('studio');
    const wrong = await hub.fetchAs(null, '/machine/enroll', { body: { token: c.token, machine: 'elsewhere' } });
    expect(await refusal(wrong)).toBe('409 token-used');
    const again = await enrollV2(c.text);
    expect(again.name).toBe('studio');
    expect(again.enrollment).not.toBe(first.enrollment);
    // The old service token was deleted by the new one's mint: Access refuses it before the hub would.
    expect(await refusal(await machineFetch(hub.url, first.credentials, '/machine/enrollment'))).toBe('401 access');
    expect((await machineFetch(hub.url, again.credentials, '/machine/enrollment')).status).toBe(200);
    // Its old stream was ended at its Machine object.
    await waitFor(() => (old.isEnded ? true : undefined));
    // Its new credential's first request confirmed it again.
    expect((await machineNamed('studio'))?.confirmed).not.toBeNull();
    expect(await machineNamed('studio')).toMatchObject({ state: 'active', enrollment: again.enrollment, key: { ref: again.ref, pub: again.key.pub, listed: false } });
    await old.close();
  });

  it('is refused until the old stream is fenced, and changes nothing until then', async () => {
    const first = { credentials: await redeemV1('fenced') };
    const old = new MachineClient(hub, 'fenced', first.credentials);
    await old.connect();
    const c = await code('fenced');
    await hub.faultNextRevoke('fenced', 'fail');
    const refused = await hub.fetchAs(null, '/machine/enroll', { body: { token: c.token, machine: 'fenced' } });
    expect(await refusal(refused)).toBe('503 fence-failed');
    // Nothing moved: the old credential still works, its stream still open.
    expect((await machineFetch(hub.url, first.credentials, '/machine/enrollment')).status).toBe(200);
    expect(old.isEnded).toBe(false);
    // Redeemed again, the fence is placed and the re-enrollment goes through.
    const again = await enrollV2(c.text);
    await waitFor(() => (old.isEnded ? true : undefined));
    expect(await machineNamed('fenced')).toMatchObject({ state: 'active', enrollment: again.enrollment });
    await old.close();
  });

  it('that expires before its machine connects refuses the new credential and keeps the machine', async () => {
    const first = await enrollV2((await code()).text, 'lapsed');
    const c = await code('lapsed');
    const redeemed = (await (await hub.fetchAs(null, '/machine/enroll', { body: { token: c.token, machine: 'lapsed' } })).json()) as { client_id: string; client_secret: string };
    await hub.backdate({ enrollment: { machine: 'lapsed', expires: '2020-01-01T00:00:00.000Z' } });
    // The new credential's first request finds its enrollment lapsed.
    const late = await hub.fetchAs({ clientId: redeemed.client_id, clientSecret: redeemed.client_secret }, '/machine/enrollment');
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect(await refusal(await hub.fetchAs(null, '/machine/enroll', { body: { token: c.token, machine: 'lapsed' } }))).toBe('410 expired');
    const after = await hub.fetchAs({ clientId: redeemed.client_id, clientSecret: redeemed.client_secret }, '/machine/enrollment');
    expect(after.status).toBeGreaterThanOrEqual(400);
    // Its token is deleted at Cloudflare in time; the machine keeps its name and record, and re-enrolls under its ref.
    await waitFor(() => (hub.standin.tokens().some((t) => t.client_id === redeemed.client_id) ? undefined : true));
    expect(await machineNamed('lapsed')).toMatchObject({ state: 'active', client_id: null });
    const again = await enrollV2((await code('lapsed')).text, undefined, { ref: first.ref });
    expect(await machineNamed('lapsed')).toMatchObject({ state: 'active', confirmed: expect.any(String) as string, key: { ref: first.ref, pub: again.key.pub } });
  });

  it('displaces an earlier one not yet connected, whose token sent again leaves the newer credential working', async () => {
    const first = await enrollV2((await code()).text, 'twice');
    const a = await code('twice');
    const redeemA = () => hub.fetchAs(null, '/machine/enroll', { body: { token: a.token, machine: 'twice' } });
    expect((await redeemA()).status).toBe(200);
    // A's credential never connects; B replaces the machine in place and connects.
    const b = await enrollV2((await code('twice')).text, undefined, { ref: first.ref });
    expect(await machineNamed('twice')).toMatchObject({ state: 'active', enrollment: b.enrollment, confirmed: expect.any(String) as string });
    expect(await refusal(await redeemA())).toBe('410 expired');
    expect((await machineFetch(hub.url, b.credentials, '/machine/enrollment')).status).toBe(200);
    expect(hub.standin.tokens().some((t) => t.client_id === b.credentials.clientId)).toBe(true);
    expect(await machineNamed('twice')).toMatchObject({ enrollment: b.enrollment, client_id: b.credentials.clientId });
  });

  it('is refused once the machine it names is gone', async () => {
    const gone = await enrollV2((await code()).text, 'gone');
    const c = await code('gone');
    expect((await hub.fetchAs(ADMIN, '/api/machines/gone', { method: 'DELETE' })).status).toBe(200);
    expect(await refusal(await hub.fetchAs(null, '/machine/enroll', { body: { token: c.token, machine: 'gone' } }))).toBe('409 not-active');
    void gone;
  });
});

// The Worker resolves a machine's credential before it reads the body; a revocation or a re-enrollment may come between.
describe('a machine resolved before its revocation or re-enrollment', () => {
  it('is refused its key, its certificate and a retirement it relays', async () => {
    const moved = await enrollV2((await code()).text, 'moved');
    const replaced = (await machineNamed('moved'))!;
    await enrollV2((await code('moved')).text, undefined, { ref: moved.ref });
    await enrollV2((await code()).text, 'revoked');
    const revoked = (await machineNamed('revoked'))!;
    expect((await hub.fetchAs(ADMIN, '/api/machines/revoked', { method: 'DELETE' })).status).toBe(200);
    for (const stale of [replaced, revoked]) {
      for (const call of ['keepMachineKey', 'storeCert', 'machineRetiresCert']) {
        expect(await hub.asMember(call, stale, {}), `${call} as ${stale.name}`).toEqual(expect.objectContaining({ ok: false, status: 403, error: 'not-enrolled' }));
      }
    }
    // The machine as it stands passes the check and meets the body's.
    expect(await hub.asMember('storeCert', (await machineNamed('moved'))!, {})).toEqual(expect.objectContaining({ ok: false, status: 400 }));
  });
});

// O14 M5a: a credential whose enrollment posted a machine key is a v2 credential, and never opens DX2 (RL Decision
// Log 29: from a re-enrollment's redemption until its listing it is the name's only credential).
describe('DX2 under a v2 credential', () => {
  const stream = (credentials: V2Machine['credentials']) => machineFetch(hub.url, credentials, '/machine/stream');
  const frames = (credentials: V2Machine['credentials']) => machineFetch(hub.url, credentials, '/machine/frames', { t: 'events', project: 'p', events: [] });

  it('is refused both routes once its key is posted, before the Machine object', async () => {
    const machine = await enrollV2((await code()).text, 'dx2-born-v2');
    expect(await refusal(await stream(machine.credentials))).toBe('403 v2-credential');
    expect(await refusal(await frames(machine.credentials))).toBe('403 v2-credential');
  });

  it('refuses a re-enrolled machine that posted its key, its old credential refused too; a v1 re-enrollment is admitted again', async () => {
    const v1 = await redeemV1('dx2-moving');
    const old = new MachineClient(hub, 'dx2-moving', v1);
    await old.connect();
    const moved = await enrollV2((await code('dx2-moving')).text);
    await waitFor(() => (old.isEnded ? true : undefined));
    expect(await refusal(await stream(moved.credentials))).toBe('403 v2-credential');
    expect(await refusal(await frames(moved.credentials))).toBe('403 v2-credential');
    expect(await refusal(await stream(v1))).toBe('401 access');
    await old.close();
    // The cutover undone: the same name re-enrolled by a token redeemed with no key post is DX2's again.
    const back = await redeemV1('dx2-moving', 'dx2-moving');
    const again = new MachineClient(hub, 'dx2-moving', back);
    await again.connect();
    expect((await frames(back)).status).not.toBe(403);
    await again.close();
  });

  it('leaves a machine that never posted a key on DX2', async () => {
    const v1 = await redeemV1('dx2-never-v2');
    const client = new MachineClient(hub, 'dx2-never-v2', v1);
    await client.connect();
    expect((await frames(v1)).status).not.toBe(403);
    await client.close();
  });
});
