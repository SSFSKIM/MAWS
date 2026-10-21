// The offline sweep of provisioning keys (docs/doperpowers/specs/2026-10-21-desk-provisioning-keys-design.md §4, M1):
// a machine enrolled through a key whose `offline_revoke_s` is set, offline that long in the Registry's view, is revoked
// by the Registry's alarm as an admin's revocation would revoke it. The Registry reads `Date.now()` and the offline time
// is an hour at least, so the suite moves `seen` back (`hub.backdate`) rather than wait. A suite of its own, on a hub of
// its own, so the alarm it reads is the one under test and no earlier test's: a key redemption's, then the sweep's.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { serviceTokenName } from '../src/protocol/identity';
import type { OrgFrame } from '../src/protocol/machine';
import { enroll, enrollThrough, MachineClient, provisioningKey, refusal, waitFor, type Credentials } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());
afterEach(() => {
  hub.faults.length = 0;
});

const HOUR = 3600;
const tokensNamed = (machine: string) => hub.standin.tokens().filter((t) => t.name === serviceTokenName(ORG, machine));
const isDelete = (request: Request) => request.method === 'DELETE';
const isCreate = (request: Request) => request.method === 'POST' && new URL(request.url).pathname.endsWith('/access/service_tokens');
const machines = async () => ((await (await hub.fetchAs(ADMIN, '/api/machines')).json()) as { machines: Array<{ name: string; state: string; client_id: string | null }> }).machines;
const listed = async (name: string) => (await machines()).find((m) => m.name === name);
const gone = (name: string, ms = 10_000) => waitFor(async () => ((await listed(name)) ? undefined : true), ms);
/** Until Access no longer holds the machine's service token. A revocation deletes the record first (the Worker refuses
 * the credential `403 not-enrolled` from then) and the token after, so a sweep's revocation, which the suite does not
 * await, can be seen gone from the list before Access refuses the credential itself (`401`). */
const tokenGone = (name: string) => waitFor(() => (tokensNamed(name).length === 0 ? true : undefined));
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const self = (creds: Credentials) => hub.fetchAs(creds, '/machine/enrollment');
let projects = 0;
const newProject = () => `5a7c0a8e-3b2d-4c5e-9f70-${(++projects).toString(16).padStart(12, '0')}`;
let seq = 0;
/** One project per machine, whose reports carry its lease. */
const leaseProjects = new Map<string, string>();
/** Puts a confirmed machine online or offline in the Registry's view, as its project's lease report does. */
function leased(name: string, creds: Credentials, online: boolean): Promise<OrgFrame> {
  if (!leaseProjects.has(name)) leaseProjects.set(name, newProject());
  return hub.report(leaseProjects.get(name)!, { machines: 1, machines_online: online ? 1 : 0, working: 0, waiting: 0, seq: ++seq, machines_state: [{ name, online, client: creds.clientId }] });
}
/** A machine enrolled through `token` and confirmed by its own record's request, its stream never opened. */
async function confirmed(token: string, name: string): Promise<Credentials> {
  const creds = await enrollThrough(hub, token, name);
  expect((await self(creds)).status).toBe(200);
  return creds;
}

describe('a redemption through a key', () => {
  it("installs its pending enrollment's alarm before the mint's API calls answer, so a reset meanwhile still expires it", async () => {
    const { token } = await provisioningKey(hub, ADMIN, { label: 'alarm', prefix: 'dc-' });
    // Nothing else is pending: the alarm, once cleared, is set again only by this redemption.
    await waitFor(async () => ((await hub.registryAlarm(true)) === null ? true : undefined));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    hub.faults.push((request) => {
      if (held || !isCreate(request)) return null;
      held = true;
      return gate.then(() => null);
    });
    const before = Date.now();
    const redeeming = hub.fetchAs(null, '/machine/enroll', { body: { token, machine: 'dc-alarm-1' } });
    await waitFor(() => (held ? true : undefined));
    const alarm = await hub.registryAlarm();
    release();
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeGreaterThanOrEqual(before + 900_000 - 1000);
    expect(alarm!).toBeLessThanOrEqual(Date.now() + 900_000);
    const answered = await redeeming;
    expect(answered.status).toBe(200);
    // Confirmed, so its expiry is no later test's concern.
    const body = (await answered.json()) as { client_id: string; client_secret: string };
    expect((await self({ clientId: body.client_id, clientSecret: body.client_secret })).status).toBe(200);
  });
});

describe('the offline sweep', () => {
  it("is scheduled when a key's machine goes offline, and revokes it once offline the key's time, as an admin's revocation would", async () => {
    const { token } = await provisioningKey(hub, ADMIN, { label: 'devcloud', prefix: 'dc-', offline_revoke_s: HOUR });
    const project = newProject();
    // A lease far longer than the test, so only the close's grace can put the machine offline.
    const machine = new MachineClient(hub, 'dc-gone-1', await enrollThrough(hub, token, 'dc-gone-1'));
    await hub.timing('dc-gone-1', { heartbeatMs: 200, leaseMs: 60_000, graceMs: 200 });
    await machine.connect();
    await machine.sync(project);
    // Nothing else is pending: the alarm, once cleared, is set again only by the flip offline.
    await waitFor(async () => ((await hub.registryAlarm(true)) === null ? true : undefined));
    const closed = Date.now();
    await machine.close();
    const alarm = await waitFor(async () => (await hub.registryAlarm()) ?? undefined, 10_000);
    expect(alarm).toBeGreaterThanOrEqual(closed + HOUR * 1000);
    expect(alarm).toBeLessThanOrEqual(Date.now() + HOUR * 1000);
    expect((await listed('dc-gone-1'))?.state).toBe('active');

    // An hour on (moved back), with its token's deletion failing: the alarm revokes it.
    hub.faults.push((request) => (isDelete(request) ? 'fail' : null));
    await hub.backdate({ machines: [{ name: 'dc-gone-1', seen: ago(HOUR + 1) }] });
    await gone('dc-gone-1');
    const directory = ((await (await hub.fetchAs(ADMIN, '/api/projects')).json()) as { projects: Array<{ name: string; kind: string; retired: boolean }> }).projects;
    expect(directory.find((p) => p.kind === 'machine' && p.name === 'dc-gone-1')?.retired).toBe(true);
    // Access still holds the token; the Worker refuses it.
    expect(tokensNamed('dc-gone-1')).toHaveLength(1);
    expect(await refusal(await self(machine.creds))).toBe('403 not-enrolled');
    // Once the API answers (the next redemption sweeps the orphan), Access refuses it before the Worker.
    hub.faults.length = 0;
    await enroll(hub, ADMIN, 'sweeper-1');
    await tokenGone('dc-gone-1');
    expect(await refusal(await self(machine.creds))).toBe('401 access');
  });

  it("revokes only a key's active machine offline past the key's time, its confirmation standing for a seen it never had", async () => {
    const swept = await provisioningKey(hub, ADMIN, { label: 'swept', prefix: 'dc-', offline_revoke_s: HOUR });
    const never = await provisioningKey(hub, ADMIN, { label: 'never', prefix: 'dc-' });
    const online = await confirmed(swept.token, 'dc-online-1');
    expect((await leased('dc-online-1', online, true)).machines.find((m) => m.name === 'dc-online-1')?.online).toBe(true);
    const nullKey = await confirmed(never.token, 'dc-null-1');
    await leased('dc-null-1', nullKey, true);
    expect((await leased('dc-null-1', nullKey, false)).machines.find((m) => m.name === 'dc-null-1')?.online).toBe(false);
    await confirmed(swept.token, 'dc-fresh-1'); // never seen, confirmed now: within the window
    await confirmed(swept.token, 'dc-stale-1'); // never seen, confirmed an hour ago (below)
    await enrollThrough(hub, swept.token, 'dc-pending-1'); // pending: its own 900 s end it, not the sweep
    // A one-time token's machine is no key's.
    const byToken = await enroll(hub, ADMIN, 'dc-token-1');
    expect((await self(byToken)).status).toBe(200);

    await hub.backdate({
      machines: [
        { name: 'dc-online-1', seen: ago(2 * HOUR) },
        { name: 'dc-null-1', seen: ago(2 * HOUR) },
        { name: 'dc-stale-1', confirmed: ago(HOUR + 1) },
        { name: 'dc-pending-1', seen: ago(2 * HOUR) },
        { name: 'dc-token-1', confirmed: ago(2 * HOUR) },
      ],
    });
    await gone('dc-stale-1');
    const left = await machines();
    for (const name of ['dc-online-1', 'dc-null-1', 'dc-fresh-1', 'dc-pending-1', 'dc-token-1']) expect(left.map((m) => m.name)).toContain(name);
  });

  it("binds each candidate to the enrollment it read: a later candidate's name revoked and enrolled anew meanwhile is left be", async () => {
    const { token } = await provisioningKey(hub, ADMIN, { label: 'race', prefix: 'dc-', offline_revoke_s: HOUR });
    const first = await confirmed(token, 'dc-race-a');
    await confirmed(token, 'dc-race-b');
    // The first candidate's revocation waits at its Machine object while the second's name changes hands.
    await hub.faultNextRevoke('dc-race-a', 'hold');
    await hub.backdate({ machines: [{ name: 'dc-race-a', confirmed: ago(2 * HOUR) }, { name: 'dc-race-b', confirmed: ago(2 * HOUR) }] });
    await waitFor(async () => ((await hub.revokeHeld('dc-race-a')) ? true : undefined), 10_000);
    expect((await hub.fetchAs(ADMIN, '/api/machines/dc-race-b', { method: 'DELETE' })).status).toBe(200);
    const replacement = new MachineClient(hub, 'dc-race-b', await enrollThrough(hub, token, 'dc-race-b'));
    await replacement.connect();

    await hub.releaseRevoke('dc-race-a');
    await gone('dc-race-a');
    await tokenGone('dc-race-a');
    expect(await refusal(await self(first))).toBe('401 access');
    expect(await listed('dc-race-b')).toMatchObject({ state: 'active', client_id: replacement.creds.clientId });
    expect(tokensNamed('dc-race-b').map((t) => t.client_id)).toEqual([replacement.creds.clientId]);
    expect(replacement.isEnded).toBe(false);
    await replacement.close();
  });

  it("does not spare a candidate whose lease report arrives after the sweep read it: the fence is placed", async () => {
    const { token } = await provisioningKey(hub, ADMIN, { label: 'late', prefix: 'dc-', offline_revoke_s: HOUR });
    const creds = await confirmed(token, 'dc-late-1');
    await hub.faultNextRevoke('dc-late-1', 'hold');
    await hub.backdate({ machines: [{ name: 'dc-late-1', confirmed: ago(2 * HOUR) }] });
    await waitFor(async () => ((await hub.revokeHeld('dc-late-1')) ? true : undefined), 10_000);
    // Back in the same second: a project reports its fresh lease.
    expect((await leased('dc-late-1', creds, true)).machines.find((m) => m.name === 'dc-late-1')?.online).toBe(true);
    await hub.releaseRevoke('dc-late-1');
    await gone('dc-late-1');
    await tokenGone('dc-late-1');
    expect(await refusal(await self(creds))).toBe('401 access');
  });

  it('waits a minute before trying a failed revocation again, though a redemption sweeps meanwhile', async () => {
    const { token } = await provisioningKey(hub, ADMIN, { label: 'retry', prefix: 'dc-', offline_revoke_s: HOUR });
    await confirmed(token, 'dc-retry-1');
    hub.expectRuntimeLog(/a revocation answer the suite lost/);
    await hub.faultNextRevoke('dc-retry-1', 'lose');
    await hub.backdate({ machines: [{ name: 'dc-retry-1', confirmed: ago(2 * HOUR) }] });
    await waitFor(() => (hub.runtimeLogs.some((l) => l.message.includes('"desk":"offline-revoke"') && l.message.includes('dc-retry-1')) ? true : undefined), 10_000);
    const failed = Date.now();
    // A redemption runs the sweep; within the minute the failed candidate is not tried again.
    await enroll(hub, ADMIN, 'retry-sweeper-1');
    expect(await listed('dc-retry-1')).toMatchObject({ state: 'active' });
    // Its alarm waits for the retry rather than spinning.
    expect(await hub.registryAlarm()).toBeGreaterThan(failed + 30_000);
  });

  it('completes a revocation whose fence was placed, though the machine reads online again before the retry', async () => {
    const { token } = await provisioningKey(hub, ADMIN, { label: 'fenced', prefix: 'dc-', offline_revoke_s: HOUR });
    const creds = await confirmed(token, 'dc-fenced-1');
    hub.expectRuntimeLog(/a revocation answer the suite lost/);
    // The sweep fences the credential at its Machine object, and the object's answer is lost.
    await hub.faultNextRevoke('dc-fenced-1', 'lose');
    await hub.backdate({ machines: [{ name: 'dc-fenced-1', confirmed: ago(2 * HOUR) }] });
    await waitFor(() => (hub.runtimeLogs.some((l) => l.message.includes('"desk":"offline-revoke"') && l.message.includes('dc-fenced-1')) ? true : undefined), 10_000);
    expect(await listed('dc-fenced-1')).toMatchObject({ state: 'active' });
    // A reconnect's lease report, in flight when the fence was placed, arrives: the machine reads online.
    expect((await leased('dc-fenced-1', creds, true)).machines.find((m) => m.name === 'dc-fenced-1')?.online).toBe(true);
    // The retry comes due (shortened from the minute) and completes the revocation all the same.
    await hub.offlineRetry(0);
    try {
      await gone('dc-fenced-1');
    } finally {
      await hub.offlineRetry(null);
    }
    await tokenGone('dc-fenced-1');
    expect(await refusal(await self(creds))).toBe('401 access');
  });

  it("does not retry a candidate from a stale list: one a concurrent sweep failed meanwhile waits its minute", async () => {
    const { token } = await provisioningKey(hub, ADMIN, { label: 'pair', prefix: 'dc-', offline_revoke_s: HOUR });
    await confirmed(token, 'dc-pair-a');
    await confirmed(token, 'dc-pair-b');
    hub.expectRuntimeLog(/a revocation answer the suite lost/);
    // The alarm's sweep lists both and waits on the first; a redemption's sweep meanwhile skips the first and fails the second.
    await hub.faultNextRevoke('dc-pair-a', 'hold');
    await hub.faultNextRevoke('dc-pair-b', 'lose');
    await hub.backdate({ machines: [{ name: 'dc-pair-a', confirmed: ago(2 * HOUR) }, { name: 'dc-pair-b', confirmed: ago(2 * HOUR) }] });
    await waitFor(async () => ((await hub.revokeHeld('dc-pair-a')) ? true : undefined), 10_000);
    await enroll(hub, ADMIN, 'pair-sweeper-1');
    expect(hub.runtimeLogs.some((l) => l.message.includes('"desk":"offline-revoke"') && l.message.includes('dc-pair-b'))).toBe(true);
    // The first sweep resumes: it completes the first, and leaves the second to its retry a minute on.
    await hub.releaseRevoke('dc-pair-a');
    await gone('dc-pair-a');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await listed('dc-pair-b')).toMatchObject({ state: 'active' });
  });
});
