// RL10's conversation (O10 M6's Proves) replayed against the real server: an endpoint enrolled and listed in a
// throwaway org on desk-hub's Worker in Miniflare (miniflare-hub.ts), and sminos played by fake-sminos.ts from
// conversation.json, the fixture O12's phase 2 copies for its own conformance replay. What happens on the endpoint's
// side between sminos's lines (a device's words, a hub that reposts or forges, a restart, a revocation, a lane A action)
// is this suite's `scenes`. Events reach the endpoint from the hub through its log relay's entry point
// (`rl10.relay.fromHub`), where the hub link hands them, so a hostile hub's frames can be played; what the endpoint
// sends the hub is the hub link's own `send`, watched.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { base64urlDecode, importOrgKey, machineProjectId, seal, verify, encodeEnrollmentCodeV2, type EnrollmentIssued, type EnrollmentKey } from 'desk-hub/protocol';
import { base64urlEncode, generateSigningKey, isListingGone, keyId, signEvent, verifyEvent, type SignedOrgState, type SigningKey, type OrgState } from 'org-protocol';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEndpoint, type Endpoint } from '../../../src/endpoint';
import type { ListingsFile } from '../../../src/endpoint/state/store';
import { fakeServices, type FakeServices } from '../fake-services';
import { ADMIN, ORG, startMiniflareHub, type LocalHub } from '../miniflare-hub';
import { endorsed, genesis, memberId, newDevice, revokedDevice, successor, type TestDevice } from '../org-fixtures';
import { replayCase, type Conversation, type FakeSminos, type Frame } from './fake-sminos';

const conversation = JSON.parse(fs.readFileSync(join(__dirname, 'conversation.json'), 'utf8')) as Conversation;
const sample = conversation.bindings;
const NAME = sample.name as string;
const PROJECT = sample['project:P'] as string;

let hub: LocalHub;
let stopHub: () => Promise<void>;
let a1: TestDevice;
let b1: TestDevice;
let b2: TestDevice;
/** B's third device, endorsed by b2, which the head holds only from the `add-device` scene on. */
let b3: TestDevice;
let recovery: SigningKey;
let head: SignedOrgState;
let A: string;
const B = memberId();
let services: FakeServices;
let endpoint: Endpoint;
let legacyKey: string;
/** Every frame the endpoint sent the hub, in order (its hub link's `send`, watched). */
const toHub: Frame[] = [];
const heard: Array<{ kind: string }> = [];
const devices: Record<string, TestDevice> = {};
/** The device words each `device-words` scene made, by seq. */
const madeWords = new Map<number, Record<string, unknown>>();
let answer: Promise<Record<string, unknown>> | null = null;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until<T>(check: () => T | Promise<T>, what: string, ms = 10_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await check();
    if (found) return found as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(25);
  }
}

async function accept(edit: (s: OrgState) => void | Promise<void>): Promise<void> {
  const next = await successor(head, [a1], edit);
  const response = await hub.fetchAs(ADMIN, '/api/org/state', { body: next });
  if (response.status !== 201) throw new Error(`state: ${response.status} ${await response.text()}`);
  head = next;
}

/** A started endpoint on `services`, its hub link's sends watched and engine.sessions answering for lane B. */
async function startEndpoint(): Promise<Endpoint> {
  const started = createEndpoint({ build: sample.build as string, sleep: (ms) => sleep(Math.min(ms, 50)) });
  const send = started.hub.send.bind(started.hub);
  started.hub.send = (frame) => {
    toHub.push(structuredClone(frame) as Frame);
    return send(frame);
  };
  started.rl10.onSession((message) => void heard.push(message));
  await started.start(services);
  return started;
}

beforeAll(async () => {
  ({ hub, stop: stopHub } = await startMiniflareHub());
  A = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
  a1 = await newDevice('a1');
  b1 = await newDevice('b1');
  b2 = await endorsed(ORG, B, await newDevice('b2'), b1);
  b3 = await endorsed(ORG, B, await newDevice('b3'), b2);
  Object.assign(devices, { b1, b2, b3 });
  recovery = await generateSigningKey();
  head = await genesis(ORG, A, a1, recovery);
  expect((await hub.fetchAs(ADMIN, '/api/org/state', { body: head })).status).toBe(201);
  await accept((s) => void s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device, b2.device] }));
  services = fakeServices();
  services.dispatch = async (_owner, name) =>
    name === 'engine.sessions'
      ? { t: 'res', id: '0', ok: true, value: [{ appSessionId: sample['app:S3'], engineSessionId: sample['session:S3'] }] }
      : { t: 'res', id: '0', ok: false, error: { code: 'unknown_command', message: name } };
  endpoint = await startEndpoint();
  const issued = (await (await hub.fetchAs(ADMIN, '/api/enrollments', { body: {} })).json()) as EnrollmentIssued;
  const code = encodeEnrollmentCodeV2({ hub: hub.url, token: issued.token, roots: [await keyId(a1.stepUp.pub)], recoveryPub: recovery.pub, k: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) });
  const enrolling = endpoint.cli('enroll', ['--name', NAME, '--wait', '30', '--json'], code);
  const key = await until(async () => {
    const response = await hub.fetchAs(ADMIN, `/api/enrollments/${issued.enrollment.id}/key`);
    return response.status === 200 ? ((await response.json()) as EnrollmentKey) : (await response.body?.cancel(), null);
  }, 'the posted key');
  await accept((s) => {
    s.machines.push({ name: NAME, ref: services.machine.ref, pub: key.pub, owners: [A] });
    s.machineNames.push({ name: NAME, ref: services.machine.ref });
  });
  expect((await enrolling).code).toBe(0);
  await until(() => endpoint.hub.connected && fs.existsSync(join(services.machine.stateDir, 'rl10.json')), 'the hub link and rl10.json');
  legacyKey = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}, 120_000);

afterAll(async () => {
  for (const c of connections.values()) c.close();
  await endpoint?.stop();
  services?.cleanup();
  await stopHub?.();
});

const listings = (): ListingsFile => {
  const path = join(services.machine.stateDir, 'listings.json');
  return fs.existsSync(path) ? (JSON.parse(fs.readFileSync(path, 'utf8')) as ListingsFile) : {};
};
const rl10Info = () => JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
const connections = new Map<string, FakeSminos>();

async function runBindings(): Promise<Record<string, unknown>> {
  const enrollment = JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'enrollment.json'), 'utf8')) as { at: string };
  const machineKey = JSON.parse(fs.readFileSync(join(services.machine.stateDir, 'machine-key.json'), 'utf8')) as { keyId: string };
  const revoked = await revokedDevice(B, b1.device);
  return {
    ...sample,
    org: ORG,
    hub: hub.url,
    ref: services.machine.ref,
    enrolled: enrollment.at,
    token: rl10Info().token,
    wrongToken: 'f'.repeat(64),
    legacyKey,
    'member:A': A,
    'member:B': B,
    'kid:b1': await keyId(b1.device.channelPub),
    'kid:b2': await keyId(b2.device.channelPub),
    'kid:b3': await keyId(b3.device.channelPub),
    'kid:b1-step': revoked.find((r) => 'key' in r.holder && r.holder.key === 'step-up')?.keyId,
    'kid:machine': machineKey.keyId,
    'project:machine': machineProjectId(ORG, NAME),
  };
}

/** The event the endpoint sent the hub at `(writer, seq)` in P, each copy in order. */
const sentUp = (writer: string, seq: number) =>
  toHub.flatMap((f) => (f.t === 'events' && f.project === PROJECT ? (f.events as Array<Record<string, unknown>>) : [])).filter((e) => e.writer === writer && e.seq === seq);

const nonEmpty = <T>(list: T[]) => (list.length > 0 ? list : null);
const fromHub = (events: unknown[]) => endpoint.rl10.relay.fromHub({ t: 'events', project: PROJECT, events });

const scenes = async (step: { scene: string } & Record<string, unknown>, bindings: Record<string, unknown>): Promise<void> => {
  switch (step.scene) {
    case 'legacy-kept': {
      const path = join(services.machine.stateDir, 'legacy.json');
      await until(() => fs.existsSync(path), 'legacy.json');
      expect(fs.statSync(path).mode & 0o777).toBe(0o600);
      expect(services.lines.join('\n')).not.toContain(legacyKey);
      expect(endpoint.status().legacyKey).toBe(true);
      return;
    }
    case 'engine-sessions':
      return;
    case 'listed':
    case 'withdrawn': {
      const entry = await until(() => {
        const held = listings()[step.session as string];
        return held !== undefined && isListingGone(held.record.body) === (step.scene === 'withdrawn') ? held : null;
      }, `${step.scene} ${String(step.session)}`, (step.within as number | undefined) ?? 10_000);
      await until(() => toHub.some((f) => f.t === 'listing' && JSON.stringify(f.record) === JSON.stringify(entry.record)), 'the listing sent the hub');
      return;
    }
    case 'hub-holds': {
      const [event] = await until(() => nonEmpty(sentUp(step.writer as string, step.seq as number)), 'the upload');
      expect(event.created).toBe(step.created);
      const ctx = { org: ORG, project: PROJECT };
      expect(await verifyEvent(ctx, head.state, event as never, { certs: [], retirements: [] }, new Date())).toEqual({ ok: true });
      expect(await verify(await importOrgKey(base64urlDecode(legacyKey)), 'log', PROJECT, event)).toBe(true);
      if (step.attest !== undefined) expect((event.attest as { owners: string[] }).owners).toEqual(step.attest);
      else expect(event.attest).toBeUndefined();
      // The hub took it: nothing came back refused for it.
      await sleep(200);
      expect(connections.get('main')?.received.some((f) => f.t === 'refused' && (f.refusal as { seq?: number }).seq === step.seq && (f.refusal as { writer?: string }).writer === step.writer)).toBe(false);
      return;
    }
    case 'hub-resend':
      return endpoint.rl10.relay.fromHub({ t: 'resend', project: PROJECT, writer: step.writer as string, from: step.from as number });
    case 'resent-identical': {
      const copies = await until(() => nonEmpty(sentUp(step.writer as string, step.seq as number).slice(1)), 'the resend');
      copies.unshift(sentUp(step.writer as string, step.seq as number)[0]);
      expect(JSON.stringify(copies[1])).toBe(JSON.stringify(copies[0]));
      return;
    }
    case 'hub-echo':
      return fromHub([sentUp(step.writer as string, step.seq as number)[0]]);
    case 'hub-repost': {
      const writer = step.writer as string;
      const original = writer.startsWith('hub/') ? madeWords.get(step.from as number) : sentUp(writer, step.from as number)[0];
      return fromHub([{ ...original, seq: step.to }]);
    }
    case 'hub-forged-own': {
      const [model] = sentUp(step.writer as string, 1);
      return fromHub([{ ...model, seq: step.seq, text: 'words this machine never wrote' }]);
    }
    case 'hub-rejected': {
      await until(() => toHub.some((f) => f.t === 'rejected' && (f.event as { writer: string; seq: number } | null)?.seq === step.seq && (f.event as { writer: string }).writer === step.writer && f.reason === step.reason), `a rejected ${String(step.reason)}`);
      return;
    }
    case 'device-words': {
      const device = devices[step.device as string];
      const at = new Date().toISOString();
      const draft = { kind: 'human', from: 'human', member: B, to: [{ session: step.session, alias: 'bob' }], text: `from ${String(step.device)}`, created: at, nonce: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
      const signed = await signEvent({ org: ORG, project: PROJECT }, draft, device.channel.privateKey, device.channel.pub);
      const event: Record<string, unknown> = { ...signed, writer: `hub/${B}`, seq: step.seq, ts: at };
      if (step.forged === true) event.text = 'words the device never signed';
      else madeWords.set(step.seq as number, event);
      if (typeof step.binding === 'string') bindings[step.binding] = event;
      return fromHub([event]);
    }
    case 'legacy-words': {
      const event = { ts: '2026-10-27T18:04:00.000Z', writer: 'old-mini/human', seq: step.seq, kind: 'human', from: 'human', to: '*', text: 'from a machine not yet moved' };
      return fromHub([await seal(await importOrgKey(base64urlDecode(legacyKey)), 'log', PROJECT, event)]);
    }
    case 'notified': {
      await sleep(300);
      const told = toHub.filter((f) => f.t === 'notify' && f.session === step.session && f.kind === step.kind);
      expect(told.length).toBe(step.count);
      return;
    }
    case 'heard':
      await until(() => heard.some((m) => m.kind === step.kind), `a ${String(step.kind)} message`);
      return;
    case 'act': {
      const name = step.as as string;
      const action = {
        v: 1 as const,
        org: ORG,
        machine: services.machine.ref,
        device: 'a1',
        opId: bindings[`opId:${name}`] as string,
        opCreated: bindings[`created:${name}`] as string,
        action: step.action as string,
        ...(step.session === undefined ? {} : { session: step.session as string, context: { lane: 'A' as const, session: step.session as string, launch: step.launch as string } }),
        args: step.args as Record<string, unknown>,
        nonce: (bindings[`nonce:${name}`] as string | undefined) ?? base64urlEncode(new Uint8Array(16)),
        created: (bindings[`created:${name}`] as string | undefined) ?? new Date().toISOString(),
      };
      if (name === undefined) Object.assign(action, { opId: 'cmVmdXNlZC1vcC1pZC0wMDAx', opCreated: action.created });
      const sent = endpoint.rl10.rpc(action as never, { member: A, device: 'a1' }, (bindings[`fingerprint:${name}`] as string | undefined) ?? 'none');
      if (step.refused !== undefined) expect(sent).toEqual({ ok: false, reason: step.refused });
      else expect(sent.ok).toBe(true);
      if (name === 'spawn') bindings['proof:spawn'] = action;
      return;
    }
    case 'query':
      answer = endpoint.rl10.query(step.opId as string, step.opCreated as string | undefined);
      return;
    case 'tombstone':
      answer = endpoint.rl10.tombstone(step.opId as string, step.opCreated as string | undefined);
      return;
    case 'answered': {
      const got = await answer!;
      if (step.ok !== undefined) expect(got.ok).toBe(step.ok);
      else expect(got.state).toBe(step.state);
      if (step.member !== undefined) expect(got.member ?? null).toBe(step.member);
      return;
    }
    case 'restart': {
      await endpoint.stop();
      endpoint = await startEndpoint();
      await until(() => endpoint.hub.connected && fs.existsSync(join(services.machine.stateDir, 'rl10.json')), 'the restarted endpoint');
      bindings.token = rl10Info().token;
      return;
    }
    case 'not-rejected':
      expect(toHub.some((f) => f.t === 'rejected' && (f.event as { writer: string; seq: number } | null)?.seq === step.seq && (f.event as { writer: string }).writer === step.writer)).toBe(false);
      return;
    case 'add-device': {
      const device = devices[step.device as string];
      await accept((s) => void s.members.find((m) => m.id === B)!.devices.push(device.device));
      await until(() => endpoint.status().stateVersion === head.state.version, 'the new head');
      return;
    }
    case 'revoke': {
      const device = devices[step.device as string];
      const revoked = await revokedDevice(B, device.device);
      await accept((s) => {
        const member = s.members.find((m) => m.id === B)!;
        member.devices = member.devices.filter((d) => d.id !== device.device.id);
        s.revoked.push(...revoked);
      });
      await until(() => endpoint.status().stateVersion === head.state.version, 'the new head');
      return;
    }
    default:
      throw new Error(`no scene ${step.scene}`);
  }
};

it('replays the conversation O12 copies, line for line', async () => {
  const bindings = await runBindings();
  for (const c of conversation.cases) await replayCase(c, { socket: () => rl10Info().socket, scenes, bindings, connections });
  // Nothing secret reached a log line.
  const log = services.lines.join('\n');
  expect(log).not.toContain(legacyKey);
  expect(log).not.toContain(bindings.token as string);
}, 120_000);
