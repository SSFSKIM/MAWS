// The hub's HTTP boundary (P5 O8 M1, hub-client.ts): what an answer may carry past it. A Worker's `error` reaches
// refusals and the log only as a short code, an email and an instant only in their grammar, and the certificates only as
// a set of signed items, so a hostile hub can't reflect the bearer token outward or hand O7 a set it can't walk.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The hub's error vocabulary, imported here only (never by product code, which imports nothing from desk-hub).
import type { ProvisioningKeyError, RedeemError, WrappedKeyError } from '../../../apps/desk-hub/src/protocol/identity';
import { generateSigningKey, keyId, signRecord, SIGNING_DOMAINS } from '../../../apps/org-protocol/src/index.ts';
import { ERROR_CODES, hubClient } from './hub-client';

const HUB = 'https://hub.example.test';
const TOKEN = `eyJhbGciOiJSUzI1NiJ9.${'x'.repeat(600)}.${'s'.repeat(342)}`;
const worker = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-desk-build': 'test 0.0.0' } });

function over(answer: () => Response) {
  return hubClient({ url: HUB, headers: () => Promise.resolve({ 'cf-access-token': TOKEN }), fetch: (async () => answer()) as typeof fetch });
}

describe('the hub client', () => {
  it('keeps a Worker error code, and reads any other error text as `unrecognized`', async () => {
    expect(await over(() => worker(409, { error: 'too-many' })).state()).toEqual({ ok: false, kind: 'status', status: 409, error: 'too-many' });
    const reflected = await over(() => worker(400, { error: `bad token ${TOKEN}` })).state();
    expect(reflected).toEqual({ ok: false, kind: 'status', status: 400, error: 'unrecognized' });
    expect(JSON.stringify(await over(() => worker(400, { error: TOKEN })).chain(0))).not.toContain(TOKEN);
  });

  it('reads /api/me naming the token as its email, and a pending entry whose end is not an instant, as malformed', async () => {
    const me = { org: { id: 'o' }, member: { id: 'm', email: `${TOKEN}@example.com`, role: 'admin' } };
    expect(await over(() => worker(200, me)).me()).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
    const fine = { ...me, member: { ...me.member, email: 'owner@example.com' } };
    expect(await over(() => worker(200, fine)).me()).toMatchObject({ ok: true, value: { member: { email: 'owner@example.com' } } });
    const entry = { deviceId: 'd', class: 'native-mac', keyStorage: 'software', channelPub: 'c', stepUpPub: 's', mac: 'm' } as const;
    expect(await over(() => worker(200, { pending: { expires: TOKEN } })).postPending(entry)).toMatchObject({ ok: false, error: 'malformed' });
    expect(await over(() => worker(200, { pending: { expires: '2026-10-28T12:00:00.000Z' } })).postPending(entry)).toEqual({ ok: true, value: { pending: { expires: '2026-10-28T12:00:00.000Z' } } });
  });

  it('reads a certificate set that is not one as malformed, drops items that are not signed certificates, and reads an absent set as null', async () => {
    const view = (certificates: unknown) => ({ head: null, transitions: [], chain: [], ...(certificates === undefined ? {} : { certificates }) });
    expect(await over(() => worker(200, view({ certs: 'x', retirements: [] }))).chain(0)).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
    expect(await over(() => worker(200, view([]))).state()).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
    expect(await over(() => worker(200, view(undefined))).chain(0)).toMatchObject({ ok: true, value: { certificates: null } });

    const delegation = await generateSigningKey();
    const machine = await generateSigningKey();
    const cert = await signRecord(
      SIGNING_DOMAINS.machineCert,
      { org: 'o', machine: 'a'.repeat(32), name: 'vm-one', pub: machine.pub, delegation: 'b'.repeat(32), use: 1, issued: new Date().toISOString() },
      delegation.privateKey,
      delegation.pub,
    );
    const retirement = await signRecord(SIGNING_DOMAINS.certRetire, { org: 'o', keyId: await keyId(machine.pub), notAfter: new Date().toISOString() }, delegation.privateKey, delegation.pub);
    const read = await over(() => worker(200, view({ certs: [null, cert, { body: 1 }], retirements: [retirement, 'x'] }))).chain(0);
    expect(read).toMatchObject({ ok: true, value: { certificates: { certs: [cert], retirements: [retirement] } } });
  });

  it('reads a member\'s pending entries (M4a, H1): the plain read for null, `?member=` for another, items out of shape dropped, the hub\'s own fields left out', async () => {
    const paths: string[] = [];
    const entry = { deviceId: 'dev-1', class: 'native-mac', keyStorage: 'software', channelPub: 'c', stepUpPub: 's', mac: 'm' } as const;
    const passkeyed = { deviceId: 'dev-2', class: 'web-cards', keyStorage: 'webcrypto', channelPub: 'c2', passkey: { credentialId: 'i', publicKey: 'p', rpId: 'desk.example' }, mac: 'm2' } as const;
    const hubFields = { member: 'a'.repeat(32), created: '2026-10-29T12:00:00.000Z', expires: '2026-10-29T12:10:00.000Z' };
    const client = (answer: () => Response) =>
      hubClient({
        url: HUB,
        headers: () => Promise.resolve({ 'cf-access-token': TOKEN }),
        fetch: (async (url: string) => {
          paths.push(new URL(url).pathname + new URL(url).search);
          return answer();
        }) as typeof fetch,
      });
    const served = { pending: [{ ...entry, ...hubFields }, null, { deviceId: 3 }, { ...entry, stepUpPub: 7 }, { ...passkeyed, ...hubFields }] };
    expect(await client(() => worker(200, served)).pendingOf(null)).toEqual({ ok: true, value: [entry, passkeyed] });
    const other = 'b'.repeat(32);
    expect(await client(() => worker(200, { pending: [] })).pendingOf(other)).toEqual({ ok: true, value: [] });
    expect(paths).toEqual(['/api/devices/pending', `/api/devices/pending?member=${other}`]);

    expect(await client(() => worker(403, { error: 'not-admin' })).pendingOf(other)).toEqual({ ok: false, kind: 'status', status: 403, error: 'not-admin' });
    expect(await client(() => worker(404, { error: 'no-member' })).pendingOf(other)).toEqual({ ok: false, kind: 'status', status: 404, error: 'no-member' });
    expect(await client(() => worker(503, { error: 'hub-updating' })).pendingOf(other)).toEqual({ ok: false, kind: 'status', status: 503, error: 'hub-updating' });
    expect(await client(() => worker(200, { pending: 'none' })).pendingOf(null)).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
  });

  it('posts a signed state as its body, reads 201 as its version, and keeps a 409 verdict as its error code', async () => {
    const posted: Array<{ method: string; url: string; body: unknown; type: string | null }> = [];
    const signed = { state: { org: 'o', version: 2 }, sigs: [] } as never;
    const client = (answer: Response) =>
      hubClient({
        url: `${HUB}/`,
        headers: () => Promise.resolve({ 'cf-access-token': TOKEN }),
        fetch: (async (url: string, init: RequestInit) => {
          posted.push({ method: init.method!, url, body: JSON.parse(String(init.body)), type: new Headers(init.headers).get('content-type') });
          return answer;
        }) as typeof fetch,
      });
    expect(await client(worker(201, { version: 2 })).postState(signed)).toEqual({ ok: true, value: { version: 2 } });
    expect(posted).toEqual([{ method: 'POST', url: `${HUB}/api/org/state`, body: signed, type: 'application/json' }]);
    expect(await client(worker(409, { error: 'not-head', message: 'the head is version 3; fetch it and sign again on it' })).postState(signed)).toEqual({
      ok: false,
      kind: 'status',
      status: 409,
      error: 'not-head',
    });
    expect(await client(worker(201, { version: 'two' })).postState(signed)).toEqual({ ok: false, kind: 'status', status: 201, error: 'malformed' });
  });

  it("reads a project's history attestations (M7a): the member's route, items that are no signed record dropped", async () => {
    const paths: string[] = [];
    const project = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
    const key = await generateSigningKey();
    const body = { org: 'o', project, writer: 'mini/s', names: ['mini'], upTo: 2, digest: 'A'.repeat(43), created: '2026-11-06T12:00:00.000Z' };
    const record = await signRecord(SIGNING_DOMAINS.historyAttest, body, key.privateKey, key.pub);
    const client = hubClient({
      url: HUB,
      headers: () => Promise.resolve({}),
      fetch: (async (url: string) => {
        paths.push(new URL(url).pathname);
        return worker(200, { records: [record, { body: { ...body, upTo: 'x' }, sig: record.sig }, 'x'] });
      }) as typeof fetch,
    });
    expect(await client.attestations(project)).toEqual({ ok: true, value: [record] });
    expect(paths).toEqual([`/api/projects/${project}/attestations`]);
    expect(await over(() => worker(200, { records: 'x' })).attestations(project)).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
  });

  it("mints an enrollment (M4b): POST {ttl_s, machine?}, the token and the enrollment's id and end kept only in their grammar", async () => {
    const sent: Array<{ method: string; path: string; body: unknown }> = [];
    const client = (answer: () => Response) =>
      hubClient({
        url: HUB,
        headers: () => Promise.resolve({}),
        fetch: (async (url: string, init: RequestInit) => {
          sent.push({ method: init.method!, path: new URL(url).pathname, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
          return answer();
        }) as typeof fetch,
      });
    const id = 'e'.repeat(32);
    const record = { id, created_by: 'a'.repeat(32), created: '2026-11-08T12:00:00.000Z', expires: '2026-11-08T13:00:00.000Z', state: 'open', machine: null };
    const token = 'T'.repeat(43);
    expect(await client(() => worker(201, { enrollment: record, token })).mintEnrollment({ ttl_s: 3600, machine: 'mini' })).toEqual({
      ok: true,
      value: { id, expires: '2026-11-08T13:00:00.000Z', token },
    });
    expect(await client(() => worker(201, { enrollment: record, token })).mintEnrollment({ ttl_s: 3600 })).toMatchObject({ ok: true });
    expect(sent).toEqual([
      { method: 'POST', path: '/api/enrollments', body: { ttl_s: 3600, machine: 'mini' } },
      { method: 'POST', path: '/api/enrollments', body: { ttl_s: 3600 } },
    ]);
    for (const bad of [{ enrollment: { ...record, id: TOKEN }, token }, { enrollment: { ...record, expires: TOKEN }, token }, { enrollment: record, token: TOKEN }, { enrollment: record }]) {
      expect(JSON.stringify(await client(() => worker(201, bad)).mintEnrollment({ ttl_s: 3600 }))).toBe(JSON.stringify({ ok: false, kind: 'status', status: 201, error: 'malformed' }));
    }
    expect(await client(() => worker(403, { error: 'not-admin' })).mintEnrollment({ ttl_s: 3600 })).toEqual({ ok: false, kind: 'status', status: 403, error: 'not-admin' });
  });

  it("reads an enrollment's posted key (M4b): its name, ref, pub and MAC as strings, unjudged (the MAC check is the enrollment's)", async () => {
    const paths: string[] = [];
    const client = (answer: () => Response) =>
      hubClient({
        url: HUB,
        headers: () => Promise.resolve({}),
        fetch: (async (url: string) => {
          paths.push(new URL(url).pathname);
          return answer();
        }) as typeof fetch,
      });
    const id = 'e'.repeat(32);
    const key = { enrollment: id, machine: 'mini', pub: 'P'.repeat(87), ref: 'R'.repeat(22), mac: 'M'.repeat(43), posted: '2026-11-08T12:01:00.000Z' };
    expect(await client(() => worker(200, key)).enrollmentKey(id)).toEqual({ ok: true, value: { machine: 'mini', pub: key.pub, ref: key.ref, mac: key.mac } });
    expect(paths).toEqual([`/api/enrollments/${id}/key`]);
    expect(await client(() => worker(404, { error: 'no-key' })).enrollmentKey(id)).toEqual({ ok: false, kind: 'status', status: 404, error: 'no-key' });
    expect(await client(() => worker(200, { ...key, mac: 7 })).enrollmentKey(id)).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
    expect(await client(() => worker(200, { ...key, pub: 'P'.repeat(4096) })).enrollmentKey(id)).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
  });

  it("deletes a machine's hub row (M4b): DELETE /api/machines/<name>, 200 deleted and 404 already absent", async () => {
    const sent: string[] = [];
    const client = (answer: () => Response) =>
      hubClient({
        url: HUB,
        headers: () => Promise.resolve({}),
        fetch: (async (url: string, init: RequestInit) => {
          sent.push(`${init.method} ${new URL(url).pathname}`);
          return answer();
        }) as typeof fetch,
      });
    expect(await client(() => worker(200, { revoked: 'mini box' })).deleteMachine('mini box')).toEqual({ ok: true, value: 'deleted' });
    expect(await client(() => worker(404, { error: 'unknown-machine' })).deleteMachine('mini')).toEqual({ ok: true, value: 'absent' });
    expect(sent).toEqual(['DELETE /api/machines/mini%20box', 'DELETE /api/machines/mini']);
    expect(await client(() => worker(403, { error: 'not-admin' })).deleteMachine('mini')).toEqual({ ok: false, kind: 'status', status: 403, error: 'not-admin' });
    expect(await client(() => worker(503, { error: 'hub-updating' })).deleteMachine('mini')).toEqual({ ok: false, kind: 'status', status: 503, error: 'hub-updating' });
  });

  it('lists the hub rows (M4b): GET /api/machines, each name with the key its enrollment posted, or none', async () => {
    const sent: string[] = [];
    const client = (answer: () => Response) =>
      hubClient({
        url: HUB,
        headers: () => Promise.resolve({}),
        fetch: (async (url: string, init: RequestInit) => {
          sent.push(`${init.method} ${new URL(url).pathname}`);
          return answer();
        }) as typeof fetch,
      });
    const rows = [
      { name: 'mini', client_id: 'c1', token_name: 't', state: 'active', enrollment: 'e1', created: 'x', confirmed: null, key: { ref: 'R', pub: 'P', listed: true } },
      { name: 'old', client_id: 'c2', token_name: 't', state: 'active', enrollment: 'e2', created: 'x', confirmed: null },
    ];
    expect(await client(() => worker(200, { machines: rows })).machines()).toEqual({ ok: true, value: [{ name: 'mini', key: { ref: 'R', pub: 'P' } }, { name: 'old', key: null }] });
    expect(sent).toEqual(['GET /api/machines']);
    for (const bad of [{ machines: [{ name: '' }] }, { machines: [{ name: 'mini', key: { ref: 'R' } }] }, { machines: 'none' }, {}]) {
      expect(await client(() => worker(200, bad)).machines()).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
    }
    expect(await client(() => worker(403, { error: 'not-admin' })).machines()).toEqual({ ok: false, kind: 'status', status: 403, error: 'not-admin' });
  });

  it("sends the dropped machine's ref and pub with the DELETE, both encoded, and neither when no key is given", async () => {
    const sent: string[] = [];
    const client = (answer: () => Response) =>
      hubClient({
        url: HUB,
        headers: () => Promise.resolve({}),
        fetch: (async (url: string, init: RequestInit) => {
          const at = new URL(url);
          sent.push(`${init.method} ${at.pathname}${at.search}`);
          return answer();
        }) as typeof fetch,
      });
    const key = { ref: 'r/ef+1', pub: 'MCow BQ/+=' };
    expect(await client(() => worker(200, { revoked: 'mini box' })).deleteMachine('mini box', key)).toEqual({ ok: true, value: 'acknowledged' });
    expect(await client(() => worker(200, { revoked: 'mini' })).deleteMachine('mini')).toEqual({ ok: true, value: 'deleted' });
    expect(sent).toEqual(['DELETE /api/machines/mini%20box?ref=r%2Fef%2B1&pub=MCow%20BQ%2F%2B%3D', 'DELETE /api/machines/mini']);
    // a precondition out of shape is a refusal as any other status is
    expect(await client(() => worker(400, { error: 'bad-shape' })).deleteMachine('mini', key)).toEqual({ ok: false, kind: 'status', status: 400, error: 'bad-shape' });
  });
});

// M4c: the provisioning keys' four routes (the Registry's `createProvisioningKey`, `provisioningKeys`,
// `revokeProvisioningKey` and the desk track's `renewProvisioningKey`), each read in its grammar so the create
// transaction and the view can trust what they get; the minted token is a secret that no failure, error or log carries.
describe("the hub client's provisioning keys (M4c)", () => {
  const ID = 'c'.repeat(32);
  const MINT_TOKEN = 'T0k3n_-'.repeat(7).slice(0, 43);
  const record = (over: Record<string, unknown> = {}) => ({
    id: ID,
    label: 'devcloud VMs',
    prefix: 'dc-',
    created_by: 'a'.repeat(32),
    created: '2026-11-08T12:00:00.000Z',
    expires: '2026-12-08T12:00:00.000Z',
    max_uses: null,
    uses: 2,
    offline_revoke_s: null,
    revoked: null,
    machines: [{ name: 'dc-vm1', state: 'active' }],
    delegation: { pub: 'P', owners: 'org' },
    ...over,
  });
  const key = (over: Record<string, unknown> = {}) => {
    const { id, label, prefix, created, expires, max_uses, uses, revoked } = record(over);
    return { id, label, prefix, created, expires, max_uses, uses, revoked };
  };
  const sent: Array<{ method: string; path: string; body: string | null }> = [];
  const client = (answer: () => Response) =>
    hubClient({
      url: HUB,
      headers: () => Promise.resolve({ 'cf-access-token': TOKEN }),
      fetch: (async (url: string, init: RequestInit) => {
        sent.push({ method: init.method!, path: new URL(url).pathname, body: init.body === undefined ? null : String(init.body) });
        return answer();
      }) as typeof fetch,
    });
  const logged: string[] = [];
  beforeEach(() => {
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    }
  });
  afterEach(() => {
    sent.length = 0;
    logged.length = 0;
    vi.restoreAllMocks();
  });

  it('mints a key: POST {label, prefix, ttl_s, max_uses?} exactly as given, and reads 201 {key, token} in their grammar', async () => {
    const answer = () => worker(201, { key: record(), token: MINT_TOKEN });
    expect(await client(answer).mintProvisioningKey({ label: 'devcloud VMs', prefix: 'dc-', ttl_s: 2_592_000 })).toEqual({ ok: true, value: { key: key(), token: MINT_TOKEN } });
    expect(await client(answer).mintProvisioningKey({ label: 'devcloud VMs', prefix: 'dc-', ttl_s: 2_592_000, max_uses: 5 })).toMatchObject({ ok: true });
    expect(sent).toEqual([
      { method: 'POST', path: '/api/provisioning-keys', body: JSON.stringify({ label: 'devcloud VMs', prefix: 'dc-', ttl_s: 2_592_000 }) },
      { method: 'POST', path: '/api/provisioning-keys', body: JSON.stringify({ label: 'devcloud VMs', prefix: 'dc-', ttl_s: 2_592_000, max_uses: 5 }) },
    ]);
  });

  it('reads any 2xx but 201 to the mint as a failure, and the token reaches no failure, error or log line', async () => {
    for (const status of [200, 202]) {
      const answer = await client(() => worker(status, { key: record(), token: MINT_TOKEN })).mintProvisioningKey({ label: 'l', prefix: 'dc-', ttl_s: 3600 });
      expect(answer).toEqual({ ok: false, kind: 'status', status, error: 'unexpected-status' });
    }
    const failures = [
      await client(() => worker(201, { key: record({ id: 'C'.repeat(32) }), token: MINT_TOKEN })).mintProvisioningKey({ label: 'l', prefix: 'dc-', ttl_s: 3600 }),
      await client(() => worker(201, { key: record(), token: `${MINT_TOKEN}!` })).mintProvisioningKey({ label: 'l', prefix: 'dc-', ttl_s: 3600 }),
      await client(() => worker(201, { key: record({ expires: MINT_TOKEN }), token: MINT_TOKEN })).mintProvisioningKey({ label: 'l', prefix: 'dc-', ttl_s: 3600 }),
      await client(() => worker(400, { error: `bad-shape ${MINT_TOKEN}`, token: MINT_TOKEN })).mintProvisioningKey({ label: 'l', prefix: 'dc-', ttl_s: 3600 }),
      await client(() => worker(400, { error: MINT_TOKEN })).mintProvisioningKey({ label: 'l', prefix: 'dc-', ttl_s: 3600 }),
    ];
    for (const failure of failures) expect(failure).toMatchObject({ ok: false });
    expect(JSON.stringify(failures)).not.toContain(MINT_TOKEN);
    // a token can't pass as an error code, nor can any fragment of one in the codes' alphabet: only the Worker's own
    // codes are read (I3, the fix wave)
    const lower = 'abcdefghij'.repeat(5).slice(0, 43);
    for (const error of [lower, lower.slice(0, 40), lower.slice(3, 12), 'k3n-x7q']) {
      const answer = await client(() => worker(409, { error })).mintProvisioningKey({ label: 'l', prefix: 'dc-', ttl_s: 3600 });
      expect(answer, error).toEqual({ ok: false, kind: 'status', status: 409, error: 'unrecognized' });
      expect(logged.filter((line) => line.includes(error))).toEqual([]);
    }
    expect(JSON.stringify(failures)).not.toContain(MINT_TOKEN.slice(0, 20));
    expect(logged.filter((line) => line.includes(MINT_TOKEN.slice(0, 20)))).toEqual([]);
  });

  it('renews a key: POST …/<id>/renew with no body, answered by the bare record, its id the one asked', async () => {
    const renewed = record({ expires: '2027-01-08T12:00:00.000Z' });
    expect(await client(() => worker(200, renewed)).renewProvisioningKey(ID)).toEqual({ ok: true, value: key({ expires: '2027-01-08T12:00:00.000Z' }) });
    expect(sent).toEqual([{ method: 'POST', path: `/api/provisioning-keys/${ID}/renew`, body: null }]);
    expect(await client(() => worker(200, { key: renewed })).renewProvisioningKey(ID)).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
    expect(await client(() => worker(200, record({ id: 'd'.repeat(32) }))).renewProvisioningKey(ID)).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
  });

  it("passes the Worker's codes every caller branches on or shows, and nothing else", async () => {
    // the codes the session, the signer, the pairing and enrollment read (org-session.ts, signer.ts, pairing.ts,
    // enroll.ts), and some they only show
    for (const [status, error] of [[409, 'not-head'], [409, 'rollback'], [403, 'not-admin'], [404, 'no-member'], [403, 'not-yours'], [404, 'unknown-enrollment'], [404, 'unknown-machine'], [409, 'key-purged'], [400, 'bad-shape'], [400, 'malformed'], [429, 'too-many'], [409, 'busy'], [503, 'hub-updating']] as const) {
      expect(await client(() => worker(status, { error })).provisioningKeys(), error).toEqual({ ok: false, kind: 'status', status, error });
    }
    expect(await client(() => worker(403, { error: 'not-a-member' })).provisioningKeys()).toEqual({ ok: false, kind: 'denied', status: 403 });
    for (const error of ['not-a-code', 'unknown-keys', 'Unknown-key', 'unknown-key ']) {
      expect(await client(() => worker(404, { error })).revokeProvisioningKey(ID), error).toEqual({ ok: false, kind: 'status', status: 404, error: 'unrecognized' });
    }
  });

  it("keeps each refusal's code, and tells a route the hub lacks (404 not-found, the Worker's) from a key it lacks (404 unknown-key)", async () => {
    const refusals: Array<[number, string]> = [
      [404, 'unknown-key'],
      [404, 'not-found'],
      [410, 'key-revoked'],
      [410, 'key-expired'],
      [409, 'not-renewed'],
      [409, 'too-long'],
      [503, 'hub-updating'],
      [403, 'not-admin'],
    ];
    for (const [status, error] of refusals) {
      expect(await client(() => worker(status, { error, message: 'words' })).renewProvisioningKey(ID), error).toEqual({ ok: false, kind: 'status', status, error });
    }
    // a 404 without the Worker's build header is no Worker's answer: no code is read from it
    expect(await client(() => new Response(JSON.stringify({ error: 'not-found' }), { status: 404 })).renewProvisioningKey(ID)).toEqual({ ok: false, kind: 'status', status: 404, error: null });
  });

  it('revokes a key: DELETE …/<id>, 200 {revoked: id} revoked and 404 unknown-key already gone; a missing route stays a failure', async () => {
    expect(await client(() => worker(200, { revoked: ID })).revokeProvisioningKey(ID)).toEqual({ ok: true, value: 'revoked' });
    expect(await client(() => worker(404, { error: 'unknown-key' })).revokeProvisioningKey(ID)).toEqual({ ok: true, value: 'absent' });
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([`DELETE /api/provisioning-keys/${ID}`, `DELETE /api/provisioning-keys/${ID}`]);
    expect(await client(() => worker(404, { error: 'not-found' })).revokeProvisioningKey(ID)).toEqual({ ok: false, kind: 'status', status: 404, error: 'not-found' });
    expect(await client(() => worker(200, { revoked: 'd'.repeat(32) })).revokeProvisioningKey(ID)).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
    expect(await client(() => worker(403, { error: 'not-admin' })).revokeProvisioningKey(ID)).toEqual({ ok: false, kind: 'status', status: 403, error: 'not-admin' });
  });

  it('lists the keys, revoked ones included, each in its grammar; one out of shape fails the read', async () => {
    const revoked = record({ id: 'e'.repeat(32), max_uses: 10, revoked: '2026-11-09T00:00:00.000Z', machines: [] });
    expect(await client(() => worker(200, { keys: [record(), revoked] })).provisioningKeys()).toEqual({ ok: true, value: { keys: [key(), key({ id: 'e'.repeat(32), max_uses: 10, revoked: '2026-11-09T00:00:00.000Z' })] } });
    expect(sent).toEqual([{ method: 'GET', path: '/api/provisioning-keys', body: null }]);
    for (const bad of [
      record({ id: 'short' }),
      record({ label: '' }),
      record({ prefix: 7 }),
      record({ created: 'yesterday' }),
      record({ expires: null }),
      record({ max_uses: 0 }),
      record({ uses: -1 }),
      record({ revoked: 'soon' }),
    ]) {
      expect(await client(() => worker(200, { keys: [record(), bad] })).provisioningKeys()).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
    }
    expect(await client(() => worker(200, { keys: 'none' })).provisioningKeys()).toEqual({ ok: false, kind: 'status', status: 200, error: 'malformed' });
  });
});

/** `true` exactly when the list `L` names every member of the union `T`; else what it lacks. */
type Names<T extends string, L extends readonly string[]> = [Exclude<T, L[number]>] extends [never] ? true : { lacks: Exclude<T, L[number]> };

// M4c Task 4: the allowlist can't drift from the hub's vocabulary. A code the hub adds would read `unrecognized` here
// with no failure anywhere, so CI fails instead: the typecheck when one of desk-hub's exported error unions gains a
// member (each list below must name every member), and this suite when a route of the Worker's answers a literal code
// the list lacks.
describe("the hub client's error codes against desk-hub's vocabulary", () => {
  const provisioningKeyErrors = ['bad-shape', 'not-admin', 'unknown-key', 'key-revoked', 'key-expired', 'not-renewed', 'too-long'] as const satisfies readonly ProvisioningKeyError[];
  const redeemErrors = ['bad-shape', 'bad-name', 'unknown-token', 'expired', 'confirmed', 'token-used', 'name-taken', 'busy', 'mint-failed', 'key-revoked', 'key-expired', 'key-exhausted', 'prefix-mismatch', 'not-active'] as const satisfies readonly RedeemError[];
  const wrappedKeyErrors = ['bad-shape', 'not-admin', 'not-key-holder', 'different-key', 'credential-taken', 'unknown-key', 'last-key'] as const satisfies readonly WrappedKeyError[];
  // Each list names every member of its union: a member the hub adds and a list lacks makes this a type error.
  const complete: [Names<ProvisioningKeyError, typeof provisioningKeyErrors>, Names<RedeemError, typeof redeemErrors>, Names<WrappedKeyError, typeof wrappedKeyErrors>] = [true, true, true];
  const unions = { ProvisioningKeyError: provisioningKeyErrors, RedeemError: redeemErrors, WrappedKeyError: wrappedKeyErrors };

  it("holds every member of identity.ts's exported error unions", () => {
    expect(complete).toEqual([true, true, true]);
    for (const [union, codes] of Object.entries(unions)) for (const code of codes) expect(ERROR_CODES.has(code), `${union}: ${code}`).toBe(true);
  });

  it('holds every code a route of the Worker answers by its literal, and the two org-chain.ts answers by variable', () => {
    const root = join(__dirname, '../../../apps/desk-hub/src');
    const sources = (readdirSync(root, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
      .map((entry) => join(entry.parentPath, entry.name));
    const answered = new Set<string>();
    // `fail(409, 'code', …)`, `refused(…)`, `json(404, {error: 'code'})`, and any `{error: 'code'}` an answer is built from
    const literal = [/\b(?:fail|refused|json)\(\s*\d{3},\s*(?:\{\s*error:\s*)?'([a-z0-9-]+)'/g, /\berror:\s*'([a-z0-9-]+)'/g];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of literal) for (const match of text.matchAll(pattern)) answered.add(match[1]);
    }
    // The scan reaches the routes: the provisioning keys' and the Worker's own fallbacks are among what it found.
    for (const known of ['hub-updating', 'not-found', 'method-not-allowed', 'key-revoked', 'not-renewed', 'too-long']) expect(answered.has(known), known).toBe(true);
    for (const code of [...answered, 'not-head', 'rollback']) expect(ERROR_CODES.has(code), code).toBe(true);
  });
});
