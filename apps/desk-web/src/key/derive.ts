// The wrapping keys' derivations (§6; the DC5 plan's M2, and its M2b ruling: one random org key, wrapped once per
// unlock method). The org key is drawn at random in the browser; each unlock method derives a wrapping key that locks
// one copy of it (./wrap.ts), from the passkey's PRF output or from a passphrase. What goes in is fixed here — a change
// opens no existing copy — and pinned with OpenSSL-computed values in derive.test.ts. Each copy carries its derivation
// in its `kdf` (DX7), so a passphrase's cost can rise later and older copies still open.
import { base64urlDecode, importOrgKey, keyCheck, type JsonObject, type OrgKey } from 'desk-hub/protocol';
import { heldOrgKey } from './org-key';

/** Names the wrapping-key derivation everywhere it is an input: the PRF's input, HKDF's info, the passphrase's salt
 * (and the additional data every copy is sealed with, ./wrap.ts). */
export const WRAP_LABEL = 'smns-desk-wrap-v1';
const utf8 = (text: string) => new TextEncoder().encode(text);

/** What the passkey's PRF is evaluated at (WebAuthn's `prf.eval.first`; the browser hashes it into the salt). */
export const PRF_INPUT = utf8(WRAP_LABEL);

/** A passkey copy's `kdf`: PRF at the label, then HKDF-SHA-256 salted with the org id, the label as info. */
export function passkeyKdf(org: string): JsonObject {
  return { name: 'webauthn-prf+hkdf-sha256', prf: WRAP_LABEL, salt: org, info: WRAP_LABEL };
}

/** Whether a passkey copy's `kdf` is the derivation this version runs (it has no parameter to vary). */
export function readPasskeyKdf(kdf: JsonObject, org: string): boolean {
  const expected = passkeyKdf(org);
  const keys = Object.keys(kdf);
  return keys.length === Object.keys(expected).length && keys.every((k) => kdf[k] === expected[k]);
}

/**
 * The passphrase's derivation: Argon2id, RFC 9106's recommendation for 64 MiB (t 3, p 4). The hub holds the wrapped
 * copies, so it can test guesses offline at whatever this costs per guess; the passphrase's own strength and this cost
 * are all that stand against it. The salt is the label, a line feed, and the org id (Argon2 needs 8 bytes, which an org
 * id alone need not have).
 */
export type PassphraseCost = { t: number; m: number; p: number };
export const PASSPHRASE_COST: PassphraseCost = { t: 3, m: 65536, p: 4 };
export const PASSPHRASE_MIN_CHARACTERS = 12;
/** The most a copy's `kdf` may ask of this browser: a phone runs it too, and a larger cost is a hub's denial of service. */
const MOST: PassphraseCost = { t: 10, m: 262144, p: 16 };

const passphraseSalt = (org: string) => `${WRAP_LABEL}\n${org}`;

export function passphraseKdf(org: string, cost: PassphraseCost): JsonObject {
  return { name: 'argon2id', version: 0x13, ...cost, salt: passphraseSalt(org), normalize: 'NFC' };
}

/** The cost a passphrase copy's `kdf` names, or null when it is not a derivation this version runs, or asks too much. */
export function passphraseCost(kdf: JsonObject, org: string): PassphraseCost | null {
  const { name, version, t, m, p, salt, normalize } = kdf;
  if (name !== 'argon2id' || version !== 0x13 || salt !== passphraseSalt(org) || normalize !== 'NFC') return null;
  const whole = (n: unknown, least: number, most: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= least && n <= most;
  if (!whole(t, 1, MOST.t) || !whole(p, 1, MOST.p) || !whole(m, 8 * p, MOST.m)) return null;
  return { t, m, p };
}

/** A wrapping key's bytes from the passkey's PRF output: HKDF-SHA-256, salted with the org id, the label as its info. */
export async function wrappingKeyFromPrf(prfOutput: ArrayBuffer | Uint8Array, org: string): Promise<Uint8Array<ArrayBuffer>> {
  const ikm = prfOutput instanceof Uint8Array ? Uint8Array.from(prfOutput) : new Uint8Array(prfOutput.slice(0));
  if (ikm.length !== 32) throw new TypeError('the PRF output is 32 bytes');
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  ikm.fill(0);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: utf8(org), info: PRF_INPUT }, base, 256));
}

/** The passphrase as the derivation reads it: Unicode NFC, UTF-8, so one typed on another keyboard is the same input. */
export function passphraseInput(passphrase: string): Uint8Array {
  return utf8(passphrase.normalize('NFC'));
}

/** Why a passphrase cannot lock the org key, or null when it can. */
export function passphraseProblem(passphrase: string): string | null {
  const characters = [...passphrase.normalize('NFC')].length;
  return characters < PASSPHRASE_MIN_CHARACTERS ? `A passphrase has at least ${PASSPHRASE_MIN_CHARACTERS} characters.` : null;
}

let lastPassphraseWork: { ms: number; cost: PassphraseCost } | null = null;
const passphraseWorkListeners = new Set<() => void>();

/** How long this tab's last passphrase derivation took, and at what cost: what a phone pays per unlock (the M4 walk). */
export const passphraseWork = () => lastPassphraseWork;

/** Calls `listener` each time a derivation records its work, until the returned function is called: a view that shows
 * the work subscribes (`useSyncExternalStore`), since it changes outside React and a compiled render keeps its read. */
export function subscribePassphraseWork(listener: () => void): () => void {
  passphraseWorkListeners.add(listener);
  return () => passphraseWorkListeners.delete(listener);
}

/** A wrapping key's bytes from a passphrase (seconds of work, reported through `progress` from 0 to 1). */
export async function wrappingKeyFromPassphrase(passphrase: string, org: string, cost: PassphraseCost, progress?: (fraction: number) => void): Promise<Uint8Array> {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new TypeError(problem);
  const password = passphraseInput(passphrase);
  try {
    // Loaded when a passphrase is first used, so the app's first load (the phone's included) does not carry it.
    const { argon2idAsync } = await import('@noble/hashes/argon2');
    const started = performance.now();
    const bytes = await argon2idAsync(password, utf8(passphraseSalt(org)), { ...cost, dkLen: 32, version: 0x13, onProgress: progress });
    lastPassphraseWork = { ms: Math.round(performance.now() - started), cost };
    for (const listener of passphraseWorkListeners) listener();
    return bytes;
  } finally {
    password.fill(0);
  }
}

/** Holds the org key's bytes — non-extractable, so the page can sign and verify but never read it — and wipes them. */
export async function holdKeyBytes(raw: Uint8Array): Promise<OrgKey> {
  try {
    return heldOrgKey((await importOrgKey(raw)).hmac);
  } finally {
    raw.fill(0);
  }
}

/** Whether bytes opened again are the key this browser holds (compared by their checks, as the held key cannot be
 * read). The bytes are left as they were. */
export async function isSameKey(held: OrgKey, raw: Uint8Array): Promise<boolean> {
  const [a, b] = await Promise.all([keyCheck(held), keyCheck(await importOrgKey(raw))]);
  return a === b;
}

/** A key's short check, for the owner to compare across browsers: the first 6 bytes of its `check` (DX7),
 * `xxxx-xxxx-xxxx`. It reveals nothing a code made with the key does not already. */
export function checkFingerprint(check: string): string {
  const hex = Array.from(base64urlDecode(check).slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export async function keyFingerprint(key: OrgKey): Promise<string> {
  return checkFingerprint(await keyCheck(key));
}
