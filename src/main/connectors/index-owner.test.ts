// P3-HD M3c2: main's connector service with MAWS's own OAuth supplied beside route D, as the application's root supplies
// them (src/main/index.ts; Decision Log 14 and 29). The provider prepares route D's credentials and closes host epochs
// through `connectors.directClose` with the floor it names; it hears the host's loss and main's stop; the owner's
// server commands are registered and answer through the trusted handlers. H's engine-only service registers none.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, EventName, HostState } from '@shared/ipc/schema';
import { eventChannel } from '@shared/ipc/schema';
import type { DirectOperationOutcome, DirectSource } from '@shared/ipc/schema/connectors';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { clientOf } from '../ipc/clients';
import type { MainContext } from '../ipc/router';
import { startConnectors, type ConnectorsDeps } from '.';
import { createDirectRoute, type DirectRouteDeps } from './direct-route';
import type { ConnectorOAuthProvider } from './oauth-provider';

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

class FakeSender extends EventEmitter {
  readonly sent: [string, unknown][] = [];
  isDestroyed = () => false;
  send = (channel: string, payload: unknown) => void this.sent.push([channel, payload]);
  constructor(readonly id: number) {
    super();
  }
}

let fake: FakeHost;
let handlers: Map<string, (input: unknown, context: MainContext) => unknown>;
let service: { stop(): void };
let me: FakeSender;
let closeHost: ((target: { connectionId: string; credentialEpoch?: number }) => Promise<boolean>) | null;
let routeDeps: DirectRouteDeps | null;
let provider: ConnectorOAuthProvider;
let changeListeners: Set<() => void>;

function start(over: Partial<ConnectorsDeps> = {}) {
  service = startConnectors({
    hosts: { dispatch: fake.dispatch as never, onEvent: fake.onEvent as never, onState: fake.onState as never, onStreaming: fake.onStreaming as never, streaming: fake.streaming as never },
    register: ((name: string, handler: (input: unknown, context: MainContext) => unknown) => void handlers.set(name, handler)) as never,
    index: { sessions: { get: () => ({ projectId: 'proj', directory: '/repo' }) }, projects: { list: () => [{ id: 'proj', directory: '/repo' }] } },
    realpath: (path) => path,
    windowShown: () => null,
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
  handlers = new Map();
  me = new FakeSender(7);
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
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}`);
  const answer = handlers.get(name)!(checked.value, { client: clientOf(me as never) });
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
  const value = await answer;
  expect(validateCommandOutput(name, value).ok, `${name} output ${JSON.stringify(value)}`).toBe(true);
  return value;
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
    expect(me.sent).toContainEqual([eventChannel('connectors.serversChanged'), { artifactId: ART }]);
  });

  // P3-HD M3c2 correction: a provider change (a flow opened, a refresh rejected) reaches the window that read rows
  it('turns the provider’s change notice into the targeted invalidation, and unsubscribes at stop', async () => {
    start();
    await invoke('connectors.servers', { artifactId: ART, tools: [{ server: 'notes', tool: 'search' }] });
    me.sent.length = 0;
    for (const listener of changeListeners) listener();
    await vi.advanceTimersByTimeAsync(0);
    expect(me.sent).toEqual([[eventChannel('connectors.serversChanged'), { artifactId: ART }]]);
    service.stop();
    expect(changeListeners.size).toBe(0);
  });

  it('without route D (H’s engine-only service) neither OAuth nor the owner’s server commands exist', () => {
    const oauth = vi.fn();
    start({ direct: undefined, oauth });
    expect(oauth).not.toHaveBeenCalled();
    for (const name of ['connectors.servers', 'connectors.connect', 'connectors.reconnect', 'connectors.disconnect']) expect(handlers.has(name), name).toBe(false);
  });
});
