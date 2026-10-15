// The org's wrapped keys at the hub (DX7's `/api/org/keys`): any member reads them; an admin holding the org key adds
// and removes them, each change carrying `auth`, the key's proof (HMAC of `smns-desk-key-auth-v1`), which the hub checks
// against the digest the first copy set. The hub never sees the key.
import { ORG_KEYS_PATH, type WrappedKeyAdded, type WrappedKeyRecord, type WrappedKeyRemoval, type WrappedKeyRequest, type WrappedKeys } from 'desk-hub/protocol';
import { hubJson, withJson } from '../hub/http';

/** The query the views share for the org's wrapped keys (TanStack Query), invalidated by every change. */
export const WRAPPED_KEYS_QUERY = ['org-keys'] as const;

export function listWrappedKeys(): Promise<WrappedKeys> {
  return hubJson(ORG_KEYS_PATH);
}

export async function addWrappedKey(request: WrappedKeyRequest): Promise<WrappedKeyRecord> {
  return (await hubJson<WrappedKeyAdded>(ORG_KEYS_PATH, withJson('POST', request))).key;
}

export async function removeWrappedKey(id: string, removal: WrappedKeyRemoval): Promise<void> {
  await hubJson(`${ORG_KEYS_PATH}/${encodeURIComponent(id)}`, withJson('DELETE', removal));
}
