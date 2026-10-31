// P3-HD M3c2: the production composition of MAWS's own OAuth (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// M3 and Decision Log 14, 20, 25 and 28), composed by the connector service beside route D. P5 O4 M2
// (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §A, §E and §F; D4, D20, D21): the sealed store under
// `<profile>/connectors/oauth/` over the machine's key file (./custody.ts, format 2), the explicit flow over fetch, the
// loopback listener the spine is given (127.0.0.1 on this machine) and the client port's browser hand-off (OX4: on the
// client that asked; in Electron the one scheme-checked seam, `openExternalUrl`, whose MAWS_E2E open log the fixture's
// fake browser follows), and the provider over the host's `connectors.directClose`.
//
// The custody never asks the Keychain, so it has no MAWS_E2E guard; Electron's safeStorage and its guard are main's
// legacy reader's alone (src/main/connectors/legacy-custody.ts), which only the one-time adoption still uses. Lazy:
// nothing reads or makes the key until a demand, a state query, a listing or an owner action.
import { isNoClient, NO_CLIENT_REASON, type ClientPort } from '@shared/client/port';
import type { ConnectorOAuthSealer } from '@shared/connectors/sealer';
import type { ClientRef } from '@shared/ipc/client';
import type { ListenLoopback } from './oauth-callback';
import { createConnectorOAuthFlow } from './oauth-flow';
import { createConnectorOAuthProvider, type ConnectorOAuthProvider, type ConnectorOAuthProviderDeps } from './oauth-provider';
import { createConnectorOAuthStore } from './oauth-store';

// The owner's Connect or Reconnect opens the browser through the client port, on the client that asked. A flow has one
// asker (a concurrent Connect is busy); an asker gone by the hand-off is still the one named, so mawsd's port answers
// noClient and the flow fails as not opened, rather than opening consent on a screen no live request came from.
export async function openOwnerBrowser(port: Pick<ClientPort, 'openExternal'>, url: string, client: ClientRef | null): Promise<void> {
  const answer = await port.openExternal(client, { url });
  if (isNoClient(answer) || !answer.opened) throw new Error(`the authorization URL was not opened: ${isNoClient(answer) ? NO_CLIENT_REASON : answer.reason}`);
}

export interface ProductionOAuthDeps extends Pick<ConnectorOAuthProviderDeps, 'closeHost' | 'log'> {
  port: Pick<ClientPort, 'openExternal'>;
  custody: ConnectorOAuthSealer; // the machine's key file
  directory: string; // <profile>/connectors/oauth
  listen: ListenLoopback;
}

export function productionConnectorOAuth(deps: ProductionOAuthDeps): ConnectorOAuthProvider {
  const store = createConnectorOAuthStore({ directory: deps.directory, sealer: deps.custody });
  const flow = createConnectorOAuthFlow({ fetch: (url, init) => fetch(url, init), listen: deps.listen, openBrowser: (url, client) => openOwnerBrowser(deps.port, url, client) });
  return createConnectorOAuthProvider({ store, flow, closeHost: deps.closeHost, ...(deps.log && { log: deps.log }) });
}
