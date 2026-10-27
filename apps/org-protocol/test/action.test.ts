// RL4's canonical action (action.ts) and the WebAuthn assertion that carries a web-cards answer (webauthn.ts): their
// encodings, step-up, freshness and each refusal, named by the first check that refuses it.
import { describe, expect, it } from 'vitest';
import {
  actionDigest,
  actionFingerprint,
  actionSigningInput,
  actionTimes,
  FRESH_MS,
  isAction,
  KEPT_S,
  OP_HORIZON_S,
  signStepUp,
  verifyStepUp,
  type Action,
} from '../src/action.ts';
import { base64urlDecode, base64urlEncode } from '../src/base64url.ts';
import { canonicalize } from '../src/canonical.ts';
import { generateSigningKey } from '../src/keys.ts';
import { derToP1363, verifyWebAuthn } from '../src/webauthn.ts';
import { SoftwareAuthenticator } from '../test-support/authenticator.ts';

const created = '2026-10-27T04:00:00.000Z';
const base: Action = {
  v: 1,
  org: 'org-vectors',
  machine: 'mref-mini-0000001',
  device: 'dev-a1',
  opId: 'op-0123456789abcdef',
  opCreated: created,
  action: 'session.answer',
  session: 'b1f0c3a2-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  context: { lane: 'B', launchId: 'launch-1', engineSessionId: 'engine-1' },
  args: { requestId: 'req-1', answer: { behavior: 'allow' } },
  requestDigest: { session: 'engine-1', request: 'req-1', tool: 'Bash', input_sha256: 'a'.repeat(64) },
  nonce: base64urlEncode(new Uint8Array(16).fill(7)),
  created,
};
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

describe('the canonical action', () => {
  it('signs the domain and the canonical action without stepUp and webauthn', async () => {
    const key = await generateSigningKey();
    const stepped = await signStepUp(base, key);
    const text = new TextDecoder().decode(actionSigningInput(stepped));
    expect(text).toBe(`smns-action-v1\n${canonicalize(base)}`);
    expect(await actionDigest(stepped)).toEqual(await sha256(actionSigningInput(base)));
  });

  it("fingerprints what every reseal keeps: not nonce, created, stepUp or webauthn, but every argument", async () => {
    const fingerprint = await actionFingerprint(base);
    const kept: Record<string, unknown> = { ...base };
    delete kept.nonce;
    delete kept.created;
    expect(fingerprint).toBe(base64urlEncode(await sha256(new Uint8Array(new TextEncoder().encode(canonicalize(kept))))));
    const resealed = await signStepUp({ ...base, nonce: base64urlEncode(new Uint8Array(16).fill(8)), created: '2026-10-27T04:00:30.000Z' }, await generateSigningKey());
    expect(await actionFingerprint(resealed)).toBe(fingerprint);
    expect(await actionFingerprint({ ...base, args: { ...base.args, requestId: 'req-2' } })).not.toBe(fingerprint);
    expect(await actionFingerprint({ ...base, device: 'dev-a2' })).not.toBe(fingerprint);
  });

  it('verifies a step-up signature by the step-up key only, over the action as signed', async () => {
    const key = await generateSigningKey();
    const other = await generateSigningKey();
    const stepped = await signStepUp(base, key);
    expect(base64urlDecode(stepped.stepUp as string)).toHaveLength(64);
    expect(await verifyStepUp(stepped, key.pub)).toEqual({ ok: true });
    expect(await verifyStepUp(stepped, other.pub)).toEqual({ ok: false, code: 'bad-signature' });
    expect(await verifyStepUp({ ...stepped, args: { requestId: 'req-2' } }, key.pub)).toEqual({ ok: false, code: 'bad-signature' });
    expect(await verifyStepUp(base, key.pub)).toEqual({ ok: false, code: 'malformed' });
  });

  it('is an action only in its exact shape', () => {
    expect(isAction(base)).toBe(true);
    expect(isAction({ ...base, extra: 1 })).toBe(false);
    expect(isAction({ ...base, v: 2 })).toBe(false);
    expect(isAction({ ...base, opId: 'short' })).toBe(false);
    expect(isAction({ ...base, opId: 'has space in it!!!' })).toBe(false);
    expect(isAction({ ...base, nonce: base64urlEncode(new Uint8Array(15)) })).toBe(false);
    expect(isAction({ ...base, created: '2026-10-27T04:00:00Z' })).toBe(false);
    const withoutContext: Record<string, unknown> = { ...base };
    delete withoutContext.context;
    expect(isAction(withoutContext)).toBe(false); // a session's action carries its context
    expect(isAction({ ...base, context: { lane: 'A', session: 's', launch: 'l' } })).toBe(true);
    expect(isAction({ ...base, requestDigest: { ...base.requestDigest, input_sha256: 'A'.repeat(64) } })).toBe(false);
    expect(isAction({ ...base, args: [] })).toBe(false);
  });

  it('refuses an opCreated more than 60 s after created, and keeps one up to it', () => {
    expect(FRESH_MS).toBe(60_000);
    expect(isAction({ ...base, opCreated: '2026-10-27T04:01:00.000Z' })).toBe(true);
    expect(isAction({ ...base, opCreated: '2026-10-27T04:01:00.001Z' })).toBe(false);
  });

  it('is stale beyond 60 s of the clock either way, and expired past the horizon', () => {
    expect(OP_HORIZON_S).toBe(KEPT_S - 3600);
    const at = (iso: string) => Date.parse(iso);
    expect(actionTimes(base, at('2026-10-27T04:01:00.000Z'))).toEqual({ ok: true });
    expect(actionTimes(base, at('2026-10-27T04:01:00.001Z'))).toEqual({ ok: false, reason: 'stale' });
    expect(actionTimes(base, at('2026-10-27T03:58:59.999Z'))).toEqual({ ok: false, reason: 'stale' });
    const resent = { ...base, opCreated: '2026-10-26T05:00:00.000Z', created: '2026-10-27T04:00:00.000Z' };
    expect(actionTimes(resent, at('2026-10-27T04:00:00.000Z'))).toEqual({ ok: true });
    const old = { ...base, opCreated: '2026-10-26T04:59:59.999Z' };
    expect(actionTimes(old, at('2026-10-27T04:00:00.000Z'))).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('a WebAuthn assertion over an action', () => {
  const rpId = 'desk.example';
  const origin = 'https://desk.example';
  const setup = async (counter: number | 'none' = 4) => {
    const key = await generateSigningKey();
    const credentialId = base64urlEncode(new Uint8Array([1, 2, 3, 4]));
    const authenticator = new SoftwareAuthenticator(key, credentialId, rpId, counter);
    return { authenticator, passkey: { credentialId, publicKey: key.pub, rpId } };
  };

  it('verifies with UP and UV over the action digest, answering the new counter', async () => {
    const { authenticator, passkey } = await setup();
    const signed = { ...base, webauthn: await authenticator.assert(await actionDigest(base), origin) };
    expect(await verifyWebAuthn(signed, passkey, origin, 4)).toEqual({ ok: true, counter: 5 });
  });

  it("names each refusal by the first check that fails", async () => {
    const { authenticator, passkey } = await setup();
    const digest = await actionDigest(base);
    const make = async (options: Parameters<SoftwareAuthenticator['assert']>[2]) => ({ ...base, webauthn: await authenticator.assert(digest, origin, options) });
    expect(await verifyWebAuthn(await make({ challenge: new Uint8Array(32) }), passkey, origin, 0)).toEqual({ ok: false, code: 'challenge' });
    expect(await verifyWebAuthn(await make({ origin: 'https://evil.example' }), passkey, origin, 0)).toEqual({ ok: false, code: 'origin' });
    expect(await verifyWebAuthn(await make({ rpId: 'evil.example' }), passkey, origin, 0)).toEqual({ ok: false, code: 'rp-id' });
    expect(await verifyWebAuthn(await make({ flags: 0x01 }), passkey, origin, 0)).toEqual({ ok: false, code: 'user-verification' });
    expect(await verifyWebAuthn(await make({ flags: 0x04 }), passkey, origin, 0)).toEqual({ ok: false, code: 'user-presence' });
    expect(await verifyWebAuthn(await make({ type: 'webauthn.create' }), passkey, origin, 0)).toEqual({ ok: false, code: 'malformed' });
    const good = await make({});
    expect(await verifyWebAuthn({ ...good, args: { other: true } }, passkey, origin, 0)).toEqual({ ok: false, code: 'challenge' });
    expect(await verifyWebAuthn(good, { ...passkey, credentialId: 'AAAA' }, origin, 0)).toEqual({ ok: false, code: 'unknown-signer' });
    expect(await verifyWebAuthn(good, { ...passkey, publicKey: (await generateSigningKey()).pub }, origin, 0)).toEqual({ ok: false, code: 'bad-signature' });
    expect(await verifyWebAuthn(base, passkey, origin, 0)).toEqual({ ok: false, code: 'malformed' });
  });

  it('requires a non-zero counter to rise, and takes zero to zero from a counterless authenticator', async () => {
    const { authenticator, passkey } = await setup();
    const signed = { ...base, webauthn: await authenticator.assert(await actionDigest(base), origin) };
    expect(await verifyWebAuthn(signed, passkey, origin, 5)).toEqual({ ok: false, code: 'counter' });
    expect(await verifyWebAuthn(signed, passkey, origin, 9)).toEqual({ ok: false, code: 'counter' });
    const counterless = await setup('none');
    const digest = await actionDigest(base);
    const first = { ...base, webauthn: await counterless.authenticator.assert(digest, origin) };
    const second = { ...base, webauthn: await counterless.authenticator.assert(digest, origin) };
    expect(await verifyWebAuthn(first, counterless.passkey, origin, 0)).toEqual({ ok: true, counter: 0 });
    expect(await verifyWebAuthn(second, counterless.passkey, origin, 0)).toEqual({ ok: true, counter: 0 });
    // A stored counter that is non-zero refuses an authenticator that went back to zero.
    expect(await verifyWebAuthn(second, counterless.passkey, origin, 3)).toEqual({ ok: false, code: 'counter' });
  });

  it("reads only DER's strict ECDSA form", () => {
    const r = new Uint8Array(32).fill(0x80);
    const s = new Uint8Array(32).fill(0x01);
    const der = Uint8Array.from([0x30, 69, 0x02, 33, 0x00, ...r, 0x02, 32, ...s]);
    expect(derToP1363(der)).toEqual(Uint8Array.from([...r, ...s]));
    expect(derToP1363(Uint8Array.from([0x30, 70, 0x02, 33, 0x00, ...r, 0x02, 33, 0x00, ...s]))).toBeNull(); // padded s
    expect(derToP1363(Uint8Array.from([0x30, 68, 0x02, 32, ...r, 0x02, 32, ...s]))).toBeNull(); // negative r
    expect(derToP1363(Uint8Array.from([...der, 0]))).toBeNull(); // trailing byte
    expect(derToP1363(Uint8Array.from([0x30, 6, 0x02, 1, 0, 0x02, 1, 1]))).toBeNull(); // r of zero
  });
});
