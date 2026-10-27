// RL2's channel (channel.ts, frames.ts) end to end over an in-memory carrier: the handshake both ways, org-state
// catch-up a page at a time, the sealed frames with their one sequence per direction and the ratcheting rekey, and each
// refusal, named by the first check that refuses it. The committed vectors pin the bytes (vectors.test.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical.ts';
import {
  acceptChannel,
  ChannelError,
  connectChannel,
  HANDSHAKE_PAGE_BYTES,
  openChannel,
  type ByteDuplex,
  type Channel,
  type DeviceIdentity,
  type HandshakeOptions,
  type MachineIdentity,
} from '../src/channel.ts';
import { FRAME_PLAINTEXT_MAX, FrameOpener, FrameSealer, REKEY_FRAMES, REKEY_MS, rekeyDirection, sealFrame, type DirectionKeys } from '../src/frames.ts';
import { generateSigningKey, importSigningKey, keyId, utf8 } from '../src/keys.ts';
import { advanceHead, memoryOrgView } from '../src/org-view.ts';
import { endorseDevice, signOrgState, signTransition, stateHash } from '../src/org-state.ts';
import { VECTOR_KEYS, VECTORS } from '../vectors/index.ts';
import { CHANNEL_HEADER_BYTES, RL1_MESSAGE_LIMIT } from '../src/relay.ts';
import type { OrgState, RootTransition, Signed, SignedOrgState } from '../src/types.ts';
import { actionFingerprint, verifyStepUp } from '../src/action.ts';
import { readMessage } from '../src/messages.ts';
import { duplexPair, TamperRelay } from '../test-support/tamper-relay.ts';
import { TestDevice } from '../test-support/test-device.ts';
import { buildRemoteOrg, KEY_NAMES, REF_MINI, type Keys, type RemoteOrg } from '../vectors/scenario.ts';

let keys: Keys;
let org: RemoteOrg;

beforeAll(async () => {
  keys = {} as Keys;
  for (const name of KEY_NAMES) keys[name] = await generateSigningKey(true);
  org = await buildRemoteOrg(keys);
});

const NOW = () => new Date('2026-10-28T00:00:00.000Z');
const chain = (to: keyof RemoteOrg['states']) => org.chain.slice(0, org.chain.findIndex((s) => s === org.states[to]) + 1);
const view = (to: keyof RemoteOrg['states']) => memoryOrgView({ chain: chain(to) });
const machine = (): MachineIdentity => ({ ref: REF_MINI, key: keys.mini, build: 'mawsd-test', capabilities: ['rl3'] });
const device = (id: 'a1' | 'b2' | 'c1' | 'stranger', clientClass: DeviceIdentity['clientClass'] = 'native-mac'): DeviceIdentity => {
  const of = { a1: [org.members.A, keys.a1Channel], b2: [org.members.B, keys.b2Channel], c1: [org.members.C, keys.c1Channel], stranger: [org.members.A, keys.stranger] } as const;
  const [member, channelKey] = of[id];
  return { org: org.id, member, device: id === 'stranger' ? 'dev-unknown' : `dev-${id}`, clientClass, channelKey, build: 'test-device', capabilities: ['cards'] };
};
const options = (extra: Partial<HandshakeOptions> = {}): HandshakeOptions => ({ now: NOW, timeoutMs: 2_000, ...extra });

/** Both ends over one carrier; the endpoint sends `caps` first, as M4's does. */
async function connect(io: [ByteDuplex, ByteDuplex], deviceSide = view('r3'), endpointSide = view('r3'), who = device('a1'), extra: Partial<HandshakeOptions> = {}) {
  const accepting = acceptChannel(io[1], machine(), endpointSide, options(extra)).then(async (accepted) => {
    await accepted.channel.send({ t: 'caps', member: accepted.peer.member });
    return accepted;
  });
  const opening = openChannel(io[0], who, deviceSide, { ...options(extra), machine: REF_MINI });
  const [accepted, opened] = await Promise.allSettled([accepting, opening]);
  return { accepted, opened };
}

const next = (channel: Channel) => new Promise<Record<string, unknown>>((resolve) => {
  const off = channel.onMessage((message) => {
    off();
    resolve(message);
  });
});
const closed = (channel: Channel) => new Promise<string>((resolve) => channel.onClose((reason) => resolve(reason)));
const refusal = (settled: PromiseSettledResult<unknown>) => (settled.status === 'rejected' && settled.reason instanceof ChannelError ? settled.reason.reason : settled.status);

describe('the frames', () => {
  const keysOf = (fill: number): DirectionKeys => ({ key: new Uint8Array(32).fill(fill), iv: new Uint8Array(4).fill(fill + 1) });
  const sealAll = async (sealer: FrameSealer, n: number) => {
    const out: Uint8Array[] = [];
    for (let i = 0; i < n; i++) out.push(await sealer.seal(Uint8Array.from([0, i])));
    return out;
  };

  it('open in sequence, under one counter per direction from 0', async () => {
    const frames = await sealAll(new FrameSealer(keysOf(1)), 3);
    const opener = new FrameOpener(keysOf(1));
    for (let i = 0; i < 3; i++) expect(await opener.open(frames[i])).toEqual({ ok: true, plaintext: Uint8Array.from([0, i]) });
    expect([...frames[2].subarray(0, 10)]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
  });

  it('refuse a sequence skipped, repeated or reordered', async () => {
    const frames = await sealAll(new FrameSealer(keysOf(1)), 3);
    const at = async (order: number[]) => {
      const opener = new FrameOpener(keysOf(1));
      let last: unknown;
      for (const i of order) last = await opener.open(frames[i]);
      return last;
    };
    expect(await at([0, 2])).toEqual({ ok: false, reason: 'sequence' });
    expect(await at([0, 0])).toEqual({ ok: false, reason: 'sequence' });
    expect(await at([1])).toEqual({ ok: false, reason: 'sequence' });
  });

  it('rekey after 2^20 frames in an epoch, the sequence continuing, by a one-way ratchet', async () => {
    const start = { epoch: 0, seq: REKEY_FRAMES - 1, epochFrames: REKEY_FRAMES - 1 };
    const frames = await sealAll(new FrameSealer(keysOf(1), start), 2);
    expect([frames[0][1], frames[1][1]]).toEqual([0, 1]);
    const opener = new FrameOpener(keysOf(1), { epoch: 0, seq: REKEY_FRAMES - 1 });
    expect((await opener.open(frames[0])).ok).toBe(true);
    expect(await opener.open(frames[1])).toEqual({ ok: true, plaintext: Uint8Array.from([0, 1]) });
    const ratcheted = await rekeyDirection(keysOf(1));
    expect(await sealFrame(ratcheted, 1, REKEY_FRAMES, Uint8Array.from([0, 1]))).toEqual(frames[1]);
  });

  it("refuse an epoch's last frame dropped before the next epoch's first, and an epoch jump of two", async () => {
    const start = { epoch: 0, seq: REKEY_FRAMES - 2, epochFrames: REKEY_FRAMES - 2 };
    const frames = await sealAll(new FrameSealer(keysOf(1), start), 3);
    const opener = new FrameOpener(keysOf(1), { epoch: 0, seq: REKEY_FRAMES - 2 });
    expect((await opener.open(frames[0])).ok).toBe(true);
    expect(await opener.open(frames[2])).toEqual({ ok: false, reason: 'sequence' });
    const two = await rekeyDirection(await rekeyDirection(keysOf(1)));
    const jump = await sealFrame(two, 2, 0, Uint8Array.from([0]));
    expect(await new FrameOpener(keysOf(1)).open(jump)).toEqual({ ok: false, reason: 'epoch' });
  });

  it('rekey after 24 hours, and the receiver needs no notice of it', async () => {
    let now = 0;
    const sealer = new FrameSealer(keysOf(1), { now: () => now });
    const first = await sealer.seal(Uint8Array.from([0]));
    now = REKEY_MS;
    const second = await sealer.seal(Uint8Array.from([0]));
    expect([first[1], second[1]]).toEqual([0, 1]);
    const opener = new FrameOpener(keysOf(1));
    expect((await opener.open(first)).ok).toBe(true);
    expect((await opener.open(second)).ok).toBe(true);
  });

  it('refuse an altered tag, and a frame over 256 KiB of plaintext', async () => {
    const [frame] = await sealAll(new FrameSealer(keysOf(1)), 1);
    const altered = Uint8Array.from(frame);
    altered[altered.length - 1] ^= 1;
    expect(await new FrameOpener(keysOf(1)).open(altered)).toEqual({ ok: false, reason: 'tag' });
    const big = await sealFrame(keysOf(1), 0, 0, new Uint8Array(FRAME_PLAINTEXT_MAX + 1));
    expect(await new FrameOpener(keysOf(1)).open(big)).toEqual({ ok: false, reason: 'too-large' });
  });
});

describe('a channel', () => {
  it('opens with each side authenticated, and carries messages both ways', async () => {
    const { accepted, opened } = await connect(duplexPair());
    if (accepted.status !== 'fulfilled' || opened.status !== 'fulfilled') throw new Error(`${refusal(accepted)} ${refusal(opened)}`);
    const { channel: endpoint, peer } = accepted.value;
    const deviceChannel = opened.value;
    expect(peer).toMatchObject({ member: org.members.A, device: 'dev-a1', clientClass: 'native-mac', stateVersion: 3, build: 'test-device', capabilities: ['cards'] });
    expect(deviceChannel.peer).toMatchObject({ build: 'mawsd-test', capabilities: ['rl3'], stateVersion: 3 });
    expect(endpoint.id).toBe(deviceChannel.id);
    expect(await next(deviceChannel)).toEqual({ t: 'caps', member: org.members.A });
    const got = next(endpoint);
    await deviceChannel.send({ t: 'call', id: '1', name: 'session.status', input: { appSessionId: 'x' } });
    expect(await got).toEqual({ t: 'call', id: '1', name: 'session.status', input: { appSessionId: 'x' } });
  });

  it('carries a message larger than a frame as parts', async () => {
    const { accepted, opened } = await connect(duplexPair());
    if (accepted.status !== 'fulfilled' || opened.status !== 'fulfilled') throw new Error('not opened');
    await next(opened.value);
    const body = 'x'.repeat(FRAME_PLAINTEXT_MAX * 2);
    const got = next(opened.value);
    await accepted.value.channel.send({ t: 'snap', body });
    expect(await got).toEqual({ t: 'snap', body });
  });

  it('closes both ends with the reason, a sealed close carrying its stateVersion', async () => {
    const { accepted, opened } = await connect(duplexPair());
    if (accepted.status !== 'fulfilled' || opened.status !== 'fulfilled') throw new Error('not opened');
    const reason = new Promise<[string, number | undefined]>((resolve) => opened.value.onClose((r, v) => resolve([r, v])));
    accepted.value.channel.close('restart', 7);
    expect(await reason).toEqual(['restart', 7]);
    await expect(opened.value.send({ t: 'ping', at: 1 })).rejects.toThrow(ChannelError);
  });

  it('delivers a sealed close that arrives just before the carrier ends, over a carrier with no timer turns', async () => {
    const { accepted, opened } = await connect(duplexPair({ turns: 'microtask' }));
    if (accepted.status !== 'fulfilled' || opened.status !== 'fulfilled') throw new Error(`${refusal(accepted)} ${refusal(opened)}`);
    const reason = new Promise<[string, number | undefined]>((resolve) => opened.value.onClose((r, v) => resolve([r, v])));
    accepted.value.channel.close('behind', 7);
    expect(await reason).toEqual(['behind', 7]);
  });

  it('refuses a device the state does not list, lists for another class, or has revoked', async () => {
    expect(refusal((await connect(duplexPair(), view('r3'), view('r3'), device('stranger'))).accepted)).toBe('unknown-device');
    expect(refusal((await connect(duplexPair(), view('r3'), view('r3'), device('a1', 'web-cards'))).accepted)).toBe('class');
    expect(refusal((await connect(duplexPair(), view('r3'), view('r4'), device('c1'))).accepted)).toBe('revoked');
  });

  it('refuses a machine whose ref or org the device did not ask for', async () => {
    const io = duplexPair();
    const accepting = acceptChannel(io[1], { ...machine(), ref: 'mref-other-000001' }, view('r3'), options());
    const opening = openChannel(io[0], device('a1'), view('r3'), { ...options(), machine: REF_MINI });
    expect(refusal((await Promise.allSettled([accepting]))[0])).toBe('wrong-machine');
    expect(refusal((await Promise.allSettled([opening]))[0])).toBe('closed');
  });

  it("refuses a machine key the device's state does not hold for the ref", async () => {
    const io = duplexPair();
    const accepting = acceptChannel(io[1], { ...machine(), key: keys.stranger }, view('r3'), options());
    const opening = openChannel(io[0], device('a1'), view('r3'), { ...options(), machine: REF_MINI });
    expect(refusal((await Promise.allSettled([opening]))[0])).toBe('unknown-machine');
    expect(refusal((await Promise.allSettled([accepting]))[0])).toBe('closed');
  });

  it('processes nothing but h1 before the handshake: a sealed-looking frame or a call closes it', async () => {
    const io = duplexPair();
    const accepting = acceptChannel(io[1], machine(), view('r3'), options());
    io[0].send(utf8(JSON.stringify({ t: 'call', id: '1', name: 'daemon.status', input: {} })));
    expect(refusal((await Promise.allSettled([accepting]))[0])).toBe('malformed');
  });

  it('refuses a peer of another major', async () => {
    const io = duplexPair();
    const accepting = acceptChannel(io[1], machine(), view('r3'), options());
    const h1 = { t: 'h1', protocol: { major: 2, minor: 0 }, build: 'x', capabilities: [], org: org.id, machine: REF_MINI, member: org.members.A, device: 'dev-a1', clientClass: 'native-mac', stateVersion: 3, e: keys.stranger.pub, n: 'A'.repeat(43) };
    io[0].send(utf8(canonicalize(h1)));
    expect(refusal((await Promise.allSettled([accepting]))[0])).toBe('protocol');
  });

  it('times out a silent peer', async () => {
    const io = duplexPair();
    const accepting = acceptChannel(io[1], machine(), view('r3'), options({ timeoutMs: 20 }));
    expect(refusal((await Promise.allSettled([accepting]))[0])).toBe('timeout');
  });
});

describe('org-state catch-up in the handshake', () => {
  it("brings a device behind the endpoint up in h2's page", async () => {
    const deviceSide = view('r1');
    const { opened } = await connect(duplexPair(), deviceSide, view('r3'));
    expect(opened.status).toBe('fulfilled');
    expect(deviceSide.head().state.version).toBe(3);
  });

  it("brings an endpoint behind the device up in h3's page, admitting a device it did not know", async () => {
    const endpointSide = view('r2');
    const { accepted } = await connect(duplexPair(), view('r3'), endpointSide, device('b2'));
    expect(accepted.status).toBe('fulfilled');
    expect(endpointSide.head().state.version).toBe(3);
  });

  it('spans two pages over two connections: the first closed behind with its page kept, the second admitted', async () => {
    const endpointSide = view('r1');
    const pageBytes = 1024 + Math.max(...(['r2', 'r3'] as const).map((n) => utf8(canonicalize(org.states[n])).length));
    const connections: string[] = [];
    let accepted: Promise<unknown> = Promise.resolve();
    const dial = () => {
      const io = duplexPair();
      accepted = acceptChannel(io[1], machine(), endpointSide, options({ pageBytes })).then(
        async ({ channel }) => {
          connections.push('admitted');
          await channel.send({ t: 'caps' });
        },
        (error: ChannelError) => connections.push(`${error.reason} ${error.stateVersion}`),
      );
      return io[0];
    };
    const channel = await connectChannel(dial, device('b2'), view('r3'), { ...options({ pageBytes }), machine: REF_MINI });
    await accepted;
    expect(connections).toEqual(['behind 2', 'admitted']);
    expect(endpointSide.head().state.version).toBe(3);
    expect(channel.peer.stateVersion).toBe(2);
  });

  /** Pages a catch-up of the device past an endpoint at `from`, one state per page, and lists each connection's end. */
  async function pagedCatchUp(endpointChain: SignedOrgState[], deviceChain: SignedOrgState[], who: DeviceIdentity, me = machine(), turns: 'timer' | 'microtask' = 'timer') {
    const endpointSide = memoryOrgView({ chain: endpointChain });
    const longest = [...endpointChain, ...deviceChain].map((s) => utf8(canonicalize(s)).length);
    const pageBytes = 1024 + Math.max(...longest);
    const connections: string[] = [];
    const settled: Promise<unknown>[] = [];
    const dial = () => {
      const io = duplexPair({ turns });
      settled.push(
        acceptChannel(io[1], me, endpointSide, options({ pageBytes })).then(
          async ({ channel }) => {
            connections.push('admitted');
            await channel.send({ t: 'caps' });
          },
          (error: ChannelError) => connections.push(error.reason === 'behind' ? `behind ${error.stateVersion}` : error.reason),
        ),
      );
      return io[0];
    };
    const channel = await connectChannel(dial, who, memoryOrgView({ chain: deviceChain }), { ...options({ pageBytes }), machine: REF_MINI });
    await Promise.all(settled);
    return { channel, connections, endpointSide };
  }

  /** r3 and a successor at version 4 that `edit` makes, signed by the admin. */
  async function successorOfR3(edit: (s: OrgState) => Promise<void>): Promise<SignedOrgState> {
    const s = structuredClone(org.states.r3.state);
    s.version = 4;
    s.prev = await stateHash(org.states.r3.state);
    s.issued = '2026-10-27T03:00:00.000Z';
    await edit(s);
    return signOrgState(s, [keys.a1StepUp]);
  }

  it('pages a catch-up over a carrier with no timer turns, its behind close kept ahead of the carrier ending', async () => {
    const { connections } = await pagedCatchUp([org.states.r1], [org.states.r1, org.states.r2, org.states.r3], device('b2'), machine(), 'microtask');
    expect(connections).toEqual(['behind 2', 'admitted']);
  });

  it("pages an endpoint whose entry for the device holds a key the device rotated beyond the first page", async () => {
    const rotated = await successorOfR3(async (s) => {
      const old = s.members[0].devices[0];
      const fresh = { ...old, channelPub: keys.a3Channel.pub };
      delete fresh.endorsement;
      s.members[0].devices[0] = { ...fresh, endorsement: await endorseDevice(org.id, org.members.A, fresh, keys.a1StepUp.privateKey, keys.a1StepUp.pub) };
      s.retired.push({ keyId: await keyId(old.channelPub), pub: old.channelPub, notAfter: '2026-10-27T03:00:00.000Z', holder: { member: org.members.A, device: old.id, class: old.class, key: 'channel' } });
    });
    const who = { ...device('a1'), channelKey: keys.a3Channel };
    const { connections, endpointSide } = await pagedCatchUp([org.states.r1], [org.states.r1, org.states.r2, org.states.r3, rotated], who);
    expect(connections).toEqual(['behind 2', 'behind 3', 'admitted']);
    expect(endpointSide.head().state.version).toBe(4);
  });

  it("pages a device whose state holds a machine key the machine rotated beyond h2's first page", async () => {
    const rotated = await successorOfR3(async (s) => {
      s.machines[0].pub = keys.miniRotated.pub;
      s.retired.push({ keyId: await keyId(keys.mini.pub), pub: keys.mini.pub, notAfter: '2026-10-27T03:00:00.000Z', holder: { machine: REF_MINI } });
    });
    const deviceChain = [org.states.r1];
    const endpointChain = [org.states.r1, org.states.r2, org.states.r3, rotated];
    const pageBytes = 1024 + Math.max(...endpointChain.map((st) => utf8(canonicalize(st)).length));
    const endpointSide = memoryOrgView({ chain: endpointChain });
    const deviceSide = memoryOrgView({ chain: deviceChain });
    let connections = 0;
    const dial = () => {
      connections++;
      const io = duplexPair();
      void acceptChannel(io[1], { ...machine(), key: keys.miniRotated }, endpointSide, options({ pageBytes })).then(({ channel }) => channel.send({ t: 'caps' }), () => {});
      return io[0];
    };
    const channel = await connectChannel(dial, device('a1'), deviceSide, { ...options({ pageBytes }), machine: REF_MINI });
    expect(channel.peer.stateVersion).toBe(4);
    expect(deviceSide.head().state.version).toBe(4);
    expect(connections).toBe(3);
  });

  it("closes a connection whose h3 is over the endpoint's page limit", async () => {
    const io = duplexPair();
    const accepting = acceptChannel(io[1], machine(), view('r1'), options({ pageBytes: 2048 }));
    void openChannel(io[0], device('b2'), view('r3'), { ...options(), machine: REF_MINI }).catch(() => {});
    expect(refusal((await Promise.allSettled([accepting]))[0])).toBe('too-large');
  });

  it('keeps one page within what RL1 carries', () => {
    expect(HANDSHAKE_PAGE_BYTES).toBe(RL1_MESSAGE_LIMIT - CHANNEL_HEADER_BYTES);
  });
});

describe('the tamper relay', () => {
  const opened = async (relay: TamperRelay) => {
    const { accepted, opened: device } = await connect([relay.device, relay.endpoint]);
    if (accepted.status !== 'fulfilled' || device.status !== 'fulfilled') throw new Error('not opened');
    await next(device.value);
    return { endpoint: accepted.value.channel, device: device.value };
  };

  for (const [tamper, reason] of [
    [{ flip: -1 }, 'tag'],
    ['drop', 'sequence'],
    ['repeat', 'sequence'],
    ['reorder', 'sequence'],
  ] as const) {
    it(`closes the channel on a frame it ${typeof tamper === 'string' ? `${tamper}s` : 'alters'}`, async () => {
      const relay = new TamperRelay();
      const { endpoint, device } = await opened(relay);
      const closing = closed(endpoint);
      relay.tamper('to-endpoint', tamper);
      await device.send({ t: 'ping', at: 1 });
      await device.send({ t: 'ping', at: 2 });
      expect(await closing).toBe(reason);
    });
  }

  it('holds one frame for a given time, then delivers it', async () => {
    const relay = new TamperRelay();
    const { endpoint, device } = await opened(relay);
    relay.tamper('to-endpoint', { holdMs: 30 });
    const started = Date.now();
    const got = next(endpoint);
    await device.send({ t: 'ping', at: 1 });
    expect(await got).toEqual({ t: 'ping', at: 1 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});

describe('the org view', () => {
  it('serializes concurrent advances, so a page that verified against an older head never lands after a newer one', async () => {
    for (const pages of [
      [[org.states.r2, org.states.r3, org.states.r4], [org.states.r2]],
      [[org.states.r2], [org.states.r2, org.states.r3, org.states.r4]],
    ]) {
      const v = view('r1');
      await Promise.all(pages.map((page) => v.advance(page, [])));
      expect(v.head().state.version).toBe(4);
      expect(v.since(1).states.map((s) => s.state.version)).toEqual([2, 3, 4]);
    }
  });

  it('takes only the transition that authorized the adopted successor, not another genuine one held beside it', async () => {
    const recovery = await importSigningKey(VECTOR_KEYS.recovery.jwk);
    const authorizing = VECTORS.fixtures['a rewind from a forged head by the pinned recovery key'] as Signed<RootTransition>;
    const other = await signTransition({ ...authorizing.body, newRootKeys: [VECTOR_KEYS.a4StepUp.pub], issued: '2026-10-27T09:00:00.000Z' }, recovery.privateKey, recovery.pub);
    const result = await advanceHead(VECTORS.fixtures['remote r3'] as SignedOrgState, [VECTORS.fixtures['remote r4 under the recovered root']], [other, authorizing]);
    expect(result.head.state.version).toBe(4);
    expect(result.transitions).toEqual([authorizing]);
  });

  it('takes only transitions the recovery key signed, never one a peer forged beside a successor', async () => {
    const forged = await signTransition({ org: org.id, fromVersion: 1, newRootKeys: [keys.a3StepUp.pub], issued: '2099-01-01T00:00:00.000Z' }, keys.stranger.privateKey, keys.stranger.pub);
    const result = await advanceHead(org.states.r1, [org.states.r2], [forged]);
    expect(result.head.state.version).toBe(2);
    expect(result.transitions).toEqual([]);
  });

  it('adopts every successor that verifies, and stops at one that does not', async () => {
    const v = view('r1');
    const forged: SignedOrgState = { ...org.states.r3, sigs: org.states.r2.sigs };
    await v.advance([org.states.r2, forged], []);
    expect(v.head().state.version).toBe(2);
    expect(v.since(1).states.map((s) => s.state.version)).toEqual([2]);
  });
});

describe('the test device', () => {
  it('opens a channel through a relay, asks and is answered, and signs a step-up the endpoint verifies', async () => {
    const relay = new TamperRelay();
    const endpointSide = view('r3');
    const accepted = acceptChannel(relay.endpoint, machine(), endpointSide, options()).then(async ({ channel }) => {
      await channel.send({ t: 'caps' });
      channel.onMessage(async (message) => {
        const read = readMessage('device', message);
        if (read.kind !== 'message') return;
        if (read.message.t === 'call') await channel.send({ t: 'result', id: read.message.id, ok: true, output: { echoed: read.message.input } });
        if (read.message.t === 'act') {
          const verdict = await verifyStepUp(read.message.action, keys.a1StepUp.pub);
          await channel.send(verdict.ok ? { t: 'ack', opId: read.message.action.opId, state: 'accepted' } : { t: 'ack', opId: read.message.action.opId, state: 'refused', reason: 'step-up' });
        }
      });
    });
    const tester = new TestDevice({ identity: device('a1'), org: view('r3'), stepUpKey: keys.a1StepUp, now: NOW });
    const channel = await tester.open(() => relay.device, REF_MINI, { timeoutMs: 2_000 });
    await accepted;
    const result = await tester.request(channel, { t: 'call', id: 'c1', name: 'daemon.status', input: { x: 1 } }, (m): m is { t: 'result'; id: string; output: unknown } => m.t === 'result');
    expect(result).toEqual({ t: 'result', id: 'c1', ok: true, output: { echoed: { x: 1 } } });
    const spawn = tester.action({ machine: REF_MINI, action: 'sminos.spawn', args: { checkout: '/w' } });
    const ack = await tester.request(channel, { t: 'act', action: await tester.stepUp(spawn) }, (m): m is { t: 'ack' } => m.t === 'ack');
    expect(ack).toEqual({ t: 'ack', opId: spawn.opId, state: 'accepted' });
    const resealed = tester.reseal(spawn);
    expect(resealed.opId).toBe(spawn.opId);
    expect(await actionFingerprint(resealed)).toBe(await actionFingerprint(spawn));
  });
});

describe('the message vocabulary', () => {
  it('reads a known message, passes over an unknown kind, and refuses a known one out of shape', () => {
    expect(readMessage('device', { t: 'sub', sub: 's1', session: { lane: 'B', id: 'x' }, cursor: { epoch: 'launch', seq: 4, idx: 2 }, credit: 1024 }).kind).toBe('message');
    expect(readMessage('device', { t: 'sub', sub: 's1', session: { lane: 'A', id: 'x' }, cursor: { epoch: 'sub-1', seq: 4, idx: 2 }, credit: 1024 }).kind).toBe('malformed');
    expect(readMessage('device', { t: 'sub', sub: 's1', session: { lane: 'A', id: 'x' }, cursor: null, credit: 5 * 1024 * 1024 }).kind).toBe('malformed');
    expect(readMessage('device', { t: 'future-thing', x: 1 })).toEqual({ kind: 'unknown', t: 'future-thing' });
    expect(readMessage('device', { t: 'constructor' })).toEqual({ kind: 'unknown', t: 'constructor' });
    expect(readMessage('device', { t: 'caps' }).kind).toBe('unknown'); // the endpoint's, not a device's
    expect(readMessage('endpoint', { t: 'caps', member: 'm', device: 'd', clientClass: 'web-cards', machine: { grades: ['spawn'] }, stateVersion: 3 }).kind).toBe('message');
    expect(readMessage('endpoint', { t: 'ack', opId: 'op-0123456789abcdef', state: 'refused' }).kind).toBe('malformed');
    expect(readMessage('endpoint', { t: 'close', reason: 'behind', stateVersion: 4 }).kind).toBe('message');
    expect(readMessage('device', { t: 'part', id: 0, index: 0, count: 2, data: '' }).kind).toBe('malformed');
  });
});
