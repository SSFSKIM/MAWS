// The org key's derivations (§6; the DC5 plan's M2). The key is a 256-bit secret no server holds: every browser holding
// the owner's passkey derives it from the passkey's PRF output, and a browser without PRF derives it from a passphrase.
// What goes in is fixed here for good — a change gives every org another key, and every enrolled machine holds the old
// one — and recorded in the plan's Decision Log with OpenSSL-computed values (derive.test.ts).
//
// The two paths give two different keys: an org keys itself one way, and every browser follows that way.
import { argon2idAsync } from '@noble/hashes/argon2';
import { importOrgKey, type OrgKey } from 'desk-hub/protocol';
import { heldOrgKey } from './org-key';

/** Names this derivation everywhere it is an input: the PRF's input, HKDF's info, and the passphrase's salt. */
export const ORG_KEY_LABEL = 'smns-desk-org-key-v1';
const utf8 = (text: string) => new TextEncoder().encode(text);

/** What the passkey's PRF is evaluated at (WebAuthn's `prf.eval.first`; the browser hashes it into the salt). */
export const PRF_INPUT = utf8(ORG_KEY_LABEL);

/**
 * The passphrase's derivation: Argon2id, RFC 9106's recommendation for 64 MiB (t 3, p 4). The hub holds codes made
 * with the key, so it can test guesses offline at whatever this costs per guess; the passphrase's own strength and
 * this cost are all that stand against it. The salt is the label, a line feed, and the org id (Argon2 needs 8 bytes,
 * which an org id alone need not have).
 */
export const PASSPHRASE_KDF = { algorithm: 'argon2id', version: 0x13, t: 3, m: 65536, p: 4, dkLen: 32, salt: `${ORG_KEY_LABEL}\n<org id>` } as const;
export const PASSPHRASE_MIN_CHARACTERS = 12;

/** The org key's bytes from the passkey's PRF output: HKDF-SHA-256, salted with the org id, the label as its info. */
export async function orgKeyFromPrf(prfOutput: ArrayBuffer | Uint8Array, org: string): Promise<Uint8Array<ArrayBuffer>> {
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

/** Why a passphrase cannot key an org, or null when it can. */
export function passphraseProblem(passphrase: string): string | null {
  const characters = [...passphrase.normalize('NFC')].length;
  return characters < PASSPHRASE_MIN_CHARACTERS ? `A passphrase has at least ${PASSPHRASE_MIN_CHARACTERS} characters.` : null;
}

/** The org key's bytes from a passphrase (a few seconds of work, reported through `progress` from 0 to 1). */
export async function orgKeyFromPassphrase(passphrase: string, org: string, progress?: (fraction: number) => void): Promise<Uint8Array> {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new TypeError(problem);
  const { t, m, p, dkLen, version } = PASSPHRASE_KDF;
  const password = passphraseInput(passphrase);
  try {
    return await argon2idAsync(password, utf8(`${ORG_KEY_LABEL}\n${org}`), { t, m, p, dkLen, version, onProgress: progress });
  } finally {
    password.fill(0);
  }
}

/** Holds derived bytes as the org key — non-extractable, so the page can sign and verify but never read it — and wipes
 * the bytes. */
export async function holdKeyBytes(raw: Uint8Array): Promise<OrgKey> {
  try {
    return heldOrgKey((await importOrgKey(raw)).hmac);
  } finally {
    raw.fill(0);
  }
}

const CHECK = utf8('smns-desk-key-check-v1');

async function check(hmac: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', hmac, CHECK));
}

/** Whether bytes derived again are the key this browser holds (compared by what each signs, as the held key cannot be
 * read). The bytes are left as they were. */
export async function isSameKey(held: OrgKey, raw: Uint8Array): Promise<boolean> {
  const again = await importOrgKey(raw);
  const [a, b] = await Promise.all([check(held.hmac), check(again.hmac)]);
  return a.every((byte, i) => byte === b[i]);
}

/** A short check of which key a browser holds, for the owner to compare across browsers: `xxxx-xxxx-xxxx`. It reveals
 * nothing a code made with the key does not already. */
export async function keyFingerprint(key: OrgKey): Promise<string> {
  const hex = Array.from((await check(key.hmac)).slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}
