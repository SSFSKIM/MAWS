// `deployment access-sync`: makes the deployment's people policy (`<worker> owner`) admit exactly the members of the
// org state the hub serves (O11 M3). Access sits in front of the whole host, so an email the policy does not list never
// reaches the Registry: a member added, or an email changed, by a signed successor is admitted once this runs, and a
// member removed is shut out at Access as well as at the Registry. While the hub serves no state, the policy lists the
// owner alone, as a deploy creates it. The deploy never rewrites the list once the policy exists (access.ts).
//
// It reads the state as a machine (`GET /machine/org/state`, an enrolled machine's service token), never as a person:
// once a successor changes the only member's email, the old email is refused by the Registry and the new one by Access
// until this runs, so a person's token could not read the head that says what to admit. Read that way the hub is the
// only witness, so the chain is read from its genesis and verified step by step with the protocol package (the
// genesis must be this deployment's org), and only its head's emails are used. It then upserts the policy by name and
// reads it back through the Access API, printing what Access now admits. The config's host must be its Worker's before
// anything is read or written. On production this is an Access change, which waits for the owner.
//
// Credentials as NAME=value lines on stdin (deploy.ts, readSecrets): CF_ACCESS_SETUP_TOKEN (Access: policies edit), and
// DESK_MACHINE_CLIENT_ID with DESK_MACHINE_CLIENT_SECRET, the service token of a machine enrolled in the org.
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { canonicalize, verifyGenesis, verifySuccessor, type SignedOrgState } from 'org-protocol';
import { MACHINE_ORG_STATE_PATH, type OrgStateView } from '../src/protocol/identity';
import { cfApi, peoplePolicy, upsert, type CfApi } from './access';
import { checkTarget, readDeployConfig, type DeployConfig } from './config';
import { readSecrets } from './deploy';

/** The emails Access is to admit: the head's members', lowercased and sorted; the owner alone before any state. */
export function admittedEmails(config: DeployConfig, view: OrgStateView): string[] {
  if (view.head === null) return [config.ownerEmail.toLowerCase()];
  return [...new Set(view.head.state.members.map((m) => m.email.toLowerCase()))].sort();
}

/** A GET of a hub path, answered as the hub answers it. */
export type HubRead = (path: string) => Promise<Response>;

/**
 * The org state as the machine route serves it, its whole chain read (page by page) and verified from the genesis:
 * the genesis is `org`'s and verifies, each next state verifies as the successor of the one before (with the root
 * transitions served), and the head is the chain's last. Throws on any break.
 */
export async function readVerifiedState(read: HubRead, org: string): Promise<OrgStateView> {
  const chain: SignedOrgState[] = [];
  let page: OrgStateView;
  for (;;) {
    const path = `${MACHINE_ORG_STATE_PATH}?since=${chain.at(-1)?.state.version ?? 0}`;
    const response = await read(path);
    if (response.status !== 200) throw new Error(`GET ${path}: ${response.status} ${(await response.text()).slice(0, 200)}`);
    page = (await response.json()) as OrgStateView;
    chain.push(...(page.chain ?? []));
    if (!page.more || (page.chain ?? []).length === 0) break;
  }
  const view = { head: page.head, transitions: page.transitions, certificates: page.certificates };
  if (chain.length === 0) {
    if (view.head !== null) throw new Error('the hub serves a head but no chain');
    return view;
  }
  const [genesis, ...successors] = chain;
  if (genesis.state.org !== org) throw new Error(`the hub's chain is of another org (${genesis.state.org}), not ${org}`);
  const first = await verifyGenesis(genesis);
  if (!first.ok) throw new Error(`the hub's genesis does not verify: ${first.code}`);
  let previous = genesis;
  for (const next of successors) {
    const verdict = await verifySuccessor(previous, next, view.transitions);
    if (!verdict.ok) throw new Error(`the hub's chain breaks at version ${next.state.version}: ${verdict.code}`);
    previous = next;
  }
  if (view.head === null || canonicalize(view.head) !== canonicalize(previous)) throw new Error(`the hub's head is not its chain's last state (version ${previous.state.version})`);
  return { ...view, head: previous };
}

type Policy = { id: string; name: string; include?: Array<{ email?: { email?: string } }> };

/** Upserts the people policy to `view`'s emails and reads it back: the emails Access now lists for it. */
export async function syncAccess(api: CfApi, config: DeployConfig, view: OrgStateView): Promise<{ policy: string; emails: string[]; readBack: string[] }> {
  checkTarget(config, 'change Access');
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
  checkTarget(config, 'change Access');
  const secrets = await readSecrets();
  if (!secrets.CF_ACCESS_SETUP_TOKEN || !secrets.DESK_MACHINE_CLIENT_ID || !secrets.DESK_MACHINE_CLIENT_SECRET) {
    console.error('CF_ACCESS_SETUP_TOKEN, DESK_MACHINE_CLIENT_ID and DESK_MACHINE_CLIENT_SECRET, in the environment or on stdin (deploy/README.md)');
    return 2;
  }
  const headers = { 'CF-Access-Client-Id': secrets.DESK_MACHINE_CLIENT_ID, 'CF-Access-Client-Secret': secrets.DESK_MACHINE_CLIENT_SECRET };
  const view = await readVerifiedState((path) => fetch(`https://${config.host}${path}`, { headers, redirect: 'manual' }), config.org.id);
  const synced = await syncAccess(cfApi(secrets.CF_ACCESS_SETUP_TOKEN, config.account), config, view);
  const source = view.head === null ? 'no org state yet: the owner alone' : `org state version ${view.head.state.version}, its chain verified from genesis`;
  console.log(`${synced.policy} (${source}) now admits: ${synced.readBack.join(', ')}`);
  if (synced.readBack.join('\n') !== synced.emails.join('\n')) {
    console.error(`Access read back ${synced.readBack.join(', ')}, not ${synced.emails.join(', ')}`);
    return 1;
  }
  if (!synced.emails.includes(config.ownerEmail.toLowerCase())) console.log(`note: the configured owner (${config.ownerEmail}) is not a member of the state, and Access no longer admits that email`);
  return 0;
}
