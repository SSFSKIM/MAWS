// The owner's passkey for the org key (§6): a discoverable WebAuthn credential for the hub's origin, evaluated through
// the PRF extension at `PRF_INPUT`. Its PRF output is the same in every browser that holds the passkey (an iCloud
// Keychain passkey syncs to them), so each derives the same key. Nothing here talks to a server: no assertion is
// checked, the challenge is random, and the PRF output — which only the authenticator, after user verification, can
// produce — is the secret.
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

function prfOutput(credential: Credential | null): ArrayBuffer {
  if (!(credential instanceof PublicKeyCredential)) throw new PasskeyError('failed', 'No passkey was returned.');
  const first = (credential.getClientExtensionResults() as PrfResults).prf?.results?.first;
  if (!first) throw new PasskeyError('no-prf', 'This passkey or browser does not give the PRF output the org key derives from. Use the passphrase.');
  return first;
}

/** The PRF output of the passkey the owner picks (or of `credential`, when named). */
export async function passkeyPrf(credential?: BufferSource): Promise<ArrayBuffer> {
  if (typeof PublicKeyCredential === 'undefined') throw new PasskeyError('unsupported', 'This browser has no passkeys.');
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge(),
        rpId: location.hostname,
        userVerification: 'required',
        allowCredentials: credential ? [{ type: 'public-key', id: credential }] : [],
        extensions: prfExtension,
      },
    });
    return prfOutput(assertion);
  } catch (error) {
    throw failure(error);
  }
}

/**
 * Makes the org's passkey — once per org: another passkey has another PRF secret, so it derives another key — and
 * returns its PRF output. An authenticator that evaluates PRF only on use (not at creation) is asked once more.
 */
export async function createPasskey(who: { orgName: string; email: string }): Promise<ArrayBuffer> {
  if (typeof PublicKeyCredential === 'undefined') throw new PasskeyError('unsupported', 'This browser has no passkeys.');
  let created: Credential | null;
  try {
    created = await navigator.credentials.create({
      publicKey: {
        rp: { name: `Desk · ${who.orgName}`, id: location.hostname },
        // A fresh user handle: a passkey made under an existing handle would replace that one in the keychain, and with
        // it the only way to the key every enrolled machine holds. Side by side, the wrong one can still be told apart
        // (by its date, and by the key's fingerprint) and removed.
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
  if (prf?.results?.first) return prf.results.first;
  if (prf?.enabled !== true) throw new PasskeyError('no-prf', 'The passkey was made without the PRF extension the org key derives from. Remove it from your passwords, and use the passphrase.');
  return passkeyPrf(created.rawId);
}
