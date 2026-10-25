// P4-AGG M4 (fix wave): Connectors' sign-in posture for each configured server, `catalog.postures`. A server's name is the
// person's own and may be anything, so a directory record describes a server only when its endpoint matches the record's
// URL, one of its url_options, or its url_regex (@shared/plugins/connector-url). No match, or matches that disagree, is
// unknown: the sheet then neither claims a sign-in is needed nor that none is.
import type { CommandOutput, CustomizationEndpoint } from '@shared/ipc/schema';
import type { ConnectorRoute } from '@shared/ipc/schema/catalog';
import { endpointMatches } from '@shared/plugins/connector-url';

type Posture = CommandOutput<'catalog.postures'>['servers'][number];

export function posturesOf(endpoints: readonly CustomizationEndpoint[], routes: readonly ConnectorRoute[]): Posture[] {
  return endpoints.map(({ name, scope, url }) => {
    const found = new Set(routes.filter((route) => endpointMatches(url, route)).map((route) => route.authPosture));
    return { name, scope, authPosture: found.size === 1 ? [...found][0]! : null };
  });
}
