// The hub, for the four acts on a file outside a session's folders (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, condition (f)'s second half; M2's "The
// hub"): over the relay carrier, the path and the content stay out of the hub. A started endpoint is enrolled with the
// stand-in hub (fake-hub.ts), which welcomes its RL1 socket, keeps every frame it carries both ways (`received`, `sent`)
// and every HTTP request it receives (`requests`: the endpoint's hub calls go to its server). The test plays the hub's
// relay half for a device's channel: the device's bytes go down the endpoint's socket as the hub's `open` and `data`
// channel frames, and the endpoint's channel frames come back to the device. The machine's services run each act under
// the services' own ledger with stand-in handlers that answer invented text.
//
// The search is shown able to fail: what does cross the hub in the clear (the device's handshake carries its build,
// which this test sets to the act's path; the endpoint's handshake its capabilities; a request to the hub's server its
// body) is found where it crossed.
import { CHANNEL_CLOSE, decodeChannelFrame, encodeChannelFrame, generateSigningKey, keyId, memoryOrgView, NO_CERTIFICATES, type Action, type ByteDuplex, type Channel, type ChannelMessage, type SignedOrgState } from 'org-protocol';
import type { RawData } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import { OUTSIDE_FILES_CAPABILITY } from '@shared/files/outside';
import type { HandlerContext } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { OpLedger } from '@shared/host/op-ledger';
import type { CommandInput } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { EndpointOrg } from '../../src/endpoint/org-sync';
import { EndpointState } from '../../src/endpoint/state/store';
import { machineOps } from '../../src/services/machine-ops';
import { FakeHub, until, type HttpCall, type Received } from './fake-hub';
import { fakeServices } from './fake-services';
import { genesis, iso, memberId, newDevice, successor, type TestDevice } from './org-fixtures';

const ORG = 'org-u6f-hub';
const APP = 'app-elsewhere';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// invented paths and text, each in nothing but the acts and their answers
const PATH = '/srv/u6f-hub/harbour-notes-7f3a.txt';
const FOLDER = '/srv/u6f-hub/charts-folder-91c2';
const READ_TEXT = 'the keeper logged eleven ships at dusk';
const LISTED = 'lantern-room-ledger-4d';
const SAVED = 'a tide line written for the hub test';

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** The machine's services: `machine.op` over a real ledger in the state directory, the four answered by stand-ins. */
function services() {
  const services = fakeServices();
  closers.push(() => services.cleanup());
  const ran: string[] = [];
  const handlers: Record<string, (input: unknown) => unknown> = {
    'files.readOutside': () => ({ encoding: 'utf8', content: READ_TEXT, bytes: READ_TEXT.length, offset: 0, length: READ_TEXT.length, truncated: false, mime: 'text/plain', hash: null, utf8: null, named: true, outside: { real: PATH, writable: true } }),
    'files.listOutside': () => ({ status: 'listed', path: FOLDER, parent: '/srv/u6f-hub', home: '/home/someone', entries: [{ name: LISTED, path: `${FOLDER}/${LISTED}`, kind: 'dir', protected: false }], cursor: null }),
    'files.chooseOutside': () => ({ status: 'granted', path: PATH }),
    'files.writeOutside': () => ({ status: 'ok', hash: 'c'.repeat(64) }),
  };
  const ops = machineOps({
    ledger: OpLedger.open(services.machine.stateDir, 'spine-ops.jsonl'),
    invoke: (async (name: string, input: unknown) => {
      ran.push(name);
      return handlers[name] === undefined ? { ok: false, error: { code: 'unknown_command', message: name } } : { ok: true, value: handlers[name](input) };
    }) as never,
  });
  const ok = (value: unknown): HostResponse => ({ t: 'res', id: '0', ok: true, value });
  services.dispatch = async (owner, name, input) => {
    if (owner === 'machine' && (name === 'machine.op' || name === 'machine.opQuery')) {
      const checked = validateCommandInput(name, input);
      if (!checked.ok) return { t: 'res', id: '0', ok: false, error: { code: 'invalid_input', message: name } };
      return ok(name === 'machine.op' ? await ops.op(checked.value as CommandInput<'machine.op'>, { client: {} } as HandlerContext) : ops.opQuery(checked.value as CommandInput<'machine.opQuery'>));
    }
    return { t: 'res', id: '0', ok: false, error: { code: 'unknown_command', message: name } };
  };
  return { services, ran };
}

/** An endpoint enrolled with the stand-in hub, its RL1 socket welcomed; A owns the machine. */
async function world() {
  const A = memberId();
  const a1: TestDevice = await newDevice('a1');
  const recovery = await generateSigningKey();
  const { services: machine, ran } = services();
  const ref = machine.machine.ref;
  const key = await generateSigningKey(true);
  const kid = await keyId(key.pub);
  const s1 = await genesis(ORG, A, a1, recovery);
  const s2 = await successor(s1, [a1], (s) => {
    s.machines.push({ name: 'studio', ref, pub: key.pub, owners: [A] });
    s.machineNames.push({ name: 'studio', ref });
  });
  const chain: SignedOrgState[] = [s1, s2];
  const hub = await new FakeHub().start();
  closers.push(() => hub.close());
  const state = EndpointState.open(machine.machine.stateDir);
  state.setMachineKey({ version: 1, keyId: kid, jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey, created: iso(Date.now()) });
  state.setLedger({ version: 1, heldKeys: [kid], grants: {}, highWater: {} });
  state.setEnrollment({ version: 1, state: 'org-listed', name: 'studio', ref, org: ORG, hub: hub.url, enrollment: 'e'.repeat(32), credentials: { clientId: 'id', clientSecret: 'secret' }, at: iso(Date.now()) });
  state.setOrg({ version: 1, org: ORG, pinned: { roots: s1.state.root.keys, recoveryPub: recovery.pub }, head: null, chain: [], hashes: [], certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
  await new EndpointOrg(state, { log: () => {} }).adopt(chain, []);
  // its hub calls go to the stand-in's own server, which keeps each one
  const endpoint: Endpoint = createEndpoint({ env: {}, sleep: (ms) => sleep(Math.min(ms, 50)) });
  await endpoint.start(machine);
  closers.push(() => endpoint.stop());
  await until(() => endpoint.links.hub.connected, 'the RL1 welcome');

  let nextChannel = 1;
  /** A's device on a channel the test relays through the hub's socket, as the hub's machine multiplex carries one. */
  async function relayed(build = 'u6f-hub'): Promise<{ device: Device; channel: Channel; inbox: ChannelMessage[] }> {
    const id = nextChannel++;
    const device = new Device({
      identity: { org: ORG, member: A, device: a1.device.id, clientClass: 'native-mac', channelKey: a1.channel, build, capabilities: [] },
      org: memoryOrgView({ chain: [...chain] }),
      stepUpKey: a1.stepUp,
    });
    const channel = await device.open(async () => relayCarrier(hub, id), ref);
    const inbox: ChannelMessage[] = [];
    channel.onMessage((m) => void inbox.push(m));
    return { device, channel, inbox };
  }
  return { hub, ref, ran, relayed };
}

/** The hub's relay half for one channel: the device's first message opens it, the rest are its data, either end closes it. */
function relayCarrier(hub: FakeHub, id: number): ByteDuplex {
  const socket = hub.current;
  let opened = false;
  const listeners: Array<(bytes: Uint8Array) => void> = [];
  const ends: Array<(reason: string) => void> = [];
  socket.on('message', (data: RawData, isBinary: boolean) => {
    if (!isBinary) return;
    const frame = decodeChannelFrame(new Uint8Array(data as Buffer));
    if (frame === null || frame.channel !== id) return;
    if (frame.type === 'close') return void ends.forEach((end) => end('closed'));
    if (frame.type === 'data') listeners.forEach((listener) => listener(frame.payload.slice()));
  });
  return {
    send(bytes) {
      socket.send(encodeChannelFrame(opened ? 'data' : 'open', id, bytes));
      opened = true;
    },
    onBytes: (listener) => void listeners.push(listener),
    onClose: (listener) => void ends.push(listener),
    close: () => socket.send(encodeChannelFrame('close', id, CHANNEL_CLOSE.closed)),
  };
}

/** An owner's act sent on the channel and its outcome, from its `done`. */
async function run(r: { device: Device; channel: Channel; inbox: ChannelMessage[] }, ref: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const action: Action = r.device.action({ machine: ref, action: name, args });
  await r.channel.send({ t: 'act', action });
  const done = await until(() => r.inbox.some((m) => m.t === 'done' && m.opId === action.opId), `the done of ${name}`).then(() => r.inbox.find((m) => m.t === 'done' && m.opId === action.opId)!);
  return (done as unknown as { outcome: unknown }).outcome;
}

/** Each place the hub kept something that holds `text`: as it is, or in base64 or base64url. */
function heldBy(hub: FakeHub, text: string): string[] {
  const forms = [text, Buffer.from(text).toString('base64'), Buffer.from(text).toString('base64url')];
  const holds = (bytes: string) => forms.some((form) => bytes.includes(form));
  const ofFrame = (r: Received) => ('frame' in r ? JSON.stringify(r.frame) : r.binary.toString('latin1') + r.binary.toString('utf8'));
  const ofCall = (c: HttpCall) => `${c.method} ${c.url} ${JSON.stringify(c.headers)} ${c.body.toString('utf8')}`;
  return [...(hub.received.some((r) => holds(ofFrame(r))) ? ['received'] : []), ...(hub.sent.some((r) => holds(ofFrame(r))) ? ['sent'] : []), ...(hub.requests.some((c) => holds(ofCall(c))) ? ['requests'] : [])];
}

describe('the four acts over the relay carrier', () => {
  it('leave their paths and their content out of everything the hub carried and was asked; what crosses in the clear is found', async () => {
    const { hub, ref, ran, relayed } = await world();
    const a = await relayed();
    // the four ran on the machine, their answers back to the device through the hub
    expect(await run(a, ref, 'files.readOutside', { appSessionId: APP, path: PATH })).toMatchObject({ state: 'done', result: { content: READ_TEXT } });
    expect(await run(a, ref, 'files.listOutside', { appSessionId: APP, path: FOLDER })).toMatchObject({ state: 'done', result: { entries: [{ name: LISTED }] } });
    expect(await run(a, ref, 'files.chooseOutside', { appSessionId: APP, path: PATH })).toEqual({ state: 'done', result: { status: 'granted', path: PATH } });
    expect(await run(a, ref, 'files.writeOutside', { appSessionId: APP, path: PATH, content: SAVED, expectedHash: 'a'.repeat(64), real: PATH })).toEqual({ state: 'done', result: { status: 'ok', hash: 'c'.repeat(64) } });
    expect(ran).toEqual(['files.readOutside', 'files.listOutside', 'files.chooseOutside', 'files.writeOutside']);
    // the hub carried the channel both ways, and was asked by the endpoint
    expect(hub.sent.filter((r) => 'binary' in r).length).toBeGreaterThan(4);
    expect(hub.received.filter((r) => 'binary' in r).length).toBeGreaterThan(4);
    expect(hub.requests.length).toBeGreaterThan(0);
    for (const text of [PATH, FOLDER, READ_TEXT, LISTED, SAVED]) expect([text, heldBy(hub, text)]).toEqual([text, []]);

    // the control: what does cross in the clear is found where it crossed
    expect(heldBy(hub, OUTSIDE_FILES_CAPABILITY)).toEqual(['received']); // the endpoint's handshake lists it
    await relayed(PATH); // a device's handshake carries its build: here the act's path
    expect(heldBy(hub, PATH)).toEqual(['sent']);
    await fetch(`${hub.url}/control`, { method: 'POST', body: SAVED }).then((response) => response.arrayBuffer());
    expect(heldBy(hub, SAVED)).toEqual(['requests']);
  });
});
