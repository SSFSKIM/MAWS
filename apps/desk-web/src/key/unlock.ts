// Where the org key's bytes come from, on unlock and again at an enrollment (the held key cannot be read back: it is
// derived again, and the bytes go into the code). The passkey's PRF or the passphrase; which one this browser used last
// is remembered as a hint for the next prompt, never as a secret.
import type { OrgKey } from 'desk-hub/protocol';
import { isSameKey, orgKeyFromPassphrase, orgKeyFromPrf } from './derive';
import { createPasskey, passkeyPrf } from './passkey';

export type KeyMethod = 'passkey' | 'passphrase';
export type KeySource =
  | { kind: 'passkey' }
  | { kind: 'new-passkey'; orgName: string; email: string }
  | { kind: 'passphrase'; passphrase: string; progress?: (fraction: number) => void };

export async function deriveOrgKey(org: string, source: KeySource): Promise<Uint8Array> {
  switch (source.kind) {
    case 'passkey':
      return orgKeyFromPrf(await passkeyPrf(), org);
    case 'new-passkey':
      return orgKeyFromPrf(await createPasskey(source), org);
    case 'passphrase':
      return orgKeyFromPassphrase(source.passphrase, org, source.progress);
  }
}

export class KeyMismatch extends Error {
  constructor() {
    super('That derives another key than the one this browser holds.');
  }
}

/** The held key's bytes, derived again from `source`; throws `KeyMismatch` (the bytes wiped) when they are another
 * key's — a mistyped passphrase, another passkey — so no machine is enrolled with a key the org does not use. */
export async function deriveHeldKey(org: string, source: KeySource, held: OrgKey): Promise<Uint8Array> {
  const raw = await deriveOrgKey(org, source);
  if (await isSameKey(held, raw)) return raw;
  raw.fill(0);
  throw new KeyMismatch();
}

const methodKey = (org: string) => `desk.key-method.${org}`;

export function rememberedMethod(org: string): KeyMethod | null {
  const value = localStorage.getItem(methodKey(org));
  return value === 'passkey' || value === 'passphrase' ? value : null;
}

export function rememberMethod(org: string, method: KeyMethod): void {
  localStorage.setItem(methodKey(org), method);
}
