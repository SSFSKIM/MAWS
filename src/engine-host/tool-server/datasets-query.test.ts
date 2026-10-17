// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R2, R3; acceptance 3): `artifact_dataset`'s two query
// modes through the `maws` server's own tool list, over A's real store with the document and dashboard kinds. `source`
// configures a query and calls nothing (one replayable write: no snapshot, no rows, no `updated`); `refresh: true` asks
// main once through the host's private request registry, and answers the host's own durable record of the
// publication, never main's words. Main is played here by what it does: it reads the request by its id, starts the
// one operation that is the request (the host's real dataset sink), and replies how its call went.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataset, removeDataset, setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import type { MawsDatasetRefreshOutcome } from '@shared/ipc/schema/maws';
import { artifactRefusalOf } from '@shared/maws/tools';
import { DatasetRefreshRequests, type DatasetRefreshRead } from '../connectors/dataset-requests';
import { connectorDatasetSink } from '../connectors/dataset-sink';
import type { RefreshRaw } from '../dashboards/refresh';
import { registerDocumentKind, type DocumentKind } from '../documents/kinds/document';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { registerDashboards, type Dashboards } from '../dashboards';
import { AskTable } from './asks';
import { HostBridge } from './bridge';
import { PaneBridge } from './panes';
import type { McpToolContext, McpToolDefinition, McpToolResult } from './server';
import { mawsTools } from './tools';

const SELF = 'app-self' as AppSessionId;
const SOURCE = { kind: 'query', server: 'fixture', tool: 'rows', args: { series: 'revenue' }, schedule: 30, staleAfter: 120 } as const;
const ROWS = [{ t: 1, v: 107 }, { t: 2, v: 110 }];

let data: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let kind: DocumentKind;
let dashboards: Dashboards;
let tools: Map<string, McpToolDefinition>;
let requests: DatasetRefreshRequests;
let client: boolean;
let calls = 0;
// what main does with an announced request; by default, the call answers ROWS and main replies `ok`
let main: (requestId: string, read: DatasetRefreshRead) => Promise<void>;
let reads: (DatasetRefreshRead | null)[];

async function asMain(requestId: string, read: DatasetRefreshRead, raw: RefreshRaw = { kind: 'result', result: { content: '', structuredContent: { rows: ROWS } } }, reply: MawsDatasetRefreshOutcome = { ok: true }): Promise<void> {
  const sink = connectorDatasetSink({ store: () => store, requests });
  const admission = await sink.admit({ appSessionId: read.appSessionId, artifactId: read.artifactId, server: read.server, tool: read.tool, arguments: read.args, dataset: { id: read.datasetId, baseRevision: read.baseRevision, requestId } }, () => {});
  if ('publish' in admission) await admission.publish(raw, () => 'held');
  requests.answer(requestId, 'publish' in admission ? reply : { ok: false, state: 'failed', reason: 'toolError' });
}

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'maws-datasets-query-'));
  storage = SqliteDocumentStorage.open(join(data, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id) });
  store = new ArtifactStore(service, storage, { root: data, log: () => {} });
  kind = registerDocumentKind(store);
  dashboards = registerDashboards({ documents: { store, service } });
  client = true;
  reads = [];
  main = (requestId, read) => asMain(requestId, read);
  requests = new DatasetRefreshRequests({
    hasClient: () => client,
    announce: (requestId) => {
      const read = requests.read(requestId);
      reads.push(read);
      setTimeout(() => void main(requestId, read!), 0); // main hears the event a turn later
    },
  });
  const list = mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => store, datasetRefresh: requests });
  tools = new Map(list.map((tool) => [tool.name, tool]));
});
afterEach(() => {
  dashboards.close();
  kind.close();
  store.close();
  service.close();
  storage.close();
  rmSync(data, { recursive: true, force: true });
});

const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: SELF, cwd: data, toolUseId: `toolu_q${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false, ...over });
const call = (name: string, args: unknown, over: Partial<McpToolContext> = {}) => tools.get(name)!.call(args, ctx(over));
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${text(result)}`);
  return JSON.parse(text(result)) as T;
};
const refusal = (result: McpToolResult) => {
  expect(result.isError, text(result)).toBe(true);
  return artifactRefusalOf(text(result));
};
const dataset = (args: Record<string, unknown>, over: Partial<McpToolContext> = {}) => call('artifact_dataset', { artifact: 'board', ...args }, over);
const live = (id: string) => readDataset(store.service.live(boardId), id);
let boardId: string;
async function board(): Promise<number> {
  const answer = json<{ artifactId: string; revision: number }>(await call('artifact_create', { kind: 'dashboard', title: 'Live board', handle: 'board', content: '# Live ^h1\n' }));
  boardId = answer.artifactId;
  return answer.revision;
}
async function configured(): Promise<number> {
  return json<{ revision: number }>(await dataset({ baseRevision: await board(), id: 'live', title: 'Revenue', source: SOURCE })).revision;
}

describe('artifact_dataset: a query source', () => {
  it('configures a query without calling anything: no snapshot, rows or provenance, answered not fetched', async () => {
    const base = await board();
    const answer = json(await dataset({ baseRevision: base, id: 'live', title: 'Revenue', rowKey: 't', source: SOURCE }));
    expect(answer).toEqual({ status: 'dataset', artifactId: boardId, id: 'live', revision: store.revision(boardId), columns: [], rows: 0, notFetched: true });
    expect(live('live')).toEqual({ title: 'Revenue', rowKey: 't', source: { ...SOURCE, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: expect.any(Number) } });
    expect(store.listAssets(boardId)).toEqual([]);
    expect(reads).toEqual([]); // no request, no call
  });

  it('replays a repeated tool-use id, and keeps the conflict rule and the earlier title of a replacement', async () => {
    const base = await board();
    const first = await dataset({ baseRevision: base, id: 'live', source: SOURCE }, { toolUseId: 'toolu_same' as ToolUseId });
    expect(text(await dataset({ baseRevision: base, id: 'live', source: { ...SOURCE, tool: 'other' } }, { toolUseId: 'toolu_same' as ToolUseId }))).toBe(text(first));
    expect(live('live')!.source).toMatchObject({ tool: 'rows' });
    const revision = json<{ revision: number }>(first).revision;
    expect(refusal(await call('artifact_dataset', { artifact: boardId, baseRevision: base, id: 'live', source: SOURCE }, { appSessionId: 'app-other' as AppSessionId }))).toMatchObject({ reason: 'conflict', dataset: 'live' });
    await dataset({ baseRevision: revision, id: 'live', title: 'Kept', source: SOURCE });
    const replaced = json<{ revision: number }>(await dataset({ baseRevision: store.revision(boardId), id: 'live', source: { ...SOURCE, schedule: 60 } }));
    expect(live('live')).toMatchObject({ title: 'Kept', source: { schedule: 60, snapshot: null } });
    expect(replaced.revision).toBe(store.revision(boardId));
  });

  // E3 M2 fix (reviewer finding 4; the architect's M2 ruling): a query's identity is its server, tool and arguments
  // (their keys in any order); a policy or metadata change keeps what was fetched
  const memberships = () => storage.db.prepare('SELECT datasetId, assetId FROM artifact_query_snapshots WHERE artifactId = ?').all(boardId);
  async function fetched(): Promise<DatasetDescriptor> {
    const base = await configured();
    json(await dataset({ baseRevision: base, id: 'live', refresh: true }));
    return live('live')!;
  }

  it('keeps the fetched snapshot, provenance, rows, state and retention through a schedule, staleAfter, key-order or metadata change', async () => {
    const two = { kind: 'query', server: 'fixture', tool: 'rows', args: { series: 'revenue', limit: 2 } } as const;
    json(await dataset({ baseRevision: await board(), id: 'live', title: 'Revenue', source: two }));
    json(await dataset({ baseRevision: store.revision(boardId), id: 'live', refresh: true }));
    const before = live('live')!;
    expect(before).toMatchObject({ rows: 2, source: { snapshot: { ref: expect.any(String) } } });
    const kept = memberships();
    expect(kept).toHaveLength(1);
    const answer = json(await dataset({ baseRevision: store.revision(boardId), id: 'live', description: 'Daily revenue', source: { ...two, args: { limit: 2, series: 'revenue' }, schedule: 600, staleAfter: 900 } }));
    expect(live('live')).toEqual({ ...before, description: 'Daily revenue', source: { ...before.source, schedule: 600, staleAfter: 900 } });
    expect(answer).toEqual({ status: 'dataset', artifactId: boardId, id: 'live', revision: store.revision(boardId), columns: before.columns, rows: 2 });
    expect(memberships()).toEqual(kept);
    // an explicit title applies and an omitted description stays; a schedule left out is manual again
    json(await dataset({ baseRevision: store.revision(boardId), id: 'live', title: 'Revenue (EUR)', source: two }));
    expect(live('live')).toEqual({ ...before, title: 'Revenue (EUR)', description: 'Daily revenue' });
    expect(memberships()).toEqual(kept);
  });

  it('validates a supplied row key against the retained rows before the write: a valid one applies, an invalid one refuses the whole call', async () => {
    const before = await fetched();
    const revision = store.revision(boardId);
    const refused = refusal(await dataset({ baseRevision: revision, id: 'live', rowKey: 'nope', source: { ...SOURCE, schedule: 3_600 } }));
    expect(refused).toMatchObject({ reason: 'invalid', rowKey: 'nope' });
    expect(store.revision(boardId)).toBe(revision);
    expect(live('live')).toEqual(before); // nothing written: not the schedule either
    json(await dataset({ baseRevision: revision, id: 'live', rowKey: 'v', source: SOURCE }));
    expect(live('live')).toEqual({ ...before, rowKey: 'v' });
    // omitted, the row key stays
    json(await dataset({ baseRevision: store.revision(boardId), id: 'live', source: { ...SOURCE, schedule: 60 } }));
    expect(live('live')).toMatchObject({ rowKey: 'v', rows: 2, source: { schedule: 60 } });
  });

  it('starts an actual replacement of the query not fetched: another tool, server or arguments; its retention cleared', async () => {
    await configured();
    for (const change of [{ tool: 'other' }, { server: 'elsewhere' }, { args: { series: 'cost' } }]) {
      json(await dataset({ baseRevision: store.revision(boardId), id: 'live', source: SOURCE }));
      json(await dataset({ baseRevision: store.revision(boardId), id: 'live', refresh: true }));
      const before = live('live')!;
      const ref = (before.source as { snapshot: { ref: string } }).snapshot.ref;
      json(await dataset({ baseRevision: store.revision(boardId), id: 'live', rowKey: 't', source: { ...SOURCE, ...change } }));
      const after = live('live')!;
      expect(after).toEqual({ title: 'Revenue', rowKey: 't', source: { ...SOURCE, ...change, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: expect.any(Number) } });
      expect(after).not.toHaveProperty('updated');
      expect(memberships()).toEqual([]);
      const asset = store.listAssets(boardId).find((candidate) => candidate.ref === ref);
      if (asset) expect(storage.db.prepare('SELECT retiredAt FROM artifact_assets WHERE artifactId = ? AND assetId = ?').get(boardId, asset.assetId)).toEqual({ retiredAt: expect.any(Number) });
    }
  });

  it('refuses modes mixed, a schedule outside 30 s to 24 h and a staleAfter that is not a positive whole number, writing nothing', async () => {
    const base = await board();
    const revision = store.revision(boardId);
    for (const args of [
      { source: SOURCE, path: 'a.csv' },
      { source: SOURCE, ref: 'assets/a.csv' },
      { source: SOURCE, remove: true },
      { source: SOURCE, refresh: true },
      { refresh: true, title: 'T' },
      { refresh: true, rowKey: 't' },
      { refresh: true, path: 'a.csv' },
      { source: { ...SOURCE, schedule: 29 } },
      { source: { ...SOURCE, schedule: 86_401 } },
      { source: { ...SOURCE, schedule: 30.5 } },
      { source: { ...SOURCE, staleAfter: 0 } },
      { source: { ...SOURCE, args: { blob: 'x'.repeat(70_000) } } },
    ]) {
      expect((await dataset({ baseRevision: base, id: 'live', ...args })).isError, JSON.stringify(args).slice(0, 80)).toBe(true);
    }
    expect(store.revision(boardId)).toBe(revision);
  });
});

describe('artifact_dataset: one refresh', () => {
  it('asks main by the request’s id, publishes as this session, and answers the host’s durable record', async () => {
    const base = await configured();
    const answer = json(await dataset({ baseRevision: base, id: 'live', refresh: true }));
    expect(reads).toEqual([{ artifactId: boardId, datasetId: 'live', baseRevision: base, appSessionId: SELF, server: 'fixture', tool: 'rows', args: { series: 'revenue' } }]);
    expect(answer).toEqual({ status: 'dataset', artifactId: boardId, id: 'live', revision: store.revision(boardId), columns: [{ name: 't', type: 'number' }, { name: 'v', type: 'number' }], rows: 2 });
    expect(live('live')).toMatchObject({ rows: 2, updated: { by: { kind: 'session', appSessionId: SELF } }, state: { status: 'ok' } });
  });

  it('replays the first durable result of a repeated tool-use id without asking again', async () => {
    const base = await configured();
    const first = await dataset({ baseRevision: base, id: 'live', refresh: true }, { toolUseId: 'toolu_r' as ToolUseId });
    const again = await dataset({ baseRevision: base, id: 'live', refresh: true }, { toolUseId: 'toolu_r' as ToolUseId });
    expect(text(again)).toBe(text(first));
    expect(reads).toHaveLength(1);
  });

  it('answers a failed refresh with the error it recorded and the rows kept, not as a refusal', async () => {
    const base = await configured();
    main = (requestId, read) => asMain(requestId, read, { kind: 'result', result: { content: 'not json' } });
    const answer = json(await dataset({ baseRevision: base, id: 'live', refresh: true }));
    expect(answer).toMatchObject({ status: 'dataset', rows: 0, notFetched: true, state: { status: 'error', message: expect.stringContaining('not JSON') } });
    expect(live('live')!.state.status).toBe('error');
  });

  it('refuses with main’s closed reason when nothing was published, writing nothing; never main’s words as an answer', async () => {
    const base = await configured();
    const revision = store.revision(boardId);
    for (const [outcome, words] of [
      [{ ok: false, state: 'revoked', reason: 'notGranted' }, /grant/],
      [{ ok: false, state: 'paused', reason: 'noRoute' }, /live session/],
      [{ ok: false, state: 'invalid', reason: 'notReadOnly' }, /read-only/],
      [{ ok: true }, /no publication/],
    ] as const) {
      main = async (requestId) => void requests.answer(requestId, outcome);
      const answer = refusal(await dataset({ baseRevision: base, id: 'live', refresh: true }));
      expect(answer).toMatchObject({ reason: 'unavailable' });
      expect(text(await dataset({ baseRevision: base, id: 'live', refresh: true })), JSON.stringify(outcome)).toMatch(words);
    }
    expect(store.revision(boardId)).toBe(revision);
  });

  it('refuses before asking: a dataset missing, not a query, changed since the base; and with no app or no registry', async () => {
    const base = await configured();
    expect(refusal(await dataset({ baseRevision: store.revision(boardId), id: 'nope', refresh: true }))).toMatchObject({ reason: 'notFound', dataset: 'nope' });
    await store.writeWithAssets(boardId, { kind: 'human' }, [], (doc) => setDataset(doc, 'file', { title: 'F', source: { kind: 'file', ref: 'assets/a.csv', name: 'a.csv', format: 'csv', sha256: 'a'.repeat(64), size: 1 }, columns: [], rows: 0, updated: { at: 1, by: { kind: 'human' } }, state: { status: 'ok', at: 1 } } as DatasetDescriptor));
    expect(refusal(await dataset({ baseRevision: store.revision(boardId), id: 'file', refresh: true }))).toMatchObject({ reason: 'invalid', dataset: 'file' });
    await store.writeWithAssets(boardId, { kind: 'human' }, [], (doc) => setDataset(doc, 'live', { ...live('live')!, title: 'Renamed' }));
    expect(refusal(await dataset({ baseRevision: base, id: 'live', refresh: true }))).toMatchObject({ reason: 'conflict', dataset: 'live' });
    client = false;
    expect(refusal(await dataset({ baseRevision: store.revision(boardId), id: 'live', refresh: true }))).toMatchObject({ reason: 'unavailable' });
    expect(reads).toEqual([]);
    const bare = new Map(mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => store }).map((tool) => [tool.name, tool]));
    expect(refusal(await bare.get('artifact_dataset')!.call({ artifact: 'board', baseRevision: store.revision(boardId), id: 'live', refresh: true }, ctx()))).toMatchObject({ reason: 'unavailable' });
  });

  // E3 M2 fix (reviewer finding 5): a concurrent change of the dataset is XE6's descriptor-level conflict, never a
  // tool's failure or an invalid input, whether the host's admission or its publication found it
  it('answers a descriptor-level conflict when the dataset changed before the host admitted the call main started', async () => {
    const base = await configured();
    main = async (requestId, read) => {
      await store.writeWithAssets(boardId, { kind: 'human' }, [], (doc) => setDataset(doc, 'live', { ...live('live')!, title: 'Moved' }));
      await asMain(requestId, read);
    };
    const answer = await dataset({ baseRevision: base, id: 'live', refresh: true });
    expect(refusal(answer)).toMatchObject({ reason: 'conflict', dataset: 'live', detail: 'replaced since your read', liveRevision: store.revision(boardId) });
    expect(text(answer)).toMatch(/changed since revision/);
    expect(live('live')).toMatchObject({ title: 'Moved', source: { snapshot: null } });
  });

  it('answers a descriptor-level conflict when the dataset changed between the call’s admission and its publication', async () => {
    const base = await configured();
    main = async (requestId, read) => {
      const sink = connectorDatasetSink({ store: () => store, requests });
      const admission = await sink.admit({ appSessionId: read.appSessionId, artifactId: read.artifactId, server: read.server, tool: read.tool, arguments: read.args, dataset: { id: read.datasetId, baseRevision: read.baseRevision, requestId } }, () => {});
      if (!('publish' in admission)) throw new Error(admission.refusal);
      await store.writeWithAssets(boardId, { kind: 'human' }, [], (doc) => setDataset(doc, 'live', { ...live('live')!, title: 'Moved' }));
      await admission.publish({ kind: 'result', result: { content: '', structuredContent: ROWS } }, () => 'held');
      requests.answer(requestId, { ok: false, state: 'failed', reason: 'toolError' });
    };
    const answer = await dataset({ baseRevision: base, id: 'live', refresh: true });
    expect(text(answer)).toMatch(/changed since the refresh began/);
    expect(refusal(answer)).toMatchObject({ reason: 'conflict', dataset: 'live', detail: 'replaced since your read', liveRevision: store.revision(boardId) });
    expect(live('live')).toMatchObject({ title: 'Moved', rows: 0, source: { snapshot: null } }); // the move alone: no descriptor write
    expect(store.listAssets(boardId)).toEqual([]);
    // removed meanwhile: the conflict says so
    const again = store.revision(boardId);
    main = async (requestId, read) => {
      const sink = connectorDatasetSink({ store: () => store, requests });
      const admission = await sink.admit({ appSessionId: read.appSessionId, artifactId: read.artifactId, server: read.server, tool: read.tool, arguments: read.args, dataset: { id: read.datasetId, baseRevision: read.baseRevision, requestId } }, () => {});
      if (!('publish' in admission)) throw new Error(admission.refusal);
      await store.writeWithAssets(boardId, { kind: 'human' }, [], (doc) => removeDataset(doc, 'live'));
      await admission.publish({ kind: 'result', result: { content: '', structuredContent: ROWS } }, () => 'held');
    };
    expect(refusal(await dataset({ baseRevision: again, id: 'live', refresh: true }))).toMatchObject({ reason: 'conflict', dataset: 'live', detail: 'removed since your read' });
  });
});
