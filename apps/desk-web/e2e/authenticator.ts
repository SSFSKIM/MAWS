// Chrome's virtual authenticator (CDP's WebAuthn domain) for the passkey suites: a platform authenticator that verifies
// the user without a prompt and, with `prf`, evaluates the PRF extension (CTAP2's hmac-secret) as an iCloud Keychain
// passkey does. It belongs to one page and keeps its credentials across that page's navigations and reloads.
//
// It cannot stand in for a second browser holding the same passkey: `WebAuthn.getCredentials` exports a credential
// without its PRF secret, and the same credential added to another page's authenticator evaluates no PRF (probed
// 2026-10-15, Chrome on this Mac). The suites prove "the same key in every browser holding the passkey" with one
// authenticator and a browser emptied of everything it held (`clearOrigin`) between the two derivations.
import type { CDPSession, Page } from '@playwright/test';

export async function virtualAuthenticator(page: Page, options: { prf: boolean } = { prf: true }): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: options.prf,
    },
  });
  return cdp;
}

/** Empties everything the origin holds in this browser — IndexedDB, local storage, cookies — as a fresh browser has. */
export async function clearOrigin(cdp: CDPSession, origin: string): Promise<void> {
  await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
}
