// The owner's passkeys for the org key (§6): discoverable WebAuthn credentials for the hub's origin, evaluated through
// the PRF extension at `PRF_INPUT`. A passkey's PRF output is the same in every browser that holds it (an iCloud
// Keychain passkey syncs to them), and derives the wrapping key its copy of the org key is locked under. Nothing here
// talks to a server: no assertion is checked, the challenge is random, and the PRF output — which only the
// authenticator, after user verification, can produce — is the secret.
//
// Whether a browser gives PRF at all is learned from the `prf` extension's result when a passkey is made or used, and
// said plainly (§8 unknown 4: the owner's first setup records it).
import { base64urlDecode, base64urlEncode } from 'desk-hub/protocol';
import { PRF_INPUT } from './derive';

export type PasskeyFailure = 'unsupported' | 'no-prf' | 'cancelled' | 'failed';

export class PasskeyError extends Error {
  constructor(
    readonly reason: PasskeyFailure,
    message: string,
  ) {
    super(message);
  }
}

/** A passkey's PRF output, and the credential (base64url) that gave it. */
export type PasskeyPrf = { prf: ArrayBuffer; credential: string };

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
const prfExtension = { prf: { eval: { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs;
const challenge = () => crypto.getRandomValues(new Uint8Array(32));

/** False when the browser says it cannot evaluate PRF; null when it does not say (older browsers), and trying tells. */
export async function prfSupported(): Promise<boolean | null> {
  if (typeof PublicKeyCredential === 'undefined') return false;
  const capabilities = (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities;
  if (!capabilities) return null;
  try {
    const answer = (await capabilities.call(PublicKeyCredential))['extension:prf'];
    return answer === undefined ? null : answer;
  } catch {
    return null;
  }
}

function failure(error: unknown): PasskeyError {
  if (error instanceof PasskeyError) return error;
  if (error instanceof DOMException && error.name === 'NotAllowedError') return new PasskeyError('cancelled', 'The passkey prompt was dismissed or timed out.');
  if (error instanceof DOMException && error.name === 'NotSupportedError') return new PasskeyError('unsupported', 'This browser cannot use a passkey here.');
  return new PasskeyError('failed', error instanceof Error ? error.message : String(error));
}

const NO_PRF = "This browser gave no PRF output for the passkey (the WebAuthn extension the org key's copy is locked with), so it can't use a passkey for the org key here. Use the passphrase.";

function passkeyPrfOf(credential: Credential | null): PasskeyPrf {
  if (!(credential instanceof PublicKeyCredential)) throw new PasskeyError('failed', 'No passkey was returned.');
  const first = (credential.getClientExtensionResults() as PrfResults).prf?.results?.first;
  if (!first) throw new PasskeyError('no-prf', NO_PRF);
  return { prf: first, credential: base64urlEncode(new Uint8Array(credential.rawId)) };
}

/** The PRF output of one of `credentials` (base64url ids: the org's passkeys), as the owner picks. */
export async function passkeyPrf(credentials: readonly string[]): Promise<PasskeyPrf> {
  if (typeof PublicKeyCredential === 'undefined') throw new PasskeyError('unsupported', 'This browser has no passkeys.');
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge(),
        rpId: location.hostname,
        userVerification: 'required',
        allowCredentials: credentials.map((id) => ({ type: 'public-key', id: Uint8Array.from(base64urlDecode(id)) })),
        extensions: prfExtension,
      },
    });
    return passkeyPrfOf(assertion);
  } catch (error) {
    throw failure(error);
  }
}

/**
 * Makes a passkey for the org key and returns its PRF output. An authenticator that evaluates PRF only on use (not at
 * creation) is asked once more.
 */
export async function createPasskey(who: { orgName: string; email: string }): Promise<PasskeyPrf> {
  if (typeof PublicKeyCredential === 'undefined') throw new PasskeyError('unsupported', 'This browser has no passkeys.');
  let created: Credential | null;
  try {
    created = await navigator.credentials.create({
      publicKey: {
        rp: { name: `Desk · ${who.orgName}`, id: location.hostname },
        // A fresh user handle: a passkey made under an existing handle would replace that one in the keychain, and with
        // it a way to the org key. Side by side, each stays usable, and each is told apart by its date.
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: who.email, displayName: `${who.email} — org key, ${new Date().toISOString().slice(0, 10)}` },
        challenge: challenge(),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: prfExtension,
      },
    });
  } catch (error) {
    throw failure(error);
  }
  if (!(created instanceof PublicKeyCredential)) throw new PasskeyError('failed', 'No passkey was made.');
  const prf = (created.getClientExtensionResults() as PrfResults).prf;
  const credential = base64urlEncode(new Uint8Array(created.rawId));
  if (prf?.results?.first) return { prf: prf.results.first, credential };
  if (prf?.enabled !== true) {
    throw new PasskeyError(
      'no-prf',
      "The passkey was made, but this browser didn't enable PRF for it (the WebAuthn extension the org key's copy is locked with). Remove that passkey from your passwords, and use a passphrase here.",
    );
  }
  return passkeyPrf([credential]);
}
