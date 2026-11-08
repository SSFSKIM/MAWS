// The v2 enrollment code (RL §5.3), moved here from the hub's identity file (P5 O8 M4b, "The move") so the app's
// enrollment builds the code `deployment admin enroll` builds: its round trip and each refusal, worded as the hub's
// decoder words it.
import { describe, expect, it } from 'vitest';
import { base64urlEncode } from '../src/base64url.ts';
import { decodeEnrollmentCodeV2, encodeEnrollmentCodeV2, type EnrollmentCodeV2 } from '../src/enrollment.ts';

const codeV2 = (): EnrollmentCodeV2 => ({
  hub: 'https://desk-hub.example.workers.dev',
  token: 'tok_abc',
  roots: [base64urlEncode(new Uint8Array(16).fill(1))],
  recoveryPub: base64urlEncode(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i))),
  k: base64urlEncode(new Uint8Array(32).fill(3)),
});
const text = (prefix: string, body: unknown) => `${prefix}${base64urlEncode(new TextEncoder().encode(JSON.stringify(body)))}`;
const v2Text = (body: unknown) => text('smns-enroll-v2.', body);

describe('the v2 enrollment code', () => {
  it('round-trips, with or without the machine it re-enrolls', () => {
    const encoded = encodeEnrollmentCodeV2(codeV2());
    expect(encoded.startsWith('smns-enroll-v2.')).toBe(true);
    expect(encoded).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(decodeEnrollmentCodeV2(encoded)).toEqual(codeV2());
    expect(decodeEnrollmentCodeV2(encodeEnrollmentCodeV2({ ...codeV2(), machine: 'mini' }))).toEqual({ ...codeV2(), machine: 'mini' });
  });

  it('carries no org key, and keeps only its own fields', () => {
    expect(Object.keys(decodeEnrollmentCodeV2(encodeEnrollmentCodeV2(codeV2()))).sort()).toEqual(['hub', 'k', 'recoveryPub', 'roots', 'token']);
  });

  it('takes an http hub only on a loopback host, and a pairing secret up to 512 bits', () => {
    for (const hub of ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787']) expect(decodeEnrollmentCodeV2(v2Text({ ...codeV2(), hub })).hub).toBe(hub);
    expect(decodeEnrollmentCodeV2(v2Text({ ...codeV2(), k: base64urlEncode(new Uint8Array(64).fill(7)) })).k).toBe(base64urlEncode(new Uint8Array(64).fill(7)));
  });

  it('refuses at the encoder what the decoder would refuse', () => {
    expect(() => encodeEnrollmentCodeV2({ ...codeV2(), roots: [] })).toThrow(new TypeError('enrollment code: the roots are not key ids'));
  });

  it.each([
    ['a v1 prefix', text('smns-enroll-v1.', codeV2()), 'enrollment code: not smns-enroll-v2'],
    ['a damaged body', encodeEnrollmentCodeV2(codeV2()).slice(0, -4), 'enrollment code: damaged'],
    ['a body that is not an object', v2Text('mini'), 'enrollment code: damaged'],
    ['no hub', v2Text({ ...codeV2(), hub: undefined }), 'enrollment code: no hub'],
    ['no token', v2Text({ ...codeV2(), token: '' }), 'enrollment code: no token'],
    ['a hub that is not a URL', v2Text({ ...codeV2(), hub: 'desk-hub' }), 'enrollment code: the hub is not a URL'],
    ['a hub that is not https', v2Text({ ...codeV2(), hub: 'http://hub.example.com' }), 'enrollment code: the hub is not https'],
    ['no roots', v2Text({ ...codeV2(), roots: [] }), 'enrollment code: the roots are not key ids'],
    ['a root that is not a key id', v2Text({ ...codeV2(), roots: [base64urlEncode(new Uint8Array(32))] }), 'enrollment code: the roots are not key ids'],
    ['a recovery key that is not a point', v2Text({ ...codeV2(), recoveryPub: base64urlEncode(new Uint8Array(65)) }), 'enrollment code: the recovery key is not a public key'],
    ['a pairing secret under 128 bits', v2Text({ ...codeV2(), k: base64urlEncode(new Uint8Array(15)) }), 'enrollment code: the pairing secret is not 128 to 512 bits'],
    ['a pairing secret over 512 bits', v2Text({ ...codeV2(), k: base64urlEncode(new Uint8Array(65)) }), 'enrollment code: the pairing secret is not 128 to 512 bits'],
    ['a pairing secret that is not base64url', v2Text({ ...codeV2(), k: `${base64urlEncode(new Uint8Array(32))}=` }), 'enrollment code: the pairing secret is not 128 to 512 bits'],
    ['a machine name that is not admitted', v2Text({ ...codeV2(), machine: 'hub' }), 'enrollment code: the machine name is not admitted'],
    ['an org key', v2Text({ ...codeV2(), key: base64urlEncode(new Uint8Array(32)) }), 'enrollment code: unknown field key'],
  ])('refuses %s', (_label, encoded, message) => {
    expect(() => decodeEnrollmentCodeV2(encoded)).toThrow(new TypeError(message));
  });
});
