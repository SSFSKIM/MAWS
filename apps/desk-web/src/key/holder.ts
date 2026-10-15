// The tab's key state: `loading` until the device's record is read, then `unlocked` with the org key or `locked`
// without one. M2 adds the ways to unlock (the passkey's PRF, a passphrase); M1 only loads a key the device kept.
import { create } from 'zustand';
import type { OrgKey } from 'desk-hub/protocol';
import { idbKeyStore, loadOrgKey, type KeyStore } from './org-key';

export type KeyHolder = { state: 'loading' | 'locked' | 'unlocked'; key: OrgKey | null };

export const useKeyHolder = create<KeyHolder>()(() => ({ state: 'loading', key: null }));

export async function loadDeviceKey(org: string, store: KeyStore = idbKeyStore()): Promise<void> {
  let key: OrgKey | null = null;
  try {
    key = await loadOrgKey(store, org);
  } catch (error) {
    console.error('desk: reading the device key', error);
  }
  useKeyHolder.setState({ state: key ? 'unlocked' : 'locked', key });
}
