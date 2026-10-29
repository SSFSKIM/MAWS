// The endpoint following an org recovery through the hub itself (O10 M2's sync; O8 M3 task 7's case on the machine's
// side): desk-hub's Worker in Miniflare (miniflare-hub.ts), an endpoint enrolled and listed in a throwaway org. An admin
// delivers a state straight to the endpoint (`mawsd endpoint revoke`), which the hub never has; the hub's line then goes
// on from the version before it with a state of its own at the same version, a sibling of the endpoint's head. Under a
// transition the org's recovery key signed from the hub's head, that sibling is the recovered line's first state, and
// the hub's state notice brings the endpoint onto it; with none behind it, it is a fork, and the endpoint keeps its head.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { base64urlEncode, generateSigningKey, keyId, stateHash, type OrgState, type SignedOrgState, type SigningKey } from 'org-protocol';
import { encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey } from 'desk-hub/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { fakeServices, type FakeServices } from './fake-services';
import { ADMIN, ORG, startMiniflareHub, type LocalHub } from './miniflare-hub';
import { genesis, newDevice, successor, transition, type TestDevice } from './org-fixtures';

let hub: LocalHub;
let stopHub: () => Promise<void>;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
const started: Array<{ endpoint: Endpoint; services: FakeServices }> = [];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `check` every 25 ms until it answers truthy, or fails after `ms` naming `what`. */
async function until<T>(check: () => T | Promise<T>, what: string, ms = 15_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await check();
    if (found) return found as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(25);
  }
}

/** Posts `next` to the hub as the admin's app does: the hub's head from then on. */
async function post(next: SignedOrgState): Promise<void> {
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: next });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = next;
}

const accept = async (edit: (s: OrgState) => void) => post(await successor(head, [a1], edit));

beforeAll(async () => {
  ({ hub, stop: stopHub } = await startMiniflareHub());
  const A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  head = await genesis(ORG, A, a1, recovery);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
}, 120_000);

afterAll(async () => {
  for (const { endpoint, services } of started) {
    await endpoint.stop();
    services.cleanup();
  }
  await stopHub?.();
});

/** A started endpoint, enrolled through its command line and listed by the admin, at the hub's head with its link up. */
async function listedEndpoint(name: string): Promise<{ endpoint: Endpoint; services: FakeServices }> {
  const services = fakeServices();
  const endpoint = createEndpoint({ build: 'o10-recovery-sibling', sleep: (ms) => sleep(Math.min(ms, 50)) });
  await endpoint.start(services);
  started.push({ endpoint, services });
  const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(a1.stepUp.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolling = endpoint.cli('enroll', ['--name', name, '--wait', '30', '--json'], code);
  const key = await until(async () => {
    const response = await hub.fetchAs(ADMIN, `/api/enrollments/${issued.enrollment.id}/key`);
    return response.status === 200 ? ((await response.json()) as EnrollmentKey) : (await response.body?.cancel(), null);
  }, 'the posted key');
  await accept((s) => {
    s.machines.push({ name, ref: services.machine.ref, pub: key.pub, owners: [s.members[0].id] });
    s.machineNames.push({ name, ref: services.machine.ref });
  });
  expect((await enrolling).code).toBe(0);
  await until(() => endpoint.hub.connected && endpoint.status().stateVersion === head.state.version, 'the hub link’s welcome at the hub’s head');
  return { endpoint, services };
}

const hashOf = async (s: SignedOrgState) => stateHash(s.state);

/** A state an admin delivers straight to the endpoint, after the hub's head: the hub never holds it. */
async function delivered(endpoint: Endpoint): Promise<SignedOrgState> {
  const direct = await successor(head, [a1], (s) => void s.projects.push({ id: crypto.randomUUID(), name: 'delivered' }));
  const result = await endpoint.cli('revoke', ['-'], JSON.stringify(direct));
  expect(result, result.out).toMatchObject({ code: 0, out: `adopted: the org state is at version ${direct.state.version}` });
  // The status's hash follows an adoption a moment after it.
  await until(async () => endpoint.status().headHash === (await hashOf(direct)), 'the delivered state in the status');
  return direct;
}

const orgFile = (services: FakeServices) => JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'org.json'), 'utf8')) as { head: SignedOrgState; highWater: number; acceptedTransitions: unknown[] };
const forks = (services: FakeServices) => services.lines.filter((line) => line.startsWith('endpoint: org state refused: fork'));

describe('a state of the hub’s at the endpoint’s head version', () => {
  it('with no recovery behind it, is a fork: the endpoint keeps its head and its status, and logs the fork', async () => {
    const { endpoint, services } = await listedEndpoint('recsib-fork');
    const direct = await delivered(endpoint);
    const before = endpoint.status();
    expect(before.stateVersion).toBe(direct.state.version);
    const onDisk = fs.readFileSync(join(services.machine.stateDir, 'org.json'), 'utf8');

    const sibling = await successor(head, [a1], (s) => void s.projects.push({ id: crypto.randomUUID(), name: 'the hub’s' }));
    await post(sibling);
    // The hub's notice at the endpoint's head version has it read the hub.
    await until(() => forks(services).length > 0, 'the fork refused', 5000);
    expect(forks(services)[0]).toBe(`endpoint: org state refused: fork (the hub's head at version ${sibling.state.version} is not the endpoint's)`);
    const after = endpoint.status();
    expect({ stateVersion: after.stateVersion, headHash: after.headHash, refusing: after.refusing, enrollment: after.enrollment }).toEqual({ stateVersion: before.stateVersion, headHash: before.headHash, refusing: undefined, enrollment: 'org-listed' });
    expect(fs.readFileSync(join(services.machine.stateDir, 'org.json'), 'utf8')).toBe(onDisk);
  });

  it('under a recovery from the hub’s head, is the recovered line’s first state: the endpoint takes it from its base on the hub’s notice', async () => {
    const { endpoint, services } = await listedEndpoint('recsib-recovered');
    const base = head;
    const direct = await delivered(endpoint);
    // The recovery: a transition the recovery key signs from the hub's head, the same root going on, and the hub's own
    // state at the delivered one's version.
    const t = await transition(ORG, base.state.version, [a1], recovery);
    const posted = await hub.fetchAs(ADMIN, '/api/org/transitions', { body: t });
    expect(posted.status, await posted.clone().text()).toBe(201);
    const sibling = await successor(base, [a1], (s) => void s.projects.push({ id: crypto.randomUUID(), name: 'recovered' }));
    expect(sibling.state.version).toBe(direct.state.version);
    await post(sibling);

    await until(async () => endpoint.status().headHash === (await hashOf(sibling)), 'the recovered line adopted', 5000);
    expect(endpoint.status()).toMatchObject({ stateVersion: sibling.state.version, enrollment: 'org-listed' });
    expect(orgFile(services)).toMatchObject({ head: sibling, highWater: sibling.state.version, acceptedTransitions: expect.arrayContaining([t.body]) as unknown[] });
    expect(forks(services)).toEqual([]);
    // The line goes on from there as any other.
    await accept(() => {});
    await until(async () => endpoint.status().headHash === (await hashOf(head)), 'the recovered line’s successor', 5000);
    expect(forks(services)).toEqual([]);
  });
});
