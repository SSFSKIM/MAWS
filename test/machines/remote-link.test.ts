// The app's RL2 link against a real endpoint (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Proves"; acceptance 1): the endpoint's own harness (test/endpoint/sub-harness.ts: the endpoint with a fake engine host
// and the real RL10 socket with a fake sminos) on its direct listener at loopback, in its tailnet address's place, and
// main's link in place of O10's test device, driven by the profile's real device keys (`loadDeviceKeys`, its backup
// exclusion injected) listed in the org as a second device of the machine's owner. No hub: the direct carrier only.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, keyId, memoryOrgView, type ByteDuplex, type SignedOrgState } from 'org-protocol';
import type { SessionEvent } from '@shared/graph/events';
import type { MachineRef } from '@shared/machine/ref';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadDeviceKeys, type DeviceKeys } from '../../src/main/device/keys';
import { createStepUp } from '../../src/main/device/step-up';
import { dialDirect } from '../../src/main/machines/remote/carriers';
import { createRemoteLink, type RemoteLink, type SubscriptionSink } from '../../src/main/machines/remote/link';
import { heldOrgSession, watchedView, type SignedIn } from '../../src/main/org/session';
import { EndpointOrg } from '../../src/endpoint/org-sync';
import { EndpointState } from '../../src/endpoint/state/store';
import { endorsed, iso, retiredDevice, successor, type TestDevice } from '../endpoint/org-fixtures';
import { CHECKOUT, cursorOf, makeOrg, openRemote, ORG, plane, sminos, startEndpoint, stopAll, until, type Fixture, type Org } from '../endpoint/sub-harness';

let org: Org;
const started: Fixture[] = [];
const links: RemoteLink[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  for (const link of links.splice(0)) link.close();
  await stopAll(started);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => stopAll(started));

/**
 * One carrier the test can cut, mute (its inbound bytes dropped, as a lost answer), rewrite (the first message, `h2`) or
 * hold (the message after `h2`, the endpoint's `caps`, until released).
 */
type Tap = { mute: boolean; rewrite?: (h2: Record<string, unknown>) => Record<string, unknown>; hold?: Promise<void>; endAs?: (reason: string) => void };
function tapped(inner: ByteDuplex, tap: Tap): ByteDuplex {
  let seen = 0;
  let queue: Promise<void> = Promise.resolve();
  const ends: Array<(reason: string) => void> = [];
  // The transport ends with a reason of its own choosing, as a socket's close frame or a relay's close carries one.
  tap.endAs = (reason) => {
    for (const listener of ends.splice(0)) listener(reason);
    inner.close('dropped');
  };
  return {
    send: (bytes) => inner.send(bytes),
    close: (reason) => inner.close(reason),
    onClose: (listener) => {
      ends.push(listener);
      inner.onClose?.((reason) => {
        if (ends.includes(listener)) listener(reason);
      });
    },
    onBytes: (listener) =>
      inner.onBytes((bytes) => {
        const index = seen++;
        queue = queue.then(async () => {
          if (tap.mute) return;
          if (index === 0 && tap.rewrite !== undefined) {
            const h2 = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
            return listener(new TextEncoder().encode(JSON.stringify(tap.rewrite(h2))));
          }
          if (index === 1 && tap.hold !== undefined) await tap.hold;
          listener(bytes);
        });
      }),
  };
}

/** A recording sink. */
function sink() {
  const heard: Array<[string, ...unknown[]]> = [];
  const s: SubscriptionSink = {
    subbed: (mode, at) => void heard.push(['subbed', mode, at]),
    snapshot: (at, value) => void heard.push(['snapshot', at, value]),
    event: (at, body) => void heard.push(['event', at, body]),
    paused: (reason) => void heard.push(['paused', reason]),
    resumed: () => void heard.push(['resumed']),
    ended: (reason) => void heard.push(['ended', reason]),
  };
  const events = () => heard.filter((x) => x[0] === 'event').map((x) => ({ at: x[1] as { epoch: string; seq: number; idx?: number }, body: x[2] }));
  return { s, heard, events };
}

type Lab = {
  f: Fixture;
  link: RemoteLink;
  session: ReturnType<typeof heldOrgSession>;
  signedIn: SignedIn;
  chain: SignedOrgState[];
  mac: TestDevice;
  keys: DeviceKeys;
  /** Every carrier the link dialled, newest last, with its tap. */
  carriers: Array<{ carrier: ByteDuplex; tap: Tap }>;
  /** The tap the next dial takes; reset to a plain one after it is taken. */
  next: Tap;
  port: { current: () => number };
  signs: number;
  logs: string[];
};

/** The endpoint, `app-1` held by the machine's owners with an app attached, and main's link up to it. */
/** Loopback is one source address for every handshake a suite makes: the listener's limit and the link's bucket raised. */
const OPEN = { perSource: { burst: 1000, perMinute: 60_000 }, overall: { burst: 1000, perMinute: 60_000 } };

async function lab(options: { up?: boolean } = {}): Promise<Lab> {
  const f = await startEndpoint(org, started, { limits: OPEN });
  const s = f.host.add('app-1');
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'] }, 'app-1');
  f.host.attach(true);
  const profile = mkdtempSync(join(tmpdir(), 'maws-o7-profile-'));
  dirs.push(profile);
  const keys = await loadDeviceKeys(profile, { excludeFromBackup: async () => true });
  const mac = await endorsed(ORG, org.A, { device: { id: 'mac1', class: 'native-mac', keyStorage: 'software', channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub }, channel: keys.channel, stepUp: keys.stepUp }, org.a1);
  const listed = await successor(f.chain.at(-1)!, [org.a1], (st) => void st.members.find((m) => m.id === org.A)!.devices.push(mac.device));
  await deliver(f, [listed]);
  const chain = [...f.chain, listed];
  const session = heldOrgSession();
  const l = {} as Lab;
  l.signs = 0;
  const stepUp = createStepUp({ device: { org: ORG, device: 'mac1' }, key: keys.stepUp, confirm: async () => (l.signs++, { ok: true }) });
  const signedIn: SignedIn = {
    identity: { org: ORG, member: org.A, device: 'mac1', clientClass: 'native-mac', channelKey: keys.channel, build: 'o7-m1', capabilities: [] },
    view: watchedView(memoryOrgView({ chain }), () => session.changed()),
    stepUp,
    hub: null,
  };
  session.set(signedIn);
  Object.assign(l, { f, session, signedIn, chain, mac, keys, carriers: [], next: { mute: false }, port: { current: () => f.port() }, logs: [] });
  l.link = createRemoteLink({
    machine: { ref: f.ref as MachineRef, name: 'mini' },
    session,
    records: { resolve: async () => ({ body: { org: ORG, machine: f.ref, addresses: ['ws://100.101.102.108:47830'], issued: iso(Date.now()) }, sig: { kid: 'k', alg: 'ES256', value: 'v' } }) as never },
    // The tailnet address, at the listener's loopback port in its place.
    dialDirect: async (_url, timeoutMs) => {
      const tap = l.next;
      l.next = { mute: false };
      const carrier = tapped(await dialDirect(`ws://127.0.0.1:${l.port.current()}`, timeoutMs), tap);
      l.carriers.push({ carrier, tap });
      return carrier;
    },
    timing: { DIRECT_BUCKET: OPEN.perSource },
    log: (line) => void l.logs.push(line),
  });
  links.push(l.link);
  if (options.up !== false) await until(() => l.link.state() === 'up', 'the link up', 10_000);
  return l;
}

/** A new head delivered to the endpoint as an admin's device carries it (`state` on its channel). */
async function deliver(f: Fixture, states: SignedOrgState[]): Promise<void> {
  const admin = await openRemote(f, org.a1, org.A);
  await admin.channel.send({ t: 'state', states, transitions: [] });
  const version = states.at(-1)!.state.version;
  await until(() => (f.endpoint.status().stateVersion ?? 0) >= version, 'the endpoint adopting the head');
  admin.channel.close('closed');
}

/** The next head: the machine's key replaced under the same ref, the old one retired. */
async function rotation(l: Lab): Promise<{ head: SignedOrgState; rotated: Awaited<ReturnType<typeof generateSigningKey>> }> {
  const rotated = await generateSigningKey(true);
  const head = await successor(l.chain.at(-1)!, [org.a1], async (st) => {
    st.retired.push({ keyId: await keyId(l.f.key.pub), pub: l.f.key.pub, notAfter: st.issued, holder: { machine: l.f.ref } });
    st.machines.find((m) => m.ref === l.f.ref)!.pub = rotated.pub;
  });
  return { head, rotated };
}

/** The endpoint re-keyed: its state given the new key and the new head, restarted under the same ref and services. */
async function rekey(l: Lab, head: SignedOrgState, rotated: Awaited<ReturnType<typeof generateSigningKey>>): Promise<void> {
  const kid = await keyId(rotated.pub);
  await l.f.endpoint.stop();
  started.splice(started.indexOf(l.f), 1);
  const state = EndpointState.open(l.f.services.machine.stateDir);
  state.setMachineKey({ version: 1, keyId: kid, jwk: (await crypto.subtle.exportKey('jwk', rotated.privateKey)) as JsonWebKey, created: iso(Date.now()) });
  state.setLedger({ version: 1, heldKeys: [await keyId(l.f.key.pub), kid], grants: {}, highWater: {} });
  await new EndpointOrg(state, { log: () => {} }).adopt([...l.chain, head], []);
  const again = await startEndpoint(org, started, { services: l.f.services, host: l.f.host, records: l.f.records, chain: [...l.chain, head], key: rotated, limits: OPEN });
  l.port.current = () => again.port();
}

const drop = (l: Lab) => l.carriers.at(-1)!.carrier.close('dropped');
const send = (l: Lab, content: string) =>
  l.link.act({ action: 'session.send', session: 'app-1', context: { lane: 'B', launchId: l.f.host.session('app-1').launchId, engineSessionId: l.f.host.session('app-1').engineSessionId! }, args: { appSessionId: 'app-1', content } });

describe('the link over the direct carrier', { timeout: 30_000 }, () => {
  it('comes up and reads caps', async () => {
    const l = await lab();
    expect(l.link.carrier()).toBe('direct');
    await until(() => l.link.caps(), 'caps');
    expect(l.link.caps()).toMatchObject({ member: org.A, device: 'mac1', clientClass: 'native-mac', machine: { grades: expect.any(Array) } });
  });

  it('answers a call with the endpoint’s answer', async () => {
    const l = await lab();
    const answer = await l.link.call('session.status', { appSessionId: 'app-1' });
    expect(answer).toMatchObject({ ok: true, output: { appSessionId: 'app-1', launchId: l.f.host.session('app-1').launchId } });
  });

  it('runs a lane B send once when its channel is dropped before the ack: resealed, the engine host’s ledger runs it once', async () => {
    const l = await lab();
    l.f.host.hold('session.status');
    const handle = send(l, 'once');
    await until(() => l.f.host.calls.some((c) => c.name === 'session.status'), 'the endpoint checking the context');
    drop(l);
    l.f.host.release('session.status');
    expect(await handle.outcome).toMatchObject({ state: 'done', result: { disposition: 'queued' } });
    expect(l.f.host.runs.map((r) => r.content)).toEqual(['once']);
    expect(l.f.host.session('app-1').rows.flat().filter((e) => (e as unknown as { text: string }).text.startsWith('row'))).toHaveLength(1);
    expect(l.carriers.length).toBeGreaterThanOrEqual(2);
  });

  it('queries a send that ran but lost its ack and done when its session relaunched: the reseal is refused `context`, the ledger answers', async () => {
    const l = await lab();
    l.carriers.at(-1)!.tap.mute = true; // its answers never reach the link
    const handle = send(l, 'ran');
    await until(() => l.f.host.runs.length === 1, 'the first copy run');
    const first = l.f.host.runs[0];
    l.f.host.relaunch('app-1');
    drop(l);
    expect(await handle.outcome).toMatchObject({ state: 'done', result: { disposition: 'queued', queueId: 'q1' } });
    expect(l.f.host.runs).toEqual([first]);
    expect(l.f.host.calls.filter((c) => c.name === 'host.opQuery')).not.toHaveLength(0);
  });

  it('retries past a forged `h2` (its protocol major, then its key id): each attempt fails, none stops the link', async () => {
    const l = await lab();
    const ups = () => l.logs.filter((line) => line.includes(': up over')).length;
    const forged = { kid: await keyId((await generateSigningKey()).pub) };
    l.next = { mute: false, rewrite: (h2) => ({ ...h2, protocol: { major: 2, minor: 0 } }) };
    drop(l);
    await until(() => ups() === 2, 'up again after the forged major', 10_000);
    expect(l.logs.some((line) => line.includes('failed: protocol'))).toBe(true);
    // A key id that names another key, as `h2.sig.kid` too: the device's head holds no such machine key.
    l.next = { mute: false, rewrite: (h2) => ({ ...h2, keyId: forged.kid, sig: { ...(h2.sig as object), kid: forged.kid } }) };
    drop(l);
    await until(() => ups() === 3, 'up again after the forged key id', 15_000);
    expect(l.logs.some((line) => line.includes('failed: unknown-machine'))).toBe(true);
    expect(l.link.refusal()).toBeNull();
  });

  it('closes the live channel when the org retires the machine key it was made under, and comes up only against the new key', async () => {
    const l = await lab();
    const ups = () => l.logs.filter((line) => line.includes(': up over')).length;
    const { head, rotated } = await rotation(l);
    await l.signedIn.view.advance([head], []);
    await until(() => l.logs.some((line) => line.includes('authenticating again')), 'the trust generation raised');
    await until(() => l.carriers.length > 1 && l.link.carrier() === null, 'the live channel closed');
    // The endpoint still speaks with the retired key: every attempt fails, judged against the new head.
    await until(() => l.logs.some((line) => line.includes('failed: unknown-machine')), 'an attempt refused against the new key');
    expect(ups()).toBe(1);
    await rekey(l, head, rotated);
    l.link.probe('person');
    await until(() => ups() === 2, 'up against the new key', 15_000);
    expect(l.link.carrier()).toBe('direct');
  });

  it('discards an attempt that completes under the trust generation before a change', async () => {
    const l = await lab();
    const ups = () => l.logs.filter((line) => line.includes(': up over')).length;
    // An attempt in flight: the endpoint's first sealed message (`caps`) held while the org session adopts a rotated head.
    let release!: () => void;
    l.next = { mute: false, hold: new Promise<void>((resolve) => (release = resolve)) };
    const before = l.carriers.length;
    drop(l);
    await until(() => l.carriers.length === before + 1, 'the next attempt dialled');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { head } = await rotation(l);
    await l.signedIn.view.advance([head], []);
    await until(() => l.logs.some((line) => line.includes('authenticating again')), 'the trust generation raised');
    release();
    // The attempt completes against the endpoint's old key and is closed, never adopted.
    await until(() => l.f.endpoint.status().channels.direct === 0, 'the discarded channel closed');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ups()).toBe(1);
    expect(l.link.carrier()).toBeNull();
  });

  it('resumes a lane B subscription across forced drops, a drop between two events of one row included: every event once, at its producer’s cursor', async () => {
    const l = await lab();
    const before = [...l.f.host.row('app-1', 2), ...l.f.host.row('app-1', 1)];
    const watch = sink();
    const sub = l.link.subscribe({ session: { lane: 'B', id: 'app-1' } }, watch.s);
    await until(() => watch.events().length === 3, 'the launch’s events');
    // One row of three, its first event live, then a drop, then the rest.
    const s = l.f.host.session('app-1');
    const seq = s.rows.length + 1;
    const row = Array.from({ length: 3 }, (_, i) => l.f.host.event(s, seq, i, { kind: 'note', text: `split ${i}` }));
    s.rows.push(row);
    l.f.host.batches('app-1', row.slice(0, 1));
    await until(() => watch.events().length === 4, 'the row’s first event');
    drop(l);
    l.f.host.batches('app-1', row.slice(1));
    await until(() => watch.events().length === 6, 'the rest of the row after the resume', 10_000);
    drop(l);
    const after = l.f.host.row('app-1', 2);
    await until(() => watch.events().length === 8, 'events after a second drop', 10_000);
    const expected = [...before, ...row, ...after] as SessionEvent[];
    expect(watch.events().map((e) => [e.at.epoch, e.at.seq, e.at.idx])).toEqual(expected.map((e) => Object.values(cursorOf(e))));
    expect(watch.events().map((e) => (e.body as SessionEvent).id)).toEqual(expected.map((e) => e.id));
    expect(sub.cursor()).toEqual(cursorOf(after.at(-1)!));
  });

  it('carries a lane A `full` subscription and a `sminos.rows` call naming it', async () => {
    const l = await lab();
    const s = await sminos(l.f);
    const watch = sink();
    const sub = l.link.subscribe({ session: { lane: 'A', id: 'la-1' }, view: 'full' }, watch.s);
    const up = await s.next((x) => x.t === 'subscribe', 'the upstream subscribe');
    s.send(plane('snapshot', { rows: [], more: true, subagents: [], presence: { record: null, bridge: true }, streaming: [] }, { sub: up.sub as string, n: 0 }));
    await until(() => watch.heard.some((x) => x[0] === 'snapshot'), 'the lane A snapshot');
    expect(await l.link.call('sminos.rows', { session: 'la-1', sub: sub.id, before: 'r9', limit: 50 })).toMatchObject({ ok: true });
    expect(await s.next((x) => x.t === 'rows', 'rows down')).toMatchObject({ t: 'rows', session: 'la-1', sub: up.sub, before: 'r9', limit: 50 });
  });

  it('stops `removed` when a new head drops this device, with no attempt after it until the org session changes', async () => {
    const l = await lab();
    const dropped = await successor(l.chain.at(-1)!, [org.a1], async (st) => {
      const a = st.members.find((m) => m.id === org.A)!;
      a.devices = a.devices.filter((d) => d.id !== 'mac1');
      st.retired.push(...(await retiredDevice(org.A, l.mac.device, st.issued)));
    });
    await deliver(l.f, [dropped]);
    await until(() => l.link.refusal() === 'removed', 'the link refused');
    expect(l.link.state()).toBe('down');
    const dialled = l.carriers.length;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    l.link.probe('wake');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(l.carriers).toHaveLength(dialled);
    l.session.changed();
    await until(() => l.carriers.length > dialled, 'an attempt once the session changed');
  });

  it('signs an `if-asked` act through the injected signer after a `step-up` refusal, under the same opId', async () => {
    const l = await lab();
    const s = await sminos(l.f);
    const handle = l.link.act({ action: 'sminos.spawn', args: { checkout: CHECKOUT, brief: 'do the thing' } });
    // The unsigned copy is refused `step-up` before sminos is asked; the signed one is admitted once sminos says it
    // holds nothing of the op (its admission query), then accepted.
    const admission = await s.next((x) => x.t === 'query' && x.opId === handle.opId, 'the signed copy’s admission query');
    expect(l.signs).toBe(1);
    s.send({ t: 'queried', opId: admission.opId as string, state: 'not-received' });
    await until(() => handle.progress() === 'accepted', 'the signed copy accepted');
    const rpc = await s.next((x) => x.t === 'rpc', 'the spawn handed to sminos');
    expect(JSON.stringify(rpc)).toContain(handle.opId);
  });

  it('leaves every stream standing after a call with no input', async () => {
    const l = await lab();
    const watch = sink();
    l.link.subscribe({ session: { lane: 'B', id: 'app-1' } }, watch.s);
    await until(() => watch.heard.some((x) => x[0] === 'snapshot'), 'the snapshot');
    const answer = await l.link.call('machine.identity', undefined);
    // Answered (the fake services leave machine.identity unanswered, `unavailable`), not a channel closed `malformed`.
    expect(answer).toEqual({ ok: false, error: { code: 'unavailable' } });
    const live = l.f.host.row('app-1', 1);
    await until(() => watch.events().some((e) => (e.body as SessionEvent).id === live[0].id), 'a live event after the void call');
    expect(l.carriers).toHaveLength(1);
  });

  it('reads a carrier’s own close, whatever reason it gives, as a loss: never `removed`', async () => {
    const l = await lab();
    // The carrier ended by its transport with the reason `removed`: no sealed close.
    l.carriers.at(-1)!.tap.endAs!('removed');
    await until(() => l.carriers.length === 2 && l.link.state() === 'up', 'up again', 10_000);
    expect(l.link.refusal()).toBeNull();
  });
});
