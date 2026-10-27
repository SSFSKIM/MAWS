// The Project's v2 log events (O11 M5; RL8) on the local runtime: v1, dual-coded and v2-only events stored side by
// side; a v2 signature checked by the protocol package against the org-state head the Project caches from its
// Registry, from a machine's upload and from a device's `human` alike; resends known by their bytes, a re-signed one
// refused `conflict`; and the cache refreshed by the Registry's announcement, by its age when an announcement is lost,
// and anew after an eviction, never trusted when the head cannot be read.
import { generateSigningKey, signEvent, type OrgState, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base64urlEncode } from '../src/protocol/base64url';
import { importOrgKey, newNonce, seal, verify } from '../src/protocol/codes';
import type { ProjectDown } from '../src/protocol/browser';
import type { HumanDraft, HumanEvent, LogEvent, SignedHumanEvent } from '../src/protocol/log';
import type { DownFrame } from '../src/protocol/machine';
import { BrowserClient, enroll, MachineClient, waitFor } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';
import { endorsed, genesis, memberId, newDevice, next, revokedDevice, signedBy, type TestDevice } from './support/org';

let hub: LocalHub;
/** The bootstrap admin's member id, whose devices write `hub/<A>`. */
let A: string;
let a1: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
/** The machine the state lists: its DX2 stream, and the key and ref the state lists it by. */
let machine: MachineClient;
let machineKey: SigningKey;
const KEY = importOrgKey(new Uint8Array(32).fill(5));
const SESSION = 'e0ad139c-18bc-45bd-9489-be8653145f80';

let projects = 0;
const newProject = () => `5a2c7d1e-8b3f-4e6a-9c01-${(++projects).toString(16).padStart(12, '0')}`;

/** Signs `state` by a1 (the root) and has it accepted; announced to every project the Registry holds. */
async function accept(state: OrgState): Promise<void> {
  const signed = await signedBy(state, a1);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: signed });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = signed;
}

/** A new device of A, endorsed by a1 and listed by an accepted successor. */
async function addDevice(id: string): Promise<TestDevice> {
  const device = await endorsed(ORG, A, await newDevice(id), a1);
  await accept(await next(head, (s) => s.members.find((m) => m.id === A)!.devices.push(device.device)));
  return device;
}

/** A device of A removed, its keys revoked as for a lost device (RL DL 24). */
async function revokeDevice(device: TestDevice): Promise<void> {
  const revoked = await revokedDevice(A, device.device);
  await accept(
    await next(head, (s) => {
      const member = s.members.find((m) => m.id === A)!;
      member.devices = member.devices.filter((d) => d.id !== device.device.id);
      s.revoked.push(...revoked);
    }),
  );
}

beforeAll(async () => {
  hub = await startLocalHub();
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  recovery = await generateSigningKey();
  machine = new MachineClient(hub, 'signer-1', await enroll(hub, ADMIN, 'signer-1'));
  await machine.connect();
  machineKey = await generateSigningKey();
  const ref = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const g = await genesis(ORG, A, ADMIN, a1, recovery);
  g.machines.push({ name: machine.name, ref, pub: machineKey.pub, owners: 'org' });
  g.machineNames.push({ name: machine.name, ref });
  await accept(g);
});
afterAll(async () => {
  await machine?.close();
  await hub?.close();
});

/** An event of the machine's session, unsigned and without a code. */
function draftSay(seq: number, text = `say ${seq}`): Record<string, unknown> & { seq: number } {
  const ts = new Date().toISOString();
  return { ts, created: ts, writer: `${machine.name}/${SESSION}`, seq, kind: 'say', from: machine.name, to: '*', text };
}

/** RL8 v2-only: the machine's signature, no mac. */
const v2Say = async (project: string, seq: number, text?: string, key = machineKey) =>
  (await signEvent({ org: ORG, project }, draftSay(seq, text), key.privateKey, key.pub)) as unknown as LogEvent;
/** Dual-coded: signed, then sealed, so DX1's mac covers the sig. */
const dualSay = async (project: string, seq: number, text?: string) => (await seal(await KEY, 'log', project, await v2Say(project, seq, text))) as LogEvent;
/** v1: DX1's mac alone. */
const v1Say = async (project: string, seq: number, text?: string) => (await seal(await KEY, 'log', project, draftSay(seq, text))) as unknown as LogEvent;

/** A device's `human`, before the hub positions it: signed by `device`, dual-coded when `dual`. */
async function deviceWords(project: string, device: TestDevice, text: string, dual = false, member = A): Promise<SignedHumanEvent> {
  const draft: HumanDraft & { nonce: string } = { kind: 'human', from: 'human', member, to: '*', text, created: new Date().toISOString(), nonce: newNonce() };
  const signed = await signEvent({ org: ORG, project }, draft, device.channel.privateKey, device.channel.pub);
  return dual ? seal(await KEY, 'log', project, signed) : signed;
}

/** A browser's sealed (v1) `human` of `member`. */
async function webWords(project: string, member: string, text: string): Promise<HumanEvent> {
  return seal(await KEY, 'log', project, { kind: 'human', from: 'human', member, to: '*', text, created: new Date().toISOString() } satisfies HumanDraft);
}

/** A member with one device, listed by an accepted successor; `email` is admitted by the projection. */
async function addMember(email: string): Promise<{ id: string; device: TestDevice }> {
  const id = memberId();
  const device = await newDevice(`${email}-1`);
  await accept(await next(head, (s) => s.members.push({ id, email, role: 'member', devices: [device.device] })));
  return { id, device };
}

/** Uploads `events` and waits until the hub has answered each: stored (the browser follows the log) or refused. */
async function upload(project: string, events: LogEvent[]): Promise<void> {
  const response = await machine.post([{ t: 'events', project, events }]);
  if (response.status !== 200) throw new Error(`post: ${response.status} ${await response.text()}`);
}

/** Uploads `event` and answers the hub's refusal of it, from the machine's stream. */
async function refusedUpload(project: string, event: LogEvent) {
  const from = machine.frames.length;
  await upload(project, [event]);
  const refused = await machine.next((f) => f.t === 'refused' && f.project === project && f.refusal.seq === event.seq, `the refusal of seq ${event.seq}`, from);
  return (refused as Extract<DownFrame, { t: 'refused' }>).refusal;
}

/** Waits until `project` has been told of the suite's head. */
const announced = (project: string) => waitFor(async () => ((await hub.stateFault(project)).announced === head.state.version ? true : undefined));

/** The project's object holding no head: its registration's announcement read one, and an eviction forgets it. */
async function coldCache(project: string): Promise<void> {
  await announced(project);
  await hub.evict('Project', `${ORG}:${project}`, 'hibernate');
}

/** A project the machine has opened, and a browser of A following its log. */
async function opened(): Promise<{ project: string; browser: BrowserClient }> {
  const project = newProject();
  await machine.sync(project);
  const browser = await BrowserClient.open(hub, ADMIN, project);
  browser.send({ t: 'resume', after: 0 });
  await browser.next((f) => f.t === 'caught-up', 'caught-up');
  return { project, browser };
}

/** Sends `event` as a `human` and answers its ack or its refusal. */
async function say(browser: BrowserClient, event: SignedHumanEvent | object): Promise<Extract<ProjectDown, { t: 'human-ack' }> | Extract<ProjectDown, { t: 'refused' }>> {
  const from = browser.frames.length;
  const nonce = (event as { nonce?: string }).nonce ?? (event as { mac?: { nonce: string } }).mac?.nonce;
  browser.send({ t: 'human', event: event as HumanEvent });
  return (await browser.next((f) => (f.t === 'human-ack' && f.nonce === nonce) || (f.t === 'refused' && f.refusal.nonce === nonce), 'the human’s answer', from)) as never;
}

describe("a machine's upload", () => {
  it('stores a v2-only, a dual-coded and a v1 event side by side, each as it was sent', async () => {
    const { project, browser } = await opened();
    const events = [await v2Say(project, 1), await dualSay(project, 2), await v1Say(project, 3)];
    await upload(project, events);
    await waitFor(() => (browser.logged.length === 3 ? true : undefined));
    expect(browser.logged.map((l) => l.event)).toEqual(events);
    // The dual-coded event as a DX1 reader gets it (desk-web, an old daemon): its mac verifies, the sig inside it.
    const dual = browser.logged[1].event;
    expect(dual.sig).toBeDefined();
    expect(await verify(await KEY, 'log', project, dual)).toBe(true);
    browser.close();
  });

  it('refuses bad-signature a v2 event whose signature fails, or that a key not listed for its writer signed', async () => {
    const { project, browser } = await opened();
    expect(await refusedUpload(project, { ...(await v2Say(project, 1)), text: 'not what was signed' })).toMatchObject({
      reason: 'bad-signature',
      writer: `${machine.name}/${SESSION}`,
      seq: 1,
      message: expect.stringContaining('bad-signature'),
    });
    // A stranger's key, and a key the state lists for a device and not for this machine.
    const stranger = await generateSigningKey();
    expect(await refusedUpload(project, await v2Say(project, 1, 'a stranger', stranger))).toMatchObject({ reason: 'bad-signature', message: expect.stringContaining('unknown-signer') });
    expect(await refusedUpload(project, await v2Say(project, 1, 'a device', a1.channel))).toMatchObject({ reason: 'bad-signature', message: expect.stringContaining('unknown-signer') });
    // Dual-coded, the mac is no help: the v2 signature is checked all the same.
    const dual = await dualSay(project, 1);
    const forged = (await seal(await KEY, 'log', project, { ...without(dual, 'mac'), text: 'forged under a good mac' })) as unknown as LogEvent;
    expect(await refusedUpload(project, forged)).toMatchObject({ reason: 'bad-signature' });
    // Nothing was stored, and the writer's next good event still takes seq 1.
    await upload(project, [dual]);
    await waitFor(() => (browser.logged.length === 1 ? true : undefined));
    expect(browser.logged[0].event).toEqual(dual);
    browser.close();
  });

  it('takes a byte-identical resend as a duplicate, and refuses a re-signed resend at the same position conflict', async () => {
    const { project, browser } = await opened();
    const first = await v2Say(project, 1, 'once');
    await upload(project, [first]);
    await waitFor(() => (browser.logged.length === 1 ? true : undefined));
    const from = machine.frames.length;
    await upload(project, [first, await v2Say(project, 2)]);
    await waitFor(() => (browser.logged.length === 2 ? true : undefined));
    expect(machine.frames.slice(from).filter((f) => f.t === 'refused')).toEqual([]);
    // ECDSA signs anew each time (and a signature is malleable): the same words signed again are another payload.
    const resigned = (await signEvent({ org: ORG, project }, without(first, 'sig'), machineKey.privateKey, machineKey.pub)) as unknown as LogEvent;
    expect(resigned.sig).not.toEqual(first.sig);
    expect(await refusedUpload(project, resigned)).toMatchObject({ reason: 'conflict' });
    expect(browser.logged.map((l) => l.event.seq)).toEqual([1, 2]);
    browser.close();
  });
});

/** A copy of `event` without its `field`. */
function without<T extends object>(event: T, field: string): T {
  const copy = { ...event } as Record<string, unknown>;
  delete copy[field];
  return copy as T;
}

describe("a device's human", () => {
  it('is stored v2-only or dual-coded at the position the hub gives it, and its nonce is its resend', async () => {
    const { project, browser } = await opened();
    const only = await deviceWords(project, a1, 'signed alone');
    expect(await say(browser, only)).toMatchObject({ t: 'human-ack', nonce: only.nonce, writer: `hub/${A}`, seq: 1 });
    const dual = await deviceWords(project, a1, 'signed and sealed', true);
    expect(await say(browser, dual)).toMatchObject({ t: 'human-ack', nonce: dual.nonce, seq: 2 });
    await waitFor(() => (browser.logged.length === 2 ? true : undefined));
    const [storedOnly, storedDual] = browser.logged.map((l) => l.event);
    expect(storedOnly).toEqual({ ...only, writer: `hub/${A}`, seq: 1, ts: storedOnly.ts });
    expect(await verify(await KEY, 'log', project, storedDual)).toBe(true);
    // The same bytes again: the original ack. Signed again with the same nonce: conflict.
    expect(await say(browser, only)).toMatchObject({ t: 'human-ack', seq: 1 });
    const resigned = await signEvent({ org: ORG, project }, without(only, 'sig'), a1.channel.privateKey, a1.channel.pub);
    expect(await say(browser, resigned)).toMatchObject({ t: 'refused', refusal: { reason: 'conflict', seq: 1 } });
    expect(browser.logged).toHaveLength(2);
    browser.close();
  });

  it('is refused bad-signature when its signature fails or another key signed it, and bad-shape without a nonce', async () => {
    const { project, browser } = await opened();
    const words = await deviceWords(project, a1, 'mine');
    expect(await say(browser, { ...words, text: 'altered' })).toMatchObject({ t: 'refused', refusal: { reason: 'bad-signature' } });
    const stranger = await newDevice('stranger');
    expect(await say(browser, await deviceWords(project, stranger, 'not a device of A'))).toMatchObject({ t: 'refused', refusal: { reason: 'bad-signature', message: expect.stringContaining('unknown-signer') } });
    browser.send({ t: 'human', event: without(words, 'nonce') as unknown as HumanEvent });
    const refused = (await browser.next((f) => f.t === 'refused' && f.refusal.reason === 'bad-shape', 'the bad-shape refusal')) as Extract<ProjectDown, { t: 'refused' }>;
    expect(refused.refusal.message).toContain('nonce');
    expect(browser.logged).toHaveLength(0);
    browser.close();
  });

  it('meets a device paired a moment ago: an unknown signer reads the head again', async () => {
    const { project, browser } = await opened();
    expect(await say(browser, await deviceWords(project, a1, 'warm'))).toMatchObject({ t: 'human-ack' });
    await hub.stateFault(project, { times: 1, missing: true }); // the pairing's announcement is lost
    const fresh = await addDevice('a-fresh');
    await waitFor(async () => ((await hub.stateFault(project)).calls === 1 ? true : undefined));
    const { reads } = await hub.stateCache(project);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // the unknown signer's limit since the cache's read
    expect(await say(browser, await deviceWords(project, fresh, 'just paired'))).toMatchObject({ t: 'human-ack', seq: 2 });
    expect((await hub.stateCache(project)).reads).toBe(reads + 1);
    browser.close();
  });
});

describe('the cached org state', () => {
  it('is read again on the announcement: a removed device is refused at once, its member still on an open socket', async () => {
    const { project, browser } = await opened();
    const a2 = await addDevice('a2');
    await announced(project);
    expect(await say(browser, await deviceWords(project, a2, 'before'))).toMatchObject({ t: 'human-ack' }); // the cache is warm
    const { reads } = await hub.stateCache(project);
    await revokeDevice(a2);
    await announced(project);
    expect(await say(browser, await deviceWords(project, a2, 'after'))).toMatchObject({ t: 'refused', refusal: { reason: 'bad-signature', message: expect.stringContaining('revoked') } });
    // One read, the announcement's: the refusal needed no unknown signer's.
    expect((await hub.stateCache(project)).reads).toBe(reads + 1);
    expect(browser.closed).toBe(false);
    expect(await say(browser, await deviceWords(project, a1, 'a1 still writes'))).toMatchObject({ t: 'human-ack', seq: 2 });
    browser.close();
  });

  it('is read again once it is older than a minute, when the announcement is lost', async () => {
    const { project, browser } = await opened();
    const a3 = await addDevice('a3');
    await announced(project);
    expect(await say(browser, await deviceWords(project, a3, 'before'))).toMatchObject({ t: 'human-ack' });
    await hub.stateFault(project, { times: 1, missing: true });
    await revokeDevice(a3);
    await waitFor(async () => ((await hub.stateFault(project)).calls === 1 ? true : undefined));
    // Within the minute the missed state goes unseen: the staleness the age bounds.
    expect(await say(browser, await deviceWords(project, a3, 'stale'))).toMatchObject({ t: 'human-ack' });
    await hub.stateCache(project, { ahead: 60_001 });
    expect(await say(browser, await deviceWords(project, a3, 'aged'))).toMatchObject({ t: 'refused', refusal: { reason: 'bad-signature', message: expect.stringContaining('revoked') } });
    browser.close();
  });

  it('is read anew after a hibernation: a lost announcement does not outlive an eviction', async () => {
    const { project, browser } = await opened();
    const a4 = await addDevice('a4');
    await announced(project);
    expect(await say(browser, await deviceWords(project, a4, 'before'))).toMatchObject({ t: 'human-ack' });
    await hub.stateFault(project, { times: 1, missing: true });
    await revokeDevice(a4);
    await waitFor(async () => ((await hub.stateFault(project)).calls === 1 ? true : undefined));
    await hub.evict('Project', `${ORG}:${project}`, 'hibernate');
    expect(await say(browser, await deviceWords(project, a4, 'after the eviction'))).toMatchObject({ t: 'refused', refusal: { reason: 'bad-signature' } });
    expect(await say(browser, await deviceWords(project, a1, 'a1 after the eviction'))).toMatchObject({ t: 'human-ack', seq: 2 });
    browser.close();
  });

  it('that cannot be read refuses v2 events state-unavailable, never storing one unchecked, and v1 flows on', async () => {
    const { project, browser } = await opened();
    await coldCache(project);
    await hub.headFault(true);
    try {
      expect(await say(browser, await deviceWords(project, a1, 'unchecked'))).toMatchObject({ t: 'refused', refusal: { reason: 'state-unavailable' } });
      expect(await refusedUpload(project, await v2Say(project, 1))).toMatchObject({ reason: 'state-unavailable' });
      const v1 = await v1Say(project, 1);
      await upload(project, [v1]);
      await waitFor(() => (browser.logged.length === 1 ? true : undefined));
      expect(browser.logged[0].event).toEqual(v1);
    } finally {
      await hub.headFault(false);
    }
    // The sender's retry, once the head can be read.
    const words = await deviceWords(project, a1, 'checked');
    expect(await say(browser, words)).toMatchObject({ t: 'human-ack', nonce: words.nonce });
    browser.close();
  });
});

describe('a check that waits for the head', () => {
  it("stores nothing of an upload whose stream was revoked while the head was read", async () => {
    const { project, browser } = await opened();
    await coldCache(project);
    await hub.stateCache(project, { hold: true });
    const { reads } = await hub.stateCache(project);
    const posted = machine.post([{ t: 'events', project, events: [await v2Say(project, 1)] }]);
    await waitFor(async () => ((await hub.stateCache(project)).reads > reads ? true : undefined));
    await hub.lease(project, { op: 'forget', machine: machine.name, generation: machine.generation }); // DX7's revocation
    await hub.stateCache(project, { hold: false });
    expect((await posted).status).toBe(409);
    browser.send({ t: 'resume', after: 0 });
    await browser.next((f) => f.t === 'caught-up', 'caught-up', browser.frames.length);
    expect(browser.logged).toEqual([]);
    browser.close();
  });

  it("stores no human, signed or not, of a member removed while one waited for the head", async () => {
    const { project, browser } = await opened();
    const email = 'removed@example.com';
    const b = await addMember(email);
    await announced(project);
    const theirs = await BrowserClient.open(hub, email, project);
    await hub.stateCache(project, { hold: true, ahead: 60_001 }); // the cached head is too old: the next check reads
    theirs.send({ t: 'human', event: (await deviceWords(project, b.device, 'signed', false, b.id)) as unknown as HumanEvent });
    theirs.send({ t: 'human', event: await webWords(project, b.id, 'sealed, queued behind it') });
    const revoked = await revokedDevice(b.id, b.device.device);
    await accept(
      await next(head, (s) => {
        s.members = s.members.filter((m) => m.id !== b.id);
        s.revoked.push(...revoked);
      }),
    );
    await announced(project);
    await waitFor(() => (theirs.closed ? true : undefined));
    await hub.stateCache(project, { hold: false });
    // A's own human after both, which A's browser follows live: the log's first event, and nothing of B's is stored.
    expect(await say(browser, await deviceWords(project, a1, 'after'))).toMatchObject({ t: 'human-ack', offset: 1 });
    await waitFor(() => (browser.logged.length > 0 ? true : undefined));
    expect(browser.logged.map((l) => l.event.writer)).toEqual([`hub/${A}`]);
    browser.close();
  });

  it("fails closed within the bound when the head stalls, and holds no other member's sealed human behind it", async () => {
    const { project, browser } = await opened();
    const email = 'other@example.com';
    const c = await addMember(email);
    await announced(project);
    const theirs = await BrowserClient.open(hub, email, project);
    await hub.stateCache(project, { hold: true, readTimeoutMs: 1000, ahead: 60_001 });
    const signed = await deviceWords(project, a1, 'waits for the head');
    const from = browser.frames.length;
    browser.send({ t: 'human', event: signed as unknown as HumanEvent });
    const mineAfter = await webWords(project, A, 'sealed, after my signed one');
    browser.send({ t: 'human', event: mineAfter });
    // Another member's sealed human is answered while A's signed one still waits.
    const theirsWords = await webWords(project, c.id, 'sealed, another member');
    expect(await say(theirs, theirsWords)).toMatchObject({ t: 'human-ack', writer: `hub/${c.id}` });
    expect(browser.frames.slice(from).some((f) => f.t === 'refused' && f.refusal.nonce === signed.nonce)).toBe(false);
    // A's signed one fails closed at the bound; A's sealed one, behind it, is stored then.
    const refused = await browser.next((f) => f.t === 'refused' && f.refusal.nonce === signed.nonce, 'the stalled refusal', from, 5000);
    expect(refused).toMatchObject({ refusal: { reason: 'state-unavailable' } });
    await browser.next((f) => f.t === 'human-ack' && f.nonce === mineAfter.mac.nonce, 'the sealed ack', from);
    await hub.stateCache(project, { hold: false });
    // The stalled read was let go: the sender's retry reads again and is stored.
    expect(await say(browser, signed)).toMatchObject({ t: 'human-ack' });
    theirs.close();
    browser.close();
  });
});

describe('a DX2 daemon', () => {
  it('is sent a v2-only event as stored, without a mac, and its rejection of it is recorded', async () => {
    const { project, browser } = await opened();
    const from = machine.frames.length;
    const only = await deviceWords(project, a1, 'no mac for the daemon');
    expect(await say(browser, only)).toMatchObject({ t: 'human-ack', seq: 1 });
    const sent = (await machine.next((f) => f.t === 'events' && f.project === project, 'the fan-out', from)) as Extract<DownFrame, { t: 'events' }>;
    expect(sent.events).toEqual([{ ...only, writer: `hub/${A}`, seq: 1, ts: sent.events[0].ts }]);
    expect(sent.events[0].mac).toBeUndefined();
    // sminos refuses it on import as `bad-code` (no code to check), spends the position and reports it (DX2 `rejected`).
    await machine.postOk([{ t: 'rejected', project, event: { writer: `hub/${A}`, seq: 1 }, reason: 'bad-code', message: 'its code or nonce is not the canonical base64url of 32 and 16 bytes' }]);
    expect(await browser.next((f) => f.t === 'rejected', 'the rejection')).toMatchObject({ rejection: { machine: machine.name, event: { writer: `hub/${A}`, seq: 1 }, reason: 'bad-code' } });
    browser.close();
  });
});

