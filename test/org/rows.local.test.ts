// The remote rows against desk-hub's Worker in Miniflare (P5 O8 M2, docs/doperpowers/plans/2026-10-28-p5-o8-org-
// interface.md, "Proves"; acceptance 2): an org rooted by O13's real `deployment admin`, the app's session registered
// through M1 (`pair --class native-mac` approving), and a real endpoint enrolled and listing a lane A and a lane B
// session in a project whose sminos id a local `remote:` checkout joins under the signed-in org. The rows arrive through
// the app's `?app=1` feed with R1's addresses, lanes, states, titles, owners and the joined org key; a new revision
// updates a state, a `private` report withdraws a row, and the machine dropped from the org state removes its rows.
import { rmSync } from 'node:fs';
import { keyId } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { repoProjectId } from '../../src/shared/machine/project-ids';
import { orgFiles } from '../../src/main/org/files';
import type { OrgSessionService } from '../../src/main/org/org-session';
import { createRegistryFeed, type RegistryFeed } from '../../src/main/org/registry-feed';
import { createRemoteRows, type RemoteRows } from '../../src/main/org/rows';
import type { OrgRows } from '../../src/shared/ipc/schema/org';
import type { ProjectRecord } from '../../src/shared/ipc/schema/session';
import type { MachineRef } from '../../src/shared/machine/ref';
import { fakeServices, type FakeServices } from '../endpoint/fake-services';
import { ORG, enrollEndpoint, orgSession, registerThroughPair, scratchDir, sleep, startLocalOrg, until, type LocalOrg } from './local-org';

const REMOTE_KEY = 'github.com/ssfskim/o8-rows';
const scratch = scratchDir('maws-o8-rows-');
const profile = scratch.dir('profile');

let org: LocalOrg;
let endpoint: Endpoint | undefined;
let services: FakeServices | undefined;
let ref: MachineRef;
let member: string;
let session: OrgSessionService;
let feed: RegistryFeed;
let rows: RemoteRows;
let latest: OrgRows | null = null;
const logs: string[] = [];

/** A local checkout whose `remote:` key the listings' project joins by the signed-in org. */
const checkout: ProjectRecord = {
  id: 'p-rows' as ProjectRecord['id'],
  name: 'o8-rows',
  directory: '/work/o8-rows',
  order: 0,
  createdAt: new Date(0).toISOString(),
  org: { key: `remote:${REMOTE_KEY}` as NonNullable<ProjectRecord['org']>['key'], name: 'o8-rows', source: 'remote', smnsId: null },
};
const project = repoProjectId(ORG, REMOTE_KEY);
const rowOf = (session: string) => latest?.rows.find((r) => r.session === session);

beforeAll(async () => {
  org = await startLocalOrg(scratch);
  member = org.member;

  // The app's session, registered through M1 with `pair` approving.
  session = orgSession({ userData: profile, build: 'o8-m2-local', log: (l) => void logs.push(l) });
  await registerThroughPair(org, session);

  // A real endpoint, enrolled in the same org and owned by the member.
  services = fakeServices();
  endpoint = createEndpoint({ build: 'o8-m2-local', sleep: (ms) => sleep(Math.min(ms, 50)) });
  await endpoint.start(services);
  ref = services.machine.ref;
  await enrollEndpoint(org, endpoint, ref, 'o8-rows-mini');
  await until(() => endpoint!.hub.connected, 'the endpoint’s hub link');
  endpoint.hub.openProject(project, { hello: () => ({ name: 'o8-rows', have: {} }), down: () => {} });

  // The app's feed and rows, the roster being the endpoint's machine (O7's roster in production).
  feed = createRegistryFeed({ session, log: (l) => void logs.push(l) });
  session.attach(feed);
  rows = createRemoteRows({
    session,
    feed,
    roster: () => [ref],
    onRoster: () => () => {},
    localProjects: async () => [checkout],
    onLocalProjects: () => () => {},
    files: orgFiles({ userData: profile, log: (l) => void logs.push(l) }),
    emit: (next) => void (latest = next),
    log: (l) => void logs.push(l),
  });
}, 120_000);

afterAll(async () => {
  await rows?.close();
  feed?.close();
  await session?.close();
  await endpoint?.stop();
  services?.cleanup();
  await org?.stop();
  rmSync(scratch.root, { recursive: true, force: true });
});

describe('the remote rows on the local hub', { timeout: 120_000 }, () => {
  const laneA = crypto.randomUUID();
  const laneB = 'app-o8-rows';

  it('draws a real endpoint’s lane A and lane B listings as rows with R1’s addresses, joined to the local checkout', async () => {
    await endpoint!.listings.report({ session: laneA, project, lane: 'A', state: 'busy', title: 'Fix the build', owners: ['@machine'] });
    await endpoint!.listings.report({ session: laneB, project, lane: 'B', state: 'waiting', title: 'Review the plan', owners: ['@machine'] });
    await until(() => rowOf(laneA) && rowOf(laneB) && latest!.complete, 'both rows, the snapshot complete');
    expect(latest!.machines).toEqual([ref]);
    expect(latest!.pending).toEqual([]);
    expect(rowOf(laneA)).toMatchObject({ machine: ref, session: laneA, lane: 'A', state: 'busy', title: 'Fix the build', owners: [member], project, orgKey: `remote:${REMOTE_KEY}`, availability: 'foreign_held', mine: true });
    expect(rowOf(laneB)).toMatchObject({ machine: ref, session: laneB, lane: 'B', state: 'waiting', title: 'Review the plan', owners: [member], project, orgKey: `remote:${REMOTE_KEY}`, availability: null, mine: true });
  });

  it('follows a new revision’s state', async () => {
    const before = rowOf(laneA)!.revision;
    await endpoint!.listings.report({ session: laneA, project, lane: 'A', state: 'idle', title: 'Fix the build', owners: ['@machine'] });
    await until(() => rowOf(laneA)?.state === 'idle', 'the new state');
    expect(rowOf(laneA)!.revision).toBeGreaterThan(before);
  });

  it('withdraws a row its session made private', async () => {
    await endpoint!.listings.report({ session: laneB, project, lane: 'B', state: 'waiting', title: 'Review the plan', owners: ['@machine'], access: 'private' });
    await until(() => rowOf(laneB) === undefined, 'the withdrawn row gone');
    expect(rowOf(laneA)).toBeDefined();
  });

  it('removes the rows of a machine the org drops', async () => {
    const pub = (await org.served()).head.state.machines.find((m) => m.ref === ref)!.pub;
    const kid = await keyId(pub);
    await org.amend((state) => {
      state.machines = state.machines.filter((m) => m.ref !== ref);
      state.revoked.push({ keyId: kid, holder: { machine: ref } });
    });
    await until(() => (latest?.rows.length ?? -1) === 0, 'the machine’s rows gone');
  });
});
