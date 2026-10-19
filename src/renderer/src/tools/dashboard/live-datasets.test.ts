// E3 M3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3, R4; the M3 entry): a dashboard tab's live
// datasets over H's connector surface. One surface per tab, opened at the first showing that has a query; one watch per
// scheduled query (its request read from the live descriptor, its sink the dataset with no base), recreated only when
// the query's source settings change, never when a refresh writes its snapshot or state; a manual query is called only
// by the owner's Refresh while shown. The trusted visibility shows and hides the surface (H suspends its watches); the
// tab's end closes it. Grant, revoke and Start are the owner's gestures; nothing starts a session from a mount or a
// timer. What the bridge answers informs a transient pause only; the descriptor stays the data's authority.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorSurface } from '@artifacts/host';
import { removeDataset, setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { datasetErrorOf, sourceLabel } from '@artifacts/dashboard/states'; // E3 panel
import { newDoc, type Doc } from '@artifacts/yjs';
import { CONNECTOR_DECLARE_LIMIT, type ConnectorCallOutcome, type ConnectorGrant, type ConnectorGrantOutcome, type ConnectorWatchStart } from '@shared/artifacts/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactSessionEnd, ArtifactSessionStart } from '../../artifacts/session-context';
import { LiveDatasetsController, type LiveDatasetsDeps } from './live-datasets';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const AT = Date.UTC(2026, 9, 17, 9, 0);
const SESSION = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;

type QueryPatch = { args?: Record<string, unknown>; schedule?: number; staleAfter?: number; server?: string; tool?: string };
const query = (patch: QueryPatch = {}, snapshot: { ref: string; at: number } | null = null, more: Partial<DatasetDescriptor> = {}): DatasetDescriptor => {
  const { server = 'fixture', tool = 'rows', args = { region: 'north' }, ...policy } = patch;
  const source = { kind: 'query' as const, server, tool, args, ...policy, snapshot };
  return (snapshot
    ? { title: 'Live sales', source, columns: [{ name: 'v', type: 'number' }], rows: 2, updated: { at: snapshot.at, by: { kind: 'human' } }, state: { status: 'ok', at: snapshot.at }, ...more }
    : { title: 'Live sales', source, columns: [], rows: 0, state: { status: 'ok', at: AT }, ...more }) as DatasetDescriptor;
};
const file: DatasetDescriptor = {
  title: 'Sales file',
  source: { kind: 'file', ref: 'assets/sales.csv', name: 'sales.csv', format: 'csv', sha256: 'c'.repeat(64), size: 64 },
  columns: [{ name: 'v', type: 'number' }],
  rows: 1,
  updated: { at: AT, by: { kind: 'human' } },
  state: { status: 'ok', at: AT },
};
const grant = (server = 'fixture', tool = 'rows'): ConnectorGrant => ({ server, tool, fingerprint: 'fp', mode: 'read', grantedAt: AT });
const DATASET = (id: string) => ({ ok: true as const, result: { status: 'dataset', artifactId: A, id, revision: 9, columns: [{ name: 'v', type: 'number' }], rows: 2 }, fetchedAt: AT, via: { route: 'engine' as const } });
const FAILED = (reason: string) => ({ ok: true as const, result: { status: 'failed', reason }, fetchedAt: AT, via: { route: 'engine' as const } });
const NO_ROUTE: ConnectorCallOutcome = { ok: false, state: 'paused', reason: 'noRoute' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function fakeSurface() {
  let n = 0;
  const log: string[] = [];
  const listeners = new Map<string, (update: ConnectorCallOutcome) => void>();
  const watchGate: { next: ReturnType<typeof deferred<ConnectorWatchStart>> | null } = { next: null };
  const callGate: { next: ReturnType<typeof deferred<ConnectorCallOutcome>> | null } = { next: null };
  const surface = {
    declareTools: vi.fn(async (tools: { server: string; tool: string }[]) => {
      log.push(`declare ${tools.map((t) => `${t.server}/${t.tool}`).join(',')}`);
      return { ok: true as const, declared: tools };
    }),
    callTool: vi.fn(async (request: { server: string; tool: string; args?: unknown }, options?: unknown): Promise<ConnectorCallOutcome> => {
      log.push(`call ${request.tool} ${JSON.stringify(request.args)} ${JSON.stringify(options)}`);
      if (callGate.next) {
        const gate = callGate.next;
        callGate.next = null;
        return gate.promise;
      }
      return DATASET('sales');
    }),
    watchTool: vi.fn(async (request: { tool: string; args?: unknown; intervalMs: number }, listener: (update: ConnectorCallOutcome) => void, options?: unknown): Promise<ConnectorWatchStart> => {
      const watchId = `w${++n}`;
      log.push(`watch ${watchId} ${request.tool} ${JSON.stringify(request.args)} ${request.intervalMs} ${JSON.stringify(options)}`);
      listeners.set(watchId, listener);
      if (watchGate.next) {
        const gate = watchGate.next;
        watchGate.next = null;
        const start = await gate.promise;
        return start.ok ? { ...start, watchId } : start;
      }
      return { ok: true, watchId, intervalMs: request.intervalMs };
    }),
    unwatchTool: vi.fn(async (watchId: string) => {
      log.push(`unwatch ${watchId}`);
      listeners.delete(watchId);
      return true;
    }),
    refreshWatch: vi.fn(async (watchId: string) => {
      log.push(`refresh ${watchId}`);
      return true;
    }),
    setVisible: vi.fn((visible: boolean) => log.push(`visible ${visible}`)),
    close: vi.fn(() => log.push('close')),
  };
  return { surface: surface as unknown as ConnectorSurface & typeof surface, log, listeners, watchGate, callGate };
}

function world(options: { grants?: ConnectorGrant[] } = {}) {
  const doc: Doc = newDoc();
  const fake = fakeSurface();
  let grants = options.grants ?? [grant()];
  const changed = new Set<(artifactId: string) => void>();
  const host = {
    openConnectors: vi.fn(() => fake.surface),
    connectorGrants: vi.fn(async () => grants),
    grantConnectorTool: vi.fn(async (_a: string, tool: { server: string; tool: string; mode: string }): Promise<ConnectorGrantOutcome> => {
      grants = [...grants, grant(tool.server, tool.tool)];
      return { ok: true, grant: grant(tool.server, tool.tool) };
    }),
    revokeConnectorTool: vi.fn(async (_a: string, tool: { server: string; tool: string }) => {
      grants = grants.filter((g) => g.server !== tool.server || g.tool !== tool.tool);
      return true;
    }),
  };
  const startSession = vi.fn<(previous: AppSessionId | null) => Promise<ArtifactSessionStart>>(async () => ({ status: 'ready', appSessionId: SESSION }));
  let clock = AT;
  const deps: LiveDatasetsDeps = {
    artifactId: A,
    host,
    onGrantChanged: (listener) => {
      changed.add(listener);
      return () => changed.delete(listener);
    },
    startSession,
    now: () => clock,
    log: () => {},
  };
  const live = new LiveDatasetsController(deps);
  controllers.push(live);
  return {
    doc,
    live,
    host,
    startSession,
    ...fake,
    setGrants: (next: ConnectorGrant[]) => (grants = next),
    announce: () => changed.forEach((listener) => listener(A)),
    setClock: (at: number) => (clock = at),
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};
const controllers: LiveDatasetsController[] = [];
beforeEach(() => {
  vi.useFakeTimers({ now: AT });
});
afterEach(() => {
  for (const live of controllers.splice(0)) live.dispose();
  vi.useRealTimers();
});

describe('a dashboard tab’s live datasets: watches (E3 M3)', () => {
  it('opens nothing until a query is shown, then one surface, a declaration and one watch per scheduled query from the live source', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    setDataset(w.doc, 'costs', query({ tool: 'costs', schedule: 300, args: { b: 1 } }));
    setDataset(w.doc, 'manual', query({ tool: 'manual' }));
    setDataset(w.doc, 'file', file);
    w.live.follow(w.doc);
    await settle();
    expect(w.host.openConnectors).not.toHaveBeenCalled(); // never shown: no lease, no grant read
    expect(w.host.connectorGrants).not.toHaveBeenCalled();
    w.live.setShown(true);
    await settle();
    expect(w.host.openConnectors).toHaveBeenCalledTimes(1);
    expect(w.host.openConnectors).toHaveBeenCalledWith(A);
    expect(w.surface.setVisible).toHaveBeenLastCalledWith(true);
    const declare = w.log.findIndex((line) => line.startsWith('declare'));
    const watches = w.log.filter((line) => line.startsWith('watch'));
    expect(watches).toEqual([`watch w1 costs {"b":1} 300000 {"dataset":{"id":"costs"}}`, `watch w2 rows {"region":"north"} 60000 {"dataset":{"id":"sales"}}`]);
    expect(declare).toBeGreaterThanOrEqual(0);
    expect(declare).toBeLessThan(w.log.indexOf(watches[0]!));
    expect(w.surface.callTool).not.toHaveBeenCalled(); // the manual query waits for the owner's Refresh
    expect(w.host.connectorGrants).toHaveBeenCalledTimes(1);
  });

  it('suspends while hidden and shows again without new watches; its end unwatches nothing twice and closes the surface', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.live.setShown(false);
    w.live.setShown(true);
    w.live.setShown(true);
    await settle();
    expect(w.log.filter((line) => line.startsWith('visible'))).toEqual(['visible true', 'visible false', 'visible true']);
    expect(w.surface.watchTool).toHaveBeenCalledTimes(1);
    w.live.dispose();
    expect(w.surface.setVisible).toHaveBeenLastCalledWith(false);
    expect(w.surface.close).toHaveBeenCalledTimes(1);
    w.live.dispose();
    expect(w.surface.close).toHaveBeenCalledTimes(1);
  });

  it('keeps its watch when a refresh writes the snapshot, its state or metadata, and restarts it only on a source settings change', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60, staleAfter: 120 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    expect(w.surface.watchTool).toHaveBeenCalledTimes(1);
    // a refresh's commit: a new snapshot, provenance and state, then an error state, then staleAfter and title alone
    setDataset(w.doc, 'sales', query({ schedule: 60, staleAfter: 120 }, { ref: 'assets/query-1.json', at: AT + 1 }));
    setDataset(w.doc, 'sales', query({ schedule: 60, staleAfter: 120 }, { ref: 'assets/query-1.json', at: AT + 1 }, { state: { status: 'error', message: 'not a table', at: AT + 2 } }));
    setDataset(w.doc, 'sales', query({ schedule: 60, staleAfter: 999, args: { region: 'north' } }, { ref: 'assets/query-2.json', at: AT + 3 }, { title: 'Renamed' }));
    await settle();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(w.surface.watchTool).toHaveBeenCalledTimes(1);
    expect(w.surface.unwatchTool).not.toHaveBeenCalled();
    expect(w.surface.callTool).not.toHaveBeenCalled();
    // the arguments change: the old watch ends and one new watch starts
    setDataset(w.doc, 'sales', query({ schedule: 60, args: { region: 'south' } }));
    await settle();
    expect(w.log.slice(-2)).toEqual(['unwatch w1', `watch w2 rows {"region":"south"} 60000 {"dataset":{"id":"sales"}}`]);
    // the schedule changes: restarted at its new interval
    setDataset(w.doc, 'sales', query({ schedule: 300, args: { region: 'south' } }));
    await settle();
    expect(w.log.slice(-2)).toEqual(['unwatch w2', `watch w3 rows {"region":"south"} 300000 {"dataset":{"id":"sales"}}`]);
    // the schedule goes (manual): unwatched, nothing new
    setDataset(w.doc, 'sales', query({ args: { region: 'south' } }));
    await settle();
    expect(w.log.at(-1)).toBe('unwatch w3');
    expect(w.surface.watchTool).toHaveBeenCalledTimes(3);
  });

  it('ends a removed dataset’s watch and one that became a file', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    setDataset(w.doc, 'costs', query({ tool: 'costs', schedule: 60 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    removeDataset(w.doc, 'sales');
    setDataset(w.doc, 'costs', file);
    await settle();
    expect(w.surface.unwatchTool.mock.calls.map(([id]) => id).sort()).toEqual(['w1', 'w2']);
    expect(w.live.snapshot().queries.size).toBe(0);
  });

  it('unwatches a watch whose start answers after its source changed, the tab ended or the dataset went', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    const late = deferred<ConnectorWatchStart>();
    w.watchGate.next = late;
    w.live.setShown(true);
    await settle();
    setDataset(w.doc, 'sales', query({ schedule: 60, args: { region: 'south' } }));
    await settle();
    const superseded = w.listeners.get('w1')!;
    late.resolve({ ok: true, watchId: 'ignored', intervalMs: 60_000 });
    await settle();
    expect(w.surface.unwatchTool).toHaveBeenCalledWith('w1'); // the superseded start's own watch
    expect(w.surface.unwatchTool).not.toHaveBeenCalledWith('w2');
    // a refresh the superseded watch publishes is not heard
    superseded(NO_ROUTE);
    expect(w.live.snapshot().queries.get('sales')?.pause).toBeNull();

    const afterEnd = deferred<ConnectorWatchStart>();
    w.watchGate.next = afterEnd;
    setDataset(w.doc, 'sales', query({ schedule: 120, args: { region: 'south' } }));
    await settle();
    w.live.dispose();
    afterEnd.resolve({ ok: true, watchId: 'ignored', intervalMs: 120_000 });
    await settle();
    w.listeners.get('w3')?.(NO_ROUTE); // after the end: no throw, nothing published
    expect(w.surface.close).toHaveBeenCalledTimes(1);
  });

  it('says the app’s watch limit and starts the watch again on the owner’s Refresh', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    const limited = deferred<ConnectorWatchStart>();
    w.watchGate.next = limited;
    w.live.setShown(true);
    await settle();
    limited.resolve({ ok: false, state: 'invalid', reason: 'watchLimit' });
    await settle();
    expect(w.live.snapshot().queries.get('sales')?.pause).toBe('watchLimit');
    await w.live.refresh('sales');
    expect(w.surface.watchTool).toHaveBeenCalledTimes(2);
    expect(w.live.snapshot().queries.get('sales')?.pause).toBeNull();
  });
});

describe('a dashboard tab’s live datasets: what the bridge answers (E3 M3)', () => {
  async function watched() {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 30 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    const hear = (update: ConnectorCallOutcome) => w.listeners.get('w1')!(update);
    return { ...w, hear, pause: () => w.live.snapshot().queries.get('sales')?.pause };
  }

  it('reads no live session as a pause with Start, and a published dataset as its end', async () => {
    const w = await watched();
    w.hear(NO_ROUTE);
    expect(w.pause()).toBe('noRoute');
    w.hear(DATASET('sales'));
    expect(w.pause()).toBeNull();
  });

  it('never paints a stale completion as a failure, and leaves a recorded tool, validation or timeout error to the descriptor', async () => {
    const w = await watched();
    for (const reason of ['stale', 'validation', 'toolError', 'timeout']) {
      w.hear(NO_ROUTE);
      w.hear(FAILED(reason));
      expect(w.pause()).toBeNull();
    }
  });

  it('keeps a pause through the surface’s own hide or close, and names permission and route failures in closed words', async () => {
    const w = await watched();
    w.hear(NO_ROUTE);
    w.hear({ ok: false, state: 'paused', reason: 'hidden' });
    w.hear({ ok: false, state: 'paused', reason: 'closed' });
    expect(w.pause()).toBe('noRoute');
    w.hear({ ok: false, state: 'paused', reason: 'unavailable' });
    expect(w.pause()).toBe('noRoute');
    w.hear({ ok: false, state: 'revoked', reason: 'notGranted' });
    expect(w.pause()).toBe('notAllowed');
    w.hear({ ok: false, state: 'revoked', reason: 'fingerprintChanged' });
    expect(w.pause()).toBe('allowChanged');
    w.hear({ ok: false, state: 'revoked', reason: 'wrongMode' });
    expect(w.pause()).toBe('mayWrite');
    w.hear({ ok: false, state: 'failed', reason: 'routeFailed' });
    expect(w.pause()).toBe('failed');
  });

  it('forgets a watch H ended (a tool not read-only) so the owner’s Refresh starts it again', async () => {
    const w = await watched();
    w.hear({ ok: false, state: 'invalid', reason: 'notReadOnly' });
    expect(w.pause()).toBe('mayWrite');
    await w.live.refresh('sales');
    expect(w.surface.refreshWatch).not.toHaveBeenCalled();
    expect(w.surface.watchTool).toHaveBeenCalledTimes(2);
  });

  it('ignores an answer that is not a dataset phase rather than writing anything from it', async () => {
    const w = await watched();
    w.hear(NO_ROUTE);
    w.hear({ ok: true, result: { rows: [[1]] }, fetchedAt: AT, via: { route: 'engine' } });
    expect(w.pause()).toBe('noRoute');
  });
});

describe('a dashboard tab’s live datasets: the owner’s gestures (E3 M3)', () => {
  it('Refresh runs a manual query once through its dataset sink, only while shown, and a scheduled one through its watch', async () => {
    const w = world();
    setDataset(w.doc, 'manual', query({ tool: 'manual', args: { b: 2, a: 1 } }));
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    await w.live.refresh('manual'); // never shown: nothing
    expect(w.surface.callTool).not.toHaveBeenCalled();
    w.live.setShown(true);
    await settle();
    await w.live.refresh('manual');
    expect(w.log.filter((line) => line.startsWith('call'))).toEqual([`call manual {"b":2,"a":1} {"dataset":{"id":"manual"}}`]);
    await w.live.refresh('sales');
    expect(w.surface.refreshWatch).toHaveBeenCalledWith('w1');
    w.live.setShown(false);
    await w.live.refresh('manual');
    expect(w.surface.callTool).toHaveBeenCalledTimes(1);
  });

  it('a manual refresh answered after its query changed or the tab ended publishes nothing', async () => {
    const w = world();
    setDataset(w.doc, 'manual', query({ tool: 'manual' }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    const late = deferred<ConnectorCallOutcome>();
    w.callGate.next = late;
    const asked = w.live.refresh('manual');
    await settle();
    expect(w.live.snapshot().queries.get('manual')?.busy).toBe('refresh');
    setDataset(w.doc, 'manual', query({ tool: 'manual', args: { region: 'south' } }));
    late.resolve(NO_ROUTE);
    await asked;
    expect(w.live.snapshot().queries.get('manual')?.pause).toBeNull();
    expect(w.live.snapshot().queries.get('manual')?.busy).toBeNull();

    const afterEnd = deferred<ConnectorCallOutcome>();
    w.callGate.next = afterEnd;
    const ending = w.live.refresh('manual');
    await settle();
    w.live.dispose();
    afterEnd.resolve(NO_ROUTE);
    await expect(ending).resolves.toBeUndefined();
  });

  it('grants read access through H, re-reads the grants and follows a committed change announced for the artifact', async () => {
    const w = world({ grants: [] });
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    expect(w.live.snapshot().queries.get('sales')?.permission).toBe('none');
    await w.live.grant('sales');
    expect(w.host.grantConnectorTool).toHaveBeenCalledWith(A, { server: 'fixture', tool: 'rows', mode: 'read' });
    expect(w.live.snapshot().queries.get('sales')?.permission).toBe('read');
    w.setGrants([]);
    w.announce();
    await settle();
    expect(w.live.snapshot().queries.get('sales')?.permission).toBe('none');
  });

  it('a grant refused for want of a route shows the pause and its Start; one that is not read-only says so', async () => {
    const w = world({ grants: [] });
    setDataset(w.doc, 'sales', query());
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.host.grantConnectorTool.mockResolvedValueOnce(NO_ROUTE as ConnectorGrantOutcome);
    await w.live.grant('sales');
    expect(w.live.snapshot().queries.get('sales')?.pause).toBe('noRoute');
    expect(w.live.snapshot().needsStart).toBe(true);
    w.host.grantConnectorTool.mockResolvedValueOnce({ ok: false, state: 'invalid', reason: 'notReadOnly' });
    await w.live.grant('sales');
    expect(w.live.snapshot().queries.get('sales')?.pause).toBe('mayWrite');
  });

  it('a not-read-only refusal lasts until the query’s source changes (E3 M3 fix)', async () => {
    const w = world({ grants: [] });
    setDataset(w.doc, 'sales', query());
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.host.grantConnectorTool.mockResolvedValueOnce({ ok: false, state: 'invalid', reason: 'notReadOnly' });
    await w.live.grant('sales');
    expect(w.live.snapshot().queries.get('sales')?.pause).toBe('mayWrite');
    setDataset(w.doc, 'sales', query({ schedule: 60 })); // a policy change alone keeps it
    await settle();
    expect(w.live.snapshot().queries.get('sales')?.pause).toBe('mayWrite');
    setDataset(w.doc, 'sales', query({ tool: 'rows-read' }));
    await settle();
    expect(w.live.snapshot().queries.get('sales')?.pause).toBeNull();
  });

  it('revokes through H at once and reads not allowed after, the descriptor untouched', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }, { ref: 'assets/query-1.json', at: AT }));
    const before = JSON.stringify(w.doc.get('datasets').getAttr('sales'));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    expect(w.live.snapshot().queries.get('sales')?.permission).toBe('read');
    await w.live.revoke('sales');
    expect(w.host.revokeConnectorTool).toHaveBeenCalledWith(A, { server: 'fixture', tool: 'rows' });
    expect(w.live.snapshot().queries.get('sales')?.permission).toBe('none');
    expect(JSON.stringify(w.doc.get('datasets').getAttr('sales'))).toBe(before);
  });

  it('starts a session only on the owner’s Start, never from a mount, a pause or ten minutes of timers', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 30, staleAfter: 30 }, { ref: 'assets/query-1.json', at: AT }));
    setDataset(w.doc, 'manual', query({ tool: 'manual' }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.listeners.get('w1')!(NO_ROUTE);
    await w.live.refresh('manual');
    w.callGate.next = null;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    w.live.setShown(false);
    w.live.setShown(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(w.startSession).not.toHaveBeenCalled();
    expect(w.surface.callTool).toHaveBeenCalledTimes(1); // the owner's one Refresh; no timer calls a manual query

    // the owner's Start: the session the context names, then the paused queries refreshed
    w.listeners.get('w1')!(NO_ROUTE);
    w.surface.callTool.mockResolvedValueOnce(NO_ROUTE);
    await w.live.refresh('manual');
    expect(w.live.snapshot().needsStart).toBe(true);
    await w.live.start();
    await settle();
    expect(w.startSession).toHaveBeenCalledTimes(1);
    expect(w.startSession).toHaveBeenCalledWith(null);
    expect(w.live.snapshot().start).toEqual({ phase: 'ready', appSessionId: SESSION });
    expect(w.surface.refreshWatch).toHaveBeenCalledWith('w1');
    expect(w.surface.callTool).toHaveBeenCalledTimes(3);
  });

  it('a Start whose setup runs settles from its end, retries the session it named, and is let go with the tab', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 30 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.listeners.get('w1')!(NO_ROUTE);
    w.startSession.mockResolvedValueOnce({ status: 'card', appSessionId: SESSION, words: 'Trust this folder first' });
    await w.live.start();
    expect(w.live.snapshot().start).toEqual({ phase: 'card', appSessionId: SESSION, words: 'Trust this folder first' });
    const end = deferred<ArtifactSessionEnd>();
    const cancel = vi.fn();
    w.startSession.mockResolvedValueOnce({ status: 'starting', appSessionId: SESSION, settled: end.promise, cancel });
    const starting = w.live.start();
    await settle();
    expect(w.startSession).toHaveBeenLastCalledWith(SESSION);
    expect(w.live.snapshot().start).toEqual({ phase: 'starting', appSessionId: SESSION });
    await w.live.start(); // one at a time
    expect(w.startSession).toHaveBeenCalledTimes(2);
    w.live.dispose();
    expect(cancel).toHaveBeenCalledTimes(1);
    end.resolve({ status: 'ready', appSessionId: SESSION });
    await starting;
    expect(w.surface.refreshWatch).not.toHaveBeenCalled();
  });

  // P3-F dashboard-live-ui wave (scalpel-3#1): a Start that settles while the dashboard is hidden calls nothing then; at
  // the next showing each manual query it left paused for want of a session refreshes once, so the no-session note and
  // Start go, and later showings call nothing more unasked
  it('a Start settling while hidden refreshes its paused manual queries once at the next showing, never while hidden', async () => {
    const w = world();
    setDataset(w.doc, 'manual', query({ tool: 'manual' }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.surface.callTool.mockResolvedValueOnce(NO_ROUTE);
    await w.live.refresh('manual');
    expect(w.live.snapshot().needsStart).toBe(true);
    const end = deferred<ArtifactSessionEnd>();
    w.startSession.mockResolvedValueOnce({ status: 'starting', appSessionId: SESSION, settled: end.promise, cancel: vi.fn() });
    const starting = w.live.start();
    await settle();
    w.live.setShown(false); // the owner switches tabs while the session starts
    end.resolve({ status: 'ready', appSessionId: SESSION });
    await starting;
    await settle();
    expect(w.live.snapshot().start).toEqual({ phase: 'ready', appSessionId: SESSION });
    expect(w.surface.callTool).toHaveBeenCalledTimes(1); // nothing called while hidden
    w.live.setShown(true);
    await settle();
    expect(w.surface.callTool).toHaveBeenCalledTimes(2);
    expect(w.live.snapshot().queries.get('manual')?.pause).toBeNull();
    expect(w.live.snapshot().needsStart).toBe(false);
    w.live.setShown(false);
    w.live.setShown(true);
    await settle();
    expect(w.surface.callTool).toHaveBeenCalledTimes(2); // one call for the one Start
  });
});

describe('a dashboard tab’s live datasets: the stale label’s clock (E3 M3)', () => {
  it('tells its views at the exact stale boundary only while shown, calling nothing', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ staleAfter: 120 }, { ref: 'assets/query-1.json', at: AT }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    const told = vi.fn();
    const stop = w.live.subscribe(told);
    w.setClock(AT + 119_999);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(told).not.toHaveBeenCalled();
    w.setClock(AT + 120_000);
    await vi.advanceTimersByTimeAsync(1);
    expect(told).toHaveBeenCalledTimes(1);
    // a second query, stale later, while hidden: no tick until shown again, which tells at once
    setDataset(w.doc, 'costs', query({ tool: 'costs', staleAfter: 300 }, { ref: 'assets/query-2.json', at: AT + 120_000 }));
    await settle();
    told.mockClear();
    w.live.setShown(false);
    w.setClock(AT + 500_000);
    await vi.advanceTimersByTimeAsync(400_000);
    expect(told).toHaveBeenCalledTimes(1); // the hide itself
    w.live.setShown(true);
    expect(told).toHaveBeenCalledTimes(2);
    expect(w.surface.callTool).not.toHaveBeenCalled();
    expect(w.startSession).not.toHaveBeenCalled();
    stop();
  });
});

// E3 M3 fix (Decision Log 11, 12): at the watch cap a hidden dashboard's watch may yield its slot to a visible request.
// Shown again, the dashboard asks each watch's handle (`refreshWatch`) once it is due (at once if it is, else at its due
// time while shown); false means the handle is gone, so the watch is unwatched and registered again, once. A handle that
// answers true (kept, or its refresh running) is never registered twice; a query paused at the cap tries again.
describe('a dashboard tab’s live datasets: a watch that yielded its slot (E3 M3 fix)', () => {
  async function shownThenHidden(heardAt: number) {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.setClock(heardAt);
    w.listeners.get('w1')!(DATASET('sales'));
    w.live.setShown(false);
    return w;
  }

  it('shown after its interval, finds the evicted handle and registers it again once', async () => {
    const w = await shownThenHidden(AT);
    w.setClock(AT + 120_000);
    w.surface.refreshWatch.mockResolvedValueOnce(false);
    w.live.setShown(true);
    await settle();
    expect(w.surface.refreshWatch).toHaveBeenCalledWith('w1', { probe: true }); // E3 panel: recovery probes
    expect(w.log.filter((line) => /^(unwatch|watch)/.test(line)).slice(-2)).toEqual(['unwatch w1', `watch w2 rows {"region":"north"} 60000 {"dataset":{"id":"sales"}}`]);
    w.live.setShown(false);
    w.live.setShown(true);
    await settle();
    expect(w.surface.watchTool).toHaveBeenCalledTimes(2);
  });

  it('a handle that answers true (kept or running) is not registered again', async () => {
    const w = await shownThenHidden(AT);
    w.setClock(AT + 120_000);
    w.live.setShown(true);
    await settle();
    expect(w.surface.refreshWatch).toHaveBeenCalledTimes(1);
    expect(w.surface.watchTool).toHaveBeenCalledTimes(1);
    expect(w.surface.unwatchTool).not.toHaveBeenCalled();
  });

  it('shown before it is due, asks at its due time while shown, never while hidden', async () => {
    const w = await shownThenHidden(AT);
    w.setClock(AT + 10_000);
    w.live.setShown(true);
    await settle();
    expect(w.surface.refreshWatch).not.toHaveBeenCalled();
    w.live.setShown(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.surface.refreshWatch).not.toHaveBeenCalled();
    w.setClock(AT + 70_000);
    w.surface.refreshWatch.mockResolvedValueOnce(false);
    w.live.setShown(true);
    await settle();
    expect(w.surface.refreshWatch).toHaveBeenCalledTimes(1);
    expect(w.surface.watchTool).toHaveBeenCalledTimes(2);

    const v = await shownThenHidden(AT);
    v.setClock(AT + 10_000);
    v.live.setShown(true);
    await vi.advanceTimersByTimeAsync(49_999);
    expect(v.surface.refreshWatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(v.surface.refreshWatch).toHaveBeenCalledWith('w1', { probe: true }); // E3 panel: recovery probes
  });

  it('the owner’s Refresh of an evicted handle registers it again', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.surface.refreshWatch.mockResolvedValueOnce(false);
    await w.live.refresh('sales');
    await settle();
    expect(w.log.filter((line) => /^(unwatch|watch)/.test(line)).slice(-2)).toEqual(['unwatch w1', `watch w2 rows {"region":"north"} 60000 {"dataset":{"id":"sales"}}`]);
  });

  it('a query paused at the cap tries its watch again when shown again', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    const limited = deferred<ConnectorWatchStart>();
    w.watchGate.next = limited;
    w.live.setShown(true);
    await settle();
    limited.resolve({ ok: false, state: 'invalid', reason: 'watchLimit' });
    await settle();
    w.live.setShown(false);
    w.live.setShown(true);
    await settle();
    expect(w.surface.watchTool).toHaveBeenCalledTimes(2);
    expect(w.live.snapshot().queries.get('sales')?.pause).toBeNull();
  });
});

// E3 M3 fix: a stale boundary past the platform's longest timer (staleAfter of 30 days) is reached by re-arming capped
// delays, telling the views only once it has passed; nothing is called.
describe('a dashboard tab’s live datasets: a long stale threshold (E3 M3 fix)', () => {
  it('re-arms toward a boundary beyond the longest timer and tells the views only at it', async () => {
    const w = world();
    const days30 = 30 * 86_400;
    setDataset(w.doc, 'sales', query({ staleAfter: days30 }, { ref: 'assets/query-1.json', at: AT }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    const told = vi.fn();
    w.live.subscribe(told);
    const MAX = 2 ** 31 - 1;
    w.setClock(AT + MAX);
    await vi.advanceTimersByTimeAsync(MAX);
    expect(told).not.toHaveBeenCalled(); // the capped timer fired early and re-armed
    w.setClock(AT + days30 * 1000);
    await vi.advanceTimersByTimeAsync(days30 * 1000 - MAX);
    expect(told).toHaveBeenCalledTimes(1);
    expect(w.surface.callTool).not.toHaveBeenCalled();
    expect(w.startSession).not.toHaveBeenCalled();
  });
});

// E3 M3 residual (the retained review's finding): a recovery probe armed for a watch's due time is withdrawn as soon as
// the watch proves its handle exists (a refresh of it heard, or the handle answering true to any ask), and an ask whose
// answer arrives after a later show or a heard refresh changes nothing, so no extra refresh runs before the next due.
describe('a dashboard tab’s live datasets: a recovery probe made obsolete (E3 M3 residual)', () => {
  async function armed() {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.listeners.get('w1')!(DATASET('sales')); // completion at t0
    w.live.setShown(false);
    w.setClock(AT + 10_000);
    w.live.setShown(true); // not due: a probe armed for t60
    await settle();
    expect(w.surface.refreshWatch).not.toHaveBeenCalled();
    return w;
  }

  it('the owner’s Refresh completing first withdraws the armed probe: nothing asked again before the next due', async () => {
    const w = await armed();
    await vi.advanceTimersByTimeAsync(10_000);
    w.setClock(AT + 20_000);
    await w.live.refresh('sales'); // the owner's Refresh at t20: the handle answers true
    expect(w.surface.refreshWatch).toHaveBeenCalledTimes(1);
    w.listeners.get('w1')!(DATASET('sales')); // its completion at t20: H's next is due at t80
    await vi.advanceTimersByTimeAsync(45_000); // past t60
    expect(w.surface.refreshWatch).toHaveBeenCalledTimes(1);
    expect(w.surface.watchTool).toHaveBeenCalledTimes(1);
  });

  it('a scheduled refresh heard before the probe’s time withdraws it', async () => {
    const w = await armed();
    await vi.advanceTimersByTimeAsync(30_000);
    w.setClock(AT + 40_000);
    w.listeners.get('w1')!(DATASET('sales')); // H's own refresh of the watch ended: the handle exists
    await vi.advanceTimersByTimeAsync(30_000); // past t60
    expect(w.surface.refreshWatch).not.toHaveBeenCalled();
    expect(w.surface.watchTool).toHaveBeenCalledTimes(1);
  });

  it('an ask answered false after a refresh of the watch was heard, or after the dashboard was shown again, registers nothing', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.listeners.get('w1')!(DATASET('sales'));
    w.live.setShown(false);
    w.setClock(AT + 70_000);
    const late = deferred<boolean>();
    w.surface.refreshWatch.mockImplementationOnce(() => late.promise);
    w.live.setShown(true); // due: asked at once, the answer slow
    await settle();
    w.listeners.get('w1')!(DATASET('sales')); // the watch refreshed meanwhile
    late.resolve(false);
    await settle();
    expect(w.surface.unwatchTool).not.toHaveBeenCalled();
    expect(w.surface.watchTool).toHaveBeenCalledTimes(1);

    const slow = deferred<boolean>();
    w.surface.refreshWatch.mockImplementationOnce(() => slow.promise);
    w.live.setShown(false);
    w.setClock(AT + 200_000);
    w.live.setShown(true); // due: asked, slow
    await settle();
    w.live.setShown(false);
    w.live.setShown(true); // shown again: a second ask, answered true
    await settle();
    slow.resolve(false); // the first ask's late answer belongs to an earlier showing
    await settle();
    expect(w.surface.refreshWatch).toHaveBeenCalledTimes(3);
    expect(w.surface.unwatchTool).not.toHaveBeenCalled();
    expect(w.surface.watchTool).toHaveBeenCalledTimes(1);
  });
});

// E3 panel wave (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16 and 17).
describe('a dashboard tab’s live datasets: the panel wave (E3 panel)', () => {
  // (6) the broker's own catch-up runs when shown; recovery only asks whether the handle lives, so no second refresh
  it('recovery probes a watch’s handle, never forcing a refresh; the owner’s Refresh still forces one', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    w.listeners.get('w1')!(DATASET('sales'));
    w.live.setShown(false);
    w.setClock(AT + 120_000);
    w.live.setShown(true); // overdue: asked at once
    await settle();
    expect(w.surface.refreshWatch.mock.calls).toEqual([['w1', { probe: true }]]);
    await w.live.refresh('sales');
    expect(w.surface.refreshWatch.mock.calls.at(-1)).toEqual(['w1']);
  });

  // (7) main may evict a dormant watch before the renderer hears its start's answer
  it('a start answered after a hide and a showing is probed then, and registered again when its handle is gone', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    const late = deferred<ConnectorWatchStart>();
    w.watchGate.next = late;
    w.live.setShown(true);
    await settle();
    w.live.setShown(false);
    w.live.setShown(true); // shown again while the start is unanswered: nothing to ask yet
    await settle();
    expect(w.surface.refreshWatch).not.toHaveBeenCalled();
    w.surface.refreshWatch.mockResolvedValueOnce(false); // evicted while hidden, before the answer
    late.resolve({ ok: true, watchId: 'ignored', intervalMs: 60_000 });
    await settle();
    expect(w.surface.refreshWatch.mock.calls).toEqual([['w1', { probe: true }]]);
    expect(w.log.filter((line) => /^(unwatch|watch)/.test(line)).slice(-2)).toEqual(['unwatch w1', `watch w2 rows {"region":"north"} 60000 {"dataset":{"id":"sales"}}`]);
  });

  it('a start answered while hidden is probed at the next showing; one answered with no hide since it began asks nothing', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 60 }));
    w.live.follow(w.doc);
    const late = deferred<ConnectorWatchStart>();
    w.watchGate.next = late;
    w.live.setShown(true);
    await settle();
    w.live.setShown(false);
    late.resolve({ ok: true, watchId: 'ignored', intervalMs: 60_000 });
    await settle();
    expect(w.surface.refreshWatch).not.toHaveBeenCalled(); // hidden: dormant until shown
    w.surface.refreshWatch.mockResolvedValueOnce(false);
    w.live.setShown(true);
    await settle();
    expect(w.surface.refreshWatch.mock.calls).toEqual([['w1', { probe: true }]]);
    expect(w.surface.watchTool).toHaveBeenCalledTimes(2);

    const v = world();
    setDataset(v.doc, 'sales', query({ schedule: 60 }));
    v.live.follow(v.doc);
    const answered = deferred<ConnectorWatchStart>();
    v.watchGate.next = answered;
    v.live.setShown(true);
    await settle();
    answered.resolve({ ok: true, watchId: 'ignored', intervalMs: 60_000 });
    await settle();
    expect(v.surface.refreshWatch).not.toHaveBeenCalled();
  });

  // (8) H ends a watch whose outcome is invalid; the renderer's listener goes with it
  it('a terminal outcome unwatches before its handle is forgotten, so no listener outlives it, across retries', async () => {
    const w = world();
    setDataset(w.doc, 'sales', query({ schedule: 30 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    for (const id of ['w1', 'w2', 'w3']) {
      w.listeners.get(id)!({ ok: false, state: 'invalid', reason: 'notReadOnly' });
      expect(w.surface.unwatchTool).toHaveBeenLastCalledWith(id);
      expect(w.listeners.size).toBe(0);
      await w.live.refresh('sales'); // the owner tries again: a new watch
      await settle();
      expect(w.listeners.size).toBe(1);
    }
    w.listeners.get('w4')!({ ok: false, state: 'invalid', reason: 'notReadOnly' });
    removeDataset(w.doc, 'sales');
    await settle();
    expect(w.listeners.size).toBe(0);
  });

  // (2) H's lease declares at most CONNECTOR_DECLARE_LIMIT distinct tools, cumulatively, and has no undeclare
  it('obsolete declarations never exhaust the lease: at H’s cap the surface is recycled for the current queries alone', async () => {
    const w = world();
    const surfaces: ReturnType<typeof fakeSurface>[] = [];
    const declaredOn = new Map<object, Set<string>>();
    w.host.openConnectors.mockImplementation(() => {
      const fake = fakeSurface();
      const declared = new Set<string>();
      declaredOn.set(fake, declared);
      fake.surface.declareTools.mockImplementation(async (tools: { server: string; tool: string }[]) => {
        const keys = tools.map((t) => `${t.server}/${t.tool}`);
        if (new Set([...declared, ...keys]).size > CONNECTOR_DECLARE_LIMIT) return { ok: false, state: 'invalid', reason: 'request' } as never;
        for (const key of keys) declared.add(key);
        return { ok: true as const, declared: tools };
      });
      surfaces.push(fake);
      return fake.surface;
    });
    setDataset(w.doc, 'costs', query({ tool: 'costs', schedule: 300 })); // current throughout
    setDataset(w.doc, 'sales', query({ tool: 't0', schedule: 60 }));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    // one distinct pair after another in the one query: 128 declared with costs, then the 129th
    for (let i = 1; i < CONNECTOR_DECLARE_LIMIT; i += 1) {
      setDataset(w.doc, 'sales', query({ tool: `t${i}`, schedule: 60 }));
      await settle();
    }
    expect(surfaces).toHaveLength(2);
    const [first, second] = surfaces as [ReturnType<typeof fakeSurface>, ReturnType<typeof fakeSurface>];
    expect(first.surface.close).toHaveBeenCalledTimes(1);
    expect([...declaredOn.get(second)!].sort()).toEqual(['fixture/costs', `fixture/t${CONNECTOR_DECLARE_LIMIT - 1}`]);
    expect(second.surface.setVisible).toHaveBeenLastCalledWith(true);
    expect(second.surface.watchTool.mock.calls.map(([request]) => request.tool).sort()).toEqual(['costs', `t${CONNECTOR_DECLARE_LIMIT - 1}`]);
    expect(w.live.snapshot().queries.get('sales')?.pause).toBeNull();
    // the owner's Refresh of a manual query goes through the recycled surface
    setDataset(w.doc, 'manual', query({ tool: 'manual' }));
    await w.live.refresh('manual');
    expect(second.surface.callTool).toHaveBeenCalledTimes(1);
    expect(first.surface.callTool).not.toHaveBeenCalled();
  });

  // the ruled sheet line (Decision Log 16): the live descriptor's committed error, never the bridge's transient answer
  it('says the live descriptor’s committed error in its source label’s words; a bridge failure clears none, a success does', async () => {
    const w = world();
    const SNAP = { ref: 'assets/query-1.json', at: AT };
    setDataset(w.doc, 'sales', query({ schedule: 30 }, SNAP));
    w.live.follow(w.doc);
    w.live.setShown(true);
    await settle();
    const error = () => w.live.snapshot().queries.get('sales')?.error;
    expect(error()).toBeNull();
    const words = 'the last refresh was refused: its structured content is neither an array of rows nor an object with a rows array';
    const failed = query({ schedule: 30 }, SNAP, { state: { status: 'error', message: words, at: AT + 1 } });
    setDataset(w.doc, 'sales', failed);
    expect(error()).toBe(words);
    expect(sourceLabel(failed, 'You').split(' · ')).toContain(error());
    w.listeners.get('w1')!(FAILED('validation')); // the bridge's phase ends no pause it set, and leaves the error
    expect(w.live.snapshot().queries.get('sales')?.pause).toBeNull();
    expect(error()).toBe(words);
    const unworded = query({ schedule: 30 }, SNAP, { state: { status: 'error', at: AT + 2 } });
    setDataset(w.doc, 'sales', unworded);
    expect(error()).toBe(datasetErrorOf(unworded.state));
    expect(sourceLabel(unworded, 'You').split(' · ')).toContain(error());
    setDataset(w.doc, 'sales', query({ schedule: 30 }, { ref: 'assets/query-2.json', at: AT + 3 }));
    expect(error()).toBeNull();
  });
});
