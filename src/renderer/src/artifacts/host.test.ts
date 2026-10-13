// The renderer's ArtifactHost (X24; docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4): a replica per open, synced
// over the port main posts for `artifacts.open`, re-opened by itself when the port goes (the host exited, restarted or
// evicted the document) with the backoff of the one reopen path; the store's commands behind the adapter's methods.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFrame, encodeFrame, type Frame } from '@artifacts/provider/frames';
import type { PortLike } from '@artifacts/provider/port';
import { applyV1, checkUpdate, diffV1, newDoc, onUpdate, stateVector, type Doc } from '@artifacts/yjs';
import type { CommandName, CommandResult, EventName, MawsBridge } from '@shared/ipc/schema';
import { createArtifactHost, RECONNECT_BACKOFF_MS, type DocPorts } from './host';
import { windowDocPorts } from './window-ports';

type Listener = (event: { data?: unknown }) => void;

// One end of an in-memory channel delivering on a microtask, as a MessagePort does: what arrives before `start()` waits
// for it. Closing either end closes both and fires `close` on each.
class AsyncPort implements PortLike {
  peer!: AsyncPort;
  closed = false;
  private started = false;
  private queued: Uint8Array[] = [];
  private readonly listeners = { message: new Set<Listener>(), close: new Set<Listener>() };
  static pair(): [AsyncPort, AsyncPort] {
    const [a, b] = [new AsyncPort(), new AsyncPort()];
    a.peer = b;
    b.peer = a;
    return [a, b];
  }
  postMessage(message: Uint8Array): void {
    if (this.closed) return;
    const copy = message.slice();
    queueMicrotask(() => this.peer.deliver(copy));
  }
  start(): void {
    this.started = true;
    for (const data of this.queued.splice(0)) this.deliver(data);
  }
  private deliver(data: Uint8Array): void {
    if (this.closed) return;
    if (!this.started) return void this.queued.push(data);
    for (const listener of [...this.listeners.message]) listener({ data });
  }
  addEventListener(type: 'message' | 'close', listener: Listener): void {
    this.listeners[type].add(listener);
  }
  removeEventListener(type: 'message' | 'close', listener: Listener): void {
    this.listeners[type].delete(listener);
  }
  close(): void {
    if (this.closed) return;
    for (const end of [this, this.peer]) end.closed = true;
    for (const end of [this, this.peer]) for (const listener of [...end.listeners.close]) listener({});
  }
}

// The document service as far as a replica observes it: step 1 at attach, step 2 for a step 1 (and the latest restore
// right after it), every content frame checked, applied, acked and relayed to the other connections.
class TestHost {
  readonly doc: Doc = newDoc();
  revision = 0;
  conns = new Map<AsyncPort, number>();
  restored: { revision: number; versionId: number } | null = null;
  constructor() {
    onUpdate(this.doc, (update, origin) => {
      for (const conn of this.conns.keys()) if (conn !== origin) conn.postMessage(encodeFrame({ type: 'update', update }));
    });
  }
  attach(port: AsyncPort): void {
    this.conns.set(port, 0);
    port.addEventListener('message', ({ data }) => this.receive(port, decodeFrame(data)));
    port.addEventListener('close', () => this.conns.delete(port));
    port.start();
    port.postMessage(encodeFrame({ type: 'step1', sv: stateVector(this.doc) }));
  }
  dropAll(): void {
    for (const conn of [...this.conns.keys()]) conn.close();
  }
  private receive(port: AsyncPort, frame: Frame): void {
    if (frame.type === 'step1') {
      port.postMessage(encodeFrame({ type: 'step2', update: diffV1(this.doc, frame.sv) }));
      if (this.restored) port.postMessage(encodeFrame({ type: 'restored', ...this.restored }));
      return;
    }
    if (frame.type !== 'step2' && frame.type !== 'update') return;
    expect(checkUpdate(this.doc, frame.update)).toBeNull();
    applyV1(this.doc, frame.update, port);
    this.revision += 1;
    const received = this.conns.get(port)! + 1;
    this.conns.set(port, received);
    port.postMessage(encodeFrame({ type: 'ack', frames: received, revision: this.revision }));
  }
}

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
type Answer = CommandResult<CommandName> | (() => CommandResult<CommandName>);

// The bridge and main: `artifacts.open` hands the window a fresh port attached to the host, unless the test says the
// host is down; other commands answer what the test set.
// `holdPorts`: a port the window takes arrives only when the test releases it (`releasePort`), as a slow route would.
function harness(options: { host?: TestHost; holdPorts?: boolean } = {}) {
  const host = options.host ?? new TestHost();
  let channel = 0;
  let hostUp = true;
  const answers = new Map<string, Answer>();
  const calls: { name: string; input: unknown }[] = [];
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  const waiting = new Map<number, AsyncPort>();
  const held: (() => void)[] = [];
  const ports: DocPorts = {
    take: (n) => {
      const port = waiting.get(n);
      waiting.delete(n);
      if (!port) return Promise.reject(new Error(`no port for channel ${n}`));
      if (!options.holdPorts) return Promise.resolve(port);
      return new Promise((resolve) => held.push(() => resolve(port)));
    },
  };
  const ipc = {
    invoke: vi.fn(async (name: string, input: unknown) => {
      calls.push({ name, input });
      if (name === 'artifacts.open') {
        if (!hostUp) return { ok: false, error: { code: 'host_unavailable', message: 'restarting' } };
        const answer = answers.get('artifacts.open');
        if (answer) return typeof answer === 'function' ? answer() : answer;
        const [windowEnd, hostEnd] = AsyncPort.pair();
        host.attach(hostEnd);
        channel += 1;
        waiting.set(channel, windowEnd);
        return { ok: true, value: { channel } };
      }
      const answer = answers.get(name);
      if (answer) return typeof answer === 'function' ? answer() : answer;
      if (name === 'artifacts.status') return { ok: true, value: { status: 'ok', reason: null } };
      return { ok: false, error: { code: 'internal', message: `no answer for ${name}` } };
    }),
    on: vi.fn((name: string, listener: (payload: unknown) => void) => {
      const set = eventListeners.get(name) ?? new Set();
      set.add(listener);
      eventListeners.set(name, set);
      return () => void set.delete(listener);
    }),
  };
  const artifacts = createArtifactHost({ ipc: ipc as unknown as Pick<MawsBridge, 'invoke' | 'on'>, ports, log: () => {} });
  const emit = (name: EventName, payload: unknown) => eventListeners.get(name)?.forEach((l) => l(payload));
  return {
    host,
    artifacts,
    calls,
    answers,
    emit,
    setHostUp: (up: boolean) => void (hostUp = up),
    heldPorts: () => held.length,
    releasePort: () => held.shift()!(),
    hostState: (state: 'ready' | 'restarting', revision: number) => emit('engine.hostState', { state, pid: state === 'ready' ? 2 : null, restarts: 1, revision }),
  };
}

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const text = (doc: Doc) => doc.get('root').toString();

afterEach(() => vi.useRealTimers());

describe('the renderer’s ArtifactHost (M4)', () => {
  it('opens a replica that is synced when it resolves, edits through it, and has them acked', async () => {
    const h = harness();
    h.host.doc.get('root').insert(0, 'from the host');
    const handle = await h.artifacts.open(ARTIFACT);
    expect(text(handle.doc)).toBe('from the host');
    expect(handle.state()).toMatchObject({ phase: 'live', synced: true, readOnly: false });
    handle.doc.get('root').insert(0, '>');
    await vi.waitFor(() => expect(handle.state()).toMatchObject({ unsaved: 0, revision: h.host.revision }));
    expect(h.host.revision).toBeGreaterThan(0);
    expect(text(h.host.doc)).toBe('>from the host');
    expect(h.calls.filter((c) => c.name === 'artifacts.open')).toEqual([{ name: 'artifacts.open', input: { artifactId: ARTIFACT } }]);
    handle.close();
  });

  it('keeps two replicas of one document in step through the host', async () => {
    const h = harness();
    const [a, b] = [await h.artifacts.open(ARTIFACT), await h.artifacts.open(ARTIFACT)];
    a.doc.get('root').insert(0, 'a');
    await vi.waitFor(() => expect(text(b.doc)).toBe('a'));
    a.close();
    b.close();
  });

  it('rejects the open of a document the store refuses (not found, a byte kind), and asks no more', async () => {
    const h = harness();
    h.answers.set('artifacts.open', { ok: false, error: { code: 'invalid_input', message: 'no artifact', issues: { reason: 'notFound', data: {} } } });
    await expect(h.artifacts.open(ARTIFACT)).rejects.toMatchObject({ error: { issues: { reason: 'notFound' } } });
    expect(h.calls.filter((c) => c.name === 'artifacts.open')).toHaveLength(1);
  });

  it('re-opens with the backoff when the port goes, and re-sends what the host lacks once the host is back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    const handle = await h.artifacts.open(ARTIFACT);
    const states: string[] = [];
    handle.subscribe((state) => states.push(state.phase));
    h.setHostUp(false);
    h.host.dropAll(); // the host went: its ends closed
    await settle();
    expect(handle.state().phase).toBe('off');
    handle.doc.get('root').insert(0, 'offline');
    expect(handle.state().unsaved).toBe(1);
    const opens = () => h.calls.filter((c) => c.name === 'artifacts.open').length;
    await settle(RECONNECT_BACKOFF_MS[0]);
    expect(opens()).toBe(2); // 250 ms
    await settle(RECONNECT_BACKOFF_MS[1]);
    expect(opens()).toBe(3); // then 1 s
    await settle(RECONNECT_BACKOFF_MS[2]);
    expect(opens()).toBe(4); // then 3 s
    await settle(60_000);
    expect(opens()).toBe(4); // then only on the host's next ready
    h.setHostUp(true);
    h.hostState('ready', 5);
    await settle();
    await vi.waitFor(() => expect(handle.state()).toMatchObject({ phase: 'live', unsaved: 0 }));
    expect(text(h.host.doc)).toBe('offline');
    expect(states).toContain('off');
    handle.close();
  });

  it('drops every live port when the host leaves ready, since a dead host’s port may never say it closed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    const handle = await h.artifacts.open(ARTIFACT);
    h.hostState('restarting', 3);
    expect(handle.state().phase).toBe('off');
    await settle(RECONNECT_BACKOFF_MS[0]);
    await vi.waitFor(() => expect(handle.state().phase).toBe('live'));
    handle.close();
  });

  it('a host restart while an open awaits its port closes that port when it arrives, and opens afresh on the new host', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness({ holdPorts: true });
    const opening = h.artifacts.open(ARTIFACT);
    await vi.waitFor(() => expect(h.heldPorts()).toBe(1)); // the open was answered; its port is on the way
    const stale = [...h.host.conns.keys()][0];
    h.hostState('restarting', 1);
    h.hostState('ready', 2); // the new host is ready while the old attempt still waits
    h.releasePort(); // the old host's port arrives late (and, dead, would never say it closed)
    await settle();
    expect(stale.closed).toBe(true);
    await vi.waitFor(() => expect(h.heldPorts()).toBe(1)); // a fresh open, without waiting for another ready
    expect(h.calls.filter((c) => c.name === 'artifacts.open')).toHaveLength(2);
    h.releasePort();
    const handle = await opening;
    expect(handle.state()).toMatchObject({ phase: 'live', synced: true });
    handle.close();
  });

  it('an open interrupted by the host leaving ready, its port arriving while the host is still down, re-opens at the next ready', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness({ holdPorts: true });
    const opening = h.artifacts.open(ARTIFACT);
    await vi.waitFor(() => expect(h.heldPorts()).toBe(1));
    const stale = [...h.host.conns.keys()][0];
    h.hostState('restarting', 1);
    h.releasePort();
    await settle(60_000);
    expect(stale.closed).toBe(true);
    expect(h.calls.filter((c) => c.name === 'artifacts.open')).toHaveLength(1); // nothing to open until the host is back
    h.hostState('ready', 2);
    await vi.waitFor(() => expect(h.heldPorts()).toBe(1));
    h.releasePort();
    const handle = await opening;
    expect(handle.state()).toMatchObject({ phase: 'live', synced: true });
    handle.close();
  });

  it('a closed handle stops re-opening and closes its port', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    const handle = await h.artifacts.open(ARTIFACT);
    expect(h.host.conns.size).toBe(1);
    handle.close();
    expect(h.host.conns.size).toBe(0);
    h.hostState('ready', 9);
    await settle(10_000);
    expect(h.calls.filter((c) => c.name === 'artifacts.open')).toHaveLength(1);
  });

  it('marks the handle read-only when the store is (a newer app wrote it)', async () => {
    const h = harness();
    h.answers.set('artifacts.status', { ok: true, value: { status: 'readOnly', reason: 'user_version 9' } });
    const handle = await h.artifacts.open(ARTIFACT);
    await vi.waitFor(() => expect(handle.state().readOnly).toBe(true));
    handle.close();
  });

  it('tells the editor of a restore it did not witness, and passes the composition hold to the provider', async () => {
    const h = harness();
    const handle = await h.artifacts.open(ARTIFACT);
    const restores: unknown[] = [];
    handle.onRestored((restored) => restores.push(restored));
    handle.holdRemote(true);
    h.host.doc.get('root').insert(0, 'held');
    await new Promise((resolve) => setTimeout(resolve, 0)); // the update crosses and is held
    expect(text(handle.doc)).toBe('');
    handle.holdRemote(false);
    expect(text(handle.doc)).toBe('held');
    h.host.restored = { revision: 7, versionId: 3 };
    for (const conn of h.host.conns.keys()) conn.postMessage(encodeFrame({ type: 'restored', revision: 7, versionId: 3 }));
    await vi.waitFor(() => expect(restores).toEqual([{ revision: 7, versionId: 3 }]));
    handle.close();
  });

  it('reaches the store’s reads and the asset upload through their commands, and names the human', async () => {
    const h = harness();
    const bytes = new Uint8Array([1, 2]);
    h.answers.set('artifacts.versionState', { ok: true, value: { bytes } });
    h.answers.set('artifacts.attributions', { ok: true, value: { bytes } });
    h.answers.set('artifacts.uploadAsset', { ok: true, value: { assetId: '22222222-2222-4222-8222-222222222222', ref: 'assets/a.png' } });
    expect(await h.artifacts.versionState(ARTIFACT, 4)).toBe(bytes);
    expect(await h.artifacts.versionState(ARTIFACT, { seq: 9 })).toBe(bytes);
    expect(await h.artifacts.attributions(ARTIFACT, 1, 9)).toBe(bytes);
    expect(await h.artifacts.uploadAsset(ARTIFACT, bytes, { name: 'a.png', mime: 'image/png' })).toEqual({ assetId: '22222222-2222-4222-8222-222222222222', ref: 'assets/a.png' });
    expect(h.calls.map((c) => [c.name, c.input])).toEqual([
      ['artifacts.versionState', { artifactId: ARTIFACT, versionId: 4 }],
      ['artifacts.versionState', { artifactId: ARTIFACT, seq: 9 }],
      ['artifacts.attributions', { artifactId: ARTIFACT, fromSeq: 1, toSeq: 9 }],
      ['artifacts.uploadAsset', { artifactId: ARTIFACT, bytes, name: 'a.png', mime: 'image/png' }],
    ]);
    h.answers.set('artifacts.versionState', { ok: false, error: { code: 'invalid_input', message: 'gone', issues: { reason: 'notFound', data: {} } } });
    await expect(h.artifacts.versionState(ARTIFACT, 4)).rejects.toMatchObject({ error: { code: 'invalid_input' } });
    expect(h.artifacts.identity()).toMatchObject({ actor: { kind: 'human' }, name: 'You', color: expect.stringMatching(/^--author-[1-8]$/) });
    expect(h.artifacts.assetUrl(ARTIFACT, 'assets/a b.png')).toBe(`maws-artifact://${ARTIFACT}/live/assets/a%20b.png`);
  });
});

describe('document ports from the preload', () => {
  it('takes a port posted by its own window, early or late, and ignores one from a frame inside the page', async () => {
    const ports = windowDocPorts(window);
    const posted = (channel: number, source: unknown) => {
      const { port1 } = new MessageChannel();
      window.dispatchEvent(new MessageEvent('message', { data: { maws: 'doc-port', channel, artifactId: ARTIFACT }, source: source as Window, ports: [port1] }));
      return port1;
    };
    const early = posted(1, window);
    await expect(ports.take(1)).resolves.toBe(early);
    const late = ports.take(2);
    const port = posted(2, window);
    await expect(late).resolves.toBe(port);
    const forged = posted(3, null);
    const waiting = ports.take(3, 50);
    await expect(waiting).rejects.toThrow();
    expect(forged).toBeDefined();
    ports.dispose();
  });
});
