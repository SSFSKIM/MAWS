// P3-H H3b: main's connector service through its registered handlers (docs/doperpowers/plans/2026-10-12-p3-co-work.md,
// P3-H and Decision Log 80, 83, 84 and 85), over a scripted engine host: route E's operation commands (start, the
// id-only end, take, cancel), the owner windows' leases and their targeted watch updates, the store's grant feed and
// the host's restarts. What main dispatched is the evidence that no session was ever launched or acquired.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorCallOutcome } from '@shared/artifacts/connectors';
import { eventChannel, type CommandName, type EventName, type HostState } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import type { MainContext } from '../ipc/router';
import { startConnectors, type ConnectorSender } from '.';

const ART = '11111111-1111-4111-8111-111111111111';
const FP = 'f'.repeat(64);
const ROWS = { server: 'fixture', tool: 'rows' };
const SEND = { server: 'fixture', tool: 'send_document' };
// the only engine-host commands main's connector service may send: reads of what is there, and the store and route E's
const ALLOWED = new Set(['library.entry', 'spaces.list', 'engine.sessions', 'connectors.resolve', 'connectors.check', 'connectors.start', 'connectors.take', 'connectors.cancel', 'connectors.grants', 'connectors.grant', 'connectors.revoke']);

// ── the scripted engine host ──
class FakeHost {
  readonly dispatched: { name: string; input: unknown }[] = [];
  readonly grants = new Map<string, 'read' | 'once'>(); // by tool key
  readonly outcomes = new Map<string, unknown>(); // by operation id, what take answers
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  readonly stateListeners = new Set<(state: HostState) => void>();
  artifact: Record<string, unknown> = { id: ART, kind: 'html', title: 'Live', createdBy: { kind: 'session', appSessionId: 'app-own' }, projectId: 'proj', createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0 };
  live = [{ appSessionId: 'app-own', launchId: 'L1', cwd: '/repo', process: 'ready', lastUsedAt: '2026-10-16T10:00:00.000Z' }];
  readOnly = true;
  endAtStart = false; // the operation's end announced before start's answer
  result: unknown = { content: 'rows 107' };

  dispatch = async (owner: string, name: CommandName, input: unknown) => {
    expect(owner).toBe('engine-host');
    expect(validateCommandInput(name, input).ok, `${name} input`).toBe(true);
    this.dispatched.push({ name, input });
    const value = await this.answer(name, input as Record<string, unknown>);
    expect(validateCommandOutput(name, value).ok, `${name} output`).toBe(true);
    return { ok: true as const, value };
  };
  private async answer(name: string, input: Record<string, unknown>): Promise<unknown> {
    const key = (tool: unknown) => JSON.stringify([(tool as { server: string }).server, (tool as { tool: string }).tool]);
    switch (name) {
      case 'library.entry':
        return { artifact: this.artifact, links: [] };
      case 'spaces.list':
        return { spaces: [] };
      case 'engine.sessions':
        return this.live.map((session) => fullStatus(session));
      case 'connectors.resolve':
        return { ready: true, fingerprint: FP, readOnly: input.tool === 'rows' ? this.readOnly : false };
      case 'connectors.check': {
        const mode = this.grants.get(key(input.call));
        return mode ? { granted: true, mode } : { granted: false, refusal: 'notGranted' };
      }
      case 'connectors.start': {
        const operationId = input.operationId as string;
        this.outcomes.set(operationId, { ok: true, result: this.result });
        if (this.endAtStart) this.emit('connectors.operation', { operationId });
        return { operationId };
      }
      case 'connectors.take': {
        const outcome = this.outcomes.get(input.operationId as string) ?? null;
        this.outcomes.delete(input.operationId as string);
        return { outcome };
      }
      case 'connectors.cancel':
        return { cancelled: this.outcomes.delete(input.operationId as string) };
      case 'connectors.grants':
        return { grants: [...this.grants].map(([k, mode]) => ({ server: JSON.parse(k)[0], tool: JSON.parse(k)[1], fingerprint: FP, mode, grantedAt: 1 })) };
      case 'connectors.grant': {
        const grant = input.grant as { server: string; tool: string; fingerprint: string; mode: 'read' | 'once' };
        this.grants.set(key(grant), grant.mode);
        return { grant: { ...grant, grantedAt: 1 } };
      }
      case 'connectors.revoke':
        return { revoked: this.grants.delete(key(input)) };
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
  emit(name: string, payload: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(payload);
  }
  started(): string[] {
    return this.dispatched.filter((entry) => entry.name === 'connectors.start').map((entry) => (entry.input as { operationId: string }).operationId);
  }
  names(): string[] {
    return this.dispatched.map((entry) => entry.name);
  }
}

function fullStatus(session: { appSessionId: string; launchId: string; cwd: string; process: string; lastUsedAt: string }) {
  return {
    ...session, engineSessionId: null, pid: null, launchedAt: '', taskListId: null, pendingPlan: null, exit: null, engineState: 'idle', activity: null, turn: null,
    model: { requested: null, resolved: null }, effort: null, permissionMode: { requested: 'default', effective: 'default', refusal: null }, prePlanMode: null,
    gateway: { mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'unknown', localLane: null }, subagentModel: null, modelOverrides: {}, engineVersion: null, fileCheckpointing: false, bin: '',
    fastMode: { state: null, disabledReason: null }, plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null, backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0,
    queue: { length: 0, paused: false }, keepAlive: [], busy: false, memory: { rssKiB: null, treeRssKiB: null, sampledAt: null }, journalPath: '', hostHooks: [], lastEventSeq: 0, trust: { attested: false, recorded: null },
  };
}

class FakeSender extends EventEmitter {
  destroyed = false;
  readonly sent: { channel: string; payload: unknown }[] = [];
  constructor(readonly id: number) {
    super();
  }
  isDestroyed = () => this.destroyed;
  send = (channel: string, payload: unknown) => void this.sent.push({ channel, payload });
}

let fake: FakeHost;
let handlers: Map<string, (input: unknown, context: MainContext) => unknown>;
let service: { stop(): void };
let me: FakeSender;
let them: FakeSender;
let records: Map<string, { projectId: string | null; directory: string }>;

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeHost();
  handlers = new Map();
  me = new FakeSender(7);
  them = new FakeSender(8);
  records = new Map([['app-own', { projectId: 'proj', directory: '/repo' }]]);
  service = startConnectors({
    hosts: { dispatch: fake.dispatch as never, onEvent: fake.onEvent as never, onState: fake.onState as never },
    register: ((name: string, handler: (input: unknown, context: MainContext) => unknown) => void handlers.set(name, handler)) as never,
    index: { sessions: { get: (id) => records.get(id) ?? null }, projects: { list: () => [{ id: 'proj', directory: '/repo' }] } },
    realpath: (path) => path,
    log: () => {},
  });
});
afterEach(() => {
  service.stop();
  vi.useRealTimers();
  expect(fake.names().every((name) => ALLOWED.has(name)), fake.names().join(', ')).toBe(true);
});

// A handler called as the router calls it: the input validated, the output checked.
async function invoke(name: CommandName, input: unknown, sender: FakeSender = me): Promise<unknown> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}`);
  const value = await handlers.get(name)!(checked.value, { sender: sender as unknown as MainContext['sender'] });
  expect(validateCommandOutput(name, value).ok, `${name} output: ${JSON.stringify(value)}`).toBe(true);
  return value;
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
};
async function visiblePage(sender: FakeSender = me, tools = [ROWS, SEND]): Promise<string> {
  const { leaseId } = (await invoke('connectors.open', { artifactId: ART }, sender)) as { leaseId: string };
  expect(await invoke('connectors.declare', { leaseId, tools }, sender)).toMatchObject({ ok: true });
  expect(await invoke('connectors.visibility', { leaseId, visible: true }, sender)).toEqual({ ok: true });
  return leaseId;
}
const updatesOf = (sender: FakeSender) => sender.sent.filter((entry) => entry.channel === eventChannel('connectors.watchUpdate')).map((entry) => entry.payload as { leaseId: string; watchId: string; update: ConnectorCallOutcome });

describe('main’s connector service (P3-H H3b)', () => {
  it('runs a page’s call on the eligible live session: start, the id-only end, take; nothing launched or acquired', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: { ...ROWS, args: { series: 'revenue' } } });
    await settle();
    const [operationId] = fake.started();
    expect(fake.dispatched.find((entry) => entry.name === 'connectors.start')!.input).toEqual({ operationId, artifactId: ART, appSessionId: 'app-own', launchId: 'L1', cwd: '/repo', ...ROWS, arguments: { series: 'revenue' }, fingerprint: FP, mode: 'read' });
    fake.emit('connectors.operation', { operationId });
    expect(await answering).toEqual({ ok: true, result: { content: 'rows 107' }, fetchedAt: expect.any(Number), via: { route: 'engine', sessionId: 'app-own' } });
  });

  it('takes an operation whose end was announced before start’s answer', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    fake.endAtStart = true;
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    expect(await answering).toMatchObject({ ok: true, result: { content: 'rows 107' } });
  });

  it('pauses with no route, asking the host nothing about any session, when nothing names the artifact’s directory', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    records.clear(); // the creator's record gone
    fake.artifact = { ...fake.artifact, projectId: undefined };
    delete fake.artifact.projectId;
    const leaseId = await visiblePage();
    expect(await invoke('connectors.call', { leaseId, request: ROWS })).toEqual({ ok: false, state: 'paused', reason: 'noRoute' });
    expect(fake.names()).not.toContain('connectors.resolve');
  });

  it('withdraws an operation from the host when its page hides, answering paused', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    const [operationId] = fake.started();
    await invoke('connectors.visibility', { leaseId, visible: false });
    expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(fake.dispatched.filter((entry) => entry.name === 'connectors.cancel').map((entry) => entry.input)).toEqual([{ operationId }]);
  });

  it('on the owner’s revoke, withdraws the work before the store is asked', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    expect(await invoke('artifacts.revokeConnectorTool', { artifactId: ART, ...ROWS })).toEqual({ revoked: true });
    expect(await answering).toEqual({ ok: false, state: 'revoked', reason: 'revoked' });
    const names = fake.names();
    expect(names.indexOf('connectors.cancel')).toBeGreaterThan(-1);
    expect(names.indexOf('connectors.cancel')).toBeLessThan(names.indexOf('connectors.revoke'));
  });

  it('answers every pending operation when the engine host leaves ready, and resolves afresh after', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    for (const listener of fake.stateListeners) listener({ state: 'restarting', pid: null, restarts: 1, revision: 2 });
    expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'unavailable' });
    const resolvesBefore = fake.names().filter((name) => name === 'connectors.resolve').length;
    const again = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    expect(fake.names().filter((name) => name === 'connectors.resolve').length).toBe(resolvesBefore + 1);
    fake.emit('connectors.operation', { operationId: fake.started().at(-1) });
    expect(await again).toMatchObject({ ok: true });
  });

  it('sends a watch’s refreshes to the window holding its lease alone, validated', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    fake.endAtStart = true;
    const leaseId = await visiblePage(me);
    await visiblePage(them);
    const start = (await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } })) as { ok: true; watchId: string; intervalMs: number };
    expect(start).toEqual({ ok: true, watchId: expect.any(String), intervalMs: 30_000 });
    await settle();
    expect(updatesOf(me)).toEqual([{ leaseId, watchId: start.watchId, update: { ok: true, result: { content: 'rows 107' }, fetchedAt: expect.any(Number), via: { route: 'engine', sessionId: 'app-own' } } }]);
    expect(them.sent).toEqual([]);
    // another window cannot use or stop it
    expect(await invoke('connectors.unwatch', { leaseId, watchId: start.watchId }, them)).toEqual({ stopped: false });
    expect(await invoke('connectors.call', { leaseId, request: ROWS }, them)).toEqual({ ok: false, state: 'invalid', reason: 'lease' });
  });

  for (const ending of ['destroyed', 'did-navigate', 'render-process-gone'] as const) {
    it(`ends a window’s leases and watches when it is ${ending === 'destroyed' ? 'closed' : ending}`, async () => {
      fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
      fake.endAtStart = true;
      const leaseId = await visiblePage();
      await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } });
      await settle();
      const starts = fake.started().length;
      me.emit(ending);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fake.started()).toHaveLength(starts);
      expect(await invoke('connectors.call', { leaseId, request: ROWS })).toEqual({ ok: false, state: 'invalid', reason: 'lease' });
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it('wakes a watch waiting for a grant on the store’s committed grant, and stops nothing on an Allow once’s use', async () => {
    fake.endAtStart = true;
    const leaseId = await visiblePage();
    const { watchId } = (await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } })) as { watchId: string };
    await settle();
    expect(updatesOf(me).map((entry) => entry.update)).toEqual([{ ok: false, state: 'revoked', reason: 'notGranted' }]);
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    fake.emit('connectors.grantChanged', { artifactId: ART, ...ROWS, change: 'granted' });
    await settle();
    expect(updatesOf(me).map((entry) => entry.update.ok)).toEqual([false, true]);
    fake.emit('connectors.grantChanged', { artifactId: ART, ...SEND, change: 'consumed' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(updatesOf(me).map((entry) => entry.update.ok)).toEqual([false, true, true]);
    fake.emit('connectors.grantChanged', { artifactId: ART, ...ROWS, change: 'revoked' }); // a delete, say, from elsewhere
    expect(updatesOf(me).at(-1)).toEqual({ leaseId, watchId, update: { ok: false, state: 'revoked', reason: 'revoked' } });
  });

  it('grants from the header under the route’s fingerprint, refusing a read grant of a tool that may write', async () => {
    expect(await invoke('artifacts.grantConnectorTool', { artifactId: ART, tool: { ...ROWS, mode: 'read' } })).toEqual({ ok: true, grant: { ...ROWS, fingerprint: FP, mode: 'read', grantedAt: 1 } });
    expect(await invoke('artifacts.grantConnectorTool', { artifactId: ART, tool: { ...SEND, mode: 'read' } })).toEqual({ ok: false, state: 'invalid', reason: 'notReadOnly' });
    expect(await invoke('artifacts.grantConnectorTool', { artifactId: ART, tool: { ...SEND, mode: 'once' } })).toMatchObject({ ok: true });
    expect(await invoke('artifacts.connectorGrants', { artifactId: ART })).toEqual({ grants: [expect.objectContaining({ tool: 'rows', mode: 'read' }), expect.objectContaining({ tool: 'send_document', mode: 'once' })] });
    expect(await invoke('artifacts.revokeConnectorTool', { artifactId: ART, ...SEND })).toEqual({ revoked: true });
  });

  it('at stop, answers and withdraws every pending operation and opens no lease again', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    const [operationId] = fake.started();
    service.stop();
    expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'closed' });
    await settle();
    expect(fake.dispatched.filter((entry) => entry.name === 'connectors.cancel').map((entry) => entry.input)).toEqual([{ operationId }]);
    expect(() => handlers.get('connectors.open')!({ artifactId: ART }, { sender: me as unknown as MainContext['sender'] })).toThrow();
  });
});

// the type the service exports for its senders is the subset of WebContents it touches
const _sender: ConnectorSender = new FakeSender(1) as unknown as ConnectorSender;
void _sender;
