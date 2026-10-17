// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): main's broker with a trusted dataset sink. The
// owner's surface forwards `{dataset}` beside a page's call or watch (never inside the page's request); the broker
// carries it to the route with a synchronous `publishable` recheck (the native window re-read, the work not aborted).
// A dataset is fed only by a read grant of a read-only tool. An agent's one refresh needs no lease: it runs through
// the asking session's own engine (route E for that session alone) or a direct route, never another session's, and
// the owner's revoke, the artifact's deletion and main's stop end it as they end a page's work.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorAuthorization, ConnectorCallOutcome, ConnectorCallRef, ConnectorGrant, ConnectorGrantMode, ConnectorGrantRequest, ConnectorRouteName, ConnectorToolRef } from '@shared/artifacts/connectors';
import { ConnectorBroker, type ConnectorAgentRefresh } from './broker';
import type { ConnectorGrantAuthority, ConnectorRoute, ConnectorRouteAnswer, ConnectorRouteCallContext, ConnectorRouteTarget } from './route';

const ART = 'dash-1';
const ME = 'window-1';
const ROWS: ConnectorToolRef = { server: 'fixture', tool: 'rows' };
const META = { status: 'dataset', artifactId: ART, id: 'live', revision: 7, columns: [{ name: 'v', type: 'number' }], rows: 2 };

class Grants implements ConnectorGrantAuthority {
  readonly rows = new Map<string, ConnectorGrant>();
  put(ref: ConnectorToolRef, mode: ConnectorGrantMode, artifactId = ART) {
    this.rows.set(JSON.stringify([artifactId, ref.server, ref.tool]), { ...ref, fingerprint: 'fp-1', mode, grantedAt: 1 });
  }
  async list() {
    return [...this.rows.values()];
  }
  async grant(_artifactId: string, request: ConnectorGrantRequest) {
    return { ...request, grantedAt: 1 };
  }
  async revoke(artifactId: string, ref: ConnectorToolRef) {
    return this.rows.delete(JSON.stringify([artifactId, ref.server, ref.tool]));
  }
  async check(artifactId: string, call: ConnectorCallRef): Promise<ConnectorAuthorization> {
    const grant = this.rows.get(JSON.stringify([artifactId, call.server, call.tool]));
    return grant ? { granted: true, mode: grant.mode } : { granted: false, refusal: 'notGranted' };
  }
}

interface Call {
  args: Record<string, unknown>;
  context: ConnectorRouteCallContext;
  answer(value: ConnectorRouteAnswer): void;
}
class Route implements ConnectorRoute {
  readonly calls: Call[] = [];
  resolves = 0;
  readOnly = true;
  hold = false;
  constructor(readonly route: ConnectorRouteName, readonly has = true) {}
  async resolve(): Promise<ConnectorRouteTarget | null> {
    this.resolves += 1;
    return this.has ? this.target() : null;
  }
  target(sessionId?: string): ConnectorRouteTarget {
    return {
      fingerprint: 'fp-1',
      readOnly: this.readOnly,
      ...(sessionId !== undefined && { sessionId }),
      call: (args, context) =>
        new Promise((resolve) => {
          this.calls.push({ args, context, answer: resolve });
          if (!this.hold) resolve({ ok: true, result: META });
        }),
    };
  }
}

let grants: Grants;
let engine: Route;
let direct: Route;
let sessions: { appSessionId: string; artifactId: string; tool: ConnectorToolRef }[];
let sessionHas: Set<string>;
let broker: ConnectorBroker;
let shown: boolean;
beforeEach(() => {
  vi.useFakeTimers();
  grants = new Grants();
  engine = new Route('engine');
  direct = new Route('direct', false);
  sessions = [];
  sessionHas = new Set(['app-asker']);
  shown = true;
  broker = new ConnectorBroker({
    routes: [engine, direct],
    grants,
    log: () => {},
    recheckWindow: (owner) => broker.setWindowShown(owner, shown),
    sessionRoute: async (appSessionId, artifactId, tool) => {
      sessions.push({ appSessionId, artifactId, tool });
      return sessionHas.has(appSessionId) ? engine.target(appSessionId) : null;
    },
  });
  broker.setWindowShown(ME, true);
});
afterEach(() => {
  broker.stop();
  vi.useRealTimers();
});
function page(): string {
  const lease = broker.open(ME, ART);
  broker.declareTools(ME, lease, [ROWS]);
  broker.setVisible(ME, lease, true);
  return lease;
}
const agentRefresh = (over: Partial<ConnectorAgentRefresh> = {}): ConnectorAgentRefresh => ({ appSessionId: 'app-asker', artifactId: ART, ...ROWS, args: { series: 'revenue' }, dataset: { id: 'live', baseRevision: 4, requestId: '00000000-0000-4000-8000-000000000001' }, ...over });

describe('a page call or watch with a dataset sink', () => {
  it('forwards the sink beside the request with a publishable recheck; a call without one is H’s as it was', async () => {
    grants.put(ROWS, 'read');
    const lease = page();
    expect(await broker.callTool(ME, lease, { ...ROWS, args: { series: 'revenue' } }, { dataset: { id: 'live', baseRevision: 3 } })).toMatchObject({ ok: true, result: META });
    expect(engine.calls[0]!.context.dataset).toEqual({ id: 'live', baseRevision: 3 });
    await broker.callTool(ME, lease, ROWS);
    expect(Object.keys(engine.calls[1]!.context).sort()).toEqual(['fingerprint', 'mode', 'signal']);
  });

  it('answers publishable from the native window read now, and false once the surface or the window hid', async () => {
    grants.put(ROWS, 'read');
    const lease = page();
    engine.hold = true;
    const calling = broker.callTool(ME, lease, ROWS, { dataset: { id: 'live' } });
    await vi.waitFor(() => expect(engine.calls).toHaveLength(1));
    const { publishable, signal } = engine.calls[0]!.context;
    expect(publishable!()).toBe(true);
    shown = false; // a hide no event announced: the recheck hears it
    expect(publishable!()).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(await calling).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
  });

  it('refuses a malformed sink, a tool that is not read-only and an Allow once, calling nothing', async () => {
    const lease = page();
    grants.put(ROWS, 'read');
    for (const options of [{ dataset: { id: '__proto__' } }, { dataset: { id: 'live', baseRevision: -1 } }, { dataset: { id: 'live', requestId: '00000000-0000-4000-8000-000000000001' } }, { dataset: 'live' }, {}]) {
      expect(await broker.callTool(ME, lease, ROWS, options as never), JSON.stringify(options)).toEqual({ ok: false, state: 'invalid', reason: 'request' });
    }
    engine.readOnly = false;
    expect(await broker.callTool(ME, lease, ROWS, { dataset: { id: 'live' } })).toEqual({ ok: false, state: 'invalid', reason: 'notReadOnly' });
    engine.readOnly = true;
    grants.put(ROWS, 'once');
    expect(await broker.callTool(ME, lease, ROWS, { dataset: { id: 'live' } })).toEqual({ ok: false, state: 'revoked', reason: 'wrongMode' });
    expect(engine.calls).toEqual([]);
  });

  it('carries a watch’s sink, with no base, to each of its refreshes', async () => {
    grants.put(ROWS, 'read');
    const lease = page();
    const updates: ConnectorCallOutcome[] = [];
    expect(broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, (update) => updates.push(update), { dataset: { id: 'live' } })).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(30_001);
    expect(engine.calls.map((call) => call.context.dataset)).toEqual([{ id: 'live' }, { id: 'live' }]);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ ok: true, result: META });
    expect(broker.watchTool(ME, lease, { ...ROWS, intervalMs: 30_000 }, () => {}, { dataset: { id: 'live', baseRevision: 3 } })).toEqual({ ok: false, state: 'invalid', reason: 'request' });
  });
});

describe('an agent’s one refresh', () => {
  it('runs through the asking session’s own engine alone, under the owner’s read grant, with no lease', async () => {
    grants.put(ROWS, 'read');
    expect(await broker.refreshForSession(agentRefresh())).toMatchObject({ ok: true, result: META, via: { route: 'engine', sessionId: 'app-asker' } });
    expect(sessions).toEqual([{ appSessionId: 'app-asker', artifactId: ART, tool: ROWS }]);
    expect(engine.resolves).toBe(0); // never another eligible session
    expect(engine.calls[0]!.args).toEqual({ series: 'revenue' });
    expect(engine.calls[0]!.context).toMatchObject({ mode: 'read', dataset: { id: 'live', baseRevision: 4, requestId: '00000000-0000-4000-8000-000000000001' } });
  });

  it('falls to a direct route when the asking session lacks the server, else answers noRoute; refuses without a read grant', async () => {
    sessionHas.clear();
    grants.put(ROWS, 'read');
    expect(await broker.refreshForSession(agentRefresh())).toEqual({ ok: false, state: 'paused', reason: 'noRoute' });
    expect(engine.resolves).toBe(0);
    direct = new Route('direct');
    broker.stop();
    broker = new ConnectorBroker({ routes: [engine, direct], grants, log: () => {}, sessionRoute: async () => null });
    expect(await broker.refreshForSession(agentRefresh())).toMatchObject({ ok: true, via: { route: 'direct' } });
    expect(engine.resolves).toBe(0);
    grants.put(ROWS, 'once');
    expect(await broker.refreshForSession(agentRefresh())).toEqual({ ok: false, state: 'revoked', reason: 'wrongMode' });
    grants.rows.clear();
    expect(await broker.refreshForSession(agentRefresh())).toEqual({ ok: false, state: 'revoked', reason: 'notGranted' });
  });

  it('is publishable until it is aborted, and ends with the owner’s revoke, the store’s revoke, the deletion or main’s stop', async () => {
    grants.put(ROWS, 'read');
    engine.hold = true;
    const stops: [string, () => unknown, ConnectorCallOutcome][] = [
      ['owner revoke', () => broker.revokeTool(ART, ROWS), { ok: false, state: 'revoked', reason: 'revoked' }],
      ['store revoke', () => broker.onGrantChange({ artifactId: ART, ...ROWS, change: 'revoked' }), { ok: false, state: 'revoked', reason: 'revoked' }],
      ['deletion', () => broker.onArtifactDeleted(ART), { ok: false, state: 'revoked', reason: 'revoked' }],
      ['stop', () => broker.stop(), { ok: false, state: 'paused', reason: 'closed' }],
    ];
    for (const [what, stop, expected] of stops) {
      grants.put(ROWS, 'read');
      const running = broker.refreshForSession(agentRefresh());
      await vi.waitFor(() => expect(engine.calls.length).toBeGreaterThan(0));
      const call = engine.calls.pop()!;
      expect(call.context.publishable!(), what).toBe(true);
      const stopped = stop();
      expect(call.context.publishable!(), what).toBe(false);
      expect(await running, what).toEqual(expected);
      await stopped;
    }
  });
});
