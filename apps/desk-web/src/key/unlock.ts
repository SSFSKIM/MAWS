// The org key's unlock methods (§6, DX7's wrapped keys; the DC5 plan's M2b). The org key is 32 random bytes drawn in
// this browser at the org's first setup; the hub keeps one copy per method, each locked under a wrapping key the method
// derives (./derive.ts, ./wrap.ts). Unlocking opens a copy straight into the held key and refuses one whose check is
// not the org's. Adding a method, and building an enrollment code, open the bytes once more, use them, and wipe them.
// Every change at the hub carries `auth`, signed with the held key. Which method this browser used last is remembered as
// a hint for the next prompt, never as a secret.
import { keyAuth, keyCheck, type JsonObject, type OrgKey, type WrappedKeyRecord, type WrappedKeyRequest, type WrappedKeys } from 'desk-hub/protocol';
import { holdKeyBytes, isSameKey, PASSPHRASE_COST, passkeyKdf, passphraseCost, passphraseKdf, readPasskeyKdf, wrappingKeyFromPassphrase, wrappingKeyFromPrf } from './derive';
import { createPasskey, passkeyPrf } from './passkey';
import { importWrappingKey, unwrapHeldKey, unwrapKeyBytes, wrapOrgKey, WrongSecret, type WrapMethod } from './wrap';
import { addWrappedKey, removeWrappedKey } from './wrapped-keys';

export type KeyMethod = WrapMethod['method'];
type Progress = (fraction: number) => void;
/** A method to lock a new copy with: a passkey made now, or a new passphrase. */
export type NewMethod = { kind: 'passkey'; orgName: string; email: string } | { kind: 'passphrase'; passphrase: string; progress?: Progress };
/** A method the org has, to open a copy with: one of its passkeys, or its passphrase. */
export type OrgMethod = { kind: 'passkey' } | { kind: 'passphrase'; passphrase: string; progress?: Progress };

export type KeyMethodFailure = 'no-key' | 'no-method' | 'wrong-secret' | 'not-org-key' | 'other-key-held' | 'unknown-derivation' | 'locked';

export class KeyMethodError extends Error {
  constructor(
    readonly reason: KeyMethodFailure,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Whether the operation still stands — the key it acts for not locked, nor superseded — asked once the prompt and the
 * derivation are over, right before anything goes to the hub: a Lock wins over every change begun before it.
 */
export type StillWanted = () => boolean;

const lockedMeanwhile = () => new KeyMethodError('locked', 'The org key was locked meanwhile, so nothing was changed.');

/** A new method, its wrapping key derived and held (non-extractable) until a copy is locked under it. */
export type PreparedMethod = WrapMethod & { kdf: JsonObject; wrapping: CryptoKey };

export async function prepareMethod(org: string, method: NewMethod): Promise<PreparedMethod> {
  if (method.kind === 'passkey') {
    const { prf, credential } = await createPasskey(method);
    return { method: 'passkey', credential, kdf: passkeyKdf(org), wrapping: await importWrappingKey(await wrappingKeyFromPrf(prf, org)) };
  }
  const bytes = await wrappingKeyFromPassphrase(method.passphrase, org, PASSPHRASE_COST, method.progress);
  return { method: 'passphrase', credential: null, kdf: passphraseKdf(org, PASSPHRASE_COST), wrapping: await importWrappingKey(bytes) };
}

/** The request that adds a copy of `raw` locked under `method`, proved with `held` (the same key). */
async function copyRequest(org: string, method: PreparedMethod, label: string, raw: Uint8Array, held: OrgKey): Promise<WrappedKeyRequest> {
  const { iv, wrapped } = await wrapOrgKey(raw, method.wrapping, org, method);
  const [check, auth] = await Promise.all([keyCheck(held), keyAuth(held)]);
  return { method: method.method, label, ...(method.credential === null ? {} : { credential: method.credential }), kdf: method.kdf, iv, wrapped, check, auth };
}

/**
 * The org's first setup: draws the org key at random, locks its first copy under `method`, and returns it held. The hub
 * refuses it `not-key-holder` when the org already has a key (set up elsewhere, perhaps a moment before). Nothing is
 * posted once `stillWanted` says the setup was superseded.
 */
export async function setUpOrgKey(org: string, method: PreparedMethod, label: string, stillWanted: StillWanted): Promise<OrgKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  try {
    const held = await holdKeyBytes(Uint8Array.from(raw));
    const request = await copyRequest(org, method, label, raw, held);
    if (!stillWanted()) throw lockedMeanwhile();
    await addWrappedKey(request);
    return held;
  } finally {
    raw.fill(0);
  }
}

/** Opens one of the org's copies with `method`, through `open` (into the held key, or as bytes). */
async function openCopy<T>(org: string, keys: WrappedKeys, method: OrgMethod, open: (copy: WrappedKeyRecord, wrapping: CryptoKey) => Promise<T>): Promise<{ copy: WrappedKeyRecord; opened: T }> {
  if (keys.key_check === null) throw new KeyMethodError('no-key', 'The org has no key yet: set it up first.');
  const copies = keys.keys.filter((k) => k.method === method.kind);
  if (copies.length === 0) throw new KeyMethodError('no-method', `The org's key has no ${method.kind} copy.`);
  const unknown = () => new KeyMethodError('unknown-derivation', `The org's ${method.kind} copy was made by a newer desk than this page. Reload the page.`);
  const wrong = () => new KeyMethodError('wrong-secret', `That ${method.kind} doesn't open the org key.`);
  if (method.kind === 'passkey') {
    const { prf, credential } = await passkeyPrf(copies.map((k) => k.credential!));
    const copy = copies.find((k) => k.credential === credential);
    if (!copy) throw wrong();
    if (!readPasskeyKdf(copy.kdf, org)) throw unknown();
    try {
      return { copy, opened: await open(copy, await importWrappingKey(await wrappingKeyFromPrf(prf, org))) };
    } catch (error) {
      throw error instanceof WrongSecret ? wrong() : error;
    }
  }
  // Every passphrase copy is tried; copies made at one cost share a wrapping key, derived once.
  const derived = new Map<string, CryptoKey>();
  let readable = false;
  for (const copy of copies) {
    const cost = passphraseCost(copy.kdf, org);
    if (!cost) continue;
    readable = true;
    const at = JSON.stringify(cost);
    if (!derived.has(at)) derived.set(at, await importWrappingKey(await wrappingKeyFromPassphrase(method.passphrase, org, cost, method.progress)));
    try {
      return { copy, opened: await open(copy, derived.get(at)!) };
    } catch (error) {
      if (!(error instanceof WrongSecret)) throw error;
    }
  }
  throw readable ? wrong() : unknown();
}

const notOrgKey = () => new KeyMethodError('not-org-key', "The key that opened is not the org's key (its check differs from the org's), so it was refused.");

/** Unlocks: opens a copy straight into the held key, refused unless its check is the org's. */
export async function unlockOrgKey(org: string, keys: WrappedKeys, method: OrgMethod): Promise<OrgKey> {
  const { copy, opened } = await openCopy(org, keys, method, (c, wrapping) => unwrapHeldKey(c, wrapping, org));
  if (copy.check !== keys.key_check || (await keyCheck(opened)) !== keys.key_check) throw notOrgKey();
  return opened;
}

/**
 * The org key's bytes, opened once more for one use (a new copy, an enrollment code); the caller wipes them. Refused
 * when they are not the org's key, or not the key this browser holds.
 */
export async function openOrgKeyBytes(org: string, keys: WrappedKeys, method: OrgMethod, held: OrgKey): Promise<Uint8Array> {
  const { opened: raw } = await openCopy(org, keys, method, (c, wrapping) => unwrapKeyBytes(c, wrapping, org));
  try {
    if ((await keyCheck(await holdKeyBytes(Uint8Array.from(raw)))) !== keys.key_check) throw notOrgKey();
    if (!(await isSameKey(held, raw))) throw new KeyMethodError('other-key-held', "This browser holds another key than the org's. Lock it, and unlock with one of the org's methods.");
    return raw;
  } catch (error) {
    raw.fill(0);
    throw error;
  }
}

/** Adds a method: the bytes opened with `confirm` (a method the org has), locked under `method`, then wiped. Nothing is
 * posted once `stillWanted` says `held` was locked while the confirmation ran. */
export async function addMethod(org: string, keys: WrappedKeys, method: PreparedMethod, label: string, confirm: OrgMethod, held: OrgKey, stillWanted: StillWanted): Promise<WrappedKeyRecord> {
  const raw = await openOrgKeyBytes(org, keys, confirm, held);
  try {
    const request = await copyRequest(org, method, label, raw, held);
    if (!stillWanted()) throw lockedMeanwhile();
    return await addWrappedKey(request);
  } finally {
    raw.fill(0);
  }
}

/** Removes a method's copy, proved with the held key. The hub never removes the last. */
export async function removeMethod(id: string, held: OrgKey): Promise<void> {
  await removeWrappedKey(id, { auth: await keyAuth(held) });
}

const methodKey = (org: string) => `desk.key-method.${org}`;

export function rememberedMethod(org: string): KeyMethod | null {
  const value = localStorage.getItem(methodKey(org));
  return value === 'passkey' || value === 'passphrase' ? value : null;
}

export function rememberMethod(org: string, method: KeyMethod): void {
  localStorage.setItem(methodKey(org), method);
}
