// P3-HD M2c: route D, main's half (src/main/connectors/direct-route.ts; docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md
// M2). A scripted engine host stands in for the direct operation commands (immediate acknowledgments, the id-only
// `connectors.directOperation` end, `directTake`, `directCancel`, `directClose`); no engine, server, client or model is
// started. What main dispatched is the evidence that no session was ever listed, acquired or resumed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorGrantMode } from '@shared/artifacts/connectors';
import type { CommandName } from '@shared/ipc/schema';
import type { DirectCallOutcome, DirectDiscoverAnswer, DirectOperationOutcome, DirectResolveAnswer } from '@shared/ipc/schema/connectors';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { ConnectorBroker } from './broker';
import { createDirectRoute, DIRECT_OPERATION_DEADLINE_MS, DIRECT_RESOLVE_DEADLINE_MS, DIRECT_PENDING_LIMIT, type DirectRoute, type DirectRouteDeps } from './direct-route';
import type { ConnectorGrantAuthority, ConnectorRouteAnswer, ConnectorRouteTarget } from './route';

const ART = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const FP = 'f'.repeat(64);
const ROWS = { server: 'fixture', tool: 'rows' };
const SECRET = 'sentinel-7f3a /Users/owner/.config Bearer abc';

// the only engine-host commands route D may send: reads of what is there, and the direct operation family
const ALLOWED = new Set(['library.entry', 'spaces.list', 'connectors.directResolve', 'connectors.directStart', 'connectors.directDiscover', 'connectors.directTake', 'connectors.directCancel', 'connectors.directClose', 'connectors.directLocate', 'connectors.directSend' /* P4-B5 */]);

const source = (patch: object = {}) => ({ directory: '/repo', sourceId: SOURCE_ID, generation: 3, server: 'fixture', scope: 'user' as const, transport: 'stdio' as const, path: `${SECRET}/.claude.json`, entryPath: ['mcpServers', 'fixture'], observedAt: '2026-10-17T00:00:00.000Z', ...patch });
const ready = (patch: { readOnly?: boolean; tool?: false } = {}): DirectOperationOutcome => ({
  kind: 'resolve',
  answer: { ready: true, source: source(), ...(patch.tool === false ? {} : { tool: { fingerprint: FP, readOnly: patch.readOnly ?? true } }) },
});
const notReady = (why: Extract<DirectResolveAnswer, { ready: false }>['why']): DirectOperationOutcome => ({ kind: 'resolve', answer: { ready: false, why } });
const called = (outcome: DirectCallOutcome): DirectOperationOutcome => ({ kind: 'call', outcome });

type Dispatched = { name: string; input: Record<string, unknown> };

// ── the scripted engine host ──
class FakeHost {
  readonly dispatched: Dispatched[] = [];
  readonly outcomes = new Map<string, DirectOperationOutcome>(); // by operation id, what directTake answers (once)
  readonly gates = new Map<string, Promise<void>>(); // commands answered only once the test opens their gate
  streams = true;
  failing = new Set<string>(); // commands that answer a failure
  rejecting = new Set<string>(); // commands whose dispatch rejects
  route!: DirectRoute;
  artifact: Record<string, unknown> = { id: ART, kind: 'html', title: 'Live', createdBy: { kind: 'session', appSessionId: 'app-own' }, projectId: 'proj', createdAt: 0, updatedAt: 0, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 0 };
  spaces: Record<string, unknown>[] = [];
  creator: { projectId: string | null; directory: string } | null = { projectId: 'proj', directory: '/repo' };
  project: { id: string; directory: string }[] = [{ id: 'proj', directory: '/repo' }];

  call: DirectRouteDeps['call'] = async (name, input) => {
    expect(ALLOWED.has(name), `${name} is not a route D command`).toBe(true);
    expect(validateCommandInput(name as CommandName, input).ok, `${name} input`).toBe(true);
    this.dispatched.push({ name, input: input as Record<string, unknown> });
    const value = this.answer(name, input as Record<string, unknown>); // read when asked; delivered once the gate opens
    const gate = this.gates.get(name);
    if (gate) await gate;
    if (this.rejecting.has(name)) throw new Error(`${SECRET} dispatch broke`);
    if (this.failing.has(name)) return { ok: false, error: { code: 'internal', message: `${name} refused` } } as never;
    expect(validateCommandOutput(name as CommandName, value).ok, `${name} output`).toBe(true);
    return { ok: true, value } as never;
  };
  private answer(name: string, input: Record<string, unknown>): unknown {
    switch (name) {
      case 'library.entry':
        return { artifact: this.artifact, links: [] };
      case 'spaces.list':
        return { spaces: this.spaces };
      case 'connectors.directResolve':
      case 'connectors.directStart':
      case 'connectors.directDiscover':
      case 'connectors.directLocate': // P4-B5
      case 'connectors.directSend': // P4-B5
        return { operationId: input.operationId };
      case 'connectors.directTake': {
        const id = input.operationId as string;
        const outcome = this.outcomes.get(id) ?? null;
        this.outcomes.delete(id);
        return { outcome };
      }
      case 'connectors.directCancel':
        return { cancelled: true };
      case 'connectors.directClose':
        return { cancelled: 0 };
      default:
        throw new Error(`unscripted ${name}`);
    }
  }
  of(name: string): Dispatched[] {
    return this.dispatched.filter((entry) => entry.name === name);
  }
  last(name: string): Dispatched {
    const found = this.of(name).at(-1);
    if (!found) throw new Error(`${name} was not dispatched`);
    return found;
  }
  // The host's operation ended: its outcome is held for take, and its end announced (id only).
  finish(operationId: string, outcome: DirectOperationOutcome, announce = true): void {
    this.outcomes.set(operationId, outcome);
    if (announce) this.route.operationEnded(operationId);
  }
}

let host: FakeHost;
let route: DirectRoute;
let log: ReturnType<typeof vi.fn<(line: string) => void>>;

function makeRoute(): DirectRoute {
  return createDirectRoute({
    call: host.call,
    sessions: { get: (id) => (id === 'app-own' ? host.creator : null) },
    projects: { list: () => host.project },
    realpath: (path) => path,
    streaming: () => host.streams,
    log,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  host = new FakeHost();
  log = vi.fn<(line: string) => void>();
  route = makeRoute();
  host.route = route;
});
afterEach(() => {
  route.stop();
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(0);
const signalOf = () => new AbortController();
const discloses = (value: unknown) => JSON.stringify(value).includes('sentinel-7f3a');

// resolve() answered by the scripted host with `outcome`
async function resolveWith(outcome: DirectOperationOutcome, controller = signalOf()): Promise<ConnectorRouteTarget | null> {
  const pending = route.resolve(ART, ROWS, controller.signal);
  await settle();
  host.finish(host.last('connectors.directResolve').input.operationId as string, outcome);
  return pending;
}
async function target(outcome: DirectOperationOutcome = ready()): Promise<ConnectorRouteTarget> {
  const found = await resolveWith(outcome);
  if (!found) throw new Error('no target');
  return found;
}
const context = (controller = signalOf(), mode: ConnectorGrantMode = 'read') => ({ signal: controller.signal, fingerprint: FP, mode });

describe('resolve (metadata only, immediately acknowledged)', () => {
  it('registers the operation, dispatches directResolve with main’s canonical directories and answers the typed result from the event and take', async () => {
    const SPACE = '33333333-3333-4333-8333-333333333333';
    host.spaces = [{ id: SPACE, name: 'Docs', linkedDir: '/docs', createdAt: 0 }];
    host.artifact = { ...host.artifact, spaceId: SPACE };
    const controller = signalOf();
    let answered: ConnectorRouteTarget | null | undefined;
    void route.resolve(ART, ROWS, controller.signal).then((value) => (answered = value));
    await settle();
    const sent = host.last('connectors.directResolve').input;
    expect(sent).toMatchObject({ artifactId: ART, directories: ['/repo', '/docs'], server: 'fixture', tool: 'rows' });
    expect(answered).toBeUndefined(); // the acknowledgment alone answers nothing
    host.finish(sent.operationId as string, ready());
    await settle();
    expect(answered).toMatchObject({ fingerprint: FP, readOnly: true });
    expect(answered).not.toHaveProperty('sessionId');
    expect(host.of('connectors.directTake')).toHaveLength(1);
  });

  it('never lists, acquires or starts an engine, and sends no start before the broker’s check', async () => {
    await target();
    expect(host.dispatched.map((entry) => entry.name)).toEqual(['library.entry', 'connectors.directResolve', 'connectors.directTake']);
    expect(host.of('connectors.directStart')).toHaveLength(0);
  });

  it('is no route (null) with no canonical directory, without asking the host to resolve', async () => {
    host.creator = null;
    host.project = [];
    expect(await route.resolve(ART, ROWS, signalOf().signal)).toBeNull();
    expect(host.of('connectors.directResolve')).toHaveLength(0);
  });

  it('is no route for an artifact the host does not know', async () => {
    host.artifact = null as never;
    expect(await route.resolve(ART, ROWS, signalOf().signal)).toBeNull();
    expect(host.of('connectors.directResolve')).toHaveLength(0);
  });

  it('is no route while the host’s events cannot reach main (the end could not be heard)', async () => {
    host.streams = false;
    expect(await route.resolve(ART, ROWS, signalOf().signal)).toBeNull();
    expect(host.of('connectors.directResolve')).toHaveLength(0);
  });

  it.each(['unobserved', 'ambiguous', 'engineOnly', 'unidentified', 'changed', 'unattested', 'unresolved', 'unavailable', 'toolMissing'] as const)('a %s source is no route, logged by its closed word alone', async (why) => {
    expect(await resolveWith(notReady(why))).toBeNull();
    expect(log.mock.calls.flat().join('\n')).toContain(why);
    expect(discloses(log.mock.calls)).toBe(false);
  });

  it('an answer naming no tool is no route; a tool’s read-only annotation reaches the broker as reported', async () => {
    expect(await resolveWith(ready({ tool: false }))).toBeNull();
    expect((await target(ready({ readOnly: false }))).readOnly).toBe(false);
    expect((await target(ready({ readOnly: true }))).readOnly).toBe(true);
  });

  it('an operation answered with another kind of outcome is no route', async () => {
    expect(await resolveWith({ kind: 'discover', answer: { ok: true, tools: [] } })).toBeNull();
  });

  it('a refused or throwing directResolve is no route, and withdraws what the host may have kept', async () => {
    host.failing.add('connectors.directResolve');
    expect(await route.resolve(ART, ROWS, signalOf().signal)).toBeNull();
    expect(host.of('connectors.directCancel')).toHaveLength(1);
    host.failing.clear();
    host.rejecting.add('connectors.directResolve');
    expect(await route.resolve(ART, ROWS, signalOf().signal)).toBeNull();
    expect(discloses(log.mock.calls)).toBe(false);
  });

  it('a resolve past its 8 s bound takes the outcome once more, else withdraws the operation and is no route', async () => {
    const pending = route.resolve(ART, ROWS, signalOf().signal);
    await settle();
    const id = host.last('connectors.directResolve').input.operationId as string;
    await vi.advanceTimersByTimeAsync(DIRECT_RESOLVE_DEADLINE_MS - 1);
    expect(host.of('connectors.directTake')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(host.of('connectors.directTake')).toHaveLength(1);
    expect(host.last('connectors.directCancel').input).toEqual({ operationId: id });
  });

  it('a resolve whose end the events dropped is found by the deadline’s take', async () => {
    const pending = route.resolve(ART, ROWS, signalOf().signal);
    await settle();
    host.finish(host.last('connectors.directResolve').input.operationId as string, ready(), false);
    await vi.advanceTimersByTimeAsync(DIRECT_RESOLVE_DEADLINE_MS);
    expect(await pending).toMatchObject({ fingerprint: FP });
    expect(host.of('connectors.directCancel')).toHaveLength(0);
  });

  it('an abort answers no route at once and withdraws the operation', async () => {
    const controller = signalOf();
    const pending = route.resolve(ART, ROWS, controller.signal);
    await settle();
    const id = host.last('connectors.directResolve').input.operationId as string;
    controller.abort();
    expect(await pending).toBeNull();
    expect(host.last('connectors.directCancel').input).toEqual({ operationId: id });
    host.finish(id, ready()); // a late end is ignored
    await settle();
  });

  it('an already aborted resolve sends nothing', async () => {
    const controller = signalOf();
    controller.abort();
    expect(await route.resolve(ART, ROWS, controller.signal)).toBeNull();
    expect(host.of('connectors.directResolve')).toHaveLength(0);
  });
});

describe('a creator’s directories (the canonical decision route E shares)', () => {
  it('a creator filed elsewhere falls back to the row’s project; a deleted record too; a vanished directory is no route', async () => {
    host.creator = { projectId: 'other', directory: '/other' };
    void route.resolve(ART, ROWS, signalOf().signal);
    await settle();
    expect(host.last('connectors.directResolve').input.directories).toEqual(['/repo']);
    host.creator = null;
    void route.resolve(ART, ROWS, signalOf().signal);
    await settle();
    expect(host.of('connectors.directResolve')[1]!.input.directories).toEqual(['/repo']);
    const gone = createDirectRoute({ call: host.call, sessions: { get: () => host.creator }, projects: { list: () => host.project }, realpath: () => null, streaming: () => true, log });
    expect(await gone.resolve(ART, ROWS, signalOf().signal)).toBeNull();
    gone.stop();
  });

  it('a creator working in a worktree sends that worktree, never the project root', async () => {
    host.creator = { projectId: 'proj', directory: '/repo/.claude/worktrees/feature' };
    void route.resolve(ART, ROWS, signalOf().signal);
    await settle();
    expect(host.last('connectors.directResolve').input.directories).toEqual(['/repo/.claude/worktrees/feature']);
  });
});

describe('call (one submission, bound to the target main selected)', () => {
  it('registers before start, sends the resolved source and the admitted grant, and answers the result unchanged', async () => {
    const found = await target();
    const pending = found.call({ q: 1 }, context());
    await settle();
    const start = host.last('connectors.directStart').input;
    expect(start).toEqual({ operationId: expect.any(String), artifactId: ART, directory: '/repo', sourceId: SOURCE_ID, generation: 3, server: 'fixture', tool: 'rows', arguments: { q: 1 }, fingerprint: FP, mode: 'read' });
    host.finish(start.operationId as string, called({ ok: true, result: { rows: 107 } }));
    expect(await pending).toEqual({ ok: true, result: { rows: 107 } });
    expect(host.of('connectors.directStart')).toHaveLength(1);
  });

  it('sends the fingerprint and mode main’s check admitted, not the resolution’s', async () => {
    const found = await target();
    const admitted = 'a'.repeat(64);
    void found.call({}, { signal: signalOf().signal, fingerprint: admitted, mode: 'once' });
    await settle();
    expect(host.last('connectors.directStart').input).toMatchObject({ fingerprint: admitted, mode: 'once' });
  });

  it('an end announced before the start’s acknowledgment is not lost', async () => {
    const found = await target();
    let release!: () => void;
    host.gates.set('connectors.directStart', new Promise<void>((resolve) => (release = resolve)));
    const pending = found.call({}, context());
    await settle();
    host.finish(host.last('connectors.directStart').input.operationId as string, called({ ok: true, result: 'early' }));
    expect(await pending).toEqual({ ok: true, result: 'early' });
    release();
    await settle();
    expect(host.of('connectors.directCancel')).toHaveLength(0); // answered: nothing to withdraw
  });

  it('a start only while the host’s events stream; refused before anything is sent', async () => {
    const found = await target();
    host.streams = false;
    expect(await found.call({}, context())).toEqual({ ok: false, failure: 'unavailable', message: expect.stringContaining('not streaming') });
    expect(host.of('connectors.directStart')).toHaveLength(0);
  });

  it('a start that fails or throws is unavailable and withdraws the operation, without disclosing the error', async () => {
    const found = await target();
    host.failing.add('connectors.directStart');
    expect(await found.call({}, context())).toMatchObject({ ok: false, failure: 'unavailable' });
    host.failing.clear();
    host.rejecting.add('connectors.directStart');
    const second = await found.call({}, context());
    expect(second).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(host.of('connectors.directCancel')).toHaveLength(2);
    expect(discloses(second)).toBe(false);
    expect(discloses(log.mock.calls)).toBe(false);
  });

  it('maps the host’s failures to fixed codes and closed words, never a message from elsewhere', async () => {
    const found = await target();
    const cases: [DirectCallOutcome, ConnectorRouteAnswer][] = [
      [{ ok: false, failure: 'unavailable', reason: 'connection' }, { ok: false, failure: 'unavailable', message: 'direct: connection' }],
      [{ ok: false, failure: 'unavailable', reason: 'source', sourceRefusal: 'changed' }, { ok: false, failure: 'unavailable', message: 'direct: source (changed)' }],
      [{ ok: false, failure: 'failed', reason: 'transport' }, { ok: false, failure: 'failed', message: 'direct: transport' }],
      [{ ok: false, failure: 'tooLarge', reason: 'tooLarge' }, { ok: false, failure: 'tooLarge', message: 'direct: tooLarge' }],
      [{ ok: false, failure: 'refused', refusal: 'revoked', reason: 'grant' }, { ok: false, failure: 'refused', refusal: 'revoked', message: 'direct: grant' }],
      [{ ok: false, failure: 'refused', refusal: 'fingerprintChanged', reason: 'grant' }, { ok: false, failure: 'refused', refusal: 'fingerprintChanged', message: 'direct: grant' }],
    ];
    for (const [outcome, expected] of cases) {
      const pending = found.call({}, context());
      await settle();
      host.finish(host.last('connectors.directStart').input.operationId as string, called(outcome));
      expect(await pending).toEqual(expected);
    }
  });

  it('an operation answered with another kind of outcome is unavailable', async () => {
    const found = await target();
    const pending = found.call({}, context());
    await settle();
    host.finish(host.last('connectors.directStart').input.operationId as string, ready());
    expect(await pending).toMatchObject({ ok: false, failure: 'unavailable' });
  });

  it('an end the host kept no outcome for is a failure, not a resubmission', async () => {
    const found = await target();
    const pending = found.call({}, context());
    await settle();
    host.route.operationEnded(host.last('connectors.directStart').input.operationId as string); // taken already, expired
    expect(await pending).toMatchObject({ ok: false, failure: 'failed' });
    expect(host.of('connectors.directStart')).toHaveLength(1);
  });

  it('an end announced twice, or with a reconcile racing it, answers once and takes the outcome once', async () => {
    const found = await target();
    const pending = found.call({}, context());
    await settle();
    const id = host.last('connectors.directStart').input.operationId as string;
    host.finish(id, called({ ok: true, result: 1 }));
    host.route.operationEnded(id);
    route.reconcile();
    expect(await pending).toEqual({ ok: true, result: 1 });
    await settle();
    expect(host.of('connectors.directStart')).toHaveLength(1);
  });

  it('streaming again reconciles a call whose end was dropped; one still running announces its end', async () => {
    const found = await target();
    const pending = found.call({}, context());
    await settle();
    const id = host.last('connectors.directStart').input.operationId as string;
    route.reconcile(); // nothing yet: still running, nothing settled, nothing withdrawn
    await settle();
    expect(host.of('connectors.directCancel')).toHaveLength(0);
    host.finish(id, called({ ok: true, result: 'late' }), false); // the end was dropped
    route.reconcile();
    expect(await pending).toEqual({ ok: true, result: 'late' });
  });

  it('a end that arrives while a reconcile take is still running is not lost', async () => {
    const found = await target();
    const pending = found.call({}, context());
    await settle();
    const id = host.last('connectors.directStart').input.operationId as string;
    let release!: () => void;
    host.gates.set('connectors.directTake', new Promise<void>((resolve) => (release = resolve)));
    route.reconcile(); // its take is held
    await settle();
    host.finish(id, called({ ok: true, result: 'between' }));
    release();
    expect(await pending).toEqual({ ok: true, result: 'between' });
  });

  it('a call past its 180 s deadline takes the outcome, else withdraws and answers unavailable', async () => {
    const found = await target();
    const pending = found.call({}, context());
    await settle();
    const id = host.last('connectors.directStart').input.operationId as string;
    await vi.advanceTimersByTimeAsync(DIRECT_OPERATION_DEADLINE_MS);
    expect(await pending).toMatchObject({ ok: false, failure: 'unavailable', message: expect.stringContaining('deadline') });
    expect(host.last('connectors.directCancel').input).toEqual({ operationId: id });
    const second = found.call({}, context());
    await settle();
    host.finish(host.last('connectors.directStart').input.operationId as string, called({ ok: true, result: 'in time' }), false);
    await vi.advanceTimersByTimeAsync(DIRECT_OPERATION_DEADLINE_MS);
    expect(await second).toEqual({ ok: true, result: 'in time' });
  });

  it('an abort answers cancelled at once, withdraws the host’s operation and ignores a late end', async () => {
    const found = await target();
    const controller = signalOf();
    const pending = found.call({}, context(controller));
    await settle();
    const id = host.last('connectors.directStart').input.operationId as string;
    controller.abort();
    expect(await pending).toEqual({ ok: false, failure: 'unavailable', message: 'cancelled' });
    expect(host.last('connectors.directCancel').input).toEqual({ operationId: id });
    host.finish(id, called({ ok: true, result: 'late' }));
    await settle();
    expect(host.of('connectors.directStart')).toHaveLength(1);
  });

  it('an already aborted call sends no start', async () => {
    const found = await target();
    const controller = signalOf();
    controller.abort();
    expect(await found.call({}, context(controller))).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(host.of('connectors.directStart')).toHaveLength(0);
  });

  it('the host leaving ready, main stopping and an explicit close each answer every pending operation', async () => {
    const found = await target();
    const pendings = [found.call({}, context()), found.call({}, context())];
    await settle();
    route.hostLost();
    expect(await Promise.all(pendings)).toEqual([expect.objectContaining({ ok: false, failure: 'unavailable' }), expect.objectContaining({ ok: false, failure: 'unavailable' })]);
    expect(host.of('connectors.directCancel')).toHaveLength(2);

    const stopping = found.call({}, context());
    await settle();
    route.stop();
    expect(await stopping).toMatchObject({ ok: false, failure: 'unavailable', message: 'main is stopping' });

    route = makeRoute();
    host.route = route;
    const closing = (await target()).call({}, context());
    await settle();
    await route.close();
    expect(await closing).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(host.last('connectors.directClose').input).toEqual({});
  });

  it('a failed or rejected directTake withdraws the operation from the host, which may still run it', async () => {
    const found = await target();
    for (const mode of ['failing', 'rejecting'] as const) {
      const pending = found.call({}, context());
      await settle();
      const id = host.last('connectors.directStart').input.operationId as string;
      const cancels = host.of('connectors.directCancel').length;
      host[mode].add('connectors.directTake');
      route.reconcile(); // the host still runs it; the take cannot say
      expect(await pending).toMatchObject({ ok: false, failure: 'unavailable' });
      await settle();
      expect(host.of('connectors.directCancel')).toHaveLength(cancels + 1);
      expect(host.last('connectors.directCancel').input).toEqual({ operationId: id });
      host[mode].delete('connectors.directTake');
    }
    expect(discloses(log.mock.calls)).toBe(false);
  });

  it('stop is terminal: metadata still being gathered, a target resolved before it and a discovery start nothing afterwards', async () => {
    const found = await target();
    let release!: () => void;
    host.gates.set('library.entry', new Promise<void>((resolve) => (release = resolve)));
    const resolving = route.resolve(ART, ROWS, signalOf().signal);
    await settle();
    route.stop();
    release();
    expect(await resolving).toBeNull();
    expect(await found.call({}, context())).toEqual({ ok: false, failure: 'unavailable', message: 'main is stopping' });
    expect(await route.discover(source(), signalOf().signal)).toMatchObject({ ok: false });
    host.gates.clear();
    expect(await route.resolve(ART, ROWS, signalOf().signal)).toBeNull();
    expect(host.of('connectors.directResolve')).toHaveLength(1); // the first target’s alone
    expect(host.of('connectors.directStart')).toHaveLength(0);
    expect(host.of('connectors.directDiscover')).toHaveLength(0);
  });

  it('the host leaving ready is temporary: the next resolution and call work', async () => {
    route.hostLost();
    const found = await target();
    const pending = found.call({}, context());
    await settle();
    host.finish(host.last('connectors.directStart').input.operationId as string, called({ ok: true, result: 'back' }));
    expect(await pending).toEqual({ ok: true, result: 'back' });
  });

  it('close answers what is pending, reports whether the host confirmed it, and leaves the route usable', async () => {
    expect(await route.close()).toEqual({ ok: true, cancelled: 0 });
    host.failing.add('connectors.directClose');
    expect(await route.close()).toEqual({ ok: false, why: 'directClose failed' });
    host.failing.clear();
    host.rejecting.add('connectors.directClose');
    expect(await route.close()).toEqual({ ok: false, why: 'directClose failed' });
    host.rejecting.clear();
    const found = await target(); // a close is not stop: later work still runs
    const pending = found.call({}, context());
    await settle();
    host.finish(host.last('connectors.directStart').input.operationId as string, called({ ok: true, result: 'after' }));
    expect(await pending).toEqual({ ok: true, result: 'after' });
    expect(discloses(log.mock.calls)).toBe(false);
  });

  it('a call is never retried or switched: one admitted call is exactly one directStart whatever happens after', async () => {
    const found = await target();
    const pending = found.call({}, context());
    await settle();
    route.hostLost();
    await pending;
    route.reconcile();
    await vi.advanceTimersByTimeAsync(DIRECT_OPERATION_DEADLINE_MS * 2);
    expect(host.of('connectors.directStart')).toHaveLength(1);
  });

  it('bounds the operations it keeps: past the limit it refuses a call and a resolve before dispatching', async () => {
    const found = await target();
    const pendings: Promise<ConnectorRouteAnswer>[] = [];
    for (let index = 0; index < DIRECT_PENDING_LIMIT; index += 1) pendings.push(found.call({}, context()));
    await settle();
    const before = host.dispatched.length;
    expect(await found.call({}, context())).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(await route.resolve(ART, ROWS, signalOf().signal)).toBeNull();
    expect(host.dispatched.length).toBe(before);
    route.stop();
    await Promise.all(pendings);
  });
});

describe('the owner’s discovery (typed answer through the same operation machinery)', () => {
  it('resolves the source alone, then discovers its tools without a call', async () => {
    const pending = route.resolveSource(ART, 'fixture', signalOf().signal);
    await settle();
    const sent = host.last('connectors.directResolve').input;
    expect(sent).not.toHaveProperty('tool');
    host.finish(sent.operationId as string, ready({ tool: false }));
    const found = await pending;
    expect(found).toMatchObject({ ok: true, source: { sourceId: SOURCE_ID, transport: 'stdio' } });
    const answer: DirectDiscoverAnswer = { ok: true, tools: [{ name: 'rows', readOnly: true }] };
    const discovery = route.discover((found as { ok: true; source: ReturnType<typeof source> }).source, signalOf().signal);
    await settle();
    const start = host.last('connectors.directDiscover').input;
    expect(start).toEqual({ operationId: expect.any(String), directory: '/repo', sourceId: SOURCE_ID, generation: 3, server: 'fixture' });
    host.finish(start.operationId as string, { kind: 'discover', answer });
    expect(await discovery).toEqual(answer);
    expect(host.of('connectors.directStart')).toHaveLength(0);
  });

  it('a refused source resolution says why in a closed word; a lost discovery is a fixed failure', async () => {
    const pending = route.resolveSource(ART, 'fixture', signalOf().signal);
    await settle();
    host.finish(host.last('connectors.directResolve').input.operationId as string, notReady('engineOnly'));
    expect(await pending).toEqual({ ok: false, why: 'engineOnly' });
    const discovery = route.discover(source(), signalOf().signal);
    await settle();
    route.hostLost();
    expect(await discovery).toEqual({ ok: false, failure: 'unavailable', reason: 'connection' });
  });
});

// The unchanged broker over route D alone: a direct success carries `route: 'direct'` and no sessionId.
describe('through the broker', () => {
  it('a direct call is one submission, via route direct with no session, under the grant fingerprint', async () => {
    const checks: unknown[] = [];
    const grants: ConnectorGrantAuthority = {
      list: async () => [],
      grant: async () => {
        throw new Error('unused');
      },
      revoke: async () => false,
      check: async (_artifactId, call) => {
        checks.push(call);
        return { granted: true, mode: 'read' };
      },
    };
    const broker = new ConnectorBroker({ routes: [route], grants, log });
    broker.setWindowShown('w', true);
    const lease = broker.open('w', ART);
    broker.declareTools('w', lease, [ROWS]);
    broker.setVisible('w', lease, true);
    const outcome = broker.callTool('w', lease, ROWS);
    await settle();
    host.finish(host.last('connectors.directResolve').input.operationId as string, ready());
    await settle();
    expect(checks).toHaveLength(1);
    expect(host.of('connectors.directStart')).toHaveLength(1);
    host.finish(host.last('connectors.directStart').input.operationId as string, called({ ok: true, result: { rows: 1 } }));
    const answered = await outcome;
    expect(answered).toEqual({ ok: true, result: { rows: 1 }, fetchedAt: Date.now(), via: { route: 'direct' } });
    expect(host.dispatched.map((entry) => entry.name).filter((name) => name.startsWith('connectors.direct') && name !== 'connectors.directTake')).toEqual(['connectors.directResolve', 'connectors.directStart']);
    broker.stop();
  });
});

// P4-B5: the owner's delivery (route D's `locate` and `send`): operations like a call's, no grant, no resolution of the
// artifact's directories, never an engine
describe('P4-B5: locate and send for the owner’s delivery', () => {
  it('locates through the host’s operation, answering the sources its take carries', async () => {
    const pending = route.locate('notion-create-pages', ['mcp.notion.com'], signalOf().signal);
    await settle();
    const sent = host.last('connectors.directLocate').input;
    expect(sent).toMatchObject({ tool: 'notion-create-pages', urlHosts: ['mcp.notion.com'] });
    host.finish(sent.operationId as string, { kind: 'locate', answer: { sources: [source()] } });
    expect(await pending).toEqual([source()]);
    expect(host.dispatched.map((entry) => entry.name)).toEqual(['connectors.directLocate', 'connectors.directTake']);
  });

  it('answers null when the location outlives its deadline', async () => {
    const pending = route.locate('notion-create-pages', [], signalOf().signal);
    await settle();
    await vi.advanceTimersByTimeAsync(DIRECT_RESOLVE_DEADLINE_MS);
    expect(await pending).toBeNull();
  });

  it('sends one directSend on the source with the arguments as given, and answers the host’s typed outcome', async () => {
    const pending = route.send(source(), { artifactId: ART, tool: 'notion-create-pages', arguments: { pages: [{ content: 'x' }] } }, signalOf().signal);
    await settle();
    const sent = host.last('connectors.directSend').input;
    expect(sent).toMatchObject({ artifactId: ART, directory: '/repo', sourceId: SOURCE_ID, generation: 3, server: 'fixture', tool: 'notion-create-pages', arguments: { pages: [{ content: 'x' }] } });
    expect(sent).not.toHaveProperty('credential'); // a stdio source has none
    host.finish(sent.operationId as string, called({ ok: true, result: { content: [] } }));
    expect(await pending).toEqual({ ok: true, result: { content: [] } });
    expect(host.of('connectors.directStart')).toHaveLength(0);
    expect(host.of('library.entry')).toHaveLength(0);
  });

  it('a send withdrawn by its signal before the host answers is cancelled there, and answers lost', async () => {
    const controller = signalOf();
    const pending = route.send(source(), { artifactId: ART, tool: 't', arguments: {} }, controller.signal);
    await settle();
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: 'lost', sent: true }); // its command had gone out
    expect(host.of('connectors.directCancel')).toHaveLength(1);
  });

  it('a send that never reached the host says so, and names a credential that could not be prepared', async () => {
    host.streams = false;
    expect(await route.send(source(), { artifactId: ART, tool: 't', arguments: {} }, signalOf().signal)).toMatchObject({ ok: false, reason: 'lost', sent: false });
    host.streams = true;
    const refusing = createDirectRoute({ call: host.call, sessions: { get: () => null }, projects: { list: () => [] }, realpath: (path) => path, streaming: () => true, log, credentials: { prepare: async () => ({ ok: false }), unauthorized: () => {} } });
    expect(await refusing.send(source({ transport: 'http', resourceUrl: 'https://mcp.example.com/mcp' }), { artifactId: ART, tool: 't', arguments: {} }, signalOf().signal)).toEqual({ ok: false, failure: 'unavailable', reason: 'lost', message: 'no credential could be prepared', sent: false, credential: false });
    expect(host.of('connectors.directSend')).toHaveLength(0);
    refusing.stop();
  });
});
