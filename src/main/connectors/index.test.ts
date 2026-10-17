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
import { startConnectors, WINDOW_RECHECK_MS, type ConnectorSender, type ConnectorWindow } from '.';
import { CONNECTOR_OPERATION_DEADLINE_MS } from './engine-route';

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

class FakeSender extends EventEmitter {
  destroyed = false;
  readonly sent: { channel: string; payload: unknown }[] = [];
  constructor(readonly id: number) {
    super();
  }
  isDestroyed = () => this.destroyed;
  send = (channel: string, payload: unknown) => void this.sent.push({ channel, payload });
}

// P3-H H4: an owner window as main reads it (shown, minimized) and the events it emits. `hide()` and the rest change
// the state and emit, as Electron's window does when its state changes; a test sets the fields alone for a change no
// event announced (on macOS the window's show and hide events follow its occlusion, not the calls).
class FakeWindow extends EventEmitter {
  visible = true;
  minimized = false;
  destroyed = false;
  isVisible = () => this.visible;
  isMinimized = () => this.minimized;
  isDestroyed = () => this.destroyed;
  hide(): void {
    this.visible = false;
    this.emit('hide');
  }
  show(): void {
    this.visible = true;
    this.emit('show');
  }
  minimize(): void {
    this.minimized = true;
    this.emit('minimize');
  }
  restore(): void {
    this.minimized = false;
    this.emit('restore');
  }
  listeners_(): number {
    return ['show', 'hide', 'minimize', 'restore'].reduce((sum, name) => sum + this.listenerCount(name), 0);
  }
}

let fake: FakeHost;
let handlers: Map<string, (input: unknown, context: MainContext) => unknown>;
let service: { stop(): void };
let me: FakeSender;
let them: FakeSender;
let records: Map<string, { projectId: string | null; directory: string }>;
let windows: Map<number, FakeWindow>; // by its webContents' id: the window that owns it
let logged: string[];

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeHost();
  handlers = new Map();
  me = new FakeSender(7);
  them = new FakeSender(8);
  records = new Map([['app-own', { projectId: 'proj', directory: '/repo' }]]);
  windows = new Map([[7, new FakeWindow()], [8, new FakeWindow()]]);
  logged = [];
  service = startConnectors({
    hosts: { dispatch: fake.dispatch as never, onEvent: fake.onEvent as never, onState: fake.onState as never, onStreaming: fake.onStreaming as never, streaming: fake.streaming as never },
    register: ((name: string, handler: (input: unknown, context: MainContext) => unknown) => void handlers.set(name, handler)) as never,
    index: { sessions: { get: (id) => records.get(id) ?? null }, projects: { list: () => [{ id: 'proj', directory: '/repo' }] } },
    realpath: (path) => path,
    windowOf: (sender) => (windows.get(sender.id) ?? null) as ConnectorWindow | null,
    log: (line) => void logged.push(line),
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
    expect(() => handlers.get('connectors.open')!({ artifactId: ART }, { sender: me as unknown as MainContext['sender'] })).toThrow();
  });
});

// P3-H H4 (P3 Decision Log 80 and 89): main reads the window that owns a page's webContents, when it first follows it,
// on its show, hide, minimize and restore, before any work starts, and every WINDOW_RECHECK_MS while it reads hidden;
// a hidden or minimized window pauses its pages whatever the renderer reports.
describe('the owner window’s native visibility (P3-H H4)', () => {
  const rows = JSON.stringify(['fixture', 'rows']);
  const win = () => windows.get(7)!;
  async function watching(): Promise<{ leaseId: string; watchId: string }> {
    const leaseId = await visiblePage();
    const start = (await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } })) as { watchId: string };
    return { leaseId, watchId: start.watchId };
  }
  beforeEach(() => {
    fake.grants.set(rows, 'read');
    fake.endAtStart = true;
  });

  it('a window hidden when first followed pauses its pages, calling nothing, until it is shown: then one catch-up', async () => {
    win().visible = false;
    const { leaseId, watchId } = await watching();
    expect(await invoke('connectors.call', { leaseId, request: ROWS })).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(await invoke('connectors.refresh', { leaseId, watchId })).toEqual({ refreshing: false });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.names()).not.toContain('connectors.resolve');
    expect(updatesOf(me)).toEqual([]);
    win().show();
    await settle();
    expect(fake.started()).toHaveLength(1);
    expect(updatesOf(me).map((entry) => entry.update)).toEqual([expect.objectContaining({ ok: true })]);
  });

  for (const [away, back] of [['hide', 'show'], ['minimize', 'restore']] as const) {
    it(`on ${away}, withdraws the work in flight and stays silent whatever the renderer says; on ${back}, catches up once`, async () => {
      fake.endAtStart = false;
      const leaseId = await visiblePage();
      const answering = invoke('connectors.call', { leaseId, request: ROWS });
      await settle();
      const [operationId] = fake.started();
      win()[away]();
      expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
      expect(fake.dispatched.filter((entry) => entry.name === 'connectors.cancel').map((entry) => entry.input)).toEqual([{ operationId }]);
      fake.endAtStart = true;
      const { watchId } = (await invoke('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } })) as { watchId: string };
      expect(await invoke('connectors.visibility', { leaseId, visible: true })).toEqual({ ok: true }); // the renderer's report
      const starts = fake.started().length;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fake.started()).toHaveLength(starts);
      expect(updatesOf(me)).toEqual([]);
      win()[back]();
      await settle();
      expect(fake.started()).toHaveLength(starts + 1);
      expect(updatesOf(me)).toEqual([{ leaseId, watchId, update: expect.objectContaining({ ok: true }) }]);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(fake.started()).toHaveLength(starts + 1);
    });
  }

  it('a window shown again does not revive a page whose renderer hid it', async () => {
    const { leaseId } = await watching();
    await settle();
    expect(updatesOf(me)).toHaveLength(1);
    await invoke('connectors.visibility', { leaseId, visible: false });
    win().hide();
    win().show();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.started()).toHaveLength(1);
    expect(updatesOf(me)).toHaveLength(1);
  });

  it('reads the window rather than trusting an event: a hide event while it is still shown changes nothing', async () => {
    await watching();
    await settle();
    win().emit('hide'); // macOS emits show and hide on occlusion changes; the window itself is still shown
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.started()).toHaveLength(2);
  });

  it('hears a hide no event announced before the next refresh, and a show no event announced within its re-read', async () => {
    await watching();
    await settle();
    expect(fake.started()).toHaveLength(1);
    win().visible = false; // hidden, silently
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.started()).toHaveLength(1);
    expect(fake.names().filter((name) => name === 'connectors.resolve')).toHaveLength(1);
    win().visible = true; // shown, silently
    await vi.advanceTimersByTimeAsync(WINDOW_RECHECK_MS + 1); // the re-read, then the refresh it armed
    await settle();
    expect(fake.started()).toHaveLength(2); // the refresh that fell due, once
    expect(updatesOf(me)).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(1); // the watch's next refresh alone: no re-read while shown
  });

  it('a hide no event announced while the route resolves starts no operation', async () => {
    const leaseId = await visiblePage();
    let open!: () => void;
    fake.gates.set('connectors.resolve', new Promise<void>((resolve) => (open = resolve)));
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    expect(fake.names()).toContain('connectors.resolve');
    win().visible = false; // hidden, silently
    open();
    expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    await settle();
    expect(fake.started()).toEqual([]);
  });

  it('a hide no event announced while an operation runs keeps its result from the page', async () => {
    fake.endAtStart = false;
    const leaseId = await visiblePage();
    const answering = invoke('connectors.call', { leaseId, request: ROWS });
    await settle();
    const [operationId] = fake.started();
    win().visible = false; // hidden, silently
    fake.emit('connectors.operation', { operationId }); // its successful outcome, there to take
    expect(await answering).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
  });

  it('keeps the window’s state across a reload of its page, following it once', async () => {
    win().hide();
    await visiblePage();
    me.emit('did-navigate');
    const reloaded = await visiblePage();
    expect(await invoke('connectors.call', { leaseId: reloaded, request: ROWS })).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(win().listeners_()).toBe(4);
    win().show();
    expect(await invoke('connectors.call', { leaseId: reloaded, request: ROWS })).toMatchObject({ ok: true });
  });

  it('when its webContents is destroyed, lets go of the window, its re-reads and its leases, and opens none again', async () => {
    const { leaseId } = await watching();
    await settle();
    win().hide();
    expect(vi.getTimerCount()).toBe(1); // the hidden window's re-read
    me.destroyed = true;
    me.emit('destroyed');
    expect(win().listeners_()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    win().show();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.started()).toHaveLength(1);
    await expect(invoke('connectors.call', { leaseId, request: ROWS })).rejects.toThrow();
    await expect(invoke('connectors.open', { artifactId: ART })).rejects.toThrow();
    expect(win().listeners_()).toBe(0);
  });

  it('fails closed when no window owns the webContents: its pages stay paused, and main says so', async () => {
    windows.delete(7);
    const leaseId = await visiblePage();
    expect(await invoke('connectors.call', { leaseId, request: ROWS })).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(fake.names()).not.toContain('connectors.resolve');
    expect(vi.getTimerCount()).toBe(0);
    expect(logged).toEqual([expect.stringContaining('no window owns')]);
  });

  it('at stop, lets go of every window and its re-reads', async () => {
    await visiblePage(me);
    await visiblePage(them);
    windows.get(8)!.hide();
    service.stop();
    expect([win().listeners_(), windows.get(8)!.listeners_(), vi.getTimerCount()]).toEqual([0, 0, 0]);
    const late = new FakeSender(9); // a window first heard from after the stop is never followed
    windows.set(9, new FakeWindow());
    expect(() => handlers.get('connectors.open')!({ artifactId: ART }, { sender: late as unknown as MainContext['sender'] })).toThrow();
    expect([windows.get(9)!.listeners_(), late.listenerCount('destroyed')]).toEqual([0, 0]);
  });
});

// the type the service exports for its senders is the subset of WebContents it touches
const _sender: ConnectorSender = new FakeSender(1) as unknown as ConnectorSender;
void _sender;
