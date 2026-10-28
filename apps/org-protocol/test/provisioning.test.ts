// The v2 provisioning code (P5 O14 M1, Interfaces §A): what the vectors cannot say, each of the decoder's named
// refusals, the optional legacy key, and that the delegation key's match with the state is not the decoder's to judge.
import { describe, expect, it } from 'vitest';
import { base64urlEncode } from '../src/base64url.ts';
import { canonicalize } from '../src/canonical.ts';
import { generateSigningKey, keyId, utf8 } from '../src/keys.ts';
import { decodeProvisioningCodeV2, encodeProvisioningCodeV2, PROVISIONING_CODE_V2_PREFIX, type ProvisioningCodeV2 } from '../src/provisioning.ts';

const DELEGATION_ID = '0d1e2a3b4c5d6e7f8091a2b3c4d5e6f7';

async function fixture(): Promise<ProvisioningCodeV2> {
  const [root, recovery, delegation] = await Promise.all([generateSigningKey(), generateSigningKey(), generateSigningKey(true)]);
  const privateJwk = (await crypto.subtle.exportKey('jwk', delegation.privateKey)) as JsonWebKey;
  return {
    hub: 'https://hub.example',
    org: 'org-provision',
    roots: [await keyId(root.pub)],
    recoveryPub: recovery.pub,
    token: 'provisioning-secret-token',
    delegation: { id: DELEGATION_ID, prefix: 'dc-', privateJwk },
  };
}

const wrap = (body: unknown) => PROVISIONING_CODE_V2_PREFIX + base64urlEncode(utf8(typeof body === 'string' ? body : JSON.stringify(body)));
const refusal = (text: string) => {
  try {
    decodeProvisioningCodeV2(text);
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return (error as Error).message;
  }
  throw new Error('decoded');
};

describe('the v2 provisioning code', () => {
  it('round-trips with and without the legacy key, as base64url of its canonical JSON', async () => {
    const code = await fixture();
    const text = encodeProvisioningCodeV2(code);
    expect(text.startsWith('smns-provision-v2.')).toBe(true);
    expect(text).toBe(wrap(canonicalize(code)));
    expect(decodeProvisioningCodeV2(text)).toEqual(code);
    const withLegacy = { ...code, legacy: { org: 'org-provision', key: base64urlEncode(new Uint8Array(32).fill(7)) } };
    expect(decodeProvisioningCodeV2(encodeProvisioningCodeV2(withLegacy))).toEqual(withLegacy);
    // Another writer's spelling of the same fields reads alike: the code is no signed record.
    expect(decodeProvisioningCodeV2(wrap(JSON.stringify(withLegacy, null, 2)))).toEqual(withLegacy);
  });

  it('takes a loopback hub over http, for the suites, and nothing else but an https origin', async () => {
    const code = await fixture();
    expect(decodeProvisioningCodeV2(encodeProvisioningCodeV2({ ...code, hub: 'http://127.0.0.1:8747' })).hub).toBe('http://127.0.0.1:8747');
    for (const hub of ['http://hub.example', 'https://hub.example/', 'https://hub.example/path', 'hub.example']) {
      expect(refusal(wrap({ ...code, hub })), hub).toBe('provisioning code: bad hub');
      expect(() => encodeProvisioningCodeV2({ ...code, hub }), hub).toThrow('provisioning code: bad hub');
    }
  });

  it('names the refusal of a text that is not such a code', async () => {
    const text = encodeProvisioningCodeV2(await fixture());
    const body = text.slice(PROVISIONING_CODE_V2_PREFIX.length);
    expect(refusal(body)).toBe('provisioning code: not smns-provision-v2');
    expect(refusal(`smns-provision-v1.${body}`)).toBe('provisioning code: not smns-provision-v2');
    expect(refusal(`${text}=`)).toBe('provisioning code: damaged');
    expect(refusal(wrap('{'))).toBe('provisioning code: damaged');
    expect(refusal(wrap('[1,2]'))).toBe('provisioning code: damaged');
    expect(refusal(wrap('null'))).toBe('provisioning code: damaged');
    expect(refusal(PROVISIONING_CODE_V2_PREFIX + base64urlEncode(Uint8Array.from([0xff, 0xfe])))).toBe('provisioning code: damaged');
  });

  it('names each missing field, each field out of its grammar, and every field it does not know', async () => {
    const code = await fixture();
    for (const field of ['hub', 'org', 'roots', 'recoveryPub', 'token', 'delegation'] as const) {
      const missing: Record<string, unknown> = { ...code };
      delete missing[field];
      expect(refusal(wrap(missing)), field).toBe(`provisioning code: no ${field}`);
    }
    // An empty string is no value.
    expect(refusal(wrap({ ...code, token: '' }))).toBe('provisioning code: no token');
    expect(refusal(wrap({ ...code, legacy: { org: '', key: base64urlEncode(new Uint8Array(32)) } }))).toBe('provisioning code: no legacy.org');
    expect(refusal(wrap({ ...code, legacy: { org: 'o' } }))).toBe('provisioning code: no legacy.key');
    for (const field of ['id', 'prefix', 'privateJwk'] as const) {
      const delegation: Record<string, unknown> = { ...code.delegation };
      delete delegation[field];
      expect(refusal(wrap({ ...code, delegation })), field).toBe(`provisioning code: no delegation.${field}`);
    }
    const publicJwk: JsonWebKey = { ...code.delegation.privateJwk };
    delete publicJwk.d;
    const bad: Array<[string, Record<string, unknown>]> = [
      ['org', { org: 7 }],
      ['token', { token: ['t'] }],
      ['roots', { roots: [] }],
      ['roots', { roots: ['AAAA'] }],
      ['roots', { roots: [code.roots[0], code.roots[0]] }],
      ['recoveryPub', { recoveryPub: code.roots[0] }],
      ['delegation', { delegation: 'dc-' }],
      ['delegation.id', { delegation: { ...code.delegation, id: DELEGATION_ID.toUpperCase() } }],
      ['delegation.prefix', { delegation: { ...code.delegation, prefix: 'hub' } }],
      ['delegation.prefix', { delegation: { ...code.delegation, prefix: 'dc/' } }],
      ['delegation.privateJwk', { delegation: { ...code.delegation, privateJwk: publicJwk } }],
      ['delegation.privateJwk', { delegation: { ...code.delegation, privateJwk: { ...code.delegation.privateJwk, crv: 'P-384' } } }],
      ['delegation.privateJwk', { delegation: { ...code.delegation, privateJwk: { ...code.delegation.privateJwk, d: 'AAAA' } } }],
      ['delegation.privateJwk', { delegation: { ...code.delegation, privateJwk: { ...code.delegation.privateJwk, alg: 'none' } } }],
      ['legacy', { legacy: 'key' }],
      ['legacy.org', { legacy: { org: 7, key: base64urlEncode(new Uint8Array(32)) } }],
      ['legacy.key', { legacy: { org: 'o', key: base64urlEncode(new Uint8Array(16)) } }],
    ];
    for (const [field, change] of bad) {
      const changed = { ...code, ...change };
      expect(refusal(wrap(changed)), `${field} ${JSON.stringify(change)}`).toBe(`provisioning code: bad ${field}`);
      expect(() => encodeProvisioningCodeV2(changed as ProvisioningCodeV2), field).toThrow(`provisioning code: bad ${field}`);
    }
    expect(refusal(wrap({ ...code, machine: 'dc-one' }))).toBe('provisioning code: unknown field machine');
    expect(refusal(wrap({ ...code, delegation: { ...code.delegation, pub: 'x' } }))).toBe('provisioning code: unknown field delegation.pub');
    expect(refusal(wrap({ ...code, legacy: { org: 'o', key: base64urlEncode(new Uint8Array(32)), kid: 'x' } }))).toBe('provisioning code: unknown field legacy.kid');
  });

  it('decodes a delegation key that matches no state: that check is the redemption’s, against the head', async () => {
    const code = await fixture();
    const stranger = (await crypto.subtle.exportKey('jwk', (await generateSigningKey(true)).privateKey)) as JsonWebKey;
    expect(decodeProvisioningCodeV2(encodeProvisioningCodeV2({ ...code, delegation: { ...code.delegation, privateJwk: stranger } })).delegation.privateJwk).toEqual(stranger);
  });
});
