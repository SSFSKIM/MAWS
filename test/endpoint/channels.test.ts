// The endpoint's channel table (O10 M4), over in-memory carriers: RL2's handshake through `acceptChannel`, `caps`
// first, the per-channel loop and its seams for M5–M8's routes, liveness, holds, removal by a new head, `caps` again on
// a change of grades, and the relay carrier's mapping of the hub's channel numbers. The suite over the hub and the
// direct listener is channel-suite.ts.
import { generateEphemeral, generateSigningKey, canonicalize, memoryOrgView, type ByteDuplex, type Channel, type ChannelMessage, type OrgView, type Right, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { duplexPair } from '../../apps/org-protocol/test-support/tamper-relay.ts';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import { createEndpoint } from '../../src/endpoint';
import { Channels, type ChannelRoutes, type RemoteChannel } from '../../src/endpoint/channels';
import type { ChannelHandler } from '../../src/endpoint/hub-link';
import { fakeServices, mintRef } from './fake-services';
import { genesis, memberId, newDevice, retiredDevice, revokedDevice, successor, type TestDevice } from './org-fixtures';

const ORG = 'org-m4';
const REF = mintRef();
const OWNER_GRADES: Right[] = ['spawn', 'shell', 'machine-admin'];
let machineKey: SigningKey;
let a1: TestDevice;
let b1: TestDevice;
let b2: TestDevice;
const A = memberId();
const B = memberId();
let chain: SignedOrgState[];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  machineKey = await generateSigningKey();
  a1 = await newDevice('a1');
  b1 = await newDevice('b1');
  b2 = await newDevice('b2');
  const g = await genesis(ORG, A, a1, await generateSigningKey());
  const s2 = await successor(g, [a1], (s) => {
    s.machines.push({ name: 'mini', ref: REF, pub: machineKey.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref: REF });
    s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device, b2.device] });
  });
  chain = [g, s2];
});

type Harness = {
  channels: Channels;
  view: OrgView;
  log: string[];
  holds: Set<string>;
  counts: { relayed: number; direct: number };
  rights: Map<string, Right[]>;
  serving: { on: boolean };
};
const live: Harness[] = [];

afterEach(async () => {
  for (const h of live.splice(0)) await h.channels.closeAll('restart');
});

function harness(options: { pingMs?: [number, number]; gate?: { reached(): void; open: Promise<void> } } = {}): Harness {
  const view = memoryOrgView({ chain: [...chain] });
  const log: string[] = [];
  const holds = new Set<string>();
  const counts = { relayed: 0, direct: 0 };
  const rights = new Map<string, Right[]>([[A, OWNER_GRADES]]);
  const serving = { on: true };
  let n = 0;
  const channels: Channels = new Channels({
    identity: () => (serving.on ? { ref: REF, key: machineKey, build: 'm4-unit', capabilities: [] } : null),
    org: () => view,
    adopt: async (states, transitions) => {
      await view.advance(states as SignedOrgState[], transitions as never);
      channels.adopted(view.head().state);
    },
    rights: async (member) => {
      options.gate?.reached();
      await options.gate?.open;
      return rights.get(member) ?? [];
    },
    hold: (reason) => {
      const id = `${reason}#${n++}`;
      holds.add(id);
      return () => void holds.delete(id);
    },
    counts: (c) => Object.assign(counts, c),
    log: (line) => void log.push(line),
    pingMs: options.pingMs,
  });
  const h = { channels, view, log, holds, counts, rights, serving };
  live.push(h);
  return h;
}

function device(who: TestDevice, member: string, clientClass: 'native-mac' | 'web-cards' = 'native-mac', view = memoryOrgView({ chain: [...chain] })): Device {
  return new Device({ identity: { org: ORG, member, device: who.device.id, clientClass, channelKey: who.channel, build: 'device', capabilities: [] }, org: view });
}

/** A carrier pair whose endpoint end the harness accepts as a direct channel. */
const dialDirect = (h: Harness, deadlineMs?: number) => () => {
  const [mine, theirs] = duplexPair();
  void h.channels.accept('direct', theirs, deadlineMs === undefined ? {} : { deadlineMs });
  return mine;
};

/** Messages a channel received, in order, and its close. */
function watch(channel: Channel): { messages: ChannelMessage[]; closed: Promise<string> } {
  const messages: ChannelMessage[] = [];
  channel.onMessage((m) => void messages.push(m));
  const closed = new Promise<string>((resolve) => channel.onClose((reason) => resolve(reason)));
  return { messages, closed };
}

async function until<T>(probe: () => T | undefined | false, what: string, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(5);
  }
}

describe('admission', () => {
  it('sends `caps` first, with the member’s grades on the machine, holds mawsd while the channel is open and counts it by carrier', async () => {
    const h = harness();
    const channel = await device(a1, A).open(dialDirect(h), REF);
    const seen = watch(channel);
    const caps = await until(() => seen.messages[0], 'caps');
    expect(caps).toEqual({ t: 'caps', member: A, device: 'a1', clientClass: 'native-mac', machine: { grades: OWNER_GRADES }, stateVersion: 2 });
    expect(h.counts).toEqual({ relayed: 0, direct: 1 });
    expect(h.holds.size).toBe(1);
    expect([...h.holds][0]).toMatch(/^channel#/);
    const other = await device(b1, B).open(dialDirect(h), REF);
    const b = watch(other);
    expect(await until(() => b.messages[0], 'caps')).toMatchObject({ t: 'caps', member: B, device: 'b1', machine: { grades: [] } });
    expect(h.counts.direct).toBe(2);
    expect(h.holds.size).toBe(1);
    channel.close('done');
    other.close('done');
    await until(() => h.counts.direct === 0, 'both channels gone');
    expect(h.holds.size).toBe(0);
  });

  it('serves nothing while the endpoint has no identity to sign with', async () => {
    const h = harness();
    h.serving.on = false;
    const [mine, theirs] = duplexPair();
    const closed = new Promise<string>((resolve) => mine.onClose?.(resolve));
    expect(await h.channels.accept('direct', theirs)).toBeNull();
    expect(await closed).toBe('unavailable');
  });

  it('refuses a device the head does not hold as it signed, and logs why', async () => {
    const h = harness();
    const ghost = await newDevice('ghost');
    await expect(device(ghost, A).open(dialDirect(h), REF)).rejects.toThrow();
    await until(() => h.log.some((line) => line.includes('unknown-device')), 'the refusal logged');
    await expect(device(b1, B, 'web-cards').open(dialDirect(h), REF)).rejects.toThrow();
    await until(() => h.log.some((line) => line.includes('class')), 'the class refusal logged');
    expect(h.counts.direct).toBe(0);
  });

  it('closes, and never registers, a channel whose handshake finished as the endpoint stopped serving', async () => {
    let open!: () => void;
    let reached!: () => void;
    const verified = new Promise<void>((resolve) => (reached = resolve));
    const h = harness({ gate: { reached, open: new Promise<void>((resolve) => (open = resolve)) } });
    const [mine, theirs] = duplexPair();
    const accepting = h.channels.accept('direct', theirs);
    const opening = device(a1, A).open(() => mine, REF);
    const refused = expect(opening).rejects.toThrow('unavailable');
    await verified;
    h.serving.on = false;
    open();
    expect(await accepting).toBeNull();
    await refused;
    expect(h.counts.direct).toBe(0);
    expect(h.holds.size).toBe(0);
  });

  it('closes a handshake still unfinished at its deadline', async () => {
    const h = harness();
    const [mine, theirs] = duplexPair();
    const closed = new Promise<string>((resolve) => mine.onClose?.(resolve));
    const started = Date.now();
    expect(await h.channels.accept('direct', theirs, { deadlineMs: 100 })).toBeNull();
    expect(await closed).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('reads nothing but the handshake before it verifies: a `call` in place of `h3` closes the carrier', async () => {
    const h = harness();
    const [mine, theirs] = duplexPair();
    const closed = new Promise<string>((resolve) => mine.onClose?.(resolve));
    const accepting = h.channels.accept('direct', theirs);
    const h2 = new Promise<void>((resolve) => mine.onBytes(() => resolve()));
    const e = await generateEphemeral();
    const n = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const h1 = { t: 'h1', protocol: { major: 1, minor: 0 }, build: 'raw', capabilities: [], org: ORG, machine: REF, member: A, device: 'a1', clientClass: 'native-mac', stateVersion: 2, e: e.pub, n };
    mine.send(new TextEncoder().encode(canonicalize(h1)));
    await h2;
    mine.send(new TextEncoder().encode(JSON.stringify({ t: 'call', id: '1', name: 'daemon.status', input: {} })));
    expect(await accepting).toBeNull();
    expect(await closed).toBe('malformed');
  });
});

describe('the loop', () => {
  it('answers `ping` with `pong`, ignores a kind it doesn’t know with one log line, and closes on a malformed known one', async () => {
    const h = harness();
    const dev = device(a1, A);
    const channel = await dev.open(dialDirect(h), REF);
    const pong = await dev.request(channel, { t: 'ping', at: 42 }, (m): m is ChannelMessage => m.t === 'pong');
    expect(pong).toEqual({ t: 'pong', at: 42 });
    await channel.send({ t: 'gossip', words: 'from a newer device' });
    await channel.send({ t: 'gossip' });
    expect(await dev.request(channel, { t: 'ping', at: 43 }, (m): m is ChannelMessage => m.t === 'pong')).toEqual({ t: 'pong', at: 43 });
    expect(h.log.filter((line) => line.includes('gossip'))).toHaveLength(1);
    const seen = watch(channel);
    await channel.send({ t: 'call', name: 'daemon.status' });
    expect(await seen.closed).toBe('malformed');
  });

  it('refuses every request as not offered until a route is set', async () => {
    const h = harness();
    const dev = device(a1, A);
    const channel = await dev.open(dialDirect(h), REF);
    expect(await dev.request(channel, { t: 'call', id: 'c1', name: 'daemon.status', input: {} }, (m): m is ChannelMessage => m.t === 'result')).toEqual({ t: 'result', id: 'c1', ok: false, error: { code: 'not-offered' } });
    const action = dev.action({ machine: REF, action: 'endpoint.grant', args: {} });
    expect(await dev.request(channel, { t: 'act', action }, (m): m is ChannelMessage => m.t === 'ack')).toEqual({ t: 'ack', opId: action.opId, state: 'refused', reason: 'not-offered' });
    expect(await dev.request(channel, { t: 'query', opId: action.opId, opCreated: action.opCreated, executor: 'endpoint' }, (m): m is ChannelMessage => m.t === 'queried')).toEqual({ t: 'queried', opId: action.opId, state: 'unavailable' });
    expect(await dev.request(channel, { t: 'sub', sub: 's1', session: { lane: 'B', id: 'x' }, cursor: null, credit: 1024 }, (m): m is ChannelMessage => m.t === 'ended')).toEqual({ t: 'ended', sub: 's1', reason: 'not-offered' });
  });

  it('hands each request to its route, in order, with the channel’s member, device and class', async () => {
    const h = harness();
    const heard: Array<[string, string, string, string, string]> = [];
    const routes: Partial<ChannelRoutes> = {
      call: (ch: RemoteChannel, m) => {
        heard.push(['call', ch.member, ch.device, ch.clientClass, m.id]);
        ch.send({ t: 'result', id: m.id, ok: true, output: { carrier: ch.carrier } });
      },
      sub: (ch, m) => void heard.push(['sub', ch.member, ch.device, ch.clientClass, m.sub]),
      credit: (ch, m) => void heard.push(['credit', ch.member, ch.device, ch.clientClass, m.sub]),
      unsub: (ch, m) => void heard.push(['unsub', ch.member, ch.device, ch.clientClass, m.sub]),
    };
    h.channels.setRoutes(routes);
    const dev = device(b1, B);
    const channel = await dev.open(dialDirect(h), REF);
    await channel.send({ t: 'sub', sub: 's1', session: { lane: 'A', id: 'x' }, cursor: null, credit: 1024 });
    await channel.send({ t: 'credit', sub: 's1', bytes: 2048 });
    await channel.send({ t: 'unsub', sub: 's1' });
    const result = await dev.request(channel, { t: 'call', id: 'c1', name: 'daemon.status', input: {} }, (m): m is ChannelMessage => m.t === 'result');
    expect(result).toEqual({ t: 'result', id: 'c1', ok: true, output: { carrier: 'direct' } });
    expect(heard).toEqual([
      ['sub', B, 'b1', 'native-mac', 's1'],
      ['credit', B, 'b1', 'native-mac', 's1'],
      ['unsub', B, 'b1', 'native-mac', 's1'],
      ['call', B, 'b1', 'native-mac', 'c1'],
    ]);
  });

  it('keeps a channel that answers its pings, and closes one that misses two', async () => {
    const h = harness({ pingMs: [40, 60] });
    const answering = await device(a1, A).open(dialDirect(h), REF);
    let pings = 0;
    answering.onMessage((m) => {
      if (m.t !== 'ping') return;
      pings++;
      void answering.send({ t: 'pong', at: m.at });
    });
    const silent = await device(b1, B).open(dialDirect(h), REF);
    const seen = watch(silent);
    expect(await seen.closed).toBe('timeout');
    expect(seen.messages.filter((m) => m.t === 'ping')).toHaveLength(2);
    await sleep(300);
    expect(answering.closed).toBe(false);
    expect(pings).toBeGreaterThanOrEqual(2);
    expect(h.counts.direct).toBe(1);
  });

  it('closes every channel with a sealed close on closeAll', async () => {
    const h = harness();
    const one = watch(await device(a1, A).open(dialDirect(h), REF));
    const two = watch(await device(b1, B).open(dialDirect(h), REF));
    await h.channels.closeAll('restart');
    expect(await one.closed).toBe('restart');
    expect(await two.closed).toBe('restart');
    expect(h.counts.direct).toBe(0);
    expect(h.holds.size).toBe(0);
  });
});

describe('a new head', () => {
  it('closes at once, `removed`, every channel of a device it retires or revokes, and keeps the rest', async () => {
    const h = harness();
    const a = watch(await device(a1, A).open(dialDirect(h), REF));
    const b = watch(await device(b1, B).open(dialDirect(h), REF));
    const c = watch(await device(b2, B).open(dialDirect(h), REF));
    const head = h.view.head();
    const dropped = await successor(head, [a1], async (s) => {
      const member = s.members.find((m) => m.id === B)!;
      member.devices = member.devices.filter((d) => d.id !== 'b1');
      s.retired.push(...(await retiredDevice(B, b1.device, s.issued)));
    });
    await h.view.advance([dropped], []);
    h.channels.adopted(h.view.head().state);
    expect(await b.closed).toBe('removed');
    const revoked = await successor(dropped, [a1], async (s) => {
      const member = s.members.find((m) => m.id === B)!;
      member.devices = member.devices.filter((d) => d.id !== 'b2');
      s.revoked.push(...(await revokedDevice(B, b2.device)));
    });
    await h.view.advance([revoked], []);
    h.channels.adopted(h.view.head().state);
    expect(await c.closed).toBe('removed');
    await sleep(50);
    expect(a.messages.filter((m) => m.t === 'caps')).toHaveLength(1);
    expect(h.counts.direct).toBe(1);
  });

  it('closes a channel whose device a state delivered over another channel drops', async () => {
    const h = harness();
    const admin = await device(a1, A).open(dialDirect(h), REF);
    const b = watch(await device(b1, B).open(dialDirect(h), REF));
    const dropped = await successor(h.view.head(), [a1], async (s) => {
      s.members = s.members.filter((m) => m.id !== B);
      s.revoked.push(...(await revokedDevice(B, b1.device)), ...(await revokedDevice(B, b2.device)));
    });
    await admin.send({ t: 'state', states: [dropped], transitions: [] });
    expect(await b.closed).toBe('removed');
    expect(h.view.head().state.version).toBe(3);
    expect(admin.closed).toBe(false);
  });

  it('sends `caps` again when the device’s grades change, and not otherwise', async () => {
    const h = harness();
    const b = watch(await device(b1, B).open(dialDirect(h), REF));
    await until(() => b.messages.length === 1, 'caps');
    h.channels.refreshCaps();
    await sleep(50);
    expect(b.messages).toHaveLength(1);
    h.rights.set(B, ['spawn']);
    h.channels.refreshCaps();
    const again = await until(() => b.messages[1], 'caps again');
    expect(again).toMatchObject({ t: 'caps', member: B, device: 'b1', machine: { grades: ['spawn'] } });
  });
});

describe('the relay carrier', () => {
  /** The hub's side of RL1's multiplex for one app channel: the device's first message opens it, numbered 7. */
  function relayed(h: Harness): { device: ByteDuplex; endpointClosed: () => boolean } {
    const toDevice: Array<(bytes: Uint8Array) => void> = [];
    const deviceClose: Array<(reason: string) => void> = [];
    let opened = false;
    let closedByEndpoint = false;
    const handler: ChannelHandler = h.channels.relay({
      sendChannel: (channel, bytes) => {
        expect(channel).toBe(7);
        const copy = Uint8Array.from(bytes);
        setTimeout(() => toDevice.forEach((l) => l(copy)), 0);
        return true;
      },
      closeChannel: (channel) => {
        expect(channel).toBe(7);
        closedByEndpoint = true;
        setTimeout(() => deviceClose.forEach((l) => l('closed')), 0);
      },
    });
    const device: ByteDuplex = {
      send: (bytes) => {
        const copy = Uint8Array.from(bytes);
        setTimeout(() => {
          if (!opened) {
            opened = true;
            handler.opened(7, copy);
          } else handler.data(7, copy);
        }, 0);
      },
      onBytes: (l) => void toDevice.push(l),
      onClose: (l) => void deviceClose.push(l),
      close: () => setTimeout(() => handler.closed(7, 'closed'), 0),
    };
    return { device, endpointClosed: () => closedByEndpoint };
  }

  it('runs the hub’s channel as the same channel: the first payload is `h1`, `caps` comes first, and each end’s close reaches the other', async () => {
    const h = harness();
    const first = relayed(h);
    const channel = await device(a1, A).open(() => first.device, REF);
    const seen = watch(channel);
    expect(await until(() => seen.messages[0], 'caps')).toMatchObject({ t: 'caps', member: A });
    expect(h.counts).toEqual({ relayed: 1, direct: 0 });
    channel.close('done');
    await until(() => h.counts.relayed === 0, 'the relayed channel gone');
    const second = relayed(h);
    const again = watch(await device(a1, A).open(() => second.device, REF));
    await h.channels.closeAll('restart');
    expect(await again.closed).toBe('restart');
    expect(second.endpointClosed()).toBe(true);
  });
});

describe('which daemon binds the direct listener', () => {
  it('a unit daemon does; a private one only under MAWS_ENDPOINT_DIRECT=1', async () => {
    const cases: Array<['unit' | 'private', Record<string, string>, boolean]> = [
      ['unit', {}, true],
      ['private', {}, false],
      ['private', { MAWS_ENDPOINT_DIRECT: '1' }, true],
      ['private', { MAWS_ENDPOINT_DIRECT: 'yes' }, false],
    ];
    for (const [kind, env, binds] of cases) {
      const services = fakeServices({ kind });
      const endpoint = createEndpoint({ env, direct: { interfaces: () => ({}) } });
      await endpoint.start(services);
      expect(endpoint.direct !== null).toBe(binds);
      // Unenrolled, it serves nothing: the listener waits for the machine to be listed.
      expect(endpoint.status().listener).toEqual({ bound: false });
      await endpoint.stop();
      services.cleanup();
    }
  });
});
