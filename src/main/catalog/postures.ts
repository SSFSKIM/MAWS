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

export function posturesOf(endpoints: readonly CustomizationEndpoint[], routes: readonly ConnectorRoute[], fingerprint: Fingerprint): Posture[] {
  return endpoints.map((endpoint) => {
    const found = new Set(routes.filter((route) => endpointMatches(endpoint.url, route)).map((route) => route.authPosture));
    return { name: endpoint.name, scope: endpoint.scope, path: endpoint.path, authPosture: found.size === 1 ? [...found][0]! : null, fingerprint: fingerprint(endpoint) };
  });
}
