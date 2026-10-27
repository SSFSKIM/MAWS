// `deployment access-sync`: makes the deployment's people policy (`<worker> owner`) admit exactly the members of the
// org state the hub serves (O11 M3). Access sits in front of the whole host, so an email the policy does not list never
// reaches the Registry: a member added, or an email changed, by a signed successor is admitted once this runs, and a
// member removed is shut out at Access as well as at the Registry. While the hub serves no state, the policy lists the
// owner alone, as a deploy creates it. The deploy never rewrites the list once the policy exists (access.ts).
//
// It reads the head as the person whose Access token it is given, then upserts the policy by name and reads it back
// through the Access API, printing what Access now admits. On production this is an Access change, which waits for the
// owner.
//
// Credentials as NAME=value lines on stdin (deploy.ts, readSecrets): CF_ACCESS_SETUP_TOKEN (Access: policies edit) and
// DESK_ACCESS_TOKEN, a member's Access app token (`cloudflared access token -app=<hub>`).
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { ORG_STATE_PATH, type OrgStateView } from '../src/protocol/identity';
import { cfApi, peoplePolicy, upsert, type CfApi } from './access';
import { readDeployConfig, type DeployConfig } from './config';
import { readSecrets } from './deploy';
import { Person } from './hub';

/** The emails Access is to admit: the head's members', lowercased and sorted; the owner alone before any state. */
export function admittedEmails(config: DeployConfig, view: OrgStateView): string[] {
  if (view.head === null) return [config.ownerEmail.toLowerCase()];
  return [...new Set(view.head.state.members.map((m) => m.email.toLowerCase()))].sort();
}

type Policy = { id: string; name: string; include?: Array<{ email?: { email?: string } }> };

/** Upserts the people policy to `view`'s emails and reads it back: the emails Access now lists for it. */
export async function syncAccess(api: CfApi, config: DeployConfig, view: OrgStateView): Promise<{ policy: string; emails: string[]; readBack: string[] }> {
  const emails = admittedEmails(config, view);
  const spec = peoplePolicy(config.worker, emails);
  const policies = await api.request<Policy[]>('GET', '/access/policies');
  const { id } = await upsert(api, '/access/policies', policies, spec);
  const stored = await api.request<Policy>('GET', `/access/policies/${id}`);
  const readBack = (stored.include ?? []).map((rule) => rule.email?.email ?? JSON.stringify(rule)).sort();
  return { policy: spec.name, emails, readBack };
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { config: { type: 'string', multiple: true, default: [join(process.env.DESK_HUB_APP!, 'deploy', 'config.json')] } } });
  const configs = values.config!;
  if (configs.length > 1) {
    console.error(`--config given ${configs.length} times (${configs.join(', ')}): name one deployment`);
    return 2;
  }
  const config = readDeployConfig(configs[0]);
  const secrets = await readSecrets();
  if (!secrets.CF_ACCESS_SETUP_TOKEN || !secrets.DESK_ACCESS_TOKEN) {
    console.error('CF_ACCESS_SETUP_TOKEN and DESK_ACCESS_TOKEN, in the environment or on stdin (deploy/README.md)');
    return 2;
  }
  const view = await new Person(`https://${config.host}`, secrets.DESK_ACCESS_TOKEN).json<OrgStateView>(ORG_STATE_PATH);
  const synced = await syncAccess(cfApi(secrets.CF_ACCESS_SETUP_TOKEN, config.account), config, view);
  const source = view.head === null ? 'no org state yet: the owner alone' : `org state version ${view.head.state.version}`;
  console.log(`${synced.policy} (${source}) now admits: ${synced.readBack.join(', ')}`);
  if (synced.readBack.join('\n') !== synced.emails.join('\n')) {
    console.error(`Access read back ${synced.readBack.join(', ')}, not ${synced.emails.join(', ')}`);
    return 1;
  }
  if (!synced.emails.includes(config.ownerEmail.toLowerCase())) console.log(`note: the owner (${config.ownerEmail}) is not a member of the state, and Access no longer admits them`);
  return 0;
}
