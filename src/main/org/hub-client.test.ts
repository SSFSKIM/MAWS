// The hub's HTTP boundary (P5 O8 M1, hub-client.ts): what an answer may carry past it. A Worker's `error` reaches
// refusals and the log only as a short code, an email and an instant only in their grammar, and the certificates only as
// a set of signed items, so a hostile hub can't reflect the bearer token outward or hand O7 a set it can't walk.
import { describe, expect, it } from 'vitest';
import { generateSigningKey, keyId, signRecord, SIGNING_DOMAINS } from '../../../apps/org-protocol/src/index.ts';
import { hubClient } from './hub-client';

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
});
