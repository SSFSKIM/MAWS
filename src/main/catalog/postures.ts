// P4-AGG M4 (fix wave): Connectors' sign-in posture for each configured server, `catalog.postures`. A server's name is the
// person's own and may be anything, so a directory record describes a server only when its endpoint matches the record's
// URL, one of its url_options, or its url_regex (@shared/plugins/connector-url). No match, or matches that disagree, is
// unknown: the sheet then neither claims a sign-in is needed nor that none is.
import { createHmac, randomBytes } from 'node:crypto';
import type { CommandOutput, CustomizationEndpoint, CustomizationPluginEndpoint } from '@shared/ipc/schema';
import type { ConnectorRoute } from '@shared/ipc/schema/catalog';
import { endpointMatches } from '@shared/plugins/connector-url';

type Posture = CommandOutput<'catalog.postures'>['servers'][number];
type PluginPosture = CommandOutput<'catalog.postures'>['plugins'][number];

export type Fingerprint = (configuration: Pick<CustomizationEndpoint, 'transport' | 'url'>) => string | null;

/** A configuration's fingerprint: an HMAC of its transport and URL under a key that lives as long as main, so it tells two
 * configurations apart without saying anything about the URL (which may carry a token). Null for one without a URL. */
export function configurationFingerprint(key: Buffer = randomBytes(32)): Fingerprint {
  return ({ transport, url }) => (url === null ? null : createHmac('sha256', key).update(`${transport}\u0000${url}`).digest('hex').slice(0, 32));
}

/** A directory record as the postures read it: its route, and its icon where `catalog.icon` can answer one. */
export interface ListedConnector {
  route: ConnectorRoute;
  iconUrl: string | null;
}

// What the records an endpoint matches say of it: the posture they agree on, and the icon of the one record it matches.
function matchOf(url: string | null, listed: readonly ListedConnector[]): Pick<Posture, 'authPosture' | 'iconUrl'> {
  const matched = listed.filter(({ route }) => endpointMatches(url, route));
  const found = new Set(matched.map(({ route }) => route.authPosture));
  return { authPosture: found.size === 1 ? [...found][0]! : null, iconUrl: matched.length === 1 ? matched[0]!.iconUrl : null };
}

export function posturesOf(endpoints: readonly CustomizationEndpoint[], listed: readonly ListedConnector[], fingerprint: Fingerprint): Posture[] {
  return endpoints.map((endpoint) => {
    // UX wave U11a M8 (§A): the engine host's revision of the configuration, which a press from the row sends back.
    // UX wave U11c M1 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §C): the icon of the one record the
    // endpoint matches; none for several, which would say a record that may not be this server's
    const { authPosture, iconUrl } = matchOf(endpoint.url, listed);
    return { name: endpoint.name, scope: endpoint.scope, path: endpoint.path, authPosture, fingerprint: fingerprint(endpoint), revision: endpoint.revision ?? null, iconUrl };
  });
}

/** UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, M1): each plugin's connector, row
 * for row with the engine host's `pluginServers`, by the rule a configured server has. */
export function pluginPosturesOf(endpoints: readonly CustomizationPluginEndpoint[], listed: readonly ListedConnector[], fingerprint: Fingerprint): PluginPosture[] {
  return endpoints.map((endpoint) => {
    const { authPosture, iconUrl } = matchOf(endpoint.url, listed);
    return { plugin: endpoint.plugin, server: endpoint.server, path: endpoint.path, authPosture, fingerprint: fingerprint(endpoint), revision: endpoint.revision, iconUrl };
  });
}
