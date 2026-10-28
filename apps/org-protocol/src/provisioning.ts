// The v2 provisioning code (P5 O14 M1, Interfaces §A; RL §5.3): what a secret store holds so a booting VM can enroll
// itself under a delegation. It carries `enrollDelegated`'s fields but the machine's name: the hub, the org and its root
// pins (as the enrollment code carries them), the delegation's redemption token, and the delegation's id, name prefix
// and private key, with which the VM signs its own certificate and, at its departure, that certificate's retirement.
// During the migration window it may carry the DX1 org key as well (`legacy`), so a VM born under it dual-codes from
// its first event without ever enrolling on DX2; the field leaves the stored code at the final brief.
//
//     'smns-provision-v2.' + base64url(UTF-8 canonical JSON)
//
// Unknown fields are refused, and every refusal is a named reason (`provisioning code: <reason>`): `not
// smns-provision-v2`, `damaged`, `no <field>`, `bad <field>`, `unknown field <field>`, nested fields named with a dot.
// The decoder judges the grammar alone: that the private key's public point is the delegation's `pub` in the signed
// state is checked at redemption, against a head the machine verified. The hub never sees the code, only its token.
import { base64urlDecode, base64urlEncode, isBase64urlOf } from './base64url.ts';
import { canonicalize } from './canonical.ts';
import { isPublicKey, utf8, type B64 } from './keys.ts';
import { isMachineName } from './names.ts';
import { isHubOrigin } from './pairing.ts';

export const PROVISIONING_CODE_V2_PREFIX = 'smns-provision-v2.';

export type ProvisioningCodeV2 = {
  /** The hub's origin: https, or http on a loopback host (the suites' local hub). */
  hub: string;
  org: string;
  /** The org root's key ids, as the enrollment code carries them. */
  roots: B64[];
  recoveryPub: B64;
  /** The delegation's redemption token (`ProvisioningKeyIssued.token`). */
  token: string;
  /** The delegation's id (32 lowercase hex), its name prefix, and its private key as a P-256 private JWK. */
  delegation: { id: string; prefix: string; privateJwk: JsonWebKey };
  /** The DX1 org key (256 bits, base64url) and its org, during the migration window only. */
  legacy?: { org: string; key: B64 };
};

const FIELDS = ['hub', 'org', 'roots', 'recoveryPub', 'token', 'delegation', 'legacy'];
const DELEGATION_FIELDS = ['id', 'prefix', 'privateJwk'];
const LEGACY_FIELDS = ['org', 'key'];
/** A private P-256 JWK as WebCrypto exports one: the curve's members, and `ext` and `key_ops` at most besides. */
const JWK_FIELDS = ['kty', 'crv', 'x', 'y', 'd', 'ext', 'key_ops'];

const refuse = (reason: string): never => {
  throw new TypeError(`provisioning code: ${reason}`);
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown) => typeof value === 'string' && value !== '';

/** `value`'s members, every one of them known: the first unknown one is refused by its dotted name. */
function members(value: Record<string, unknown>, known: readonly string[], at: string): Record<string, unknown> {
  for (const field of Object.keys(value)) if (!known.includes(field)) refuse(`unknown field ${at}${field}`);
  return value;
}

/** `value[field]`, refused `no <at><field>` when it is absent (an empty string included). */
function present(value: Record<string, unknown>, field: string, at = ''): unknown {
  const member = value[field];
  if (member === undefined || member === '') refuse(`no ${at}${field}`);
  return member;
}

function isPrivateP256Jwk(jwk: unknown): jwk is JsonWebKey {
  if (!isObject(jwk) || Object.keys(jwk).some((field) => !JWK_FIELDS.includes(field))) return false;
  const { kty, crv, x, y, d, ext, key_ops } = jwk;
  return (
    kty === 'EC' &&
    crv === 'P-256' &&
    isBase64urlOf(x, 32) &&
    isBase64urlOf(y, 32) &&
    isBase64urlOf(d, 32) &&
    (ext === undefined || typeof ext === 'boolean') &&
    (key_ops === undefined || (Array.isArray(key_ops) && key_ops.every((op) => typeof op === 'string')))
  );
}

/** The code `value` holds, each field in its grammar; throws the named refusal of the first one that is not. */
function check(value: unknown): ProvisioningCodeV2 {
  if (!isObject(value)) return refuse('damaged');
  members(value, FIELDS, '');
  const hub = present(value, 'hub');
  if (!isHubOrigin(hub)) refuse('bad hub');
  const org = present(value, 'org');
  if (!isText(org)) refuse('bad org');
  const roots = present(value, 'roots');
  if (!Array.isArray(roots) || roots.length === 0 || !roots.every((root) => isBase64urlOf(root, 16)) || new Set(roots).size !== roots.length) refuse('bad roots');
  const recoveryPub = present(value, 'recoveryPub');
  if (!isPublicKey(recoveryPub)) refuse('bad recoveryPub');
  const token = present(value, 'token');
  if (!isText(token)) refuse('bad token');
  const delegation = present(value, 'delegation');
  if (!isObject(delegation)) return refuse('bad delegation');
  members(delegation, DELEGATION_FIELDS, 'delegation.');
  const id = present(delegation, 'id', 'delegation.');
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) refuse('bad delegation.id');
  const prefix = present(delegation, 'prefix', 'delegation.');
  if (typeof prefix !== 'string' || !isMachineName(prefix)) refuse('bad delegation.prefix');
  const privateJwk = present(delegation, 'privateJwk', 'delegation.');
  if (!isPrivateP256Jwk(privateJwk)) refuse('bad delegation.privateJwk');
  const code: ProvisioningCodeV2 = {
    hub: hub as string,
    org: org as string,
    roots: [...(roots as string[])],
    recoveryPub: recoveryPub as string,
    token: token as string,
    delegation: { id: id as string, prefix: prefix as string, privateJwk: { ...(privateJwk as JsonWebKey) } },
  };
  if (value.legacy !== undefined) {
    const legacy = value.legacy;
    if (!isObject(legacy)) return refuse('bad legacy');
    members(legacy, LEGACY_FIELDS, 'legacy.');
    const legacyOrg = present(legacy, 'org', 'legacy.');
    if (!isText(legacyOrg)) refuse('bad legacy.org');
    const key = present(legacy, 'key', 'legacy.');
    if (!isBase64urlOf(key, 32)) refuse('bad legacy.key');
    code.legacy = { org: legacyOrg as string, key: key as string };
  }
  return code;
}

/** The code as text. Throws the named refusal (a TypeError) of a field out of its grammar. */
export function encodeProvisioningCodeV2(code: ProvisioningCodeV2): string {
  return PROVISIONING_CODE_V2_PREFIX + base64urlEncode(utf8(canonicalize(check(code))));
}

/** The code `text` spells. Throws a TypeError whose message is the named refusal (see the header). */
export function decodeProvisioningCodeV2(text: string): ProvisioningCodeV2 {
  if (typeof text !== 'string' || !text.startsWith(PROVISIONING_CODE_V2_PREFIX)) return refuse('not smns-provision-v2');
  let value: unknown;
  try {
    const bytes = base64urlDecode(text.slice(PROVISIONING_CODE_V2_PREFIX.length));
    const json = new TextDecoder().decode(bytes);
    // Well-formed UTF-8 only: the decoder replaces a bad sequence, so the text must encode back to the very bytes.
    if (base64urlEncode(utf8(json)) !== base64urlEncode(bytes)) return refuse('damaged');
    value = JSON.parse(json);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('provisioning code: ')) throw error;
    return refuse('damaged');
  }
  return check(value);
}
