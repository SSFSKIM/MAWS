// The org key's holder (§6; the DC5 plan's pre-flight, "The key before M2"). The key is a non-extractable WebCrypto
// HMAC key: the page can sign and verify with it but never read it, and it is never sent to the hub, logged, or put in
// the service worker. It is loaded from the device's IndexedDB when the owner chose to keep it there (M2 derives and
// stores it); with none stored the browser is locked, and the project view draws nothing from the log.
import type { OrgKey } from 'desk-hub/protocol';
import { committed, DESK_DB, done, openDesk } from '../store/idb';

export interface KeyStore {
  load(org: string): Promise<CryptoKey | null>;
  save(org: string, key: CryptoKey): Promise<void>;
  forget(org: string): Promise<void>;
}

/**
 * A stored CryptoKey as the protocol module's OrgKey. `desk-hub/protocol` makes an OrgKey only from raw bytes
 * (`importOrgKey`), and a key derived in the browser never exists as bytes, so the brand is applied here, after the
 * checks that make it the org key: HMAC with SHA-256, 256 bits, signing and verifying, and not extractable.
 */
export function asOrgKey(key: CryptoKey): OrgKey {
  const algorithm = key.algorithm as Partial<HmacKeyAlgorithm>;
  if (algorithm.name !== 'HMAC' || algorithm.hash?.name !== 'SHA-256') throw new TypeError('the org key is an HMAC-SHA-256 key');
  if (algorithm.length !== 256) throw new TypeError('the org key is 256 bits');
  if (!key.usages.includes('sign') || !key.usages.includes('verify')) throw new TypeError('the org key can sign and verify');
  if (key.extractable) throw new TypeError('the org key is never extractable');
  return { hmac: key } as OrgKey;
}

/** The org's key from the device's record, or null — locked — when none is stored or what is stored is not one. */
export async function loadOrgKey(store: KeyStore, org: string): Promise<OrgKey | null> {
  const key = await store.load(org);
  if (!key) return null;
  try {
    return asOrgKey(key);
  } catch {
    return null;
  }
}

export function idbKeyStore(): KeyStore {
  return {
    async load(org) {
      const db = await openDesk();
      const value: unknown = await done(db.transaction(DESK_DB.keys).objectStore(DESK_DB.keys).get(org));
      return value instanceof CryptoKey ? value : null;
    },
    async save(org, key) {
      const tx = (await openDesk()).transaction(DESK_DB.keys, 'readwrite');
      tx.objectStore(DESK_DB.keys).put(key, org);
      await committed(tx);
    },
    async forget(org) {
      const tx = (await openDesk()).transaction(DESK_DB.keys, 'readwrite');
      tx.objectStore(DESK_DB.keys).delete(org);
      await committed(tx);
    },
  };
}

export function memoryKeyStore(): KeyStore {
  const keys = new Map<string, CryptoKey>();
  return {
    load: async (org) => keys.get(org) ?? null,
    save: async (org, key) => void keys.set(org, key),
    forget: async (org) => void keys.delete(org),
  };
}
