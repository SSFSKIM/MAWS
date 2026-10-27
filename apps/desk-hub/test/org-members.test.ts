// The hub's projection of the org state (O11 M3; RL §5.2, §7.1): members are admitted by Access as the head lists
// them, by email, with the head's role; a member the head drops loses admission at once, and every socket the hub can
// close goes with it; each accepted state is announced to every project, retried, and taken as told by a project on
// the code before the announcement; and the device pairing exchange. (`access-sync` reading it: org-access-sync.test.ts.)
import { generateSigningKey, type OrgState, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PendingDevice } from '../src/protocol/identity';
import { enroll, MachineClient, waitFor } from './support/clients';
import { ADMIN, ORG, startLocalHub, credentials, type LocalHub, type Who } from './support/local';
import { endorsed, fakeMac, genesis, memberId, newDevice, next, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let A: string;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
/** A project the Registry holds (its id a uuid, so a browser's socket reaches it). */
const PROJECT = '0a1b2c3d-0000-4000-8000-000000000000';

beforeAll(async () => {
  hub = await startLocalHub();
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  await hub.addProjects(1, PROJECT.slice(0, -13));
  await hub.retryBase('registry', 50);
  head = await signedBy(await genesis(ORG, A, ADMIN, a1, recovery), a1);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
});
afterAll(() => hub?.close());

async function accept(state: OrgState, ...devices: TestDevice[]): Promise<SignedOrgState> {
  const s = await signedBy(state, ...devices);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  expect(response.status, await response.text()).toBe(201);
  head = s;
  return s;
}
const me = async (who: string) => {
  const response = await hub.fetchAs(who, '/api/me');
  return response.status === 200 ? ((await response.json()) as { member: { id: string; role: string; email: string } }).member : response.status;
};
const without = (id: string) => (s: OrgState) => void (s.members = s.members.filter((m) => m.id !== id));

/** A WebSocket as `who`, and how it closed (code and reason), once it does. */
async function socket(path: string, who: Who) {
  const ws = new WebSocket(`${hub.url.replace('http', 'ws')}${path}`, { headers: credentials(who) } as unknown as string[]);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => ws.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason })));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error(`${path} refused`)));
  });
  return { ws, closed, isOpen: () => ws.readyState === WebSocket.OPEN };
}

describe('a member', () => {
  const B = memberId();

  it('added by a successor is admitted with the head’s role; re-roled, the role follows', async () => {
    expect(await me('b@example.com')).toBe(403);
    await accept(await next(head, (s) => s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [] })), a1);
    expect(await me('b@example.com')).toMatchObject({ id: B, role: 'member' });
    expect((await hub.fetchAs('b@example.com', '/api/enrollments', { body: {} })).status).toBe(403);
    await accept(await next(head, (s) => (s.members.find((m) => m.id === B)!.role = 'admin')), a1);
    expect(await me('b@example.com')).toMatchObject({ id: B, role: 'admin' });
    expect((await hub.fetchAs('b@example.com', '/api/enrollments', { body: {} })).status).toBe(201);
  });

  it('whose email changes is admitted by the new email and refused by the old', async () => {
    await accept(await next(head, (s) => (s.members.find((m) => m.id === B)!.email = 'B.New@example.com')), a1);
    expect(await me('b.new@example.com')).toMatchObject({ id: B, email: 'b.new@example.com' });
    expect(await me('b@example.com')).toBe(403);
  });

  it('removed loses admission at once, and their project and registry sockets close 4403 removed', async () => {
    const grid = await socket('/api/registry/socket', 'b.new@example.com');
    const project = await socket(`/api/projects/${PROJECT}/socket`, 'b.new@example.com');
    const ownGrid = await socket('/api/registry/socket', ADMIN);
    const ownProject = await socket(`/api/projects/${PROJECT}/socket`, ADMIN);
    await accept(await next(head, without(B)), a1);
    expect(await me('b.new@example.com')).toBe(403);
    expect(await grid.closed).toEqual({ code: 4403, reason: 'removed' });
    expect(await project.closed).toEqual({ code: 4403, reason: 'removed' });
    expect(ownGrid.isOpen() && ownProject.isOpen()).toBe(true);
    ownGrid.ws.close();
    ownProject.ws.close();
  });

  it('removed while their project socket hibernates, still has it closed 4403 removed', async () => {
    const E = memberId();
    await accept(await next(head, (s) => s.members.push({ id: E, email: 'e@example.com', role: 'member', devices: [] })), a1);
    const project = await socket(`/api/projects/${PROJECT}/socket`, 'e@example.com');
    await hub.evict('Project', `${ORG}:${PROJECT}`, 'hibernate');
    await accept(await next(head, without(E)), a1);
    expect(await project.closed).toEqual({ code: 4403, reason: 'removed' });
  });

  it('admitted by the Worker just before a removal is refused at the object’s accept after it, until a state holds them again', async () => {
    const F = memberId();
    await accept(await next(head, (s) => s.members.push({ id: F, email: 'f@example.com', role: 'member', devices: [] })), a1);
    expect(await hub.socketUpgrade({ project: PROJECT }, F)).toBe(101);
    expect(await hub.socketUpgrade('registry', F)).toBe(101);
    await accept(await next(head, without(F)), a1);
    await waitFor(async () => ((await hub.stateFault(PROJECT)).announced === head.state.version ? true : undefined));
    expect(await hub.socketUpgrade({ project: PROJECT }, F)).toBe(403);
    expect(await hub.socketUpgrade('registry', F)).toBe(403);
    await accept(await next(head, (s) => s.members.push({ id: F, email: 'f@example.com', role: 'member', devices: [] })), a1);
    await waitFor(async () => ((await hub.stateFault(PROJECT)).announced === head.state.version ? true : undefined));
    expect(await hub.socketUpgrade({ project: PROJECT }, F)).toBe(101);
    await accept(await next(head, without(F)), a1);
  });

  it('removed before a project is first registered is refused there, though no state is accepted after it', async () => {
    const H = memberId();
    await accept(await next(head, (s) => s.members.push({ id: H, email: 'h@example.com', role: 'member', devices: [] })), a1);
    await accept(await next(head, without(H)), a1);
    // The project is registered after the removal was announced to every project then held.
    const fresh = '1c2d3e4f-0000-4000-8000-000000000000';
    const machine = new MachineClient(hub, 'registers', await enroll(hub, ADMIN, 'registers'));
    await machine.connect();
    await machine.sync(fresh);
    await waitFor(async () => ((await hub.stateFault(fresh)).announced === head.state.version ? true : undefined));
    expect(await hub.socketUpgrade({ project: fresh }, H)).toBe(403);
    expect(await hub.socketUpgrade({ project: fresh }, A)).toBe(101);
    await machine.close();
  });

  it('is projected with their devices by member and class, and machines by ref', async () => {
    const C = memberId();
    const c1 = await newDevice('c1');
    const phone = await endorsed(ORG, C, await newDevice('c-phone', 'web-cards'), c1);
    const mini = await generateSigningKey();
    await accept(
      await next(head, (s) => {
        s.members.push({ id: C, email: 'c@example.com', role: 'member', devices: [c1.device] });
        s.machines.push({ name: 'Mini', ref: 'mref-mini-0000001', pub: mini.pub, owners: [C] });
        s.machineNames.push({ name: 'Mini', ref: 'mref-mini-0000001' });
      }),
      a1,
    );
    await accept(await next(head, (s) => s.members.find((m) => m.id === C)!.devices.push(phone.device)), a1);
    const projection = await hub.projection();
    expect(projection.members.map((m) => [m.id, m.email, m.role]).sort()).toEqual(
      [
        [A, ADMIN, 'admin'],
        [C, 'c@example.com', 'member'],
      ].sort(),
    );
    expect(projection.devices).toEqual([
      { id: 'a1', member: A, class: 'native-mac', access_client_id: null },
      { id: 'c-phone', member: C, class: 'web-cards', access_client_id: null },
      { id: 'c1', member: C, class: 'native-mac', access_client_id: null },
    ]);
    expect(projection.machines).toEqual([{ ref: 'mref-mini-0000001', name: 'Mini', pub: mini.pub, owners: [C] }]);
  });
});

describe('each accepted state', () => {
  it('is announced to every project, and a failed announcement is sent again', async () => {
    await hub.stateFault(PROJECT, { times: 2 });
    await accept(await next(head, (s) => s.projects.push({ id: 'p-retried', name: 'Retried' })), a1);
    const fault = await waitFor(async () => {
      const f = await hub.stateFault(PROJECT);
      return f.calls >= 3 ? f : undefined;
    });
    expect(fault).toMatchObject({ remaining: 0, calls: 3 });
    expect(await hub.stateFault(PROJECT)).toMatchObject({ announced: head.state.version });
  });

  it('is taken as told by a project on the code before the announcement, which is not asked again', async () => {
    await hub.stateFault(PROJECT, { times: 5, missing: true });
    await accept(await next(head, (s) => s.projects.push({ id: 'p-old', name: 'Old code' })), a1);
    await waitFor(async () => ((await hub.stateFault(PROJECT)).calls >= 1 ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await hub.stateFault(PROJECT)).toMatchObject({ remaining: 4, calls: 1 });
    await hub.stateFault(PROJECT, { times: 0 });
  });

  it('that failed is sent again after the Registry resets, and the project refuses the removed member', async () => {
    const G = memberId();
    await accept(await next(head, (s) => s.members.push({ id: G, email: 'g@example.com', role: 'member', devices: [] })), a1);
    // The first retry waits long enough for the reset to come first: only what the Registry stored can send it.
    await hub.retryBase('registry', 2000);
    await hub.stateFault(PROJECT, { times: 1 });
    await accept(await next(head, without(G)), a1);
    await waitFor(async () => ((await hub.stateFault(PROJECT)).calls >= 1 ? true : undefined));
    await hub.restart();
    await waitFor(async () => ((await hub.stateFault(PROJECT)).announced === head.state.version ? true : undefined), 15_000);
    expect(await hub.socketUpgrade({ project: PROJECT }, G)).toBe(403);
    await hub.retryBase('registry', 50);
  });

  it('a missing method is recognized as workerd refuses it', async () => {
    expect(await hub.missingMethod()).toEqual({ lacks: true, message: expect.stringContaining('does not implement the method') });
  });
});

describe('the pairing exchange', () => {
  const D = memberId();
  let d1: TestDevice;
  let entry: Record<string, unknown>;

  beforeAll(async () => {
    d1 = await newDevice('d1');
    await accept(await next(head, (s) => s.members.push({ id: D, email: 'd@example.com', role: 'member', devices: [d1.device] })), a1);
  });

  const pending = async (who: string) => ((await (await hub.fetchAs(who, '/api/devices/pending')).json()) as { pending: PendingDevice[] }).pending;
  const post = (who: string, body: unknown) => hub.fetchAs(who, '/api/devices/pending', { body });

  it('lists a new device’s entry to the member’s devices, and to no one else', async () => {
    const d2 = await newDevice('d2');
    entry = { deviceId: 'd2', class: 'native-mac', keyStorage: 'software', channelPub: d2.device.channelPub, stepUpPub: d2.device.stepUpPub, mac: fakeMac() };
    const response = await post('d@example.com', entry);
    expect(response.status).toBe(201);
    const listed = await pending('d@example.com');
    expect(listed).toEqual([{ ...entry, member: D, created: expect.any(String), expires: expect.any(String) }]);
    expect(Date.parse(listed[0].expires) - Date.parse(listed[0].created)).toBe(600_000);
    expect(await pending(ADMIN)).toEqual([]);
  });

  it('refuses an entry that is not a device’s, and bounds a member’s entries', async () => {
    for (const bad of [{ ...entry, mac: 'short' }, { ...entry, channelPub: 'x' }, { ...entry, class: 'web-cards' }, { ...entry, extra: 1 }, { ...entry, deviceId: '' }]) {
      expect((await post('d@example.com', bad)).status).toBe(400);
    }
    for (let i = 0; i < 7; i++) expect((await post('d@example.com', { ...entry, deviceId: `more-${i}` })).status).toBe(201);
    expect((await post('d@example.com', { ...entry, deviceId: 'one-too-many' })).status).toBe(409);
    // Posting a listed entry again replaces it.
    expect((await post('d@example.com', { ...entry, mac: fakeMac() })).status).toBe(201);
  });

  it('expires after ten minutes', async () => {
    await hub.backdate({ pendingDevice: { member: D, device: 'more-0', expires: new Date(Date.now() - 1000).toISOString() } });
    expect((await pending('d@example.com')).map((p) => p.deviceId)).not.toContain('more-0');
  });

  it('drops the entry once a successor lists the device', async () => {
    const d2: TestDevice = { device: { id: 'd2', class: 'native-mac', keyStorage: 'software', channelPub: entry.channelPub as string, stepUpPub: entry.stepUpPub as string }, channel: d1.channel };
    const listedNow = async () => (await pending('d@example.com')).map((p) => p.deviceId);
    expect(await listedNow()).toContain('d2');
    const d2Endorsed = await endorsed(ORG, D, d2, d1);
    await accept(await next(head, (s) => s.members.find((m) => m.id === D)!.devices.push(d2Endorsed.device)), a1);
    expect(await listedNow()).not.toContain('d2');
  });
});
