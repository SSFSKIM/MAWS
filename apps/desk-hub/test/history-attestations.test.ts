// History re-attestation at the hub (O14 M4, Interfaces §D): the inventory of a machine's phase-1 writers across the
// org's projects, a writer's events read as the machine, and the attestations each project keeps beside its log, newest
// per writer, after a courtesy check of their signer and binding (RL §5.5: machines and apps verify for themselves).
import { base64urlEncode, generateSigningKey, historyDigest, keyId, signRecord, SIGNING_DOMAINS, verifyHistoryAttestation, type HistoryAttestation, type HistoryAttestations, type HistoryInventory, type HistoryLogPage, type Signed, type SignedOrgState, type SigningKey, type StoredEvent } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrollV2, machineFetch, type V2Machine } from '../fake-machine/org';
import { newNonce } from '../src/protocol/codes';
import { encodeEnrollmentCodeV2, type OrgStateView } from '../src/protocol/identity';
import type { LogEvent } from '../src/protocol/log';
import { enroll, MachineClient, refusal } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { genesis, newDevice, next, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
let a1: TestDevice;
let recovery: SigningKey;
let A: string;
let head: SignedOrgState;
let mini: V2Machine;
let studio: V2Machine;
let oldmini: MachineClient;

const P1 = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const P2 = '2f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const P3 = '3f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const UNKNOWN = '9f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const S = 'e0ad139c-18bc-45bd-9489-be8653145f80';

/** A phase-1 `say`, with a code the hub carries and never checks. */
const say = (machine: string, seq: number, session = S): LogEvent => ({
  ts: `2026-10-15T08:00:${String(seq).padStart(2, '0')}.000Z`,
  writer: `${machine}/${session}`,
  seq,
  kind: 'say',
  from: machine,
  to: '*',
  text: `${machine} says ${seq}`,
  mac: { nonce: newNonce(), value: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) },
});

/** A DX2 machine that writes `counts[project]` events into each project, as phase 1 did. */
async function phaseOne(name: string, counts: Record<string, number>): Promise<MachineClient> {
  const client = new MachineClient(hub, name, await enroll(hub, ADMIN, name));
  await client.connect();
  for (const [project, n] of Object.entries(counts)) {
    await client.sync(project, `project ${project.slice(0, 1)}`);
    await client.postOk([{ t: 'events', project, events: Array.from({ length: n }, (_, i) => say(name, i + 1)) }]);
  }
  return client;
}

async function accept(edit: Parameters<typeof next>[1]): Promise<void> {
  const s = await signedBy(await next(head, edit), a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: s });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = s;
}

/** A v2 machine enrolled (re-enrolled in place for a held name) and listed in the head. */
async function listed(name: string, replace = false): Promise<V2Machine> {
  const issued = await hub.fetchAs(ADMIN, '/api/enrollments', { body: replace ? { machine: name } : {} });
  const { token } = (await issued.json()) as { token: string };
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token, roots: [await keyId(a1.stepUp!.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const machine = await enrollV2(code, name);
  await accept((s) => {
    s.machines.push({ name, ref: machine.ref, pub: machine.key.pub, owners: [A] });
    s.machineNames.push({ name, ref: machine.ref });
  });
  return machine;
}

const inventory = async (names: string, who: V2Machine = mini) => machineFetch(hub.url, who.credentials, `/machine/history-inventory?names=${names}`);
const page = async (project: string, writer: string, after: number) => machineFetch(hub.url, mini.credentials, `/machine/projects/${project}/log?writer=${encodeURIComponent(writer)}&after=${after}`);
const events = async (project: string, writer: string): Promise<StoredEvent[]> => ((await (await page(project, writer, 0)).json()) as HistoryLogPage).events;

async function attestation(signer: { key: SigningKey }, project: string, writer: string, names: string[], over: Partial<HistoryAttestation> = {}): Promise<Signed<HistoryAttestation>> {
  const held = await events(project, writer);
  const upTo = over.upTo ?? held.length;
  const body: HistoryAttestation = { org: ORG, project, writer, names, upTo, digest: await historyDigest(held.slice(0, upTo)), created: new Date().toISOString(), ...over };
  return signRecord(SIGNING_DOMAINS.historyAttest, body, signer.key.privateKey, signer.key.pub);
}
const post = (project: string, record: unknown) => machineFetch(hub.url, mini.credentials, `/machine/projects/${project}/attestations`, { record });

beforeAll(async () => {
  hub = await startLocalHub();
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  head = await signedBy(await genesis(ORG, A, ADMIN, a1, recovery), a1);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
  // Phase 1: `mini` and `oldmini` (the same Mac before a rename) and `other` write their projects on DX2.
  const dx2Mini = await phaseOne('mini', { [P1]: 3 });
  await dx2Mini.close();
  oldmini = await phaseOne('oldmini', { [P1]: 2, [P2]: 1 });
  const other = await phaseOne('other', { [P1]: 1, [P3]: 2 });
  await other.close();
  // The cutover: `mini` re-enrolled in place with its own key, and listed; `studio`, another machine, listed too.
  mini = await listed('mini', true);
  studio = await listed('studio');
}, 120_000);
afterAll(async () => {
  await oldmini?.close();
  await hub?.close();
});

describe('the inventory', () => {
  it('names every project whose log holds a DX1 writer under the names, with its highest DX1 seq, and nothing else', async () => {
    const response = await inventory('mini,oldmini');
    expect(response.status).toBe(200);
    const { projects } = (await response.json()) as HistoryInventory;
    const byId = Object.fromEntries(projects.map((p) => [p.id, p.writers]));
    expect(Object.keys(byId).sort()).toEqual([P1, P2]);
    expect(byId[P1]).toEqual([
      { writer: `mini/${S}`, upTo: 3 },
      { writer: `oldmini/${S}`, upTo: 2 },
    ]);
    expect(byId[P2]).toEqual([{ writer: `oldmini/${S}`, upTo: 1 }]);
    // Names compare without case, as machine names do.
    expect(((await (await inventory('MINI')).json()) as HistoryInventory).projects).toEqual([{ id: P1, writers: [{ writer: `mini/${S}`, upTo: 3 }] }]);
    expect(((await (await inventory('nobody')).json()) as HistoryInventory).projects).toEqual([]);
  });

  it('refuses names that are not machine names, and too many of them', async () => {
    for (const names of ['', 'hub', 'mini,,oldmini', 'a/b', Array.from({ length: 33 }, (_, i) => `m${i}`).join(',')]) {
      expect(await refusal(await inventory(names)), names).toBe('400 bad-shape');
    }
    expect(await refusal(await machineFetch(hub.url, mini.credentials, '/machine/history-inventory'))).toBe('400 bad-shape');
  });
});

describe('a writer’s log, read as the machine', () => {
  it('pages a writer’s stored events in seq order after a seq', async () => {
    const all = (await (await page(P1, `mini/${S}`, 0)).json()) as HistoryLogPage;
    expect(all.more).toBe(false);
    expect(all.events.map((e) => [e.writer, e.seq])).toEqual([1, 2, 3].map((seq) => [`mini/${S}`, seq]));
    expect(((await (await page(P1, `mini/${S}`, 2)).json()) as HistoryLogPage).events.map((e) => e.seq)).toEqual([3]);
    expect(((await (await page(P1, `nobody/${S}`, 0)).json()) as HistoryLogPage)).toEqual({ events: [], more: false });
  });

  it('refuses an unknown project and a malformed query', async () => {
    expect(await refusal(await page(UNKNOWN, `mini/${S}`, 0))).toBe('404 unknown-project');
    expect(await refusal(await page(P1, '', 0))).toBe('400 bad-shape');
    expect(await refusal(await page(P1, `mini/${S}`, -1))).toBe('400 bad-shape');
    expect(await refusal(await machineFetch(hub.url, mini.credentials, `/machine/projects/${P1}/log?writer=mini/${S}&after=x`))).toBe('400 bad-shape');
  });
});

describe('the attestations', () => {
  let own: Signed<HistoryAttestation>;

  it('keeps a record the head’s machine key signed for its own writer, and answers a repeat as held', async () => {
    own = await attestation(mini, P1, `mini/${S}`, ['mini']);
    expect((await post(P1, own)).status).toBe(201);
    expect((await post(P1, own)).status).toBe(200);
  });

  it('keeps a record for a former name the machine claims, which no state gives another ref', async () => {
    const former = await attestation(mini, P1, `oldmini/${S}`, ['mini', 'oldmini']);
    expect((await post(P1, former)).status).toBe(201);
  });

  it('serves them to members and machines, and each verifies against the events the hub serves', async () => {
    const member = (await (await hub.fetchAs(ADMIN, `/api/projects/${P1}/attestations`)).json()) as HistoryAttestations;
    const machine = (await (await machineFetch(hub.url, studio.credentials, `/machine/projects/${P1}/attestations`)).json()) as HistoryAttestations;
    expect(machine).toEqual(member);
    expect(member.records.map((r) => [r.body.writer, r.body.upTo])).toEqual([
      [`mini/${S}`, 3],
      [`oldmini/${S}`, 2],
    ]);
    const view = (await (await hub.fetchAs(ADMIN, '/api/org/state')).json()) as OrgStateView;
    for (const record of member.records) {
      expect(await verifyHistoryAttestation(record, await events(P1, record.body.writer), view.head!.state, view.certificates, { project: P1, writer: record.body.writer })).toEqual({ ok: true, by: { ref: mini.ref, name: 'mini' } });
    }
    expect(((await (await hub.fetchAs(ADMIN, `/api/projects/${P2}/attestations`)).json()) as HistoryAttestations).records).toEqual([]);
    expect(await refusal(await hub.fetchAs(ADMIN, `/api/projects/${UNKNOWN}/attestations`))).toBe('404 unknown-project');
  });

  it('replaces a writer’s record by one at a higher upTo, and refuses a lower one', async () => {
    await oldmini.postOk([{ t: 'events', project: P1, events: [say('oldmini', 3)] }]);
    const further = await attestation(mini, P1, `oldmini/${S}`, ['mini', 'oldmini']);
    expect(further.body.upTo).toBe(3);
    expect((await post(P1, further)).status).toBe(201);
    const behind = await attestation(mini, P1, `oldmini/${S}`, ['mini', 'oldmini'], { upTo: 2 });
    expect(await refusal(await post(P1, behind))).toBe('409 stale-attestation');
    // Another record at the same upTo doesn't replace one that verifies: the first at an upTo stands.
    expect(await refusal(await post(P1, await attestation(mini, P1, `oldmini/${S}`, ['mini', 'oldmini'])))).toBe('409 stale-attestation');
    const kept = (await (await hub.fetchAs(ADMIN, `/api/projects/${P1}/attestations`)).json()) as HistoryAttestations;
    expect(kept.records.find((r) => r.body.writer === `oldmini/${S}`)).toEqual(further);
  });

  it('refuses a record that does not verify, a name another ref owns, and a body that is not a record for the project', async () => {
    const stranger = { key: await generateSigningKey() };
    expect(await refusal(await post(P1, await attestation(stranger, P1, `mini/${S}`, ['mini'])))).toBe('403 bad-signature');
    expect(await refusal(await post(P1, { body: { ...own.body, upTo: 2 }, sig: own.sig }))).toBe('403 bad-signature');
    // `studio` is listed under another ref: mini can't claim its writers.
    const studioClaim = await signRecord(SIGNING_DOMAINS.historyAttest, { ...own.body, writer: `studio/${S}`, names: ['mini', 'studio'] }, mini.key.privateKey, mini.key.pub);
    expect(await refusal(await post(P1, studioClaim))).toBe('403 not-bound');
    expect(await refusal(await post(P2, own))).toBe('400 bad-shape');
    expect(await refusal(await post(P1, { record: 'no' }))).toBe('400 bad-shape');
    expect(await refusal(await machineFetch(hub.url, mini.credentials, `/machine/projects/${P1}/attestations`, 'not json'))).toBe('400 bad-shape');
    expect(await refusal(await post(UNKNOWN, own))).toBe('404 unknown-project');
    expect(await keyId(studio.key.pub)).not.toBe(own.sig.kid);
  });
});

describe('a machine whose key was revoked since it attested', () => {
  it('re-attests at the same upTo under its new key, the records its revoked key signed giving way', async () => {
    const issued = await hub.fetchAs(ADMIN, '/api/enrollments', { body: { machine: 'mini' } });
    const { token } = (await issued.json()) as { token: string };
    const code = encodeEnrollmentCodeV2({ hub: hub.url, token, roots: [await keyId(a1.stepUp!.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
    const rotated = await enrollV2(code, 'mini', { ref: mini.ref });
    const old = await keyId(mini.key.pub);
    await accept((s) => {
      s.machines = s.machines.map((m) => (m.ref === mini.ref ? { ...m, pub: rotated.key.pub } : m));
      s.revoked.push({ keyId: old, holder: { machine: mini.ref } });
    });
    mini = rotated;
    const again = await attestation(mini, P1, `mini/${S}`, ['mini']);
    expect((await post(P1, again)).status).toBe(201);
    const kept = (await (await hub.fetchAs(ADMIN, `/api/projects/${P1}/attestations`)).json()) as HistoryAttestations;
    expect(kept.records.find((r) => r.body.writer === `mini/${S}`)).toEqual(again);
  });
});
