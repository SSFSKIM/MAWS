// P3-HD M3b: the broker over a grant-backed route D target (./broker.ts, ./route.ts; docs/doperpowers/plans/
// 2026-10-17-p3-hd-direct-route.md, Decision Log 15 and 18). A grant-backed target is a source whose identified entry
// matches the artifact's durable grant while no tool metadata is known: `readOnly: false` with the `grantBacked` marker,
// never a fabricated read-only fact. The broker's own fresh grant check decides: an existing read grant admits a call
// and a watch, an Allow once a call; a new grant is never made from it. H's broker suite stays as it is.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorAuthorization, ConnectorCallOutcome, ConnectorGrantMode, ConnectorToolRef } from '@shared/artifacts/connectors';
import { ConnectorBroker } from './broker';
import { readTarget, type ConnectorGrantAuthority, type ConnectorRoute, type ConnectorRouteCallContext, type ConnectorRouteTarget } from './route';

const ART = 'dash-1';
const ME = 'window-1';
const ROWS: ConnectorToolRef = { server: 'fixture', tool: 'rows' };
const FP = 'f'.repeat(64);

let mode: ConnectorGrantMode | null;
let calls: ConnectorRouteCallContext[];
let granted: unknown[];
let target: Partial<ConnectorRouteTarget>;
let broker: ConnectorBroker;

const grants: ConnectorGrantAuthority = {
  list: async () => [],
  grant: async (_artifactId, request) => {
    granted.push(request);
    return { ...request, grantedAt: 0 };
  },
  revoke: async () => false,
  check: async (): Promise<ConnectorAuthorization> => (mode === null ? { granted: false, refusal: 'notGranted' } : { granted: true, mode }),
};
const route: ConnectorRoute = {
  route: 'direct',
  resolve: async () =>
    ({
      fingerprint: FP,
      readOnly: false,
      call: async (_args: Record<string, unknown>, context: ConnectorRouteCallContext) => {
        calls.push(context);
        return { ok: true, result: { rows: calls.length } };
      },
      ...target,
    }) as ConnectorRouteTarget,
};

beforeEach(() => {
  vi.useFakeTimers();
  mode = 'read';
  calls = [];
  granted = [];
  target = { grantBacked: true };
  broker = new ConnectorBroker({ routes: [route], grants, log: () => {} });
  broker.setWindowShown(ME, true);
});
afterEach(() => {
  broker.stop();
  vi.useRealTimers();
});

function lease(): string {
  const id = broker.open(ME, ART);
  broker.declareTools(ME, id, [ROWS]);
  broker.setVisible(ME, id, true);
  return id;
}
async function watchUpdates(): Promise<ConnectorCallOutcome[]> {
  const updates: ConnectorCallOutcome[] = [];
  expect(broker.watchTool(ME, lease(), { ...ROWS, intervalMs: 30_000 }, (update) => updates.push(update))).toMatchObject({ ok: true });
  await vi.advanceTimersByTimeAsync(0);
  return updates;
}

describe('a grant-backed target', () => {
  it('a watch under an existing read grant refreshes, the route told the read mode the broker’s check admitted', async () => {
    expect(await watchUpdates()).toEqual([{ ok: true, result: { rows: 1 }, fetchedAt: expect.any(Number), via: { route: 'direct' } }]);
    expect(calls).toMatchObject([{ fingerprint: FP, mode: 'read' }]);
  });

  it('a call under an existing read grant or an Allow once runs, each under its own mode', async () => {
    expect(await broker.callTool(ME, lease(), ROWS)).toMatchObject({ ok: true });
    mode = 'once';
    expect(await broker.callTool(ME, lease(), ROWS)).toMatchObject({ ok: true });
    expect(calls.map((context) => context.mode)).toEqual(['read', 'once']);
  });

  it('a watch under an Allow once is refused by the grant’s mode, and none without a grant', async () => {
    mode = 'once';
    expect(await watchUpdates()).toEqual([{ ok: false, state: 'revoked', reason: 'wrongMode' }]);
    mode = null;
    expect(await broker.callTool(ME, lease(), ROWS)).toEqual({ ok: false, state: 'revoked', reason: 'notGranted' });
    expect(calls).toEqual([]);
  });

  it('no new grant of either mode is made from grant-backed metadata: paused, no route', async () => {
    for (const gestureMode of ['read', 'once'] as const) expect(await broker.grantTool(ART, { ...ROWS, mode: gestureMode })).toEqual({ ok: false, state: 'paused', reason: 'noRoute' });
    expect(granted).toEqual([]);
  });

  it('without the marker a target that may write is still never watched (H’s rule, unchanged)', async () => {
    target = {};
    expect(await watchUpdates()).toEqual([{ ok: false, state: 'invalid', reason: 'notReadOnly' }]);
    expect(calls).toEqual([]);
  });
});

describe('readTarget', () => {
  const call = async () => ({ ok: true as const, result: null });
  it('admits the grant-backed marker only with readOnly false', () => {
    expect(readTarget({ fingerprint: FP, readOnly: false, grantBacked: true, call })).not.toBeNull();
    expect(readTarget({ fingerprint: FP, readOnly: true, grantBacked: true, call })).toBeNull();
    expect(readTarget({ fingerprint: FP, readOnly: false, grantBacked: false, call })).toBeNull();
  });
});
