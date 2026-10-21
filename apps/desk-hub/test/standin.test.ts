// The local stand-in for Access (local/): what DC4 and DC5 meet in front of the local hub. It admits what Access would
// admit, as Access would (a signed assertion added, anything a client sent in its place dropped), and answers the
// certificate endpoint and the service-token API the Worker calls.
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessStandin, enrollmentCode, provisioningCode, REDEEM_PATH } from '../local/standin.ts';
import { base64urlEncode } from '../src/protocol/base64url';
import {
  decodeEnrollmentCode,
  decodeProvisioningCode,
  encodeEnrollmentCode,
  encodeProvisioningCode,
  REDEEM_PATH as PROTOCOL_REDEEM_PATH,
  type ProvisioningKeyRecord,
} from '../src/protocol/identity';
import { enroll, refusal } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());

describe('the stand-in for Access', () => {
  it('refuses a request that carries no identity, as Access does, telling how to sign in', async () => {
    const response = await hub.fetchAs(null, '/api/me');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'access-denied', message: expect.stringContaining('/standin/login') });
  });

  it('drops an assertion a client forged, and signs its own for the identity it admits', async () => {
    const forged = await hub.fetchAs(null, '/api/me', { headers: { 'Cf-Access-Jwt-Assertion': 'a.forged.assertion' } });
    expect(forged.status).toBe(403);
    expect((await hub.fetchAs(ADMIN, '/api/me', { headers: { 'Cf-Access-Jwt-Assertion': 'a.forged.assertion' } })).status).toBe(200);
  });

  it('signs a browser in with a cookie, which a WebSocket carries as well as a fetch', async () => {
    const login = await fetch(`${hub.url}/standin/login?email=${encodeURIComponent(ADMIN)}`, { redirect: 'manual' });
    expect(login.status).toBe(302);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const me = await fetch(`${hub.url}/api/me`, { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { member: { email: string } }).member.email).toBe(ADMIN);
  });

  it("refuses a service token it does not hold, or one with the wrong secret, as production Access does: 401 and its own page (the deploy probe's A4)", async () => {
    const bogus = await hub.fetchAs({ clientId: 'nobody.access', clientSecret: 'x' }, '/machine/stream');
    expect(bogus.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await refusal(bogus)).toBe('401 access');
    const held = await enroll(hub, ADMIN, 'standin-1');
    expect(await refusal(await hub.fetchAs({ clientId: held.clientId, clientSecret: 'wrong' }, '/machine/stream'))).toBe('401 access');
    // A WebSocket's upgrade is refused the same.
    const url = new URL('/api/registry/socket', hub.url);
    const upgrade = await new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
      const request = httpRequest({
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: { 'CF-Access-Client-Id': 'nobody.access', 'CF-Access-Client-Secret': 'x', Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' },
      });
      request.on('response', (response) => {
        let body = '';
        response.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, type: response.headers['content-type'] ?? '', body }));
      });
      request.on('upgrade', () => reject(new Error('the upgrade was admitted')));
      request.on('error', reject);
      request.end();
    });
    expect(upgrade.status).toBe(401);
    expect(upgrade.type).toMatch(/^text\/html/);
    expect(upgrade.body).toContain('Cloudflare Access');
  });

  it('lets the redeem path through bare, as the Bypass policy will', async () => {
    expect(REDEEM_PATH).toBe(PROTOCOL_REDEEM_PATH);
    const response = await hub.fetchAs(null, REDEEM_PATH, { body: { token: 'A'.repeat(43), machine: 'mini' } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'unknown-token' });
  });

  it('serves its signing key at the certificate endpoint', async () => {
    const response = await fetch(`${hub.url}/standin/certs`);
    expect(((await response.json()) as { keys: Array<{ kty: string; kid: string }> }).keys).toEqual([expect.objectContaining({ kty: 'RSA' })]);
  });

  it('answers the service-token API only to the bearer of its API token, in the account it serves', async () => {
    const base = `${hub.url}/standin/client/v4/accounts/${hub.standin.account}/access/service_tokens`;
    expect((await fetch(base, { method: 'POST', body: '{"name":"x"}' })).status).toBe(403);
    const auth = { Authorization: `Bearer ${hub.standin.apiToken}` };
    const created = (await (await fetch(base, { method: 'POST', headers: auth, body: '{"name":"desk-x"}' })).json()) as { result: { id: string; client_secret: string } };
    expect(created.result.client_secret).toMatch(/^[0-9a-f]{64}$/);
    const listed = (await (await fetch(`${base}?name=desk-x`, { headers: auth })).json()) as { result: Array<{ id: string; client_secret?: string }> };
    expect(listed.result).toEqual([expect.objectContaining({ id: created.result.id })]);
    expect(listed.result[0].client_secret).toBeUndefined();
    expect((await fetch(`${base}/${created.result.id}`, { method: 'DELETE', headers: auth })).status).toBe(200);
    expect((await fetch(`${base}/${created.result.id}`, { method: 'DELETE', headers: auth })).status).toBe(404);
  });

  it("builds an enrollment code the protocol module's decoder reads (the local command's helper)", () => {
    const code = { hub: 'http://127.0.0.1:8747', org: 'local', token: 'tok', machine: 'mini', key: base64urlEncode(new Uint8Array(32).fill(3)) };
    expect(decodeEnrollmentCode(enrollmentCode(code))).toEqual(code);
    expect(enrollmentCode(code)).toBe(encodeEnrollmentCode(code));
  });

  it("builds a provisioning code the protocol module's decoder reads", () => {
    const code = { hub: 'http://127.0.0.1:8747', org: 'local', token: 'secret', prefix: 'dc-', key: base64urlEncode(new Uint8Array(32).fill(4)) };
    expect(decodeProvisioningCode(provisioningCode(code))).toEqual(code);
    expect(provisioningCode(code)).toBe(encodeProvisioningCode(code));
  });

  it('hands out an enrollment code and a provisioning code without a browser, the org key reused when given', async () => {
    const one = await fetch(`${hub.url}/standin/enrollment-code`, { method: 'POST', body: JSON.stringify({ machine: 'helper-1' }) });
    expect(one.status).toBe(200);
    const enrollment = (await one.json()) as { code: string; key: string; token: string };
    expect(decodeEnrollmentCode(enrollment.code)).toEqual({ hub: hub.url, org: ORG, token: enrollment.token, machine: 'helper-1', key: enrollment.key });

    const response = await fetch(`${hub.url}/standin/provisioning-code`, { method: 'POST', body: JSON.stringify({ prefix: 'dc-', offline_revoke_s: 3600, key: enrollment.key }) });
    expect(response.status).toBe(200);
    const { code, key, id } = (await response.json()) as { code: string; key: string; id: string };
    expect(key).toBe(enrollment.key);
    const decoded = decodeProvisioningCode(code);
    expect(decoded).toMatchObject({ hub: hub.url, org: ORG, prefix: 'dc-', key });
    const listed = ((await (await hub.fetchAs(ADMIN, '/api/provisioning-keys')).json()) as { keys: ProvisioningKeyRecord[] }).keys.find((k) => k.id === id);
    expect(listed).toMatchObject({ prefix: 'dc-', offline_revoke_s: 3600, max_uses: null, uses: 0 });
    // The code's secret enrolls a machine under the prefix.
    expect((await hub.fetchAs(null, REDEEM_PATH, { body: { token: decoded.token, machine: 'dc-helper-1' } })).status).toBe(200);
    // A fresh org key when none is given; the hub's refusal passed on.
    const fresh = (await (await fetch(`${hub.url}/standin/provisioning-code`, { method: 'POST', body: JSON.stringify({ prefix: 'dc-' }) })).json()) as { key: string };
    expect(fresh.key).not.toBe(key);
    expect(await refusal(await fetch(`${hub.url}/standin/provisioning-code`, { method: 'POST', body: JSON.stringify({ prefix: 'hub' }) }))).toBe('400 bad-shape');
  });

  it('keeps its key and tokens in a state it can resume from', async () => {
    let saved: unknown;
    const first = await AccessStandin.create({ issuer: 'i', audience: 'a', account: 'acct', persist: (state) => (saved = structuredClone(state)) });
    const again = await AccessStandin.create({ issuer: 'i', audience: 'a', account: 'acct', state: saved as never });
    expect(again.apiToken).toBe(first.apiToken);
    const certs = async (standin: AccessStandin) => (await standin.handle(new Request('http://x/standin/certs')))!.json();
    expect(await certs(again)).toEqual(await certs(first));
  });
});
