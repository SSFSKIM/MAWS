// One wrapped copy of the org key (DX7's "Wrapped keys"): the key's 32 bytes under AES-256-GCM with a fresh 12-byte iv,
// keyed by the wrapping key one unlock method derives (./derive.ts), with the copy's method bound in as additional data
// — `smns-desk-wrap-v1` LF org id LF method LF credential (empty for a passphrase) — so a copy moved to another org,
// method, or passkey does not open. Unlocking unwraps straight into a non-extractable HMAC key; only locking another
// copy and building an enrollment code open the bytes, and their caller wipes them.
import { base64urlDecode, base64urlEncode, type OrgKey } from 'desk-hub/protocol';
import { WRAP_LABEL } from './derive';
import { heldOrgKey } from './org-key';

export type WrapMethod = { method: 'passkey' | 'passphrase'; credential: string | null };
export type WrappedCopy = WrapMethod & { iv: string; wrapped: string };

/** A wrapping key that does not open this copy: a wrong passphrase, or another passkey (the GCM tag fails). */
export class WrongSecret extends Error {
  constructor() {
    super('That does not open the org key.');
  }
}

export function wrapAad(org: string, { method, credential }: WrapMethod): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${WRAP_LABEL}\n${org}\n${method}\n${credential ?? ''}`);
}

/** Holds a derived wrapping key's bytes as a non-extractable AES-256-GCM key, and wipes them. */
export async function importWrappingKey(bytes: Uint8Array): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('raw', Uint8Array.from(bytes), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt', 'unwrapKey']);
  } finally {
    bytes.fill(0);
  }
}

/** Locks the org key's bytes under `wrapping`, with a fresh iv. The bytes are left as they were. */
export async function wrapOrgKey(raw: Uint8Array, wrapping: CryptoKey, org: string, method: WrapMethod): Promise<{ iv: string; wrapped: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = Uint8Array.from(raw);
  try {
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: wrapAad(org, method) }, wrapping, plain));
    return { iv: base64urlEncode(iv), wrapped: base64urlEncode(sealed) };
  } finally {
    plain.fill(0);
  }
}

const gcm = (copy: WrappedCopy, org: string): AesGcmParams => ({ name: 'AES-GCM', iv: Uint8Array.from(base64urlDecode(copy.iv)), additionalData: wrapAad(org, copy) });
const sealed = (copy: WrappedCopy) => Uint8Array.from(base64urlDecode(copy.wrapped));

/** A failed tag is a wrong secret; anything else is a fault of its own. (By name: WebCrypto's DOMException need not be
 * the page's global one.) */
function opening(error: unknown): never {
  if (error instanceof Error && error.name === 'OperationError') throw new WrongSecret();
  throw error;
}

/** Opens a copy straight into the org key the browser holds: non-extractable HMAC-SHA-256, never bytes the page reads. */
export async function unwrapHeldKey(copy: WrappedCopy, wrapping: CryptoKey, org: string): Promise<OrgKey> {
  const hmac = await crypto.subtle
    .unwrapKey('raw', sealed(copy), wrapping, gcm(copy, org), { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify'])
    .catch(opening);
  return heldOrgKey(hmac);
}

/** Opens a copy as the key's bytes, for locking another copy or building an enrollment code; the caller wipes them. */
export async function unwrapKeyBytes(copy: WrappedCopy, wrapping: CryptoKey, org: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt(gcm(copy, org), wrapping, sealed(copy)).catch(opening));
}
