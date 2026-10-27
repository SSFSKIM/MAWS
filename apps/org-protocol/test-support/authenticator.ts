// A software WebAuthn authenticator (ES256) for the vectors and the suites: it makes the assertions a web-cards
// device's passkey makes, over any challenge, and can be told to make a wrong one (another challenge, origin or rpId,
// other flags) so each refusal has its case. WebCrypto only, so the vector generator runs it as the package runs.
import { base64urlEncode } from '../src/base64url.ts';
import { utf8, type B64, type SigningKey } from '../src/keys.ts';
import { FLAG_USER_PRESENT, FLAG_USER_VERIFIED } from '../src/webauthn.ts';
import type { WebAuthnAssertion } from '../src/action.ts';

/** P1363 `r‖s` as DER, as an authenticator sends it. */
export function p1363ToDer(sig: Uint8Array): Uint8Array<ArrayBuffer> {
  const integer = (half: Uint8Array) => {
    let start = 0;
    while (start < half.length - 1 && half[start] === 0) start++;
    const magnitude = half.subarray(start);
    return magnitude[0] & 0x80 ? [0x02, magnitude.length + 1, 0, ...magnitude] : [0x02, magnitude.length, ...magnitude];
  };
  const body = [...integer(sig.subarray(0, 32)), ...integer(sig.subarray(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}

export type AssertOptions = { challenge?: Uint8Array; origin?: string; rpId?: string; flags?: number; type?: string };

export class SoftwareAuthenticator {
  private counter: number;
  private readonly key: SigningKey;
  readonly credentialId: B64;
  readonly rpId: string;

  /** `counter`: the signature counter before the first assertion, or `'none'` for an authenticator that keeps none. */
  constructor(key: SigningKey, credentialId: B64, rpId: string, counter: number | 'none' = 0) {
    this.key = key;
    this.credentialId = credentialId;
    this.rpId = rpId;
    this.counter = counter === 'none' ? -1 : counter;
  }

  /** The passkey entry a device's org-state record carries for this authenticator. */
  get passkey(): { credentialId: B64; publicKey: B64; rpId: string } {
    return { credentialId: this.credentialId, publicKey: this.key.pub, rpId: this.rpId };
  }

  /** An assertion over `challenge` (an action's digest) for `origin`, its counter one above the last unless it keeps none. */
  async assert(challenge: Uint8Array, origin: string, options: AssertOptions = {}): Promise<WebAuthnAssertion> {
    const counter = this.counter < 0 ? 0 : ++this.counter;
    const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(options.rpId ?? this.rpId)));
    const authData = new Uint8Array(37);
    authData.set(rpIdHash);
    authData[32] = options.flags ?? FLAG_USER_PRESENT | FLAG_USER_VERIFIED;
    new DataView(authData.buffer).setUint32(33, counter);
    const client = utf8(JSON.stringify({ type: options.type ?? 'webauthn.get', challenge: base64urlEncode(options.challenge ?? challenge), origin: options.origin ?? origin, crossOrigin: false }));
    const signed = new Uint8Array(37 + 32);
    signed.set(authData);
    signed.set(new Uint8Array(await crypto.subtle.digest('SHA-256', client)), 37);
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.key.privateKey, signed));
    return { credentialId: this.credentialId, authenticatorData: base64urlEncode(authData), clientDataJSON: base64urlEncode(client), signature: base64urlEncode(p1363ToDer(sig)) };
  }
}
