// The org key's wrapped copies (DX7) on the local runtime, through the stand-in: stored verbatim, one org key ever
// (`key_check`, set by the first and compared with every later one, even when two first posts race), every change
// proved by the key itself (`auth`, whose SHA-256 the org keeps as `key_auth` and never shows), never the last removed,
// and an admin's to change.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importOrgKey, keyAuth, keyCheck } from '../src/protocol/codes';
import type { WrappedKeyRecord, WrappedKeys } from '../src/protocol/identity';
import { ADMIN, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
const MEMBER = 'colleague@example.com';
beforeAll(async () => {
  hub = await startLocalHub();
  await hub.addMember(MEMBER, 'member');
});
afterAll(() => hub?.close());

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const random = (n: number) => b64(crypto.getRandomValues(new Uint8Array(n)));
const ORG_KEY = importOrgKey(crypto.getRandomValues(new Uint8Array(32)));
const OTHER_KEY = importOrgKey(crypto.getRandomValues(new Uint8Array(32)));
let CHECK: string;
let AUTH: string;
beforeAll(async () => {
  CHECK = await keyCheck(await ORG_KEY);
  AUTH = await keyAuth(await ORG_KEY);
});

/** A wrapped key as a browser holding the org key would post it; the hub reads none of it but its shape, the check,
 * and the auth's digest. */
const wrappedKey = (extra: Record<string, unknown> = {}) => ({
  method: 'passphrase',
  label: 'my passphrase',
  kdf: { name: 'argon2id', t: 3, m: 65536, p: 4, salt: random(16) },
  iv: random(12),
  wrapped: random(48),
  check: CHECK,
  auth: AUTH,
  ...extra,
});

const post = (who: string, body: unknown) => hub.fetchAs(who, '/api/org/keys', { body });
/** `body` undefined sends none: the caller names the auth it sends, so a test of a missing one cannot get the key's. */
const remove = (who: string, id: string, body: unknown) => hub.fetchAs(who, `/api/org/keys/${id}`, { method: 'DELETE', body });
const list = async (who = ADMIN) => (await (await hub.fetchAs(who, '/api/org/keys')).json()) as WrappedKeys;
const textOf = async (response: Response) => {
  const text = await response.text();
  expect(text).not.toContain('key_auth');
  return JSON.parse(text) as Record<string, unknown>;
};

describe('wrapped org keys', () => {
  it('two first posts that race: one sets the key check and key auth in one step, the other is refused', async () => {
    expect(await list()).toEqual({ key_check: null, keys: [] });
    // Before the first key there is no proof to ask for: a malformed first post is refused for its shape, and sets nothing.
    const malformed = await post(ADMIN, wrappedKey({ iv: random(16) }));
    expect(malformed.status).toBe(400);
    expect(await textOf(malformed)).toMatchObject({ error: 'bad-shape' });
    expect(await list()).toEqual({ key_check: null, keys: [] });
    const other = wrappedKey({ check: await keyCheck(await OTHER_KEY), auth: await keyAuth(await OTHER_KEY), label: 'another key' });
    const [a, b] = await Promise.all([post(ADMIN, wrappedKey()), post(ADMIN, other)]);
    expect([a.status, b.status].sort()).toEqual([201, 403]);
    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    expect(await textOf(loser)).toMatchObject({ error: 'not-key-holder' });
    const { key } = (await textOf(winner)) as { key: WrappedKeyRecord };
    const kept = await list();
    expect(kept).toEqual({ key_check: key.check, keys: [key] });
    // Whichever won, the org's key is that one's, and its auth (not the loser's) proves it from now on.
    const me = (await textOf(await hub.fetchAs(ADMIN, '/api/me'))) as { org: Record<string, unknown> };
    expect(me.org.key_check).toBe(key.check);
    expect('key_auth' in me.org).toBe(false);
    if (key.check !== CHECK) {
      CHECK = key.check;
      AUTH = await keyAuth(await OTHER_KEY);
    }
  });

  it('stores a key as posted, the hub assigning id, created_by, and created; any member reads them, never the auth', async () => {
    const posted = wrappedKey({ method: 'passkey', label: 'MacBook Touch ID', credential: random(20) });
    const response = await post(ADMIN, posted);
    expect(response.status).toBe(201);
    const { key } = (await textOf(response)) as { key: WrappedKeyRecord };
    const adminId = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
    const stored: Record<string, unknown> = { ...posted };
    delete stored.auth;
    expect(key).toEqual({ ...stored, id: expect.stringMatching(/^[0-9a-f]{32}$/), created_by: adminId, created: expect.any(String) });
    const read = await hub.fetchAs(MEMBER, '/api/org/keys');
    const body = await textOf(read);
    expect(body.keys).toContainEqual(key);
    expect(JSON.stringify(body)).not.toContain(AUTH);
  });

  it('the attack without the key — junk under the public check, then every real record deleted — is refused at each step', async () => {
    const before = await list();
    const stolen = random(32);
    // Without the key, the shape of what is posted tells nothing either: every post is not-key-holder first.
    for (const body of [wrappedKey({ auth: undefined }), wrappedKey({ auth: 'not base64url!' }), wrappedKey({ auth: stolen, iv: random(16) }), { auth: stolen }, {}]) {
      const response = await post(ADMIN, body);
      expect(response.status, JSON.stringify(body)).toBe(403);
      expect(await textOf(response)).toMatchObject({ error: 'not-key-holder' });
    }
    const junk = await post(ADMIN, wrappedKey({ auth: stolen, wrapped: random(48) }));
    expect(junk.status).toBe(403);
    expect(await textOf(junk)).toMatchObject({ error: 'not-key-holder' });
    for (const key of before.keys) {
      for (const body of [{ auth: stolen }, {}, undefined]) {
        const response = await remove(ADMIN, key.id, body);
        expect(response.status).toBe(403);
        expect(await textOf(response)).toMatchObject({ error: 'not-key-holder' });
      }
    }
    // Without the key nothing about the records is told either: an unknown id is still not-key-holder.
    expect(await textOf(await remove(ADMIN, '0'.repeat(32), { auth: stolen }))).toMatchObject({ error: 'not-key-holder' });
    expect(await list()).toEqual(before);
  });

  it('with the key: refuses another key, a passkey wrapped twice, and every malformed shape', async () => {
    const { keys } = await list();
    expect(await textOf(await post(ADMIN, wrappedKey({ check: random(32) })))).toMatchObject({ error: 'different-key' });
    const passkey = keys.find((k) => k.method === 'passkey')!;
    const twice = await post(ADMIN, wrappedKey({ method: 'passkey', credential: passkey.credential }));
    expect(twice.status).toBe(409);
    expect(await textOf(twice)).toMatchObject({ error: 'credential-taken' });
    for (const bad of [
      { label: '' },
      { label: 'x'.repeat(101) },
      { kdf: 'argon2id' },
      { kdf: { pad: 'x'.repeat(1100) } },
      { iv: random(16) },
      { wrapped: random(32) },
      { check: random(31) },
      { method: 'password' },
      { method: 'passkey' },
      { method: 'passphrase', credential: random(20) },
      { iv: `${random(12)}=` },
    ]) {
      const response = await post(ADMIN, wrappedKey(bad));
      expect(response.status, JSON.stringify(bad)).toBe(400);
      expect(await textOf(response)).toMatchObject({ error: 'bad-shape' });
    }
    expect((await list()).keys).toHaveLength(keys.length);
  });

  it("is an admin's to add or remove", async () => {
    const { keys } = await list();
    const added = await post(MEMBER, wrappedKey());
    expect(added.status).toBe(403);
    expect(await textOf(added)).toMatchObject({ error: 'not-admin' });
    const removed = await remove(MEMBER, keys[0].id, { auth: AUTH });
    expect(removed.status).toBe(403);
    expect(await textOf(removed)).toMatchObject({ error: 'not-admin' });
    expect((await list()).keys).toHaveLength(keys.length);
  });

  it('with the key, removes a key, but never the last; an unknown one is 404', async () => {
    const { keys, key_check } = await list();
    expect(keys.length).toBeGreaterThan(1);
    for (const key of keys.slice(1)) expect(await textOf(await remove(ADMIN, key.id, { auth: AUTH }))).toEqual({ removed: key.id });
    const last = await remove(ADMIN, keys[0].id, { auth: AUTH });
    expect(last.status).toBe(409);
    expect(await textOf(last)).toMatchObject({ error: 'last-key' });
    const unknown = await remove(ADMIN, '0'.repeat(32), { auth: AUTH });
    expect(unknown.status).toBe(404);
    expect(await textOf(unknown)).toMatchObject({ error: 'unknown-key' });
    // The check stays the org's: a key added again must wrap the same key.
    expect((await list()).key_check).toBe(key_check);
    expect((await post(ADMIN, wrappedKey({ label: 'again' }))).status).toBe(201);
  });
});
