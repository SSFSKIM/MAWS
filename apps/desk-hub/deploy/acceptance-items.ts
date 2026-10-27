// The acceptance items `deployment acceptance` runs (O11 M8; docs/doperpowers/plans/2026-10-27-p5-o11-hub-v2.md,
// Acceptance), each the parts of its item no other command proves. Every check is one report line; what an item makes
// is undone through the run's cleanup (acceptance.ts).
import { randomUUID } from 'node:crypto';
import {
  canonicalize,
  endorseDevice,
  generateSigningKey,
  keyId,
  signEvent,
  signOrgState,
  stateHash,
  verifyMachineCert,
  type Device,
  type Listing,
  type MachineCert,
  type OrgState,
  type RevokedKey,
  type Signed,
  type SignedOrgState,
  type SigningKey,
} from 'org-protocol';
import { deviceHuman, echoCheck, echoPayloads, HubClient, referenceCheck, RelayApp, type DeviceHuman, type ProjectSocket } from 'org-protocol/test-support';
import type { FakeEndpoint } from '../fake-machine/endpoint';
import { enrollDelegated, listing, retirement, type DelegationKey, type V2Machine } from '../fake-machine/org';
import { importOrgKey, seal } from '../src/protocol/codes';
import { delegationFor, type OrgStateView, type ProvisioningKeyIssued, type ProvisioningKeys } from '../src/protocol/identity';
import type { LogEvent } from '../src/protocol/log';
import { settledWithin, type Person } from './hub';
import { ADMIT_MS, successor, type OrgAdmin } from './org-admin';
import { revoke, STEP_MS, type Cleanup } from './proof';
import { readPush, userAgent, type PushSink } from './push-sink';

/** How long a cleanup step waits for a creation still in flight to land before it looks for what it made: within the
 * step's own bound, leaving it room for the lookup and the undo. */
const CREATION_WAIT_MS = STEP_MS - 10_000;

/** One line of the run: an item, its check, and how it went. */
export type Line = { item: string; check: string; status: 'pass' | 'fail' | 'skip'; detail: string };

export class Report {
  readonly lines: Line[] = [];
  constructor(
    private readonly print: (line: string) => void,
    /** An interrupted run's (`Cleanup.signal`): once it aborts, no further check starts, and the run unwinds. */
    private readonly signal?: AbortSignal,
  ) {}

  add(line: Line): void {
    this.lines.push(line);
    this.print(`${line.status.toUpperCase()} ${line.item} ${line.check}: ${line.detail}`);
  }

  /** Runs one check: its detail when it passes, `{skip}` when it cannot run, its error when it fails. Once the run is
   * interrupted it throws instead, starting nothing. */
  async check(item: string, check: string, run: () => Promise<string | { skip: string }>): Promise<boolean> {
    this.signal?.throwIfAborted();
    try {
      const detail = await run();
      this.add(typeof detail === 'string' ? { item, check, status: 'pass', detail } : { item, check, status: 'skip', detail: detail.skip });
      return true;
    } catch (error) {
      this.add({ item, check, status: 'fail', detail: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  get ok(): boolean {
    return this.lines.every((l) => l.status !== 'fail');
  }
}

/** What the items share: the hub as the owner, the org's admin, the run's tag and cleanup, and what each made. */
export type Context = {
  person: Person;
  admin: OrgAdmin;
  cleanup: Cleanup;
  report: Report;
  tag: string;
  /** Names, delegations and provisioning keys the run made, for the check after cleanup. */
  made: { machines: string[]; delegations: string[]; provisioningPrefixes: string[]; members: string[] };
};

/** The listed machine items 3–6 share: its endpoint holds RL1 and has opened `project`. */
export type Fixture = { machine: V2Machine; endpoint: FakeEndpoint; project: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(probe: () => T | undefined | Promise<T | undefined>, what: string, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(100);
  }
}

// ---- acceptance 2: a successor off the head refused, a member added, a second device admitted only endorsed and root-signed ----

/** A device of the test member, made for this run: its channel and step-up keys. */
async function memberDevice(id: string): Promise<{ device: Device; stepUp: SigningKey }> {
  const channel = await generateSigningKey();
  const stepUp = await generateSigningKey();
  return { stepUp, device: { id, class: 'native-mac', keyStorage: 'software', channelPub: channel.pub, stepUpPub: stepUp.pub } };
}

export async function members(ctx: Context): Promise<void> {
  const { person, admin, cleanup, report, tag } = ctx;
  const item = '2';
  const post = async (signed: SignedOrgState) => {
    const response = await person.fetch('/api/org/state', { body: signed });
    return `${response.status} ${((await response.json().catch(() => ({}))) as { error?: string }).error ?? ''}`.trim();
  };
  await report.check(item, 'a successor off the head, and an older version', async () => {
    const head = await admin.read();
    const off = await successor(head.state, () => {});
    off.prev = await stateHash({ ...head.state, issued: '2000-01-01T00:00:00.000Z' });
    const forked = await post(await signOrgState(off, [admin.device.stepUp]));
    if (head.state.version < 2) throw new Error(`the head is the genesis: no older version to post (${forked} for the fork)`);
    const first = (await person.json<{ chain: SignedOrgState[] }>('/api/org/state?since=0')).chain[0];
    const older = await post(first);
    if (forked !== '409 not-head' || older !== '409 rollback') throw new Error(`answered ${forked} and ${older}`);
    return `a successor whose prev is not the head's hash: ${forked}; the genesis posted again over version ${head.state.version}: ${older}`;
  });
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const email = `o11-m8-${tag}@staging.invalid`;
  const b1 = await memberDevice('b1');
  const b2 = await memberDevice('b2');
  ctx.made.members.push(id);
  await report.check(item, 'a member added', async () => {
    // Undone by a successor that removes them, every device key of theirs revoked.
    cleanup.add(`remove the member ${id}`, async () => {
      const keys = new Map<string, RevokedKey[]>([
        ['b1', await revokedKeys(id, b1.device)],
        ['b2', await revokedKeys(id, b2.device)],
      ]);
      await admin.amend(`the member ${email} removed, their devices' keys revoked`, (s) => {
        const member = s.members.find((m) => m.id === id);
        if (!member) return false;
        s.members = s.members.filter((m) => m.id !== id);
        for (const d of member.devices) s.revoked.push(...(keys.get(d.id) ?? []));
      });
    });
    const at = await admin.amend(`the member ${email} added`, (s) => void s.members.push({ id, email, role: 'member', devices: [b1.device] }));
    return `${email} (${id}) added with device b1 at version ${at!.state.version}`;
  });
  await report.check(item, 'a second device', async () => {
    const head = await admin.read();
    const withDevice = (device: Device) => successor(head.state, (s) => void s.members.find((m) => m.id === id)!.devices.push(device));
    const unendorsed = await post(await signOrgState(await withDevice(b2.device), [admin.device.stepUp]));
    const endorsed = { ...b2.device, endorsement: await endorseDevice(admin.org, id, b2.device, b1.stepUp.privateKey, b1.stepUp.pub) };
    const memberOnly = await post(await signOrgState(await withDevice(endorsed), [b1.stepUp, b2.stepUp]));
    if (unendorsed !== '409 endorsement-missing' || memberOnly !== '409 not-root-signed') throw new Error(`answered ${unendorsed} and ${memberOnly}`);
    const at = await admin.amend(`b2 endorsed by b1, admin-signed`, (s) => void s.members.find((m) => m.id === id)!.devices.push(endorsed));
    return `b2 unendorsed, admin-signed: ${unendorsed}; endorsed by b1 but signed by the member's devices only: ${memberOnly}; endorsed and admin-signed: accepted at version ${at!.state.version}`;
  });
}

/** A device's keys as `revoked` entries, for the step that removes it (RL DL 24: a key leaving enters `retired` or
 * `revoked`; a test member's are revoked, as for a lost device). */
async function revokedKeys(member: string, d: Device): Promise<RevokedKey[]> {
  const keys: Array<['channel' | 'step-up', string]> = [['channel', d.channelPub], ...(d.stepUpPub ? [['step-up', d.stepUpPub] as ['step-up', string]] : [])];
  return Promise.all(keys.map(async ([key, pub]) => ({ keyId: await keyId(pub), holder: { member, device: d.id, class: d.class, key } })));
}

// ---- acceptance 2: a provisioning key re-issued as a delegation enrolls a VM whose certificate the hub serves ----

export async function delegation(ctx: Context): Promise<void> {
  const { person, admin, cleanup, report, tag } = ctx;
  const item = '2';
  const prefix = `m8-vm-${tag}-`;
  let issued: ProvisioningKeyIssued | undefined;
  let delegated: DelegationKey | undefined;
  await report.check(item, 're-issued as a delegation', async () => {
    // Undone by the run's prefix, which is known before the key exists: an interrupt can come while the creation is in
    // flight, the key made and its id not yet back. The undo waits for that creation within its bound, then revokes
    // every key of the prefix the hub lists.
    ctx.made.provisioningPrefixes.push(prefix);
    const pending: { creation?: Promise<unknown> } = {};
    cleanup.add(`revoke the provisioning key of prefix ${prefix}`, async () => {
      if (pending.creation) await settledWithin(pending.creation, CREATION_WAIT_MS);
      const { keys } = await person.json<ProvisioningKeys>('/api/provisioning-keys');
      for (const key of keys.filter((k) => k.prefix === prefix && !k.revoked)) {
        const response = await person.fetch(`/api/provisioning-keys/${key.id}`, { method: 'DELETE' });
        if (response.status !== 200 && response.status !== 404) throw new Error(`${key.id}: ${response.status} ${await response.text()}`);
      }
    });
    const creation = person.json<ProvisioningKeyIssued>('/api/provisioning-keys', { body: { label: `o11 m8 acceptance ${tag}`, prefix, ttl_s: 3600, max_uses: 2, offline_revoke_s: null } }, 201);
    pending.creation = creation;
    issued = await creation;
    const id = issued.key.id;
    delegated = { id, key: await generateSigningKey() };
    const kid = await keyId(delegated.key.pub);
    ctx.made.delegations.push(id);
    // A delegation leaves the state only into `revoked`, its id and prefix reserved for good (RL DL 24, 26).
    cleanup.add(`drop the delegation ${id}, its key revoked`, async () => {
      await admin.amend(`the delegation ${id} dropped, its key revoked`, (s) => {
        if (!s.delegations.some((d) => d.id === id)) return false;
        s.delegations = s.delegations.filter((d) => d.id !== id);
        s.revoked.push({ keyId: kid, holder: { delegation: id, prefix } });
      });
    });
    const at = await admin.amend(`the delegation ${id} (prefix ${prefix}) added`, (s) => void s.delegations.push(delegationFor(issued!.key, delegated!.key.pub, [admin.member])));
    const { keys } = await person.json<ProvisioningKeys>('/api/provisioning-keys');
    const listed = keys.find((k) => k.id === id)?.delegation;
    if (listed?.pub !== delegated.key.pub) throw new Error(`the hub lists the key's delegation as ${JSON.stringify(listed)}`);
    return `provisioning key ${id} (prefix ${prefix}) added to the state at version ${at!.state.version}; the hub lists it with the delegation's key`;
  });
  if (!issued || !delegated) return;

  const name = `${prefix}1`;
  let vm: (V2Machine & { cert: Signed<MachineCert> }) | undefined;
  await report.check(item, 'a delegated VM enrolls', async () => {
    ctx.made.machines.push(name);
    cleanup.add(`revoke ${name}`, () => revoke(person, name));
    vm = await enrollDelegated(person.hub, issued!.token, name, delegated!, {}, ADMIT_MS);
    const made = vm;
    // An honest departure, as `devcloud vm delete` makes one: its delegation's key retires the certificate.
    cleanup.add(`retire ${name}'s certificate`, async () => {
      const response = await person.fetch('/api/org/cert-retirements', { body: await retirement(admin.org, made.key, delegated!) });
      if (response.status !== 200 && response.status !== 201) throw new Error(`${response.status} ${await response.text()}`);
    });
    return `${name} redeemed the key (use ${vm.use}) and its delegation-signed certificate (ref ${vm.ref}) was taken`;
  });
  if (!vm) return;

  await report.check(item, 'the certificate is served beside the state', async () => {
    const view = await person.json<OrgStateView>('/api/org/state');
    const served = view.certificates.certs.find((c) => c.body.machine === vm!.ref);
    if (!served || canonicalize(served) !== canonicalize(vm!.cert)) throw new Error(`GET /api/org/state serves ${served ? 'another certificate' : 'no certificate'} for ${vm!.ref}`);
    const verdict = await verifyMachineCert(view.head!.state, served, new Date());
    if (!verdict.ok) throw new Error(`the served certificate does not verify against the head: ${verdict.code}`);
    return `GET /api/org/state serves ${name}'s certificate with head version ${view.head!.state.version}, and it verifies against that head`;
  });
}

// ---- acceptance 3: 1 000 frames of 1 B to 256 KiB echoed byte-identical and in order; over 1 MiB refused ----

export async function frames(ctx: Context, fixture: Fixture, count: number): Promise<void> {
  const { person, report } = ctx;
  const item = '3';
  let app: RelayApp | undefined;
  try {
    await report.check(item, 'frames', async () => {
      app = await RelayApp.open(person.hub, fixture.machine.ref, person.headers);
      const echoed = await echoCheck(app, echoPayloads(count), 300_000);
      return `${echoed.frames} frames of 1 B to 256 KiB (${echoed.bytes} B) came back byte-identical and in order on channel ${echoed.channel} in ${echoed.ms} ms`;
    });
    await report.check(item, 'over 1 MiB', async () => {
      if (!app || app.ended) app = await RelayApp.open(person.hub, fixture.machine.ref, person.headers);
      const channel = await app.openChannel();
      app.send(channel, new Uint8Array(1024 * 1024));
      const ended = await app.until(() => app!.ended, 'the close of the socket', 30_000);
      if (ended.code !== 1009) throw new Error(`the socket closed ${ended.code} ${ended.reason}, not 1009`);
      return `a 1 MiB payload (a message over 1 MiB) closed the app's socket ${ended.code} ${ended.reason}`;
    });
  } finally {
    app?.close();
  }
}

// ---- acceptance 4: v2-only, dual and v1 events stored; bad signatures refused; a resend a duplicate, a re-signing a conflict ----

type Refusal = { reason: string; seq?: number; nonce?: string; message?: string };

export async function events(ctx: Context, fixture: Fixture, device: { id: string; channel: SigningKey }): Promise<void> {
  const { person, admin, report } = ctx;
  const item = '4';
  const { machine, endpoint, project } = fixture;
  const ctxOf = { org: admin.org, project };
  const session = randomUUID();
  const writer = `${machine.name}/${session}`;
  // DX1's code under a key the hub never holds: it cannot check a mac, so any 32 bytes make a v1 event it stores.
  const orgKey = await importOrgKey(crypto.getRandomValues(new Uint8Array(32)));
  const draft = (seq: number, text = `say ${seq}`) => {
    const ts = new Date().toISOString();
    return { ts, created: ts, writer, seq, kind: 'say', from: machine.name, to: '*', text };
  };
  const v2 = async (seq: number, text?: string, key: SigningKey = machine.key) => (await signEvent(ctxOf, draft(seq, text), key.privateKey, key.pub)) as unknown as LogEvent;
  const dual = async (seq: number) => (await seal(orgKey, 'log', project, await v2(seq))) as LogEvent;
  const v1 = async (seq: number) => (await seal(orgKey, 'log', project, draft(seq))) as unknown as LogEvent;
  const refusedUpload = async (event: LogEvent): Promise<Refusal> => {
    const from = endpoint.frames.length;
    endpoint.upload(project, [event]);
    const refused = await endpoint.next((f) => f.t === 'refused' && f.project === project && (f.refusal as Refusal).seq === event.seq, `the refusal of seq ${event.seq}`, from, 30_000);
    return refused.refusal as Refusal;
  };
  const bad = (refusal: Refusal, code?: string) => {
    if (refusal.reason !== 'bad-signature' || (code !== undefined && !refusal.message?.includes(code))) throw new Error(`refused ${refusal.reason} (${refusal.message ?? ''}), not bad-signature${code ? ` (${code})` : ''}`);
    return `refused bad-signature (${refusal.message ?? ''})`;
  };

  let log: ProjectSocket | undefined;
  try {
    log = await new HubClient(person.hub, person.headers).project(project);
    await log.catchUp();
    const logged = (seq: number, w = writer) => until(() => log!.log.find((l) => l.event.writer === w && l.event.seq === seq), `${w}#${seq} on the log`);

    await report.check(item, 'a machine event signed wrong', async () => bad(await refusedUpload({ ...(await v2(1)), text: 'not what was signed' } as LogEvent)));
    await report.check(item, 'a machine event signed by a key not its writer’s', async () => bad(await refusedUpload(await v2(1, 'a stranger', await generateSigningKey())), 'unknown-signer'));
    const sent = [await v2(1), await dual(2), await v1(3)];
    await report.check(item, 'v2-only, dual-coded and v1 events stored', async () => {
      endpoint.upload(project, sent);
      for (const [i, event] of sent.entries()) {
        const stored = await logged(i + 1);
        if (canonicalize(stored.event) !== canonicalize(event)) throw new Error(`seq ${i + 1} is stored altered`);
      }
      return `${writer} #1 (v2-only, no mac), #2 (dual-coded) and #3 (v1, mac only) stored as sent`;
    });
    await report.check(item, 'a byte-identical resend', async () => {
      const from = endpoint.frames.length;
      endpoint.upload(project, [sent[0], await v2(4)]);
      await logged(4);
      const refused = endpoint.frames.slice(from).filter((f) => f.t === 'refused' && f.project === project);
      if (refused.length) throw new Error(`refused: ${JSON.stringify(refused)}`);
      if (log!.log.filter((l) => l.event.writer === writer && l.event.seq === 1).length !== 1) throw new Error('seq 1 is on the log twice');
      return 'seq 1 sent again byte for byte was taken as a duplicate: not refused, not stored twice, and the batch went on to #4';
    });
    await report.check(item, 'a re-signed resend', async () => {
      const resigned = (await signEvent(ctxOf, without(sent[0], 'sig'), machine.key.privateKey, machine.key.pub)) as unknown as LogEvent;
      const refusal = await refusedUpload(resigned);
      if (refusal.reason !== 'conflict') throw new Error(`refused ${refusal.reason}, not conflict`);
      return 'seq 1 signed again (other signature bytes) at the same position was refused conflict';
    });

    // The test device's words: a v2 `human` as `hub/<member>`.
    const member = admin.member;
    const say = async (words: DeviceHuman) => log!.say(words);
    const signed = (text: string, key = device.channel) => deviceHuman(ctxOf, member, key, text);
    let first: DeviceHuman | undefined;
    let firstSeq = 0;
    await report.check(item, 'the device’s v2-only and dual-coded human stored', async () => {
      first = await signed(`o11 m8 acceptance ${new Date().toISOString()}`);
      const only = await say(first);
      if (only.t !== 'human-ack') throw new Error(`the v2 human was refused ${only.refusal.reason}`);
      firstSeq = only.seq;
      const both = await say(await seal(orgKey, 'log', project, await signed('dual-coded')));
      if (both.t !== 'human-ack') throw new Error(`the dual-coded human was refused ${both.refusal.reason}`);
      return `stored as ${only.writer}#${only.seq} (v2-only) and #${both.seq} (dual-coded)`;
    });
    await report.check(item, 'the device’s human signed wrong', async () => {
      const answer = await say({ ...(await signed('mine')), text: 'altered' });
      if (answer.t !== 'refused') throw new Error('stored');
      return bad(answer.refusal);
    });
    await report.check(item, 'a human signed by a key the state does not list', async () => {
      const answer = await say(await signed('not a device of the member', await generateSigningKey()));
      if (answer.t !== 'refused') throw new Error('stored');
      return bad(answer.refusal, 'unknown-signer');
    });
    await report.check(item, 'the device’s resend and re-signing', async () => {
      if (!first) return { skip: 'no stored human to resend' };
      const again = await say(first);
      if (again.t !== 'human-ack' || again.seq !== firstSeq) throw new Error(`the byte-identical resend answered ${JSON.stringify(again)}`);
      const resigned = await signEvent(ctxOf, without(first, 'sig'), device.channel.privateKey, device.channel.pub);
      const conflict = await say(resigned);
      if (conflict.t !== 'refused' || conflict.refusal.reason !== 'conflict') throw new Error(`the re-signed resend answered ${JSON.stringify(conflict)}`);
      return `the same bytes again answered the original ack (#${firstSeq}); signed again with the same nonce, refused conflict`;
    });
  } finally {
    log?.close();
  }
}

function without<T extends object>(event: T, field: string): T {
  const copy = { ...event } as Record<string, unknown>;
  delete copy[field];
  return copy as T;
}

// ---- acceptance 5: an owner-only push carrying only {project, machine, session, kind} ----

export async function push(ctx: Context, fixture: Fixture, device: { id: string }, sink: PushSink | undefined): Promise<void> {
  const { person, admin, cleanup, report, tag } = ctx;
  const item = '5';
  if (!sink) {
    await report.check(item, 'owner-only push', async () => ({ skip: 'no push sink (--push-url and --push-port): the hub needs an https endpoint it can reach' }));
    return;
  }
  const { machine, endpoint, project } = fixture;
  const hub = new HubClient(person.hub, person.headers);
  const ua = await userAgent(sink.endpoint(`o11-m8-${tag}-${device.id}`));
  let others = 0;
  await report.check(item, 'a subscription bound to the device', async () => {
    others = (await hub.pushSubscriptions()).subscriptions.filter((s) => s.endpoint !== ua.endpoint).length;
    cleanup.add('delete the push subscription', async () => void (await hub.deletePush(ua.endpoint)));
    const { subscription } = await hub.registerPush({ endpoint: ua.endpoint, keys: ua.keys, device: device.id });
    return `kept, bound to device ${subscription.device}${others ? ` (the owner holds ${others} other subscription(s) on this hub, which get the same notice)` : ''}`;
  });
  const mine = randomUUID();
  const theirs = randomUUID();
  // Another member's id, which no member of the state holds: the hub pushes a listed session to its owners alone.
  const other = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const fields = (owners: string[], title: string): Listing['fields'] => ({ owners, project, lane: 'B', state: 'waiting', title });
  cleanup.add('settle the notified sessions', async () => {
    endpoint.notify(mine, project, 'settled', 0);
    endpoint.notify(theirs, project, 'settled', 0);
  });
  let pushes: unknown[] = [];
  await report.check(item, 'the owner’s session reaches the owner’s device', async () => {
    endpoint.listing(await listing(machine, mine, 1, fields([admin.member], `o11 m8 ${tag}: the owner's`)));
    endpoint.listing(await listing(machine, theirs, 1, fields([other], `o11 m8 ${tag}: another member's`)));
    await until(async () => {
      const held = (await hub.listings(project)).listings.map((l) => l.body.session);
      return held.includes(mine) && held.includes(theirs) ? true : undefined;
    }, 'both listings stored');
    // In order on the machine's socket: another member's session first, so the owner's push arriving says it was judged.
    endpoint.notify(theirs, project, 'waiting', 1);
    endpoint.notify(mine, project, 'waiting', 1);
    await until(() => (sink.received(ua.endpoint).length > 0 ? true : undefined), 'a push at the device', 60_000);
    await sleep(3000);
    pushes = await Promise.all(sink.received(ua.endpoint).map((body) => readPush(ua, body)));
    const expected = { project, machine: machine.ref, session: mine, kind: 'waiting' };
    const ours = pushes.filter((p) => (p as { session?: string }).session === mine);
    if (ours.length !== 1 || canonicalize(ours[0]) !== canonicalize(expected)) throw new Error(`the device read ${JSON.stringify(pushes)}`);
    return `one notice, decrypted with the device's subscription keys: exactly ${canonicalize(expected)}`;
  });
  await report.check(item, 'another member’s session reaches none of the owner’s devices', async () => {
    const leaked = pushes.filter((p) => (p as { session?: string }).session !== mine);
    if (leaked.length) throw new Error(`the owner's device also read ${JSON.stringify(leaked)}`);
    return `the session listed for ${other} alone, notified first, pushed nothing to the owner's device`;
  });
}

// ---- acceptance 6: the reference client holds the Registry, Project and Machine sockets as the device's member ----

export async function connection(ctx: Context, fixture: Fixture, device: { id: string; channel: SigningKey }, pushEndpoint: string): Promise<void> {
  const { person, report } = ctx;
  const result = await referenceCheck({
    hub: person.hub,
    headers: person.headers,
    project: fixture.project,
    machine: fixture.machine.ref,
    device: { id: device.id, key: device.channel },
    pushEndpoint,
    frames: 32,
  });
  for (const line of result.lines) report.add({ item: '6', check: line.step, status: line.status, detail: line.detail });
}

/** The state's view of what a run made, after its cleanup: nothing of it still current. */
export function lingering(state: OrgState, made: Context['made']): string[] {
  return [
    ...state.members.filter((m) => made.members.includes(m.id)).map((m) => `the state still lists the member ${m.email}`),
    ...state.machines.filter((m) => made.machines.includes(m.name)).map((m) => `the state still lists ${m.name}`),
    ...state.delegations.filter((d) => made.delegations.includes(d.id)).map((d) => `the state still holds the delegation ${d.id}`),
  ];
}
