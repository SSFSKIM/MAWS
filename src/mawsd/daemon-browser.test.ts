// `mawsd`'s browser route inside the daemon (P5 O17 M5; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M5's Proves,
// Interfaces §B, §D, §E, §F, §I; acceptance 1, 3, 4, 5, 8): with no app, a live session's cua socket is answered cold by
// the broker, its first real primitive starts the render host and prepares the session there, the fence is taken through
// the engine host, and the session is relayed to the render host until its route moves: an app's arrival (the handover,
// destructive and generation-fenced), the engine's exit, `host.browserIdle`, the render host's quiet end. The session's
// browser capability reads the same inputs, one event per change of reading.
//
// Over the daemon in this process on a stand-in Mac (`platform: 'darwin'`, the peer addon a double whose engine is
// ENGINE and whose cua serve is CUA), stand-in engine hosts that hold browser work (M7's build) on real sockets
// (test/support/mawsd-scene.ts), and a stand-in render host: a spawned child the seam holds, its machine.sock link a raw
// client whose hello lists render.client and browser.engine, its per-session socket a real Unix socket that greets as
// MAWS's backend does and makes a tab only after the fence (`browserEngine.work`). cua is a raw client of the
// extension protocol on the daemon's socket for the session.
import { existsSync, mkdirSync, rmSync, watch } from 'node:fs';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { cuaSocketDir, renderCuaSocketDir } from '@shared/daemon/files';
import { BROWSER_ENGINE_CAPABILITY, CONNECTORS_CLIENT_CAPABILITY, HOST_BROWSER_WORK_CAPABILITY, MACHINE_SPINE_CAPABILITY, PEER_CAPABILITIES, RENDER_CLIENT_CAPABILITY } from '@shared/host/socket-protocol';
import type { BrowserEngineRequest } from '@shared/ipc/schema/browser-engine';
import { machineName } from '@shared/machine/identity';
import { PEER_AUTH_VERSION, type PeerAddon } from '../main/browser/cua/peer';
import type { RunningDaemon } from './daemon';
import type { RenderChild } from './render-seam';
import { MawsdScene, sleep, until, type RawApp, type StandIn } from '../../test/support/mawsd-scene';

const MACHINE = machineName({}, hostname());
const S = '0b6f3c1e-7d2a-4c59-9e41-2f8a6b0d5c73';
const TMP = '/tmp'; // the scene's profile is too long for a session's socket: both cua directories fall back here
const ENGINE = 5_000; // the session's engine
const CUA = 5_001; // its cua serve
const NEXT_ENGINE = 5_100; // the engine a resume starts
const NEXT_CUA = 5_101;
const BROWSER_WORK_HOST = [...PEER_CAPABILITIES.engineHost, HOST_BROWSER_WORK_CAPABILITY]; // an engine host of M7's build
const SCREENCAST = { available: true, viewed: 'screencast' };
const LOCAL = { available: true, viewed: 'local' };
const OLD_HOST = { available: false, reason: `the engine host on ${MACHINE} predates browser work holds; it is replaced when idle` };

let scene: MawsdScene;
const closers: (() => void)[] = [];

beforeEach(() => {
  scene = new MawsdScene('maws-mb-');
  scene.engineSpawn = { capabilities: BROWSER_WORK_HOST };
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  for (const close of closers.splice(0)) close();
  await scene.dispose();
  rmSync(renderCuaSocketDir(scene.root, TMP), { recursive: true, force: true });
  vi.restoreAllMocks();
});

// The peer identity addon's double: the engine and its cua serve, and a resume's
function fakeAddon(): PeerAddon & { peerPid: number } {
  const table = new Map([
    [ENGINE, { ppid: 1, start: 10 }],
    [CUA, { ppid: ENGINE, start: 20 }],
    [NEXT_ENGINE, { ppid: 1, start: 30 }],
    [NEXT_CUA, { ppid: NEXT_ENGINE, start: 40 }],
  ]);
  const addon = { peerPid: CUA, version: PEER_AUTH_VERSION, peer: () => ({ pid: addon.peerPid, uid: process.getuid!() }), process: (pid: number) => table.get(pid) ?? null };
  return addon;
}

// --- the extension protocol: a u32 little-endian length, then JSON-RPC ----------------------------------------------
type Message = { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } };
const frame = (message: unknown) => {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
};
function reader(onMessage: (message: Message) => void) {
  let buffered = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32LE(0)) {
      const length = buffered.readUInt32LE(0);
      onMessage(JSON.parse(buffered.subarray(4, 4 + length).toString('utf8')) as Message);
      buffered = buffered.subarray(4 + length);
    }
  };
}

// cua's host on the daemon's socket for the session
class Connector {
  readonly heard: Message[] = [];
  closed = false;
  private next = 0;
  constructor(readonly socket: Socket) {
    socket.on('data', reader((message) => void this.heard.push(message)));
    socket.on('error', () => {});
    socket.on('close', () => void (this.closed = true));
  }
  static open(): Connector {
    const connector = new Connector(connect(join(cuaSocketDir(scene.root, TMP), `${S}.sock`)));
    closers.push(() => connector.socket.destroy());
    return connector;
  }
  async request(method: string, params: Record<string, unknown> = {}, timeout = 5_000): Promise<Message> {
    const id = ++this.next;
    this.socket.write(frame({ jsonrpc: '2.0', id, method, params }));
    await until(() => this.heard.some((message) => message.id === id) || this.closed, timeout, `the answer to ${method}`);
    const answer = this.heard.find((message) => message.id === id);
    if (!answer) throw new Error(`${method}: the connection closed unanswered`);
    return answer;
  }
  hellos(): number {
    return this.heard.filter((message) => message.method === 'hello').length;
  }
}

// --- the render host's stand-in ----------------------------------------------------------------------------------------
class StandInRenderChild implements RenderChild {
  readonly pid = 4_242;
  private readonly listeners: ((code: number | null, signal: string | null) => void)[] = [];
  kill(): void {
    this.exit(null, 'SIGTERM');
  }
  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.listeners.push(listener);
  }
  lastLine(): string | null {
    return null;
  }
  exit(code: number | null, signal: string | null = null): void {
    for (const listener of this.listeners.splice(0)) listener(code, signal);
  }
}

class RenderHost {
  link!: RawApp;
  readonly requests: BrowserEngineRequest[] = []; // every browserEngine.request, in order
  readonly holdBack = new Set<'prepare' | 'drop'>(); // operations answered only by `release`
  readonly heldBack: BrowserEngineRequest[] = [];
  readonly tabs = new Map<string, number>(); // per session
  readonly works: string[] = []; // its browserEngine.work answers: `S held ok`, `S zero ok`, `S held forbidden_sender`…
  readonly peers: Socket[] = [];
  private readonly servers = new Map<string, Server>();
  private seen = 0;
  private exited = false;
  private readonly timer: NodeJS.Timeout;
  constructor(readonly child: StandInRenderChild) {
    this.timer = setInterval(() => this.tick(), 5);
    closers.push(() => this.close());
  }
  async connect(): Promise<void> {
    this.link = await scene.app('machine', { capabilities: [RENDER_CLIENT_CAPABILITY, BROWSER_ENGINE_CAPABILITY], appPid: this.child.pid }); // its own pid, never the app's
    this.link.ready();
  }
  private tick(): void {
    if (!this.link?.port) return;
    const events = this.link.messages.filter((message) => message.t === 'evt');
    for (const message of events.slice(this.seen)) {
      this.seen += 1;
      if (message.name === 'render.exit') return void this.exit();
      if (message.name !== 'browserEngine.request') continue;
      const request = message.payload as BrowserEngineRequest;
      this.requests.push(request);
      const op = request.operation.op;
      if (op !== 'inventory' && this.holdBack.has(op)) this.heldBack.push(request);
      else void this.handle(request);
    }
  }
  ops(): string[] {
    return this.requests.map((request) => request.operation.op);
  }
  async release(op: 'prepare' | 'drop'): Promise<void> {
    this.holdBack.delete(op);
    const now = this.heldBack.filter((request) => request.operation.op === op);
    this.heldBack.splice(0, this.heldBack.length, ...this.heldBack.filter((request) => request.operation.op !== op));
    for (const request of now) await this.handle(request);
  }
  answer(id: string, result: unknown = { ok: true, value: null }) {
    return this.link.request('browserEngine.answer', { id, result });
  }
  async work(appSessionId: string, held: boolean): Promise<boolean> {
    const answer = await this.link.request('browserEngine.work', { appSessionId, held });
    const error = (answer.error as { code?: string } | undefined)?.code;
    this.works.push(`${appSessionId.slice(0, 1)} ${held ? 'held' : 'zero'} ${answer.ok ? 'ok' : error}`);
    return answer.ok === true;
  }
  state(appSessionId: string) {
    const count = this.tabs.get(appSessionId) ?? 0;
    const tabs = Array.from({ length: count }, (_, at) => ({ tabId: `b_00000000000${at}`, title: '', url: 'http://127.0.0.1:4000/', control: 'idle' }));
    return this.link.request('browserEngine.state', { appSessionId, inventory: { tabs, selected: tabs[0]?.tabId ?? null, state: 'ready' } });
  }
  async handle(request: BrowserEngineRequest): Promise<void> {
    const { id, appSessionId, operation } = request;
    if (operation.op === 'prepare') {
      const dir = renderCuaSocketDir(scene.root, TMP);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const server = createServer((socket) => this.serve(appSessionId, socket));
      await new Promise<void>((resolve) => server.listen(join(dir, `${appSessionId}.sock`), resolve));
      this.servers.set(appSessionId, server);
      await this.answer(id);
      await this.state(appSessionId);
    } else if (operation.op === 'drop') {
      this.servers.get(appSessionId)?.close();
      this.servers.delete(appSessionId);
      for (const peer of this.peers) peer.destroy();
      const had = (this.tabs.get(appSessionId) ?? 0) > 0;
      this.tabs.delete(appSessionId);
      if (had) await this.work(appSessionId, false);
      await this.answer(id);
    }
  }
  // One cua connection relayed by mawsd: MAWS's hello, then tabs made behind the fence
  private serve(appSessionId: string, socket: Socket): void {
    this.peers.push(socket);
    socket.on('error', () => {});
    socket.write(frame({ jsonrpc: '2.0', method: 'hello', params: { extensionId: 'maws', extensionInstanceId: `maws:${appSessionId}`, version: '0.0.0-test', protocolVersion: 1, profileName: 'MAWS' } }));
    socket.on(
      'data',
      reader((message) => {
        void (async () => {
          const reply = (body: Record<string, unknown>) => !socket.destroyed && socket.write(frame({ jsonrpc: '2.0', id: message.id, ...body }));
          const count = this.tabs.get(appSessionId) ?? 0;
          if (message.method === 'tabs.create') {
            if (count === 0 && !(await this.work(appSessionId, true))) return reply({ error: { code: 1, message: 'the fence was refused' } });
            this.tabs.set(appSessionId, count + 1);
            await this.state(appSessionId);
            return reply({ result: { id: count + 1 } });
          }
          if (message.method === 'tabs.remove') {
            this.tabs.set(appSessionId, Math.max(0, count - 1));
            await this.state(appSessionId);
            if (count === 1) await this.work(appSessionId, false);
            return reply({ result: {} });
          }
          reply({ result: [] });
        })();
      }),
    );
  }
  exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.close();
    this.link.leave(false);
    this.child.exit(0);
  }
  close(): void {
    clearInterval(this.timer);
    for (const server of this.servers.values()) server.close();
    for (const peer of this.peers) peer.destroy();
  }
}

interface Stand {
  daemon: RunningDaemon;
  addon: (PeerAddon & { peerPid: number }) | null;
  engine: StandIn;
  hosts: RenderHost[];
  host(): RenderHost;
  status(pid: number | null, process?: string): Promise<void>; // handled by mawsd when it resolves
  capabilities(): Promise<Record<string, unknown>>;
  changes(): { appSessionId: string; capabilities: { browser: unknown } }[];
  snapshots(): string[][];
}

// The daemon on a stand-in Mac with the session's engine live (ENGINE), and an observer that hears the capability events
// `connect: false`: a spawned render host connects when the test says (`host().connect()`); `holdBack`: each holds those
// `asked`: the observer reads the session's capabilities before its first status, so it is told each change from then on
async function stand(options: { quietMs?: number; addon?: null; engineHost?: boolean; connect?: boolean; holdBack?: ('prepare' | 'drop')[]; asked?: (reading: Record<string, unknown>) => void } = {}): Promise<Stand> {
  const hosts: RenderHost[] = [];
  const addon = options.addon === null ? null : fakeAddon();
  const daemon = await scene.start({
    permanentClient: true,
    tmp: TMP,
    platform: 'darwin',
    env: { MAWS_USER_DATA: scene.root, MAWS_RENDER_QUIET_MS: String(options.quietMs ?? 60_000) },
    cua: { loadAddon: () => addon },
    render: {
      runtime: () => ({ available: true }),
      spawn: () => {
        const host = new RenderHost(new StandInRenderChild());
        for (const op of options.holdBack ?? []) host.holdBack.add(op);
        hosts.push(host);
        if (options.connect !== false) setImmediate(() => void host.connect());
        return host.child;
      },
    },
  });
  const observer = await scene.app('machine', { capabilities: [], appPid: 1 });
  observer.ready();
  let engine: StandIn | null = null;
  if (options.engineHost !== false) {
    void daemon.hosts.wake('engine-host');
    await until(() => scene.engines.length > 0 && daemon.hosts.snapshot('engine-host').state === 'ready', 5_000, 'the engine host');
    engine = scene.lastEngine();
  }
  const status = async (pid: number | null, process = 'ready') => {
    await until(() => engine!.emitRaw('session.status', { appSessionId: S, status: { appSessionId: S, process, pid } }), 3_000, 'the link’s ready line');
    await daemon.hosts.forward('engine-host', { name: 'engine.ping', input: undefined } as never); // its answer comes after the status line
  };
  const stood: Stand = {
    daemon,
    addon,
    engine: engine!,
    hosts,
    host: () => hosts.at(-1)!,
    status,
    capabilities: async () => ((await observer.request('session.capabilities', { appSessionId: S })).value as Record<string, unknown>),
    changes: () => observer.events('session.capabilitiesChanged') as never,
    snapshots: () => engine!.named('host.browserWork').map((input) => (input as { held: string[] }).held),
  };
  if (options.asked) options.asked(await stood.capabilities());
  if (engine) {
    await status(ENGINE);
    await until(() => scene.logs.some((line) => line.includes('[cua] the peer identity addon')), 3_000, 'the session’s socket');
  }
  return stood;
}

// cua's first browser: its hello, then a tab through the broker's promotion; the render host prepared it
async function firstTab(): Promise<Connector> {
  const cua = Connector.open();
  await until(() => cua.hellos() === 1, 3_000, 'the broker’s hello');
  const created = await cua.request('tabs.create', { url: 'http://127.0.0.1:4000/' });
  expect(created.result).toEqual({ id: 1 });
  return cua;
}

// The app: attached on engine-host.sock and machine.sock, its own cua directory named
async function attachApp(): Promise<{ leave(): void }> {
  const dir = `/tmp/mbapp-${process.pid}-${Date.now()}`;
  mkdirSync(dir, { mode: 0o700 });
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const engine = await scene.app('engine-host', { capabilities: [MACHINE_SPINE_CAPABILITY, CONNECTORS_CLIENT_CAPABILITY] });
  const machine = await scene.app('machine', { capabilities: [MACHINE_SPINE_CAPABILITY, CONNECTORS_CLIENT_CAPABILITY] });
  machine.ready();
  expect(await machine.request('machine.client', { browserSocket: dir })).toMatchObject({ ok: true });
  return {
    leave() {
      machine.leave();
      engine.leave();
    },
  };
}

const renderStatus = async (daemon: RunningDaemon) => (await daemon.status()).render!;
const listening = () => until(() => existsSync(join(cuaSocketDir(scene.root, TMP), `${S}.sock`)), 3_000, 'the session’s socket listening');

describe('the first browser with no app (acceptance 1)', () => {
  it('reads the screencast before Chromium starts, answers cua cold, starts the render host at its first tab, and ends it after the quiet period while cua reconnects cold', async () => {
    const t = await stand({ quietMs: 300 });
    expect((await t.capabilities()).browser).toEqual(SCREENCAST);
    expect(await renderStatus(t.daemon)).toEqual({ state: 'off', detail: null, pid: null, starts: 0, requests: 0 });
    expect(scene.logs.some((line) => line.includes('the render seam loaded') || line.includes('the cold broker loaded')), 'a capability read loads nothing').toBe(false);

    const cua = Connector.open();
    await until(() => cua.hellos() === 1, 3_000, 'the broker’s hello');
    expect((await cua.request('tabs.query')).result).toEqual([]);
    expect((await renderStatus(t.daemon)).starts, 'the inventory starts nothing').toBe(0);

    expect((await cua.request('tabs.create', { url: 'http://127.0.0.1:4000/' })).result).toEqual({ id: 1 });
    expect(cua.hellos(), 'the render host’s hello suppressed').toBe(1);
    expect(t.host().ops()).toEqual(['prepare']);
    expect(t.host().works).toEqual(['0 held ok']);
    expect(t.snapshots().at(-1), 'the fence: the engine host acknowledged the hold before the tab').toEqual([S]);
    expect(await renderStatus(t.daemon)).toMatchObject({ state: 'ready', starts: 1, browserSessions: 1, browserTabs: 1 });

    await sleep(500); // past the quiet period: a held tab keeps the render host
    expect((await renderStatus(t.daemon)).state).toBe('ready');
    expect((await cua.request('tabs.remove', { tabId: 1 })).result).toEqual({});
    await until(() => JSON.stringify(t.snapshots().at(-1)) === '[]', 3_000, 'the hold cleared');
    await until(() => cua.closed, 3_000, 'the render host’s quiet end, the spliced connection with it');
    expect(await renderStatus(t.daemon)).toMatchObject({ state: 'off', starts: 1 });

    const again = Connector.open(); // cua's 5 s retry reaches the broker: nothing starts Chromium before a real primitive
    await until(() => again.hellos() === 1, 3_000, 'the broker’s hello again');
    expect((await again.request('windows.query')).result).toEqual([]);
    expect((await renderStatus(t.daemon)).starts).toBe(1);
    expect(t.changes(), 'the reading never changed').toEqual([]);
  });

  it('names a side thread’s parent in its prepare, read from mawsd’s own index (M4’s question): the render host reads no lineage', async () => {
    const t = await stand();
    await firstTab();
    expect(t.host().requests[0]!.operation).toEqual({ op: 'prepare' }); // no spine with a record of S: a root session
    expect(scene.logs.some((line) => line.includes('was not read in time'))).toBe(false);
  });
});

describe('the handover (acceptance 3)', () => {
  it('an app’s arrival ends the cold and spliced connections, drops the render host’s service, keeps the hold until the drop answers, and its departure returns the session cold', async () => {
    const t = await stand();
    const cua = await firstTab();
    t.host().holdBack.add('drop');
    const app = await attachApp();
    await until(() => cua.closed, 3_000, 'cua’s connection ended at the handover');
    await until(() => t.host().heldBack.length === 1, 3_000, 'the drop sent');
    await until(() => t.changes().length === 1, 3_000, 'the reading’s change');
    expect(t.changes()[0]!.capabilities.browser).toEqual(LOCAL);
    expect(t.snapshots().at(-1), 'the retiring connection keeps its hold until the drop answers').toEqual([S]);

    // the retiring period: its late state and a late acquire refused; its zero and the drop's answer taken
    expect(await t.host().state(S)).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(await t.host().work(S, true)).toBe(false);
    expect(t.host().works.at(-1)).toBe('0 held forbidden_sender');

    app.leave();
    await until(() => t.changes().length === 2, 3_000, 'the reading back');
    expect(t.changes()[1]!.capabilities.browser).toEqual(SCREENCAST);
    const next = Connector.open();
    await until(() => next.hellos() === 1, 3_000, 'the broker again');
    const created = next.request('tabs.create', { url: 'http://127.0.0.1:4000/again' });
    await sleep(200);
    expect(t.host().ops(), 'the new prepare waits for the retiring drop’s answer').toEqual(['prepare', 'drop']);
    await t.host().release('drop');
    expect(t.host().works).toContain('0 zero ok');
    expect((await created).result).toEqual({ id: 1 });
    expect(t.host().ops()).toEqual(['prepare', 'drop', 'prepare']);
    expect(t.hosts, 'the same render host serves the next period').toHaveLength(1);
  });

  it('an app arriving during a start settles every waiter once, prepares nothing, and an artifact export beside it completes', async () => {
    const t = await stand({ connect: false });
    const cua = Connector.open();
    await until(() => cua.hellos() === 1, 3_000, 'the broker’s hello');
    cua.socket.write(frame({ jsonrpc: '2.0', id: 7, method: 'tabs.create', params: { url: 'http://127.0.0.1:4000/' } }));
    await until(() => t.hosts.length === 1, 3_000, 'the render host spawned');
    const exported = t.daemon.render.exportForLibrary({ artifactId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', revision: 1, format: 'pdf' } as never);
    const app = await attachApp();
    await until(() => cua.closed, 3_000, 'the waiting trigger ended with its epoch');
    await t.host().connect(); // the render host says ready only now
    await until(() => t.host().link.events('render.request').length === 1, 3_000, 'the export handed over once the host said ready');
    const [request] = t.host().link.events('render.request') as { id: string }[];
    const path = `${scene.root}/artifacts/2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f/exports/1.pdf`;
    expect(await t.host().link.request('render.answer', { id: request!.id, answer: { path, revision: 1 } })).toMatchObject({ ok: true });
    expect(await exported).toEqual({ path, revision: 1 });
    await sleep(100);
    expect(t.host().ops(), 'nothing prepared for a period that ended').toEqual([]);
    expect(cua.heard.filter((message) => message.id === 7), 'the trigger never answered twice').toHaveLength(0);
    app.leave();
  });

  it('a prepare answered after the app took over is undone with drop, and never splices', async () => {
    const t = await stand({ holdBack: ['prepare'] });
    const cua = Connector.open();
    await until(() => cua.hellos() === 1, 3_000, 'the broker’s hello');
    cua.socket.write(frame({ jsonrpc: '2.0', id: 1, method: 'tabs.create', params: {} }));
    await until(() => t.hosts.length === 1 && t.host().heldBack.length === 1, 3_000, 'the prepare sent');
    const host = t.host();
    const app = await attachApp();
    await until(() => host.requests.length === 2, 3_000, 'the drop behind it');
    expect(host.ops()).toEqual(['prepare', 'drop']);
    await host.release('prepare'); // answered after the takeover
    await until(() => cua.closed, 3_000, 'cua’s connection ended');
    expect(cua.heard.filter((message) => message.id === 1)).toEqual([]);
    expect(host.peers, 'never spliced').toEqual([]);
    app.leave();
  });
});

describe('the engine’s exit and the engine host’s restart (acceptance 4, 5)', () => {
  it('drops the headless tabs at the engine’s exit, and the resumed engine’s next tab is prepared again in the running render host', async () => {
    const t = await stand();
    const cua = await firstTab();
    await t.status(null, 'exited');
    await until(() => t.host().ops().length === 2, 3_000, 'the drop at the exit');
    expect(t.host().ops()).toEqual(['prepare', 'drop']);
    await until(() => cua.closed, 3_000, 'cua’s connection ended with its engine');
    await until(() => JSON.stringify(t.snapshots().at(-1)) === '[]', 3_000, 'both holds cleared');
    expect(await renderStatus(t.daemon)).toMatchObject({ browserSessions: 0, browserTabs: 0 });

    await t.status(NEXT_ENGINE); // a resume: another engine, its own cua serve
    t.addon!.peerPid = NEXT_CUA;
    await listening();
    const next = Connector.open();
    await until(() => next.hellos() === 1, 3_000, 'the resumed engine’s cua, answered cold');
    expect((await next.request('tabs.create', { url: 'http://127.0.0.1:4000/' })).result).toEqual({ id: 1 });
    expect(t.host().ops()).toEqual(['prepare', 'drop', 'prepare']);
    expect(t.hosts, 'prepared again in the running render host').toHaveLength(1);
  });

  // The peer check's root is the pid with its start: the same pid with another start is another engine, and what was
  // checked against the old one ends, as O5 M5 holds it
  it('a reused pid with another start ends what was checked against the old engine; the new one’s cua is checked against it', async () => {
    const t = await stand();
    await t.status(null, 'exited');
    const table = t.addon as unknown as { process(pid: number): { ppid: number; start: number } | null };
    const original = table.process.bind(table);
    table.process = (pid) => (pid === ENGINE ? { ppid: 1, start: 99 } : pid === CUA ? { ppid: ENGINE, start: 100 } : original(pid));
    await t.status(ENGINE); // the same pid, another process
    await listening();
    const cua = await firstTab();
    expect(cua.closed).toBe(false);
    table.process = (pid) => (pid === ENGINE ? { ppid: 1, start: 199 } : original(pid)); // reused again, with no exit seen
    await t.status(ENGINE);
    await until(() => cua.closed, 3_000, 'the connection checked against the replaced engine ended');
  });

  it('an engine-host restart (the link lost, the status re-read with no pid first) keeps the held tab, both holds and cua’s connection', async () => {
    const t = await stand();
    const cua = await firstTab();
    await t.engine.supervisor.die();
    void t.daemon.hosts.wake('engine-host');
    await until(() => scene.engines.length === 2 && t.daemon.hosts.snapshot('engine-host').state === 'ready', 5_000, 'the successor');
    const successor = scene.lastEngine();
    await until(() => successor.named('host.browserWork').length > 0, 3_000, 'the successor’s first snapshot');
    expect(successor.calls[0]).toEqual({ name: 'host.browserWork', input: { held: [S] } });
    await until(() => successor.emitRaw('session.status', { appSessionId: S, status: { appSessionId: S, process: 'ready', pid: null } }), 3_000, 'the adoption’s first reading');
    successor.emitRaw('session.status', { appSessionId: S, status: { appSessionId: S, process: 'ready', pid: ENGINE } });
    await sleep(200);
    expect(t.host().ops(), 'no drop').toEqual(['prepare']);
    expect(cua.closed).toBe(false);
    expect((await cua.request('tabs.create', { url: 'http://127.0.0.1:4000/2' })).result).toEqual({ id: 2 });
    expect(await renderStatus(t.daemon)).toMatchObject({ browserSessions: 1, browserTabs: 2 });
  });
});

describe('host.browserIdle (D20)', () => {
  it('drops a held session’s headless tabs and returns it cold; ignored with nothing held', async () => {
    const t = await stand();
    t.engine.emitRaw('host.browserIdle', { appSessionId: S });
    await sleep(100);
    expect(t.hosts, 'nothing held: ignored').toHaveLength(0);
    const cua = await firstTab();
    t.engine.emitRaw('host.browserIdle', { appSessionId: S });
    await until(() => t.host().ops().length === 2, 3_000, 'the drop');
    await until(() => cua.closed, 3_000, 'cua’s connection ended');
    await until(() => JSON.stringify(t.snapshots().at(-1)) === '[]', 3_000, 'the hold cleared at the next snapshot');
    const again = Connector.open();
    await until(() => again.hellos() === 1, 3_000, 'cold again: the session stays resumable');
  });
});

describe('the browser capability (Interfaces §I)', () => {
  // The architect (2026-11-01): with no engine host connected the reading is this build's, never the old-host reason,
  // while the fence's acquire answers that the engine host is reconnecting (browser-work.test.ts pins the acquire)
  it('reads this build’s screencast with no engine host connected (reconnecting), never the old-host reason', async () => {
    const t = await stand({ engineHost: false });
    expect(t.daemon.hosts.peer('engine-host')).toBeNull();
    expect((await t.capabilities()).browser).toEqual(SCREENCAST);
  });

  it('reads the old-host reason from an engine host that predates browser work, and no socket listens cold', async () => {
    scene.engineSpawn = { capabilities: [...PEER_CAPABILITIES.engineHost] };
    const t = await stand();
    expect((await t.capabilities()).browser).toEqual(OLD_HOST);
    const cua = Connector.open();
    await until(() => cua.closed, 3_000, 'nothing listening');
    expect(cua.hellos()).toBe(0);
  });

  // The architect's condition on reading an untried addon as usable (M5, decision 9): its failed load answers at once
  // with the reason the capability then reads. The load is the session socket's own, before it listens: with no app the
  // route is `none` from that instant, so the socket never listens and cua's connect is refused by the system at once,
  // never held for a timeout (cua reads "no browser"; the reason is the capability's, posted once)
  it('reads the addon’s reason on a Mac where it did not load: the socket never listens, a peer is refused at once, one change', async () => {
    const ADDON = { available: false, reason: `the peer identity check did not load on ${MACHINE}, so the agent's browser is refused` };
    const dir = cuaSocketDir(scene.root, TMP);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const appeared: string[] = [];
    const watcher = watch(dir, (_event, name) => void (name && appeared.push(String(name))));
    closers.push(() => watcher.close());
    let before: unknown;
    const t = await stand({ addon: null, asked: (reading) => (before = reading.browser) });
    expect(before, 'untried, the addon reads usable (a capability read loads none)').toEqual(SCREENCAST);
    await until(() => t.changes().length === 1, 3_000, 'the reading’s change');
    expect(t.changes()[0]!.capabilities.browser).toEqual(ADDON);

    const startedAt = performance.now();
    const cua = Connector.open();
    const failure = await new Promise<string>((resolve) => cua.socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message)));
    expect(performance.now() - startedAt, 'answered at once, no timeout waited out').toBeLessThan(500);
    expect(['ENOENT', 'ECONNREFUSED']).toContain(failure);
    expect(cua.hellos()).toBe(0);
    await sleep(100);
    expect(appeared.filter((name) => name.endsWith('.sock')), 'the session’s socket never listened, not even for a turn').toEqual([]);
    expect((await t.capabilities()).browser).toEqual(ADDON);
    expect(t.changes(), 'one change').toHaveLength(1);
  });

  it('posts one change per change of reading, screencast ↔ local, loading no chunk at an attachment', async () => {
    const t = await stand();
    await t.capabilities(); // asked: followed from now
    const app = await attachApp();
    await until(() => t.changes().length === 1, 3_000, 'local');
    app.leave();
    await until(() => t.changes().length === 2, 3_000, 'screencast');
    await sleep(200);
    expect(t.changes().map((change) => change.capabilities.browser)).toEqual([LOCAL, SCREENCAST]);
    expect(scene.logs.some((line) => line.includes('the render seam loaded') || line.includes('the cold broker loaded'))).toBe(false);
  });
});
