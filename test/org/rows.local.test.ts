// The remote rows against desk-hub's Worker in Miniflare (P5 O8 M2, docs/doperpowers/plans/2026-10-28-p5-o8-org-
// interface.md, "Proves"; acceptance 2): an org rooted by O13's real `deployment admin`, the app's session registered
// through M1 (`pair --class native-mac` approving), and a real endpoint enrolled and listing a lane A and a lane B
// session in a project whose sminos id a local `remote:` checkout joins under the signed-in org. The rows arrive through
// the app's `?app=1` feed with R1's addresses, lanes, states, titles, owners and the joined org key; a new revision
// updates a state, a `private` report withdraws a row, and the machine dropped from the org state removes its rows.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { base64urlEncode, keyId, signOrgState, type SignedOrgState } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey } from 'desk-hub/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAdmin, type AdminIo } from '../../apps/desk-hub/deploy/admin.ts';
import { readAdminKeys, readText, volumeOf } from '../../apps/desk-hub/deploy/admin-device.ts';
import { successor } from '../../apps/desk-hub/deploy/org-admin.ts';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { loadDeviceKeys } from '../../src/main/device/keys';
import { createStepUp } from '../../src/main/device/step-up';
import { repoProjectId } from '../../src/main/index/org-project';
import { orgFiles } from '../../src/main/org/files';
import { createOrgSession, type OrgSessionService } from '../../src/main/org/org-session';
import { createRegistryFeed, type RegistryFeed } from '../../src/main/org/registry-feed';
import { createRemoteRows, type RemoteRows } from '../../src/main/org/rows';
import type { OrgRows } from '../../src/shared/ipc/schema/org';
import type { ProjectRecord } from '../../src/shared/ipc/schema/session';
import type { MachineRef } from '../../src/shared/machine/ref';
import { fakeServices, type FakeServices } from '../endpoint/fake-services';
import { ADMIN, ORG, startMiniflareHub, type LocalHub } from '../endpoint/miniflare-hub';

const REMOTE_KEY = 'github.com/ssfskim/o8-rows';
const scratch = mkdtempSync(join(tmpdir(), 'maws-o8-rows-'));
const dir = (name: string) => {
  const path = join(scratch, name);
  mkdirSync(path, { recursive: true });
  return path;
};
const adminKeys = join(dir('admin'), 'keys.json');
const profile = dir('profile');

let hub: LocalHub;
let stopHub: () => Promise<void>;
let endpoint: Endpoint | undefined;
let services: FakeServices | undefined;
let ref: MachineRef;
let member: string;
let session: OrgSessionService;
let feed: RegistryFeed;
let rows: RemoteRows;
let latest: OrgRows | null = null;
const logs: string[] = [];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until<T>(check: () => T | null | false | undefined | Promise<T | null | false | undefined>, what: string, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value !== null && value !== false && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(20);
  }
}

function adminIo(): { io: AdminIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: AdminIo = {
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    openTerminal: () => ({ write: () => {}, readLine: async () => '' }),
    secrets: async () => ({}),
    exec: async () => {},
    volumeOf,
    removableVolume: () => false,
    readText,
    placement: { home: join(scratch, 'home'), tmpRoots: [join(scratch, 'swept')] },
    env: {},
    appDir: join(import.meta.dirname, '../../apps/desk-hub'),
    sleep: (ms) => sleep(Math.min(ms, 50)),
    readStdin: async () => '',
    secretOut: async () => {
      throw new Error('no verb here writes a secret to stdout');
    },
    stdoutIsTerminal: false,
  };
  return { io, out, err };
}
const asLocal = () => ['--hub', hub.url, '--user', ADMIN, '--keys', adminKeys];
const served = async () => (await (await hub.fetchAs(ADMIN, '/api/org/state?since=0')).json()) as { head: SignedOrgState };
async function amend(edit: (state: SignedOrgState['state']) => void): Promise<void> {
  const keys = await readAdminKeys(adminKeys);
  const next = await signOrgState(await successor((await served()).head.state, edit), [keys.stepUp]);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: next });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
}

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
  ({ hub, stop: stopHub } = await startMiniflareHub());
  expect(await runAdmin(['init', '--keys', adminKeys], adminIo().io)).toBe(0);
  member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  expect(await runAdmin(['genesis', '--recovery', join(dir('volume'), 'recovery.json'), ...asLocal(), '--yes'], adminIo().io)).toBe(0);

  // The app's session, registered through M1 with `pair` approving.
  const pairing = adminIo();
  const running = runAdmin(['pair', '--class', 'native-mac', '--ttl', '60', ...asLocal(), '--yes'], pairing.io);
  const line = await until(() => pairing.out.find((l) => l.startsWith('pairing code: ')), 'the pairing code');
  session = createOrgSession({
    userData: profile,
    build: 'o8-m2-local',
    packaged: false,
    env: { MAWS_DEV_STANDIN_USER: ADMIN },
    openExternal: () => false,
    stepUp: (keys, device) => createStepUp({ device, key: keys.stepUp, confirm: async () => ({ ok: true }) }),
    loadKeys: (p) => loadDeviceKeys(p, { excludeFromBackup: async () => true }),
    excludeFromBackup: async () => true,
    timing: { APPROVAL_POLL_MS: 200 },
    log: (l) => void logs.push(l),
  });
  await session.loaded;
  expect(session.register(line.slice('pairing code: '.length))).toEqual({ ok: true });
  expect(await running).toBe(0);
  await until(() => session.current(), 'the app signed in');

  // A real endpoint, enrolled in the same org and owned by the member.
  services = fakeServices();
  endpoint = createEndpoint({ build: 'o8-m2-local', sleep: (ms) => sleep(Math.min(ms, 50)) });
  await endpoint.start(services);
  ref = services.machine.ref;
  const keys = await readAdminKeys(adminKeys);
  const head = (await served()).head;
  const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(keys.stepUp.pub)], recoveryPub: head.state.root.recoveryPub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolling = endpoint.cli('enroll', ['--name', 'o8-rows-mini', '--wait', '30', '--json'], code);
  const key = await until(async () => {
    const response = await hub.fetchAs(ADMIN, `/api/enrollments/${issued.enrollment.id}/key`);
    return response.status === 200 ? ((await response.json()) as EnrollmentKey) : (await response.body?.cancel(), null);
  }, 'the posted machine key');
  await amend((state) => {
    state.machines.push({ name: 'o8-rows-mini', ref, pub: key.pub, owners: [member] });
    state.machineNames.push({ name: 'o8-rows-mini', ref });
  });
  expect((await enrolling).code).toBe(0);
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
  await stopHub?.();
  rmSync(scratch, { recursive: true, force: true });
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
    const pub = (await served()).head.state.machines.find((m) => m.ref === ref)!.pub;
    const kid = await keyId(pub);
    await amend((state) => {
      state.machines = state.machines.filter((m) => m.ref !== ref);
      state.revoked.push({ keyId: kid, holder: { machine: ref } });
    });
    await until(() => (latest?.rows.length ?? -1) === 0, 'the machine’s rows gone');
  });
});
