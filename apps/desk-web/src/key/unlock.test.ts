// The org key's methods (DX7's wrapped keys; the DC5 plan's M2b): first setup draws the key at random and locks one
// copy; unlocking opens a copy straight into the held key and refuses one that is not the org's; adding a method and
// building an enrollment code open the bytes once; every change carries the key's proof. Against the double's
// `/api/org/keys` through a stubbed fetch, on the passphrase path (the passkey's is the browser suites'), at a cheap
// Argon2id cost so each derivation takes milliseconds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyCheck } from 'desk-hub/protocol';
import { ME } from '../../test/me';
import { OrgKeysDouble } from '../../test/double/org-keys';
import { HubRequestError } from '../hub/http';
import { holdKeyBytes, keyFingerprint, passphraseKdf, PASSPHRASE_COST } from './derive';
import { addMethod, KeyMethodError, openOrgKeyBytes, prepareMethod, removeMethod, setUpOrgKey, unlockOrgKey } from './unlock';
import { listWrappedKeys } from './wrapped-keys';

vi.mock('./derive', async (original) => ({ ...(await original<typeof import('./derive')>()), PASSPHRASE_COST: { t: 1, m: 64, p: 1 } }));

const ORG = 'local';
const FIRST = 'correct horse battery staple';
const SECOND = 'tr0ub4dor and three more words';
let hub: OrgKeysDouble;

beforeEach(() => {
  hub = new OrgKeysDouble();
  vi.stubGlobal('fetch', hub.fetch(ME.member));
});
afterEach(() => vi.unstubAllGlobals());

const passphrase = (text: string) => ({ kind: 'passphrase', passphrase: text }) as const;
const setUp = async () => setUpOrgKey(ORG, await prepareMethod(ORG, passphrase(FIRST)), 'first', () => true);
const current = () => true;
const rejection = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

describe('setUpOrgKey', () => {
  it("draws a random key, locks one copy with the method, and sets the org's check", async () => {
    const held = await setUp();
    expect(held.hmac.extractable).toBe(false);
    const { key_check, keys } = await listWrappedKeys();
    expect(key_check).toBe(await keyCheck(held));
    expect(keys).toMatchObject([{ method: 'passphrase', label: 'first', credential: null, check: key_check, kdf: passphraseKdf(ORG, PASSPHRASE_COST) }]);
  });

  it('posts nothing when the setup was superseded (a Lock) before its copy went out', async () => {
    const error = await rejection(setUpOrgKey(ORG, await prepareMethod(ORG, passphrase(FIRST)), 'first', () => false));
    expect(error).toMatchObject({ reason: 'locked' });
    expect(await listWrappedKeys()).toEqual({ key_check: null, keys: [] });
  });

  it('draws another key each time: two orgs set up alike share nothing', async () => {
    const a = await setUp();
    hub = new OrgKeysDouble();
    vi.stubGlobal('fetch', hub.fetch(ME.member));
    expect(await keyFingerprint(await setUp())).not.toBe(await keyFingerprint(a));
  });

  it('is refused not-key-holder when the org already has a key — set up elsewhere first', async () => {
    await setUp();
    const error = await rejection(setUp());
    expect(error).toBeInstanceOf(HubRequestError);
    expect(error).toMatchObject({ status: 403, code: 'not-key-holder' });
    expect((await listWrappedKeys()).keys).toHaveLength(1);
  });
});

describe('unlockOrgKey', () => {
  it("opens the org's key from its copy, the same key first setup held", async () => {
    const held = await setUp();
    const opened = await unlockOrgKey(ORG, await listWrappedKeys(), passphrase(FIRST));
    expect(opened.hmac.extractable).toBe(false);
    expect(await keyCheck(opened)).toBe(await keyCheck(held));
  });

  it('says a wrong passphrase is wrong', async () => {
    await setUp();
    const error = await rejection(unlockOrgKey(ORG, await listWrappedKeys(), passphrase('correct horse battery stapel')));
    expect(error).toBeInstanceOf(KeyMethodError);
    expect(error).toMatchObject({ reason: 'wrong-secret', message: "That passphrase doesn't open the org key." });
  });

  it("refuses a key whose check is not the org's key_check", async () => {
    await setUp();
    const keys = await listWrappedKeys();
    const other = await keyCheck(await holdKeyBytes(crypto.getRandomValues(new Uint8Array(32))));
    expect(await rejection(unlockOrgKey(ORG, { ...keys, key_check: other }, passphrase(FIRST)))).toMatchObject({ reason: 'not-org-key' });
  });

  it('says the org has no key yet, and no passphrase copy when it has none', async () => {
    expect(await rejection(unlockOrgKey(ORG, { key_check: null, keys: [] }, passphrase(FIRST)))).toMatchObject({ reason: 'no-key' });
    await setUp();
    expect(await rejection(unlockOrgKey(ORG, await listWrappedKeys(), { kind: 'passkey' }))).toMatchObject({ reason: 'no-method' });
  });

  it("opens a copy at the cost its kdf names, and refuses one whose derivation this page doesn't run", async () => {
    const held = await setUp();
    const keys = await listWrappedKeys();
    const copy = keys.keys[0];
    const unknown = { ...keys, keys: [{ ...copy, kdf: { ...copy.kdf, name: 'scrypt' } }] };
    expect(await rejection(unlockOrgKey(ORG, unknown, passphrase(FIRST)))).toMatchObject({ reason: 'unknown-derivation' });
    expect(await keyCheck(await unlockOrgKey(ORG, keys, passphrase(FIRST)))).toBe(await keyCheck(held));
  });
});

describe('addMethod', () => {
  it("locks another copy of the held key, confirmed with a method the org has; either opens the same key", async () => {
    const held = await setUp();
    const record = await addMethod(ORG, await listWrappedKeys(), await prepareMethod(ORG, passphrase(SECOND)), 'second', passphrase(FIRST), held, current);
    expect(record).toMatchObject({ method: 'passphrase', label: 'second', check: await keyCheck(held) });
    const keys = await listWrappedKeys();
    expect(keys.keys).toHaveLength(2);
    expect(await keyCheck(await unlockOrgKey(ORG, keys, passphrase(SECOND)))).toBe(await keyCheck(held));
  });

  it('posts nothing once the held key was locked while the confirmation opened its bytes', async () => {
    const held = await setUp();
    let asked = 0;
    // a Lock pressed while the confirmation ran
    const locked = () => {
      asked++;
      return false;
    };
    const error = await rejection(addMethod(ORG, await listWrappedKeys(), await prepareMethod(ORG, passphrase(SECOND)), 'second', passphrase(FIRST), held, locked));
    expect(error).toMatchObject({ reason: 'locked' });
    expect(asked).toBeGreaterThan(0);
    expect((await listWrappedKeys()).keys).toHaveLength(1);
  });

  it("refuses, before posting, when this browser's key isn't the org's", async () => {
    await setUp();
    const other = await holdKeyBytes(crypto.getRandomValues(new Uint8Array(32)));
    const error = await rejection(addMethod(ORG, await listWrappedKeys(), await prepareMethod(ORG, passphrase(SECOND)), 'second', passphrase(FIRST), other, current));
    expect(error).toMatchObject({ reason: 'other-key-held' });
    expect((await listWrappedKeys()).keys).toHaveLength(1);
  });

  it('refuses a wrong confirmation', async () => {
    const held = await setUp();
    const error = await rejection(addMethod(ORG, await listWrappedKeys(), await prepareMethod(ORG, passphrase(SECOND)), 'second', passphrase(SECOND), held, current));
    expect(error).toMatchObject({ reason: 'wrong-secret' });
  });
});

describe('openOrgKeyBytes', () => {
  it("opens the held key's bytes once, for an enrollment code", async () => {
    const held = await setUp();
    const raw = await openOrgKeyBytes(ORG, await listWrappedKeys(), passphrase(FIRST), held);
    expect(raw).toHaveLength(32);
    expect(await keyCheck(await holdKeyBytes(raw))).toBe(await keyCheck(held));
  });
});

describe('removeMethod', () => {
  it("removes a copy with the held key's proof, never the last, and refuses a browser holding another key", async () => {
    const held = await setUp();
    await addMethod(ORG, await listWrappedKeys(), await prepareMethod(ORG, passphrase(SECOND)), 'second', passphrase(FIRST), held, current);
    const [first, second] = (await listWrappedKeys()).keys;

    const other = await holdKeyBytes(crypto.getRandomValues(new Uint8Array(32)));
    expect(await rejection(removeMethod(first.id, other))).toMatchObject({ status: 403, code: 'not-key-holder' });

    await removeMethod(first.id, held);
    expect((await listWrappedKeys()).keys.map((k) => k.id)).toEqual([second.id]);
    expect(await rejection(removeMethod(second.id, held))).toMatchObject({ status: 409, code: 'last-key' });
  });
});
