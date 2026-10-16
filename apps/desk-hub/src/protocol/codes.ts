// DX1's authentication code, for every shape that carries one (DX1 log events, DX4's raised, settled and delivery,
// DX6's RPCs): HMAC-SHA256 with the org key over
//
//     <domain>\n<project id>\n<RFC 8785 canonical JSON of the covered object>
//
// The covered object is the shape without the code's own value. A shape whose `mac` is {nonce, value} is covered with
// `mac` reduced to {nonce}, so the nonce is authenticated; a log event of a `hub/` writer leaves out `writer`, `seq`,
// and `ts` too, which the hub assigns after the browser computed the code. An RPC carries its nonce as its own
// top-level field (its id) and the value alone as `mac`, and is covered without `mac`. Each shape has its own domain, so
// a code for one never verifies as another; the project id binds an event to its project.
import { base64urlDecode, base64urlEncode, isBase64urlOf } from './base64url';
import { canonicalize } from './canonical';
import type { JsonValue } from './json';
import { isHubPosition, isHubWriter, type Mac } from './log';
import type { Rpc, RpcDraft } from './rpc';

export const DOMAINS = {
  log: 'smns-hub-log-v1',
  rpc: 'smns-hub-rpc-v1',
  raised: 'smns-hub-raised-v1',
  settled: 'smns-hub-settled-v1',
  delivery: 'smns-hub-delivery-v1',
} as const;

export type ShapeKind = keyof typeof DOMAINS;
/** The shapes whose `mac` is {nonce, value}. */
export type MacKind = Exclude<ShapeKind, 'rpc'>;

declare const orgKeyBrand: unique symbol;
export type OrgKey = { readonly hmac: CryptoKey; readonly [orgKeyBrand]: true };

const NONCE_BYTES = 16;
const encoder = new TextEncoder();

export async function importOrgKey(raw: Uint8Array): Promise<OrgKey> {
  if (raw.length !== 32) throw new TypeError('the org key is 256 bits');
  const hmac = await crypto.subtle.importKey('raw', Uint8Array.from(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return { hmac } as OrgKey;
}

/**
 * The org key from a CryptoKey that never exists as bytes in this runtime (the browser derives it and keeps it
 * non-extractable): HMAC with SHA-256, 256 bits, able to sign and verify. Extractability is the holder's concern.
 */
export function orgKeyFromCryptoKey(key: CryptoKey): OrgKey {
  const algorithm = key.algorithm as { name: string; hash?: { name: string }; length?: number };
  if (algorithm.name !== 'HMAC' || algorithm.hash?.name !== 'SHA-256') throw new TypeError('the org key is an HMAC-SHA-256 key');
  if (algorithm.length !== 256) throw new TypeError('the org key is 256 bits');
  if (!key.usages.includes('sign') || !key.usages.includes('verify')) throw new TypeError('the org key signs and verifies');
  return { hmac: key } as OrgKey;
}

/** 128 random bits, base64url: a browser's nonces, every RPC's id, and a machine's when it does not derive them. */
export function newNonce(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

export const NONCE_DOMAIN = 'smns-hub-nonce-v1';

/**
 * A machine's own log event's nonce, derived rather than drawn: the first 16 bytes of HMAC-SHA256 with the org key over
 * `smns-hub-nonce-v1\n<project id>\n<JCS of the event without mac>`. The same event always gets the same nonce, so an
 * upload resent after a lost answer carries the same bytes and the hub does not refuse it as a conflict; two events
 * differ, so their nonces do. A browser never derives: its `human` events carry random nonces (`newNonce`).
 */
export async function deriveLogNonce(key: OrgKey, project: string, event: object): Promise<string> {
  const unsealed: Record<string, unknown> = { ...event };
  delete unsealed.mac;
  const code = new Uint8Array(await crypto.subtle.sign('HMAC', key.hmac, utf8(`${NONCE_DOMAIN}\n${project}\n${canonicalize(unsealed)}`)));
  return base64urlEncode(code.slice(0, NONCE_BYTES));
}

/** The object the code covers; throws a TypeError when the shape has no usable `mac` nonce. */
export function covered(kind: ShapeKind, shape: object): Record<string, unknown> {
  const out: Record<string, unknown> = { ...shape };
  if (kind === 'rpc') {
    delete out.mac;
    return out;
  }
  const mac = out.mac as Partial<Mac> | undefined;
  if (typeof mac !== 'object' || mac === null || typeof mac.nonce !== 'string') throw new TypeError('the shape carries no mac nonce');
  out.mac = { nonce: mac.nonce };
  if (kind === 'log' && typeof out.writer === 'string' && isHubWriter(out.writer)) {
    delete out.writer;
    delete out.seq;
    delete out.ts;
  }
  return out;
}

/** UTF-8, in a buffer of its own (some runtimes type `encode`'s result as possibly shared, which WebCrypto refuses). */
const utf8 = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(text));

export function coveredBytes(kind: ShapeKind, project: string, shape: object): Uint8Array<ArrayBuffer> {
  return utf8(`${DOMAINS[kind]}\n${project}\n${canonicalize(covered(kind, shape))}`);
}

async function sign(key: OrgKey, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key.hmac, bytes)));
}

/** A code's value and its nonce, each in its one canonical base64url spelling (32 and 16 bytes). */
async function check(key: OrgKey, kind: ShapeKind, project: string, shape: object, value: unknown, nonce: unknown): Promise<boolean> {
  if (typeof value !== 'string' || !isBase64urlOf(value, 32) || !isBase64urlOf(nonce, 16)) return false;
  let bytes: Uint8Array<ArrayBuffer>;
  let code: Uint8Array<ArrayBuffer>;
  try {
    bytes = coveredBytes(kind, project, shape);
    code = base64urlDecode(value);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', key.hmac, code, bytes);
}

/** Seals a log event, `raised`, `settled`, or `delivery` drawn up without its `mac`. */
export async function seal<T extends object>(key: OrgKey, kind: MacKind, project: string, draft: T, nonce: string = newNonce()): Promise<T & { mac: Mac }> {
  const withNonce = { ...draft, mac: { nonce } };
  const value = await sign(key, coveredBytes(kind, project, withNonce));
  return { ...draft, mac: { nonce, value } };
}

/**
 * True when the code verifies, its value and nonce are canonical base64url (32 and 16 bytes), and, for a log event of
 * a `hub/` writer, its position (`writer`, `seq`, `ts`, which the code leaves out) passes `isHubPosition`: an importer
 * or a browser refuses such an event as it refuses a bad code.
 */
export async function verify(key: OrgKey, kind: MacKind, project: string, shape: object): Promise<boolean> {
  const writer = (shape as { writer?: unknown }).writer;
  if (kind === 'log' && typeof writer === 'string' && isHubWriter(writer) && !isHubPosition(shape)) return false;
  const mac = (shape as { mac?: Partial<Mac> }).mac;
  if (typeof mac !== 'object' || mac === null) return false;
  return check(key, kind, project, shape, mac.value, mac.nonce);
}

/** Seals an RPC under its own project; the draft carries the nonce (`newNonce()`), which is the RPC's id. */
export async function sealRpc(key: OrgKey, draft: RpcDraft): Promise<Rpc> {
  return { ...draft, mac: await sign(key, coveredBytes('rpc', draft.project, draft)) } as Rpc;
}

/** Verifies an RPC against the project the verifier serves, which must also be the RPC's own. */
export async function verifyRpc(key: OrgKey, rpc: Rpc, project: string): Promise<boolean> {
  return check(key, 'rpc', project, rpc, (rpc as { mac?: unknown }).mac, (rpc as { nonce?: unknown }).nonce);
}

/** A wrapped key's `check` (DX7): HMAC-SHA256 of the org key over `smns-desk-key-check-v1`, base64url. Public. */
export async function keyCheck(key: OrgKey): Promise<string> {
  return sign(key, utf8('smns-desk-key-check-v1'));
}

/** The proof of holding the org key that changing its wrapped keys takes (DX7): HMAC-SHA256 of the key over
 * `smns-desk-key-auth-v1`, base64url. Never stored by the hub, which keeps only its SHA-256. */
export async function keyAuth(key: OrgKey): Promise<string> {
  return sign(key, utf8('smns-desk-key-auth-v1'));
}

/** The digest's `input_sha256`: the lowercase hex SHA-256 of the tool input's canonical JSON. */
export async function inputSha256(input: JsonValue): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(canonicalize(input))));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}
