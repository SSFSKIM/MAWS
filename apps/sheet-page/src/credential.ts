// The browser's pairing as the page stores it (T9, T19): `{ v: 1, id, credential }` under CREDENTIAL_KEY in
// `localStorage`, which is scoped to the page's origin, port included. Never a cookie, never in a URL. A stored entry
// that does not read is no pairing and is left where it is: a refusal, or anything a stranger on the port says, deletes
// nothing (T28); the person's own Unpair deletes every key under the page's prefix, and a new pairing replaces it.
export const STORAGE_PREFIX = 'maws.sheet.';
export const CREDENTIAL_KEY = `${STORAGE_PREFIX}credential`;

export interface StoredPairing {
  id: string; // the browser's id, 8 hex, which the live connection's hello names
  credential: string; // 32 bytes in base64url
}

const ID = /^[0-9a-f]{8}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;

export const isPairing = (value: unknown): value is StoredPairing => {
  const { id, credential } = (value ?? {}) as Partial<StoredPairing>;
  return typeof id === 'string' && ID.test(id) && typeof credential === 'string' && CREDENTIAL.test(credential);
};

export function readPairing(storage: Storage = localStorage): StoredPairing | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(CREDENTIAL_KEY) ?? 'null');
    if ((value as { v?: unknown } | null)?.v !== 1 || !isPairing(value)) return null;
    return { id: value.id, credential: value.credential };
  } catch {
    return null;
  }
}

export function writePairing(pairing: StoredPairing, storage: Storage = localStorage): void {
  storage.setItem(CREDENTIAL_KEY, JSON.stringify({ v: 1, id: pairing.id, credential: pairing.credential }));
}

// The person's own Unpair: every key under the page's prefix, the credential and everything the page remembers
export function forgetEverything(storage: Storage = localStorage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

// The person's own Unpair of one pairing: everything is forgotten while that pairing is the one stored (or none is),
// and nothing while another is, since another tab has paired this browser anew and the memory is that pairing's now.
// Whether it forgot.
export function forgetPairing(pairing: StoredPairing | null, storage: Storage = localStorage): boolean {
  const stored = readPairing(storage);
  if (stored !== null && (pairing === null || stored.id !== pairing.id || stored.credential !== pairing.credential)) return false;
  forgetEverything(storage);
  return true;
}
