// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3, "Linearization and transitions"): route E's host
// leg with a dataset sink. A real artifact store with the dashboard kind, the host's real sink (./dataset-sink.ts) and
// registry, and a scripted engine behind a real ControlClient. The result stays in the host: the call's end is
// announced, main's first take starts the publication and answers `publishing` (any later take joins it), the
// publication's end is announced again and the next take answers its end once: the metadata alone, or a typed
// failure (E3 M2 fix: explicit phases, `connectors.take`'s `dataset` beside H's nullable outcome). The grant's fence,
// the operation's cancellation and the dataset's identity hold until the commit.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDataset, setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { registerDashboards, type Dashboards } from '../dashboards';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { ControlClient } from '../rpc';
import type { EngineTransport } from '../transport';
import { ConnectorCalls, type ConnectorStart } from './calls';
import { connectorDatasetSink } from './dataset-sink';
import { DatasetRefreshRequests } from './dataset-requests';

const human: Actor = { kind: 'human' };
const SESSION = 'app-1';
type Request = Record<string, unknown> & { subtype: string };
type Envelope = { subtype: 'success'; response: unknown } | { subtype: 'error'; error: string };
const ROW_SENTINEL = 'ROW_PAYLOAD_SENTINEL_107';
const ROWS = [{ t: 1, v: ROW_SENTINEL }, { t: 2, v: 'ROW_PAYLOAD_SENTINEL_110' }];
const success = (structuredContent: unknown): Envelope => ({ subtype: 'success', response: { content: JSON.stringify(structuredContent), structuredContent } });

// The engine's stdin, each control request answered on a microtask: mcp_status with the fixture server, mcp_call as
// `state.call` says (null leaves it running until `release`).
function scriptedEngine() {
  const writes: StdinFrame[] = [];
  const state = { call: ((): Envelope | null => success({ series: 'revenue', rows: ROWS })) as (request: Request) => Envelope | null };
  const server = { name: 'fixture', status: 'connected', scope: 'project', config: { type: 'http', url: 'http://127.0.0.1:47831/mcp' }, tools: [{ name: 'rows', annotations: { readOnly: true } }] };
  const held: (() => void)[] = [];
  const transport: EngineTransport = {
    pid: null,
    frames: (async function* () {})(),
    stderr: (async function* () {})(),
    write: async (frame) => {
      writes.push(frame);
      if (frame.type !== 'control_request') return;
      const request = frame.request as Request;
      const respond = (envelope: Envelope) => queueMicrotask(() => client.observe({ type: 'control_response', response: { ...envelope, request_id: frame.request_id } } as never));
      if (request.subtype === 'mcp_status') return respond({ subtype: 'success', response: { mcpServers: [structuredClone(server)] } });
      if (request.subtype !== 'mcp_call') return;
      const envelope = state.call(request);
      if (envelope) respond(envelope);
      else held.push(() => respond(success({ rows: ROWS })));
    },
    endInput: () => {},
    kill: () => {},
    exited: new Promise(() => {}),
  };
  const rows: JournalRow[] = [];
  const client = new ControlClient(transport, { row: (direction, frame) => { const row = { seq: rows.length + 1, direction, at: '', frame }; rows.push(row); return row; } }, 'L1', { warn: () => {} });
  const calls = () => writes.filter((frame) => frame.type === 'control_request' && (frame.request as Request).subtype === 'mcp_call');
  return { client, state, calls, release: () => held.shift()?.() };
}

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let dashboards: Dashboards;
let engine: ReturnType<typeof scriptedEngine>;
let completed: string[];
let calls: ConnectorCalls;
let requests: DatasetRefreshRequests;
let artifactId: string;
let fingerprint: string;
// a hook run once just before the sink's publication (between main's take and the commit)
let beforePublish: (() => void | Promise<void>) | null;
// the store's flushes run at once, or wait in `turns` while `deferring` (E3 M2 residual: a commit admitted, not flushed)
let deferring: boolean;
let turns: (() => void)[];

const QUERY = { kind: 'query' as const, server: 'fixture', tool: 'rows', args: { series: 'revenue' } };
const unfetched: DatasetDescriptor = { title: 'Live', source: { ...QUERY, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: 1 } };
const live = () => readDataset(store.service.live(artifactId), 'live');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-connector-datasets-'));
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  deferring = false;
  turns = [];
  service = new DocumentService(storage, { now: () => Date.now(), log: () => {}, kindOf: (id) => storage.kindOf(id), defer: (run) => (deferring ? turns.push(run) : setImmediate(run)) });
  store = new ArtifactStore(service, storage, { root: dir, log: () => {} });
  dashboards = registerDashboards({ documents: { store, service } });
  engine = scriptedEngine();
  completed = [];
  beforePublish = null;
  requests = new DatasetRefreshRequests({ announce: () => {}, hasClient: () => true });
  const sink = connectorDatasetSink({ store: () => store, requests });
  calls = new ConnectorCalls({
    session: (id) => (id === SESSION ? { lifecycle: 'ready', control: engine.client, status: () => ({ launchId: 'L1', cwd: '/work/project' }) } : undefined),
    store: () => store,
    completed: (operationId) => completed.push(operationId),
    probe: async () => 'supported',
    log: () => {},
    datasets: {
      admit: async (input, cancel) => {
        const admission = await sink.admit(input, cancel);
        if (!('publish' in admission)) return admission;
        return { publish: async (raw, guard, admitted) => (await beforePublish?.(), (beforePublish = null), admission.publish(raw, guard, admitted)) };
      },
    },
  });
  artifactId = (await store.create({ kind: 'dashboard', title: 'Board' }, human)).id;
  await store.writeWithAssets(artifactId, human, [], (doc) => setDataset(doc, 'live', unfetched));
  const resolved = await calls.resolve({ appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows' });
  if (!resolved.ready) throw new Error('the fixture server is not ready');
  fingerprint = resolved.fingerprint;
  await store.grantConnectorTool(artifactId, { server: 'fixture', tool: 'rows', fingerprint, mode: 'read' });
});
afterEach(() => {
  calls.close();
  dashboards.close();
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

let nextOp = 0;
const opId = () => `00000000-0000-4000-8000-${String(++nextOp).padStart(12, '0')}`;
const startOf = (patch: Partial<ConnectorStart> = {}): ConnectorStart => ({
  operationId: opId(), artifactId, appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows', arguments: { series: 'revenue' }, fingerprint, mode: 'read', dataset: { id: 'live' }, ...patch,
});
const announcements = (operationId: string) => completed.filter((id) => id === operationId).length;
const take = (operationId: string) => calls.takeOperation(operationId);
const publishing = (operationId: string) => ({ outcome: null, dataset: { status: 'publishing', operationId } });
const failedTake = (reason: string) => ({ outcome: null, dataset: { status: 'failed', reason } });
async function announced(operationId: string, times: number) {
  await vi.waitFor(() => expect(announcements(operationId)).toBe(times));
}

describe('ConnectorCalls with a dataset sink', () => {
  it('keeps the result in the host until main’s take, publishes once however many takes join, and answers the metadata alone', async () => {
    const { operationId } = calls.start(startOf());
    expect(take(operationId)).toEqual({ outcome: null }); // still calling: H's null, no phase
    await announced(operationId, 1);
    expect(engine.calls()).toHaveLength(1);
    const revision = store.revision(artifactId);
    expect(live()).toEqual(unfetched); // nothing published before main’s take
    expect(take(operationId)).toEqual(publishing(operationId)); // the publication starts
    expect(take(operationId)).toEqual(publishing(operationId)); // and is joined, explicitly
    expect(take(operationId)).toEqual(publishing(operationId));
    await announced(operationId, 2);
    const ended = take(operationId);
    expect(ended).toEqual({ outcome: null, dataset: { status: 'dataset', artifactId, id: 'live', revision: store.revision(artifactId), columns: [{ name: 't', type: 'number' }, { name: 'v', type: 'string' }], rows: 2 } });
    expect(JSON.stringify(ended)).not.toContain(ROW_SENTINEL); // no row value leaves the host
    expect(store.revision(artifactId)).toBeGreaterThan(revision);
    expect(store.listAssets(artifactId)).toHaveLength(1);
    expect(live()).toMatchObject({ rows: 2, updated: { by: human }, state: { status: 'ok' } });
    expect(take(operationId)).toEqual({ outcome: null }); // its end taken once
    expect(announcements(operationId)).toBe(2);
  });

  it('answers H’s own take of a dataset operation as H’s nullable outcome, never a phase', async () => {
    const { operationId } = calls.start(startOf());
    await announced(operationId, 1);
    expect(calls.take(operationId)).toBeNull();
    expect(take(operationId)).toEqual(publishing(operationId));
  });

  it('turns a revoke while the result waits for main’s take into the revoke’s refusal, publishing nothing', async () => {
    const { operationId } = calls.start(startOf());
    await announced(operationId, 1);
    await store.revokeConnectorTool(artifactId, { server: 'fixture', tool: 'rows' });
    expect(take(operationId)).toEqual(failedTake('revoked'));
    expect(live()).toEqual(unfetched);
    expect(store.listAssets(artifactId)).toEqual([]);
  });

  it('discards the publication when a revoke, a cancel or a source replacement lands between the take and the commit', async () => {
    const race = async (during: () => Promise<unknown> | void, expected: Record<string, unknown> | null) => {
      const { operationId } = calls.start(startOf());
      await announced(operationId, 1);
      beforePublish = async () => void (await during());
      expect(take(operationId)).toEqual(publishing(operationId));
      if (expected === null) {
        await vi.waitFor(() => expect(beforePublish).toBeNull());
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(announcements(operationId)).toBe(1); // a cancelled operation is never announced again
        expect(take(operationId)).toEqual({ outcome: null });
      } else {
        await announced(operationId, 2);
        expect(take(operationId)).toEqual(expected);
      }
    };
    const before = store.revision(artifactId);
    await race(() => store.revokeConnectorTool(artifactId, { server: 'fixture', tool: 'rows' }), failedTake('revoked'));
    expect(store.revision(artifactId)).toBe(before);
    await store.grantConnectorTool(artifactId, { server: 'fixture', tool: 'rows', fingerprint, mode: 'read' });
    const { operationId } = calls.start(startOf());
    await announced(operationId, 1);
    // E3 M2 residual: main's cancel before the commit's admission wins: nothing published, its end kept for the next take
    let cancelled: boolean | null = null;
    beforePublish = () => void (cancelled = calls.cancel(operationId));
    expect(take(operationId)).toEqual(publishing(operationId));
    await vi.waitFor(() => expect(beforePublish).toBeNull());
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(cancelled).toBe(true);
    expect(announcements(operationId)).toBe(1); // a cancelled operation is never announced again
    expect(take(operationId)).toEqual(failedTake('timeout'));
    expect(take(operationId)).toEqual({ outcome: null }); // once
    expect(store.revision(artifactId)).toBe(before);
    // E3 M2 fix (reviewer finding 5): a concurrent change of the dataset is a typed conflict, never a tool's failure
    await race(() => store.writeWithAssets(artifactId, human, [], (doc) => setDataset(doc, 'live', { ...unfetched, title: 'Replaced' })), failedTake('stale'));
    expect(live()).toEqual({ ...unfetched, title: 'Replaced' });
    expect(store.listAssets(artifactId)).toEqual([]);
  });

  // E3 M2 residual (the architect's terminal-ownership ruling, a page's path): the host owns a dataset operation's end
  describe('main’s cancel and the commit’s admission', () => {
    const flush = async () => {
      deferring = false;
      for (const run of turns.splice(0)) run();
      for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    };
    // the publication admitted into its savepoint, its commit's flush deferred
    async function admitted(): Promise<string> {
      const { operationId } = calls.start(startOf());
      await announced(operationId, 1);
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); // no flush already scheduled
      deferring = true;
      expect(take(operationId)).toEqual(publishing(operationId));
      await vi.waitFor(() => expect(turns.length).toBeGreaterThan(0));
      return operationId;
    }

    it('wins while the call still runs: nothing is published and the next take answers failed timeout', async () => {
      engine.state.call = () => null;
      const { operationId } = calls.start(startOf());
      await vi.waitFor(() => expect(engine.calls()).toHaveLength(1));
      const before = store.revision(artifactId);
      expect(calls.cancel(operationId)).toBe(true);
      engine.release(); // the engine answers after all: too late to publish
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
      expect(take(operationId)).toEqual(failedTake('timeout'));
      expect(store.revision(artifactId)).toBe(before);
      expect(live()).toEqual(unfetched);
      expect(store.listAssets(artifactId)).toEqual([]);
    });

    it('answers cancelled false once the commit is admitted; the next take answers its durable dataset', async () => {
      const operationId = await admitted();
      expect(calls.cancel(operationId)).toBe(false);
      expect(take(operationId)).toEqual(publishing(operationId));
      await flush();
      await announced(operationId, 2);
      expect(take(operationId)).toMatchObject({ outcome: null, dataset: { status: 'dataset', rows: 2 } });
      expect(live()).toMatchObject({ rows: 2, state: { status: 'ok' } });
      expect(store.listAssets(artifactId)).toHaveLength(1);
    });

    it('answers cancelled false for an admitted error state too, whose failure the next take answers', async () => {
      engine.state.call = () => success({ data: ROWS });
      const operationId = await admitted();
      expect(calls.cancel(operationId)).toBe(false);
      await flush();
      await announced(operationId, 2);
      expect(take(operationId)).toEqual(failedTake('validation'));
      expect(live()!.state.status).toBe('error');
    });

    it('answers a rollback after the admission as its failure, nothing published', async () => {
      const operationId = await admitted();
      expect(calls.cancel(operationId)).toBe(false);
      const commit = storage.commit.bind(storage);
      storage.commit = () => {
        storage.commit = commit;
        throw new Error('disk full');
      };
      await flush();
      await announced(operationId, 2);
      expect(take(operationId)).toEqual({ outcome: expect.objectContaining({ ok: false, failure: 'failed' }) });
      expect(live()).toEqual(unfetched);
      expect(store.listAssets(artifactId)).toEqual([]);
    });
  });

  it('writes a malformed result or a tool failure as the error state alone, its end the typed failure', async () => {
    engine.state.call = () => success({ data: ROWS });
    const malformed = calls.start(startOf());
    await announced(malformed.operationId, 1);
    take(malformed.operationId);
    await announced(malformed.operationId, 2);
    expect(take(malformed.operationId)).toEqual(failedTake('validation'));
    expect(live()!.state.status).toBe('error');
    engine.state.call = () => ({ subtype: 'error', error: 'upstream exploded: secret-token-xyz' });
    const failing = calls.start(startOf());
    await announced(failing.operationId, 1);
    take(failing.operationId);
    await announced(failing.operationId, 2);
    expect(take(failing.operationId)).toEqual(failedTake('toolError'));
    expect(JSON.stringify(live())).not.toContain('secret-token-xyz');
    expect(store.listAssets(artifactId)).toEqual([]);
  });

  it('refuses before any call a start its dataset’s query no longer names (stale), and a dataset start under an Allow once', async () => {
    const mismatch = calls.start(startOf({ arguments: { series: 'cost' } }));
    await announced(mismatch.operationId, 1);
    expect(take(mismatch.operationId)).toEqual(failedTake('stale'));
    const once = calls.start(startOf({ mode: 'once' }));
    await announced(once.operationId, 1);
    expect(take(once.operationId)).toEqual({ outcome: expect.objectContaining({ ok: false, failure: 'refused', refusal: 'wrongMode' }) });
    expect(engine.calls()).toEqual([]);
    expect(live()).toEqual(unfetched);
  });

  it('answers an unavailable server as it is, writing nothing', async () => {
    engine.state.call = () => ({ subtype: 'error', error: 'MCP server not connected: fixture' });
    const { operationId } = calls.start(startOf());
    await announced(operationId, 1);
    expect(take(operationId)).toEqual({ outcome: expect.objectContaining({ ok: false, failure: 'unavailable' }) });
    expect(live()).toEqual(unfetched);
  });

  it('publishes an agent’s refresh as its asking session only for the start that is its request; the request’s end cancels the operation', async () => {
    const base = store.revision(artifactId);
    const ask = { artifactId, datasetId: 'live', baseRevision: base, appSessionId: SESSION as AppSessionId, opId: `${SESSION}/toolu_1`, server: 'fixture', tool: 'rows', args: { series: 'revenue' } };
    let requestId = '';
    requests = new DatasetRefreshRequests({ announce: (id) => (requestId = id), hasClient: () => true });
    const sink = connectorDatasetSink({ store: () => store, requests });
    calls.close();
    calls = new ConnectorCalls({
      session: (id) => (id === SESSION ? { lifecycle: 'ready', control: engine.client, status: () => ({ launchId: 'L1', cwd: '/work/project' }) } : undefined),
      store: () => store, completed: (id) => completed.push(id), probe: async () => 'supported', log: () => {}, datasets: sink,
    });
    const asked = requests.ask(ask, new AbortController().signal);
    // a start claiming another base is not the request
    const wrong = calls.start(startOf({ dataset: { id: 'live', baseRevision: base + 1, requestId } }));
    await announced(wrong.operationId, 1);
    expect(take(wrong.operationId)).toEqual({ outcome: expect.objectContaining({ ok: false, failure: 'failed' }) });
    const { operationId } = calls.start(startOf({ dataset: { id: 'live', baseRevision: base, requestId } }));
    await announced(operationId, 1);
    take(operationId);
    await announced(operationId, 2);
    expect(take(operationId)).toMatchObject({ outcome: null, dataset: { status: 'dataset', rows: 2 } });
    expect(live()!.updated).toMatchObject({ by: { kind: 'session', appSessionId: SESSION } });
    // the host's own end is the request's answer, at once: main's reply after it is not pending
    expect(await asked).toMatchObject({ kind: 'published', answer: { status: 'dataset', rows: 2 } });
    expect(requests.answer(requestId, { ok: true })).toBe('not_pending');
    expect(await store.replayOf(`${SESSION}/toolu_1`)).toMatchObject({ found: true, result: { status: 'dataset', rows: 2 } });

    // the engine withdraws the tool call while the mcp_call runs: the operation ends cancelled, nothing published
    engine.state.call = () => null;
    const withdrawn = new AbortController();
    const second = requests.ask({ ...ask, baseRevision: store.revision(artifactId), opId: `${SESSION}/toolu_2` }, withdrawn.signal);
    const running = calls.start(startOf({ dataset: { id: 'live', baseRevision: store.revision(artifactId), requestId } }));
    await vi.waitFor(() => expect(engine.calls()).toHaveLength(2));
    const revision = store.revision(artifactId);
    withdrawn.abort();
    expect(await second).toEqual({ kind: 'withdrawn' });
    await announced(running.operationId, 1);
    expect(take(running.operationId)).toEqual({ outcome: expect.objectContaining({ ok: false, failure: 'unavailable' }) });
    engine.release();
    expect(store.revision(artifactId)).toBe(revision);
  });
});
