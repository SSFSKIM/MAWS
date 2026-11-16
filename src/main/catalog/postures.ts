// P4-AGG M4 (fix wave): Connectors' sign-in posture for each configured server, `catalog.postures`. A server's name is the
// person's own and may be anything, so a directory record describes a server only when its endpoint matches the record's
// URL, one of its url_options, or its url_regex (@shared/plugins/connector-url). No match, or matches that disagree, is
// unknown: the sheet then neither claims a sign-in is needed nor that none is.
import { createHmac, randomBytes } from 'node:crypto';
import type { CommandOutput, CustomizationEndpoint } from '@shared/ipc/schema';
import type { ConnectorRoute } from '@shared/ipc/schema/catalog';
import { endpointMatches } from '@shared/plugins/connector-url';

type Posture = CommandOutput<'catalog.postures'>['servers'][number];

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

export function posturesOf(endpoints: readonly CustomizationEndpoint[], listed: readonly ListedConnector[], fingerprint: Fingerprint): Posture[] {
  return endpoints.map((endpoint) => {
    const matched = listed.filter(({ route }) => endpointMatches(endpoint.url, route));
    const found = new Set(matched.map(({ route }) => route.authPosture));
    // UX wave U11a M8 (§A): the engine host's revision of the configuration, which a press from the row sends back.
    // UX wave U11c M1 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §C): the icon of the one record the
    // endpoint matches; none for several, which would say a record that may not be this server's
    return {
      name: endpoint.name,
      scope: endpoint.scope,
      path: endpoint.path,
      authPosture: found.size === 1 ? [...found][0]! : null,
      fingerprint: fingerprint(endpoint),
      revision: endpoint.revision ?? null,
      iconUrl: matched.length === 1 ? matched[0]!.iconUrl : null,
    };
  });
}
