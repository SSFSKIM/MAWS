// The link's state machine (P5 O7 M1, "The link's states"): every row of the transition table, over a fake channel
// factory (the handshake injected, so no crypto runs on the channel) and fake carriers, with fake timers. The org state is
// real, signed by the endpoint suites' fixtures, since the trust generation reads the machine's keys from it.
import { randomBytes } from 'node:crypto';
import { ChannelError, generateSigningKey, keyId, memoryOrgView, signRecord, SIGNING_DOMAINS, type ByteDuplex, type Certificates, type Channel, type ChannelMessage, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { genesis, memberId, newDevice, successor, type TestDevice } from '../../../../test/endpoint/org-fixtures';
import { heldOrgSession, watchedView, type SignedIn } from '../../org/session';
import type { RelaySocket } from './carriers';
import type { EndpointRecords } from './endpoint-records';
import { createRemoteLink, type RemoteLinkDeps } from './link';
import type { SubscriptionSink } from './subs';

// An attempt computes key ids (`trustOf`), which WebCrypto's digest runs on libuv's thread pool. Under a loaded runner
// that pool is shared with every other worker, so a fixed number of event-loop turns could end before the digest did,
// and the clock-held steps below raced it. The same ids, computed synchronously, keep the state machine deterministic.
// `machineKeys` can be held once (`keysGate.hold`), so a test can move the session while an attempt computes its trust.
const keysGate = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
vi.mock('../../../../apps/org-protocol/src/index.ts', async (original) => {
  const actual = await original<typeof import('../../../../apps/org-protocol/src/index.ts')>();
  const { createHash } = await import('node:crypto');
  return {
    ...actual,
    keyId: (pub: string) => Promise.resolve(actual.base64urlEncode(new Uint8Array(createHash('sha256').update(actual.base64urlDecode(pub)).digest()).slice(0, actual.KID_BYTES))),
    machineKeys: async (...args: Parameters<typeof actual.machineKeys>) => {
      const hold = keysGate.hold;
      keysGate.hold = null;
      if (hold !== null) await hold;
      return actual.machineKeys(...args);
    },
  };
});

const realImmediate = setImmediate;
const realTimeout = setTimeout;
/** Settles until `check` holds: for steps that run real WebCrypto (a certificate's verification), bounded in real time. */
async function settleUntil(check: () => boolean, ms = 2000): Promise<void> {
  const deadline = performance.now() + ms;
  for (;;) {
    await settle();
    if (check()) return;
    if (performance.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => realTimeout(resolve, 5));
  }
}
/** Lets real async work (WebCrypto) and microtasks run, with the clock held. */
async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => realImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }
}
/** The clock moved in steps, real async work let run at each, so an attempt's WebCrypto finishes when its timer fires. */
async function advance(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 250) {
    await vi.advanceTimersByTimeAsync(Math.min(left, 250));
    await settle(8);
  }
  await settle();
}

class FakeChannel implements Channel {
  readonly id = randomBytes(8).toString('hex');
  readonly peer = { protocol: { major: 1, minor: 0 }, build: 'fake', capabilities: [], stateVersion: 1 };
  closed = false;
  closedWith: string | null = null;
  readonly sent: ChannelMessage[] = [];
  readonly #listeners = new Set<(m: ChannelMessage) => void>();
  readonly #ends = new Set<(reason: string) => void>();
  readonly #buffered: ChannelMessage[] = [];
  constructor(readonly carrier: 'direct' | 'relay') {}
  send(message: ChannelMessage): Promise<void> {
    if (this.closed) return Promise.reject(new ChannelError('closed'));
    this.sent.push(message);
    return Promise.resolve();
  }
  onMessage(listener: (m: ChannelMessage) => void): () => void {
    this.#listeners.add(listener);
    for (const m of this.#buffered.splice(0)) listener(m);
    return () => this.#listeners.delete(listener);
  }
  onClose(listener: (reason: string) => void): () => void {
    this.#ends.add(listener);
    return () => this.#ends.delete(listener);
  }
  close(reason: string): void {
    if (this.closed) return;
    this.closedWith = reason;
    this.end(reason);
  }
  /** The endpoint's message. */
  deliver(message: ChannelMessage): void {
    if (this.closed) return;
    if (this.#listeners.size === 0) this.#buffered.push(message);
    for (const listener of [...this.#listeners]) listener(message);
  }
  /** The channel ended: a sealed close's reason, or `carrier`. */
  end(reason: string): void {
    if (this.closed && this.closedWith !== reason) return;
    this.closed = true;
    for (const listener of [...this.#ends]) listener(reason);
    this.#ends.clear();
  }
  of(t: string): ChannelMessage[] {
    return this.sent.filter((m) => m.t === t);
  }
}

const CAPS = { t: 'caps', member: 'm', device: 'd1', clientClass: 'native-mac', machine: { grades: [] }, stateVersion: 2 };
const NO_JITTER = 0.5;

type Org = { a1: TestDevice; A: string; chain: SignedOrgState[]; machineKey: SigningKey; ref: MachineRef; certificates?: Certificates };

/** A machine reached through a delegated certificate whose delegation expires `expiresInMs` from now. */
async function delegatedOrg(expiresInMs: number): Promise<Org> {
  const a1 = await newDevice('a1');
  const A = memberId();
  const delegation = { id: randomBytes(16).toString('hex'), key: await generateSigningKey() };
  const ref = `${delegation.id}_${randomBytes(16).toString('base64url')}` as MachineRef;
  const machineKey = await generateSigningKey();
  const s1 = await genesis('org-l', A, a1, await generateSigningKey());
  const s2 = await successor(s1, [a1], (s) => {
    s.delegations.push({ id: delegation.id, pub: delegation.key.pub, prefix: 'vm-', expires: new Date(Date.now() + expiresInMs).toISOString(), maxUses: 10, offlineRevokeS: 0, owners: [A] });
  });
  const cert = await signRecord(SIGNING_DOMAINS.machineCert, { org: 'org-l', machine: ref, name: 'vm-one', pub: machineKey.pub, delegation: delegation.id, use: 1, issued: new Date().toISOString() }, delegation.key.privateKey, delegation.key.pub);
  return { a1, A, chain: [s1, s2], machineKey, ref, certificates: { certs: [cert], retirements: [] } };
}

async function org(): Promise<Org> {
  const a1 = await newDevice('a1');
  const A = memberId();
  const ref = randomBytes(16).toString('base64url') as MachineRef;
  const machineKey = await generateSigningKey();
  const s1 = await genesis('org-l', A, a1, await generateSigningKey());
  const s2 = await successor(s1, [a1], (s) => {
    s.machines.push({ name: 'mini', ref, pub: machineKey.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref });
  });
  return { a1, A, chain: [s1, s2], machineKey, ref };
}

async function harness(options: { addresses?: string[]; hub?: boolean; timing?: RemoteLinkDeps['timing']; org?: Org } = {}) {
  const o = options.org ?? (await org());
  const session = heldOrgSession();
  const view = watchedView(memoryOrgView({ chain: o.chain, certificates: o.certificates }), () => session.changed());
  const signedIn: SignedIn = {
    identity: { org: 'org-l', member: o.A, device: 'a1', clientClass: 'native-mac', channelKey: o.a1.channel, build: 't', capabilities: [] },
    view,
    stepUp: { sign: async () => ({ ok: false, reason: 'cancelled' }) },
    hub: options.hub === false ? null : { url: 'http://127.0.0.1:9', headers: async () => ({}) },
  };
  session.set(signedIn);
  const net = { direct: true, relay: true };
  /** Each carrier's handshake verdicts, in turn: null succeeds, a reason throws that ChannelError. */
  const verdicts: Record<'direct' | 'relay', Array<string | null>> = { direct: [], relay: [] };
  const channels: FakeChannel[] = [];
  const attempts: Array<{ carrier: 'direct' | 'relay'; at: number }> = [];
  let relaySockets = 0;
  const relayTries: number[] = [];
  let relayClosed = 0;
  let marked: 'direct' | 'relay' | null = null;
  const duplex = (kind: 'direct' | 'relay'): ByteDuplex => ({ send: () => void (marked = kind), onBytes: () => {}, close: () => {}, onClose: () => {} });
  const records: EndpointRecords = {
    resolve: async () => ({ body: { org: 'org-l', machine: o.ref, addresses: options.addresses ?? ['ws://100.64.1.2:47830'], issued: new Date().toISOString() }, sig: { kid: 'k', alg: 'ES256', value: 'v' } }) as never,
  };
  const logs: string[] = [];
  const pending: Array<{ carrier: 'direct' | 'relay'; release(): void }> = [];
  let holdHandshakes = false;
  const link = createRemoteLink({
    machine: { ref: o.ref, name: 'mini' },
    session,
    records,
    dialDirect: async () => {
      if (!net.direct) throw new Error('refused');
      return duplex('direct');
    },
    openRelay: async (): Promise<RelaySocket> => {
      relayTries.push(Date.now());
      if (!net.relay) throw new Error('hub away');
      relaySockets += 1;
      const ends: Array<(r: string) => void> = [];
      return { dial: async () => duplex('relay'), onClose: (l) => void ends.push(l), close: () => void ((relayClosed += 1), ends.forEach((l) => l('closed'))) };
    },
    handshake: async (dial) => {
      const io = await dial();
      io.send(new Uint8Array([1]));
      const carrier = marked!;
      attempts.push({ carrier, at: Date.now() });
      if (holdHandshakes) await new Promise<void>((release) => pending.push({ carrier, release }));
      const verdict = verdicts[carrier].shift() ?? null;
      if (verdict !== null) throw new ChannelError(verdict);
      const channel = new FakeChannel(carrier);
      channel.deliver(CAPS);
      channels.push(channel);
      return channel;
    },
    random: () => NO_JITTER,
    timing: options.timing,
    log: (line) => void logs.push(line),
  });
  const states: string[] = [];
  link.onState((s) => void states.push(s));
  const last = () => channels.at(-1)!;
  return {
    o,
    link,
    session,
    signedIn,
    view,
    net,
    verdicts,
    channels,
    attempts,
    logs,
    states,
    last,
    relay: () => ({ opened: relaySockets, closed: relayClosed }),
    relayTries: () => relayTries,
    hold: (on: boolean) => void (holdHandshakes = on),
    pending,
  };
}

/** The next head, the machine's key replaced and the old one retired. */
async function rotate(o: Org): Promise<SignedOrgState> {
  return successor(o.chain[1], [o.a1], async (s) => {
    s.retired.push({ keyId: await keyId(o.machineKey.pub), pub: o.machineKey.pub, notAfter: s.issued, holder: { machine: o.ref } });
    s.machines[0].pub = (await generateSigningKey()).pub;
  });
}

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
  return { s, heard };
}

beforeEach(() => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: Date.parse('2026-10-28T12:00:00.000Z') }));
afterEach(() => void vi.useRealTimers());

describe('connecting', () => {
  it('comes up over the direct carrier and reads caps', async () => {
    const h = await harness();
    expect(h.link.state()).toBe('connecting');
    await settle();
    expect(h.link.state()).toBe('up');
    expect(h.link.carrier()).toBe('direct');
    expect(h.link.caps()).toEqual({ member: 'm', device: 'd1', clientClass: 'native-mac', machine: { grades: [] }, stateVersion: 2 });
    expect(h.relay().opened).toBe(0);
  });

  it('takes the relay when no direct address answers', async () => {
    const h = await harness();
    h.net.direct = false;
    await settle();
    expect(h.link.state()).toBe('up');
    expect(h.link.carrier()).toBe('relay');
  });

  it('goes down on a transient failure and retries on the backoff from its start', async () => {
    const h = await harness();
    h.net.direct = false;
    h.net.relay = false;
    await settle();
    expect(h.link.state()).toBe('down');
    expect(h.states).toEqual(['down']);
    h.net.relay = true;
    await advance(999);
    expect(h.link.state()).toBe('down');
    await advance(1);
    expect(h.link.state()).toBe('up');
  });

  it('skips addresses that are not tailnet ws:// addresses, with one log line per record', async () => {
    const h = await harness({ addresses: ['ws://192.168.1.2:47830', 'wss://100.64.1.2:47830'] });
    await settle();
    expect(h.link.carrier()).toBe('relay');
    expect(h.logs.filter((l) => l.includes('not a tailnet'))).toHaveLength(1);
  });
});

describe('verdicts', () => {
  it('reads handshake verdicts as transient and local to their carrier: a forged `protocol` on direct falls to the relay', async () => {
    const h = await harness();
    h.verdicts.direct.push('protocol');
    await settle();
    expect(h.link.carrier()).toBe('relay');
    expect(h.link.refusal()).toBeNull();
  });

  it('keeps retrying after verdicts on both carriers, starting each attempt from direct, logging each reason once', async () => {
    const h = await harness();
    h.verdicts.direct.push('unknown-machine', 'unknown-machine');
    h.verdicts.relay.push('revoked', 'revoked');
    await settle();
    expect(h.link.state()).toBe('down');
    await advance(3000);
    expect(h.attempts.map((a) => a.carrier)).toEqual(['direct', 'relay', 'direct', 'relay', 'direct']);
    expect(h.link.state()).toBe('up');
    expect(h.link.carrier()).toBe('direct');
    expect(h.logs.filter((l) => l.includes('unknown-machine'))).toHaveLength(1);
  });

  it('refuses on a sealed `close {reason: removed}`, ends everything, and retries only when the session changes or a person probes', async () => {
    const h = await harness();
    await settle();
    const sub = sink();
    h.link.subscribe({ session: { lane: 'B', id: 'app-1' } }, sub.s);
    const sentAct = h.link.act({ action: 'endpoint.state', args: {} });
    const call = h.link.call('session.status', {});
    h.last().end('removed');
    await settle();
    expect(h.link.state()).toBe('down');
    expect(h.link.refusal()).toBe('removed');
    expect(sub.heard).toContainEqual(['ended', 'removed']);
    expect(await sentAct.outcome).toEqual({ state: 'unknown', reason: 'removed' });
    expect(await call).toMatchObject({ ok: false, error: { code: 'removed' } });
    expect(await h.link.act({ action: 'endpoint.state', args: {} }).outcome).toEqual({ state: 'refused', reason: 'removed' });
    expect(await h.link.call('session.status', {})).toMatchObject({ ok: false, error: { code: 'removed' } });
    const late = sink();
    h.link.subscribe({ session: { lane: 'B', id: 'app-1' } }, late.s);
    await settle();
    expect(late.heard).toEqual([['ended', 'removed']]);
    const tried = h.attempts.length;
    await advance(120_000);
    h.link.probe('wake');
    await settle();
    expect(h.attempts).toHaveLength(tried);
    h.link.probe('person');
    await settle();
    expect(h.link.state()).toBe('up');
    expect(h.link.refusal()).toBeNull();
    h.last().end('removed');
    await settle();
    h.session.changed();
    await settle();
    expect(h.link.state()).toBe('up');
  });

  it('never reads a carrier’s own close reason as `removed`', async () => {
    const h = await harness();
    await settle();
    h.last().end('carrier');
    await settle();
    expect(h.link.refusal()).toBeNull();
    expect(h.link.state()).toBe('up');
  });
});

describe('grace and backoff', () => {
  it('keeps `up` through a reconnect within the grace: no down, no new generation', async () => {
    const h = await harness();
    await settle();
    h.last().end('carrier');
    await settle();
    expect(h.link.state()).toBe('up');
    expect(h.channels).toHaveLength(2);
    expect(h.states).toEqual(['up']);
  });

  it('goes down once the grace elapses, pausing every subscription `offline`, and its next `up` is heard', async () => {
    const h = await harness();
    await settle();
    const sub = sink();
    h.link.subscribe({ session: { lane: 'B', id: 'app-1' } }, sub.s);
    h.net.direct = false;
    h.net.relay = false;
    h.last().end('carrier');
    await settle();
    expect(h.link.state()).toBe('up');
    await advance(1999);
    expect(h.link.state()).toBe('up');
    await advance(1);
    expect(h.link.state()).toBe('down');
    expect(sub.heard).toContainEqual(['paused', 'offline']);
    h.net.relay = true;
    await advance(5000);
    expect(h.states).toEqual(['up', 'down', 'up']);
  });

  it('retries after 0, 1, 2, 4 s, then every 5 s until the resume window, then every 30 s; a probe restarts it', async () => {
    const h = await harness();
    await settle();
    h.net.direct = false;
    h.net.relay = false;
    const lostAt = Date.now();
    h.last().end('carrier');
    await settle();
    await advance(160_000);
    const fives = Array.from({ length: 22 }, (_, i) => 12_000 + i * 5000);
    expect(h.relayTries().map((at) => at - lostAt)).toEqual([0, 1000, 3000, 7000, ...fives, 122_000, 152_000]);
    const probedAt = Date.now();
    h.link.probe('network');
    await settle();
    await advance(1000);
    expect(h.relayTries().slice(-2).map((at) => at - probedAt)).toEqual([0, 1000]);
  });
});

describe('probes and liveness', () => {
  it('pings on a probe while up, and loses the channel (`timeout`) with no answer in 2 s', async () => {
    const h = await harness();
    await settle();
    const channel = h.last();
    h.link.probe('focus');
    expect(channel.of('ping')).toHaveLength(1);
    await advance(1999);
    expect(channel.closed).toBe(false);
    await advance(1);
    expect(channel.closedWith).toBe('timeout');
    expect(h.channels).toHaveLength(2);
  });

  it('keeps the channel when the probe is answered', async () => {
    const h = await harness();
    await settle();
    const channel = h.last();
    h.link.probe('focus');
    channel.deliver({ t: 'pong', at: 1 });
    await advance(3000);
    expect(channel.closed).toBe(false);
  });

  it('keeps the endpoint’s liveness: a heard period resets, a silent one pings, the third silent one closes; answers the endpoint’s ping', async () => {
    const h = await harness();
    await settle();
    const channel = h.last();
    channel.deliver({ t: 'ping', at: 42 });
    expect(channel.of('pong')).toEqual([{ t: 'pong', at: 42 }]);
    await advance(6000); // heard from: nothing sent
    expect(channel.of('ping')).toHaveLength(0);
    await advance(6000);
    expect(channel.of('ping')).toHaveLength(1);
    await advance(6000);
    expect(channel.of('ping')).toHaveLength(2);
    expect(channel.closed).toBe(false);
    await advance(6000);
    expect(channel.closedWith).toBe('timeout');
  });

  it('starts the count again when anything is heard', async () => {
    const h = await harness();
    await settle();
    const channel = h.last();
    await advance(12_000);
    expect(channel.of('ping')).toHaveLength(2);
    channel.deliver({ t: 'pong', at: 1 });
    await advance(12_000);
    expect(channel.closed).toBe(false);
    expect(channel.of('ping')).toHaveLength(3);
  });

  it('runs an attempt at once on a probe while down, resetting the backoff', async () => {
    const h = await harness();
    h.net.direct = false;
    h.net.relay = false;
    await settle();
    await advance(60_000);
    expect(h.link.state()).toBe('down');
    h.net.relay = true;
    h.link.probe('network');
    await settle();
    expect(h.link.state()).toBe('up');
  });
});

describe('the switch from relay to direct', () => {
  it('rechecks direct every 60 s, swaps once the handshake completes, resumes subscriptions and ignores the old channel', async () => {
    const h = await harness({ timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    h.net.direct = false;
    await settle();
    expect(h.link.carrier()).toBe('relay');
    const relayChannel = h.last();
    const sub = sink();
    const s = h.link.subscribe({ session: { lane: 'B', id: 'app-1' }, cursor: null }, sub.s);
    relayChannel.deliver({ t: 'subbed', sub: s.id, mode: 'snapshot', epoch: 'L1', seq: 0 });
    relayChannel.deliver({ t: 'ev', sub: s.id, epoch: 'L1', seq: 1, idx: 0, body: 'one' });
    h.net.direct = true;
    await advance(60_000);
    expect(h.link.carrier()).toBe('direct');
    expect(h.link.state()).toBe('up');
    expect(h.states).toEqual(['up', 'up']);
    const directChannel = h.last();
    expect(directChannel.of('sub')).toEqual([{ t: 'sub', sub: s.id, session: { lane: 'B', id: 'app-1' }, cursor: { epoch: 'L1', seq: 1, idx: 0 }, credit: 1024 * 1024 }]);
    expect(relayChannel.closedWith).toBe('closed');
    expect(h.relay().closed).toBe(1);
    relayChannel.deliver({ t: 'ev', sub: s.id, epoch: 'L1', seq: 2, idx: 0, body: 'stale' });
    directChannel.deliver({ t: 'subbed', sub: s.id, mode: 'replay', epoch: 'L1', seq: 1, idx: 0 });
    directChannel.deliver({ t: 'ev', sub: s.id, epoch: 'L1', seq: 2, idx: 0, body: 'two' });
    expect(sub.heard.filter((x) => x[0] === 'event').map((x) => x[2])).toEqual(['one', 'two']);
  });

  it('switches on a probe too', async () => {
    const h = await harness();
    h.net.direct = false;
    await settle();
    h.net.direct = true;
    h.link.probe('wake');
    await settle();
    expect(h.link.carrier()).toBe('direct');
  });
});

describe('trust', () => {
  it('closes and authenticates again when the org retires the machine key the channel was made under', async () => {
    const h = await harness();
    await settle();
    const first = h.last();
    const rotated = await rotate(h.o);
    await h.view.advance([rotated], []);
    await settle();
    expect(first.closedWith).toBe('closed');
    expect(h.channels).toHaveLength(2);
    expect(h.link.state()).toBe('up');
    expect(h.states).toEqual(['up']);
  });

  it('discards an attempt that completes under an older trust generation', async () => {
    const h = await harness();
    h.hold(true);
    await settle();
    expect(h.pending).toHaveLength(1);
    const rotated = await rotate(h.o);
    await h.view.advance([rotated], []);
    await settle();
    h.hold(false);
    h.pending.shift()!.release();
    await settle();
    expect(h.channels[0].closedWith).toBe('closed');
    expect(h.channels).toHaveLength(2);
    expect(h.link.state()).toBe('up');
  });

  it('discards an attempt whose trust was still being computed when the session retired the machine key', async () => {
    let release!: () => void;
    keysGate.hold = new Promise<void>((resolve) => (release = resolve));
    const h = await harness();
    await settle();
    expect(h.attempts).toHaveLength(0); // the attempt read the session, and waits in its machineKeys
    const rotated = await rotate(h.o);
    await h.view.advance([rotated], []);
    await settle();
    expect(h.logs.some((l) => l.includes('retired a key'))).toBe(true);
    release();
    await settle();
    expect(h.channels[0].closedWith).toBe('closed');
    expect(h.channels).toHaveLength(2);
    expect(h.link.state()).toBe('up');
  });

  it('closes the channel when the delegation of the certificate it was made under expires', async () => {
    const h = await harness({ org: await delegatedOrg(60_000), timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    await settleUntil(() => h.link.state() === 'up');
    const first = h.last();
    await advance(59_000);
    expect(first.closed).toBe(false);
    await advance(1000);
    await settleUntil(() => first.closed);
    expect(first.closedWith).toBe('closed');
    expect(h.logs.some((l) => l.includes('retired a key'))).toBe(true);
  });

  it('keeps the channel through a session change that retires nothing', async () => {
    const h = await harness();
    await settle();
    h.session.changed();
    await settle();
    expect(h.channels).toHaveLength(1);
    expect(h.last().closed).toBe(false);
  });
});

describe('calls', () => {
  it('answers a call with the endpoint’s result, and sends a held call once up', async () => {
    const h = await harness();
    const held = h.link.call('session.status', { appSessionId: 'a' });
    await settle();
    const [m] = h.last().of('call') as unknown as Array<{ id: string }>;
    h.last().deliver({ t: 'result', id: m.id, ok: true, output: { process: 'ready' } });
    expect(await held).toEqual({ ok: true, output: { process: 'ready' } });
  });

  it('sends a call in flight again on the next channel, and fails `offline` when none comes within its timeout', async () => {
    const h = await harness();
    await settle();
    const call = h.link.call('session.status', {});
    h.last().end('carrier');
    await settle();
    expect(h.last().of('call')).toHaveLength(1);
    const lost = h.last();
    h.net.direct = false;
    h.net.relay = false;
    lost.end('carrier');
    await advance(10_000);
    expect(await call).toMatchObject({ ok: false, error: { code: 'offline' } });
  });

  it('sends a void input as null, so the call is well formed', async () => {
    const h = await harness();
    await settle();
    void h.link.call('machine.identity', undefined);
    expect(h.last().of('call')).toEqual([{ t: 'call', id: expect.any(String), name: 'machine.identity', input: null }]);
  });

  it('fails `timeout` when the channel holds and the endpoint never answers', async () => {
    const h = await harness();
    await settle();
    const call = h.link.call('session.status', {}, { timeoutMs: 3000 });
    h.last().deliver({ t: 'pong', at: 1 });
    await advance(3000);
    expect(await call).toMatchObject({ ok: false, error: { code: 'timeout' } });
  });
});

describe('close()', () => {
  it('ends everything, sends a sealed close and stops retrying', async () => {
    const h = await harness();
    await settle();
    const sub = sink();
    h.link.subscribe({ session: { lane: 'B', id: 'app-1' } }, sub.s);
    const act = h.link.act({ action: 'endpoint.state', args: {} });
    const channel = h.last();
    h.link.close();
    expect(channel.closedWith).toBe('closed');
    expect(h.link.state()).toBe('down');
    expect(sub.heard).toContainEqual(['ended', 'closed']);
    expect(await act.outcome).toEqual({ state: 'unknown', reason: 'closed' });
    expect(await h.link.act({ action: 'endpoint.state', args: {} }).outcome).toEqual({ state: 'refused', reason: 'closed' });
    expect(await h.link.call('session.status', {})).toMatchObject({ ok: false, error: { code: 'closed' } });
    const tried = h.attempts.length;
    await advance(60_000);
    expect(h.attempts).toHaveLength(tried);
  });
});
