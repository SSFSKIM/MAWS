// P3-H H3b: the connector service through its registered handlers (docs/doperpowers/plans/2026-10-12-p3-co-work.md,
// P3-H and Decision Log 80, 83, 84 and 85), over a scripted engine host: route E's operation commands (start, the
// id-only end, take, cancel), the clients' leases and their watch updates, the store's grant feed and the host's
// restarts. What the service dispatched is the evidence that no session was ever launched or acquired. P5 O4 M2
// (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D8, D9): composed on a services bus, its clients `ClientRef`s,
// each page's window as the app reports it (`connectors.windowShown`), and a watch's updates emitted to every client.
// Following the Electron window itself is the app's (src/main/connectors/windows.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorCallOutcome } from '@shared/artifacts/connectors';
import { endableClientRef, type EndableClientRef } from '@shared/ipc/client';
import type { CommandName, EventName, HostState } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { composeConnectors } from '.';
import { CONNECTOR_OPERATION_DEADLINE_MS } from './engine-route';
import { project, record } from '../../../test/support/builders';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { fakeSpineView } from '../../../test/support/fake-spine-view';

// P5 O3-C (reader R8): the spine's view, holding the artifact's creator and its project
const ownView = () => fakeSpineView({ records: [record('app-own', { projectId: 'proj' as never, directory: '/repo' })], projects: [project('proj', 0, { directory: '/repo' })] });

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
  readonly streamingListeners = new Set<() => void>();
  streams = true; // past the connection's ready line: its events reach main
  lostAnswers = new Set<string>(); // commands whose effect lands but whose answer never comes back
  readonly gates = new Map<string, Promise<void>>(); // commands answered only once the test opens their gate
  artifact: Record<string, unknown> = { id: ART, kind: 'html', title: 'Live', createdBy: { kind: 'session', appSessionId: 'app-own' }, projectId: 'proj', createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0 };
  live = [{ appSessionId: 'app-own', launchId: 'L1', cwd: '/repo', process: 'ready', lastUsedAt: '2026-10-16T10:00:00.000Z' }];
  readOnly = true;
  endAtStart = false; // the operation's end announced before start's answer
  result: unknown = { content: 'rows 107' };

  dispatch = async (owner: string, name: CommandName, input: unknown) => {
    expect(owner).toBe('engine-host');
    expect(validateCommandInput(name, input).ok, `${name} input`).toBe(true);
    this.dispatched.push({ name, input });
    const gate = this.gates.get(name);
    if (gate) await gate;
    const value = await this.answer(name, input as Record<string, unknown>);
    expect(validateCommandOutput(name, value).ok, `${name} output`).toBe(true);
    if (this.lostAnswers.has(name)) return { ok: false as const, error: { code: 'timeout' as const, message: `${name} unanswered` } };
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
  onStreaming = (_owner: string, listener: () => void) => {
    this.streamingListeners.add(listener);
    return () => void this.streamingListeners.delete(listener);
  };
  streaming = () => this.streams;
  // the host emits: dropped unless the connection streams (X13), as the runtime drops it
  emit(name: string, payload: unknown): void {
    if (!this.streams) return;
    for (const listener of this.listeners.get(name) ?? []) listener(payload);
  }
  startStreaming(): void {
    this.streams = true;
    for (const listener of this.streamingListeners) listener();
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

let fake: FakeHost;
let bus: FakeBus;
let service: { stop(): void };
let me: EndableClientRef;
let them: EndableClientRef;
let view: ReturnType<typeof ownView>;
let leases: Map<string, EndableClientRef>; // which client opened each lease

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeHost();
  bus = fakeBus();
  me = endableClientRef('page:7');
  them = endableClientRef('page:8');
  view = ownView();
  leases = new Map();
  service = composeConnectors({
    hosts: { dispatch: fake.dispatch as never, onEvent: fake.onEvent as never, onState: fake.onState as never, onStreaming: fake.onStreaming as never, streaming: fake.streaming as never },
    bus,
    view,
    realpath: (path) => path,
    port: { openExternal: vi.fn() },
    log: () => {},
  });
});
afterEach(() => {
  service.stop();
  vi.useRealTimers();
  expect(fake.names().every((name) => ALLOWED.has(name)), fake.names().join(', ')).toBe(true);
});

// A command as a client sends it: the input validated, the output checked; a handler's throw rejects.
async function invoke(name: CommandName, input: unknown, client: EndableClientRef = me): Promise<unknown> {
  const answer = name === 'connectors.windowShown' ? await bus.main(name, input, client) : await bus.invoke(name, input, client);
  if (!answer.ok) throw new Error(`${name}: ${answer.error.code} ${answer.error.message}`);
  expect(validateCommandOutput(name, answer.value).ok, `${name} output: ${JSON.stringify(answer.value)}`).toBe(true);
  return answer.value;
}
// P5 O4 D8: the app's report of the window that shows the client's page
const report = (shown: boolean, client: EndableClientRef = me) => invoke('connectors.windowShown', { shown }, client);
const settle = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
};
async function visiblePage(client: EndableClientRef = me, tools = [ROWS, SEND]): Promise<string> {
  await report(true, client);
  const { leaseId } = (await invoke('connectors.open', { artifactId: ART }, client)) as { leaseId: string };
  leases.set(leaseId, client);
  expect(await invoke('connectors.declare', { leaseId, tools }, client)).toMatchObject({ ok: true });
  expect(await invoke('connectors.visibility', { leaseId, visible: true }, client)).toEqual({ ok: true });
  return leaseId;
}
// D9: every update is emitted to every client; a client's are those of the leases it opened
const updatesOf = (client: EndableClientRef) => bus.emittedOf('connectors.watchUpdate').filter((update) => leases.get(update.leaseId) === client) as { leaseId: string; watchId: string; update: ConnectorCallOutcome }[];

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
    view.removeRecord('app-own' as never); // the creator's record gone
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

  it('emits a watch’s refreshes under its lease alone, validated; another client cannot use or stop it', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    fake.endAtStart = true;
    const leaseId = await visiblePage(me);
    await visiblePage(them);
    const start = (await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } })) as { ok: true; watchId: string; intervalMs: number };
    expect(start).toEqual({ ok: true, watchId: expect.any(String), intervalMs: 30_000 });
    await settle();
    expect(updatesOf(me)).toEqual([{ leaseId, watchId: start.watchId, update: { ok: true, result: { content: 'rows 107' }, fetchedAt: expect.any(Number), via: { route: 'engine', sessionId: 'app-own' } } }]);
    expect(updatesOf(them)).toEqual([]);
    // another window cannot use or stop it
    expect(await invoke('connectors.unwatch', { leaseId, watchId: start.watchId }, them)).toEqual({ stopped: false });
    expect(await invoke('connectors.call', { leaseId, request: ROWS }, them)).toEqual({ ok: false, state: 'invalid', reason: 'lease' });
  });

  it('ends a page’s leases and watches when its client ends, and opens none for it again', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
    fake.endAtStart = true;
    const leaseId = await visiblePage();
    await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } });
    await settle();
    const starts = fake.started().length;
    me.end(); // the page closed, navigated or crashed (main), or its page or connection ended (mawsd's front)
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.started()).toHaveLength(starts);
    await expect(invoke('connectors.call', { leaseId, request: ROWS })).rejects.toThrow('the client has ended');
    await expect(invoke('connectors.open', { artifactId: ART })).rejects.toThrow('the client has ended');
    expect(vi.getTimerCount()).toBe(0);
  });

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

  // P3 Decision Log 91: an Allow once's row went with its call, so the artifact's deletion announces no grant; main hears
  // the deletion itself on the store's change feed and withdraws the operation, its outcome taken or not.
  it('on the artifact’s deletion alone, withdraws a call whose ended outcome still awaits main’s take, and one still running', async () => {
    fake.grants.set(JSON.stringify(['fixture', 'send_document']), 'once');
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: SEND });
    await settle();
    const [operationId] = fake.started();
    let open!: () => void;
    fake.gates.set('connectors.take', new Promise<void>((resolve) => (open = resolve)));
    fake.emit('connectors.operation', { operationId }); // ended: main asks for its outcome, not yet answered
    await settle();
    expect(fake.names()).toContain('connectors.take');
    fake.emit('artifacts.changed', { artifactId: '22222222-2222-4222-8222-222222222222', kind: 'html', revision: 1, change: 'deleted' }); // another's
    fake.emit('artifacts.changed', { artifactId: ART, kind: 'html', revision: 1, change: 'updated' });
    await settle();
    expect(fake.names()).not.toContain('connectors.cancel');
    fake.emit('artifacts.changed', { artifactId: ART, kind: 'html', revision: 2, change: 'deleted' });
    expect(await answering).toEqual({ ok: false, state: 'revoked', reason: 'revoked' });
    open(); // the success the take then answers is never published
    await settle();
    expect(fake.dispatched.filter((entry) => entry.name === 'connectors.cancel').map((entry) => entry.input)).toEqual([{ operationId }]);

    fake.gates.delete('connectors.take');
    fake.grants.set(JSON.stringify(['fixture', 'send_document']), 'once');
    const running = invoke('connectors.call', { leaseId, request: SEND });
    await settle();
    const second = fake.started().at(-1)!;
    fake.emit('artifacts.changed', { artifactId: ART, kind: 'html', revision: 3, change: 'deleted' });
    expect(await running).toEqual({ ok: false, state: 'revoked', reason: 'revoked' });
    await settle();
    expect(fake.dispatched.filter((entry) => entry.name === 'connectors.cancel').map((entry) => entry.input)).toEqual([{ operationId }, { operationId: second }]);
    expect(fake.names().filter((name) => name === 'connectors.grants' || name === 'connectors.revoke'), 'no grant row read or revoked to get there').toEqual([]);
  });

  it('grants from the header under the route’s fingerprint, refusing a read grant of a tool that may write', async () => {
    expect(await invoke('artifacts.grantConnectorTool', { artifactId: ART, tool: { ...ROWS, mode: 'read' } })).toEqual({ ok: true, grant: { ...ROWS, fingerprint: FP, mode: 'read', grantedAt: 1 } });
    expect(await invoke('artifacts.grantConnectorTool', { artifactId: ART, tool: { ...SEND, mode: 'read' } })).toEqual({ ok: false, state: 'invalid', reason: 'notReadOnly' });
    expect(await invoke('artifacts.grantConnectorTool', { artifactId: ART, tool: { ...SEND, mode: 'once' } })).toMatchObject({ ok: true });
    expect(await invoke('artifacts.connectorGrants', { artifactId: ART })).toEqual({ grants: [expect.objectContaining({ tool: 'rows', mode: 'read' }), expect.objectContaining({ tool: 'send_document', mode: 'once' })] });
    expect(await invoke('artifacts.revokeConnectorTool', { artifactId: ART, ...SEND })).toEqual({ revoked: true });
  });

  // P3-H H3b fix wave: the host's events reach main only once its connection streams (X13); a dispatch can be answered
  // before, during the connection's resync, and an event emitted then is dropped.
  describe('the streaming boundary', () => {
    it('starts nothing while the connection is not streaming: the call is answered at once, nothing left behind', async () => {
      fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
      const leaseId = await visiblePage();
      fake.streams = false; // ready, resyncing: a start's end could not reach main
      expect(await invoke('connectors.call', { leaseId, request: ROWS })).toEqual({ ok: false, state: 'paused', reason: 'unavailable' });
      expect(fake.names()).not.toContain('connectors.start');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('takes, when the connection starts streaming, an operation whose end was dropped before it', async () => {
      fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
      const leaseId = await visiblePage();
      const answering = invoke('connectors.call', { leaseId, request: ROWS });
      await settle();
      const [operationId] = fake.started();
      fake.streams = false;
      fake.emit('connectors.operation', { operationId }); // dropped
      fake.startStreaming();
      expect(await answering).toMatchObject({ ok: true, result: { content: 'rows 107' } });
    });

    it('a still-running operation found at the reconcile waits for its end, which now arrives', async () => {
      fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
      const leaseId = await visiblePage();
      const answering = invoke('connectors.call', { leaseId, request: ROWS });
      await settle();
      const [operationId] = fake.started();
      const outcome = fake.outcomes.get(operationId);
      fake.outcomes.delete(operationId); // the host still runs it: take answers null
      fake.startStreaming();
      await settle();
      fake.outcomes.set(operationId, outcome);
      fake.emit('connectors.operation', { operationId });
      expect(await answering).toMatchObject({ ok: true });
    });

    it('never waits past the deadline for an end that never comes: takes it, or withdraws it', async () => {
      fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
      const leaseId = await visiblePage();
      const taken = invoke('connectors.call', { leaseId, request: ROWS });
      await settle();
      await vi.advanceTimersByTimeAsync(CONNECTOR_OPERATION_DEADLINE_MS);
      expect(await taken).toMatchObject({ ok: true }); // its outcome was there all along
      const withdrawn = invoke('connectors.call', { leaseId, request: ROWS });
      await settle();
      const operationId = fake.started().at(-1)!;
      fake.outcomes.delete(operationId); // the host forgot it (or runs it still)
      await vi.advanceTimersByTimeAsync(CONNECTOR_OPERATION_DEADLINE_MS);
      expect(await withdrawn).toEqual({ ok: false, state: 'paused', reason: 'unavailable' });
      expect(fake.dispatched.filter((entry) => entry.name === 'connectors.cancel').map((entry) => entry.input)).toEqual([{ operationId }]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('withdraws from the host what it answers when the host leaves ready', async () => {
      fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
      const leaseId = await visiblePage();
      const answering = invoke('connectors.call', { leaseId, request: ROWS });
      await settle();
      const [operationId] = fake.started();
      for (const listener of fake.stateListeners) listener({ state: 'restarting', pid: null, restarts: 1, revision: 2 });
      expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'unavailable' });
      await settle();
      expect(fake.dispatched.filter((entry) => entry.name === 'connectors.cancel').map((entry) => entry.input)).toEqual([{ operationId }]);
    });

    it('a durable grant whose event was dropped wakes its watch at the reconnect, with no new gesture', async () => {
      fake.endAtStart = true;
      const leaseId = await visiblePage();
      await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } });
      await settle();
      expect(updatesOf(me).map((entry) => entry.update)).toEqual([{ ok: false, state: 'revoked', reason: 'notGranted' }]);
      fake.streams = false;
      fake.grants.set(JSON.stringify(['fixture', 'rows']), 'read');
      fake.emit('connectors.grantChanged', { artifactId: ART, ...ROWS, change: 'granted' }); // dropped
      fake.startStreaming();
      await settle();
      expect(updatesOf(me).at(-1)?.update).toMatchObject({ ok: true });
    });

    it('a grant whose own answer was lost wakes its watch on the owner’s Refresh; an absent one stays blocked', async () => {
      fake.endAtStart = true;
      const leaseId = await visiblePage();
      const { watchId } = (await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } })) as { watchId: string };
      await settle();
      // an absent grant: Refresh re-reads it and stays blocked, starting nothing
      expect(await invoke('connectors.refresh', { leaseId, watchId })).toEqual({ refreshing: true });
      await settle();
      expect(updatesOf(me)).toHaveLength(1);
      expect(fake.started()).toEqual([]);
      // the gesture's grant commits, its answer is lost, and the host's event too
      fake.lostAnswers.add('connectors.grant');
      fake.streams = false;
      await expect(invoke('artifacts.grantConnectorTool', { artifactId: ART, tool: { ...ROWS, mode: 'read' } })).rejects.toThrow();
      fake.streams = true; // no reconnect to tell main
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(updatesOf(me)).toHaveLength(1);
      expect(await invoke('connectors.refresh', { leaseId, watchId })).toEqual({ refreshing: true });
      await settle();
      expect(updatesOf(me).at(-1)?.update).toMatchObject({ ok: true });
    });
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
    await expect(invoke('connectors.open', { artifactId: ART })).rejects.toThrow('the connector service has stopped');
    await expect(report(true, endableClientRef('page:9'))).rejects.toThrow('the connector service has stopped');
  });
});

// P3-H H4 (P3 Decision Log 80 and 89), P5 O4 D8: the app reports the window that shows a client's page (shown and not
// minimized, or not) before the page's first lease command and at each change; a hidden or never reported window
// pauses its pages whatever the renderer reports, and a hide stops work in flight before its outcome is published.
describe('the owner window’s native visibility, as the app reports it (P3-H H4; P5 O4 D8)', () => {
  const rows = JSON.stringify(['fixture', 'rows']);
  async function watching(): Promise<{ leaseId: string; watchId: string }> {
    const leaseId = await visiblePage();
    const start = (await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } })) as { watchId: string };
    return { leaseId, watchId: start.watchId };
  }
  beforeEach(() => {
    fake.grants.set(rows, 'read');
    fake.endAtStart = true;
  });

  it('a window reported hidden pauses its pages, calling nothing, until reported shown: then one catch-up', async () => {
    const leaseId = await visiblePage();
    await report(false);
    const { watchId } = (await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } })) as { watchId: string };
    expect(await invoke('connectors.call', { leaseId, request: ROWS })).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(await invoke('connectors.refresh', { leaseId, watchId })).toEqual({ refreshing: false });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.names()).not.toContain('connectors.resolve');
    expect(updatesOf(me)).toEqual([]);
    await report(true);
    await settle();
    expect(fake.started()).toHaveLength(1);
    expect(updatesOf(me).map((entry) => entry.update)).toEqual([expect.objectContaining({ ok: true })]);
  });

  it('fails closed for a page whose window was never reported: its leases stay paused', async () => {
    const { leaseId } = (await invoke('connectors.open', { artifactId: ART }, them)) as { leaseId: string };
    expect(await invoke('connectors.declare', { leaseId, tools: [ROWS] }, them)).toMatchObject({ ok: true });
    expect(await invoke('connectors.visibility', { leaseId, visible: true }, them)).toEqual({ ok: true }); // the renderer's word alone
    expect(await invoke('connectors.call', { leaseId, request: ROWS }, them)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(fake.names()).not.toContain('connectors.resolve');
    expect(vi.getTimerCount()).toBe(0);
    await report(true, them);
    expect(await invoke('connectors.call', { leaseId, request: ROWS }, them)).toMatchObject({ ok: true });
  });

  it('on a hidden report, withdraws the work in flight and stays silent whatever the renderer says; shown again, catches up once', async () => {
    fake.endAtStart = false;
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    const [operationId] = fake.started();
    await report(false);
    expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(fake.dispatched.filter((entry) => entry.name === 'connectors.cancel').map((entry) => entry.input)).toEqual([{ operationId }]);
    fake.endAtStart = true;
    const { watchId } = (await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } })) as { watchId: string };
    expect(await invoke('connectors.visibility', { leaseId, visible: true })).toEqual({ ok: true }); // the renderer's report
    const starts = fake.started().length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.started()).toHaveLength(starts);
    expect(updatesOf(me)).toEqual([]);
    await report(true);
    await settle();
    expect(fake.started()).toHaveLength(starts + 1);
    expect(updatesOf(me)).toEqual([{ leaseId, watchId, update: expect.objectContaining({ ok: true }) }]);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fake.started()).toHaveLength(starts + 1);
  });

  it('a window reported shown again does not revive a page whose renderer hid it', async () => {
    const { leaseId } = await watching();
    await settle();
    expect(updatesOf(me)).toHaveLength(1);
    await invoke('connectors.visibility', { leaseId, visible: false });
    await report(false);
    await report(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.started()).toHaveLength(1);
    expect(updatesOf(me)).toHaveLength(1);
  });

  it('a hidden report while the route resolves starts no operation', async () => {
    const leaseId = await visiblePage();
    let open!: () => void;
    fake.gates.set('connectors.resolve', new Promise<void>((resolve) => (open = resolve)));
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    expect(fake.names()).toContain('connectors.resolve');
    await report(false);
    open();
    expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    await settle();
    expect(fake.started()).toEqual([]);
  });

  it('a hidden report while a watch’s refresh runs keeps its outcome from being published', async () => {
    fake.endAtStart = false;
    const { leaseId } = await watching();
    await settle();
    const [operationId] = fake.started();
    expect(operationId).toBeDefined();
    await report(false);
    fake.emit('connectors.operation', { operationId }); // its successful outcome, there to take
    await settle();
    expect(updatesOf(me)).toEqual([]);
    expect(await invoke('connectors.call', { leaseId, request: ROWS })).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
  });

  it('a reloaded page is a new client: hidden until its window is reported again', async () => {
    await visiblePage();
    me.end();
    const reloaded = endableClientRef('page:7.2');
    const { leaseId } = (await invoke('connectors.open', { artifactId: ART }, reloaded)) as { leaseId: string };
    await invoke('connectors.declare', { leaseId, tools: [ROWS] }, reloaded);
    await invoke('connectors.visibility', { leaseId, visible: true }, reloaded);
    expect(await invoke('connectors.call', { leaseId, request: ROWS }, reloaded)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    await report(true, reloaded);
    expect(await invoke('connectors.call', { leaseId, request: ROWS }, reloaded)).toMatchObject({ ok: true });
  });

  it('forgets a reported window at its client’s end, once, closing the leases it held; a report from it is refused', async () => {
    const { leaseId } = await watching();
    await settle();
    expect(vi.getTimerCount()).toBe(1); // the watch's next refresh
    const onGone = vi.spyOn(me, 'onGone');
    await report(false);
    await report(true);
    expect(onGone).not.toHaveBeenCalled(); // bound once, at the client's first command
    me.end();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.started()).toHaveLength(1);
    await expect(invoke('connectors.call', { leaseId, request: ROWS })).rejects.toThrow('the client has ended');
    await expect(report(true)).rejects.toThrow('the client has ended');
  });
});
