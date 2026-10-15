// The tab's key state: `loading` until the device's record is read, then `unlocked` with the org key or `locked`
// without one. The owner unlocks with the passkey or the passphrase (./unlock.ts) and chooses how long the key is kept:
// this tab's life (`session`, memory only) or the device's IndexedDB (`device`, still non-extractable). Locking forgets
// it from both.
import { create } from 'zustand';
import type { OrgKey } from 'desk-hub/protocol';
import { holdKeyBytes, keyFingerprint } from './derive';
import { idbKeyStore, loadOrgKey, type KeyStore } from './org-key';

export type Keep = 'session' | 'device';

export type KeyHolder = {
  state: 'loading' | 'locked' | 'unlocked';
  key: OrgKey | null;
  /** Where the key is kept while unlocked. */
  kept: Keep | null;
  /** The key's short check (`keyFingerprint`), for the owner to compare across browsers. */
  fingerprint: string | null;
};

const LOCKED = { state: 'locked', key: null, kept: null, fingerprint: null } as const;

export const useKeyHolder = create<KeyHolder>()(() => ({ state: 'loading', key: null, kept: null, fingerprint: null }));

export async function loadDeviceKey(org: string, store: KeyStore = idbKeyStore()): Promise<void> {
  let key: OrgKey | null = null;
  try {
    key = await loadOrgKey(store, org);
  } catch (error) {
    console.error('desk: reading the device key', error);
  }
  useKeyHolder.setState(key ? { state: 'unlocked', key, kept: 'device', fingerprint: await keyFingerprint(key) } : LOCKED);
}

/** Holds freshly derived bytes as the org key (wiping them), kept where the owner chose. */
export async function unlock(org: string, raw: Uint8Array, keep: Keep, store: KeyStore = idbKeyStore()): Promise<void> {
  const key = await holdKeyBytes(raw);
  if (keep === 'device') await store.save(org, key.hmac);
  else await store.forget(org);
  useKeyHolder.setState({ state: 'unlocked', key, kept: keep, fingerprint: await keyFingerprint(key) });
}

export async function lock(org: string, store: KeyStore = idbKeyStore()): Promise<void> {
  useKeyHolder.setState(LOCKED);
  await store.forget(org);
}
