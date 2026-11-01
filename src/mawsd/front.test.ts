// The services front's core (P5 O3-D M2; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §B): a
// machine.sock client's runtime over a stand-in seam and hosts. The front over the real spine is daemon-spine.test.ts's.
import { describe, expect, it, vi } from 'vitest';
import { MACHINE_SPINE_CAPABILITY, RENDER_CLIENT_CAPABILITY } from '@shared/host/socket-protocol';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { REGISTRY } from '@shared/ipc/registry';
import type { CommandName } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { status as statusOf } from '../../test/support/builders';
import { createServicesFront, FRONT_COMMANDS, SPINE_ENGINE_INTERCEPTS, spineTakes, type FrontOptions } from './front';
import { SpineUnavailable } from './spine-seam';

const IDENTITY = { ref: 'TestMachineRef00000000' as MachineRef, name: 'test machine', project: { key: 'machine:TestMachineRef00000000', name: 'test machine', smnsId: null } };

// A machine.sock client's end of its connection, as the socket layer hands the runtime one
function connection() {
  const posted: Record<string, unknown>[] = [];
  let listener: (event: { data: unknown }) => void = () => {};
  let open = true;
  const port = {
    start: () => {},
    on: (_event: 'message', l: (event: { data: unknown }) => void) => void (listener = l),
    postMessage: (message: unknown) => (open ? void posted.push(message as Record<string, unknown>) : false),
  };
  let next = 0;
  return {
    port,
    posted,
    close: () => void (open = false),
    send: (data: unknown) => listener({ data }),
    ready: () => listener({ data: { t: 'ready' } }),
    async request(name: string, input?: unknown, client?: string): Promise<Record<string, unknown>> {
      const id = `r${++next}`;
      listener({ data: { t: 'req', id, name, input, ...(client && { client }) } });
      await vi.waitFor(() => expect(posted.find((m) => m.id === id)).toBeDefined());
      return posted.find((m) => m.id === id)!;
    },
    events: () => posted.filter((m) => m.t === 'evt').map((m) => m.name),
  };
}

function front(over: Partial<FrontOptions> = {}) {
  const raw = new Set<(message: { name: string; payload: unknown }) => void>();
  const forwarded: { owner: string; name: string; input: unknown; client?: unknown }[] = [];
  // P5 O5 M4: the render seam as the front reaches it
  const render = { ready: 0, gone: 0, answers: [] as unknown[], posted: new Set<string>(), exports: [] as unknown[] };
  const ensure = vi.fn(async () => ({}) as never);
  const logs: string[] = [];
  const served = createServicesFront({
    spine: { ensure },
    hosts: {
      forward: async (owner, request) => (forwarded.push({ owner, ...request }), { t: 'res', id: 'x', ok: true, value: { forwarded: request.name } } as HostResponse),
      onRaw: (_owner, listener) => (raw.add(listener), () => void raw.delete(listener)),
      onStreaming: () => () => {},
      parked: () => false,
    },
    intercept: () => null,
    daemon: async (name) => (name === 'daemon.status' ? { asked: name } : undefined),
    identity: () => IDENTITY,
    isApp: () => false,
    log: (line) => void logs.push(line),
    render: {
      clientReady: () => void render.ready++,
      clientGone: () => void render.gone++,
      answer: (input) => (render.answers.push(input), render.posted.has(input.id)),
      exportForLibrary: async (input) => {
        render.exports.push(input);
        if (input.format === 'docx') throw new HostCommandError(ipcError('invalid_input', 'no docx', { reason: 'exportUnavailable', data: {} }));
        return { path: '/p/x.pdf', revision: 1 };
      },
    },
    ...over,
  });
  const client = (capabilities: readonly string[] = []) => {
    const end = connection();
    served.runtimeFor({ appPid: 1, capabilities }).serve(end.port);
    return end;
  };
  return { served, client, ensure, forwarded, logs, render, raw: (name: string, payload: unknown) => raw.forEach((l) => l({ name, payload })) };
}

describe('the services front', () => {
  it('answers machine.identity and the daemon namespace cold, with no load', async () => {
    const { client, ensure } = front();
    const c = client();
    expect(await c.request('machine.identity')).toMatchObject({ ok: true, value: IDENTITY });
    expect(await c.request('daemon.restart')).toMatchObject({ ok: true });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('loads at a spine command and answers it from what the spine registered, its intercept first, its output validated', async () => {
    const { served, client, ensure } = front();
    served.bus.register('session.search', () => ({ results: 'not a list' }) as never);
    served.bus.register('session.launchMode', () => ({ mode: 'index' }) as never);
    const c = client();
    expect(await c.request('session.search', { query: 'x' })).toMatchObject({ ok: false, error: { code: 'internal' } }); // output refused
    expect(ensure).toHaveBeenCalledWith('command');
    const off = served.bus.intercept('session.launchMode', () => ({ mode: 'scenario' }) as never);
    expect(await c.request('session.launchMode')).toMatchObject({ ok: true, value: { mode: 'scenario' } });
    off();
    expect(await c.request('session.launchMode')).toMatchObject({ ok: true, value: { mode: 'index' } });
  });

  it('answers the refusal on every spine command: host_unavailable naming the holder', async () => {
    const refusal = 'spine.lock is held by pid 4321 (build 1.0.0+abc), so this run starts none of the machine’s services and writes none of its files';
    const { client } = front({ spine: { ensure: async () => Promise.reject(new SpineUnavailable(refusal, 'refused')) } });
    const c = client();
    for (const name of ['session.list', 'attention.list', 'library.list']) {
      expect(await c.request(name, name === 'attention.list' ? undefined : name === 'session.list' ? { includeArchived: false } : {})).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: refusal } });
    }
  });

  it('forwards an engine-host name through the bus’s intercept, then the daemon’s, then the host; host.attachment is its own', async () => {
    const intercepted: string[] = [];
    const { served, client, forwarded } = front({
      intercept: ({ name }) => (name === 'host.stopAll' ? (intercepted.push(name), Promise.resolve({ t: 'res', id: 'x', ok: true, value: undefined })) : null),
    });
    const c = client();
    expect(await c.request('host.stopAll', { graceMs: 1000 })).toMatchObject({ ok: true });
    expect(intercepted).toEqual(['host.stopAll']);
    expect(await c.request('engine.sessions')).toMatchObject({ ok: true, value: { forwarded: 'engine.sessions' } });
    served.bus.intercept('session.answer', () => ({ outcome: 'not_pending' }) as never);
    const answered = await c.request('session.answer', { appSessionId: 'a', requestId: 'r', answer: { kind: 'permission', decision: 'deny' } });
    expect(answered).toMatchObject({ ok: true, value: { outcome: 'not_pending' } }); // the spine's pending check answered it
    expect(forwarded.map((f) => f.name)).toEqual(['engine.sessions']);
    expect(await c.request('host.attachment', { attached: true })).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
  });

  // P5 O3-D M5 (D44(3)): the spine's engine-host intercepts apply whatever path a request came by, the spine cold included
  const REWOUND = { rewound: true, reason: null, error: null, prefillText: null, precedingAssistantUuid: null, files: null };
  const REWIND = { appSessionId: 'a', targetMessageUuid: 'm-target', lastSeenMessageUuid: 'm-seen', files: false };

  it('loads a cold spine for an engine-host name it intercepts, then answers through the intercept the load installed', async () => {
    const noted: unknown[] = [];
    const harness = front({
      spine: {
        ensure: vi.fn(async () => {
          if (harness.served.intercepts().length === 0) harness.served.bus.intercept('session.rewind', (input) => (noted.push(input), REWOUND) as never); // what the load registers
          return {} as never;
        }),
      },
    });
    const c = harness.client();
    expect(await c.request('session.rewind', REWIND)).toMatchObject({ ok: true, value: REWOUND });
    expect(noted).toEqual([REWIND]);
    expect(harness.forwarded).toEqual([]);
    expect(await harness.served.dispatch('session.rewind', REWIND)).toMatchObject({ ok: true, value: REWOUND }); // the endpoint's machine route
    expect(noted).toHaveLength(2);
    expect(harness.served.intercepts()).toEqual(['session.rewind']);
  });

  it('forwards an intercepted name raw when the spine cannot load, and never loads it for a name it does not intercept', async () => {
    const ensure = vi.fn(async () => Promise.reject(new SpineUnavailable('spine.lock is held by pid 4321 (build old)', 'refused')));
    const { client, forwarded, logs } = front({ spine: { ensure } });
    const c = client();
    expect(await c.request('session.rewind', REWIND)).toMatchObject({ ok: true, value: { forwarded: 'session.rewind' } });
    expect(logs).toContainEqual('[spine] session.rewind goes on without the spine’s intercept: spine.lock is held by pid 4321 (build old)');
    ensure.mockClear();
    expect(await c.request('engine.sessions')).toMatchObject({ ok: true });
    expect(ensure).not.toHaveBeenCalled();
    expect(forwarded.map((f) => f.name)).toEqual(['session.rewind', 'engine.sessions']);
  });

  // Review fix: only the spine's classified states (the lock's refusal, the yield) leave a request to go on raw
  it('answers host_unavailable and forwards nothing when the load fails otherwise (a chunk error, the daemon’s exit)', async () => {
    for (const failure of [new Error('database disk image is malformed'), new SpineUnavailable('the daemon is exiting', 'exiting')]) {
      const harness = front({ spine: { ensure: vi.fn(async () => Promise.reject(failure)) } });
      expect(await harness.client().request('session.rewind', REWIND)).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
      expect(await harness.served.dispatch('host.op', { opId: 'phone-op-00000001', opCreated: 'c', member: 'm', device: 'd', fingerprint: 'f', name: 'session.rewind', input: REWIND, context: { launchId: 'l', engineSessionId: 'e' } })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
      expect(await harness.served.intercepted('session.answer', { appSessionId: 'a', requestId: 'r', answer: { kind: 'permission', decision: 'deny' } })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
      expect(harness.forwarded).toEqual([]);
    }
  });

  it('intercepted: the spine’s intercept for a relayed request, loaded for it; null for another name or an unloadable spine', async () => {
    let loadable = true;
    const harness = front({
      spine: {
        ensure: vi.fn(async () => {
          if (!loadable) throw new SpineUnavailable('yielded', 'yielded');
          if (harness.served.intercepts().length === 0) harness.served.bus.intercept('session.rewind', () => REWOUND as never);
          return {} as never;
        }),
      },
    });
    const ref = { id: 'app' } as never;
    expect(await harness.served.intercepted('engine.sessions', undefined, ref)).toBeNull();
    expect(await harness.served.intercepted('session.rewind', REWIND, ref)).toEqual({ ok: true, value: REWOUND });
    expect(await harness.served.intercepted('session.rewind', { appSessionId: 'a' }, ref)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    harness.served.unbind();
    loadable = false;
    expect(await harness.served.intercepted('session.rewind', REWIND, ref)).toBeNull();
  });

  it('spineTakes: an intercepted name, and lane B’s claimed op (host.op) of one (D47); not a claimed op of another', () => {
    expect(spineTakes('session.rewind', REWIND)).toBe(true);
    expect(spineTakes('host.op', { name: 'session.rewind', input: REWIND })).toBe(true);
    expect(spineTakes('host.op', { name: 'session.steer', input: {} })).toBe(true);
    expect(spineTakes('host.op', { name: 'session.stop', input: {} })).toBe(false);
    expect(spineTakes('host.op', undefined)).toBe(false);
    expect(spineTakes('engine.sessions', { name: 'session.rewind' })).toBe(false);
  });

  it('SPINE_ENGINE_INTERCEPTS names engine-host commands only', () => {
    for (const name of SPINE_ENGINE_INTERCEPTS) expect(REGISTRY.commands[name as CommandName].owner, name).toBe('engine-host');
  });

  // P5 O3-D M5b (Interfaces §F, §G): the mirror's two reads and the machine half are the spine's commands, served from
  // what it registered once loaded (they answered internal until the cutover)
  it('loads the spine for the mirror’s reads and the machine half, and answers them from what it registered', async () => {
    const { served, client, ensure } = front();
    served.bus.register('session.visible', () => ({ sessions: ['s1'] }) as never);
    served.bus.register('machineSettings.get', () => ({ nope: true }) as never);
    const c = client();
    expect(await c.request('session.visible')).toMatchObject({ ok: true, value: { sessions: ['s1'] } });
    expect(ensure).toHaveBeenCalledWith('command');
    expect(await c.request('machineSettings.get')).toMatchObject({ ok: false, error: { code: 'internal' } }); // output refused
    expect(await c.request('library.fileLinkedPaths', { appSessionId: 's1' })).toMatchObject({ ok: false, error: { code: 'internal', message: 'the spine registered no handler for library.fileLinkedPaths' } });
  });

  it('every machine name is the front’s own or the spine’s', () => {
    const machine = Object.entries(REGISTRY.commands).flatMap(([name, { owner }]) => (owner === 'machine' ? [name] : []));
    for (const name of FRONT_COMMANDS) expect(machine).toContain(name);
  });

  it('emits only machineEvents, validated, to the clients that said ready, and to the taps', () => {
    const { served, client, logs } = front();
    const [ready, waiting] = [client(), client()];
    ready.ready();
    const tapped: unknown[] = [];
    served.bus.onEmitted('session.status', (payload) => void tapped.push(payload));
    const payload = { appSessionId: 's1', status: statusOf('s1') };
    expect(served.bus.emit('session.status', payload as never)).toBe(true);
    expect(served.bus.emit('session.queue' as never, { appSessionId: 's1', entries: [], paused: false } as never)).toBe(false); // the engine host's, not the machine's
    expect(served.bus.emit('attention.changed', { nonsense: true } as never)).toBe(false);
    expect(ready.events()).toEqual(['session.status']);
    expect(waiting.events()).toEqual([]);
    expect(tapped).toHaveLength(1);
    expect(logs).toContainEqual('machine.sock: refused to emit session.queue: it is not in MACHINE_EVENTS');
  });

  // Main's machine transport hears the engine host's events on its relay until M5: the front gives them only to a client
  // that reads them here (machine.spine), so none reaches main twice; the taps hear every one
  it('relays the engine host’s events raw to the taps, and those that name no session only to a ready machine.spine client', () => {
    const { served, client, raw } = front();
    const [plain, spine] = [client(['host.attachment']), client([MACHINE_SPINE_CAPABILITY])];
    plain.ready();
    spine.ready();
    const tapped: string[] = [];
    served.bus.onEmitted('session.eventBatch', () => void tapped.push('batch'));
    served.bus.onEmitted('plugins.changed' as never, () => void tapped.push('plugins'));
    raw('session.eventBatch', { appSessionId: 's1', events: [] });
    raw('plugins.changed', {});
    expect(tapped).toEqual(['batch', 'plugins']);
    expect(plain.events()).toEqual([]);
    expect(spine.events()).toEqual(['plugins.changed']);
    served.bus.emit('session.status', { appSessionId: 's1', status: statusOf('s1') } as never); // the spine's own: every ready client
    expect(plain.events()).toEqual(['session.status']);
    expect(spine.events()).toEqual(['plugins.changed', 'session.status']);
  });

  // M5b fix round 2 (e2e:lane-a): a session the engine host follows on disk (a terminal session, a discovered one) has no
  // launch, so no stream can carry its batches: they go as any event that names a session does, to the machine.spine
  // clients and its followers; a launch's batch stays its streams'
  it('gives a disk follow’s batch to a ready machine.spine client, and keeps a launch’s batch to its streams', () => {
    const { client, raw } = front();
    const [plain, spine] = [client(['host.attachment']), client([MACHINE_SPINE_CAPABILITY])];
    plain.ready();
    spine.ready();
    const event = (id: string, seq: number | null) => ({ id, sessionId: 'e1', at: '2026-10-28T10:00:00.000Z', seq, agentId: null, parentToolUseId: null, kind: 'assistant.text', text: 'x' });
    raw('session.eventBatch', { appSessionId: 's1', events: [event('9a1c0e2f-row@1', null)] });
    expect(spine.events()).toEqual(['session.eventBatch']);
    expect(plain.events()).toEqual([]);
    raw('session.eventBatch', { appSessionId: 's1', events: [event('s1:L1:3:0', 3)] });
    expect(spine.events()).toEqual(['session.eventBatch']);
  });

  it('invoke runs a registered command in process without waiting for a load; unbind drops the load’s registrations', async () => {
    const { served, ensure } = front();
    served.bus.register('session.launchMode', () => ({ mode: 'index' }) as never);
    const context = { client: { id: 'ledger' } } as never;
    expect(await served.bus.invoke('session.launchMode', undefined, context)).toEqual({ ok: true, value: { mode: 'index' } });
    expect(ensure).not.toHaveBeenCalled();
    expect(served.commands()).toEqual([...FRONT_COMMANDS, 'session.launchMode'].sort() as CommandName[]);
    served.unbind();
    expect(served.commands()).toEqual([...FRONT_COMMANDS]);
    served.bus.register('session.launchMode', () => ({ mode: 'index' }) as never); // the next load registers afresh
  });

  it('hands the discovery wake the request’s arrival, taken before the spine’s load (the panel’s sweep#4)', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-30T08:00:00.000Z'), toFake: ['Date'] });
    try {
      const arrived = Date.now();
      const before = vi.fn(async () => {});
      const ensure = vi.fn(async () => (vi.setSystemTime(arrived + 4_000), {}) as never); // the load takes 4 s
      const { served, client } = front({ spine: { ensure }, beforeSpineCommand: before });
      served.bus.register('session.list', () => ({ sessions: [], revision: 0 }) as never);
      expect(await client().request('session.list', { includeArchived: false })).toMatchObject({ ok: true });
      expect(before).toHaveBeenCalledWith('session.list', false, arrived);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a client’s end ends its refs and its events', async () => {
    const { served, client } = front();
    let ended = false;
    served.bus.register('session.launchMode', (_input, { client: ref }) => (ref.onGone(() => void (ended = true)), ({ mode: 'index' }) as never));
    const c = client();
    c.ready();
    await c.request('session.launchMode', undefined, 'page:1');
    c.close();
    served.bus.emit('session.status', { appSessionId: 's1', status: statusOf('s1') } as never); // the closed port refuses: the client is gone
    expect(ended).toBe(true);
  });

  // P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §A): the render host is a client whose
  // hello lists render.client: its ready and its end go to the render seam, render.request and render.exit are posted
  // to it alone, render.answer is taken from it alone, and nothing of the bus's fan-out reaches it
  it('a render.client: its ready and end told to the seam, its posts its alone, and no bus event reaches it', () => {
    const { served, client, render } = front();
    const [app, renderer] = [client([MACHINE_SPINE_CAPABILITY]), client([RENDER_CLIENT_CAPABILITY])];
    expect(served.eventClients(), 'none said ready').toBe(0);
    app.ready();
    expect(served.eventClients()).toBe(1);
    expect(served.postRender('render.request', { id: 'r0', kind: 'capture', request: {} } as never), 'none ready').toBe(false);
    renderer.ready();
    expect(render.ready).toBe(1);
    expect(served.renderClients()).toBe(1);
    expect(served.eventClients(), 'P5 O5 M6: the bus’s events never reach a render client').toBe(1);
    expect(served.postRender('render.exit', {})).toBe(true);
    expect(renderer.events()).toEqual(['render.exit']);
    expect(app.events()).toEqual([]);
    served.bus.emit('session.status', { appSessionId: 's1', status: statusOf('s1') } as never);
    expect(app.events()).toEqual(['session.status']);
    expect(renderer.events(), 'the bus’s fan-out skips it').toEqual(['render.exit']);
    renderer.close();
    expect(served.postRender('render.exit', {}), 'its connection gone').toBe(false);
    expect(render.gone).toBe(1);
    expect(served.renderClients()).toBe(0);
    app.close();
    expect(served.eventClients()).toBe(0);
  });

  it('takes render.answer from a render.client alone, and refuses an id the seam did not post', async () => {
    const { client, render } = front();
    const [plain, renderer] = [client([MACHINE_SPINE_CAPABILITY]), client([RENDER_CLIENT_CAPABILITY])];
    renderer.ready();
    render.posted.add('r1');
    const answer = { ok: true, png: 'x', width: 1, height: 1, consoleErrors: [] };
    expect(await plain.request('render.answer', { id: 'r1', answer })).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(render.answers).toEqual([]);
    expect(await renderer.request('render.answer', { id: 'r1', answer })).toMatchObject({ ok: true });
    expect(await renderer.request('render.answer', { id: 'r9', answer })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(render.answers).toEqual([{ id: 'r1', answer }, { id: 'r9', answer }]);
  });

  it('posts the engine host’s capture and export requests to no client, the app’s included; the taps hear them', () => {
    const { served, client, raw } = front();
    const [spine, renderer] = [client([MACHINE_SPINE_CAPABILITY]), client([RENDER_CLIENT_CAPABILITY])];
    spine.ready();
    renderer.ready();
    const tapped: string[] = [];
    served.bus.onEmitted('maws.artifact.capture' as never, () => void tapped.push('capture'));
    raw('maws.artifact.capture', { appSessionId: 's1', requestId: 'q', artifactId: 'a', revision: 1, width: 1, height: 1 });
    raw('maws.artifact.export', { appSessionId: 's1', requestId: 'q2' });
    raw('plugins.changed', {});
    expect(tapped).toEqual(['capture']);
    expect(spine.events()).toEqual(['plugins.changed']);
    expect(renderer.events()).toEqual([]);
  });

  it('answers artifacts.export through the render seam, cold, never loading the spine, a refusal with its IPC error', async () => {
    const { client, ensure, render } = front();
    const c = client([MACHINE_SPINE_CAPABILITY]);
    expect(await c.request('artifacts.export', { artifactId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', format: 'pdf', dialect: 'notion' })).toMatchObject({ ok: true, value: { path: '/p/x.pdf', revision: 1 } });
    expect(await c.request('artifacts.export', { artifactId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', format: 'docx' })).toMatchObject({ ok: false, error: { code: 'invalid_input', issues: { reason: 'exportUnavailable' } } });
    expect(render.exports).toEqual([{ artifactId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', format: 'pdf', dialect: 'notion' }, { artifactId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', format: 'docx' }]);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('names the asking connection’s ref on each engine-host request it forwards (the holds’ owner)', async () => {
    const { client, forwarded } = front();
    const renderer = client([RENDER_CLIENT_CAPABILITY]);
    await renderer.request('engine.sessions');
    await renderer.request('engine.sessions', undefined, 'page:1');
    const [own, named] = forwarded.map((entry) => entry.client as { id: string });
    expect(own!.id).toMatch(/^\d+$/);
    expect(named!.id).toMatch(/^\d+\/page:1$/);
  });

  // P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §I): a session's capabilities, cold
  it('answers session.capabilities cold from the daemon\'s reading, never loading the spine, to a client and the endpoint alike', async () => {
    const asked: string[] = [];
    const { served, client, ensure } = front({ capabilities: (appSessionId) => (asked.push(appSessionId), { browser: { available: false, reason: 'no browser is attached on mini' } }) });
    const answer = await client().request('session.capabilities', { appSessionId: 's1' });
    expect(answer).toMatchObject({ ok: true, value: { browser: { available: false, reason: 'no browser is attached on mini' } } });
    expect(await served.dispatch('session.capabilities', { appSessionId: 's2' })).toMatchObject({ ok: true });
    expect(asked).toEqual(['s1', 's2']);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('tells the daemon when the attached app\'s browser socket may have changed: its machine.client, and the end of a client that sent one', async () => {
    let changed = 0;
    const { served, client } = front({ isApp: () => true, browserChanged: () => void changed++ });
    const app = client([MACHINE_SPINE_CAPABILITY]);
    const other = client();
    expect(await app.request('machine.client', { browserSocket: '/u/browser/cua' })).toMatchObject({ ok: true });
    expect(changed).toBe(1);
    expect(served.browserSocket()).toBe('/u/browser/cua');
    other.close();
    served.close();
    expect(changed).toBe(2); // the app's connection ended (the other sent none)
  });
});
