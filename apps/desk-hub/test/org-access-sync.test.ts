// `access-sync` against the local hub (O11 M3's reviews). It reads the org state through the machine route, with an
// enrolled machine's service token, so no member's email has to pass Access for the policy to be brought to the head:
// an email change of the org's only member leaves no email both in the head and in the policy. The hub is then the only
// witness, so what it serves is trusted only as far as the operator's own anchors carry it: the genesis hash the
// deployment's config pins (`orgGenesis`), and the checkpoint of the last head a run accepted, kept beside the
// operator's state (here in a temporary directory), which each run must extend.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateSigningKey, stateHash, type OrgState, type SignedOrgState } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessSync, readCheckpoint, readVerifiedState, writeCheckpoint, type HubRead } from '../deploy/access-sync';
import { accessPlan, reconcileAccess, type CfApi } from '../deploy/access';
import type { DeployConfig } from '../deploy/config';
import { enroll, type Credentials } from './support/clients';
import { fakeAccessApi } from './support/access-api';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, memberId, newDevice, next, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let a1: TestDevice;
let head: SignedOrgState;
let machine: Credentials;
let dir: string;
let checkpointFile: string;
/** The deployment's config before its org was set up (no `orgGenesis`), and after (`anchored`). */
const config: DeployConfig = { account: 'acct', worker: 'desk-hub-test', host: 'desk-hub-test.example.workers.dev', ownerEmail: ADMIN, sessionDuration: '24h', org: { id: ORG, name: 'Org' } };
let anchored: DeployConfig;
const asMachine: HubRead = (path) => hub.fetchAs(machine, path);

async function accept(state: OrgState) {
  const s = await signedBy(state, a1);
  // Posted as the only member, under the email the head holds for them.
  const response = await hub.fetchAs(head.state.members[0].email.toLowerCase(), '/api/org/state', { body: s });
  expect(response.status, await response.text()).toBe(201);
  head = s;
}
type Page = { head: SignedOrgState | null; chain: SignedOrgState[]; more: boolean };
/** A served page, rewritten: as a hub that lies would serve it. */
const rewritten =
  (change: (page: Page) => void): HubRead =>
  async (path) => {
    const page = (await (await asMachine(path)).json()) as Page;
    change(page);
    return Response.json(page);
  };
/** Runs access-sync against a fresh fake Access API holding the policy a deploy made (seen by the run through `fault`,
 * if given); the API's calls (and its writes alone), and the run's outcome: its result, or its error. */
async function run(read: HubRead, deployment: DeployConfig = anchored, { file = checkpointFile, fault }: { file?: string; fault?: (api: CfApi) => CfApi } = {}) {
  const access = fakeAccessApi();
  await reconcileAccess(access.api, accessPlan({ name: config.worker, host: config.host, ownerEmail: ADMIN, sessionDuration: '24h' }));
  access.calls.length = 0;
  const api = fault ? fault(access.api) : access.api;
  const outcome = await accessSync({ read, api, checkpointFile: file }, deployment).catch((error: unknown) => error as Error);
  return { outcome, writes: access.calls.filter((c) => !c.startsWith('GET')), calls: access.calls };
}
/** An Access API whose answer to a matching call is lost: the call is made (a write commits), then it throws. */
const losing =
  (method: string, path: RegExp) =>
  (api: CfApi): CfApi => ({
    async request<T>(m: string, p: string, body?: unknown): Promise<T> {
      const answer = await api.request<T>(m, p, body);
      if (m === method && path.test(p)) throw new Error(`${m} ${p}: the connection dropped`);
      return answer;
    },
  });
/** The chain served as it was one version back: an authentic older prefix as the head. */
const prefix = rewritten((page) => {
  page.chain = page.chain.slice(0, -1);
  page.head = page.chain.at(-1) ?? null;
});
const failure = (outcome: unknown) => (outcome instanceof Error ? outcome.message : `no error: ${JSON.stringify(outcome)}`);

beforeAll(async () => {
  hub = await startLocalHub();
  a1 = await newDevice('a1');
  machine = await enroll(hub, ADMIN, 'reader');
  dir = mkdtempSync(join(tmpdir(), 'desk-hub-checkpoints-'));
  checkpointFile = join(dir, `${config.worker}.json`);
});
afterAll(async () => {
  await hub?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('access-sync', () => {
  it('lists the owner alone while the hub serves no state and the deployment pins none', async () => {
    const { outcome } = await run(asMachine, config);
    expect(outcome).toMatchObject({ readBack: [ADMIN] });
    expect(readCheckpoint(checkpointFile)).toBeNull();
  });

  it('writes nothing once the hub serves a chain, until the deployment pins its genesis', async () => {
    const A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
    const g = await genesis(ORG, A, ADMIN, a1, await generateSigningKey());
    head = await signedBy(g, a1);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
    anchored = { ...config, orgGenesis: await stateHash(g) };
    const { outcome, calls } = await run(asMachine, config);
    expect(failure(outcome)).toMatch(/orgGenesis/);
    expect(calls).toEqual([]);
  });

  it('brings the policy to the head after the only member’s email changes, though no email overlaps, and checkpoints it', async () => {
    for (let i = 0; i < 3; i++) await accept(await next(head, (s) => s.projects.push({ id: `p${i}`, name: `P${i}` })));
    await accept(await next(head, (s) => (s.members[0].email = 'owner-new@example.com')));
    // The old email reads nothing from here (and Access would not let the new one in yet).
    expect((await hub.fetchAs(ADMIN, '/api/org/state')).status).toBe(403);
    const { outcome } = await run(asMachine);
    expect(outcome).toMatchObject({ readBack: ['owner-new@example.com'] });
    expect(readCheckpoint(checkpointFile)).toEqual({ org: ORG, version: head.state.version, hash: await stateHash(head.state) });
    // The same, read a state per page, as a chain over the hub's page size comes.
    const paged = rewritten((page) => {
      page.more = page.chain.length > 1;
      page.chain = page.chain.slice(0, 1);
    });
    expect((await readVerifiedState(paged, anchored, null)).view).toEqual((await readVerifiedState(asMachine, anchored, null)).view);
  });

  it('writes nothing for a self-consistent chain the hub made up under the org’s id', async () => {
    const forger = await newDevice('forger');
    const forged = await signedBy(await genesis(ORG, memberId(), 'intruder@example.com', forger, await generateSigningKey()), forger);
    const { outcome, writes } = await run(async () => Response.json({ head: forged, chain: [forged], more: false, transitions: [], certificates: { certs: [], retirements: [] } }));
    expect(failure(outcome)).toMatch(/genesis/);
    expect(writes).toEqual([]);
  });

  it('writes nothing for an authentic older prefix served as the head, nor for no state at all, once checkpointed past it', async () => {
    const older = await run(prefix);
    expect(failure(older.outcome)).toMatch(/checkpoint/);
    expect(older.writes).toEqual([]);
    const none = await run(async () => Response.json({ head: null, chain: [], more: false, transitions: [], certificates: { certs: [], retirements: [] } }));
    expect(failure(none.outcome)).toMatch(/serves no state/);
    expect(none.writes).toEqual([]);
  });

  it('refuses a chain the hub altered, and moves the checkpoint with each run that extends it', async () => {
    const altered = rewritten((page) => {
      const last = page.chain.at(-1);
      if (last) last.state.members[0].email = 'intruder@example.com';
      if (page.head) page.head.state.members[0].email = 'intruder@example.com';
    });
    expect(failure((await run(altered)).outcome)).toMatch(/bad-signature/);
    await accept(await next(head, (s) => s.projects.push({ id: 'later', name: 'Later' })));
    expect((await run(asMachine)).outcome).toMatchObject({ readBack: ['owner-new@example.com'] });
    expect(readCheckpoint(checkpointFile)).toMatchObject({ version: head.state.version });
  });

  it('refuses a checkpoint kept for another org', async () => {
    const { outcome, writes } = await run(asMachine, { ...anchored, org: { id: 'another-org', name: 'Other' } });
    expect(failure(outcome)).toMatch(/checkpoint .* another-org|another-org .* checkpoint|org/);
    expect(writes).toEqual([]);
  });

  it('moves the checkpoint before it touches Access, so a run whose Access answer is lost still refuses the older head next', async () => {
    for (const fault of [losing('PUT', /^\/access\/policies\/./), losing('GET', /^\/access\/policies\/./)]) {
      await accept(await next(head, (s) => s.projects.push({ id: `lost-${head.state.version}`, name: 'Lost' })));
      const lost = await run(asMachine, anchored, { fault });
      expect(failure(lost.outcome)).toMatch(/connection dropped/);
      // Access took the head's list; whatever it answered, no older state is accepted after it.
      expect(lost.writes).toEqual([expect.stringMatching(/^PUT /)]);
      expect(readCheckpoint(checkpointFile)).toEqual({ org: ORG, version: head.state.version, hash: await stateHash(head.state) });
      const older = await run(prefix);
      expect(failure(older.outcome)).toMatch(/behind the checkpoint/);
      expect(older.writes).toEqual([]);
    }
  });

  it('touches no Access at all when it cannot move the checkpoint', async () => {
    const elsewhere = join(dir, 'unwritable');
    mkdirSync(elsewhere);
    const file = join(elsewhere, `${config.worker}.json`);
    cpSync(checkpointFile, file);
    // The checkpoint's new copy cannot be made: its path is a directory.
    mkdirSync(`${file}.tmp`);
    await accept(await next(head, (s) => s.projects.push({ id: 'unwritten', name: 'Unwritten' })));
    const { outcome, calls } = await run(asMachine, anchored, { file });
    expect(failure(outcome)).toMatch(/EISDIR|EPERM|illegal operation/);
    expect(calls).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(readFileSync(checkpointFile, 'utf8'));
  });

  it('refuses a run that overlaps another, with no Access call, and the other carries the checkpoint and the policy to the head', async () => {
    let release!: () => void, reading!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (reading = resolve));
    // The first run's reads wait, as a slow one's would, while the operator retries.
    const slow = run(async (path) => (reading(), await held, asMachine(path)));
    await started;
    const retry = await run(asMachine);
    expect(failure(retry.outcome)).toMatch(/another run holds/);
    expect(retry.calls).toEqual([]);
    release();
    expect((await slow).outcome).toMatchObject({ readBack: ['owner-new@example.com'] });
    expect(readCheckpoint(checkpointFile)).toMatchObject({ version: head.state.version });
    expect((await run(asMachine)).outcome).toMatchObject({ readBack: ['owner-new@example.com'] });
  });

  it('writes nothing if the checkpoint moved while it ran, as when its lock was removed by hand under it', async () => {
    const file = join(dir, 'moved', `${config.worker}.json`);
    mkdirSync(dirname(file));
    cpSync(checkpointFile, file);
    const moved = { ...readCheckpoint(file)!, hash: 'another-run' };
    const { outcome, calls } = await run(async (path) => (writeCheckpoint(file, moved), asMachine(path)), anchored, { file });
    expect(failure(outcome)).toMatch(/moved during this run/);
    expect(calls).toEqual([]);
    expect(readCheckpoint(file)).toEqual(moved);
  });
});
