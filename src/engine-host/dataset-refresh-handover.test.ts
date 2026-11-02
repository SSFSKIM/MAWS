// P5 O16 M3b fix wave 4 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3; Interfaces §D): an agent's dataset
// refresh in flight at a handover. The architect chose to fail it with a retryable error rather than drain it to
// completion. Its connector leg runs only on a ready host, and a draining host is not ready (D56), so it cannot finish
// on the old host. The call answers `failed: routeFailed` with the handover named, the drain waits for that answer, the
// session is detached for the successor, and calling again there publishes exactly once.
//
// Composed as the engine host wires it: a real ProcessTable whose hosted row is a scripted session with the artifact
// tools (src/engine-host/handover-paths.test.ts), Supervision's `host.handover` with the registry's `handOver` as its
// `handingOver` (index.ts), A's real store with the dashboard kind, and main's half (the spine's) driven by hand
// through the host's real sink (connectors/dataset-sink.ts), as connectors.start would. The successor is a second
// table and registry over the same store, holding the same session, which stands in for the adoption M3a proves.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataset, setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { handshakeResponder, scriptedSession } from './conformance/session-harness';
import { connectorDatasetSink } from './connectors/dataset-sink';
import { DatasetRefreshRequests } from './connectors/dataset-requests';
import { registerDashboards, type Dashboards } from './dashboards';
import { DocumentService } from './documents/service';
import { SqliteDocumentStorage } from './documents/storage';
import { ArtifactStore } from './documents/store';
import { ProcessTable } from './process-table';
import { Supervision } from './supervision';
import { REFRESH_HANDED_OVER } from './tool-server/datasets';

const human: Actor = { kind: 'human' };
const SESSION = 'app-refreshing' as AppSessionId;
const QUERY = { kind: 'query' as const, server: 'fixture', tool: 'rows', args: { series: 'revenue' } };
const unfetched: DatasetDescriptor = { title: 'Live', source: { ...QUERY, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: 1 } };
const ROWS = [{ t: 1, v: 107 }, { t: 2, v: 110 }];
const IDENTITY = { pid: 1, startedAt: '2026-10-31T00:00:00.000Z', buildId: 'b', protocol: 3, wire: 'w', socketPath: '/s', logPath: '/l' };

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let dashboards: Dashboards;
let artifactId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-refresh-handover-'));
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id) });
  store = new ArtifactStore(service, storage, { root: dir, log: () => {} });
  dashboards = registerDashboards({ documents: { store, service } });
  artifactId = (await store.create({ kind: 'dashboard', title: 'Board' }, human)).id;
  await store.writeWithAssets(artifactId, human, [], (doc) => setDataset(doc, 'live', unfetched));
});
afterEach(() => {
  dashboards.close();
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const until = async (check: () => boolean, what: string, ms = 5_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

// One engine host holding SESSION as a hosted row, its registry handed to the row's tools and to its handover.
async function engineHost(pid: number) {
  const announced: string[] = [];
  const requests = new DatasetRefreshRequests({ announce: (requestId) => announced.push(requestId), hasClient: () => true });
  const table = new ProcessTable({ ps: async () => '' });
  const row = scriptedSession({
    spec: { appSessionId: SESSION },
    transport: { holder: { pid, holderId: `L-${pid}`, fence: 1 } },
    responder: handshakeResponder(),
    session: { artifacts: () => store, datasetRefresh: requests },
  });
  table.reserve(SESSION, () => row.session);
  await row.session.start();
  const logs: string[] = [];
  const exitOrders: Promise<unknown>[] = [];
  const supervision = new Supervision({
    mode: 'detached', identity: IDENTITY, table, role: 'laptop', log: (line) => logs.push(line),
    plugins: { busy: () => false, onIdle: () => () => {}, onBusy: () => () => {} },
    shutdown: (graceMs) => table.shutdown({ graceMs }),
    emit: () => true,
    handingOver: () => requests.handOver(),
  });
  const commands = new Map<string, (input: unknown) => Promise<unknown>>();
  supervision.register((name, handler) => void commands.set(name, handler as (input: unknown) => Promise<unknown>), { onConnect: () => {} });
  supervision.started(IDENTITY, (reason) => void exitOrders.push(table.shutdown({ graceMs: 3_000, mode: reason === 'stopAll' ? 'stop' : 'detach' })));
  supervision.clientChanged(true);
  // the agent's `artifact_dataset {refresh: true}` as the engine sends it, and the tool's answer as written back
  const refresh = (requestId: string, toolUseId: string) => {
    const baseRevision = store.revision(artifactId);
    row.transport.push({ type: 'control_request', request_id: requestId, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'artifact_dataset', arguments: { artifact: artifactId, id: 'live', baseRevision, refresh: true }, _meta: { 'claudecode/toolUseId': toolUseId } } } } });
  };
  const answerOf = (requestId: string) =>
    (row.transport.writes.find((w) => w.type === 'control_response' && (w as { response: { request_id: string } }).response.request_id === requestId) as { response: { response: { mcp_response: { result: { content: { text: string }[]; isError?: boolean } } } } } | undefined)?.response.response.mcp_response.result;
  // main's half, as the spine runs it on the announcement: the read, then `connectors.start`'s admission through the
  // host's sink, the call's result published, and its reply
  const sink = connectorDatasetSink({ store: () => store, requests });
  const asMain = async (requestId: string) => {
    const read = requests.read(requestId);
    if (!read) return { refusal: `request ${requestId} is not pending` };
    const admission = await sink.admit({ appSessionId: read.appSessionId, artifactId: read.artifactId, server: read.server, tool: read.tool, arguments: read.args, dataset: { id: read.datasetId, baseRevision: read.baseRevision, requestId } }, () => {});
    if (!('publish' in admission)) return admission;
    const publication = await admission.publish({ kind: 'result', result: { content: '', structuredContent: { rows: ROWS } } }, () => 'held');
    requests.answer(requestId, { ok: true });
    return publication;
  };
  return { row, requests, announced, logs, exitOrders, refresh, answerOf, asMain, call: (name: string, input: unknown) => commands.get(name)!(input) };
}

describe('a dataset refresh in flight at a handover', () => {
  it('fails retryably with the handover named, the drain waiting for it; the session survives; calling again on the successor publishes once', async () => {
    const before = store.revision(artifactId);
    const old = await engineHost(4100);

    // the agent's refresh, announced; main has read it and is paused before its `connectors.start`
    old.refresh('mcp-1', 'toolu_1');
    await until(() => old.announced.length === 1, 'the announcement');
    const [paused] = old.announced as [string];
    expect(old.requests.read(paused)).toMatchObject({ artifactId, datasetId: 'live', appSessionId: SESSION });
    expect(old.row.session.inFlightThroughDelivery()).toBe(1);

    // the handover: the drain counts the call, the refresh fails, and only then does the drain settle and the row detach
    expect(await old.call('host.handover', { graceMs: 5_000 })).toEqual({ state: 'detaching' });
    expect(old.logs).toContain('handover armed: 1 hosted rows frozen, 1 calls in flight');
    const failed = old.answerOf('mcp-1');
    expect(failed?.isError).toBe(true);
    expect(failed?.content[0]?.text).toContain(REFRESH_HANDED_OVER);
    expect(failed?.content[0]?.text).toContain('"outcome":"failed:routeFailed"');
    await until(() => old.row.transport.calls.includes('detach:ack'), 'the detach');
    await Promise.all(old.exitOrders);
    expect(old.row.session.lifecycle).toBe('ready'); // the engine runs on for the successor
    expect(old.row.transport.requestsOf('end_session')).toEqual([]);

    // main resumes: its start reaches a request no longer pending, so the old host publishes nothing
    expect(await old.asMain(paused)).toMatchObject({ refusal: expect.stringMatching(/not pending/) });
    expect(await connectorDatasetSink({ store: () => store, requests: old.requests }).admit({ appSessionId: SESSION, artifactId, server: QUERY.server, tool: QUERY.tool, arguments: QUERY.args, dataset: { id: 'live', baseRevision: before, requestId: paused } }, () => {})).toMatchObject({ refusal: expect.stringMatching(/no pending dataset refresh request/) });
    expect(store.revision(artifactId)).toBe(before);
    expect(readDataset(store.service.live(artifactId), 'live')).toEqual(unfetched);

    // the successor holds the session; the agent calls again and main runs it there: published, once
    const successor = await engineHost(4100);
    successor.refresh('mcp-2', 'toolu_2');
    await until(() => successor.announced.length === 1, 'the successor’s announcement');
    expect(await successor.asMain(successor.announced[0]!)).toMatchObject({ published: { status: 'dataset', artifactId, id: 'live', rows: 2 } });
    await until(() => successor.answerOf('mcp-2') !== undefined, 'the second answer');
    const published = successor.answerOf('mcp-2')!;
    expect(published.isError ?? false).toBe(false);
    expect(JSON.parse(published.content[0]!.text)).toMatchObject({ status: 'dataset', artifactId, id: 'live', rows: 2 });
    expect(store.revision(artifactId)).toBe(before + 1); // one publication over both calls
    expect(readDataset(store.service.live(artifactId), 'live')).toMatchObject({ rows: 2, source: { snapshot: { ref: expect.any(String) } } });
  });
});
