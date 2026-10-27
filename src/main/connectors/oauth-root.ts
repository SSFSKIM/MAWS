// P3-HD M3c2: the production composition of MAWS's own OAuth (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// M3 and Decision Log 14, 20, 25 and 28), supplied by the application's root to the connector service beside route D.
// The sealed store under `<userData>/connectors/oauth/` over Electron's asynchronous safeStorage, the explicit flow over
// main's fetch, the 127.0.0.1 loopback listener and the client port's browser hand-off (OX4; in Electron the one
// scheme-checked seam, `openExternalUrl`, whose MAWS_E2E open log the fixture's fake browser follows), and the provider
// over the host's `connectors.directClose`.
//
// No route-support switch: under MAWS_E2E the only difference is the custody guard (Decision Log 28), which stands
// before every real safeStorage operation. The E2E launch runs Chromium on its mock keychain (src/main/index.ts); the
// guard proves, at each call, that the switch is present and that the app's userData is the scratch profile the harness
// named (MAWS_USER_DATA) under the OS temporary directory, canonically, or answers unavailable without asking
// safeStorage. A test checking the profile from outside cannot protect a decryption of a saved record at startup; this
// does. Lazy: nothing touches safeStorage until a demand, a state query, a listing or an owner action.
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { app, safeStorage } from 'electron';
import { isNoClient, NO_CLIENT_REASON, type ClientPort } from '@shared/client/port';
import type { ClientRef } from '@shared/ipc/client';
import { listenLoopback } from './oauth-callback';
import { createConnectorOAuthFlow } from './oauth-flow';
import { createConnectorOAuthProvider, type ConnectorOAuthProvider, type ConnectorOAuthProviderDeps } from './oauth-provider';
import { createConnectorOAuthStore, electronOAuthSealer, type ConnectorOAuthSealer } from './oauth-store';

export interface E2ECustodyFacts {
  e2e: boolean; // the MAWS_E2E launch (the one that appends the mock keychain switch)
  mockKeychain(): boolean;
  userData(): string;
  scratch(): string | undefined; // the profile the harness named
  tmp(): string;
}

const canonical = (path: string): string | null => {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
};

// The sealer itself outside E2E; under it, one that proves custody before each operation and otherwise fails closed.
export function guardE2ECustody(sealer: ConnectorOAuthSealer, facts: E2ECustodyFacts): ConnectorOAuthSealer {
  if (!facts.e2e) return sealer;
  const safe = (): boolean => {
    if (!facts.mockKeychain()) return false;
    const named = facts.scratch();
    if (!named) return false;
    const profile = canonical(facts.userData());
    const scratch = canonical(named);
    const tmp = canonical(facts.tmp());
    return profile !== null && tmp !== null && profile === scratch && profile.startsWith(tmp.endsWith(sep) ? tmp : tmp + sep);
  };
  const refuse = () => new Error('E2E custody unproven: safeStorage was not asked');
  return {
    available: async () => safe() && sealer.available(),
    seal: async (text) => {
      if (!safe()) throw refuse();
      return sealer.seal(text);
    },
    open: async (sealed) => {
      if (!safe()) throw refuse();
      return sealer.open(sealed);
    },
  };
}

// The owner's Connect or Reconnect opens the browser through the client port, on the client that asked. A flow has one
// asker (a concurrent Connect is busy); an asker gone by the hand-off is still the one named, so mawsd's port answers
// noClient and the flow fails as not opened, rather than opening consent on a screen no live request came from.
export async function openOwnerBrowser(port: Pick<ClientPort, 'openExternal'>, url: string, client: ClientRef | null): Promise<void> {
  const answer = await port.openExternal(client, { url });
  if (isNoClient(answer) || !answer.opened) throw new Error(`the authorization URL was not opened: ${isNoClient(answer) ? NO_CLIENT_REASON : answer.reason}`);
}

export function productionConnectorOAuth(deps: Pick<ConnectorOAuthProviderDeps, 'closeHost' | 'log'> & { port: Pick<ClientPort, 'openExternal'> }): ConnectorOAuthProvider {
  const sealer = guardE2ECustody(electronOAuthSealer(safeStorage, () => app.whenReady()), {
    e2e: Boolean(process.env.MAWS_E2E),
    mockKeychain: () => app.commandLine.hasSwitch('use-mock-keychain'),
    userData: () => app.getPath('userData'),
    scratch: () => process.env.MAWS_USER_DATA,
    tmp: tmpdir,
  });
  const store = createConnectorOAuthStore({ directory: join(app.getPath('userData'), 'connectors', 'oauth'), sealer });
  const flow = createConnectorOAuthFlow({ fetch: (url, init) => fetch(url, init), listen: listenLoopback, openBrowser: (url, client) => openOwnerBrowser(deps.port, url, client) });
  return createConnectorOAuthProvider({ store, flow, closeHost: deps.closeHost, ...(deps.log && { log: deps.log }) });
}
