// The phone's passkey for its cards (P5 O13 M3; RL §5.10): a credential of its own, made at registration and listed in
// the org state beside the device's channel key, whose assertions a machine checks against the exact action pending
// (O10 §C's `verifyWebAuthn`). It is not the org key's PRF passkey (src/key/passkey.ts), which retires with the org key
// and whose assertions are never sent anywhere.
//
// ES256 only, user verification required, and not discoverable (every assertion names the credential). Its public point
// is read from `response.getPublicKey()` (WebAuthn level 2: Safari and iOS Safari 16+, Chromium 85+), never parsed out
// of the attestation object; a browser that answers null cannot register, and says so.
import { base64urlDecode, base64urlEncode, type Passkey, type WebAuthnAssertion } from 'org-protocol';
import type { Me } from '../hub/me';

/** What an answer's assertion is made with: the browser's `credentials.get` over the action's digest, or a suite's
 * software authenticator (§D's `Assert`). */
export type Assert = (challenge: Uint8Array) => Promise<WebAuthnAssertion>;

export class CardsPasskeyError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'cancelled' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

/** The ES256 algorithm (COSE -7), the one a cards passkey is made with. */
const ES256 = -7;

function failure(error: unknown): CardsPasskeyError {
  if (error instanceof CardsPasskeyError) return error;
  if (error instanceof DOMException && error.name === 'NotAllowedError') return new CardsPasskeyError('cancelled', 'The passkey prompt was dismissed or timed out.');
  if (error instanceof DOMException && error.name === 'NotSupportedError') return new CardsPasskeyError('unsupported', 'This browser cannot make a passkey here.');
  return new CardsPasskeyError('failed', error instanceof Error ? error.message : String(error));
}

/** The uncompressed P-256 point of a SubjectPublicKeyInfo, base64url; null for any other key. */
async function pointOf(spki: ArrayBuffer): Promise<string | null> {
  try {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    return base64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
  } catch {
    return null;
  }
}

/** Makes the device's cards passkey for relying party `rpId` (the hub's hostname): the entry the org state will list. */
export async function createCardsPasskey(me: Me, rpId: string): Promise<Passkey> {
  if (typeof PublicKeyCredential === 'undefined') throw new CardsPasskeyError('unsupported', 'This browser has no passkeys.');
  let created: Credential | null;
  try {
    created = await navigator.credentials.create({
      publicKey: {
        rp: { name: `Desk · ${me.org.name}`, id: rpId },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: me.member.email, displayName: `${me.member.email} — cards on this device, ${new Date().toISOString().slice(0, 10)}` },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: ES256 }],
        authenticatorSelection: { residentKey: 'discouraged', requireResidentKey: false, userVerification: 'required' },
        attestation: 'none',
      },
    });
  } catch (error) {
    throw failure(error);
  }
  if (!(created instanceof PublicKeyCredential)) throw new CardsPasskeyError('failed', 'No passkey was made.');
  const response = created.response as AuthenticatorAttestationResponse;
  const spki = typeof response.getPublicKey === 'function' ? response.getPublicKey() : null;
  const algorithm = typeof response.getPublicKeyAlgorithm === 'function' ? response.getPublicKeyAlgorithm() : null;
  const publicKey = spki === null || algorithm !== ES256 ? null : await pointOf(spki);
  if (publicKey === null) {
    throw new CardsPasskeyError('unsupported', "This browser made the passkey but doesn't hand its public key to the page (WebAuthn level 2: Safari 16 or Chrome 85 and later), so it can't answer cards. Update the browser, then pair again.");
  }
  return { credentialId: base64urlEncode(new Uint8Array(created.rawId)), publicKey, rpId };
}

/** The `Assert` an answer takes: one gesture with this device's one credential over the challenge it is given. */
export function assertWith(record: { passkey: Passkey }): Assert {
  return async (challenge) => {
    let got: Credential | null;
    try {
      got = await navigator.credentials.get({
        publicKey: {
          challenge: Uint8Array.from(challenge),
          rpId: record.passkey.rpId,
          allowCredentials: [{ type: 'public-key', id: base64urlDecode(record.passkey.credentialId) }],
          userVerification: 'required',
        },
      });
    } catch (error) {
      throw failure(error);
    }
    if (!(got instanceof PublicKeyCredential)) throw new CardsPasskeyError('failed', 'No assertion was returned.');
    const response = got.response as AuthenticatorAssertionResponse;
    const b64 = (buffer: ArrayBuffer) => base64urlEncode(new Uint8Array(buffer));
    return { credentialId: b64(got.rawId), authenticatorData: b64(response.authenticatorData), clientDataJSON: b64(response.clientDataJSON), signature: b64(response.signature) };
  };
}
