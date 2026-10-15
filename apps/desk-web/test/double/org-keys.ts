// DX7's wrapped keys as the DX3 double serves them (`/api/org/keys`), and as the unit suites meet them through a
// stubbed fetch: one implementation of the hub's rules for both. The first copy sets the org's `key_check` and keeps
// SHA-256 of its `auth` (`key_auth`, never returned); every later change must carry the `auth` whose digest that is —
// checked before anything else, so a caller without the key learns nothing — or is refused `not-key-holder`; a holder's
// copy of another key is `different-key`; a passkey wraps once (`credential-taken`); the last copy stays (`last-key`).
import { base64urlDecode, base64urlEncode, keyAuth, keyCheck, ORG_KEYS_PATH, type MemberRecord, type WrappedKeyRecord, type WrappedKeys } from 'desk-hub/protocol';
import { holdKeyBytes } from '../../src/key/derive';
import type { PreparedMethod } from '../../src/key/unlock';
import { wrapOrgKey } from '../../src/key/wrap';

export type Answer = { status: number; body: unknown };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const refuse = (status: number, error: string): Answer => ({ status, body: { error, message: error } });

function bytesOf(value: unknown, length: number): boolean {
  if (typeof value !== 'string') return false;
  try {
    const bytes = base64urlDecode(value);
    return bytes.length === length && base64urlEncode(bytes) === value;
  } catch {
    return false;
  }
}

async function digest(auth: string): Promise<string> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(base64urlDecode(auth)))));
}

export class OrgKeysDouble {
  key_check: string | null = null;
  keys: WrappedKeyRecord[] = [];
  private key_auth: string | null = null;
  private nextId = 0;

  list(): WrappedKeys {
    return { key_check: this.key_check, keys: this.keys };
  }

  async add(member: MemberRecord, body: unknown): Promise<Answer> {
    if (member.role !== 'admin') return refuse(403, 'not-admin');
    const b = isObject(body) ? body : {};
    const { method, label, credential, kdf, iv, wrapped, check, auth } = b;
    // In an org that has a key, the key's `auth` is checked before anything else: missing or malformed is `not-key-holder`.
    if (this.key_auth !== null && (!bytesOf(auth, 32) || (await digest(auth as string)) !== this.key_auth)) return refuse(403, 'not-key-holder');
    const valid =
      (method === 'passkey' || method === 'passphrase') &&
      typeof label === 'string' &&
      label.length >= 1 &&
      label.length <= 100 &&
      isObject(kdf) &&
      new TextEncoder().encode(JSON.stringify(kdf)).length <= 1024 &&
      bytesOf(iv, 12) &&
      bytesOf(wrapped, 48) &&
      bytesOf(check, 32) &&
      bytesOf(auth, 32) &&
      (method === 'passkey' ? typeof credential === 'string' && credential !== '' : credential === undefined || credential === null);
    if (!valid) return refuse(400, 'bad-shape');
    const hash = await digest(auth as string);
    if (this.key_check !== null && this.key_check !== check) return refuse(409, 'different-key');
    if (method === 'passkey' && this.keys.some((k) => k.credential === credential)) return refuse(409, 'credential-taken');
    const key: WrappedKeyRecord = {
      id: (++this.nextId).toString(16).padStart(32, '0'),
      method,
      label,
      credential: method === 'passkey' ? (credential as string) : null,
      kdf: kdf as WrappedKeyRecord['kdf'],
      iv: iv as string,
      wrapped: wrapped as string,
      check: check as string,
      created_by: member.id,
      created: new Date().toISOString(),
    };
    if (this.key_check === null) [this.key_check, this.key_auth] = [key.check, hash];
    this.keys = [...this.keys, key];
    return { status: 201, body: { key } };
  }

  async remove(member: MemberRecord, id: string, body: unknown): Promise<Answer> {
    if (member.role !== 'admin') return refuse(403, 'not-admin');
    const auth = isObject(body) ? body.auth : undefined;
    if (this.key_auth === null || !bytesOf(auth, 32) || (await digest(auth as string)) !== this.key_auth) return refuse(403, 'not-key-holder');
    if (!this.keys.some((k) => k.id === id)) return refuse(404, 'unknown-key');
    if (this.keys.length === 1) return refuse(409, 'last-key');
    this.keys = this.keys.filter((k) => k.id !== id);
    return { status: 200, body: { removed: id } };
  }

  /** The endpoints: an answer for a request to `/api/org/keys[/<id>]`, or null for any other path. */
  async handle(member: MemberRecord, method: string, path: string, body: unknown): Promise<Answer | null> {
    if (path === ORG_KEYS_PATH && method === 'GET') return { status: 200, body: this.list() };
    if (path === ORG_KEYS_PATH && method === 'POST') return this.add(member, body);
    const one = new RegExp(`^${ORG_KEYS_PATH}/([^/]+)$`).exec(path);
    if (one && method === 'DELETE') return this.remove(member, decodeURIComponent(one[1]), body);
    return null;
  }

  /**
   * Stores a copy of `raw` locked under a passphrase, as a browser that set the org key up elsewhere would have posted
   * it; `prepared` (one passphrase's wrapping key) may be reused across copies, since each derivation takes seconds.
   */
  async seedPassphraseCopy(member: MemberRecord, org: string, raw: Uint8Array, prepared: PreparedMethod, label: string): Promise<WrappedKeyRecord> {
    const held = await holdKeyBytes(Uint8Array.from(raw));
    const { iv, wrapped } = await wrapOrgKey(raw, prepared.wrapping, org, prepared);
    const answer = await this.add(member, { method: prepared.method, label, kdf: prepared.kdf, iv, wrapped, check: await keyCheck(held), auth: await keyAuth(held) });
    if (answer.status !== 201) throw new Error(`the double refused the seeded copy: ${JSON.stringify(answer.body)}`);
    return (answer.body as { key: WrappedKeyRecord }).key;
  }

  /** A `fetch` serving the endpoints alone, as `member`, for the unit suites. */
  fetch(member: MemberRecord): typeof fetch {
    return async (input, init) => {
      const path = new URL(String(input), 'http://double').pathname;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      const answer = (await this.handle(member, init?.method ?? 'GET', path, body)) ?? { status: 404, body: { error: 'not-found' } };
      return Response.json(answer.body, { status: answer.status });
    };
  }
}
