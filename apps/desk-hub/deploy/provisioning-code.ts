// The v2 provisioning code (P5 O14, Interfaces §A): what a secret store holds so a booting VM can certify itself under
// a delegation, `smns-provision-v2.` + base64url of its UTF-8 JSON. `deployment admin delegation create` writes one to
// a pipe, `code inspect` reads one, `code strip-legacy` drops its `legacy` field.
//
// The codec's home is `org-protocol` (O14 M1, `apps/org-protocol/src/provisioning.ts`), built beside this milestone;
// this file holds §A's shape and refusals until it lands, and whichever of the two lands second imports the package's
// `encodeProvisioningCodeV2` / `decodeProvisioningCodeV2` here and deletes this file.
import { base64urlDecode, base64urlEncode, isBase64urlOf, isMachineName, isPublicKey } from 'org-protocol';

export const PROVISIONING_V2_PREFIX = 'smns-provision-v2.';

export type ProvisioningCodeV2 = {
  /** The hub's origin, https (http only on a loopback host, for the local runtime). */
  hub: string;
  org: string;
  /** The org root's key ids, as the enrollment code carries them. */
  roots: string[];
  recoveryPub: string;
  /** The delegation's redemption token (`ProvisioningKeyIssued.token`). */
  token: string;
  /** The delegation's id, prefix and private key (a P-256 private JWK). */
  delegation: { id: string; prefix: string; privateJwk: JsonWebKey };
  /** The DX1 org key, during the migration window only. */
  legacy?: { org: string; key: string };
};

const FIELDS = ['hub', 'org', 'roots', 'recoveryPub', 'token', 'delegation', 'legacy'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value !== '';

function isHub(hub: string): boolean {
  try {
    const url = new URL(hub);
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  } catch {
    return false;
  }
}

/** A P-256 private JWK: its curve, its private scalar and its point, each 32 bytes of base64url. */
const isPrivateJwk = (jwk: unknown) =>
  isObject(jwk) &&
  Object.keys(jwk).every((k) => ['kty', 'crv', 'x', 'y', 'd'].includes(k)) &&
  jwk.kty === 'EC' &&
  jwk.crv === 'P-256' &&
  ['x', 'y', 'd'].every((k) => isBase64urlOf(jwk[k], 32));

/** The code, checked; throws `no <field>` or `bad <field>`. */
function check(code: Record<string, unknown>): ProvisioningCodeV2 {
  for (const field of Object.keys(code)) if (!FIELDS.includes(field)) throw new TypeError(`bad ${field}`);
  for (const field of FIELDS.slice(0, 6)) if (code[field] === undefined) throw new TypeError(`no ${field}`);
  const { hub, org, roots, recoveryPub, token, delegation, legacy } = code;
  if (!text(hub) || !isHub(hub as string)) throw new TypeError('bad hub');
  if (!text(org)) throw new TypeError('bad org');
  if (!Array.isArray(roots) || roots.length === 0 || !roots.every((r) => isBase64urlOf(r, 16))) throw new TypeError('bad roots');
  if (!isPublicKey(recoveryPub)) throw new TypeError('bad recoveryPub');
  if (!text(token)) throw new TypeError('bad token');
  if (
    !isObject(delegation) ||
    Object.keys(delegation).some((k) => !['id', 'prefix', 'privateJwk'].includes(k)) ||
    typeof delegation.id !== 'string' ||
    !/^[0-9a-f]{32}$/.test(delegation.id) ||
    typeof delegation.prefix !== 'string' ||
    !isMachineName(delegation.prefix) ||
    !isPrivateJwk(delegation.privateJwk)
  ) {
    throw new TypeError('bad delegation');
  }
  if (legacy !== undefined && (!isObject(legacy) || Object.keys(legacy).some((k) => !['org', 'key'].includes(k)) || !text(legacy.org) || !isBase64urlOf(legacy.key, 32))) {
    throw new TypeError('bad legacy');
  }
  const jwk = delegation.privateJwk as JsonWebKey;
  return {
    hub: hub as string,
    org: org as string,
    roots: [...(roots as string[])],
    recoveryPub,
    token: token as string,
    delegation: { id: delegation.id, prefix: delegation.prefix, privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } },
    ...(legacy === undefined ? {} : { legacy: { org: (legacy as { org: string }).org, key: (legacy as { key: string }).key } }),
  };
}

export function encodeProvisioningCodeV2(code: ProvisioningCodeV2): string {
  return PROVISIONING_V2_PREFIX + base64urlEncode(new TextEncoder().encode(JSON.stringify(check(code as unknown as Record<string, unknown>))));
}

/** Throws `not smns-provision-v2`, `damaged`, `no <field>` or `bad <field>`. */
export function decodeProvisioningCodeV2(code: string): ProvisioningCodeV2 {
  if (!code.startsWith(PROVISIONING_V2_PREFIX)) throw new TypeError('not smns-provision-v2');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64urlDecode(code.slice(PROVISIONING_V2_PREFIX.length))));
  } catch {
    throw new TypeError('damaged');
  }
  if (!isObject(parsed)) throw new TypeError('damaged');
  return check(parsed);
}
