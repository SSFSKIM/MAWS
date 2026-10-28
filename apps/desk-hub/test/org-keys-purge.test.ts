// The wrapped copies of the org key purged on the head's word (O14 M5a, Interfaces §E): `POST /api/org/keys/purge`,
// an admin's, is refused until the head carries `legacyRetired`; it then deletes every copy and the org's key check and
// auth, after which the copies' routes answer that the key is retired, and no successor may drop the retirement.
import { generateSigningKey, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importOrgKey, keyAuth, keyCheck } from '../src/protocol/codes';
import type { WrappedKeys } from '../src/protocol/identity';
import { refusal } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, newDevice, next, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
const MEMBER = 'colleague@example.com';
const random = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('base64url');
let wrapped: () => Record<string, unknown>;

beforeAll(async () => {
  hub = await startLocalHub();
  await hub.addMember(MEMBER, 'member');
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  const key = await importOrgKey(crypto.getRandomValues(new Uint8Array(32)));
  const [check, auth] = [await keyCheck(key), await keyAuth(key)];
  wrapped = () => ({ method: 'passphrase', label: 'a passphrase', kdf: { name: 'argon2id', salt: random(16) }, iv: random(12), wrapped: random(48), check, auth });
});
afterAll(() => hub?.close());

const purge = (who = ADMIN) => hub.fetchAs(who, '/api/org/keys/purge', { method: 'POST' });
const keys = () => hub.fetchAs(ADMIN, '/api/org/keys');
async function post(edit: Parameters<typeof next>[1]): Promise<Response> {
  const signed = await signedBy(await next(head, edit), a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: signed });
  if (response.status === 201) head = signed;
  return response;
}
const retire = (s: { version: number; issued: string; legacyRetired?: unknown }) => void (s.legacyRetired = { version: s.version, at: s.issued });

describe('purging the wrapped org keys', () => {
  it('is refused before the head retires the key, and to a member who is not an admin', async () => {
    for (let i = 0; i < 2; i++) expect((await hub.fetchAs(ADMIN, '/api/org/keys', { body: wrapped() })).status).toBe(201);
    expect(await refusal(await purge())).toBe('409 not-retired');
    const me = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
    head = await signedBy(await genesis(ORG, me, ADMIN, a1, recovery), a1);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
    expect(await refusal(await purge())).toBe('409 not-retired');
    expect((await post(retire)).status).toBe(201);
    expect(await refusal(await purge(MEMBER))).toMatch(/^403 /);
    expect(((await (await keys()).json()) as WrappedKeys).keys).toHaveLength(2);
  });

  it('lists the copies through a Registry still on the code before the purge', async () => {
    await hub.registryLacks('wrappedOrgKeys');
    const response = await keys();
    await hub.registryLacks(null);
    expect(response.status).toBe(200);
    expect(((await response.json()) as WrappedKeys).keys).toHaveLength(2);
  });

  it('lets a successor drop the retirement while the copies are held, and take it again', async () => {
    expect((await post((s) => delete s.legacyRetired)).status).toBe(201);
    expect(await refusal(await purge())).toBe('409 not-retired');
    expect((await post(retire)).status).toBe(201);
  });

  it('deletes every copy and the key check on the head’s word; the copies’ routes then say the key is retired', async () => {
    const response = await purge();
    expect(response.status).toBe(200);
    const { purged } = (await response.json()) as { purged: { version: number; at: string } };
    expect(purged).toEqual({ version: head.state.version, at: expect.any(String) as string });
    expect(await refusal(await keys())).toBe('410 retired');
    expect(await refusal(await hub.fetchAs(ADMIN, '/api/org/keys', { body: wrapped() }))).toBe('409 retired');
    expect(await refusal(await hub.fetchAs(ADMIN, `/api/org/keys/${random(8)}`, { method: 'DELETE', body: {} }))).toBe('410 retired');
    const me = (await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { org: { key_check: string | null } };
    expect(me.org.key_check).toBeNull();
    // Purged once, it answers the same record again.
    expect((await (await purge()).json()) as unknown).toEqual({ purged });
  });

  it('refuses a successor that drops the retirement, and takes one that keeps it', async () => {
    expect(await refusal(await post((s) => delete s.legacyRetired))).toBe('409 key-purged');
    expect((await post((s) => s.projects.push({ id: 'p-after', name: 'after the purge' }))).status).toBe(201);
    expect(head.state.legacyRetired).toBeDefined();
  });
});
