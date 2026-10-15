// The org key's holder (the DC5 plan's pre-flight, "The key before M2"): a stored key is admitted only as a
// non-extractable HMAC-SHA-256 key of 256 bits that can sign and verify, and then verifies DX1's vectors.
import { describe, expect, it } from 'vitest';
import { verify } from 'desk-hub/protocol';
import { LOG_VECTORS, VECTOR_KEY } from '../../test/vectors';
import { heldOrgKey, loadOrgKey, memoryKeyStore } from './org-key';

const hmac = (extractable: boolean, hash = 'SHA-256', usages: KeyUsage[] = ['sign', 'verify'], raw: Uint8Array = VECTOR_KEY) =>
  crypto.subtle.importKey('raw', Uint8Array.from(raw), { name: 'HMAC', hash }, extractable, usages);

describe('heldOrgKey', () => {
  it('admits a non-extractable HMAC-SHA-256 key, which verifies the vectors', async () => {
    const key = heldOrgKey(await hmac(false));
    for (const v of LOG_VECTORS) expect(await verify(key, 'log', v.project, v.event), v.name).toBe(true);
  });

  it('refuses a key that could leave the browser', async () => {
    await expect(hmac(true).then(heldOrgKey)).rejects.toThrow(/extractable/);
  });

  it('refuses another algorithm, another hash, a short key, or a key that cannot sign and verify', async () => {
    await expect(hmac(false, 'SHA-1').then(heldOrgKey)).rejects.toThrow(/HMAC-SHA-256/);
    await expect(hmac(false, 'SHA-256', ['verify']).then(heldOrgKey)).rejects.toThrow(/signs and verifies/);
    await expect(hmac(false, 'SHA-256', ['sign', 'verify'], VECTOR_KEY.slice(0, 16)).then(heldOrgKey)).rejects.toThrow(/256 bits/);
    const aes = await crypto.subtle.importKey('raw', Uint8Array.from(VECTOR_KEY), { name: 'AES-GCM' }, false, ['encrypt']);
    expect(() => heldOrgKey(aes)).toThrow(/HMAC-SHA-256/);
  });
});

describe('loadOrgKey', () => {
  it('is locked when the browser holds no key for the org', async () => {
    expect(await loadOrgKey(memoryKeyStore(), 'org')).toBeNull();
  });

  it('loads the key the browser stored for the org, and only for it', async () => {
    const store = memoryKeyStore();
    await store.save('org', await hmac(false));
    expect(await loadOrgKey(store, 'org')).not.toBeNull();
    expect(await loadOrgKey(store, 'other')).toBeNull();
  });

  it('stays locked when what is stored is not an org key', async () => {
    const store = memoryKeyStore();
    await store.save('org', await hmac(true));
    expect(await loadOrgKey(store, 'org')).toBeNull();
  });
});
