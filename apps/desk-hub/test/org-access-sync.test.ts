// `access-sync` against the local hub (O11 M3's review): it reads the org state through the machine route, with an
// enrolled machine's service token, so no member's email has to pass Access for the policy to be brought to the head.
// An email change of the org's only member leaves no email both in the head and in the policy: the old email is
// refused by the Registry from the change on, and the new one by Access until the policy lists it. Since the route
// is then the only reader, the chain it serves is verified from its genesis with the protocol package.
import { generateSigningKey, type OrgState, type SignedOrgState } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readVerifiedState, syncAccess } from '../deploy/access-sync';
import { accessPlan, reconcileAccess } from '../deploy/access';
import type { DeployConfig } from '../deploy/config';
import { enroll, type Credentials } from './support/clients';
import { fakeAccessApi } from './support/access-api';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, newDevice, next, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let a1: TestDevice;
let head: SignedOrgState;
let machine: Credentials;
const config: DeployConfig = { account: 'acct', worker: 'desk-hub-test', host: 'desk-hub-test.example.workers.dev', ownerEmail: ADMIN, sessionDuration: '24h', org: { id: ORG, name: 'Org' } };
const asMachine = (path: string) => hub.fetchAs(machine, path);

async function accept(state: OrgState) {
  const s = await signedBy(state, a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  expect(response.status, await response.text()).toBe(201);
  head = s;
}

beforeAll(async () => {
  hub = await startLocalHub();
  a1 = await newDevice('a1');
  machine = await enroll(hub, ADMIN, 'reader');
});
afterAll(() => hub?.close());

describe('access-sync', () => {
  it('lists the owner alone before any state', async () => {
    const access = fakeAccessApi();
    const synced = await syncAccess(access.api, config, await readVerifiedState(asMachine, ORG));
    expect(synced.readBack).toEqual([ADMIN]);
  });

  it('brings the policy to the head after the only member’s email changes, though no email overlaps', async () => {
    const A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
    head = await signedBy(await genesis(ORG, A, ADMIN, a1, await generateSigningKey()), a1);
    expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
    for (let i = 0; i < 3; i++) await accept(await next(head, (s) => s.projects.push({ id: `p${i}`, name: `P${i}` })));
    const access = fakeAccessApi();
    await reconcileAccess(access.api, accessPlan({ name: config.worker, host: config.host, ownerEmail: ADMIN, sessionDuration: '24h' }));
    await accept(await next(head, (s) => (s.members[0].email = 'owner-new@example.com')));
    // The old email reads nothing from here (and Access would not let the new one in yet).
    expect((await hub.fetchAs(ADMIN, '/api/org/state')).status).toBe(403);
    const view = await readVerifiedState(asMachine, ORG);
    expect(view.head).toEqual(head);
    // The same, read a state per page, as a chain over the hub's page size comes.
    const paged = async (path: string) => {
      const page = (await (await asMachine(path)).json()) as { chain: SignedOrgState[]; more: boolean };
      return Response.json({ ...page, chain: page.chain.slice(0, 1), more: page.chain.length > 1 });
    };
    expect(await readVerifiedState(paged, ORG)).toEqual(view);
    const synced = await syncAccess(access.api, config, view);
    expect(synced.readBack).toEqual(['owner-new@example.com']);
  });

  it('refuses a chain the hub altered, and one of another org', async () => {
    const altered = async (path: string) => {
      const view = (await (await asMachine(path)).json()) as { chain?: SignedOrgState[]; head: SignedOrgState };
      const last = view.chain?.at(-1);
      if (last) last.state.members[0].email = 'intruder@example.com';
      view.head.state.members[0].email = 'intruder@example.com';
      return Response.json(view);
    };
    await expect(readVerifiedState(altered, ORG)).rejects.toThrow(/bad-signature/);
    await expect(readVerifiedState(asMachine, 'another-org')).rejects.toThrow(/another org/);
  });
});
