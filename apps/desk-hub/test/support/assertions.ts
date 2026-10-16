// Access assertions for the suites: an RS256 key pair whose public half a stub certificate endpoint serves, and JWTs
// signed with it, as Access signs `Cf-Access-Jwt-Assertion`.
import { base64urlEncode } from '../../src/protocol/base64url';

export type TestKey = { kid: string; privateKey: CryptoKey; jwk: JsonWebKey & { kid: string } };

export async function accessKeyPair(kid: string): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

const part = (value: object) => base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));

export async function signAssertion(key: Pick<TestKey, 'kid' | 'privateKey'>, claims: Record<string, unknown>): Promise<string> {
  const signingInput = `${part({ alg: 'RS256', kid: key.kid, typ: 'JWT' })}.${part(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
}
