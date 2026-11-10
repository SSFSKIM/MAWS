// The link's state machine (P5 O7 M1, "The link's states"): every row of the transition table, over a fake channel
// factory (the handshake injected, so no crypto runs on the channel) and fake carriers, with fake timers. The org state is
// real, signed by the endpoint suites' fixtures, since the trust generation reads the machine's keys from it.
import { randomBytes } from 'node:crypto';
import { ChannelError, generateSigningKey, keyId, memoryOrgView, signRecord, SIGNING_DOMAINS, type ByteDuplex, type Certificates, type Channel, type ChannelMessage, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { genesis, memberId, newDevice, successor, type TestDevice } from '../../../../test/endpoint/org-fixtures';
import { heldOrgSession, watchedView, type SignedIn } from '../../org/session';
import { REACH_WINDOW_MS, type Reach } from '../../net/reach';
import type { RelaySocket } from './carriers';
import type { EndpointRecords } from './endpoint-records';
import { createRemoteLink, PINGS_PENDING_MAX, PONG_STAMPS_KEPT, type RemoteLinkDeps } from './link';
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
  readonly peer: Channel['peer'];
  closed = false;
  closedWith: string | null = null;
  readonly sent: ChannelMessage[] = [];
  readonly #listeners = new Set<(m: ChannelMessage) => void>();
  readonly #ends = new Set<(reason: string) => void>();
  readonly #buffered: ChannelMessage[] = [];
  constructor(
    readonly carrier: 'direct' | 'relay',
    capabilities: string[] = [],
  ) {
    this.peer = { protocol: { major: 1, minor: 1 }, build: 'fake', capabilities, stateVersion: 1 };
  }
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

/**
 * P5 O15 M2b §F: the window's reach, its answers given by the test. The window closes REACH_WINDOW_MS after its last
 * opening on the fake clock, answering every wait false, as the real one does; `answer` answers every wait on a target
 * that holds `part`, as a connect answers every waiter of its key.
 */
function fakeReach() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const waits = new Set<{ target: string; answer(ok: boolean): void }>();
  const asked: string[] = [];
  const opened: string[] = [];
  const reach: Reach = {
    openWindow(reason) {
      opened.push(reason);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        for (const wait of [...waits]) wait.answer(false);
      }, REACH_WINDOW_MS);
    },
    windowOpen: () => timer !== null,
    reachable(target, signal) {
      if (timer === null || signal?.aborted) return Promise.resolve(false);
      asked.push(target);
      return new Promise<boolean>((resolve) => {
        const leave = () => wait.answer(false);
        const wait = {
          target,
          answer(ok: boolean) {
            waits.delete(wait);
            signal?.removeEventListener('abort', leave);
            resolve(ok);
          },
        };
        waits.add(wait);
        signal?.addEventListener('abort', leave, { once: true });
      });
    },
    close: () => {},
  };
  return {
    reach,
    opened,
    /** Every `reachable` call that waited, in order. */
    asked,
    waiting: (part: string) => [...waits].filter((wait) => wait.target.includes(part)).length,
    answer(part: string) {
      for (const wait of [...waits]) if (wait.target.includes(part)) wait.answer(true);
    },
  };
}

/** A promise the test settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => ((resolve = yes), (reject = no)));
  return { promise, resolve, reject };
}

type HarnessOptions = {
  addresses?: string[];
  hub?: boolean;
  timing?: RemoteLinkDeps['timing'];
  org?: Org;
  /** P5 O15 M2b: a fake reach (`h.window`), the cached record's addresses (the resolved one's by default), `directTarget`. */
  window?: boolean;
  cached?: string[] | null;
  directTarget?: RemoteLinkDeps['directTarget'];
  /** The fake reach's window opened (by another link, say) before the link is created. */
  openBeforeCreation?: boolean;
};

async function harness(options: HarnessOptions = {}) {
  const o = options.org ?? (await org());
  const session = heldOrgSession();
  const view = watchedView(memoryOrgView({ chain: o.chain, certificates: o.certificates }), () => session.changed());
  const signedIn: SignedIn = {
    identity: { org: 'org-l', member: o.A, device: 'a1', clientClass: 'native-mac', channelKey: o.a1.channel, build: 't', capabilities: [] },
    view,
    stepUp: { sign: async () => ({ ok: false, reason: 'cancelled' }), signActions: async () => ({ ok: false, reason: 'cancelled' }) },
    hub: options.hub === false ? null : { url: 'http://127.0.0.1:9', headers: async () => ({}) },
  };
  session.set(signedIn);
  const net = { direct: true, relay: true };
  const reach = options.window === true ? fakeReach() : null;
  if (options.openBeforeCreation === true) reach!.reach.openWindow('wake');
  /** Each carrier's handshake verdicts, in turn: null succeeds, a reason throws that ChannelError. */
  const verdicts: Record<'direct' | 'relay', Array<string | null>> = { direct: [], relay: [] };
  const channels: FakeChannel[] = [];
  const attempts: Array<{ carrier: 'direct' | 'relay'; at: number }> = [];
  let relaySockets = 0;
  const relayTries: number[] = [];
  let relayClosed = 0;
  let marked: 'direct' | 'relay' | null = null;
  /** Every carrier dialled, and whether something closed it (an abort's signal, a failed handshake's link). */
  const carriers: Array<{ kind: 'direct' | 'relay'; closed: boolean }> = [];
  const duplex = (kind: 'direct' | 'relay'): ByteDuplex => {
    const ends: Array<(reason: string) => void> = [];
    const record = { kind, closed: false };
    carriers.push(record);
    return {
      send: () => void (marked = kind),
      onBytes: () => {},
      close: () => {
        if (record.closed) return;
        record.closed = true;
        for (const end of ends.splice(0)) end('carrier');
      },
      onClose: (listener) => void ends.push(listener),
    };
  };
  const recordOf = (addresses: string[]) => ({ body: { org: 'org-l', machine: o.ref, addresses, issued: new Date().toISOString() }, sig: { kid: 'k', alg: 'ES256', value: 'v' } }) as never;
  /** `gate.resolve`: the hub's record read waits until the test releases it (today's attempt, the lanes' background read). */
  const gate = { resolve: false, held: [] as Array<{ release(addresses?: string[]): void }>, resolves: 0 };
  const records: EndpointRecords = {
    resolve: async () => {
      gate.resolves += 1;
      if (!gate.resolve) return recordOf(options.addresses ?? ['ws://100.64.1.2:47830']);
      const later = deferred<string[] | undefined>();
      gate.held.push({ release: (addresses) => later.resolve(addresses) });
      return recordOf((await later.promise) ?? options.addresses ?? ['ws://100.64.1.2:47830']);
    },
    cached: async () => (options.cached === null ? null : recordOf(options.cached ?? options.addresses ?? ['ws://100.64.1.2:47830'])),
  };
  const logs: string[] = [];
  const pending: Array<{ carrier: 'direct' | 'relay'; release(): void }> = [];
  let holdHandshakes = false;
  /** P5 O15 M2b: one carrier's handshakes held (`holdOn`), each ended by its carrier's close or its `timeoutMs` unless `stubborn`. */
  const holdOn = { direct: false, relay: false, stubborn: false };
  /** Before each catch-up redial, while set: the handshake waits for the test (`redials`). */
  const redialGate = { on: false, waiting: [] as Array<() => void> };
  /** When each direct dial was made, whether it opened or not, and where it went. */
  const directDials: number[] = [];
  const dialled: string[] = [];
  /** How each relay socket's open goes, in turn: `stall` waits for the test (`stalled`); past the plan, at once. */
  const relayPlan: Array<'stall'> = [];
  const stalled: Array<{ open(): void }> = [];
  const sockets: Array<{ closed: boolean }> = [];
  /** How each direct dial goes, in turn: `stall` waits for the test (`stalledDials`) or its abort; past the plan, at once. */
  const directPlan: Array<'stall'> = [];
  const stalledDials: Array<{ open(): void }> = [];
  /** The signal each open was given, in order. */
  const signals: Array<{ kind: 'direct' | 'relay'; signal: AbortSignal | undefined }> = [];
  /** Each handshake's `timeoutMs`, undefined for today's. */
  const handshakeTimeouts: Array<number | undefined> = [];
  /** What the next channel's peer lists in its `h2`. */
  const peer = { capabilities: [] as string[] };
  const link = createRemoteLink({
    machine: { ref: o.ref, name: 'mini' },
    session,
    records,
    dialDirect: async (url, _timeoutMs, signal) => {
      directDials.push(Date.now());
      dialled.push(url);
      signals.push({ kind: 'direct', signal });
      if (directPlan.shift() === 'stall') {
        const later = deferred<void>();
        stalledDials.push({ open: () => later.resolve() });
        signal?.addEventListener('abort', () => later.reject(signal.reason), { once: true });
        await later.promise;
      }
      if (!net.direct) throw new Error('refused');
      return duplex('direct');
    },
    openRelay: async (_url, _headers, signal): Promise<RelaySocket> => {
      relayTries.push(Date.now());
      signals.push({ kind: 'relay', signal });
      if (relayPlan.shift() === 'stall') {
        const later = deferred<void>();
        stalled.push({ open: () => later.resolve() });
        await later.promise;
      }
      if (!net.relay) throw new Error('hub away');
      relaySockets += 1;
      const ends: Array<(r: string) => void> = [];
      const socket = { closed: false };
      sockets.push(socket);
      return {
        dial: async () => duplex('relay'),
        onClose: (l) => void ends.push(l),
        close: () => {
          if (socket.closed) return;
          socket.closed = true;
          relayClosed += 1;
          ends.forEach((l) => l('closed'));
        },
      };
    },
    handshake: async (dial, _signedIn, _machine, handshakeOptions) => {
      const io = await dial();
      io.send(new Uint8Array([1]));
      const carrier = marked!;
      attempts.push({ carrier, at: Date.now() });
      handshakeTimeouts.push(handshakeOptions?.timeoutMs);
      if (holdHandshakes) await new Promise<void>((release) => pending.push({ carrier, release }));
      if (holdOn[carrier])
        await new Promise<void>((release, reject) => {
          pending.push({ carrier, release });
          if (holdOn.stubborn) return;
          io.onClose?.(() => reject(new ChannelError('closed')));
          if (handshakeOptions?.timeoutMs !== undefined) setTimeout(() => reject(new ChannelError('timeout')), handshakeOptions.timeoutMs);
        });
      let verdict = verdicts[carrier].shift() ?? null;
      // `behind`: a catch-up's next connection, from `dial` again, as connectChannel takes one
      while (verdict === 'behind') {
        if (redialGate.on) await new Promise<void>((resume) => redialGate.waiting.push(resume));
        (await dial()).send(new Uint8Array([1]));
        verdict = verdicts[carrier].shift() ?? null;
      }
      if (verdict !== null) throw new ChannelError(verdict);
      const channel = new FakeChannel(carrier, [...peer.capabilities]);
      channel.deliver(CAPS);
      channels.push(channel);
      return channel;
    },
    random: () => NO_JITTER,
    timing: options.timing,
    ...(reach === null ? {} : { reach: reach.reach }),
    ...(options.directTarget === undefined ? {} : { directTarget: options.directTarget }),
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
    directDials: () => directDials,
    hold: (on: boolean) => void (holdHandshakes = on),
    pending,
    peer,
    // P5 O15 M2b
    window: reach!,
    gate,
    carriers,
    dialled,
    holdOn,
    redialGate,
    relayPlan,
    stalled,
    sockets,
    handshakeTimeouts,
    directPlan,
    stalledDials,
    signals,
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

  // P5 O7 M2: what the endpoint said it reads, for the acts and streams that need a capability.
  it('reports the current channel’s peer capabilities, and none while no channel is current', async () => {
    const h = await harness();
    h.peer.capabilities = ['rl2.executor.machine'];
    expect(h.link.peerCapabilities()).toBeNull();
    await settle();
    expect(h.link.peerCapabilities()).toEqual(['rl2.executor.machine']);
    h.net.direct = false;
    h.net.relay = false;
    h.last().end('carrier');
    await settle();
    expect(h.link.peerCapabilities()).toBeNull();
    h.peer.capabilities = [];
    h.net.direct = true;
    await advance(1000);
    expect(h.link.state()).toBe('up');
    expect(h.link.peerCapabilities()).toEqual([]);
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
    expect(h.link.ended()).toBe('removed');
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
    expect(h.link.ended()).toBeNull();
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

  // A direct dial that never reaches the listener (refused, timed out, a 503) takes none of the listener's tokens, so it
  // spends none of the link's: the network's return finds the bucket as the listener has it.
  it.each([3500, 6900, 15_000])('resumes over the direct carrier at once when the network returns after a %i ms outage with no hub', async (outageMs) => {
    const h = await harness();
    await settle();
    h.net.direct = false;
    h.net.relay = false;
    h.last().end('carrier');
    await settle();
    await advance(outageMs);
    expect(h.link.state()).toBe('down');
    h.net.direct = true;
    const returnedAt = Date.now();
    h.link.probe('network');
    await settle();
    expect(h.link.state()).toBe('up');
    expect(h.link.carrier()).toBe('direct');
    expect(h.attempts.at(-1)).toEqual({ carrier: 'direct', at: returnedAt });
    // every attempt of the outage dialed direct first (the first `up` and the resume dialed no relay)
    expect(h.directDials()).toHaveLength(h.relayTries().length + 2);
  });

  it('still holds the listener’s limit: three opened direct handshakes inside a minute send the fourth attempt through the hub', async () => {
    const h = await harness();
    h.net.relay = false;
    h.verdicts.direct.push('protocol', 'protocol', 'protocol', 'protocol');
    await settle();
    await advance(3000); // attempts at 0, 1 and 3 s: each opened the direct socket, and failed its handshake
    expect(h.attempts.map((a) => a.carrier)).toEqual(['direct', 'direct', 'direct']);
    const dials = h.directDials().length;
    h.net.relay = true;
    await advance(4000); // the attempt at 7 s: under a token since the first, so no direct dial
    expect(h.directDials()).toHaveLength(dials);
    expect(h.attempts.map((a) => a.carrier)).toEqual(['direct', 'direct', 'direct', 'relay']);
    expect(h.link.state()).toBe('up');
    expect(h.link.carrier()).toBe('relay');
  });

  it('spends no token on a catch-up connection that does not open', async () => {
    const h = await harness({ timing: { DIRECT_BUCKET: { burst: 2, perMinute: 0.001 } } });
    h.net.relay = false;
    h.verdicts.direct.push('behind');
    h.hold(true);
    await settle();
    h.net.direct = false; // the catch-up's next connection is refused
    h.pending.shift()!.release();
    await settle();
    expect(h.link.state()).toBe('down');
    expect(h.directDials()).toHaveLength(2);
    h.hold(false);
    h.net.direct = true;
    h.link.probe('network'); // the first connection took one token of two; the refused one, none
    await settle();
    expect(h.link.state()).toBe('up');
    expect(h.link.carrier()).toBe('direct');
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

// P5 O7 M7 (`rl2.pong-clock`): the remote bench's clock. Each pong the link hears is kept with its four stamps, the
// device's `at` (the ping's send) and `arrived` (the pong's arrival) and, from a peer that lists the capability, the
// endpoint's `received` and `sent`; `ping()` sends one ping on the current channel and answers its pong's stamps.
describe('the pong clock', () => {
  const T0 = Date.parse('2026-10-28T12:00:00.000Z');

  it('answers a ping with its pong’s four stamps and the carrier, and keeps every pong heard', async () => {
    const h = await harness();
    h.peer.capabilities = ['rl2.pong-clock'];
    await settle();
    const channel = h.last();
    const at = Date.now();
    const answer = h.link.ping();
    expect(channel.of('ping')).toEqual([{ t: 'ping', at }]);
    await vi.advanceTimersByTimeAsync(3);
    channel.deliver({ t: 'pong', at, received: T0 + 5_001, sent: T0 + 5_002 });
    expect(await answer).toEqual({ at, received: T0 + 5_001, sent: T0 + 5_002, arrived: at + 3, carrier: 'direct' });
    // a probe's pong, and one the link did not ask for (the endpoint's answer to its silence ping), are kept the same way
    h.link.probe('focus');
    const probeAt = Date.now();
    channel.deliver({ t: 'pong', at: probeAt, received: T0 + 6_000, sent: T0 + 6_000 });
    expect(h.link.pongs()).toEqual([
      { at, received: T0 + 5_001, sent: T0 + 5_002, arrived: at + 3, carrier: 'direct' },
      { at: probeAt, received: T0 + 6_000, sent: T0 + 6_000, arrived: probeAt, carrier: 'direct' },
    ]);
  });

  it('keeps no endpoint stamps from a peer that does not list `rl2.pong-clock`', async () => {
    const h = await harness();
    await settle();
    const answer = h.link.ping();
    const at = Date.now();
    h.last().deliver({ t: 'pong', at, received: 1, sent: 2 });
    expect(await answer).toEqual({ at, received: null, sent: null, arrived: at, carrier: 'direct' });
  });

  it('answers null with no channel, and when its channel is lost or stays silent; never closes the channel nor rechecks direct', async () => {
    const h = await harness({ timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    expect(await h.link.ping()).toBeNull(); // still connecting
    h.net.direct = false;
    await settle();
    expect(h.link.carrier()).toBe('relay');
    const attempts = h.attempts.length;
    const silent = h.link.ping({ timeoutMs: 1_000 });
    await advance(1_000);
    expect(await silent).toBeNull();
    expect(h.last().closed).toBe(false);
    expect(h.attempts).toHaveLength(attempts); // a probe on the relay would have tried the direct carrier
    const lost = h.link.ping();
    h.last().end('carrier');
    expect(await lost).toBeNull();
  });

  it('joins a second ping in the same millisecond to the first exchange, sending one ping for both', async () => {
    const h = await harness();
    h.peer.capabilities = ['rl2.pong-clock'];
    await settle();
    const at = Date.now();
    const [one, two] = [h.link.ping(), h.link.ping()];
    expect(h.last().of('ping')).toEqual([{ t: 'ping', at }]);
    h.last().deliver({ t: 'pong', at, received: T0 + 1, sent: T0 + 2 });
    expect(await one).toEqual(await two);
    expect(h.link.pongs()).toHaveLength(1);
  });

  it('never lets the link’s own ping share a pending exchange’s millisecond: a probe then leaves its ping out, and a ping after a probe waits for the next', async () => {
    const h = await harness();
    h.peer.capabilities = ['rl2.pong-clock'];
    await settle();
    const channel = h.last();
    const at = Date.now();
    const benched = h.link.ping();
    h.link.probe('focus'); // the same millisecond: the exchange's pong answers the probe
    expect(channel.of('ping')).toEqual([{ t: 'ping', at }]);
    channel.deliver({ t: 'pong', at, received: T0 + 1, sent: T0 + 1 });
    expect(await benched).toMatchObject({ at, received: T0 + 1 });
    await advance(3_000);
    expect(channel.closed).toBe(false); // the probe was answered

    await vi.advanceTimersByTimeAsync(10);
    const probeAt = Date.now();
    h.link.probe('focus');
    const after = h.link.ping(); // in the probe's millisecond: it waits for the next
    expect(channel.of('ping').at(-1)).toEqual({ t: 'ping', at: probeAt });
    channel.deliver({ t: 'pong', at: probeAt, received: T0 + 5, sent: T0 + 5 }); // the probe's answer settles nothing
    await vi.advanceTimersByTimeAsync(1);
    expect(channel.of('ping').at(-1)).toEqual({ t: 'ping', at: probeAt + 1 });
    channel.deliver({ t: 'pong', at: probeAt + 1, received: T0 + 6, sent: T0 + 6 });
    expect(await after).toMatchObject({ at: probeAt + 1, received: T0 + 6 });
  });

  it('settles a relay ping at once when a direct recheck takes the channel over', async () => {
    const h = await harness({ timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    h.net.direct = false;
    await settle();
    expect(h.link.carrier()).toBe('relay');
    let answer: unknown = 'pending';
    void h.link.ping({ timeoutMs: 60_000 }).then((stamps) => (answer = stamps));
    h.net.direct = true;
    h.link.probe('wake');
    await settle();
    expect(h.link.carrier()).toBe('direct');
    expect(answer).toBeNull();
  });

  it('answers null without sending past PINGS_PENDING_MAX pending exchanges', async () => {
    const h = await harness({ timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    await settle();
    const pending = [];
    for (let i = 0; i < PINGS_PENDING_MAX; i += 1) {
      pending.push(h.link.ping({ timeoutMs: 60_000 }));
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(h.last().of('ping')).toHaveLength(PINGS_PENDING_MAX);
    expect(await h.link.ping()).toBeNull();
    expect(h.last().of('ping')).toHaveLength(PINGS_PENDING_MAX);
  });

  it('keeps the newest PONG_STAMPS_KEPT pongs', async () => {
    const h = await harness();
    await settle();
    for (let i = 0; i < PONG_STAMPS_KEPT + 5; i += 1) h.last().deliver({ t: 'pong', at: i });
    const kept = h.link.pongs();
    expect(kept).toHaveLength(PONG_STAMPS_KEPT);
    expect(kept[0]!.at).toBe(5);
    expect(kept.at(-1)!.at).toBe(PONG_STAMPS_KEPT + 4);
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

  // P5 O7 M4 (§M): `call.session` only to a peer that reads it, judged per channel for a call carried over.
  it('names the call’s session to a peer that lists `rl2.call-session`, and leaves it out for one that does not', async () => {
    const h = await harness();
    h.peer.capabilities = ['rl2.call-session'];
    await settle();
    const session = { lane: 'B' as const, id: 'app-1' };
    void h.link.call('git.status', { directory: '/r' }, { session });
    expect(h.last().of('call')).toEqual([{ t: 'call', id: expect.any(String), name: 'git.status', input: { directory: '/r' }, session }]);
    const carried = h.link.call('git.status', { directory: '/r' }, { session });
    h.peer.capabilities = [];
    h.last().end('carrier');
    await settle();
    // both calls in flight carried to the new channel, neither with the session its peer would not read
    const bare = { t: 'call', id: expect.any(String), name: 'git.status', input: { directory: '/r' } };
    expect(h.last().of('call')).toEqual([bare, bare]);
    void carried;
  });

  // P5 O7 M4 fix wave 2: an input field only some peers read (session.events' `maxBytes`) is judged per transmission too.
  it('sends a call’s input for a peer lacking a capability to such a peer, on its first send and when carried, and says so', async () => {
    const h = await harness();
    h.peer.capabilities = ['rl2.events-budget'];
    await settle();
    const lacking = { capability: 'rl2.events-budget', input: { appSessionId: 'app-1' } };
    const budgeted = { appSessionId: 'app-1', maxBytes: 4096 };
    const first = h.link.call('session.events', budgeted, { lacking });
    const sent = h.last().of('call') as unknown as Array<{ id: string; input: unknown }>;
    expect(sent.map((c) => c.input)).toEqual([budgeted]);
    h.last().deliver({ t: 'result', id: sent[0].id, ok: true, output: { events: [] } });
    expect(await first).toEqual({ ok: true, output: { events: [] } });

    const carried = h.link.call('session.events', budgeted, { lacking });
    h.peer.capabilities = [];
    h.last().end('carrier');
    await settle();
    const resent = h.last().of('call') as unknown as Array<{ id: string; input: unknown }>;
    expect(resent.map((c) => c.input)).toEqual([lacking.input]); // never the field to a peer that doesn't list it
    h.last().deliver({ t: 'result', id: resent[0].id, ok: true, output: { events: [] } });
    expect(await carried).toEqual({ ok: true, output: { events: [] }, fellBack: true });
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

// P5 O7 M5c ("Consent and the client port"; "O4's surfaces: leases, the window, delivery on the machine"): the machine's
// client-port requests answered on the channel that asked, and what only one channel holds (a page's lease) sent on it alone.
describe('the client port', () => {
  it('hands the listener a `client` request and sends its answer once, on the channel that asked', async () => {
    const h = await harness();
    h.peer.capabilities = ['rl2.client-port'];
    await settle();
    const asked: Array<{ kind: string; request: unknown }> = [];
    h.link.onClient((request, answer) => {
      asked.push({ kind: request.kind, request: request.request });
      answer({ opened: true });
      answer({ opened: false, reason: 'twice' });
    });
    h.last().deliver({ t: 'client', id: 'p1', kind: 'openExternal', request: { url: 'https://auth.example/consent' } });
    expect(asked).toEqual([{ kind: 'openExternal', request: { url: 'https://auth.example/consent' } }]);
    expect(h.last().of('clientAnswer')).toEqual([{ t: 'clientAnswer', id: 'p1', answer: { opened: true } }]);
  });

  it('sends nothing for an answer given after its channel ended, and answers `noClient` with no listener', async () => {
    const h = await harness();
    h.peer.capabilities = ['rl2.client-port'];
    await settle();
    const later: Array<(answer: unknown) => void> = [];
    const off = h.link.onClient((_request, answer) => void later.push(answer));
    const first = h.last();
    first.deliver({ t: 'client', id: 'p1', kind: 'openExternal', request: { url: 'https://auth.example/consent' } });
    first.end('carrier');
    await settle();
    expect(h.channels).toHaveLength(2);
    later[0]!({ opened: true });
    expect(first.of('clientAnswer')).toEqual([]);
    expect(h.last().of('clientAnswer')).toEqual([]);
    off();
    h.last().deliver({ t: 'client', id: 'p2', kind: 'reveal', request: '/x' });
    expect(h.last().of('clientAnswer')).toEqual([{ t: 'clientAnswer', id: 'p2', answer: { noClient: true } }]);
  });

  // the review's finding 4: the port across the channel is behind its capability, on the channel that asked
  it('takes no `client` request from a channel whose peer listed no `rl2.client-port`, with a listener or without', async () => {
    const h = await harness();
    await settle();
    const asked: string[] = [];
    const off = h.link.onClient((request, answer) => (asked.push(request.id), answer({ opened: true })));
    h.last().deliver({ t: 'client', id: 'p1', kind: 'openExternal', request: { url: 'https://auth.example/consent' } });
    off();
    h.last().deliver({ t: 'client', id: 'p2', kind: 'reveal', request: '/x' });
    expect(asked).toEqual([]);
    expect(h.last().of('clientAnswer')).toEqual([]);
  });
});

describe('the channel’s own life', () => {
  // the review's minor finding: a channel's end and the next channel are said as they happen, though `onState` holds `up`
  // through the grace
  it('says each channel’s loss and the next channel, through a reconnect within the grace', async () => {
    const h = await harness();
    const heard: string[] = [];
    h.link.onChannel((event) => void heard.push(event));
    await settle();
    expect(heard).toEqual(['current']);
    h.last().end('carrier');
    expect(heard).toEqual(['current', 'lost']);
    await settle();
    expect(h.states).toEqual(['up']);
    expect(heard).toEqual(['current', 'lost', 'current']);
  });
});

describe('what only one channel holds', () => {
  it('fails a `oneChannel` call in flight at its channel’s end `offline`, sends nothing of it on the next, and carries the rest', async () => {
    const h = await harness();
    await settle();
    const lease = h.link.call('connectors.declare', { leaseId: 'lease-1', tools: [] }, { oneChannel: true });
    const status = h.link.call('session.status', {});
    expect(h.last().of('call')).toHaveLength(2);
    h.last().end('carrier');
    expect(await lease).toMatchObject({ ok: false, error: { code: 'offline' } });
    await settle();
    expect(h.channels).toHaveLength(2);
    expect((h.last().of('call') as unknown as Array<{ name: string }>).map((m) => m.name)).toEqual(['session.status']); // carried, as before
    const [m] = h.last().of('call') as unknown as Array<{ id: string }>;
    h.last().deliver({ t: 'result', id: m.id, ok: true, output: { process: 'ready' } });
    expect(await status).toEqual({ ok: true, output: { process: 'ready' } });
  });

  it('fails a `oneChannel` call made while no channel is current at once, and sends it nowhere', async () => {
    const h = await harness();
    h.net.direct = false;
    h.net.relay = false;
    await settle();
    expect(await h.link.call('connectors.open', { artifactId: 'a' }, { oneChannel: true })).toMatchObject({ ok: false, error: { code: 'offline' } });
    h.net.direct = true;
    await advance(1000);
    expect(h.link.state()).toBe('up');
    expect(h.last().of('call')).toEqual([]);
  });

  // the review's finding 2: a lease act a copy of which went out on the lost channel ends its caller's wait at the loss,
  // unknown whether it ran, never carried to (or asked about on) the next channel under the old lease
  it('refuses a `oneChannel` act made while no channel is current, and ends one sent on the lost channel at the loss, unknown whether it ran', async () => {
    const h = await harness();
    h.peer.capabilities = ['rl2.executor.machine'];
    await settle();
    const before = h.last();
    const sent = h.link.act({ action: 'connectors.call', args: { leaseId: 'lease-1', request: {} }, executor: 'machine', oneChannel: true });
    expect(before.of('act')).toHaveLength(1);
    const plain = h.link.act({ action: 'session.acquire', args: { appSessionId: 'a', reason: 'send' }, executor: 'machine' });
    expect(before.of('act')).toHaveLength(2);
    before.end('carrier');
    expect(await sent.outcome).toEqual({ state: 'unknown', reason: 'channel-lost' });
    // made in the reconnect, with no channel current: refused at once
    const stray = h.link.act({ action: 'connectors.refresh', args: { leaseId: 'lease-1' }, executor: 'machine', oneChannel: true });
    expect(await stray.outcome).toEqual({ state: 'refused', reason: 'offline' });
    await settle();
    expect(h.channels).toHaveLength(2);
    const next = h.last();
    // the plain act resealed; nothing of the lease act on the next channel
    expect((next.of('act') as unknown as Array<{ action: { opId: string } }>).map((m) => m.action.opId)).toEqual([plain.opId]);
    expect(next.of('query')).toEqual([]);
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
  it('is heard as the link’s end (`ended`), also when the link was down already', async () => {
    const h = await harness();
    await settle();
    h.last().end('removed');
    await settle();
    expect(h.link.state()).toBe('down');
    const heard: string[] = [];
    h.link.onState((state) => heard.push(state));
    h.link.close();
    expect(h.link.ended()).toBe('closed');
    expect(heard).toEqual(['down']);
  });
});

// P5 O7 M7: the live bench's resume, measured without touching routing (the bench seam's `drop` and `release`): the
// current channel closed as a loss, and the link held off its machine until released, so a turn is written while it is
// down; then it reconnects at once, as on a network's return.
describe('the bench hold', () => {
  it('closes the current channel as a loss, attempts nothing while held (no retry, no probe), and reconnects at once on release', async () => {
    const h = await harness();
    await settle();
    expect(h.link.benchHold()).toBe(true);
    expect(h.channels[0]!.closedWith).toBe('closed');
    await settle();
    expect(h.attempts).toHaveLength(1);
    await advance(30_000);
    expect(h.link.state()).toBe('down');
    h.link.probe('network');
    await settle();
    expect(h.attempts).toHaveLength(1);
    expect(h.link.benchHold()).toBe(false); // held already
    h.link.benchRelease();
    await settle();
    expect(h.link.state()).toBe('up');
    expect(h.attempts).toHaveLength(2);
    expect(h.states).toEqual(['up', 'down', 'up']);
  });

  it('adopts nothing a direct recheck brings while held: the link stays held and down, the new channel closed', async () => {
    const h = await harness({ timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    h.net.direct = false;
    await settle();
    expect(h.link.carrier()).toBe('relay');
    h.net.direct = true;
    h.hold(true);
    await advance(60_000); // the recheck's direct handshake, held in flight
    expect(h.pending.map((p) => p.carrier)).toEqual(['direct']);
    expect(h.link.benchHold()).toBe(true);
    h.hold(false);
    h.pending.shift()!.release();
    await settle();
    expect(h.channels.at(-1)!.carrier).toBe('direct');
    expect(h.channels.at(-1)!.closedWith).toBe('closed');
    await advance(3_000);
    expect(h.link.state()).toBe('down');
    h.link.benchRelease();
    await settle();
    expect(h.link.state()).toBe('up');
  });

  it('holds nothing without a channel: a drop then is false and leaves the link to reconnect on its own', async () => {
    const h = await harness();
    await settle();
    h.net.direct = false;
    h.net.relay = false;
    h.last().end('carrier');
    await advance(3_000);
    expect(h.link.state()).toBe('down');
    expect(h.link.benchHold()).toBe(false);
    h.net.relay = true;
    await advance(10_000); // the backoff's own retry, unheld
    expect(h.link.state()).toBe('up');
  });

  it('holds nothing on a closed link, and a release with no hold is nothing', async () => {
    const h = await harness();
    await settle();
    h.link.benchRelease();
    await settle();
    expect(h.attempts).toHaveLength(1);
    h.link.close();
    expect(h.link.benchHold()).toBe(false);
  });
});

// ---- P5 O15 M2b §F: the link in the window ---------------------------------------------------------------------------
// The mode table, its 13 rows and §F's unit list, on the fake clock with fake carriers and a fake reach whose answers
// the test gives. The direct lane's target is the record's tailnet address (`ws://100.64.1.2:47830` unless a case says
// otherwise), the relay lane's the hub's URL (`http://127.0.0.1:9`).
const HUB = '127.0.0.1:9';
const DIRECT = '100.64.1.2';
const linesOf = (h: { logs: string[] }, part: string) => h.logs.filter((line) => line.includes(part));
/** Moves the fake clock by exactly `ms`, the attempts' async work let run after. */
async function after(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle(8);
}
/** A link up over the direct carrier, then woken from an hour: in the lanes with no channel, both lanes waiting. */
async function woken(options: HarnessOptions = {}) {
  const h = await harness({ window: true, ...options });
  await settle();
  h.link.wake(3_600_000);
  await settle();
  return h;
}

describe('the window: today, with no window open', () => {
  it('closes the cached relay socket at a loss for `timeout`, and keeps it at a carrier’s end or a `closed`', async () => {
    const h = await harness();
    h.net.direct = false;
    await settle();
    expect(h.relay()).toEqual({ opened: 1, closed: 0 });
    h.last().end('carrier');
    await settle();
    h.last().end('closed');
    await settle();
    expect(h.link.carrier()).toBe('relay');
    expect(h.relay()).toEqual({ opened: 1, closed: 0 });
    h.last().end('timeout');
    await settle();
    expect(h.relay()).toEqual({ opened: 2, closed: 1 });
    expect(h.link.carrier()).toBe('relay');
  });

  it('never runs more than one attempt: probes that open no window, with a reach given, join the one in flight', async () => {
    const h = await harness({ window: true });
    h.hold(true);
    await settle();
    expect(h.pending).toHaveLength(1);
    for (const reason of ['focus', 'unlock', 'wake', 'person'] as const) h.link.probe(reason);
    await settle();
    expect(h.pending).toHaveLength(1);
    expect(h.window.opened).toEqual([]);
    expect(linesOf(h, 'probe focus: seeking')).toHaveLength(1);
    h.verdicts.direct.push('protocol');
    h.pending.shift()!.release();
    await settle();
    expect(h.pending).toHaveLength(1); // the one `again` asked for, after it
    expect(h.handshakeTimeouts.every((ms) => ms === undefined)).toBe(true); // today's deadlines throughout
  });
});

describe('the window: opening', () => {
  it('a wake of 10 s with a channel closes it for `wake`, closes the relay socket, aborts a hanging attempt and starts none of today’s', async () => {
    const h = await harness({ window: true, timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    h.net.direct = false;
    await settle();
    expect(h.link.carrier()).toBe('relay');
    const relayChannel = h.last();
    h.net.direct = true;
    h.holdOn.direct = true;
    h.link.probe('focus'); // today's recheck: a direct handshake that hangs
    await settle();
    expect(h.pending.map((p) => p.carrier)).toEqual(['direct']);
    const recheck = h.carriers.at(-1)!;
    const counts = [h.attempts.length, h.directDials().length, h.relayTries().length];
    h.link.wake(10_000);
    await settle();
    expect(relayChannel.closedWith).toBe('wake');
    expect(h.relay().closed).toBe(1);
    expect(recheck.closed).toBe(true);
    expect(linesOf(h, 'wake after')).toEqual([`${h.o.ref}: wake after 10000 ms: dropped the relay channel, the relay socket, 1 attempt(s) in flight`]);
    expect(linesOf(h, 'the relay channel was lost (wake)')).toHaveLength(1);
    await after(5_000);
    expect([h.attempts.length, h.directDials().length, h.relayTries().length]).toEqual(counts);
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([1, 1]);
  });

  it('a wake of 10 s on a link that is down clears today’s retry timer', async () => {
    const h = await harness({ window: true });
    h.net.direct = false;
    h.net.relay = false;
    await settle();
    expect(h.link.state()).toBe('down'); // its retry is due in 1 s
    const tries = h.relayTries().length;
    h.link.wake(10_000);
    await settle();
    expect(linesOf(h, 'wake after')).toEqual([`${h.o.ref}: wake after 10000 ms: dropped no channel`]);
    await after(5_000);
    expect(h.relayTries()).toHaveLength(tries);
  });

  it('a wake of 9 s with a channel sends today’s ping and drops nothing', async () => {
    const h = await harness({ window: true, timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    h.net.direct = false;
    await settle();
    const channel = h.last();
    h.link.wake(9_999);
    expect(channel.of('ping')).toHaveLength(1);
    channel.deliver({ t: 'pong', at: 1 });
    await advance(3_000);
    expect(channel.closed).toBe(false);
    expect(h.relay().closed).toBe(0);
    expect(h.window.opened).toEqual(['wake']);
    expect(linesOf(h, 'probe wake')).toEqual([`${h.o.ref}: probe wake: ping sent`]);
    expect(linesOf(h, 'wake after')).toEqual([]);
  });

  it('`probe(network)` with no channel aborts the attempt in flight and enters the lanes', async () => {
    const h = await harness({ window: true });
    h.gate.resolve = true; // the first attempt waits on the hub's record
    await settle();
    expect(h.link.state()).toBe('connecting');
    h.link.probe('network');
    await settle();
    expect(linesOf(h, 'probe network')).toEqual([`${h.o.ref}: probe network: seeking`]);
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([1, 1]);
    for (const held of h.gate.held.splice(0)) held.release(); // the aborted attempt goes on, and dials nothing
    await settle();
    expect(h.directDials()).toHaveLength(0);
    expect(h.attempts).toHaveLength(0);
  });

  it('a second wake in the lanes aborts both lane attempts and starts both counts and the floor’s timer again', async () => {
    const h = await woken({ timing: { LANE_ATTEMPTS: 1, DIRECT_BUCKET: { burst: 10, perMinute: 5 } } });
    const wokeAt = Date.now();
    h.hold(true);
    h.window.answer(DIRECT);
    h.window.answer(HUB);
    await settle();
    expect(h.pending.map((p) => p.carrier).sort()).toEqual(['direct', 'relay']);
    const [direct, relay] = [h.carriers.find((c, i) => c.kind === 'direct' && i > 0)!, h.carriers.find((c) => c.kind === 'relay')!];
    await after(5_000);
    h.link.wake(3_600_000);
    await settle();
    expect([direct.closed, relay.closed, h.sockets.every((s) => s.closed)]).toEqual([true, true, true]);
    expect(linesOf(h, 'wake after').at(-1)).toBe(`${h.o.ref}: wake after 3600000 ms: dropped no channel, 2 attempt(s) in flight`);
    for (const held of h.pending.splice(0)) held.release(); // they complete late: nothing adopted
    h.hold(false);
    await settle();
    expect(h.link.carrier()).toBeNull();
    // the counts at zero: a lane of one attempt attempts again
    h.verdicts.direct.push('protocol');
    h.window.answer(DIRECT);
    await settle();
    expect(linesOf(h, 'lane direct: spent (1 attempts)')).toHaveLength(1);
    // the floor's timer from the second wake
    await after(wokeAt + 14_999 - Date.now());
    expect(linesOf(h, 'floor after')).toEqual([]);
    await after(1);
    expect(linesOf(h, 'floor after')).toEqual([`${h.o.ref}: floor after 10000 ms: today's attempts from here (10 s without a channel)`]);
  });

  it('a second wake after the floor aborts today’s attempt and returns the link to the lanes', async () => {
    const h = await woken();
    h.gate.resolve = true;
    await advance(10_000);
    expect(linesOf(h, 'floor after')).toHaveLength(1);
    h.link.wake(3_600_000);
    await settle();
    expect(linesOf(h, 'wake after').at(-1)).toBe(`${h.o.ref}: wake after 3600000 ms: dropped no channel, 1 attempt(s) in flight`);
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([1, 1]);
    for (const held of h.gate.held.splice(0)) held.release();
    await settle();
    expect(h.link.carrier()).toBeNull(); // today's aborted attempt dialled nothing
    h.window.answer(DIRECT);
    await settle();
    expect(h.link.carrier()).toBe('direct');
  });

  it('a `focus` probe in the lanes starts nothing', async () => {
    const h = await woken();
    const counts = [h.attempts.length, h.directDials().length, h.relayTries().length];
    h.link.probe('focus');
    await settle();
    expect([h.attempts.length, h.directDials().length, h.relayTries().length]).toEqual(counts);
    expect(linesOf(h, 'probe focus')).toEqual([`${h.o.ref}: probe focus: seeking`]);
  });

  it('a link created inside an open window enters the lanes, with no attempt of today’s and no opening of its own', async () => {
    const h = await harness({ window: true, openBeforeCreation: true });
    await settle();
    expect(h.attempts).toEqual([]);
    expect([h.directDials(), h.relayTries()]).toEqual([[], []]);
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([1, 1]);
    expect(h.window.opened).toEqual(['wake']); // the test's, before the link was made
    h.window.answer(DIRECT);
    await settle();
    expect(h.link.carrier()).toBe('direct');
    expect(h.handshakeTimeouts).toEqual([2_000]);
  });
});

describe('the window: the lanes', () => {
  it('a direct answer makes exactly one dial, to that address, with no race and no record fetch, and takes one token', async () => {
    const h = await harness({ window: true, addresses: ['ws://100.64.1.2:47830', 'ws://100.64.1.3:47830'], timing: { DIRECT_BUCKET: { burst: 4, perMinute: 0.001 } } });
    await settle(); // up over today's race: three tokens left
    h.gate.resolve = true; // the hub's record is never read in the window
    h.link.wake(3_600_000);
    await settle();
    const before = h.dialled.length;
    h.window.answer('100.64.1.3');
    await settle();
    expect(h.dialled.slice(before)).toEqual(['ws://100.64.1.3:47830']);
    expect(h.link.carrier()).toBe('direct');
    expect(h.gate.held).toHaveLength(1); // the background read, still out: not waited for
    expect(h.handshakeTimeouts.at(-1)).toBe(2_000);
    h.last().end('carrier'); // lost in the lanes: the lanes again, their counts kept
    await settle();
    h.window.answer(DIRECT);
    await settle();
    expect(h.dialled.slice(before)).toEqual(['ws://100.64.1.3:47830', 'ws://100.64.1.2:47830']); // one token left
    h.last().end('carrier');
    await settle();
    h.window.answer(DIRECT);
    await settle();
    expect(h.dialled.slice(before)).toHaveLength(2);
    expect(linesOf(h, 'lane direct: spent (the bucket holds fewer than two tokens)')).toHaveLength(1);
  });

  it('a hub answer opens a new relay socket, never one from before the window', async () => {
    const h = await harness({ window: true });
    h.net.direct = false;
    await settle();
    expect(h.relay()).toEqual({ opened: 1, closed: 0 });
    h.link.wake(3_600_000);
    await settle();
    expect(h.relay()).toEqual({ opened: 1, closed: 1 });
    expect(linesOf(h, 'wake after')[0]).toContain('dropped the relay channel, the relay socket');
    h.window.answer(HUB);
    await settle();
    expect(h.relay()).toEqual({ opened: 2, closed: 1 });
    expect(h.link.carrier()).toBe('relay');
  });

  it('both lanes attempt at once when both answer', async () => {
    const h = await woken();
    h.hold(true);
    h.window.answer(DIRECT);
    h.window.answer(HUB);
    await settle();
    expect(h.pending.map((p) => p.carrier).sort()).toEqual(['direct', 'relay']);
  });

  it('an answer during a backoff starts the attempt exactly at the backoff’s end, not earlier and not later (row 2)', async () => {
    const h = await woken({ hub: false });
    h.verdicts.direct.push('protocol');
    h.window.answer(DIRECT);
    await settle();
    const failedAt = Date.now();
    expect(linesOf(h, 'attempt failed (direct): protocol; next in 100 ms')).toHaveLength(1);
    await after(50);
    h.window.answer(DIRECT);
    await settle();
    const dials = h.directDials().length;
    await after(49);
    expect(h.directDials()).toHaveLength(dials);
    await after(1);
    expect(h.directDials()).toHaveLength(dials + 1);
    expect(h.directDials().at(-1)).toBe(failedAt + 100);
    expect(h.link.carrier()).toBe('direct');
  });

  it('six failures back off 100, 250, 500, 1,000 and 2,000 ms, and then the lane is spent and dials no more though its target answers', async () => {
    const h = await woken({ timing: { DIRECT_BUCKET: { burst: 100, perMinute: 0 } } });
    h.verdicts.direct.push(...Array<string>(6).fill('protocol'));
    const first = h.directDials().length;
    h.window.answer(DIRECT);
    await settle();
    for (const backoff of [100, 250, 500, 1_000, 2_000]) {
      h.window.answer(DIRECT); // during the backoff: kept
      await settle();
      await after(backoff);
    }
    const times = h.directDials().slice(first);
    expect(times.slice(1).map((at, i) => at - times[i]!)).toEqual([100, 250, 500, 1_000, 2_000]);
    expect(linesOf(h, 'lane direct: spent (6 attempts)')).toHaveLength(1);
    expect(h.window.waiting(DIRECT)).toBe(0);
    h.window.answer(DIRECT);
    await after(3_000);
    expect(h.directDials().slice(first)).toHaveLength(6);
  });

  it('with one token in the bucket the direct lane is spent without a dial', async () => {
    const h = await woken({ timing: { DIRECT_BUCKET: { burst: 2, perMinute: 0.001 } } }); // today's first dial took one
    const dials = h.directDials().length;
    h.window.answer(DIRECT);
    await settle();
    expect(h.directDials()).toHaveLength(dials);
    expect(linesOf(h, 'lane direct: spent (the bucket holds fewer than two tokens)')).toHaveLength(1);
    expect(h.window.waiting(HUB)).toBe(1);
  });

  it('both lanes spent fire the floor at once', async () => {
    const h = await woken({ hub: false, timing: { DIRECT_BUCKET: { burst: 2, perMinute: 0.001 } } });
    expect(linesOf(h, 'lane relay: spent (no target)')).toHaveLength(1);
    const attempts = h.attempts.length;
    h.window.answer(DIRECT);
    await settle();
    expect(linesOf(h, 'floor after')).toEqual([`${h.o.ref}: floor after 0 ms: today's attempts from here (both lanes spent)`]);
    expect(h.attempts).toHaveLength(attempts + 1); // today's, over the last token
    expect(h.handshakeTimeouts.at(-1)).toBeUndefined();
    expect(h.link.carrier()).toBe('direct');
  });

  it('dials the cached record with no fetch, and a newer one from the background read adds its addresses', async () => {
    const h = await harness({ window: true, cached: ['ws://100.64.1.2:47830'], addresses: ['ws://100.64.1.9:47830'] });
    await settle();
    h.gate.resolve = true;
    h.link.wake(3_600_000);
    await settle();
    expect([h.window.waiting('100.64.1.2'), h.window.waiting('100.64.1.9')]).toEqual([1, 0]);
    h.gate.held.shift()!.release();
    await settle();
    expect([h.window.waiting('100.64.1.2'), h.window.waiting('100.64.1.9')]).toEqual([1, 1]);
    h.window.answer('100.64.1.9');
    await settle();
    expect(h.dialled.at(-1)).toBe('ws://100.64.1.9:47830');
    expect(h.link.carrier()).toBe('direct');
  });

  it('a recheck that comes due while the direct lane runs dials nothing and arms its timer again (row 11)', async () => {
    const h = await woken({ timing: { DIRECT_RECHECK_MS: 3_000, PING_SILENCE_MS: [100_000, 100_000] } });
    h.window.answer(HUB);
    await settle();
    expect(h.link.carrier()).toBe('relay'); // row 6: the direct lane goes on
    const dials = h.directDials().length;
    await after(3_000);
    await after(3_000);
    h.link.probe('focus');
    h.last().deliver({ t: 'pong', at: 1 });
    await settle();
    expect(h.directDials()).toHaveLength(dials);
    h.window.answer(DIRECT);
    await settle();
    expect(h.directDials()).toHaveLength(dials + 1);
    expect(h.link.carrier()).toBe('direct'); // the lane's success is the switch (row 7)
    expect(linesOf(h, 'switching from the relay')).toHaveLength(1);
  });

  it('discards a lane attempt begun under an older trust generation, and counts it a failure', async () => {
    const h = await woken();
    h.hold(true);
    h.window.answer(DIRECT);
    await settle();
    expect(h.pending).toHaveLength(1);
    await h.view.advance([await rotate(h.o)], []);
    await settleUntil(() => h.logs.some((l) => l.includes('retired a key')));
    h.hold(false);
    h.pending.shift()!.release();
    await settle();
    expect(h.channels.at(-1)!.closedWith).toBe('closed');
    expect(linesOf(h, 'attempt failed (direct): a trust generation that moved; next in 100 ms')).toHaveLength(1);
    expect(h.link.carrier()).toBeNull();
  });

  it('counts a successful attempt too: with one attempt to a lane, a relay adopted and lost opens no second socket in that entry', async () => {
    const h = await woken({ timing: { LANE_ATTEMPTS: 1 } });
    h.window.answer(HUB);
    await settle();
    expect(h.link.carrier()).toBe('relay');
    const tries = h.relayTries().length;
    h.last().end('closed');
    await settle();
    h.window.answer(HUB); // before the floor: the relay lane waits again, and its answer finds its count spent
    await settle();
    expect(linesOf(h, 'lane relay: spent (1 attempts)')).toHaveLength(1);
    await after(9_000);
    expect(h.relayTries()).toHaveLength(tries);
  });

  it('a lane at its count after a success is spent at the loss, waiting on nothing: both spent, the floor at once and today’s attempt', async () => {
    const h = await woken({ timing: { LANE_ATTEMPTS: 1 }, directTarget: () => null });
    expect(linesOf(h, 'lane direct: spent (no target)')).toHaveLength(1);
    h.window.answer(HUB);
    await settle();
    expect(h.link.carrier()).toBe('relay');
    await after(3_000);
    const lostAt = Date.now();
    h.last().end('closed'); // no second answer from the hub follows
    await settle();
    expect(linesOf(h, 'lane relay: spent (1 attempts)')).toHaveLength(1);
    expect(h.window.waiting(HUB)).toBe(0);
    expect(linesOf(h, 'floor after')).toEqual([`${h.o.ref}: floor after 0 ms: today's attempts from here (both lanes spent)`]);
    expect(h.attempts.at(-1)!.at).toBe(lostAt);
    expect(h.handshakeTimeouts.at(-1)).toBeUndefined(); // today's
  });
});

describe('the window: the two arrival orders', () => {
  it('both answer and the relay’s open stalls: the direct lane adopts within its own steps, the relay attempt aborted and its socket closed', async () => {
    const h = await woken();
    h.relayPlan.push('stall');
    const answeredAt = Date.now();
    h.window.answer(DIRECT);
    h.window.answer(HUB);
    await settle();
    expect(h.link.carrier()).toBe('direct');
    expect(Date.now()).toBe(answeredAt);
    h.stalled.shift()!.open(); // the hub's upgrade answers late
    await settle();
    expect(h.sockets.map((s) => s.closed)).toEqual([true]);
    expect(h.link.carrier()).toBe('direct');
  });

  it('both answer and the direct handshake stalls: the relay is adopted, the direct attempt ends at its 2 s deadline, and the lane’s next success is the switch', async () => {
    const h = await woken({ timing: { PING_SILENCE_MS: [100_000, 100_000], DIRECT_BUCKET: { burst: 10, perMinute: 5 } } }); // the hour asleep refilled it
    h.holdOn.direct = true;
    h.window.answer(DIRECT);
    h.window.answer(HUB);
    await settle();
    expect(h.link.carrier()).toBe('relay');
    const relayChannel = h.last();
    await after(1_999);
    expect(linesOf(h, 'attempt failed (direct)')).toEqual([]);
    await after(1);
    expect(linesOf(h, 'attempt failed (direct)')).toEqual([`${h.o.ref}: attempt failed (direct): timeout; next in 100 ms`]);
    h.holdOn.direct = false;
    h.window.answer(DIRECT);
    await settle();
    await after(100);
    expect(h.link.carrier()).toBe('direct');
    expect(relayChannel.closedWith).toBe('closed');
    expect(h.sockets.every((s) => s.closed)).toBe(true);
  });

  it('both complete, relay first: the relay is adopted and then replaced, one channel and no socket left', async () => {
    const h = await woken();
    h.hold(true);
    h.window.answer(DIRECT);
    h.window.answer(HUB);
    await settle();
    h.pending.find((p) => p.carrier === 'relay')!.release();
    await settle();
    expect(h.link.carrier()).toBe('relay');
    h.pending.find((p) => p.carrier === 'direct')!.release();
    await settle();
    expect(h.link.carrier()).toBe('direct');
    expect(h.channels.filter((c) => !c.closed)).toHaveLength(1);
    expect(h.sockets.every((s) => s.closed)).toBe(true);
  });

  it('both complete, direct first: the relay’s channel and socket are closed', async () => {
    const h = await woken();
    h.hold(true);
    h.window.answer(DIRECT);
    h.window.answer(HUB);
    await settle();
    h.pending.find((p) => p.carrier === 'direct')!.release();
    await settle();
    expect(h.link.carrier()).toBe('direct');
    expect(h.sockets.every((s) => s.closed)).toBe(true); // aborted: its socket closed at once
    h.pending.find((p) => p.carrier === 'relay')!.release(); // its handshake completes anyway
    await settle();
    expect(h.channels.filter((c) => !c.closed).map((c) => c.carrier)).toEqual(['direct']);
    expect(h.link.carrier()).toBe('direct');
  });

  it.each(['direct', 'relay'] as const)('both complete in one turn, %s handled first: one direct channel and no socket left', async (firstHandled) => {
    const h = await woken();
    h.hold(true);
    h.window.answer(DIRECT);
    h.window.answer(HUB);
    await settle();
    const order = firstHandled === 'direct' ? ['direct', 'relay'] : ['relay', 'direct'];
    for (const carrier of order) h.pending.find((p) => p.carrier === carrier)!.release();
    await settle();
    expect(h.link.carrier()).toBe('direct');
    expect(h.channels.filter((c) => !c.closed).map((c) => c.carrier)).toEqual(['direct']);
    expect(h.sockets.every((s) => s.closed)).toBe(true);
  });

  it('an aborted attempt that completes late adopts nothing and leaves no socket', async () => {
    const h = await woken();
    h.hold(true);
    h.window.answer(HUB);
    await settle();
    h.link.wake(3_600_000);
    await settle();
    h.pending.shift()!.release();
    await settle();
    expect(h.link.carrier()).toBeNull();
    expect(h.channels.at(-1)!.closedWith).toBe('closed');
    expect(h.sockets.every((s) => s.closed)).toBe(true);
  });
});

describe('the window: catch-up', () => {
  it('makes a catch-up’s redials under `holds(2)`, a token each, and says each', async () => {
    const h = await woken({ hub: false, timing: { DIRECT_BUCKET: { burst: 4, perMinute: 0.001 } } }); // today's took one: three left
    h.verdicts.direct.push('behind', 'behind', 'behind');
    const dials = h.directDials().length;
    h.window.answer(DIRECT);
    await settle();
    expect(h.directDials()).toHaveLength(dials + 2); // three to two, two to one, and no third: the last is today's
    expect(linesOf(h, 'catch-up, dial')).toEqual([`${h.o.ref}: attempt (direct): catch-up, dial 2`]);
    expect(linesOf(h, 'attempt failed (direct)')).toEqual([`${h.o.ref}: attempt failed (direct): the direct bucket: the bucket holds fewer than two tokens; next in 100 ms`]);
  });

  it('aborted between two pages dials no more and leaves no carrier open', async () => {
    const h = await woken();
    h.verdicts.direct.push('behind');
    h.redialGate.on = true;
    const carriers = h.carriers.length;
    h.window.answer(DIRECT);
    await settle();
    expect(h.redialGate.waiting).toHaveLength(1); // the first page read: the next dial waits
    const dials = h.directDials().length;
    h.link.wake(3_600_000);
    await settle();
    h.redialGate.waiting.shift()!();
    await settle();
    expect(h.directDials()).toHaveLength(dials);
    expect(h.carriers.slice(carriers).every((c) => c.closed)).toBe(true);
    expect(linesOf(h, 'catch-up, dial')).toEqual([]);
  });

  it('writes today’s catch-up redials too, with no window open and after the floor', async () => {
    const h = await harness({ window: true });
    h.verdicts.direct.push('behind');
    await settle();
    expect(h.link.carrier()).toBe('direct');
    expect(linesOf(h, 'catch-up')).toEqual([`${h.o.ref}: attempt (today's): catch-up, dial 2`]);
    h.link.wake(3_600_000);
    await settle();
    h.net.direct = false;
    h.verdicts.relay.push('behind', 'behind');
    await after(10_000); // nothing answers: the floor, and today's attempt over the relay
    expect(h.link.carrier()).toBe('relay');
    expect(h.handshakeTimeouts.at(-1)).toBeUndefined();
    expect(linesOf(h, 'catch-up').slice(1)).toEqual([`${h.o.ref}: attempt (today's): catch-up, dial 2`, `${h.o.ref}: attempt (today's): catch-up, dial 3`]);
  });
});

describe('the window: the floor', () => {
  it('after 10 s in the lanes with no channel and nothing in flight: the lanes’ timers cleared, their waits cancelled, and today’s attempt once', async () => {
    const h = await woken();
    h.net.direct = false;
    h.net.relay = false;
    h.window.answer(DIRECT);
    h.window.answer(HUB);
    await settle(); // both failed: backing off, and waiting again
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([1, 1]);
    const counts = [h.directDials().length, h.relayTries().length];
    await after(9_999);
    expect(linesOf(h, 'floor after')).toEqual([]);
    await after(1);
    expect(linesOf(h, 'floor after')).toEqual([`${h.o.ref}: floor after 10000 ms: today's attempts from here (10 s without a channel)`]);
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([0, 0]);
    expect([h.directDials().length, h.relayTries().length]).toEqual([counts[0]! + 1, counts[1]! + 1]); // one attempt of today's
  });

  it('a lane attempt in flight at 10 s is not aborted: it is adopted when it completes, and today’s attempt does not run', async () => {
    const h = await woken();
    await after(9_000);
    h.hold(true);
    h.window.answer(DIRECT);
    await settle();
    await after(1_500);
    expect(h.carriers.at(-1)!.closed).toBe(false);
    expect(linesOf(h, 'floor after')).toEqual([]);
    h.hold(false);
    h.pending.shift()!.release();
    await settle();
    expect(h.link.carrier()).toBe('direct');
    await after(2_000);
    expect(h.handshakeTimeouts.slice(1).every((ms) => ms === 2_000)).toBe(true); // nothing of today's since the wake
  });

  it('a lane attempt in flight at 10 s that fails starts today’s attempt once then, with no backoff before it', async () => {
    const h = await woken();
    await after(9_000);
    h.hold(true);
    h.verdicts.direct.push('protocol');
    h.window.answer(DIRECT);
    await settle();
    await after(1_500);
    h.hold(false);
    const failedAt = Date.now();
    h.pending.shift()!.release();
    await settle();
    expect(linesOf(h, 'attempt failed (direct)')).toEqual([`${h.o.ref}: attempt failed (direct): protocol; no next attempt of its own`]);
    expect(linesOf(h, 'floor after')).toEqual([`${h.o.ref}: floor after 10500 ms: today's attempts from here (10 s without a channel)`]);
    expect(h.attempts.at(-1)).toEqual({ carrier: 'direct', at: failedAt });
    expect(h.handshakeTimeouts.at(-1)).toBeUndefined();
    expect(h.link.carrier()).toBe('direct');
  });

  it('a lane attempt begun at 9.9 s over a path inside the budget is adopted within the lane’s own steps, past the floor’s time', async () => {
    const h = await woken();
    const wokeAt = Date.now();
    await after(9_900);
    h.holdOn.relay = true; // its handshake takes 400 ms, so it completes past the floor's time
    const answeredAt = Date.now();
    h.window.answer(HUB);
    await settle();
    await after(400);
    expect(Date.now() - wokeAt).toBe(10_300);
    expect(h.link.carrier()).toBeNull();
    h.pending.shift()!.release();
    await settle();
    expect(h.link.carrier()).toBe('relay');
    expect(Date.now() - answeredAt).toBeLessThanOrEqual(1_000);
    await after(1_000);
    expect(linesOf(h, 'floor after')).toEqual([]);
    expect(h.handshakeTimeouts.slice(1)).toEqual([2_000]); // the lane's one attempt, and nothing of today's since the wake
    expect(h.relayTries()).toEqual([answeredAt]);
  });

  it('from the floor’s time no lane attempt starts though a target that had answered before it answers again', async () => {
    const h = await woken();
    h.verdicts.direct.push('protocol');
    h.window.answer(DIRECT);
    await settle();
    h.gate.resolve = true; // today's attempt, from the floor, waits on the hub's record
    await after(10_000);
    expect(linesOf(h, 'floor after')).toHaveLength(1);
    const dials = h.directDials().length;
    expect(h.window.waiting(DIRECT)).toBe(0);
    h.window.answer(DIRECT);
    await after(1_000);
    expect(h.directDials()).toHaveLength(dials);
    expect(linesOf(h, 'lanes again')).toEqual([]);
  });

  it('a channel adopted before 10 s clears the floor’s timer, and one lost again in the lanes starts it from zero', async () => {
    const h = await woken({ timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    const wokeAt = Date.now();
    await after(2_000);
    h.window.answer(DIRECT);
    await settle();
    expect(h.link.carrier()).toBe('direct');
    await after(3_000);
    h.last().end('carrier');
    await settle();
    await after(wokeAt + 14_999 - Date.now());
    expect(linesOf(h, 'floor after')).toEqual([]);
    await after(1);
    expect(linesOf(h, 'floor after')).toEqual([`${h.o.ref}: floor after 10000 ms: today's attempts from here (10 s without a channel)`]);
  });
});

describe('the window: a path that returns after the floor (row 12)', () => {
  it('a lane’s first answer then, on a link with no channel, clears today’s retry timer and attempts in the same turn with no second probe', async () => {
    const h = await woken();
    h.net.direct = false;
    h.net.relay = false;
    await after(10_000); // the floor: today's attempt fails, its retry due in 1 s
    expect(linesOf(h, 'floor after')).toHaveLength(1);
    const tries = h.relayTries().length;
    await after(500);
    h.net.relay = true;
    const answeredAt = Date.now();
    h.window.answer(HUB);
    await settle();
    expect(linesOf(h, 'lanes again')).toEqual([`${h.o.ref}: lanes again: 127.0.0.1:9 answered, 500 ms after the floor`]);
    expect(h.link.carrier()).toBe('relay');
    expect(h.relayTries().slice(tries)).toEqual([answeredAt]);
    expect(h.window.asked.filter((target) => target.includes(HUB))).toHaveLength(1); // its one wait, from the wake
    await after(1_000);
    expect(h.relayTries().slice(tries)).toEqual([answeredAt]); // the retry was cleared
  });

  it('aborts today’s attempt in flight, which adopts nothing when it completes later and leaves no socket', async () => {
    const h = await woken();
    h.net.direct = false;
    h.relayPlan.push('stall'); // today's attempt, from the floor, hangs in its relay open
    await after(10_000);
    expect(h.stalled).toHaveLength(1);
    await after(300);
    h.window.answer(HUB);
    await settle();
    expect(h.link.carrier()).toBe('relay');
    h.stalled.shift()!.open();
    await settle();
    expect(h.sockets.filter((s) => !s.closed)).toHaveLength(1); // the lane's, adopted
    expect(h.channels.filter((c) => !c.closed)).toHaveLength(1);
  });

  it('the other carrier first answering while the first carrier’s attempt runs to its end attempts at once, aborting nothing, with no attempt of today’s', async () => {
    const h = await woken({ timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    await after(9_000);
    h.holdOn.direct = true; // under the lane's 2 s deadline, so past the floor's time
    h.window.answer(DIRECT);
    await settle();
    const directCarrier = h.carriers.at(-1)!;
    await after(1_500);
    const answeredAt = Date.now();
    h.window.answer(HUB);
    await settle();
    expect(linesOf(h, 'lanes again')).toEqual([`${h.o.ref}: lanes again: 127.0.0.1:9 answered, 500 ms after the floor`]);
    expect(h.link.carrier()).toBe('relay');
    expect(Date.now()).toBe(answeredAt);
    expect(directCarrier.closed).toBe(false);
    expect(h.handshakeTimeouts.slice(1).every((ms) => ms === 2_000)).toBe(true); // nothing of today's since the wake
    h.holdOn.direct = false;
    h.pending.shift()!.release();
    await settle();
    expect(h.link.carrier()).toBe('direct');
  });

  it('runs the floor’s timer again from the return, and a second floor starts today’s attempt once more', async () => {
    const h = await woken();
    const wokeAt = Date.now();
    h.net.direct = false;
    h.net.relay = false;
    await after(10_500);
    h.window.answer(HUB); // the return, at 10.5 s: its attempt fails, and it backs off
    await settle();
    await after(9_999);
    expect(linesOf(h, 'floor after')).toHaveLength(1);
    await after(1);
    expect(linesOf(h, 'floor after')).toHaveLength(2);
    expect(h.relayTries().filter((at) => at >= wokeAt + 10_000).map((at) => at - wokeAt)).toEqual([10_000, 10_500, 20_500]);
  });

  it('a lane that had its answer before the floor brings no return, from that target or another of its own', async () => {
    const h = await woken({ addresses: ['ws://100.64.1.2:47830', 'ws://100.64.1.3:47830'] });
    h.net.direct = false;
    h.verdicts.relay.push(...Array<string>(20).fill('protocol'));
    h.window.answer('100.64.1.2');
    await settle();
    await after(10_000);
    expect(h.window.waiting('100.64')).toBe(0);
    h.window.answer('100.64.1.2');
    h.window.answer('100.64.1.3');
    await after(1_000);
    expect(linesOf(h, 'lanes again')).toEqual([]);
  });

  it('the second lane’s first answer returns the link once more, nothing a third time, and a new opening starts it over', async () => {
    const h = await woken();
    h.net.direct = false;
    h.net.relay = false;
    await after(10_500);
    h.window.answer(HUB);
    await settle();
    await after(10_500);
    h.window.answer(DIRECT);
    await settle();
    await after(10_000);
    expect(linesOf(h, 'lanes again')).toHaveLength(2);
    expect(linesOf(h, 'floor after')).toHaveLength(3);
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([0, 0]);
    h.window.answer(DIRECT);
    h.window.answer(HUB);
    await settle();
    expect(linesOf(h, 'lanes again')).toHaveLength(2);
    h.link.wake(3_600_000);
    await settle();
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([1, 1]);
  });

  it('the direct lane’s first answer with one token in the bucket aborts nothing and writes its spent line', async () => {
    const h = await woken({ timing: { DIRECT_BUCKET: { burst: 2, perMinute: 0.001 } } });
    h.gate.resolve = true;
    await after(10_000); // today's attempt, waiting on the hub's record
    h.window.answer(DIRECT);
    await settle();
    expect(linesOf(h, 'lane direct: spent (the bucket holds fewer than two tokens)')).toHaveLength(1);
    expect(linesOf(h, 'lanes again')).toEqual([]);
    for (const held of h.gate.held.splice(0)) held.release();
    await settle();
    expect(h.link.carrier()).toBe('direct'); // today's attempt went on
  });

  it('a lane’s first answer on a link with a channel starts nothing', async () => {
    const h = await woken();
    h.net.direct = false;
    await after(10_000); // today's attempt, up over the relay
    expect(h.link.carrier()).toBe('relay');
    expect(h.window.waiting(HUB)).toBe(1);
    const opened = h.relay().opened;
    h.window.answer(HUB);
    await settle();
    expect(h.relay().opened).toBe(opened);
    expect(linesOf(h, 'lanes again')).toEqual([]);
  });

  it('the other lane’s attempt kept across the return fails with the lane’s first backoff, while the answering lane is in flight', async () => {
    const h = await woken({ timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    await after(9_000);
    h.holdOn.direct = true; // the direct attempt ends at its 2 s deadline, at 11 s: past the floor and the return
    h.window.answer(DIRECT);
    await settle();
    await after(1_500);
    h.holdOn.relay = true; // the return's relay attempt is still in flight then
    h.window.answer(HUB);
    await settle();
    expect(linesOf(h, 'lanes again')).toHaveLength(1);
    await after(500);
    expect(linesOf(h, 'attempt failed (direct)')).toEqual([`${h.o.ref}: attempt failed (direct): timeout; next in 100 ms`]);
    expect(h.link.carrier()).toBeNull();
  });
});

describe('the window: its close', () => {
  /** Up over the relay from the wake, then the relay channel lost at 58 s: the lanes again, the floor's timer to 68 s. */
  async function lostLate() {
    const h = await woken({ timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    const wokeAt = Date.now();
    h.window.answer(HUB);
    await settle();
    expect(h.link.carrier()).toBe('relay');
    await after(58_000);
    h.last().end('carrier');
    await settle();
    h.holdOn.relay = true; // under the lane's 2 s deadline
    await after(1_000);
    h.window.answer(HUB);
    await settle();
    expect(h.pending.map((p) => p.carrier)).toEqual(['relay']);
    await after(1_000); // the window closes, the attempt in flight
    expect(h.window.reach.windowOpen()).toBe(false);
    return { h, wokeAt };
  }

  it('a lane attempt in flight at the close schedules none of today’s while it runs, and is adopted when it completes', async () => {
    const { h, wokeAt } = await lostLate();
    await after(500);
    h.holdOn.relay = false;
    h.pending.shift()!.release();
    await settle();
    expect(h.link.carrier()).toBe('relay');
    expect(h.relayTries().filter((at) => at > wokeAt).map((at) => at - wokeAt)).toEqual([59_000]);
    expect(h.handshakeTimeouts.slice(1).every((ms) => ms === 2_000)).toBe(true);
  });

  it('a lane attempt in flight at the close that fails runs today’s backoff then, and not before', async () => {
    const { h, wokeAt } = await lostLate();
    expect(h.directDials().filter((at) => at > wokeAt + 59_000)).toEqual([]);
    await after(1_000); // its 2 s deadline
    await settle();
    expect(linesOf(h, 'attempt failed (relay): timeout; no next attempt of its own')).toHaveLength(1);
    await after(1); // the backoff's first step, 0 ms: a timer the fake clock runs a millisecond on
    expect(h.link.carrier()).toBe('direct');
    expect(h.directDials().filter((at) => at > wokeAt + 59_000).map((at) => at - wokeAt)).toEqual([61_001]);
    expect(h.handshakeTimeouts.at(-1)).toBeUndefined();
  });

  it('after the floor, the close ends every wait and today’s loop goes on', async () => {
    const h = await woken();
    const wokeAt = Date.now();
    h.net.direct = false;
    h.net.relay = false;
    await after(10_000);
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([1, 1]);
    await after(50_000);
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([0, 0]);
    const tries = h.relayTries().length;
    await advance(10_000);
    expect(h.relayTries().length).toBeGreaterThan(tries);
    expect(h.relayTries().every((at) => at - wokeAt >= 10_000 || at <= wokeAt)).toBe(true);
  });
});

describe('the window: a recheck in flight', () => {
  async function recheckingWhenLost() {
    const h = await harness({ window: true, timing: { PING_SILENCE_MS: [100_000, 100_000] } });
    h.net.direct = false;
    await settle();
    expect(h.link.carrier()).toBe('relay');
    h.net.direct = true;
    h.holdOn.direct = true;
    h.link.probe('network'); // the window, a ping, and today's recheck: its direct handshake hangs
    await settle();
    expect(linesOf(h, 'probe network: ping sent')).toHaveLength(1);
    expect(h.pending.map((p) => p.carrier)).toEqual(['direct']);
    const dials = h.directDials().length;
    h.last().end('carrier'); // the relay channel lost in the window
    await settle();
    expect(h.window.waiting(HUB)).toBe(1); // the relay lane
    expect(h.window.waiting(DIRECT)).toBe(0); // the direct lane's attempt is the recheck's
    h.window.answer(DIRECT);
    await settle();
    expect(h.directDials()).toHaveLength(dials); // no second direct dial
    return h;
  }

  it('the relay lane starts, no second direct dial is made, and the recheck’s channel is adopted when it completes', async () => {
    const h = await recheckingWhenLost();
    h.holdOn.direct = false;
    h.pending.shift()!.release();
    await settle();
    expect(h.link.carrier()).toBe('direct');
    expect(h.window.waiting(HUB)).toBe(0); // row 5: both lanes stop
  });

  it('the recheck’s failure counts as the direct lane’s', async () => {
    const h = await recheckingWhenLost();
    h.verdicts.direct.push('protocol');
    h.holdOn.direct = false;
    h.pending.shift()!.release();
    await settle();
    expect(linesOf(h, 'attempt failed (direct): no direct carrier; next in 100 ms')).toHaveLength(1);
    expect(h.window.waiting(DIRECT)).toBe(1); // backing off, and waiting again
  });
});

type Harness = Awaited<ReturnType<typeof harness>>;
/** P5 O15 M2b review I4: a refusal, a close and a hold, each as the link meets it. */
const leaving: Record<'hold' | 'refuse' | 'close', (h: Harness) => void> = {
  hold: (h) => void expect(h.link.benchHold()).toBe(true),
  refuse: (h) => h.last().end('removed'),
  close: (h) => h.link.close(),
};

describe('the window: a refusal, a close or a hold (row 10)', () => {
  /** A link up over the relay, today's recheck's direct dial hanging; inside a window when `windowed`. */
  async function recheckHanging(windowed: boolean): Promise<Harness> {
    const h = windowed ? await woken() : await harness({ window: true });
    h.net.direct = false;
    if (windowed) h.window.answer(HUB);
    await settle();
    expect(h.link.carrier()).toBe('relay');
    h.net.direct = true;
    h.directPlan.push('stall');
    h.link.probe(windowed ? 'network' : 'focus'); // today's ping and recheck
    await settle();
    expect(h.stalledDials).toHaveLength(1);
    return h;
  }

  it.each(['hold', 'refuse', 'close'] as const)('inside a window, a %s aborts a recheck in flight: its hanging dial’s signal fires', async (how) => {
    const h = await recheckHanging(true);
    leaving[how](h);
    await settle();
    expect(h.signals.at(-1)!.kind).toBe('direct');
    expect(h.signals.at(-1)!.signal!.aborted).toBe(true);
    expect(h.channels.filter((c) => !c.closed)).toEqual([]);
    const carriers = h.carriers.length;
    h.stalledDials.shift()!.open(); // too late: the dial was rejected at its abort and brings nothing
    await settle();
    expect(h.carriers).toHaveLength(carriers);
  });

  it.each(['hold', 'refuse', 'close'] as const)('with no window open, a %s leaves the recheck to today’s handling', async (how) => {
    const h = await recheckHanging(false);
    leaving[how](h);
    await settle();
    expect(h.signals.at(-1)!.signal!.aborted).toBe(false);
    h.stalledDials.shift()!.open();
    await settle();
    expect(h.channels.filter((c) => !c.closed)).toEqual([]); // the recheck's channel closed at its end, as today
  });

  it('inside a window, a close aborts today’s attempt: its hanging relay open’s signal fires, and the socket it brings later is closed', async () => {
    const h = await woken();
    h.net.direct = false;
    h.relayPlan.push('stall');
    await after(10_000); // the floor: today's attempt, its relay open hanging
    expect(h.stalled).toHaveLength(1);
    h.link.close();
    expect(h.signals.at(-1)!.kind).toBe('relay');
    expect(h.signals.at(-1)!.signal!.aborted).toBe(true);
    h.stalled.shift()!.open();
    await settle();
    expect(h.sockets.every((socket) => socket.closed)).toBe(true);
  });

  it('with no window open, a close leaves today’s attempt its own handling', async () => {
    const h = await harness({ window: true });
    h.net.direct = false;
    h.relayPlan.push('stall');
    await settle();
    expect(h.stalled).toHaveLength(1);
    h.link.close();
    expect(h.signals.at(-1)!.signal!.aborted).toBe(false);
    h.stalled.shift()!.open();
    await settle();
    expect(h.sockets.every((socket) => socket.closed)).toBe(true); // closed by today's own check of a closed link
  });
});

describe('the window: what goes ahead of the subscriptions', () => {
  it('writes the `wrote … ahead of the subscriptions` line once, with the count and bytes of the acts and queries, before the `sub`s; nothing to send writes none', async () => {
    const h = await harness();
    await settle();
    const first = h.last();
    expect(linesOf(h, 'ahead of the subscriptions')).toEqual([]);
    h.link.subscribe({ session: { lane: 'B', id: 'app-1' } }, sink().s);
    h.link.act({ action: 'endpoint.state', args: {} }); // inside its 60 s: resealed
    const older = h.link.act({ action: 'endpoint.state', args: { n: 2 } });
    first.deliver({ t: 'ack', opId: older.opId, state: 'accepted' }); // acked: asked about
    first.end('carrier');
    await settle();
    const next = h.last();
    const ahead = next.sent.filter((m) => m.t === 'act' || m.t === 'query');
    expect(ahead.map((m) => m.t).sort()).toEqual(['act', 'query']);
    const bytes = ahead.reduce((sum, m) => sum + Buffer.byteLength(JSON.stringify(m), 'utf8'), 0);
    expect(linesOf(h, 'ahead of the subscriptions')).toEqual([`${h.o.ref}: wrote 2 act message(s), ${bytes} bytes, ahead of the subscriptions`]);
    expect(next.sent.findIndex((m) => m.t === 'sub')).toBeGreaterThan(Math.max(...ahead.map((m) => next.sent.indexOf(m))));
  });
});

// P5 O15 M2b Decision Log 15 (c): what the live bench (e2e/remote-latency-live.spec.ts) holds the link to
describe('the window and the live bench', () => {
  it('passes a held link over at a wake and at `probe(network)`, and its release is today’s attempt', async () => {
    const h = await harness({ window: true });
    await settle();
    expect(h.link.benchHold()).toBe(true);
    await settle();
    const attempts = h.attempts.length;
    h.link.wake(3_600_000);
    h.link.probe('network');
    await advance(5_000);
    expect(h.attempts).toHaveLength(attempts);
    expect(h.window.opened).toEqual([]);
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([0, 0]);
    expect([...linesOf(h, 'probe wake'), ...linesOf(h, 'probe network')]).toEqual([`${h.o.ref}: probe wake: held`, `${h.o.ref}: probe network: held`]);
    const releasedAt = Date.now();
    h.link.benchRelease();
    await settle();
    expect(h.link.state()).toBe('up');
    expect(h.attempts.at(-1)).toEqual({ carrier: 'direct', at: releasedAt });
    expect(h.handshakeTimeouts.at(-1)).toBeUndefined();
    expect(linesOf(h, 'bench release')).toEqual([`${h.o.ref}: bench release: today's attempt (no window)`]);
  });

  it('a release while a window is open is today’s attempt, no lane waiting or attempting, and a lane result aborted at the hold adopts nothing', async () => {
    const h = await woken();
    h.window.answer(HUB);
    await settle();
    expect(h.link.carrier()).toBe('relay'); // row 6: the direct lane goes on
    h.holdOn.direct = true;
    h.holdOn.stubborn = true; // the direct lane's handshake completes when the test says, its abort notwithstanding
    h.window.answer(DIRECT);
    await settle();
    expect(h.pending).toHaveLength(1);
    expect(h.link.benchHold()).toBe(true);
    await settle();
    h.link.wake(3_600_000); // passed over
    h.window.reach.openWindow('network'); // another link's opening, while this one is held
    await settle();
    h.holdOn.direct = false;
    const releasedAt = Date.now();
    h.link.benchRelease();
    await settle();
    expect(linesOf(h, 'bench release')).toEqual([`${h.o.ref}: bench release: today's attempt (the window open)`]);
    expect(h.link.carrier()).toBe('direct');
    expect(h.attempts.at(-1)).toEqual({ carrier: 'direct', at: releasedAt });
    expect(h.handshakeTimeouts.at(-1)).toBeUndefined(); // today's deadlines
    expect([h.window.waiting(DIRECT), h.window.waiting(HUB)]).toEqual([0, 0]);
    const adopted = h.last();
    h.pending.shift()!.release(); // the lane's aborted handshake completes late
    await settle();
    expect(h.link.carrier()).toBe('direct');
    expect(h.channels.filter((c) => !c.closed)).toEqual([adopted]);
  });

  it('keeps the cached relay socket through a drop (a `closed` loss)', async () => {
    const h = await harness({ window: true });
    h.net.direct = false;
    await settle();
    h.link.benchHold();
    await settle();
    expect(h.relay()).toEqual({ opened: 1, closed: 0 });
    h.link.benchRelease();
    await settle();
    expect(h.link.carrier()).toBe('relay');
    expect(h.relay()).toEqual({ opened: 1, closed: 0 });
  });

  it('gives the direct lane no target on the relay-only leg (`directTarget` null)', async () => {
    const h = await harness({ window: true, directTarget: () => null });
    h.net.direct = false;
    await settle();
    h.link.wake(3_600_000);
    await settle();
    expect(linesOf(h, 'lane direct: spent (no target)')).toHaveLength(1);
    expect(h.window.waiting(DIRECT)).toBe(0);
    const dials = h.directDials().length;
    h.window.answer(HUB);
    await settle();
    expect(h.link.carrier()).toBe('relay');
    expect(h.directDials()).toHaveLength(dials);
  });

  it('notifies `up` after the subscriptions are sent, with nothing awaited between', async () => {
    const h = await harness();
    h.net.direct = false;
    h.net.relay = false;
    await settle();
    h.link.subscribe({ session: { lane: 'B', id: 'app-1' } }, sink().s);
    let subsAtUp = -1;
    h.link.onState((state) => {
      if (state === 'up') subsAtUp = h.last().of('sub').length;
    });
    h.net.relay = true;
    h.link.probe('focus');
    await settle();
    expect(subsAtUp).toBe(1);
  });
});
