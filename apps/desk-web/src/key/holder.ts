// The tab's key state: `loading` until the device's record is read, then `unlocked` with the org key or `locked`
// without one. The owner unlocks with the passkey or the passphrase (./unlock.ts) and chooses how long the key is kept:
// this tab's life (`session`, memory only) or the device's IndexedDB (`device`, still non-extractable). Locking forgets
// it from both.
//
// A Lock wins over everything begun before it. Each unlock and each restore of the device's key belongs to the
// generation it began in, and a Lock starts a new one: an unlock whose derivation ends after the Lock — its form open or
// long gone — holds nothing and stores nothing, and a restore that read the key before the Lock publishes nothing.
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
  /** Why the device could not forget the key it kept, after a Lock; null when nothing stored is left behind. The tab no
   * longer holds the key either way, but a reload would load it, so this stands until a Lock forgets it. */
  forgetError: string | null;
};

export const useKeyHolder = create<KeyHolder>()(() => ({ state: 'loading', key: null, kept: null, fingerprint: null, forgetError: null }));

let generation = 0;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

// What the device should keep for each org: the key (device) or nothing (a Lock, a session unlock), as the newest of
// them asked. A write that settles after a newer one was asked for — an older unlock's save landing late, behind a Lock
// and a newer unlock — asks for the newest intent again, so storage ends where the newest Lock or unlock left it and a
// stale write can neither erase nor overwrite it. The real store (IndexedDB) applies writes in the order asked, where
// the repeat changes nothing; the repeat covers a store whose writes can land out of order.
type Intent = { key: CryptoKey | null };
const intents = new Map<string, Intent>();

const write = (store: KeyStore, org: string, key: CryptoKey | null) => (key ? store.save(org, key) : store.forget(org));

/** Asks the device to keep `key`, or nothing, as the newest intent; rejects when that write fails. */
async function persist(store: KeyStore, org: string, key: CryptoKey | null): Promise<void> {
  const mine: Intent = { key };
  intents.set(org, mine);
  await write(store, org, key);
  const latest = intents.get(org)!;
  if (latest === mine) return;
  try {
    await write(store, org, latest.key);
  } catch (error) {
    // A deletion that failed leaves a key behind that a reload would load: reported as a Lock's failure is.
    if (latest.key === null) useKeyHolder.setState({ forgetError: reason(error) });
    else console.error('desk: storing the device key again', error);
  }
}

export async function loadDeviceKey(org: string, store: KeyStore = idbKeyStore()): Promise<void> {
  const began = generation;
  let key: OrgKey | null = null;
  try {
    key = await loadOrgKey(store, org);
  } catch (error) {
    console.error('desk: reading the device key', error);
  }
  const fingerprint = key ? await keyFingerprint(key) : null;
  if (began !== generation) return; // locked meanwhile
  useKeyHolder.setState(key ? { state: 'unlocked', key, kept: 'device', fingerprint } : { state: 'locked', key: null, kept: null, fingerprint: null });
}

export type UnlockAttempt = {
  /** Holds freshly derived bytes as the org key (wiping them), kept where the owner chose. False when a Lock came
   * after the attempt began: the bytes are wiped and nothing is held or stored. */
  finish(raw: Uint8Array, keep: Keep): Promise<boolean>;
};

/** Begins an unlock now, before the derivation, so a Lock pressed while it derives wins over it. */
export function beginUnlock(org: string, store: KeyStore = idbKeyStore()): UnlockAttempt {
  const began = generation;
  const current = () => began === generation;
  return {
    async finish(raw, keep) {
      if (!current()) {
        raw.fill(0);
        return false;
      }
      const key = await holdKeyBytes(raw);
      if (!current()) return false;
      await persist(store, org, keep === 'device' ? key.hmac : null);
      if (!current()) return false;
      const fingerprint = await keyFingerprint(key);
      if (!current()) return false;
      useKeyHolder.setState({ state: 'unlocked', key, kept: keep, fingerprint, forgetError: null });
      return true;
    },
  };
}

export async function unlock(org: string, raw: Uint8Array, keep: Keep, store: KeyStore = idbKeyStore()): Promise<void> {
  await beginUnlock(org, store).finish(raw, keep);
}

/**
 * Locks: the tab drops the key at once, every unlock or restore under way is void, and the device forgets the key it
 * kept. When it cannot, `forgetError` says so until a later Lock (the retry) succeeds; never rejects.
 */
export async function lock(org: string, store: KeyStore = idbKeyStore()): Promise<void> {
  const mine = ++generation;
  useKeyHolder.setState({ state: 'locked', key: null, kept: null, fingerprint: null });
  try {
    await persist(store, org, null);
    if (mine === generation) useKeyHolder.setState({ forgetError: null });
  } catch (error) {
    if (mine === generation) useKeyHolder.setState({ forgetError: reason(error) });
  }
}
