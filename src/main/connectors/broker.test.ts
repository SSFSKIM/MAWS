// P3-H H3a: main's connector broker (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24, 80
// and 83; P3-E's XE8). Fake routes and a fake grant authority stand in for the engine and direct routes and the host's
// store; the clock is vitest's fake one, so a ten-minute silence is ten minutes of timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTOR_DECLARE_LIMIT,
  CONNECTOR_WATCH_LIMIT,
  CONNECTOR_WATCH_MAX_MS,
  CONNECTOR_WATCH_MIN_MS,
  type ConnectorAuthorization,
  type ConnectorCallOutcome,
  type ConnectorCallRef,
  type ConnectorGrant,
  type ConnectorGrantMode,
  type ConnectorGrantRequest,
  type ConnectorRouteName,
  type ConnectorToolRef,
} from '@shared/artifacts/connectors';
import { ConnectorBroker } from './broker';
import type { ConnectorGrantAuthority, ConnectorRoute, ConnectorRouteAnswer, ConnectorRouteCallContext, ConnectorRouteTarget } from './route';

const ART = 'dash-1';
const OTHER_ART = 'dash-2';
const ME = 'window-1';
const THEM = 'window-2';
const ROWS: ConnectorToolRef = { server: 'fixture', tool: 'rows' };
const SEND: ConnectorToolRef = { server: 'fixture', tool: 'send_document' };
const MIN = 60_000;
// Words a route or the store might carry (a path, a header): never to reach a page's answer (P3 Decision Log 84).
const SECRET = 'sentinel-7f3a /Users/owner/.config Bearer abc';
const discloses = (value: unknown) => JSON.stringify(value).includes('sentinel-7f3a');

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const grantKey = (artifactId: string, ref: ConnectorToolRef) => JSON.stringify([artifactId, ref.server, ref.tool]);

class FakeGrants implements ConnectorGrantAuthority {
  readonly rows = new Map<string, ConnectorGrant>();
  readonly checks: [string, ConnectorCallRef][] = [];
  revokeGate: Promise<void> | null = null;
  checkGate: Promise<void> | null = null;
  checkThrows = false;

  put(artifactId: string, ref: ConnectorToolRef, fingerprint: string, mode: ConnectorGrantMode): void {
    this.rows.set(grantKey(artifactId, ref), { ...ref, fingerprint, mode, grantedAt: Date.now() });
  }
  async list(artifactId: string): Promise<ConnectorGrant[]> {
    return [...this.rows.entries()].filter(([key]) => JSON.parse(key)[0] === artifactId).map(([, grant]) => grant);
  }
  async grant(artifactId: string, request: ConnectorGrantRequest): Promise<ConnectorGrant> {
    this.put(artifactId, request, request.fingerprint, request.mode);
    return this.rows.get(grantKey(artifactId, request))!;
  }
  async revoke(artifactId: string, ref: ConnectorToolRef): Promise<boolean> {
    if (this.revokeGate) await this.revokeGate;
    return this.rows.delete(grantKey(artifactId, ref));
  }
  // Reads the grant when asked and answers it once `checkGate` opens: a snapshot that may be stale by then.
  async check(artifactId: string, call: ConnectorCallRef): Promise<ConnectorAuthorization> {
    this.checks.push([artifactId, call]);
    const grant = this.rows.get(grantKey(artifactId, call));
    const decision: ConnectorAuthorization = !grant
      ? { granted: false, refusal: 'notGranted' }
      : grant.fingerprint !== call.fingerprint
        ? { granted: false, refusal: 'fingerprintChanged' }
        : { granted: true, mode: grant.mode };
    if (this.checkGate) await this.checkGate;
    if (this.checkThrows) throw new Error(`${SECRET} store unreachable`);
    return decision;
  }
}

interface FakeTool {
  fingerprint: string;
  readOnly: boolean;
}
interface RouteCall {
  tool: ConnectorToolRef;
  args: Record<string, unknown>;
  context: ConnectorRouteCallContext;
  answer: Deferred<ConnectorRouteAnswer>;
}

// A route that has what `tools` holds, already live; it can be asked to resolve and to call, nothing else.
class FakeRoute implements ConnectorRoute {
  readonly tools = new Map<string, FakeTool>();
  readonly calls: RouteCall[] = [];
  resolves = 0;
  hold = false; // calls wait for the test to answer them
  answer: (call: RouteCall) => ConnectorRouteAnswer = (call) => ({ ok: true, result: { rows: [this.calls.indexOf(call) + 1] } });
  target: (tool: FakeTool) => unknown = (tool) => tool;
  resolveThrows = false;
  resolveGate: Promise<void> | null = null; // resolves wait for the test to open it

  constructor(readonly route: ConnectorRouteName, readonly sessionId?: string) {}

  has(ref: ConnectorToolRef, tool: Partial<FakeTool> = {}): this {
    this.tools.set(JSON.stringify([ref.server, ref.tool]), { fingerprint: 'fp-1', readOnly: true, ...tool });
    return this;
  }
  async resolve(_artifactId: string, ref: ConnectorToolRef): Promise<ConnectorRouteTarget | null> {
    this.resolves += 1;
    if (this.resolveGate) await this.resolveGate;
    if (this.resolveThrows) throw new Error(`${SECRET} route broke`);
    const tool = this.tools.get(JSON.stringify([ref.server, ref.tool]));
    if (!tool) return null;
    const shape = this.target(tool) as ConnectorRouteTarget;
    return {
      ...shape,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
      call: (args, context) => {
        const call: RouteCall = { tool: ref, args, context, answer: deferred() };
        this.calls.push(call);
        if (!this.hold) call.answer.resolve(this.answer(call));
        return call.answer.promise;
      },
    };
  }
  last(): RouteCall {
    return this.calls[this.calls.length - 1]!;
  }
}

let grants: FakeGrants;
let engine: FakeRoute;
let direct: FakeRoute;
let broker: ConnectorBroker;
let log: ReturnType<typeof vi.fn<(line: string) => void>>;
let recheck: (owner: string) => void; // main's re-read of an owner window before work starts

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  grants = new FakeGrants();
  direct = new FakeRoute('direct');
  engine = new FakeRoute('engine', 'session-a');
  log = vi.fn<(line: string) => void>();
  broker = new ConnectorBroker({ routes: [engine, direct], grants, log, recheckWindow: (owner) => recheck(owner) });
  recheck = () => {};
  // P3-H H4 (P3 Decision Log 89): the owner windows are shown, as main reports them; their own cases hide them
  broker.setWindowShown(ME, true);
  broker.setWindowShown(THEM, true);
});

afterEach(() => {
  broker.stop();
  vi.useRealTimers();
});

// A visible page lease on ART that declared `tools`.
function page(owner = ME, artifactId = ART, tools: ConnectorToolRef[] = [ROWS, SEND]): string {
  const lease = broker.open(owner, artifactId);
  expect(broker.declareTools(owner, lease, tools)).toEqual({ ok: true, declared: tools });
  expect(broker.setVisible(owner, lease, true)).toBe(true);
  return lease;
}

function watcher() {
  const updates: ConnectorCallOutcome[] = [];
  return { updates, listener: (update: ConnectorCallOutcome) => updates.push(update) };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('a page lease (P3 Decision Log 80)', () => {
  it('starts hidden: nothing is resolved, checked or called until its owner shows it', async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    const lease = broker.open(ME, ART);
    broker.declareTools(ME, lease, [ROWS]);
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(engine.resolves + direct.resolves + grants.checks.length).toBe(0);
    broker.setVisible(ME, lease, true);
    expect(await broker.callTool(ME, lease, ROWS)).toMatchObject({ ok: true });
  });

  it('calls only a declared server and tool, and its declaration grants nothing', async () => {
    engine.has(ROWS);
    const lease = page(ME, ART, [ROWS]);
    expect(await broker.callTool(ME, lease, { server: 'fixture', tool: 'other' })).toEqual({ ok: false, state: 'invalid', reason: 'undeclared' });
    expect(await broker.callTool(ME, lease, { server: 'other', tool: 'rows' })).toEqual({ ok: false, state: 'invalid', reason: 'undeclared' });
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'revoked', reason: 'notGranted' });
    expect(engine.calls).toHaveLength(0);
  });

  it('refuses a malformed request, a read-only claim by the page and oversized or unserialisable arguments', async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    const lease = page();
    for (const bad of [null, 'rows', { server: 'fixture' }, { ...ROWS, readOnly: true }, { ...ROWS, fingerprint: 'fp-1' }, { ...ROWS, args: [] }, { ...ROWS, args: { q: 'x'.repeat(70_000) } }, { ...ROWS, args: { n: 1n } }]) {
      expect(await broker.callTool(ME, lease, bad), JSON.stringify(bad, (_, v) => (typeof v === 'bigint' ? 'bigint' : v))).toEqual({ ok: false, state: 'invalid', reason: 'request' });
    }
    expect(broker.declareTools(ME, lease, [{ ...ROWS, readOnly: true }])).toEqual({ ok: false, state: 'invalid', reason: 'request' });
    expect(engine.calls).toHaveLength(0);
  });

  it('bounds what one lease declares', () => {
    const lease = broker.open(ME, ART);
    const many = Array.from({ length: CONNECTOR_DECLARE_LIMIT }, (_, i) => ({ server: 'fixture', tool: `t${i}` }));
    expect(broker.declareTools(ME, lease, many)).toMatchObject({ ok: true });
    expect(broker.declareTools(ME, lease, [many[0]])).toMatchObject({ ok: true }); // declared again changes nothing
    expect(broker.declareTools(ME, lease, [{ server: 'fixture', tool: 'one-more' }])).toEqual({ ok: false, state: 'invalid', reason: 'request' });
  });

  it("answers another owner's use of a lease as no lease, and lets it change nothing", async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    const lease = page();
    const { listener, updates } = watcher();
    expect(await broker.callTool(THEM, lease, ROWS)).toEqual({ ok: false, state: 'invalid', reason: 'lease' });
    expect(broker.declareTools(THEM, lease, [ROWS])).toEqual({ ok: false, state: 'invalid', reason: 'lease' });
    expect(broker.watchTool(THEM, lease, { ...ROWS, intervalMs: MIN }, listener)).toEqual({ ok: false, state: 'invalid', reason: 'lease' });
    const mine = broker.watchTool(ME, lease, { ...ROWS, intervalMs: MIN }, listener);
    if (!mine.ok) throw new Error('watch refused');
    const theirs = page(THEM);
    expect(broker.unwatch(THEM, theirs, mine.watchId)).toBe(false);
    expect(broker.refreshWatch(THEM, theirs, mine.watchId)).toBe(false);
    expect(broker.setVisible(THEM, lease, false)).toBe(false);
    expect(broker.close(THEM, lease)).toBe(false);
    expect(await broker.callTool(ME, lease, ROWS)).toMatchObject({ ok: true }); // still mine, still visible
    await settle();
    expect(updates.filter((u) => u.ok)).toHaveLength(1);
    expect(broker.close(ME, lease)).toBe(true);
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'invalid', reason: 'lease' });
  });
});

describe('a call (route choice, the grant on every call)', () => {
  it('answers the result, when main received it and the route, checking the grant against the route-reported fingerprint each time', async () => {
    engine.has(ROWS, { fingerprint: 'fp-engine' });
    grants.put(ART, ROWS, 'fp-engine', 'read');
    const lease = page();
    const first = await broker.callTool(ME, lease, { ...ROWS, args: { q: 'a' } });
    expect(first).toEqual({ ok: true, result: { rows: [1] }, fetchedAt: Date.now(), via: { route: 'engine', sessionId: 'session-a' } });
    expect(engine.last().args).toEqual({ q: 'a' });
    expect(engine.last().context).toMatchObject({ fingerprint: 'fp-engine', mode: 'read' });
    await broker.callTool(ME, lease, ROWS);
    expect(engine.last().args).toEqual({});
    expect(grants.checks).toEqual([
      [ART, { ...ROWS, fingerprint: 'fp-engine' }],
      [ART, { ...ROWS, fingerprint: 'fp-engine' }],
    ]);
  });

  it('takes route E while an eligible engine has the tool, and route D only when none does', async () => {
    engine.has(ROWS, { fingerprint: 'fp-engine' });
    direct.has(ROWS, { fingerprint: 'fp-direct' });
    grants.put(ART, ROWS, 'fp-engine', 'read');
    const lease = page();
    expect(await broker.callTool(ME, lease, ROWS)).toMatchObject({ ok: true, via: { route: 'engine', sessionId: 'session-a' } });
    expect(direct.resolves).toBe(0);
    engine.tools.clear(); // the session went
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'revoked', reason: 'fingerprintChanged' }); // D's server is another configuration
    grants.put(ART, ROWS, 'fp-direct', 'read');
    const direct_ = await broker.callTool(ME, lease, ROWS);
    expect(direct_).toMatchObject({ ok: true, via: { route: 'direct' } });
    expect((direct_ as { via: object }).via).not.toHaveProperty('sessionId');
    expect([engine.calls.length, direct.calls.length]).toEqual([1, 1]);
  });

  it('pauses with no route, asking the routes and nothing else', async () => {
    grants.put(ART, ROWS, 'fp-1', 'read');
    const lease = page();
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'paused', reason: 'noRoute' });
    expect([direct.resolves, engine.resolves, grants.checks.length]).toEqual([1, 1, 0]);
  });

  it('refuses a missing grant, a changed fingerprint, and a revoked one', async () => {
    engine.has(ROWS, { fingerprint: 'fp-2' });
    const lease = page();
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'revoked', reason: 'notGranted' });
    grants.put(ART, ROWS, 'fp-1', 'read');
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'revoked', reason: 'fingerprintChanged' });
    expect(await broker.grantTool(ART, { ...ROWS, mode: 'read' })).toMatchObject({ ok: true, grant: { fingerprint: 'fp-2' } });
    expect(await broker.callTool(ME, lease, ROWS)).toMatchObject({ ok: true });
    expect(await broker.revokeTool(ART, ROWS)).toBe(true);
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'revoked', reason: 'notGranted' });
    expect(engine.calls).toHaveLength(1);
  });

  it('reads read-only from the route: a write tool runs only under an Allow once, a read tool under either grant', async () => {
    engine.has(ROWS).has(SEND, { readOnly: false });
    grants.put(ART, SEND, 'fp-1', 'read'); // a read grant cannot admit a tool that may write
    const lease = page();
    expect(await broker.callTool(ME, lease, { ...SEND, args: { doc: 'x' } })).toEqual({ ok: false, state: 'revoked', reason: 'wrongMode' });
    expect(await broker.grantTool(ART, { ...SEND, mode: 'read' })).toEqual({ ok: false, state: 'invalid', reason: 'notReadOnly' });
    expect(await broker.grantTool(ART, { ...SEND, mode: 'once' })).toMatchObject({ ok: true, grant: { mode: 'once' } });
    expect(await broker.callTool(ME, lease, { ...SEND, args: { doc: 'x' } })).toMatchObject({ ok: true });
    expect(engine.last().context.mode).toBe('once');
    grants.put(ART, ROWS, 'fp-1', 'once');
    expect(await broker.callTool(ME, lease, ROWS)).toMatchObject({ ok: true });
  });

  it("answers a route's unavailable or failed call by its closed reason alone, its words going to main's log", async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    const lease = page();
    const { listener, updates } = watcher();
    engine.answer = () => ({ ok: false, failure: 'unavailable', message: `${SECRET} MCP server not connected: fixture` });
    const unavailable = await broker.callTool(ME, lease, ROWS);
    expect(unavailable).toEqual({ ok: false, state: 'paused', reason: 'unavailable' });
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    engine.answer = () => ({ ok: false, failure: 'failed', message: `${SECRET} ${'e'.repeat(5_000)}` });
    const failed = await broker.callTool(ME, lease, ROWS);
    expect(failed).toEqual({ ok: false, state: 'failed', reason: 'toolError' });
    await vi.advanceTimersByTimeAsync(30_000);
    engine.answer = () => {
      throw new Error(`${SECRET} boom`);
    };
    const threw = await broker.callTool(ME, lease, ROWS);
    expect(threw).toEqual({ ok: false, state: 'failed', reason: 'toolError' });
    expect(updates).toEqual([
      { ok: false, state: 'paused', reason: 'unavailable' },
      { ok: false, state: 'failed', reason: 'toolError' },
    ]);
    expect([unavailable, failed, threw, updates].some(discloses)).toBe(false);
    const logged = log.mock.calls.map(([line]) => line);
    expect(logged.filter((line) => line.includes('sentinel-7f3a'))).toHaveLength(5); // three calls, two refreshes
    expect(logged.every((line) => line.length < 1_200)).toBe(true); // a route's message is bounded in the log too
  });

  // P3-H H3b: route E's host makes the last check at the write (the grant as main admitted it, the server's identity);
  // its refusal is the grant's, so a page reads it as `revoked` with that reason and a watch waits for a grant.
  it("answers the route's own last refusal as revoked with its reason, and a watch waits, timerless, for a grant", async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    const lease = page();
    for (const refusal of ['notGranted', 'fingerprintChanged', 'wrongMode', 'revoked'] as const) {
      engine.answer = () => ({ ok: false, failure: 'refused', refusal, message: `${SECRET} the grant changed` });
      expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'revoked', reason: refusal });
    }
    engine.answer = () => ({ ok: false, failure: 'tooLarge', message: `${SECRET} 20000000 bytes` });
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'failed', reason: 'tooLarge' });
    engine.answer = () => ({ ok: false, failure: 'refused', refusal: 'revoked', message: 'x' });
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    expect(updates).toEqual([{ ok: false, state: 'revoked', reason: 'revoked' }]);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(updates).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(log.mock.calls.every(([line]) => !line.includes('sentinel') || line.startsWith('connectors:'))).toBe(true);
  });

  it('tells a malformed answer from an oversized one, both failed', async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    const lease = page();
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const answer of [{ ok: true, result: { n: 1n } }, { ok: true, result: { rows: [{ a: undefined }] } }, { ok: true, result: [1, () => 2] }, { ok: true, result: { n: Number.NaN } }, { ok: true, result: new Date(0) }, { ok: true, result: cycle }, { ok: true }, { ok: 'yes' }, { ok: false, failure: 'other', message: 'x' }, null]) {
      engine.answer = () => answer as ConnectorRouteAnswer;
      expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'failed', reason: 'malformed' });
    }
    engine.answer = () => ({ ok: true, result: 'x'.repeat(17 * 1024 * 1024) });
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'failed', reason: 'tooLarge' });
    engine.answer = () => ({ ok: true, result: 'x'.repeat(15 * 1024 * 1024) });
    expect(await broker.callTool(ME, lease, ROWS)).toMatchObject({ ok: true });
  });

  it('takes a null or falsy result as a success, since only a result that is not JSON is malformed', async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    const lease = page();
    for (const result of [null, 0, '', false, [], {}]) {
      engine.answer = () => ({ ok: true, result });
      expect(await broker.callTool(ME, lease, ROWS)).toMatchObject({ ok: true, result });
    }
  });

  it('refuses a malformed route target, a route that throws and a grant it cannot read, saying nothing of why to the page', async () => {
    engine.has(ROWS);
    direct.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    const lease = page();
    for (const bad of [{ fingerprint: '', readOnly: true }, { fingerprint: 'fp-1', readOnly: 'yes' }, { fingerprint: 'f'.repeat(513), readOnly: true }]) {
      engine.target = () => bad;
      expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'failed', reason: 'malformed' });
    }
    engine.target = (tool) => tool;
    engine.resolveThrows = true; // a broken route does not hide a working one
    expect(await broker.callTool(ME, lease, ROWS)).toMatchObject({ ok: true, via: { route: 'direct' } });
    direct.resolveThrows = true;
    const routeFailed = await broker.callTool(ME, lease, ROWS);
    expect(routeFailed).toEqual({ ok: false, state: 'failed', reason: 'routeFailed' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('route broke'));
    engine.resolveThrows = false;
    grants.checkThrows = true; // the grant could not be read: the route the call needed failed
    const unread = await broker.callTool(ME, lease, ROWS);
    expect(unread).toEqual({ ok: false, state: 'failed', reason: 'routeFailed' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('store unreachable'));
    expect([routeFailed, unread].some(discloses)).toBe(false);
    expect(engine.calls.length + direct.calls.length).toBe(1);
  });

  it('calls the target the route answered, as it answered it', async () => {
    class SessionTarget {
      readonly fingerprint = 'fp-1';
      readonly readOnly = true;
      readonly sessionId = 'session-b';
      private readonly answers = ['from the session'];
      call(): Promise<ConnectorRouteAnswer> {
        return Promise.resolve({ ok: true, result: this.answers[0] });
      }
    }
    const route: ConnectorRoute = { route: 'engine', resolve: () => Promise.resolve(new SessionTarget()) };
    broker = new ConnectorBroker({ routes: [route], grants, log });
    broker.setWindowShown(ME, true); // P3-H H4: main's report of the owner window
    grants.put(ART, ROWS, 'fp-1', 'read');
    const lease = page();
    expect(await broker.callTool(ME, lease, ROWS)).toMatchObject({ ok: true, result: 'from the session', via: { route: 'engine', sessionId: 'session-b' } });
  });
});

describe('in-flight work stops on hide, close and revoke, and its result is never published', () => {
  it('answers a call in flight paused when its page hides, aborts the route and drops the late result', async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    engine.hold = true;
    const lease = page();
    const pending = broker.callTool(ME, lease, ROWS);
    await settle();
    expect(engine.calls).toHaveLength(1);
    broker.setVisible(ME, lease, false);
    expect(await pending).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(engine.last().context.signal.aborted).toBe(true);
    engine.last().answer.resolve({ ok: true, result: 'late' });
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
  });

  it('answers a call in flight revoked the moment the owner revokes, before the store commits, and admits no call meanwhile', async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    engine.hold = true;
    const lease = page();
    const pending = broker.callTool(ME, lease, ROWS);
    await settle();
    const commit = deferred<void>();
    grants.revokeGate = commit.promise;
    const revoking = broker.revokeTool(ART, ROWS);
    expect(await pending).toEqual({ ok: false, state: 'revoked', reason: 'revoked' });
    expect(engine.last().context.signal.aborted).toBe(true);
    const checks = grants.checks.length;
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'revoked', reason: 'revoked' }); // the row is still there
    expect(grants.checks.length).toBe(checks);
    commit.resolve();
    expect(await revoking).toBe(true);
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'revoked', reason: 'notGranted' });
    expect(engine.calls).toHaveLength(1);
  });

  it('refuses a call whose grant check answered from before a revoke that began meanwhile', async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    const gate = deferred<void>();
    grants.checkGate = gate.promise;
    const lease = page();
    const pending = broker.callTool(ME, lease, ROWS);
    await settle();
    expect(grants.checks).toHaveLength(1);
    const commit = deferred<void>();
    grants.revokeGate = commit.promise;
    const revoking = broker.revokeTool(ART, ROWS);
    expect(await pending).toEqual({ ok: false, state: 'revoked', reason: 'revoked' }); // answered without waiting on the store
    gate.resolve(); // the check then reads the grant, still there: the revoke has not committed
    await settle();
    commit.resolve();
    expect(await revoking).toBe(true);
    expect(engine.calls).toHaveLength(0);
  });

  it("stops on the store's committed revoke or delete from elsewhere, and not on an Allow once being used", async () => {
    engine.has(ROWS).has(SEND, { readOnly: false });
    grants.put(ART, ROWS, 'fp-1', 'read');
    grants.put(ART, SEND, 'fp-1', 'once');
    engine.hold = true;
    const lease = page();
    const send = broker.callTool(ME, lease, SEND);
    const read = broker.callTool(ME, lease, ROWS);
    await settle();
    expect(engine.calls).toHaveLength(2);
    // the host consumed the Allow once as it wrote the call: this call is the one it admitted
    broker.onGrantChange({ artifactId: ART, ...SEND, change: 'consumed' });
    expect(engine.calls[0]!.context.signal.aborted).toBe(false);
    engine.calls[0]!.answer.resolve({ ok: true, result: 'sent' });
    expect(await send).toMatchObject({ ok: true, result: 'sent' });
    // another artifact's revoke, or another tool's, stops nothing here
    broker.onGrantChange({ artifactId: OTHER_ART, ...ROWS, change: 'revoked' });
    broker.onGrantChange({ artifactId: ART, ...SEND, change: 'revoked' });
    expect(engine.calls[1]!.context.signal.aborted).toBe(false);
    // the artifact's deletion, announced as each grant revoked
    broker.onGrantChange({ artifactId: ART, ...ROWS, change: 'revoked' });
    expect(await read).toEqual({ ok: false, state: 'revoked', reason: 'revoked' });
    expect(engine.calls[1]!.context.signal.aborted).toBe(true);
  });

  // P3 Decision Log 91: an Allow once the host consumed leaves no row, so the artifact's deletion announces no revoke of
  // it; the deletion itself stops every tool's work for the artifact.
  it('stops every tool’s work and watch of a deleted artifact on the deletion itself, with no grant announcement', async () => {
    engine.has(ROWS).has(SEND, { readOnly: false });
    grants.put(ART, ROWS, 'fp-1', 'read');
    grants.put(ART, SEND, 'fp-1', 'once');
    grants.put(OTHER_ART, ROWS, 'fp-1', 'read');
    const lease = page();
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    expect(updates).toEqual([expect.objectContaining({ ok: true })]);
    engine.hold = true;
    const other = page(ME, OTHER_ART);
    const send = broker.callTool(ME, lease, SEND);
    const elsewhere = broker.callTool(ME, other, ROWS);
    await settle();
    expect(engine.calls).toHaveLength(3);
    broker.onGrantChange({ artifactId: ART, ...SEND, change: 'consumed' }); // its row gone with the call
    grants.rows.delete(grantKey(ART, SEND));
    broker.onArtifactDeleted(ART);
    expect(await send).toEqual({ ok: false, state: 'revoked', reason: 'revoked' });
    expect(engine.calls[1]!.context.signal.aborted, 'its route told').toBe(true);
    expect(updates.slice(1), 'the watch says revoked once').toEqual([{ ok: false, state: 'revoked', reason: 'revoked' }]);
    // another artifact's work goes on
    expect(engine.calls[2]!.context.signal.aborted).toBe(false);
    engine.calls[2]!.answer.resolve({ ok: true, result: 'there' });
    expect(await elsewhere).toMatchObject({ ok: true, result: 'there' });
    // the deleted artifact's watch waits, timerless, and its page's later work asks afresh (the routes find no artifact)
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(engine.calls).toHaveLength(3);
    expect(updates).toHaveLength(2);
  });

  it('answers a call in flight paused when its lease closes, and when its owner goes', async () => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
    engine.hold = true;
    const one = page();
    const two = page();
    const a = broker.callTool(ME, one, ROWS);
    const b = broker.callTool(ME, two, ROWS);
    await settle();
    broker.close(ME, one);
    expect(await a).toEqual({ ok: false, state: 'paused', reason: 'closed' });
    broker.closeOwner(ME);
    expect(await b).toEqual({ ok: false, state: 'paused', reason: 'closed' });
    expect(engine.calls.every((call) => call.context.signal.aborted)).toBe(true);
  });
});

describe('a watch (30 s to 24 h, at most 64 per app, only while visible)', () => {
  beforeEach(() => {
    engine.has(ROWS).has(SEND, { readOnly: false });
    grants.put(ART, ROWS, 'fp-1', 'read');
    grants.put(OTHER_ART, ROWS, 'fp-1', 'read');
  });

  it('clamps the interval and answers the one it runs at', () => {
    const lease = page();
    const { listener } = watcher();
    const at = (intervalMs: number) => broker.watchTool(ME, lease, { ...ROWS, intervalMs }, listener);
    expect(at(1)).toMatchObject({ ok: true, intervalMs: CONNECTOR_WATCH_MIN_MS });
    expect(at(45_000)).toMatchObject({ ok: true, intervalMs: 45_000 });
    expect(at(1e12)).toMatchObject({ ok: true, intervalMs: CONNECTOR_WATCH_MAX_MS });
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(at(bad)).toEqual({ ok: false, state: 'invalid', reason: 'request' });
    expect(broker.watchTool(ME, lease, { server: 'fixture', tool: 'other', intervalMs: MIN }, listener)).toEqual({ ok: false, state: 'invalid', reason: 'undeclared' });
  });

  it('refreshes at once when visible, then one interval after each refresh ends, never two at a time', async () => {
    const lease = page();
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000, args: { q: 'a' } }, listener);
    await settle();
    expect(updates).toEqual([{ ok: true, result: { rows: [1] }, fetchedAt: Date.now(), via: { route: 'engine', sessionId: 'session-a' } }]);
    expect(engine.last().args).toEqual({ q: 'a' });
    engine.hold = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(engine.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5 * 30_000); // the tool is slow: no second refresh starts beside it
    expect(engine.calls).toHaveLength(2);
    engine.last().answer.resolve({ ok: true, result: 'slow' });
    await settle();
    expect(updates.at(-1)).toMatchObject({ ok: true, result: 'slow' });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(engine.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.calls).toHaveLength(3);
    expect(grants.checks).toHaveLength(3); // the grant checked on every refresh
  });

  it('is silent for ten minutes while hidden, then catches up once when shown', async () => {
    const lease = page();
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.calls).toHaveLength(3);
    broker.setVisible(ME, lease, false);
    const seen = [engine.resolves, direct.resolves, engine.calls.length, grants.checks.length, updates.length];
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect([engine.resolves, direct.resolves, engine.calls.length, grants.checks.length, updates.length]).toEqual(seen);
    broker.setVisible(ME, lease, true);
    await settle();
    expect(engine.calls).toHaveLength(4); // once, not the twenty it missed
    await vi.advanceTimersByTimeAsync(29_999);
    expect(engine.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.calls).toHaveLength(5);
  });

  it('when shown before its next refresh is due, waits for it', async () => {
    const lease = page();
    const { listener } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: MIN }, listener);
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    broker.setVisible(ME, lease, false);
    await vi.advanceTimersByTimeAsync(10_000);
    broker.setVisible(ME, lease, true);
    await vi.advanceTimersByTimeAsync(39_999);
    expect(engine.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.calls).toHaveLength(2);
  });

  it('drops a refresh in flight when hidden, never publishing it, and catches up on show', async () => {
    const lease = page();
    const { listener, updates } = watcher();
    engine.hold = true;
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: MIN }, listener);
    await settle();
    broker.setVisible(ME, lease, false);
    broker.setVisible(ME, lease, true); // before the aborted refresh has even unwound
    engine.calls[0]!.answer.resolve({ ok: true, result: 'stale' });
    await settle();
    expect(engine.calls[0]!.context.signal.aborted).toBe(true);
    expect(updates).toEqual([]);
    expect(engine.calls).toHaveLength(2);
    engine.calls[1]!.answer.resolve({ ok: true, result: 'fresh' });
    await settle();
    expect(updates).toMatchObject([{ ok: true, result: 'fresh' }]);
  });

  it('starts hidden: a watch on a page never shown never runs', async () => {
    const lease = broker.open(ME, ART);
    broker.declareTools(ME, lease, [ROWS]);
    const { listener, updates } = watcher();
    expect(broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener)).toMatchObject({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect([engine.resolves, updates.length, vi.getTimerCount()]).toEqual([0, 0, 0]);
  });

  it('runs at most 64 across every page and window, and an ended watch frees its place', async () => {
    const mine = page(ME, ART);
    const theirs = page(THEM, OTHER_ART);
    const { listener } = watcher();
    const ids: string[] = [];
    for (let i = 0; i < CONNECTOR_WATCH_LIMIT; i += 1) {
      const start = broker.watchTool(i % 2 === 0 ? ME : THEM, i % 2 === 0 ? mine : theirs, { ...ROWS, intervalMs: MIN }, listener);
      if (!start.ok) throw new Error(`watch ${i} refused`);
      ids.push(start.watchId);
    }
    expect(broker.watchTool(THEM, theirs, { ...ROWS, intervalMs: MIN }, listener)).toEqual({ ok: false, state: 'invalid', reason: 'watchLimit' });
    const third = page(ME, ART);
    expect(broker.watchTool(ME, third, { ...ROWS, intervalMs: MIN }, listener)).toEqual({ ok: false, state: 'invalid', reason: 'watchLimit' });
    expect(broker.unwatch(ME, mine, ids[0]!)).toBe(true);
    expect(broker.unwatch(ME, mine, ids[0]!)).toBe(false);
    expect(broker.watchTool(THEM, theirs, { ...ROWS, intervalMs: MIN }, listener)).toMatchObject({ ok: true });
    broker.close(ME, mine); // its 31 places freed
    for (let i = 0; i < 31; i += 1) expect(broker.watchTool(ME, third, { ...ROWS, intervalMs: MIN }, listener)).toMatchObject({ ok: true });
    expect(broker.watchTool(ME, third, { ...ROWS, intervalMs: MIN }, listener)).toMatchObject({ ok: false, reason: 'watchLimit' });
  });

  it('refuses to watch a tool the route does not mark read-only, ending the watch', async () => {
    grants.put(ART, SEND, 'fp-1', 'once');
    const lease = page();
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...SEND, intervalMs: 30_000 }, listener);
    await settle();
    expect(updates).toEqual([{ ok: false, state: 'invalid', reason: 'notReadOnly' }]);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(engine.calls).toHaveLength(0);
    expect(grants.rows.has(grantKey(ART, SEND))).toBe(true); // the Allow once is not spent on it
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never runs a watch under an Allow once, even of a read-only tool', async () => {
    grants.put(ART, ROWS, 'fp-1', 'once');
    const lease = page();
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    expect(updates).toEqual([{ ok: false, state: 'revoked', reason: 'wrongMode' }]);
    expect(engine.calls).toHaveLength(0);
  });

  it('waits, without a timer, for a missing grant, then refreshes as soon as the owner grants', async () => {
    grants.rows.clear();
    const lease = page();
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    expect(updates).toEqual([{ ok: false, state: 'revoked', reason: 'notGranted' }]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(grants.checks).toHaveLength(1);
    expect(await broker.grantTool(ART, { ...ROWS, mode: 'read' })).toMatchObject({ ok: true });
    broker.onGrantChange({ artifactId: ART, ...ROWS, change: 'granted' }); // the store's own announcement adds no refresh
    await settle();
    expect(updates.at(-1)).toMatchObject({ ok: true });
    expect(engine.calls).toHaveLength(1);
  });

  it('on a revoke, drops its refresh in flight, says revoked once and stops until granted again', async () => {
    const lease = page();
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    engine.hold = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(engine.calls).toHaveLength(2);
    const revoked = broker.revokeTool(ART, ROWS);
    engine.calls[1]!.answer.resolve({ ok: true, result: 'stale' });
    await revoked;
    broker.onGrantChange({ artifactId: ART, ...ROWS, change: 'revoked' }); // the store's announcement of the same revoke
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(updates.slice(1)).toEqual([{ ok: false, state: 'revoked', reason: 'revoked' }]);
    expect(engine.calls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  // Two refreshes held, then answered in the same turn: the first published outcome's listener acts before the second
  // is published, and the second must honour what it did.
  async function twoAnsweredTogether(listen: (name: string, seen: string[]) => (update: ConnectorCallOutcome) => void, second = page()) {
    const first = page();
    const seen: string[] = [];
    engine.hold = true;
    broker.watchTool(ME, first, { ...ROWS, intervalMs: 30_000, args: { n: 1 } }, listen('a', seen));
    broker.watchTool(ME, second, { ...ROWS, intervalMs: 30_000, args: { n: 2 } }, listen('b', seen));
    await settle();
    expect(engine.calls).toHaveLength(2);
    engine.calls[0]!.answer.resolve({ ok: true, result: 'a' });
    engine.calls[1]!.answer.resolve({ ok: true, result: 'b' });
    await settle();
    return seen;
  }
  const said = (name: string, update: ConnectorCallOutcome) => `${name}:${update.ok ? 'ok' : update.reason}`;

  it('publishes no refresh whose page a listener hid as both completed', async () => {
    const lease = page();
    const seen = await twoAnsweredTogether(
      (name, seen) => (update) => {
        seen.push(said(name, update));
        if (update.ok) broker.setVisible(ME, lease, false);
      },
      lease,
    );
    expect(seen).toHaveLength(1); // the one published before the hide; the other dropped
    expect(seen[0]).toMatch(/^[ab]:ok$/);
    expect(vi.getTimerCount()).toBe(1); // the other page's watch, still visible
    broker.setVisible(ME, lease, true); // the dropped refresh is due at once, the published one an interval on
    await settle();
    expect(engine.calls).toHaveLength(3);
    expect(engine.calls[2]!.args).toEqual({ n: seen[0] === 'a:ok' ? 2 : 1 });
  });

  it('publishes no success after a revoke a listener made as both completed', async () => {
    const seen = await twoAnsweredTogether((name, seen) => (update) => {
      seen.push(said(name, update));
      if (update.ok) void broker.revokeTool(ART, ROWS);
    });
    expect(seen.filter((line) => line.endsWith(':ok'))).toHaveLength(1);
    expect(seen.slice(1).every((line) => line.endsWith(':revoked'))).toBe(true);
    expect(seen).toHaveLength(3); // one success, then each watch told once
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect([engine.calls.length, seen.length, vi.getTimerCount()]).toEqual([2, 3, 0]);
  });

  for (const [shape, before] of [
    ['notGranted', null],
    ['fingerprintChanged', 'fp-old'],
  ] as const) {
    it(`does not wait on a ${shape} answer read before a grant that arrived while it was in flight`, async () => {
      grants.rows.clear();
      if (before) grants.put(ART, ROWS, before, 'read');
      const gate = deferred<void>();
      grants.checkGate = gate.promise;
      const lease = page();
      const { listener, updates } = watcher();
      broker.watchTool(ME, lease, { ...ROWS, intervalMs: MIN }, listener);
      await settle();
      expect(grants.checks).toHaveLength(1); // its snapshot: no grant, or another fingerprint's
      grants.put(ART, ROWS, 'fp-1', 'read'); // the owner granted from another window: the store announces it
      broker.onGrantChange({ artifactId: ART, ...ROWS, change: 'granted' });
      grants.checkGate = null;
      gate.resolve();
      await settle();
      expect(updates).toMatchObject([{ ok: true }]); // the obsolete denial never published, and no gesture needed
      expect(engine.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(MIN);
      expect(engine.calls).toHaveLength(2); // and it goes on at its interval
    });
  }

  it("wakes when its own listener's gesture grants on hearing the denial", async () => {
    grants.rows.clear();
    const lease = page();
    const updates: ConnectorCallOutcome[] = [];
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: MIN }, (update) => {
      updates.push(update);
      if (!update.ok && update.reason === 'notGranted') {
        grants.put(ART, ROWS, 'fp-1', 'read');
        broker.onGrantChange({ artifactId: ART, ...ROWS, change: 'granted' });
      }
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1); // the wake's refresh, armed inside the denial's own tick
    expect(updates).toMatchObject([{ ok: false, reason: 'notGranted' }, { ok: true }]);
  });

  it('with no route, reads paused and asks the routes again at its interval, calling nothing until one has the server', async () => {
    engine.tools.clear();
    const lease = page();
    const { listener, updates } = watcher();
    const start = broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    if (!start.ok) throw new Error('refused');
    await vi.advanceTimersByTimeAsync(10 * 30_000);
    expect(updates).toHaveLength(11);
    expect(updates.every((u) => !u.ok && u.state === 'paused' && u.reason === 'noRoute')).toBe(true);
    expect([engine.calls.length, grants.checks.length]).toEqual([0, 0]);
    engine.has(ROWS); // the owner's Start made a session live; the Refresh after it reads at once
    expect(broker.refreshWatch(ME, lease, start.watchId)).toBe(true);
    await settle();
    expect(updates).toHaveLength(12);
    expect(updates.at(-1)).toMatchObject({ ok: true, via: { route: 'engine' } });
  });

  it('refreshes on demand only when visible and idle', async () => {
    const lease = page();
    const { listener } = watcher();
    const start = broker.watchTool(ME, lease, { ...ROWS, intervalMs: MIN }, listener);
    if (!start.ok) throw new Error('refused');
    await settle();
    expect(broker.refreshWatch(ME, lease, start.watchId)).toBe(true);
    await settle();
    expect(engine.calls).toHaveLength(2);
    engine.hold = true;
    broker.refreshWatch(ME, lease, start.watchId);
    await settle();
    expect(broker.refreshWatch(ME, lease, start.watchId)).toBe(false); // one in flight
    engine.last().answer.resolve({ ok: true, result: 1 });
    await settle();
    broker.setVisible(ME, lease, false);
    expect(broker.refreshWatch(ME, lease, start.watchId)).toBe(false);
    expect(engine.calls).toHaveLength(3);
  });

  // P3-H H3b: a grant the store committed whose announcement never arrived (the host's event dropped while main was not
  // connected, or the grant gesture's own answer lost) must not leave a watch parked for good: a reconnect, the owner's
  // Refresh and showing the page re-read the store's grants (a read, consuming nothing, resolving no route).
  describe('a grant whose announcement was lost', () => {
    async function parked() {
      grants.rows.clear(); // the describe's grants: none here until a test commits one
      const lease = page();
      const { listener, updates } = watcher();
      const start = broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
      if (!start.ok) throw new Error('refused');
      await settle();
      expect(updates).toEqual([{ ok: false, state: 'revoked', reason: 'notGranted' }]);
      return { lease, watchId: start.watchId, updates };
    }

    it('recovers on a reconnect’s re-read, with no new grant gesture', async () => {
      const { updates } = await parked();
      grants.put(ART, ROWS, 'fp-1', 'read'); // committed, never announced
      await vi.advanceTimersByTimeAsync(10 * MIN);
      expect(updates).toHaveLength(1); // still parked: nothing told it
      broker.recheckGrants();
      await settle();
      expect(updates.at(-1)).toMatchObject({ ok: true });
    });

    it('recovers on the owner’s Refresh and on showing the page again', async () => {
      const { lease, watchId, updates } = await parked();
      grants.put(ART, ROWS, 'fp-1', 'read');
      expect(broker.refreshWatch(ME, lease, watchId)).toBe(true);
      await settle();
      expect(updates.at(-1)).toMatchObject({ ok: true });

      const other = await parked();
      grants.rows.clear();
      broker.onGrantChange({ artifactId: ART, ...ROWS, change: 'revoked' });
      grants.put(ART, ROWS, 'fp-1', 'read');
      broker.setVisible(ME, other.lease, false);
      broker.setVisible(ME, other.lease, true);
      await settle();
      expect(other.updates.at(-1)).toMatchObject({ ok: true });
    });

    it('an absent grant stays absent: re-read, nothing resolved, checked or called, no timer, no update', async () => {
      const { lease, watchId, updates } = await parked();
      const list = vi.spyOn(grants, 'list');
      const resolves = engine.resolves;
      const checks = grants.checks.length;
      broker.recheckGrants();
      expect(broker.refreshWatch(ME, lease, watchId)).toBe(true);
      await settle();
      expect(list).toHaveBeenCalled();
      expect(engine.resolves).toBe(resolves);
      expect(grants.checks).toHaveLength(checks);
      expect(engine.calls).toHaveLength(0);
      expect(updates).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      // an Allow once is no grant for a watch
      grants.put(ART, ROWS, 'fp-1', 'once');
      broker.recheckGrants();
      await settle();
      expect(updates).toHaveLength(1);
      expect(engine.calls).toHaveLength(0);
    });

    it('a re-read that raced a revoke does not wake the watch', async () => {
      const { updates } = await parked();
      grants.put(ART, ROWS, 'fp-1', 'read');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const list = grants.list.bind(grants);
      vi.spyOn(grants, 'list').mockImplementation(async (artifactId) => {
        const answer = await list(artifactId); // read before the revoke
        await gate;
        return answer;
      });
      broker.recheckGrants();
      await settle();
      grants.rows.clear();
      broker.onGrantChange({ artifactId: ART, ...ROWS, change: 'revoked' });
      release();
      await vi.advanceTimersByTimeAsync(10 * MIN);
      expect(updates).toHaveLength(1);
      expect(engine.calls).toHaveLength(0);
    });
  });

  it('clears every timer and aborts its refresh on close, owner teardown and stop', async () => {
    const one = page(ME);
    const two = page(THEM);
    const three = page(THEM);
    const { listener, updates } = watcher();
    for (const [owner, lease] of [[ME, one], [THEM, two], [THEM, three]] as const) broker.watchTool(owner, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    expect(updates).toHaveLength(3);
    engine.hold = true;
    await vi.advanceTimersByTimeAsync(30_000);
    broker.close(ME, one);
    broker.closeOwner(THEM);
    expect(vi.getTimerCount()).toBe(0);
    for (const call of engine.calls.slice(3)) {
      expect(call.context.signal.aborted).toBe(true);
      call.answer.resolve({ ok: true, result: 'stale' });
    }
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(updates).toHaveLength(3);
    const four = page(ME);
    broker.watchTool(ME, four, { ...ROWS, intervalMs: 30_000 }, listener);
    broker.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => broker.open(ME, ART)).toThrow();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(engine.calls).toHaveLength(6);
  });

  it('keeps refreshing when a listener throws, and says so in the log', async () => {
    const lease = page();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, () => {
      throw new Error('listener broke');
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(engine.calls).toHaveLength(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('listener broke'));
  });
});

// P3-H H4 (P3 Decision Log 80 and 89): a page is visible only while its surface is (the renderer's report) and its owner
// window is shown and not minimized (main's native report). The two are held apart: the window's state is main's, so
// the renderer's report never overrides a hidden window, and a window shown again never revives a hidden surface.
describe('the owner window’s native visibility (P3 Decision Log 89)', () => {
  beforeEach(() => {
    engine.has(ROWS);
    grants.put(ART, ROWS, 'fp-1', 'read');
  });

  it('hiding the window aborts work in flight, clears every timer, and refuses calls and the owner’s Refresh', async () => {
    const lease = page();
    const { listener, updates } = watcher();
    const start = broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    if (!start.ok) throw new Error('refused');
    await settle();
    expect(updates).toHaveLength(1);
    engine.hold = true;
    const pending = broker.callTool(ME, lease, ROWS);
    await settle();
    broker.setWindowShown(ME, false);
    expect(await pending).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(engine.last().context.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const seen = [engine.resolves, grants.checks.length, engine.calls.length];
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(broker.refreshWatch(ME, lease, start.watchId)).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect([engine.resolves, grants.checks.length, engine.calls.length]).toEqual(seen);
    expect(updates).toHaveLength(1);
  });

  it('drops a refresh in flight when the window hides, never publishing it', async () => {
    const lease = page();
    const { listener, updates } = watcher();
    engine.hold = true;
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    broker.setWindowShown(ME, false);
    engine.calls[0]!.answer.resolve({ ok: true, result: 'stale' });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(engine.calls[0]!.context.signal.aborted).toBe(true);
    expect(updates).toEqual([]);
    expect(engine.calls).toHaveLength(1);
  });

  it('a hidden or minimized window is not overridden by the renderer saying visible', async () => {
    broker.setWindowShown(ME, false);
    const lease = page(); // the renderer reports its surface visible
    const { listener, updates } = watcher();
    const start = broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    if (!start.ok) throw new Error('refused');
    expect(broker.setVisible(ME, lease, false)).toBe(true);
    expect(broker.setVisible(ME, lease, true)).toBe(true); // said again: still the window's veto
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(broker.refreshWatch(ME, lease, start.watchId)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect([engine.resolves, direct.resolves, grants.checks.length, updates.length]).toEqual([0, 0, 0, 0]);
  });

  it('showing the window again does not revive a page whose surface is hidden', async () => {
    const lease = page();
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    broker.setVisible(ME, lease, false);
    broker.setWindowShown(ME, false);
    broker.setWindowShown(ME, true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(engine.calls).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
  });

  it('shown again after ten minutes, a due watch catches up once, however often the window is reported shown', async () => {
    const lease = page();
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    broker.setWindowShown(ME, false);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(engine.calls).toHaveLength(1);
    broker.setWindowShown(ME, true);
    broker.setWindowShown(ME, true);
    broker.setVisible(ME, lease, true); // the renderer's own report, unchanged
    await settle();
    expect(engine.calls).toHaveLength(2); // once, not the twenty it missed
    expect(updates).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(engine.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.calls).toHaveLength(3);
  });

  it('a page shown while its window was hidden runs only once both are shown', async () => {
    const lease = page();
    const { listener } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    broker.setVisible(ME, lease, false);
    broker.setWindowShown(ME, false);
    broker.setVisible(ME, lease, true);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(engine.calls).toHaveLength(1);
    broker.setWindowShown(ME, true);
    await settle();
    expect(engine.calls).toHaveLength(2);
  });

  it('hiding another window stops nothing of this one', async () => {
    const lease = page();
    const { listener } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    broker.setWindowShown(THEM, false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(engine.calls).toHaveLength(2);
  });

  it('an owner whose window main never reported is hidden: it fails closed', async () => {
    const stranger = 'window-3';
    const lease = page(stranger);
    const { listener, updates } = watcher();
    broker.watchTool(stranger, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    expect(await broker.callTool(stranger, lease, ROWS)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect([engine.resolves, updates.length]).toEqual([0, 0]);
  });

  it('asks main to re-read the window before work starts, so a hide main has not yet heard of calls nothing', async () => {
    const lease = page();
    const { listener, updates } = watcher();
    broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
    await settle();
    const asked: string[] = [];
    let hiddenNow = true; // the window was hidden, and no event said so
    recheck = (owner) => {
      asked.push(owner);
      broker.setWindowShown(owner, !hiddenNow);
    };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(asked.length > 0 && asked.every((owner) => owner === ME)).toBe(true); // its own window, as work starts (and as it would publish)
    expect(engine.calls).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(await broker.callTool(ME, lease, ROWS)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(vi.getTimerCount()).toBe(0);
    hiddenNow = false;
    broker.setWindowShown(ME, true); // main's re-read finds it shown again: the refresh that fell due, once
    await settle();
    expect(engine.calls).toHaveLength(2);
    expect(updates).toHaveLength(2);
  });

  // A hide no event announced while a call or refresh awaits its prerequisites or its answer: main's re-read (here, the
  // `recheck` hook reading `native`) is asked again at the backend's door and at publication, so nothing is dispatched
  // after the window hid and no result reaches the page.
  describe('a hide no event announced, heard at admission and at publication', () => {
    let native: boolean;
    beforeEach(() => {
      native = true;
      recheck = (owner) => {
        if (owner === ME) broker.setWindowShown(ME, native);
      };
    });

    it('during the route’s resolution: nothing is called, and a watch catches up once shown', async () => {
      const lease = page();
      let open!: () => void;
      engine.resolveGate = new Promise<void>((resolve) => (open = resolve));
      const pending = broker.callTool(ME, lease, ROWS);
      const { listener, updates } = watcher();
      broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
      await settle();
      expect(engine.resolves).toBe(2); // the call's and the watch's, both waiting
      native = false; // hidden, silently
      engine.resolveGate = null;
      open();
      expect(await pending).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
      await vi.advanceTimersByTimeAsync(10 * MIN);
      expect(engine.calls).toHaveLength(0);
      expect(updates).toEqual([]);
      native = true;
      broker.setWindowShown(ME, true); // main's re-read finds it shown
      await settle();
      expect(engine.calls).toHaveLength(1);
      expect(updates).toMatchObject([{ ok: true }]);
    });

    it('during the grant check: nothing is called', async () => {
      const lease = page();
      let open!: () => void;
      grants.checkGate = new Promise<void>((resolve) => (open = resolve));
      const pending = broker.callTool(ME, lease, ROWS);
      const { listener, updates } = watcher();
      broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
      await settle();
      expect(grants.checks).toHaveLength(2);
      native = false;
      grants.checkGate = null;
      open();
      expect(await pending).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
      await vi.advanceTimersByTimeAsync(10 * MIN);
      expect([engine.calls.length, updates.length]).toEqual([0, 0]);
    });

    it('during a call already admitted: its result reaches neither the caller nor the watch, and a watch catches up once', async () => {
      const lease = page();
      engine.hold = true;
      const pending = broker.callTool(ME, lease, ROWS);
      const { listener, updates } = watcher();
      broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, listener);
      await settle();
      expect(engine.calls).toHaveLength(2);
      native = false;
      for (const call of engine.calls) call.answer.resolve({ ok: true, result: 'seen while hidden' });
      expect(await pending).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
      await vi.advanceTimersByTimeAsync(10 * MIN);
      expect(updates).toEqual([]);
      expect(engine.calls).toHaveLength(2);
      engine.hold = false;
      native = true;
      broker.setWindowShown(ME, true);
      await settle();
      expect(engine.calls).toHaveLength(3); // once
      expect(updates).toMatchObject([{ ok: true, result: { rows: [3] } }]);
    });
  });

  it('the window’s state outlives its pages (a reload), and a gone owner’s state goes with it', async () => {
    broker.setWindowShown(ME, false);
    page();
    broker.closeOwner(ME); // the renderer navigated: its leases end, its window stays hidden
    const reloaded = page();
    expect(await broker.callTool(ME, reloaded, ROWS)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    broker.setWindowShown(ME, true);
    expect(await broker.callTool(ME, reloaded, ROWS)).toMatchObject({ ok: true });
    broker.forgetOwner(ME); // its webContents destroyed: leases and window state gone
    expect(await broker.callTool(ME, reloaded, ROWS)).toEqual({ ok: false, state: 'invalid', reason: 'lease' });
    const late = page(); // a lease opened for it after all is never shown
    expect(await broker.callTool(ME, late, ROWS)).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    expect(engine.calls).toHaveLength(1);
  });
});

describe("the owner's grant and revoke", () => {
  it("grants under the route's fingerprint, never a page's, and needs a route to read it from", async () => {
    expect(await broker.grantTool(ART, { ...ROWS, mode: 'read' })).toEqual({ ok: false, state: 'paused', reason: 'noRoute' });
    engine.has(ROWS, { fingerprint: 'fp-live' });
    expect(await broker.grantTool(ART, { ...ROWS, mode: 'read' })).toEqual({ ok: true, grant: { ...ROWS, fingerprint: 'fp-live', mode: 'read', grantedAt: Date.now() } });
    expect(await broker.grants(ART)).toEqual([{ ...ROWS, fingerprint: 'fp-live', mode: 'read', grantedAt: Date.now() }]);
    await expect(broker.grantTool(ART, { ...ROWS, mode: 'read', fingerprint: 'fp-page' })).rejects.toThrow();
    await expect(broker.grantTool(ART, { ...ROWS, mode: 'write' })).rejects.toThrow();
    await expect(broker.revokeTool(ART, { server: '' , tool: 'rows' })).rejects.toThrow();
  });

  it('answers whether there was a grant to revoke', async () => {
    engine.has(ROWS);
    expect(await broker.revokeTool(ART, ROWS)).toBe(false);
    await broker.grantTool(ART, { ...ROWS, mode: 'read' });
    expect(await broker.revokeTool(ART, ROWS)).toBe(true);
  });

  // P3-F F-connectors 1: a revoke committed while an older gesture's route resolved is the owner's latest decision; the
  // older gesture restores no grant of either mode
  it('writes no grant, an Allow once included, for a gesture a revoke overtook while its route resolved', async () => {
    engine.has(ROWS);
    for (const mode of ['read', 'once'] as const) {
      let open!: () => void;
      engine.resolveGate = new Promise((resolve) => (open = resolve));
      const granting = broker.grantTool(ART, { ...ROWS, mode });
      await settle();
      expect(await broker.revokeTool(ART, ROWS), mode).toBe(false);
      engine.resolveGate = null;
      open();
      expect(await granting, mode).toEqual({ ok: false, state: 'revoked', reason: 'revoked' });
      expect(await broker.grants(ART), mode).toEqual([]);
    }
  });
});
