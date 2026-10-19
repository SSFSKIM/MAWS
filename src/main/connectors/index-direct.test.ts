// P3-HD M4 (composition brought forward): main's connector service with direct-route support supplied, as the
// application's root supplies it (src/main/index.ts; Decision Log 14). H's own service tests (./index.test.ts) are the
// engine-only fixture and stay unchanged. Here the same service over a scripted engine host: route E first, route D
// after it; engine preferred at selection; D's events, streaming, host-loss and stop wired; no engine ever launched,
// acquired or listed on D's behalf.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, EventName, HostState } from '@shared/ipc/schema';
import { eventChannel } from '@shared/ipc/schema';
import type { DirectOperationOutcome } from '@shared/ipc/schema/connectors';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import type { MainContext } from '../ipc/router';
import { startConnectors, type ConnectorWindow } from '.';
import { createDirectRoute } from './direct-route';

const ART = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const FP = 'f'.repeat(64);
const ROWS = { server: 'fixture', tool: 'rows' };
const KEY = JSON.stringify(['fixture', 'rows']);

class FakeHost {
  readonly dispatched: { name: string; input: Record<string, unknown> }[] = [];
  readonly directOutcomes = new Map<string, DirectOperationOutcome>(); // what directTake answers, once
  readonly engineOutcomes = new Map<string, unknown>();
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  readonly stateListeners = new Set<(state: HostState) => void>();
  readonly streamingListeners = new Set<() => void>();
  readonly grants = new Map<string, 'read' | 'once'>();
  streams = true;
  live: ReturnType<typeof liveSession>[] = [];
  artifact = { id: ART, kind: 'html', title: 'Live', createdBy: { kind: 'session', appSessionId: 'app-own' }, projectId: 'proj', createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0 };

  dispatch = async (owner: string, name: CommandName, input: unknown) => {
    expect(owner).toBe('engine-host');
    expect(validateCommandInput(name, input).ok, `${name} input`).toBe(true);
    const fields = input as Record<string, unknown>;
    this.dispatched.push({ name, input: fields });
    const value = this.answer(name, fields);
    expect(validateCommandOutput(name, value).ok, `${name} output: ${JSON.stringify(value)}`).toBe(true);
    return { ok: true as const, value };
  };
  private answer(name: string, input: Record<string, unknown>): unknown {
    switch (name) {
      case 'library.entry':
        return { artifact: this.artifact, links: [] };
      case 'spaces.list':
        return { spaces: [] };
      case 'engine.sessions':
        return this.live.map((session) => fullStatus(session));
      case 'connectors.resolve':
        return { ready: true, fingerprint: FP, readOnly: true };
      case 'connectors.check': {
        const mode = this.grants.get(KEY);
        return mode ? { granted: true, mode } : { granted: false, refusal: 'notGranted' };
      }
      case 'connectors.start':
        this.engineOutcomes.set(input.operationId as string, { ok: true, result: { from: 'engine' } });
        return { operationId: input.operationId };
      case 'connectors.take': {
        const outcome = this.engineOutcomes.get(input.operationId as string) ?? null;
        this.engineOutcomes.delete(input.operationId as string);
        return { outcome };
      }
      case 'connectors.cancel':
        return { cancelled: this.engineOutcomes.delete(input.operationId as string) };
      case 'connectors.directResolve':
        this.directOutcomes.set(input.operationId as string, {
          kind: 'resolve',
          answer: { ready: true, source: { directory: '/repo', sourceId: SOURCE_ID, generation: 1, server: 'fixture', scope: 'user', transport: 'stdio', path: '/h/.claude.json', entryPath: ['mcpServers', 'fixture'], observedAt: '2026-10-17T00:00:00.000Z' }, tool: { fingerprint: FP, readOnly: true } },
        });
        queueMicrotask(() => this.emit('connectors.directOperation', { operationId: input.operationId })); // the end follows the acknowledgment
        return { operationId: input.operationId };
      case 'connectors.directStart':
        this.directStarted.push(input.operationId as string);
        return { operationId: input.operationId };
      case 'connectors.directTake': {
        const outcome = this.directOutcomes.get(input.operationId as string) ?? null;
        this.directOutcomes.delete(input.operationId as string);
        return { outcome };
      }
      case 'connectors.directCancel':
        return { cancelled: true };
      default:
        throw new Error(`unexpected ${name}`);
    }
  }
  readonly directStarted: string[] = [];
  finishDirect(result: unknown, announce = true): void {
    const operationId = this.directStarted.at(-1)!;
    this.directOutcomes.set(operationId, { kind: 'call', outcome: { ok: true, result: result as never } });
    if (announce) this.emit('connectors.directOperation', { operationId });
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
  onStreaming = (_owner: string, listener: () => void) => {
    this.streamingListeners.add(listener);
    return () => void this.streamingListeners.delete(listener);
  };
  streaming = () => this.streams;
  emit(name: string, payload: unknown): void {
    if (!this.streams) return; // dropped unless the connection streams (X13)
    for (const listener of this.listeners.get(name) ?? []) listener(payload);
  }
  startStreaming(): void {
    this.streams = true;
    for (const listener of this.streamingListeners) listener();
  }
  names(): string[] {
    return this.dispatched.map((entry) => entry.name);
  }
  count(name: string): number {
    return this.names().filter((entry) => entry === name).length;
  }
}

const liveSession = (appSessionId: string, cwd: string) => ({ appSessionId, launchId: `L-${appSessionId}`, cwd, process: 'ready', lastUsedAt: '2026-10-16T10:00:00.000Z' });
function fullStatus(session: ReturnType<typeof liveSession>) {
  return {
    ...session, engineSessionId: null, pid: null, launchedAt: '', taskListId: null, pendingPlan: null, exit: null, engineState: 'idle', activity: null, turn: null,
    model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null }, prePlanMode: null,
    gateway: { mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'unknown', localLane: null }, subagentModel: null, modelOverrides: {}, engineVersion: null, fileCheckpointing: false, bin: '',
    fastMode: { state: null, disabledReason: null }, plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null, backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0,
    queue: { length: 0, paused: false }, keepAlive: [], busy: false, memory: { rssKiB: null, treeRssKiB: null, sampledAt: null }, journalPath: '', hostHooks: [], lastEventSeq: 0, trust: { attested: false, recorded: null },
  };
}

class FakeSender extends EventEmitter {
  readonly sent: [string, unknown][] = [];
  isDestroyed = () => false;
  send = (channel: string, payload: unknown) => void this.sent.push([channel, payload]);
  constructor(readonly id: number) {
    super();
  }
}
class FakeWindow extends EventEmitter {
  isVisible = () => true;
  isMinimized = () => false;
  isDestroyed = () => false;
}

let fake: FakeHost;
let handlers: Map<string, (input: unknown, context: MainContext) => unknown>;
let service: { stop(): void };
let me: FakeSender;
let logged: string[];

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeHost();
  fake.grants.set(KEY, 'read');
  handlers = new Map();
  me = new FakeSender(7);
  logged = [];
  service = startConnectors({
    hosts: { dispatch: fake.dispatch as never, onEvent: fake.onEvent as never, onState: fake.onState as never, onStreaming: fake.onStreaming as never, streaming: fake.streaming as never },
    register: ((name: string, handler: (input: unknown, context: MainContext) => unknown) => void handlers.set(name, handler)) as never,
    index: { sessions: { get: (id) => (id === 'app-own' ? { projectId: 'proj', directory: '/repo' } : null) }, projects: { list: () => [{ id: 'proj', directory: '/repo' }] } },
    realpath: (path) => path,
    windowOf: () => new FakeWindow() as unknown as ConnectorWindow,
    log: (line) => void logged.push(line),
    direct: createDirectRoute,
  });
});
afterEach(() => {
  service.stop();
  vi.useRealTimers();
});

async function invoke(name: CommandName, input: unknown): Promise<unknown> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}`);
  return handlers.get(name)!(checked.value, { sender: me as unknown as MainContext['sender'] });
}
const settle = async () => {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
};
async function visiblePage(): Promise<string> {
  const { leaseId } = (await invoke('connectors.open', { artifactId: ART })) as { leaseId: string };
  await invoke('connectors.declare', { leaseId, tools: [ROWS] });
  await invoke('connectors.visibility', { leaseId, visible: true });
  return leaseId;
}

describe('route D composed after route E', () => {
  it('serves through the direct route when no engine is eligible: no engine launched or acquired, no sessionId', async () => {
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: { ...ROWS, args: { q: 1 } } });
    await settle();
    expect(fake.dispatched.find((entry) => entry.name === 'connectors.directResolve')!.input).toMatchObject({ artifactId: ART, directories: ['/repo'], ...ROWS });
    expect(fake.dispatched.find((entry) => entry.name === 'connectors.directStart')!.input).toMatchObject({ artifactId: ART, directory: '/repo', sourceId: SOURCE_ID, ...ROWS, arguments: { q: 1 }, fingerprint: FP, mode: 'read' });
    fake.finishDirect({ rows: 107 });
    expect(await answering).toEqual({ ok: true, result: { rows: 107 }, fetchedAt: expect.any(Number), via: { route: 'direct' } });
    // E was asked first and found none; D started nothing in the engine
    expect(fake.names()).not.toContain('connectors.start');
    expect(fake.count('connectors.directStart')).toBe(1);
  });

  it('prefers the engine at selection: with an eligible engine the direct route is never asked', async () => {
    fake.live = [liveSession('app-own', '/repo')];
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    const operationId = fake.dispatched.find((entry) => entry.name === 'connectors.start')!.input.operationId;
    fake.emit('connectors.operation', { operationId });
    expect(await answering).toMatchObject({ ok: true, result: { from: 'engine' }, via: { route: 'engine', sessionId: 'app-own' } });
    expect(fake.names().filter((name) => name.startsWith('connectors.direct'))).toEqual([]);
  });

  it('does not switch or retry an admitted direct call when an engine appears; the next call picks the engine', async () => {
    const leaseId = await visiblePage();
    const first = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    fake.live = [liveSession('app-own', '/repo')]; // the engine appears while the direct call runs
    fake.finishDirect('direct result');
    expect(await first).toMatchObject({ ok: true, result: 'direct result', via: { route: 'direct' } });
    expect(fake.count('connectors.start')).toBe(0);
    const second = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    fake.emit('connectors.operation', { operationId: fake.dispatched.find((entry) => entry.name === 'connectors.start')!.input.operationId });
    expect(await second).toMatchObject({ via: { route: 'engine' } });
    expect(fake.count('connectors.directStart')).toBe(1);
    expect(fake.count('connectors.start')).toBe(1);
  });

  it('reconciles a direct call whose end the events dropped once the connection streams again', async () => {
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    fake.streams = false; // the connection resyncs: an end announced now is dropped
    fake.finishDirect('late', true);
    await settle();
    fake.startStreaming();
    expect(await answering).toMatchObject({ ok: true, result: 'late', via: { route: 'direct' } });
    expect(fake.count('connectors.directStart')).toBe(1);
  });

  it('answers a pending direct call and withdraws it when the engine host leaves ready, then resolves afresh', async () => {
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    const [started] = fake.directStarted;
    for (const listener of fake.stateListeners) listener({ state: 'restarting', pid: null, restarts: 1, revision: 2 });
    expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'unavailable' });
    expect(fake.dispatched.filter((entry) => entry.name === 'connectors.directCancel').map((entry) => entry.input)).toContainEqual({ operationId: started });
    const again = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    fake.finishDirect('afresh');
    expect(await again).toMatchObject({ ok: true, result: 'afresh' });
    expect(fake.count('connectors.directResolve')).toBe(2);
  });

  it('stopping the service withdraws a pending direct call from the host and starts no more', async () => {
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    const [started] = fake.directStarted;
    service.stop();
    expect(await answering).toMatchObject({ ok: false });
    expect(fake.dispatched.filter((entry) => entry.name === 'connectors.directCancel').map((entry) => entry.input)).toContainEqual({ operationId: started });
    expect(fake.count('connectors.directStart')).toBe(1);
  });

  // P3-F F-connectors 9: rows read during an outage (sources unavailable) are read again once the host streams again
  it('invalidates the owner’s rows when the connection streams again after the host’s loss', async () => {
    await invoke('connectors.servers', { artifactId: ART, tools: [ROWS] });
    for (const listener of fake.stateListeners) listener({ state: 'restarting', pid: null, restarts: 1, revision: 2 });
    expect(me.sent).toContainEqual([eventChannel('connectors.serversChanged'), { artifactId: ART }]);
    me.sent.length = 0;
    fake.startStreaming();
    expect(me.sent).toEqual([[eventChannel('connectors.serversChanged'), { artifactId: ART }]]);
  });
});
