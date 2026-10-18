// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): main's connector service with the dataset sink,
// through its registered handlers over a scripted engine host whose every dispatch is validated against the registry.
// A window's call forwards the owner's sink to route E's start; the host's phased take (`publishing` while it
// publishes, the metadata after the publication's end) answers the window. An agent's refresh is heard by its id alone, read,
// run through the asking session's own engine with no lease, and answered on the main-only reply; a request already
// gone is left alone.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, EventName } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import type { MainContext } from '../ipc/router';
import { startConnectors, type ConnectorWindow } from '.';

const ART = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const FP = 'f'.repeat(64);
const META = { status: 'dataset', artifactId: ART, id: 'live', revision: 5, columns: [{ name: 'v', type: 'number' }], rows: 2 };
const status = (appSessionId: string, launchId: string) => ({ appSessionId, launchId, cwd: '/repo', process: 'ready', lastUsedAt: '2026-10-17T00:00:00.000Z' });

class FakeHost {
  readonly dispatched: { name: string; input: Record<string, unknown> }[] = [];
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  takes: ('publishing' | Record<string, unknown>)[] = []; // what each `connectors.take` answers, in order (none left: H's null)
  request: Record<string, unknown> | null = { artifactId: ART, datasetId: 'live', baseRevision: 4, appSessionId: 'app-asker', server: 'fixture', tool: 'rows', args: { series: 'revenue' } };
  granted = true;
  dispatch = async (owner: string, name: CommandName, input: Record<string, unknown>) => {
    expect(owner).toBe('engine-host');
    expect(validateCommandInput(name, input).ok, `${name} input ${JSON.stringify(input)}`).toBe(true);
    this.dispatched.push({ name, input });
    const value = this.answer(name, input);
    expect(validateCommandOutput(name, value).ok, `${name} output`).toBe(true);
    return { ok: true as const, value };
  };
  private answer(name: string, input: Record<string, unknown>): unknown {
    switch (name) {
      case 'library.entry':
        return { artifact: { id: ART, kind: 'dashboard', title: 'Live', createdBy: { kind: 'session', appSessionId: 'app-own' }, projectId: 'proj', createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0 }, links: [] };
      case 'spaces.list':
        return { spaces: [] };
      case 'engine.sessions':
        return [status('app-own', 'L1'), status('app-asker', 'L2')].map(fullStatus);
      case 'connectors.resolve':
        return { ready: true, fingerprint: FP, readOnly: true };
      case 'connectors.check':
        return this.granted ? { granted: true, mode: 'read' } : { granted: false, refusal: 'notGranted' };
      case 'connectors.start':
        queueMicrotask(() => this.emit('connectors.operation', { operationId: input.operationId }));
        return { operationId: input.operationId };
      case 'connectors.take': {
        const next = this.takes.shift() ?? { outcome: null };
        if (next !== 'publishing') return next;
        queueMicrotask(() => this.emit('connectors.operation', { operationId: input.operationId })); // its publication's end
        return { outcome: null, dataset: { status: 'publishing', operationId: input.operationId } };
      }
      case 'connectors.cancel':
        return { cancelled: true };
      case 'artifacts.datasetRefreshRequest':
        return { request: input.requestId === REQUEST ? this.request : null };
      case 'maws.artifact.datasetRefreshed':
        return { outcome: 'delivered' };
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
  onState = (): (() => void) => () => {};
  onStreaming = (): (() => void) => () => {};
  streaming = () => true;
  emit(name: string, payload: unknown): void {
    expect(validateEventPayload(name as EventName, payload).ok, `${name} payload`).toBe(true);
    for (const listener of this.listeners.get(name) ?? []) listener(payload);
  }
  sent(name: string) {
    return this.dispatched.filter((entry) => entry.name === name).map((entry) => entry.input);
  }
}

function fullStatus(session: ReturnType<typeof status>) {
  return {
    ...session, engineSessionId: null, pid: null, launchedAt: '', taskListId: null, pendingPlan: null, exit: null, engineState: 'idle', activity: null, turn: null,
    model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null }, prePlanMode: null,
    gateway: { mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'unknown', localLane: null }, subagentModel: null, modelOverrides: {}, engineVersion: null, fileCheckpointing: false, bin: '',
    fastMode: { state: null, disabledReason: null }, plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null, backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0,
    queue: { length: 0, paused: false }, keepAlive: [], busy: false, memory: { rssKiB: null, treeRssKiB: null, sampledAt: null }, journalPath: '', hostHooks: [], lastEventSeq: 0, trust: { attested: false, recorded: null },
  };
}

class FakeSender extends EventEmitter {
  readonly id = 7;
  isDestroyed = () => false;
  send = () => {};
}
class FakeWindow extends EventEmitter {
  isVisible = () => true;
  isMinimized = () => false;
  isDestroyed = () => false;
}

let fake: FakeHost;
let handlers: Map<string, (input: unknown, context: MainContext) => unknown>;
let service: { stop(): void };
const sender = new FakeSender();
beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeHost();
  handlers = new Map();
  service = startConnectors({
    hosts: { dispatch: fake.dispatch as never, onEvent: fake.onEvent as never, onState: fake.onState as never, onStreaming: fake.onStreaming as never, streaming: fake.streaming as never },
    register: ((name: string, handler: (input: unknown, context: MainContext) => unknown) => void handlers.set(name, handler)) as never,
    index: { sessions: { get: () => ({ projectId: 'proj', directory: '/repo' }) }, projects: { list: () => [{ id: 'proj', directory: '/repo' }] } },
    realpath: (path) => path,
    windowOf: () => new FakeWindow() as unknown as ConnectorWindow,
    log: () => {},
  });
});
afterEach(() => {
  service.stop();
  vi.useRealTimers();
});
async function invoke(name: CommandName, input: unknown): Promise<unknown> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}`);
  const value = await handlers.get(name)!(checked.value, { sender: sender as unknown as MainContext['sender'] });
  expect(validateCommandOutput(name, value).ok, `${name} output: ${JSON.stringify(value)}`).toBe(true);
  return value;
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
};

describe('main’s connector service with a dataset sink', () => {
  it('forwards a window’s sink to route E’s start and answers the publication’s metadata after the host’s phased take', async () => {
    const { leaseId } = (await invoke('connectors.open', { artifactId: ART })) as { leaseId: string };
    await invoke('connectors.declare', { leaseId, tools: [{ server: 'fixture', tool: 'rows' }] });
    await invoke('connectors.visibility', { leaseId, visible: true });
    fake.takes = ['publishing', { outcome: null, dataset: META }];
    const answer = invoke('connectors.call', { leaseId, request: { server: 'fixture', tool: 'rows', args: { series: 'revenue' } }, dataset: { id: 'live', baseRevision: 4 } });
    await settle();
    expect(await answer).toMatchObject({ ok: true, result: META });
    expect(fake.sent('connectors.start')).toEqual([expect.objectContaining({ dataset: { id: 'live', baseRevision: 4 }, mode: 'read' })]);
    expect(fake.sent('connectors.take')).toHaveLength(2);
  });

  it('runs an agent’s refresh heard by its id alone in the asking session’s engine, and answers on the main-only reply', async () => {
    fake.takes = ['publishing', { outcome: null, dataset: META }];
    fake.emit('maws.artifact.datasetRefresh', { requestId: REQUEST });
    await settle();
    expect(fake.sent('artifacts.datasetRefreshRequest')).toEqual([{ requestId: REQUEST }]);
    expect(fake.sent('library.entry')).toEqual([]); // no eligibility walk: the asking session alone
    expect(fake.sent('connectors.resolve')).toEqual([{ appSessionId: 'app-asker', launchId: 'L2', cwd: '/repo', server: 'fixture', tool: 'rows' }]);
    expect(fake.sent('connectors.start')).toEqual([expect.objectContaining({ appSessionId: 'app-asker', arguments: { series: 'revenue' }, dataset: { id: 'live', baseRevision: 4, requestId: REQUEST } })]);
    expect(fake.sent('maws.artifact.datasetRefreshed')).toEqual([{ requestId: REQUEST, outcome: { ok: true } }]);
    expect(fake.sent('connectors.open')).toEqual([]);
  });

  it('answers a refusal with its closed reason, and leaves a request already gone alone', async () => {
    fake.granted = false;
    fake.emit('maws.artifact.datasetRefresh', { requestId: REQUEST });
    await settle();
    expect(fake.sent('connectors.start')).toEqual([]);
    expect(fake.sent('maws.artifact.datasetRefreshed')).toEqual([{ requestId: REQUEST, outcome: { ok: false, state: 'revoked', reason: 'notGranted' } }]);
    fake.emit('maws.artifact.datasetRefresh', { requestId: '33333333-3333-4333-8333-333333333333' });
    await settle();
    expect(fake.sent('maws.artifact.datasetRefreshed')).toHaveLength(1);
  });

  // E3 panel wave (Decision Log 17): the owner's probe of a dataset watch reaches the broker as liveness alone
  it('forwards a probe of a dataset watch: true and no start; without it, H’s forced refresh starts one', async () => {
    const { leaseId } = (await invoke('connectors.open', { artifactId: ART })) as { leaseId: string };
    await invoke('connectors.declare', { leaseId, tools: [{ server: 'fixture', tool: 'rows' }] });
    await invoke('connectors.visibility', { leaseId, visible: true });
    fake.takes = ['publishing', { outcome: null, dataset: META }];
    const start = (await invoke('connectors.watch', { leaseId, request: { server: 'fixture', tool: 'rows', args: { series: 'revenue' }, intervalMs: 60_000 }, dataset: { id: 'live' } })) as { ok: true; watchId: string };
    await settle();
    expect(fake.sent('connectors.start')).toHaveLength(1); // its first refresh, ended
    expect(await invoke('connectors.refresh', { leaseId, watchId: start.watchId, probe: true })).toEqual({ refreshing: true });
    await settle();
    expect(fake.sent('connectors.start')).toHaveLength(1);
    fake.takes = ['publishing', { outcome: null, dataset: META }];
    expect(await invoke('connectors.refresh', { leaseId, watchId: start.watchId })).toEqual({ refreshing: true });
    await settle();
    expect(fake.sent('connectors.start')).toHaveLength(2);
  });
});
