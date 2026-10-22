// The tab's key state: `loading` until the device's record is read, then `unlocked` with the org key or `locked`
// without one. The owner unlocks with one of the org key's methods, or sets the key up (./unlock.ts), and chooses how
// long the key is kept:
// this tab's life (`session`, memory only) or the device's IndexedDB (`device`, still non-extractable). Locking forgets
// it from both.
//
// The newest operation wins, in memory and on the device alike. Every unlock and every Lock takes a fresh token from one
// counter when it begins (an unlock before its derivation, which takes seconds). An operation publishes to memory only
// if its token is still the newest when it finishes; a restore of the device's key, which writes nothing, publishes only
// if no operation began while it read. Every write of the device key runs on one serial chain, and a step whose token
// was superseded by the time it runs is skipped — except a Lock's own deletion, which always runs — so the last write to
// run is the newest writing operation's. An unlock's step that was superseded while it wrote puts back what the device
// kept before it, so a newer operation that never finishes (a cancelled prompt) leaves the device as the tab shows it.
// The chain's order is the order IndexedDB applies them in.
import { create } from 'zustand';
import type { OrgKey } from 'desk-hub/protocol';
import { latency } from '../latency/latency';
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

/** The newest operation's token. */
let op = 0;
/** Every device-key write, one after the other. */
let writes: Promise<unknown> = Promise.resolve();
/** The device's key has been timed from the navigation's start (`latency/latency.ts`'s cold load: the key's gate). */
let keyTimed = false;

/** Runs `write` after every write asked for before it; it settles as `write` does, and never holds the chain up. */
function serially(write: () => Promise<void>): Promise<void> {
  const run = writes.then(write);
  writes = run.catch(() => {});
  return run;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function loadDeviceKey(org: string, store: KeyStore = idbKeyStore()): Promise<void> {
  const began = op;
  let key: OrgKey | null = null;
  try {
    key = await loadOrgKey(store, org);
  } catch (error) {
    console.error('desk: reading the device key', error);
  }
  const fingerprint = key ? await keyFingerprint(key) : null;
  if (began !== op) return; // an unlock or a Lock began meanwhile: it decides
  useKeyHolder.setState(key ? { state: 'unlocked', key, kept: 'device', fingerprint } : { state: 'locked', key: null, kept: null, fingerprint: null });
  // Nothing of a project is drawn before the key is held: on a cold load this is the gate (0 is the navigation's start).
  if (key && !keyTimed) latency.drawn('app.key', 0);
  keyTimed ||= key !== null;
}

/** Whether `key` is still the one this tab holds: false once a Lock (or another unlock) replaced it. */
export function stillHolds(key: OrgKey): boolean {
  return useKeyHolder.getState().key === key;
}

export type UnlockAttempt = {
  /** Whether this unlock is still the newest operation: false once a Lock or another unlock began after it. */
  current(): boolean;
  /** Holds the org key — opened from its copy, or bytes just drawn (wiped once held) — kept where the owner chose. False
   * when a newer unlock or a Lock began after this one: nothing of it is published, and its write, if not yet run, is
   * skipped. */
  finish(opened: OrgKey | Uint8Array, keep: Keep): Promise<boolean>;
};

/** Begins an unlock now, before the method's prompt and derivation, so whatever begins after it — a Lock, another
 * unlock — wins over it. */
export function beginUnlock(org: string, store: KeyStore = idbKeyStore()): UnlockAttempt {
  const token = ++op;
  const newest = () => token === op;
  return {
    current: newest,
    async finish(opened, keep) {
      if (!newest()) {
        if (opened instanceof Uint8Array) opened.fill(0);
        return false;
      }
      const key = opened instanceof Uint8Array ? await holdKeyBytes(opened) : opened;
      const fingerprint = await keyFingerprint(key);
      if (!newest()) return false;
      let published = false;
      await serially(async () => {
        if (!newest()) return;
        // What the device kept before this write, so the write can be undone should this unlock no longer be the newest
        // operation once it lands. Without it nothing is written: a read that fails rejects the unlock, as a failed
        // write does, and the device keeps what it kept.
        const before = await store.load(org);
        if (!newest()) return;
        if (keep === 'device') await store.save(org, key.hmac);
        else await store.forget(org);
        if (!newest()) {
          // Superseded while it wrote, by an operation that may never finish (an unlock whose prompt was cancelled): the
          // device goes back to what it kept, which is what the tab still shows. A newer write, if one comes, runs after.
          // When that fails the device holds a key the tab does not show, and a reload would load it: that stands
          // reported (`forgetError`), whoever is newest, until a later write leaves nothing stale.
          try {
            if (before) await store.save(org, before);
            else await store.forget(org);
          } catch (error) {
            useKeyHolder.setState({ forgetError: reason(error) });
          }
          return;
        }
        storedNothingStale(); // the stored key is now the one held, or none
        // Published in the same step as the write it stands on, with nothing awaited between: no operation begins between
        // the two.
        useKeyHolder.setState({ state: 'unlocked', key, kept: keep, fingerprint });
        published = true;
      });
      return published;
    },
  };
}

export async function unlock(org: string, raw: Uint8Array, keep: Keep, store: KeyStore = idbKeyStore()): Promise<boolean> {
  return beginUnlock(org, store).finish(raw, keep);
}

/**
 * Locks: the tab drops the key at once, before anything is awaited; every unlock or restore under way is superseded;
 * and the device forgets the key it kept, after every write asked for before. When it cannot, `forgetError` says so,
 * whatever began meanwhile, until a later write leaves nothing stale stored. Never rejects.
 */
export async function lock(org: string, store: KeyStore = idbKeyStore()): Promise<void> {
  ++op;
  useKeyHolder.setState({ state: 'locked', key: null, kept: null, fingerprint: null });
  await serially(async () => {
    // Always runs, superseded or not.
    try {
      await store.forget(org);
      storedNothingStale();
    } catch (error) {
      useKeyHolder.setState({ forgetError: reason(error) });
    }
  });
}

/** `forgetError` follows what storage did, on the chain, never which operation is newest: a failed Lock deletion sets
 * it, and only a later write that succeeds — a deletion, or a device save replacing the key — clears it. */
function storedNothingStale(): void {
  useKeyHolder.setState({ forgetError: null });
}
