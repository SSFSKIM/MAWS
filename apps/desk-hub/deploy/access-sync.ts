// `deployment access-sync`: makes the deployment's people policy (`<worker> owner`) admit exactly the members of the
// org state the hub serves (O11 M3). Access sits in front of the whole host, so an email the policy does not list never
// reaches the Registry: a member added, or an email changed, by a signed successor is admitted once this runs, and a
// member removed is shut out at Access as well as at the Registry. While the hub serves no state, the policy lists the
// owner alone, as a deploy creates it. The deploy never rewrites the list once the policy exists (access.ts).
//
// It reads the state as a machine (`GET /machine/org/state`, an enrolled machine's service token), never as a person:
// once a successor changes the only member's email, the old email is refused by the Registry and the new one by Access
// until this runs, so a person's token could not read the head that says what to admit. The hub is then the only
// witness, and what it serves is trusted only as far as two anchors the operator holds carry it:
//   - the org's genesis hash, pinned in the deployment's config (`orgGenesis`), so a chain the hub made up under the
//     org's id, however self-consistent, is refused; with no pin, only "no state yet" is taken;
//   - a checkpoint of the last head a run accepted, `{org, version, hash}`, kept outside the repository and the secrets
//     (`~/.local/state/desk-hub/<worker>.json`, or under DESK_HUB_STATE_DIR), which each run's chain must extend: an
//     authentic older prefix served as the head (a removed member restored) is refused, and so is "no state" once the
//     org is set up.
// The chain is read from its genesis and verified step by step with the protocol package, and only its head's emails
// are used. It then moves the checkpoint to the head, before Access is touched, upserts the policy by name, reads it
// back through the Access API and prints what Access now admits; the whole run holds a lock beside the checkpoint, so
// two runs never overlap. The config's host must be its Worker's before anything is read or written. On production
// this is an Access change, which waits for the owner.
//
// Credentials as NAME=value lines on stdin (deploy.ts, readSecrets): CF_ACCESS_SETUP_TOKEN (Access: policies edit), and
// DESK_MACHINE_CLIENT_ID with DESK_MACHINE_CLIENT_SECRET, the service token of a machine enrolled in the org.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { canonicalize, stateHash, verifyGenesis, verifySuccessor, type SignedOrgState } from 'org-protocol';
import { parseJsonFile } from '../fake-machine/json-file';
import { MACHINE_ORG_STATE_PATH, type OrgStateView } from '../src/protocol/identity';
import { cfApi, listAll, peoplePolicy, upsert, type CfApi } from './access';
import { checkTarget, readDeployConfig, type DeployConfig } from './config';
import { readSecrets } from './deploy';
import { withRunLock } from './run-lock';

/** The emails Access is to admit: the head's members', lowercased and sorted; the owner alone before any state. */
export function admittedEmails(config: DeployConfig, view: OrgStateView): string[] {
  if (view.head === null) return [config.ownerEmail.toLowerCase()];
  return [...new Set(view.head.state.members.map((m) => m.email.toLowerCase()))].sort();
}

/** A GET of a hub path, answered as the hub answers it. */
export type HubRead = (path: string) => Promise<Response>;

/** The last head a run accepted for a deployment: its org, version and `stateHash`. */
export type Checkpoint = { org: string; version: number; hash: string };

/** Where a deployment's checkpoint is kept: `<DESK_HUB_STATE_DIR or ~/.local/state/desk-hub>/<worker>.json`. */
export function checkpointFile(worker: string, env: Record<string, string | undefined> = process.env): string {
  return join(env.DESK_HUB_STATE_DIR ?? join(env.HOME ?? homedir(), '.local', 'state', 'desk-hub'), `${worker}.json`);
}

export function readCheckpoint(file: string): Checkpoint | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const c = parseJsonFile<Checkpoint>(text, file, 'a checkpoint');
  if (typeof c.org !== 'string' || !Number.isSafeInteger(c.version) || c.version < 1 || typeof c.hash !== 'string') throw new Error(`${file} is not a checkpoint ({org, version, hash})`);
  return c;
}

/** Writes the checkpoint whole (a new file renamed over the old), so a run that stops midway leaves the old one. */
export function writeCheckpoint(file: string, checkpoint: Checkpoint): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(checkpoint)}\n`);
  renameSync(`${file}.tmp`, file);
}

/**
 * The org state as the machine route serves it, its whole chain read (page by page) and verified from the genesis the
 * config pins, through the checkpoint: the genesis's `stateHash` is `config.orgGenesis`, it verifies, each next state
 * verifies as the successor of the one before (with the root transitions served), the chain holds the checkpoint's
 * version under its hash, and the head is the chain's last. With no pin and no checkpoint, only "no state" is taken.
 * Throws on any break; answers the view and the checkpoint its head makes (null with no state).
 */
export async function readVerifiedState(read: HubRead, config: DeployConfig, checkpoint: Checkpoint | null): Promise<{ view: OrgStateView; checkpoint: Checkpoint | null }> {
  const org = config.org.id;
  if (checkpoint !== null && checkpoint.org !== org) throw new Error(`the checkpoint was kept for the org ${checkpoint.org}, not ${org}: move it aside if the deployment's org changed`);
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
    if (config.orgGenesis !== undefined || checkpoint !== null) {
      throw new Error(`the hub serves no state, but this deployment's org was set up (${checkpoint ? `checkpoint at version ${checkpoint.version}` : 'orgGenesis pinned'}): refusing to reset Access to the owner alone`);
    }
    return { view, checkpoint: null };
  }
  const [genesis, ...successors] = chain;
  const genesisHash = await stateHash(genesis.state);
  if (config.orgGenesis === undefined) {
    throw new Error(`the hub serves an org state, but the config pins no orgGenesis: set it to the genesis hash the admin's device holds (the hub's genesis hashes to ${genesisHash}; use it only if it is that one)`);
  }
  if (genesisHash !== config.orgGenesis) throw new Error(`the hub's genesis hashes to ${genesisHash}, not the config's orgGenesis ${config.orgGenesis}: not this org's chain`);
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
  if (checkpoint !== null) {
    // Verified from genesis, the chain's states are versions 1, 2, … in order.
    const held = chain[checkpoint.version - 1];
    if (held === undefined) throw new Error(`the hub's head is version ${previous.state.version}, behind the checkpoint's ${checkpoint.version}: an older state served as the head`);
    if ((await stateHash(held.state)) !== checkpoint.hash) throw new Error(`the hub's version ${checkpoint.version} is not the one the checkpoint holds: a fork`);
  }
  return { view: { ...view, head: previous }, checkpoint: { org, version: previous.state.version, hash: await stateHash(previous.state) } };
}

type Policy = { id: string; name: string; include?: Array<{ email?: { email?: string } }> };

/** Upserts the people policy to `view`'s emails, found by name among every page of the account's policies, and reads it
 * back: the emails Access now lists for it. */
export async function syncAccess(api: CfApi, config: DeployConfig, view: OrgStateView): Promise<{ policy: string; emails: string[]; readBack: string[] }> {
  checkTarget(config, 'change Access');
  const emails = admittedEmails(config, view);
  const spec = peoplePolicy(config.worker, emails);
  const policies = await listAll<Policy>(api, '/access/policies');
  const { id } = await upsert(api, '/access/policies', policies, spec);
  const stored = await api.request<Policy>('GET', `/access/policies/${id}`);
  const readBack = (stored.include ?? []).map((rule) => rule.email?.email ?? JSON.stringify(rule)).sort();
  return { policy: spec.name, emails, readBack };
}

/** What a run reaches: the hub (as a machine), the Access API, and the deployment's checkpoint file. */
export type SyncIo = { read: HubRead; api: CfApi; checkpointFile: string };

const sameCheckpoint = (a: Checkpoint | null, b: Checkpoint | null) => a === b || (a !== null && b !== null && a.org === b.org && a.version === b.version && a.hash === b.hash);

/**
 * One run, holding the checkpoint's lock (`<checkpoint>.lock`, run-lock.ts) throughout, so runs never overlap: the target
 * checked, the chain read and verified against the pinned genesis and the checkpoint, the checkpoint moved to the head,
 * then the policy made the head's emails and read back. The checkpoint moves first: once Access may hold the head's
 * list, no older state is accepted, whether Access's answer, its read-back or the run is lost after the write. A run
 * that cannot move it writes nothing to Access, nor does one whose chain is refused.
 */
export async function accessSync(io: SyncIo, config: DeployConfig): Promise<{ policy: string; emails: string[]; readBack: string[]; view: OrgStateView }> {
  checkTarget(config, 'change Access');
  return withRunLock(`${io.checkpointFile}.lock`, async () => {
    const held = readCheckpoint(io.checkpointFile);
    const { view, checkpoint } = await readVerifiedState(io.read, config, held);
    if (checkpoint !== null) {
      // Under the lock no other run moves it; read again in case the lock was removed by hand under a slow run.
      if (!sameCheckpoint(readCheckpoint(io.checkpointFile), held)) throw new Error(`${io.checkpointFile} moved during this run: another run went at once; run again`);
      writeCheckpoint(io.checkpointFile, checkpoint);
    }
    const synced = await syncAccess(io.api, config, view);
    if (synced.readBack.join('\n') !== synced.emails.join('\n')) throw new Error(`Access read back ${synced.readBack.join(', ')}, not ${synced.emails.join(', ')}`);
    return { ...synced, view };
  });
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
  const io: SyncIo = {
    read: (path) => fetch(`https://${config.host}${path}`, { headers, redirect: 'manual' }),
    api: cfApi(secrets.CF_ACCESS_SETUP_TOKEN, config.account),
    checkpointFile: checkpointFile(config.worker),
  };
  let synced: Awaited<ReturnType<typeof accessSync>>;
  try {
    synced = await accessSync(io, config);
  } catch (error) {
    console.error(`access-sync: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const source = synced.view.head === null ? 'no org state yet: the owner alone' : `org state version ${synced.view.head.state.version}, verified from the pinned genesis through ${io.checkpointFile}`;
  console.log(`${synced.policy} (${source}) now admits: ${synced.readBack.join(', ')}`);
  if (!synced.emails.includes(config.ownerEmail.toLowerCase())) console.log(`note: the configured owner (${config.ownerEmail}) is not a member of the state, and Access no longer admits that email`);
  return 0;
}
