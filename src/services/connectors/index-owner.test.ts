// P3-HD M3c2: the connector service with MAWS's own OAuth supplied beside route D, as its production composition
// supplies them (./index.ts's `startConnectors`; Decision Log 14 and 29). The provider prepares route D's credentials and closes host epochs
// through `connectors.directClose` with the floor it names; it hears the host's loss and main's stop; the owner's
// server commands are registered and answer through the trusted handlers. H's engine-only service registers none.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, EventName, HostState } from '@shared/ipc/schema';
import type { DirectOperationOutcome, DirectSource } from '@shared/ipc/schema/connectors';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { endableClientRef, type EndableClientRef } from '@shared/ipc/client';
import { composeConnectors, type ConnectorsComposition } from '.';
import { createRelayedCallbacks } from './relayed-callback'; // P5 O7 M5c
import { createDirectRoute, type DirectRouteDeps } from './direct-route';
import type { ConnectorOAuthProvider } from './oauth-provider';
import { project, record } from '../../../test/support/builders';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { fakeSpineView } from '../../../test/support/fake-spine-view';

// P5 O3-C (reader R8): the spine's view, holding the artifact's creator and its project
const ownView = () => fakeSpineView({ records: [record('app-own', { projectId: 'proj' as never, directory: '/repo' })], projects: [project('proj', 0, { directory: '/repo' })] });

const ART = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const CONN = '33333333-3333-4333-8333-333333333333';
const SOURCE: DirectSource = { directory: '/repo', sourceId: SOURCE_ID, generation: 1, server: 'notes', scope: 'user', transport: 'http', path: '/h/.claude.json', entryPath: ['mcpServers', 'notes'], observedAt: '2026-10-17T00:00:00.000Z', resourceUrl: 'https://notes.example/mcp' };

class FakeHost {
  readonly dispatched: { name: string; input: Record<string, unknown> }[] = [];
  readonly outcomes = new Map<string, DirectOperationOutcome>();
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  readonly stateListeners = new Set<(state: HostState) => void>();
  closeAnswer = true;
  dispatch = async (_owner: string, name: CommandName, input: unknown) => {
    expect(validateCommandInput(name, input).ok, `${name} input`).toBe(true);
    const fields = input as Record<string, unknown>;
    this.dispatched.push({ name, input: fields });
    if (name === 'connectors.directClose' && !this.closeAnswer) return { ok: false as const, error: { code: 'timeout', message: 'x' } };
    const value = this.answer(name, fields);
    expect(validateCommandOutput(name, value).ok, `${name} output`).toBe(true);
    return { ok: true as const, value };
  };
  private answer(name: string, input: Record<string, unknown>): unknown {
    switch (name) {
      case 'library.entry':
        return { artifact: { id: ART, kind: 'html', title: 'Live', createdBy: { kind: 'session', appSessionId: 'app-own' }, projectId: 'proj', createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0 }, links: [] };
      case 'spaces.list':
        return { spaces: [] };
      case 'connectors.grants':
        return { grants: [] };
      case 'connectors.directResolve':
        this.outcomes.set(input.operationId as string, { kind: 'resolve', answer: { ready: true, source: SOURCE, tool: { fingerprint: 'f'.repeat(64), readOnly: true } } });
        queueMicrotask(() => this.emit('connectors.directOperation', { operationId: input.operationId }));
        return { operationId: input.operationId };
      case 'connectors.directTake': {
        const outcome = this.outcomes.get(input.operationId as string) ?? null;
        this.outcomes.delete(input.operationId as string);
        return { outcome };
      }
      case 'connectors.directClose':
        return { cancelled: 0 };
      default:
        throw new Error(`unexpected ${name}`);
    }
  }
  onEvent = (name: EventName, listener: (payload: never) => void) => {
    const set = this.listeners.get(name) ?? new Set();
    set.add(listener as (payload: unknown) => void);
    this.listeners.set(name, set);
    return () => void set.delete(listener as (payload: unknown) => void);
  };
  onState = (_owner: string, listener: (state: HostState) => void) => {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  };
  onStreaming = () => () => {};
  streaming = () => true;
  emit(name: string, payload: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(payload);
  }
}


let fake: FakeHost;
let bus: FakeBus;
let service: { stop(): void };
let me: EndableClientRef;
let closeHost: ((target: { connectionId: string; credentialEpoch?: number }) => Promise<boolean>) | null;
let routeDeps: DirectRouteDeps | null;
let provider: ConnectorOAuthProvider;
let changeListeners: Set<() => void>;

function start(over: Partial<ConnectorsComposition> = {}) {
  service = composeConnectors({
    hosts: { dispatch: fake.dispatch as never, onEvent: fake.onEvent as never, onState: fake.onState as never, onStreaming: fake.onStreaming as never, streaming: fake.streaming as never },
    bus,
    view: ownView(),
    realpath: (path) => path,
    port: { openExternal: vi.fn() },
    log: () => {},
    direct: (deps) => {
      routeDeps = deps;
      return createDirectRoute(deps);
    },
    oauth: (deps) => {
      closeHost = deps.closeHost;
      return provider;
    },
    ...over,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeHost();
  bus = fakeBus();
  me = endableClientRef('page:7');
  closeHost = null;
  routeDeps = null;
  changeListeners = new Set();
  provider = {
    prepare: vi.fn(async () => ({ ok: true, credential: null })),
    unauthorized: vi.fn(),
    state: vi.fn(async () => ({ state: 'connected', connectionId: CONN, refreshable: true })),
    saved: vi.fn(async () => []),
    connect: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(async () => ({ local: 'forgotten', host: 'confirmed', revocation: 'revoked' })),
    disconnecting: vi.fn(() => null),
    retirements: vi.fn(() => []), // P3-F F-connectors 7
    onChange: vi.fn((listener: () => void) => {
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener);
    }), // P3-HD M3c2 correction
    withdrawnUnattributed: vi.fn(() => false),
    hostLost: vi.fn(),
    stop: vi.fn(),
  } as never;
});
afterEach(() => {
  service.stop();
  vi.useRealTimers();
});

async function invoke(name: CommandName, input: unknown): Promise<unknown> {
  const answering = bus.invoke(name, input, me);
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
  const answer = await answering;
  if (!answer.ok) throw new Error(`${name}: ${answer.error.message}`);
  return answer.value;
}

describe('MAWS’s own OAuth beside route D', () => {
  it('prepares route D’s credentials and closes a connection’s epochs in the host with the floor it names', async () => {
    start();
    expect(routeDeps!.credentials).toBe(provider);
    expect(await closeHost!({ connectionId: CONN, credentialEpoch: 4 })).toBe(true);
    expect(fake.dispatched.at(-1)).toEqual({ name: 'connectors.directClose', input: { connectionId: CONN, credentialEpoch: 4 } });
    fake.closeAnswer = false;
    expect(await closeHost!({ connectionId: CONN, credentialEpoch: 5 })).toBe(false); // unconfirmed, never assumed
  });

  it('hears the host leaving ready and main stopping', () => {
    start();
    for (const listener of fake.stateListeners) listener({ state: 'restarting', pid: null, restarts: 1, revision: 2 });
    expect(provider.hostLost).toHaveBeenCalledTimes(1);
    service.stop();
    expect(provider.stop).toHaveBeenCalledTimes(1);
  });

  it('answers the owner’s server rows through the trusted handlers, and Disconnect by id with a targeted invalidation', async () => {
    start();
    const answer = (await invoke('connectors.servers', { artifactId: ART, tools: [{ server: 'notes', tool: 'search' }] })) as { servers: unknown[] };
    expect(answer.servers).toEqual([expect.objectContaining({ kind: 'source', server: 'notes', transport: 'http', connection: { state: 'connected', connectionId: CONN } })]);
    expect(JSON.stringify(answer)).not.toContain('notes.example');
    expect(await invoke('connectors.disconnect', { connectionId: CONN })).toEqual({ accepted: true });
    expect(provider.disconnect).toHaveBeenCalledWith(CONN);
    expect(bus.emittedOf('connectors.serversChanged')).toContainEqual({ artifactId: ART }); // P5 O4 D9: to every client
  });

  // P3-HD M3c2 correction: a provider change (a flow opened, a refresh rejected) reaches the clients, for the rows read
  it('turns the provider’s change notice into the targeted invalidation, and unsubscribes at stop', async () => {
    start();
    await invoke('connectors.servers', { artifactId: ART, tools: [{ server: 'notes', tool: 'search' }] });
    const before = bus.emittedOf('connectors.serversChanged').length;
    for (const listener of changeListeners) listener();
    await vi.advanceTimersByTimeAsync(0);
    expect(bus.emittedOf('connectors.serversChanged').slice(before)).toEqual([{ artifactId: ART }]);
    service.stop();
    expect(changeListeners.size).toBe(0);
  });

  // P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Consent and the client port"): a remote
  // asker's Connect arms the registry the root gave for its client and port, the provider takes the relayed receiver,
  // and `connectors.callback` (main-only: the endpoint's dispatch, under the asking channel's ref) is answered through it
  it('arms a Connect’s callback port in the root’s registry and answers connectors.callback under the asking client alone', async () => {
    const relayed = createRelayedCallbacks();
    start({ relayed });
    const rows = (await invoke('connectors.servers', { artifactId: ART, tools: [{ server: 'notes', tool: 'search' }] })) as { servers: { handle: string }[] };
    let listen: ((handle: (request: { method: string; url: string }) => { status: number; body: string }, options: { state(): string | null }) => Promise<unknown>) | undefined;
    (provider.connect as ReturnType<typeof vi.fn>).mockImplementation(async (_source: unknown, _signal: unknown, _client: unknown, given: typeof listen) => {
      listen = given;
      await given!((request) => ({ status: 200, body: `flow ${request.url}` }), { state: () => 'st' }); // the flow's armed state
      return new Promise(() => {}); // the consent is still open
    });
    (provider.state as ReturnType<typeof vi.fn>).mockResolvedValue({ state: 'needsConnect' });
    expect(await invoke('connectors.connect', { artifactId: ART, sourceHandle: rows.servers[0]!.handle, callback: { port: 61_234 } })).toEqual({ accepted: true });
    for (let i = 0; i < 20 && !listen; i++) await vi.advanceTimersByTimeAsync(0);
    expect(relayed.armed()).toBe(1);
    expect(provider.connect).toHaveBeenCalledWith(expect.objectContaining({ server: 'notes' }), expect.any(AbortSignal), me, expect.any(Function));
    await vi.advanceTimersByTimeAsync(0);
    const asked = await bus.main('connectors.callback', { port: 61_234, method: 'GET', url: '/callback?code=c&state=st' }, me);
    expect(asked).toEqual({ ok: true, value: { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body: 'flow /callback?code=c&state=st' } });
    expect(await bus.main('connectors.callback', { port: 61_234, method: 'GET', url: '/callback?code=c&state=st' }, endableClientRef('remote:other'))).toEqual({ ok: true, value: { status: 404, body: '' } });
    expect(await bus.invoke('connectors.callback', { port: 61_234, method: 'GET', url: '/callback' }, me)).toMatchObject({ ok: false }); // main's alone
  });

  // P5 O7 M5c: an action's end goes to every client with its handle, read or not, so a remote asker's listener ends
  it('says a Connect’s end as serversChanged with its handle, a payload of the wire', async () => {
    start();
    const rows = (await invoke('connectors.servers', { artifactId: ART, tools: [{ server: 'notes', tool: 'search' }] })) as { servers: { handle: string }[] };
    const sourceHandle = rows.servers[0]!.handle;
    (provider.state as ReturnType<typeof vi.fn>).mockResolvedValue({ state: 'needsConnect' });
    (provider.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('the flow failed'));
    expect(await invoke('connectors.connect', { artifactId: ART, sourceHandle })).toEqual({ accepted: true });
    const ends = () => bus.emittedOf('connectors.serversChanged').filter((payload) => 'ended' in (payload as object));
    for (let i = 0; i < 20 && ends().length === 0; i++) await vi.advanceTimersByTimeAsync(0);
    expect(ends()).toEqual([{ artifactId: ART, ended: { sourceHandle } }]);
    expect(validateEventPayload('connectors.serversChanged', ends()[0]).ok).toBe(true);
    expect(bus.emittedOf('connectors.serversChanged')).toContainEqual({ artifactId: ART }); // the rows' invalidation stays
  });

  it('without route D (H’s engine-only service) neither OAuth nor the owner’s server commands exist', () => {
    const oauth = vi.fn();
    start({ direct: undefined, oauth });
    expect(oauth).not.toHaveBeenCalled();
    for (const name of ['connectors.servers', 'connectors.connect', 'connectors.reconnect', 'connectors.disconnect']) expect(bus.registered(), name).not.toContain(name);
  });
});

// P5 O4 M2 (D17; the task review's finding 3): a release of the spine waits for the owner's work, an acknowledged
// Disconnect's forgetting and revocation included
describe('an acknowledged Disconnect', () => {
  it('keeps the part busy until the provider’s disconnect ends, and settles then', async () => {
    const bus = fakeBus();
    let finish!: (result: { local: 'forgotten'; host: 'confirmed'; revocation: 'none' }) => void;
    const oauth = { onChange: () => () => {}, disconnect: () => new Promise((resolve) => (finish = resolve)), stop: () => {} };
    const part = composeConnectors({
      bus,
      hosts: { dispatch: async () => ({ ok: false, error: { code: 'host_unavailable', message: 'none' } }), onEvent: () => () => {}, onState: () => () => {}, onStreaming: () => () => {}, streaming: () => true } as never,
      view: fakeSpineView(),
      port: { openExternal: vi.fn() },
      direct: () => ({ stop() {}, hostLost() {}, reconcile() {} }) as never,
      oauth: () => oauth as never,
      log: () => {},
    });
    service = part; // the file's afterEach stops it
    expect(await bus.invoke('connectors.disconnect', { connectionId: '11111111-1111-4111-8111-111111111111' })).toEqual({ ok: true, value: { accepted: true } });
    expect(part.busy()).toBe(true);
    let settled = false;
    const settling = part.settled().then(() => void (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    finish({ local: 'forgotten', host: 'confirmed', revocation: 'none' });
    await settling;
    expect(part.busy()).toBe(false);
  });
});
