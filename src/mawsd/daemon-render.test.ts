// The render seam inside `mawsd` (P5 O5 M4; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M4, Interfaces §A, §B,
// §F, §G): the engine host's capture and export requests go to the seam, which starts the render host (a stand-in
// child; its machine.sock connection a raw client whose hello lists render.client), hands the request over after the
// client's ready and answers the engine host, while no other client hears the request; the library's Export from any
// machine.sock client goes the same way; `host.attachment` tells a render-reading engine host `render: true` at the
// link's streaming and at each presence change; a render client is no client for the clocks; the exit order answers a
// render in flight over the engine-host link before the loaded spine's stop ends that link; `daemon.e2eRender` is
// refused unless mawsd runs under MAWS_E2E=1. Over the daemon in this process and stand-in hosts on real sockets
// (test/support/mawsd-scene.ts).
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { MACHINE_RENDER_CAPABILITY, MACHINE_SPINE_CAPABILITY, PEER_CAPABILITIES, RENDER_CLIENT_CAPABILITY } from '@shared/host/socket-protocol';
import { machineName } from '@shared/machine/identity';
import { takeSpineLock } from '../services/settings/spine-lock';
import type { DaemonOptions, RunningDaemon } from './daemon';
import type { RenderChild } from './render-seam';
import type { SpineEntry } from './spine-seam';
import { MawsdScene, sleep, until, type RawApp } from '../../test/support/mawsd-scene';

let scene: MawsdScene;

beforeEach(() => {
  scene = new MawsdScene('maws-mr-');
  scene.engineSpawn = { answers: { 'maws.artifact.captured': () => ({ outcome: 'delivered' }), 'maws.artifact.exported': () => ({ outcome: 'delivered' }) } };
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

const MACHINE = machineName({}, hostname());
const ARTIFACT = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const CAPTURE = { appSessionId: 'app-1', requestId: 'req-1', artifactId: ARTIFACT, revision: 2, width: 640, height: 480 };
const PNG = { ok: true, png: 'iVBORw0KGgo=', width: 640, height: 480, consoleErrors: [] };

class StandInRenderChild implements RenderChild {
  readonly pid = 4_242;
  readonly killed: string[] = [];
  private readonly listeners: ((code: number | null, signal: string | null) => void)[] = [];
  kill(signal: NodeJS.Signals): void {
    this.killed.push(signal);
    this.exit(null, signal);
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

// The render host: each spawn a stand-in child, its machine.sock connection made by the test (`connect`)
function renderHosts() {
  const children: StandInRenderChild[] = [];
  const options: DaemonOptions['render'] = {
    spawn: () => {
      const child = new StandInRenderChild();
      children.push(child);
      return child;
    },
    runtime: () => ({ available: true }), // the scene's platform is linux, whose runtime is M6's
  };
  const connect = async (): Promise<RawApp> => {
    const host = await scene.app('machine', { capabilities: [RENDER_CLIENT_CAPABILITY] });
    host.ready();
    return host;
  };
  return { options, children, connect };
}

// A spine stand-in: its records the session titles an export's comment authors read (an export loads a cold spine)
function standInSpine(records: readonly { appId: string; title: { text: string } }[] = [], stop: () => void = () => {}): NonNullable<DaemonOptions['spine']> {
  const load = async (): Promise<SpineEntry> => ({
    takeSpineLock,
    openSpineData: async (_profile, { lock }) => ({ lock: lock!, refused: lock!.refused, machineSettings: null as never, paths: { client: '', machine: '' } }),
    startSpine: (started) => {
      started.bus.register('session.launchMode', () => ({ mode: 'index' }));
      return { view: { engineStatuses: () => [], on: () => () => {}, unavailable: () => null, records: () => records } as never, settled: async () => {}, busy: () => false, stop };
    },
  });
  return { load };
}

const requests = (host: RawApp) => host.events('render.request') as { id: string; kind: string; request: unknown; authors?: unknown }[];

async function awake(daemon: RunningDaemon) {
  void daemon.hosts.wake('engine-host');
  await until(() => scene.engines.length > 0 && daemon.hosts.snapshot('engine-host').state === 'ready', 5_000, 'the engine host');
  return scene.lastEngine();
}

describe('the render seam in mawsd (P5 O5 M4)', () => {
  it('lists machine.render in every welcome', async () => {
    await scene.start({ permanentClient: true });
    const client = await scene.app('machine', { capabilities: [MACHINE_SPINE_CAPABILITY] });
    expect(client.first?.capabilities).toContain(MACHINE_RENDER_CAPABILITY);
  });

  it('takes the engine host’s capture request: starts the render host at it, hands it over after its ready, answers the engine host, and no client hears it', async () => {
    const render = renderHosts();
    const daemon = await scene.start({ permanentClient: true, render: render.options });
    const engine = await awake(daemon);
    const reader = await scene.app('machine', { capabilities: [...PEER_CAPABILITIES.app] });
    reader.ready();
    await reader.request('daemon.status');
    expect(render.children, 'nothing spawned before a request').toHaveLength(0);
    expect((await daemon.status()).render).toEqual({ state: 'off', detail: null, pid: null, starts: 0, requests: 0 });

    await until(() => engine.emitRaw('maws.artifact.capture', CAPTURE), 3_000, 'the link’s ready line');
    await until(() => render.children.length === 1, 3_000, 'the render host’s spawn');
    expect((await daemon.status()).render).toMatchObject({ state: 'starting', pid: 4_242, starts: 1, requests: 1 });
    const host = await render.connect();
    await until(() => requests(host).length === 1, 3_000, 'the request handed over');
    expect(host.events('render.hostGeneration'), 'the link’s loss count before the work: none yet').toEqual([{ generation: 0 }]);
    const [request] = requests(host);
    expect(request).toMatchObject({ kind: 'capture', request: CAPTURE });
    expect(await host.request('render.answer', { id: request!.id, answer: PNG })).toMatchObject({ ok: true });
    await until(() => engine.named('maws.artifact.captured').length === 1, 3_000, 'the answer to the engine host');
    expect(engine.named('maws.artifact.captured')).toEqual([{ appSessionId: 'app-1', requestId: 'req-1', result: PNG }]);

    expect(engine.send({ n: 1 })).toBe(true);
    await until(() => reader.events().length === 1, 3_000, 'an ordinary event');
    expect(reader.events('maws.artifact.capture'), 'the render request reaches no client').toEqual([]);
    expect(reader.events('render.request'), 'nor the render host’s work').toEqual([]);
  });

  it('answers the library’s Export from any machine.sock client through the render host, and refuses render.answer from a client that is none', async () => {
    const render = renderHosts();
    await scene.start({ permanentClient: true, render: render.options, spine: standInSpine() });
    const client = await scene.app('machine', { capabilities: [...PEER_CAPABILITIES.app] });
    client.ready();
    const asked = client.request('artifacts.export', { artifactId: ARTIFACT, format: 'pdf', dialect: 'notion' }, 8_000);
    await until(() => render.children.length === 1, 3_000, 'the render host’s spawn');
    const host = await render.connect();
    await until(() => requests(host).length === 1, 3_000, 'the request handed over');
    const [request] = requests(host);
    expect(request).toMatchObject({ kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'pdf', dialect: 'notion' } });
    expect(await client.request('render.answer', { id: request!.id, answer: { path: '/elsewhere.pdf', revision: 1 } })).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(await host.request('render.answer', { id: request!.id, answer: { path: `${scene.root}/artifacts/${ARTIFACT}/exports/2.pdf`, revision: 2 } })).toMatchObject({ ok: true });
    expect(await asked).toMatchObject({ ok: true, value: { path: `${scene.root}/artifacts/${ARTIFACT}/exports/2.pdf`, revision: 2 } });
  });

  it('tells a render-reading engine host render: true at the link’s streaming with no app, and with each presence change', async () => {
    const daemon = await scene.start({ permanentClient: true });
    const engine = await awake(daemon);
    await until(() => engine.named('host.attachment').length === 1, 3_000, 'the streaming’s tell');
    expect(engine.named('host.attachment')).toEqual([{ attached: false, render: true }]);
    const app = await scene.app();
    await until(() => engine.named('host.attachment').length === 2, 3_000, 'the attachment');
    expect(engine.named('host.attachment').at(-1)).toEqual({ attached: true, render: true });
    app.leave();
    await until(() => engine.named('host.attachment').length === 3, 3_000, 'the departure');
    expect(engine.named('host.attachment').at(-1)).toEqual({ attached: false, render: true });
  });

  it('a render client is no client for the clocks: with it alone a private daemon’s idle exit is due', async () => {
    const render = renderHosts();
    const daemon = await scene.start({ permanentClient: true, render: render.options });
    const host = await render.connect();
    await host.request('daemon.status');
    expect((await daemon.status()).idleExitAt).not.toBeNull();
    const app = await scene.app('machine', { capabilities: [...PEER_CAPABILITIES.app] });
    await app.request('daemon.status');
    expect((await daemon.status()).idleExitAt).toBeNull();
  });

  it('posts the engine-host link’s loss to the render host at the loss, ahead of the failure of the read the loss refused, with no new host welcomed', async () => {
    scene.engineSpawn = { ...scene.engineSpawn, answers: { ...scene.engineSpawn!.answers, 'artifacts.get': () => new Promise(() => {}) } }; // a read the link's loss refuses
    const render = renderHosts();
    const daemon = await scene.start({ permanentClient: true, render: render.options });
    const engine = await awake(daemon);
    await until(() => engine.emitRaw('maws.artifact.capture', CAPTURE), 3_000, 'the link’s ready line');
    await until(() => render.children.length === 1, 3_000, 'the render host’s spawn');
    const host = await render.connect();
    await until(() => requests(host).length === 1, 3_000, 'the request handed over');
    expect(host.events('render.hostGeneration')).toEqual([{ generation: 0 }]);

    host.post({ t: 'req', id: 'snapshot-read', name: 'artifacts.get', input: { artifactId: ARTIFACT } });
    await until(() => engine.calls.some((call) => call.name === 'artifacts.get'), 3_000, 'the read at the engine host');
    scene.engineSpawn = null; // the next host is not welcomed in this case
    await engine.supervisor.die();
    await until(() => host.messages.some((message) => message.t === 'res' && message.id === 'snapshot-read'), 5_000, 'the read’s failure');
    const at = (match: (message: Record<string, unknown>) => boolean) => host.messages.findIndex(match);
    const failure = at((message) => message.t === 'res' && message.id === 'snapshot-read');
    expect(host.messages[failure]).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    const loss = at((message) => message.t === 'evt' && message.name === 'render.hostGeneration' && (message.payload as { generation: number }).generation === 1);
    expect(loss, 'the loss is posted').toBeGreaterThanOrEqual(0);
    expect(loss, 'ahead of the read’s failure').toBeLessThan(failure);
    expect(daemon.hosts.snapshot('engine-host').state, 'no host welcomed since').not.toBe('ready');
    expect(host.events('render.hostGeneration')).toEqual([{ generation: 0 }, { generation: 1 }]);
  });

  it('a cold spine is loaded for an export’s comment authors: the session titles the embedded root names (view.record(id).title.text) ride the request', async () => {
    const render = renderHosts();
    const records = [
      { appId: 'app-1', title: { text: 'Review agent' } },
      { appId: 'app-2', title: { text: '   ' } }, // no title: the exporters' own label, as the embedded root's empty one gives
    ];
    const daemon = await scene.start({ permanentClient: true, render: render.options, spine: standInSpine(records) });
    await awake(daemon);
    expect((await daemon.status()).spine?.state, 'cold before the export').toBe('cold');
    const client = await scene.app('machine', { capabilities: [...PEER_CAPABILITIES.app] });
    client.post({ t: 'req', id: 'library-export', name: 'artifacts.export', input: { artifactId: ARTIFACT, format: 'docx' } });
    await until(() => render.children.length === 1, 3_000, 'the render host’s spawn');
    const host = await render.connect();
    await until(() => requests(host).length === 1, 5_000, 'the request handed over');
    expect(requests(host)[0]).toMatchObject({ kind: 'libraryExport', authors: { sessions: { 'app-1': 'Review agent' } } });
    expect(requests(host)[0]!.authors).toEqual({ sessions: { 'app-1': 'Review agent' } });
    expect(scene.logs).toContain('[spine] loading (command)');
  });

  it('the exit answers a render in flight over the engine-host link before the loaded spine’s stop ends it, then ends the render host', async () => {
    const render = renderHosts();
    const stops = vi.fn();
    const daemon = await scene.start({ permanentClient: true, render: render.options, spine: standInSpine([], stops) });
    const engine = await awake(daemon);
    const client = await scene.app('machine', { capabilities: [...PEER_CAPABILITIES.app] });
    expect(await client.request('session.launchMode')).toMatchObject({ ok: true }); // the spine loaded
    await until(() => engine.emitRaw('maws.artifact.capture', CAPTURE), 3_000, 'the link’s ready line');
    await until(() => render.children.length === 1, 3_000, 'the render host’s spawn');
    const host = await render.connect();
    await until(() => requests(host).length === 1, 3_000, 'the request handed over');

    const stopping = daemon.stop('restart', 75);
    await until(() => host.events('render.exit').length === 1, 3_000, 'render.exit');
    expect(engine.named('maws.artifact.captured'), 'answered while the link lived').toEqual([{ appSessionId: 'app-1', requestId: 'req-1', result: { ok: false, error: `the render service is restarting on ${MACHINE}` } }]);
    expect(stops, 'the spine still running').not.toHaveBeenCalled();
    render.children[0]!.exit(0);
    await stopping;
    expect(stops).toHaveBeenCalledOnce();
    expect(scene.exits).toEqual([75]);
    expect(scene.logs).toContain('[render] the render host exited (code 0)');
  });

  it('daemon.e2eRender is refused unless mawsd runs under MAWS_E2E=1, and with it writes the capture’s PNG', async () => {
    const render = renderHosts();
    await scene.start({ permanentClient: true, render: render.options });
    const client = await scene.app('machine', { capabilities: [...PEER_CAPABILITIES.app] });
    const to = join(scene.root, 'capture.png');
    const input = { artifactId: ARTIFACT, revision: 2, width: 640, height: 480, to };
    expect(await client.request('daemon.e2eRender', input)).toMatchObject({ ok: false, error: { message: expect.stringContaining('daemon.e2eRender is refused') } });
    await sleep(50);
    expect(render.children).toHaveLength(0);
    await scene.dispose();

    scene = new MawsdScene('maws-mr-');
    const allowed = renderHosts();
    await scene.start({ permanentClient: true, render: allowed.options, env: { MAWS_USER_DATA: scene.root, MAWS_E2E: '1' } });
    const e2e = await scene.app('machine', { capabilities: [...PEER_CAPABILITIES.app] });
    const target = join(scene.root, 'capture.png');
    const asked = e2e.request('daemon.e2eRender', { ...input, to: target }, 8_000);
    await until(() => allowed.children.length === 1, 3_000, 'the render host’s spawn');
    const host = await allowed.connect();
    await until(() => requests(host).length === 1, 3_000, 'the request handed over');
    await host.request('render.answer', { id: requests(host)[0]!.id, answer: PNG });
    expect(await asked).toMatchObject({ ok: true });
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target).toString('base64')).toBe(PNG.png);
  });
});
