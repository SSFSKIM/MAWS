// Main's document bridge (P5 O7 M5b, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5's "The `document`
// stream", its "On this Mac" half; M5b's Proves for this file): `artifacts.open` of an artifact on an RL2 machine, through
// the real route (remote lane B's adapter, `routeLaneB`), over a link whose streams are the device's real table
// (../machines/remote/streams.ts), the endpoint played by the test with a machine's store behind it, and the window's
// replica the real port provider (src/artifacts/provider/port.ts) on the port posted to the page. Proves: the port bridged
// to a `document` stream, frames length-prefixed both ways under each side's credit; `edit` first, `view` on a `grade` or
// `read-only` refusal with `readOnly`, a `view` port that never writes; a reopen after `carrier` and after `host` that
// carries the provider's unacked updates; and every path ending (a refusal for good, a link down, an open unanswered,
// malformed bytes, the window gone, the port closed, the app's stop).
import { EventEmitter } from 'node:events';
import type { DeviceMessage, EndpointMessage } from 'org-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LengthPrefixed, lengthPrefixed } from '@artifacts/provider/frame-stream';
import { decodeFrame, encodeFrame, type Frame } from '@artifacts/provider/frames';
import { PortProvider } from '@artifacts/provider/port';
import { applyV1, checkUpdate, diffV1, newDoc, stateVector, type Doc } from '@artifacts/yjs';
import { DOC_PORT_CHANNEL } from '@shared/ipc/doc-port';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { FakeLink, MINI } from '../../../test/lane-b/fake-link';
import { End } from '../../../test/lane-b/port-pair';
import { clientOf } from '../ipc/clients';
import type { MainContext } from '../ipc/router';
import type { LinkState } from '../machines/manager';
import { StreamTable, type StreamRequest, type StreamSink } from '../machines/remote/streams';
import { createRemoteLaneB, routeLaneB } from '../lane-b/remote';
import { ArtifactMachines } from './machines';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const DOC = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const row = (kind = 'document') => ({ id: DOC, kind, title: 'Plan', createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 3 });
const text = (doc: Doc) => doc.get('root').toString();
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A link whose streams are the device's real table; its channel is current while it is `up`. */
class TableLink extends FakeLink {
  /** Told of each message the device sends. */
  onSend: (message: DeviceMessage) => void = () => {};
  readonly sent: DeviceMessage[] = [];
  readonly table = new StreamTable({
    send: (m) => (this.state() === 'up' ? (this.sent.push(m), this.onSend(m), true) : false),
    current: () => this.state() === 'up',
    peerCapabilities: () => this.peerCapabilities(),
    log: () => {},
  });
  override openStream(request: StreamRequest, sink: StreamSink) {
    return this.table.open(request, sink, this.ended());
  }
  override set(state: LinkState, carrier?: 'direct' | 'relay' | null, refusal?: string | null): void {
    super.set(state, carrier, refusal);
    if (state === 'up') this.table.onCurrent();
    else this.table.onLost();
  }
  hear(message: EndpointMessage): void {
    this.table.receive(message);
  }
  opens() {
    return this.sent.filter((m) => m.t === 'streamOpen') as Array<Extract<DeviceMessage, { t: 'streamOpen' }>>;
  }
  closes(id: string) {
    return this.sent.filter((m) => m.t === 'streamClose' && m.id === id).map((m) => (m as { reason: string }).reason);
  }
}

/**
 * The machine as the device meets it over a `document` stream: its store's doc behind an endpoint document channel per
 * stream (step 1 at the open, step 2 for a step 1, each content frame checked, applied and acked by the channel's count),
 * each direction under the other's credit. `deaf`: the device's frames are taken (and refunded) but the host commits
 * nothing, as frames in flight when a carrier goes. `cut`: the size of the chunks the host's frames are sent in.
 */
class Machine {
  readonly doc = newDoc();
  revision = 0;
  deaf = false;
  cut = 64 * 1024;
  /** The endpoint's credit for the device's bytes, granted at each open. */
  grant = 256 * 1024;
  readonly channels = new Map<string, Channel>();
  /** Every frame type the device sent, by stream. */
  readonly heard = new Map<string, Frame['type'][]>();

  constructor(readonly link: TableLink) {
    // what the device sends reaches the machine a turn later, as over a channel
    link.onSend = (m) => queueMicrotask(() => {
      if (m.t === 'streamData') this.channels.get(m.id)?.data(m.offset, new Uint8Array(Buffer.from(m.data, 'base64url')));
      if (m.t === 'streamCredit') this.channels.get(m.id)?.refund(m.bytes);
      if (m.t === 'streamClose') this.channels.delete(m.id);
    });
  }

  /** The stream the `n`th open named, once it went out. */
  async open(n: number): Promise<Extract<DeviceMessage, { t: 'streamOpen' }>> {
    await vi.waitFor(() => expect(this.link.opens().length).toBeGreaterThan(n));
    return this.link.opens()[n]!;
  }
  accept(open: Extract<DeviceMessage, { t: 'streamOpen' }>): Channel {
    const channel = new Channel(this, open.id, open.credit);
    this.channels.set(open.id, channel);
    this.heard.set(open.id, []);
    this.link.hear({ t: 'streamOpened', id: open.id, credit: this.grant });
    channel.send({ type: 'step1', sv: stateVector(this.doc) });
    return channel;
  }
  refuse(open: Extract<DeviceMessage, { t: 'streamOpen' }>, reason: string): void {
    this.link.hear({ t: 'streamRefused', id: open.id, reason } as EndpointMessage);
  }
}

class Channel {
  readonly #frames = new LengthPrefixed(8 * 1024 * 1024);
  #in = 0; // the device's next offset
  #out = 0; // this side's next offset
  #taken = 0; // content frames received on this channel
  #grantLeft: number;
  readonly #outbox: Uint8Array[] = [];

  constructor(
    readonly machine: Machine,
    readonly id: string,
    /** The device's credit for this side's bytes. */
    public credit: number,
  ) {
    this.#grantLeft = machine.grant;
  }

  /** A host frame, length-prefixed, cut into chunks, sent within the device's credit. */
  send(frame: Frame | Uint8Array): void {
    const bytes = lengthPrefixed(frame instanceof Uint8Array ? frame : encodeFrame(frame));
    for (let at = 0; at < bytes.byteLength; at += this.machine.cut) this.#outbox.push(bytes.subarray(at, at + this.machine.cut));
    this.#flush();
  }
  /** Raw bytes past the framing, as a broken machine would send them. */
  sendRaw(bytes: Uint8Array): void {
    this.#outbox.push(bytes);
    this.#flush();
  }
  refund(bytes: number): void {
    this.credit += bytes;
    this.#flush();
  }
  close(reason: string): void {
    this.machine.channels.delete(this.id);
    this.machine.link.hear({ t: 'streamClose', id: this.id, reason });
  }
  #flush(): void {
    while (this.#outbox.length > 0 && this.credit > 0) {
      const head = this.#outbox[0]!;
      const n = Math.min(head.byteLength, this.credit);
      const offset = this.#out;
      this.#out += n;
      this.credit -= n;
      if (n === head.byteLength) this.#outbox.shift();
      else this.#outbox[0] = head.subarray(n);
      this.machine.link.hear({ t: 'streamData', id: this.id, offset, data: Buffer.from(head.subarray(0, n)).toString('base64url') }); // last: the device's refund may come back inside it
    }
  }

  data(offset: number, bytes: Uint8Array): void {
    expect(offset, 'the device’s offsets are contiguous').toBe(this.#in);
    expect(bytes.byteLength, 'the device stays within the endpoint’s credit').toBeLessThanOrEqual(this.#grantLeft);
    this.#in += bytes.byteLength;
    this.#grantLeft -= bytes.byteLength;
    // refunded as taken in, as the endpoint's plane does
    this.#grantLeft += bytes.byteLength;
    this.machine.link.hear({ t: 'streamCredit', id: this.id, bytes: bytes.byteLength });
    for (const raw of this.#frames.push(bytes) ?? []) this.#frame(decodeFrame(raw));
  }

  #frame(frame: Frame): void {
    this.machine.heard.get(this.id)?.push(frame.type);
    if (this.machine.deaf) return;
    if (frame.type === 'step1') return this.send({ type: 'step2', update: diffV1(this.machine.doc, frame.sv), revision: this.machine.revision });
    if (frame.type !== 'step2' && frame.type !== 'update') return;
    expect(checkUpdate(this.machine.doc, frame.update)).toBeNull(); // never a gap: the handshake rule holds over the bridge
    applyV1(this.machine.doc, frame.update, this);
    this.machine.revision += 1;
    this.#taken += 1;
    this.send({ type: 'ack', frames: this.#taken, revision: this.machine.revision });
  }
}

// A window's webContents as the bridge reaches it through its ClientRef (../ipc/clients.ts), with the events that end it.
let nextWindow = 1;
function fakeWindow() {
  return Object.assign(new EventEmitter(), { id: nextWindow++, postMessage: vi.fn(), destroyed: false, isDestroyed(this: { destroyed: boolean }) { return this.destroyed; } });
}

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

/** Remote lane B's adapter over the mini's link, routed as main's router does, with the bridge's channels in memory. */
function scene(options: { peers?: string[]; openTimeoutMs?: number } = {}) {
  const link = new TableLink(MINI);
  link.peers = options.peers ?? ['rl2.executor.machine', 'rl2.streams', 'rl2.read-open', 'rl2.artifacts', 'rl2.bytes'];
  link.answers.set('artifacts.get', () => ({ ok: true, output: { artifact: row() } }));
  const machine = new Machine(link);
  const machines = new ArtifactMachines();
  const channels: Array<[End, End]> = [];
  const logged: string[] = [];
  const adapter = createRemoteLaneB({
    local: LOCAL,
    layout: { get: () => null, onChange: () => () => {} },
    remote: (ref) => (ref === MINI ? link : null),
    onRemote: () => () => {},
    emit: () => {},
    artifactMachines: machines,
    docChannel: () => {
      const pair = End.pair();
      channels.push(pair);
      return { port1: pair[0], port2: pair[1] } as never;
    },
    timing: { sendPendingMs: 2_000, ...(options.openTimeoutMs !== undefined && { documentOpenMs: options.openTimeoutMs }) },
    log: (line) => void logged.push(line),
  } as Parameters<typeof createRemoteLaneB>[0]);
  stops.push(() => adapter.stop());
  const route = routeLaneB(async () => ({ ok: true, value: 'base' }) as unknown as CommandResult<CommandName>, (ref) => (ref === MINI ? link : null), adapter);
  const window = fakeWindow();
  const ctx: MainContext = { client: clientOf(window as never), target: MINI };
  const open = (input: Record<string, unknown> = { artifactId: DOC }) => route(MINI, 'artifacts.open', input, ctx) as Promise<CommandResult<'artifacts.open'>>;
  /** The port posted to the window for `channel`, as the preload hands it the page. */
  const posted = (channel: number): End => {
    const call = window.postMessage.mock.calls.find((c) => c[0] === DOC_PORT_CHANNEL && (c[1] as { channel: number }).channel === channel);
    expect(call, `a port posted for channel ${channel}`).toBeDefined();
    expect(call![1]).toEqual({ channel, artifactId: DOC });
    return (call![2] as End[])[0]!;
  };
  return { link, machine, machines, adapter, window, open, posted, channels, logged };
}

/** The window's replica: the real provider on the port posted for an answered open. */
function replica() {
  const doc = newDoc();
  const provider = new PortProvider(doc, { log: () => {} });
  stops.push(() => provider.destroy());
  return { doc, provider };
}

describe('the port bridged to a document stream', () => {
  it('opens `edit` with no op, posts the window its end once the stream opened, and relays the frames both ways length-prefixed, across chunks, under each side’s credit', async () => {
    const s = scene();
    s.machine.doc.get('root').insert(0, 'x'.repeat(3_000)); // a step 2 the endpoint cuts into many chunks
    s.machine.cut = 7;
    s.machine.grant = 40; // the device's bytes go 40 at a time, as the endpoint refunds them
    const opening = s.open();
    const open = await s.machine.open(0);
    expect(open).toEqual({ t: 'streamOpen', id: open.id, kind: 'document', credit: expect.any(Number), document: { artifactId: DOC, mode: 'edit' } });
    expect(s.window.postMessage).not.toHaveBeenCalled(); // no port before a stream stands behind it
    const channel = s.machine.accept(open);
    const answer = await opening;
    expect(answer).toEqual({ ok: true, value: { channel: expect.any(Number) } });
    const { channel: number } = (answer as { value: { channel: number } }).value;
    const r = replica();
    r.provider.connect(s.posted(number));
    await vi.waitFor(() => expect(r.provider.state).toMatchObject({ phase: 'live', synced: true }));
    expect(text(r.doc)).toBe('x'.repeat(3_000));
    r.doc.get('root').insert(0, 'typed here ');
    await vi.waitFor(() => expect(r.provider.state.unsaved).toBe(0));
    expect(text(s.machine.doc).startsWith('typed here x')).toBe(true);
    expect(s.machine.heard.get(open.id)).toEqual(expect.arrayContaining(['step1', 'step2', 'update']));
    // the bridge refunded every byte it took in: the machine's credit is whole again once nothing is in flight
    await vi.waitFor(() => expect(channel.credit).toBe(open.credit));
    expect(s.machines.machineOf(DOC)).toBe(MINI); // the one table: the open's artifact is the mini's
  });

  it('opens the suggestion doc when asked, and preflights the artifact as main’s local open does', async () => {
    const s = scene();
    const opening = s.open({ artifactId: DOC, doc: 'suggestions' });
    const open = await s.machine.open(0);
    expect(open.document).toEqual({ artifactId: DOC, mode: 'edit', doc: 'suggestions' });
    s.machine.accept(open);
    expect(await opening).toMatchObject({ ok: true });
    expect(s.link.calls.map((c) => c.name)).toEqual(['artifacts.get']);
  });
});

describe('edit, then view', () => {
  it('reopens `view` on a `grade` or `read-only` refusal and answers `readOnly`; the view port forwards only step 1 and awareness', async () => {
    for (const reason of ['grade', 'read-only']) {
      const s = scene();
      s.machine.doc.get('root').insert(0, 'from the machine');
      const opening = s.open();
      s.machine.refuse(await s.machine.open(0), reason);
      const view = await s.machine.open(1);
      expect(view.document).toEqual({ artifactId: DOC, mode: 'view' });
      s.machine.accept(view);
      const answer = await opening;
      expect(answer).toEqual({ ok: true, value: { channel: expect.any(Number), readOnly: true } });
      const r = replica();
      r.provider.connect(s.posted((answer as { value: { channel: number } }).value.channel));
      await vi.waitFor(() => expect(r.provider.state.synced).toBe(true));
      expect(text(r.doc)).toBe('from the machine');
      r.provider.awareness.setLocalStateField('user', { name: 'me' }); // presence still goes
      r.doc.get('root').insert(0, 'nope ');
      await flush();
      await flush();
      expect(new Set(s.machine.heard.get(view.id))).toEqual(new Set(['step1', 'awareness'])); // never a write
      expect(text(s.machine.doc)).toBe('from the machine');
    }
  });

  it('refuses for good, with no port posted, an artifact the member can view in neither mode, a malformed open and a machine that offers no read open', async () => {
    const both = scene();
    const opening = both.open();
    both.machine.refuse(await both.machine.open(0), 'grade');
    both.machine.refuse(await both.machine.open(1), 'grade');
    expect(await opening).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'you can’t view this document on mini', issues: { reason: 'notFound' } } });

    const malformed = scene();
    const second = malformed.open();
    malformed.machine.refuse(await malformed.machine.open(0), 'malformed');
    expect(await second).toMatchObject({ ok: false, error: { code: 'invalid_input', issues: { reason: 'invalid' } } });

    const older = scene({ peers: ['rl2.executor.machine', 'rl2.streams'] });
    expect(await older.open()).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'mini doesn’t offer this', issues: { reason: 'invalid' } } });
    expect(older.link.opens()).toEqual([]);

    for (const s of [both, malformed, older]) expect(s.window.postMessage).not.toHaveBeenCalled();
  });

  it('refuses for good what the preflight says: no such artifact, no document kind, or none the member may read', async () => {
    const s = scene();
    s.link.answers.set('artifacts.get', () => ({ ok: true, output: { artifact: null } }));
    expect(await s.open()).toMatchObject({ ok: false, error: { code: 'invalid_input', issues: { reason: 'notFound' } } });
    s.link.answers.set('artifacts.get', () => ({ ok: true, output: { artifact: row('html') } }));
    expect(await s.open()).toMatchObject({ ok: false, error: { code: 'invalid_input', issues: { reason: 'invalid' } } });
    s.link.answers.set('artifacts.get', () => ({ ok: false, error: { code: 'grade' } }));
    expect(await s.open()).toMatchObject({ ok: false, error: { code: 'invalid_input', issues: { reason: 'notFound' } } });
    expect(s.link.opens()).toEqual([]);
  });
});

describe('a reopen', () => {
  /** An open answered and synced, the replica on its port. */
  async function synced(s: ReturnType<typeof scene>, r: ReturnType<typeof replica>, n: number) {
    const opening = s.open();
    const open = await s.machine.open(n);
    const channel = s.machine.accept(open);
    const answer = (await opening) as { ok: true; value: { channel: number } };
    expect(answer.ok).toBe(true);
    const port = s.posted(answer.value.channel);
    r.provider.connect(port);
    await vi.waitFor(() => expect(r.provider.state).toMatchObject({ phase: 'live', synced: true }));
    return { open, channel, port };
  }

  it('after a carrier loss: the window’s port closes with the stream, and the next open’s step 2 carries what the machine never committed', async () => {
    const s = scene();
    s.machine.doc.get('root').insert(0, 'base');
    const r = replica();
    const first = await synced(s, r, 0);
    s.machine.deaf = true; // what is typed now is in flight when the carrier goes
    r.doc.get('root').insert(4, ' typed');
    await vi.waitFor(() => expect(s.machine.heard.get(first.open.id)).toContain('update'));
    expect(r.provider.state.unsaved).toBe(1);
    s.link.set('down');
    await vi.waitFor(() => expect(first.port.closed).toBe(true));
    expect(r.provider.state).toMatchObject({ phase: 'off', unsaved: 1 });
    // while the link is down an open is answered at once, nothing sent
    const opens = s.link.opens().length;
    expect(await s.open()).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: 'mini is offline' } });
    expect(s.link.opens()).toHaveLength(opens);
    // the link back: the ArtifactHost's next open, the same provider
    s.link.set('up');
    s.machine.deaf = false;
    await synced(s, r, 1);
    await vi.waitFor(() => expect(r.provider.state.unsaved).toBe(0));
    expect(text(s.machine.doc)).toBe('base typed');
  });

  it('after the machine’s `host` close: the frames before it delivered, the port closed, the unacked edit carried by the reopen', async () => {
    const s = scene();
    const r = replica();
    const first = await synced(s, r, 0);
    s.machine.deaf = true;
    r.doc.get('root').insert(0, 'kept');
    await vi.waitFor(() => expect(s.machine.heard.get(first.open.id)).toContain('update'));
    first.channel.send({ type: 'awareness', update: new Uint8Array([0]) }); // a frame before the close (a no-op awareness)
    first.channel.close('host');
    await vi.waitFor(() => expect(first.port.closed).toBe(true));
    expect(r.provider.state.unsaved).toBe(1);
    s.machine.deaf = false;
    await synced(s, r, 1);
    await vi.waitFor(() => expect(r.provider.state.unsaved).toBe(0));
    expect(text(s.machine.doc)).toBe('kept');
  });
});

describe('every path ends', () => {
  it('an open unanswered within its bound is answered `timeout`, its stream closed, no port posted', async () => {
    const s = scene({ openTimeoutMs: 40 });
    const opening = s.open();
    const open = await s.machine.open(0);
    expect(await opening).toMatchObject({ ok: false, error: { code: 'timeout', message: 'mini didn’t answer in time' } });
    expect(s.link.closes(open.id)).toEqual(['closed']);
    expect(s.window.postMessage).not.toHaveBeenCalled();
  });

  it('a stream the machine broke (a length of 0) closes `malformed` and closes the window’s port', async () => {
    const s = scene();
    const opening = s.open();
    const open = await s.machine.open(0);
    const channel = s.machine.accept(open);
    const port = s.posted(((await opening) as { value: { channel: number } }).value.channel);
    channel.sendRaw(new Uint8Array(4));
    await vi.waitFor(() => expect(port.closed).toBe(true));
    expect(s.link.closes(open.id)).toEqual(['malformed']);
  });

  it('the window closing its port, the window going and the app’s stop each close the stream', async () => {
    const s = scene();
    const ids: string[] = [];
    const ports: End[] = [];
    for (let n = 0; n < 3; n += 1) {
      const opening = s.open();
      const open = await s.machine.open(n);
      s.machine.accept(open);
      ids.push(open.id);
      ports.push(s.posted(((await opening) as { value: { channel: number } }).value.channel));
    }
    ports[0]!.close(); // the replica closed its end (a closed tab)
    await vi.waitFor(() => expect(s.link.closes(ids[0]!)).toEqual(['closed']));
    s.window.emit('destroyed'); // the window went: its bridges with it
    await vi.waitFor(() => expect(s.link.closes(ids[1]!)).toEqual(['closed']));
    expect(s.link.closes(ids[2]!)).toEqual(['closed']);
    expect(ports.every((port) => port.closed)).toBe(true);

    const t = scene();
    const opening = t.open();
    const open = await t.machine.open(0);
    t.machine.accept(open);
    const port = t.posted(((await opening) as { value: { channel: number } }).value.channel);
    t.adapter.stop();
    expect(t.link.closes(open.id)).toEqual(['closed']);
    expect(port.closed).toBe(true);
  });

  // Review fix 1: a stream that opens and ends before the open's answer is made posts no port nobody stands behind
  it('a stream the machine closes `host` right after it opened is no successful open: no port posted, a transient refusal', async () => {
    const s = scene();
    const opening = s.open();
    const open = await s.machine.open(0);
    s.machine.accept(open).close('host'); // in the same turn as its opening: before the open's continuation runs
    expect(await opening).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(s.window.postMessage).not.toHaveBeenCalled();
  });

  it('a window gone while its open waited is answered, the stream closed, nothing posted', async () => {
    const s = scene();
    const opening = s.open();
    const open = await s.machine.open(0);
    s.window.destroyed = true;
    s.window.emit('destroyed');
    s.machine.accept(open);
    expect(await opening).toMatchObject({ ok: false });
    expect(s.link.closes(open.id)).toEqual(['closed']);
    expect(s.window.postMessage).not.toHaveBeenCalled();
  });
});
