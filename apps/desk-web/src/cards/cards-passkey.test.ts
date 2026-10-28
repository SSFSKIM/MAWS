// The phone's cards passkey (P5 O13 M3): made ES256 only, user verification required, not discoverable and with no PRF,
// its public point read from `getPublicKey()`'s SubjectPublicKeyInfo (a browser that answers null cannot register);
// and the `Assert` an answer takes, whose assertion over an action's digest the endpoint's `verifyWebAuthn` accepts.
// The browser's WebAuthn is stood in for: Chromium's virtual authenticator proves the real one (e2e-hub/cards-device).
import { actionDigest, base64urlDecode, base64urlEncode, generateSigningKey, verifyWebAuthn, type Action } from 'org-protocol';
import { SoftwareAuthenticator } from 'org-protocol/test-support';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../hub/me';
import { assertWith, CardsPasskeyError, createCardsPasskey } from './cards-passkey';

const ME: Me = { org: { id: 'org-phone', name: 'Phone org', created: '', key_check: null }, member: { id: '0a1b2c3d4e5f60718293a4b5c6d7e8f9', email: 'owner@example.com', role: 'admin', created: '' } };

class FakeCredential {
  constructor(
    readonly rawId: ArrayBuffer,
    readonly response: object,
  ) {}
}

const buffer = (bytes: Uint8Array) => Uint8Array.from(bytes).buffer;

function stubWebAuthn(credentials: { create?: (options: CredentialCreationOptions) => Promise<unknown>; get?: (options: CredentialRequestOptions) => Promise<unknown> }) {
  vi.stubGlobal('PublicKeyCredential', FakeCredential);
  vi.stubGlobal('navigator', { credentials });
}
afterEach(() => vi.unstubAllGlobals());

describe('createCardsPasskey', () => {
  it('makes an ES256, user-verified, non-discoverable credential with no PRF, and lists its point', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
    const point = base64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const asked: CredentialCreationOptions[] = [];
    stubWebAuthn({
      create: async (options) => {
        asked.push(options);
        return new FakeCredential(buffer(new Uint8Array([1, 2, 3, 4])), { getPublicKey: () => spki, getPublicKeyAlgorithm: () => -7 });
      },
    });
    expect(await createCardsPasskey(ME, 'desk.example')).toEqual({ credentialId: 'AQIDBA', publicKey: point, rpId: 'desk.example' });
    const options = asked[0].publicKey!;
    expect(options.rp.id).toBe('desk.example');
    expect(options.pubKeyCredParams).toEqual([{ type: 'public-key', alg: -7 }]);
    expect(options.authenticatorSelection).toMatchObject({ residentKey: 'discouraged', userVerification: 'required' });
    expect(options.extensions).toBeUndefined();
    expect(options.user.name).toBe('owner@example.com');
  });

  it('refuses with a plain reason where the browser hands no public key, or one of another algorithm', async () => {
    stubWebAuthn({ create: async () => new FakeCredential(buffer(new Uint8Array([1])), { getPublicKey: () => null, getPublicKeyAlgorithm: () => -7 }) });
    await expect(createCardsPasskey(ME, 'desk.example')).rejects.toMatchObject({ reason: 'unsupported', message: expect.stringMatching(/doesn't hand its public key/) });
    stubWebAuthn({ create: async () => new FakeCredential(buffer(new Uint8Array([1])), { getPublicKey: () => new ArrayBuffer(300), getPublicKeyAlgorithm: () => -257 }) });
    await expect(createCardsPasskey(ME, 'desk.example')).rejects.toBeInstanceOf(CardsPasskeyError);
  });

  it('says a dismissed prompt was dismissed', async () => {
    stubWebAuthn({ create: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) });
    await expect(createCardsPasskey(ME, 'desk.example')).rejects.toMatchObject({ reason: 'cancelled' });
  });
});

describe('assertWith', () => {
  it("asserts with the device's one credential over the challenge, as the endpoint verifies it", async () => {
    const authenticator = new SoftwareAuthenticator(await generateSigningKey(), base64urlEncode(new Uint8Array([9, 8, 7, 6])), 'desk.example');
    const asked: CredentialRequestOptions[] = [];
    stubWebAuthn({
      get: async (options) => {
        asked.push(options);
        const made = await authenticator.assert(new Uint8Array(options.publicKey!.challenge as Uint8Array), 'https://desk.example');
        const bytes = (b64: string) => buffer(base64urlDecode(b64));
        return new FakeCredential(bytes(made.credentialId), { authenticatorData: bytes(made.authenticatorData), clientDataJSON: bytes(made.clientDataJSON), signature: bytes(made.signature) });
      },
    });
    const now = new Date().toISOString();
    const action: Action = { v: 1, org: 'org-phone', machine: 'mini-ref-0123456789', device: 'phone', opId: 'op-0123456789abcdef', opCreated: now, action: 'sminos.answer', args: {}, nonce: base64urlEncode(new Uint8Array(16)), created: now };
    const assertion = await assertWith({ passkey: authenticator.passkey })(await actionDigest(action));
    const request = asked[0].publicKey!;
    expect(request.rpId).toBe('desk.example');
    expect(request.userVerification).toBe('required');
    expect(request.allowCredentials!.map((c) => base64urlEncode(new Uint8Array(c.id as Uint8Array)))).toEqual([authenticator.credentialId]);
    expect(await verifyWebAuthn({ ...action, webauthn: assertion }, authenticator.passkey, 'https://desk.example', 0)).toMatchObject({ ok: true, counter: 1 });
  });
});
