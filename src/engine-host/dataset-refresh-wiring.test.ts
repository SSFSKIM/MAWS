// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): the host's composition of an agent's dataset
// refresh, as src/engine-host/index.ts wires it: one registry given to the artifacts surface (main's read), the
// connector leg (a start's claim) and the engine IPC (main's reply), each reached through its registered handler with
// its input and output validated against the registry. The announcement carries the id alone.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, EventName } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { MAIN_ONLY_COMMANDS, NAMES } from '@shared/ipc/names';
import { setDataset } from '@artifacts/dashboard/datasets';
import { hostDatasetRefresh, type DatasetRefreshRequests } from './connectors/dataset-requests';
import { registerConnectors } from './connectors/register';
import { registerDashboards, type Dashboards } from './dashboards';
import { openDocuments, type Documents } from './documents';
import { registerArtifacts } from './documents/register';
import { registerEngineIpc } from './ipc';

let dir: string;
let documents: Documents;
let dashboards: Dashboards;
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
let emitted: { name: EventName; payload: unknown }[];
let requests: DatasetRefreshRequests;
let closers: { close(): void }[];
let gone: (() => void)[]; // main's client going

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-refresh-wiring-'));
  documents = openDocuments(join(dir, 'data'), () => {})!;
  dashboards = registerDashboards({ documents });
  handlers = new Map();
  emitted = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    expect(validateEventPayload(name, payload).ok, name).toBe(true);
    emitted.push({ name, payload });
    return true;
  };
  gone = [];
  const client = { onDocPort: () => {}, hasClient: () => true, onClientGone: (hook: () => void) => (gone.push(hook), () => {}) };
  requests = hostDatasetRefresh(emit, client);
  closers = [registerArtifacts(on, emit, client, { documents, env: {}, datasetRefresh: requests })];
  const ipc = registerEngineIpc(on, emit, { userData: dir, replayEnabled: false, artifacts: () => documents.store, datasetRefresh: requests });
  closers.push(registerConnectors(on, emit, client as never, { sessions: ipc.table, store: documents.store, datasetRefresh: requests }));
});
afterEach(() => {
  for (const closer of closers) closer.close();
  dashboards.close();
  documents.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(name: CommandName, input: unknown): Promise<unknown> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}`);
  const value = await handlers.get(name)!(checked.value);
  expect(validateCommandOutput(name, value).ok, `${name} output ${JSON.stringify(value)}`).toBe(true);
  return value;
}

describe('an agent’s dataset refresh through the host’s handlers', () => {
  it('keeps the reply main-only and the announcement to the id', () => {
    expect(MAIN_ONLY_COMMANDS).toContain('maws.artifact.datasetRefreshed');
    expect([...NAMES.maws.commands]).not.toContain('maws.artifact.datasetRefreshed');
    expect(MAIN_ONLY_COMMANDS).toContain('artifacts.datasetRefreshRequest');
    expect([...NAMES.artifacts.commands]).not.toContain('artifacts.datasetRefreshRequest');
    expect([...NAMES.maws.events]).toContain('maws.artifact.datasetRefresh');
    expect(validateEventPayload('maws.artifact.datasetRefresh', { requestId: '00000000-0000-4000-8000-000000000001' }).ok).toBe(true);
    expect(validateEventPayload('maws.artifact.datasetRefresh', { requestId: '00000000-0000-4000-8000-000000000001', artifactId: '00000000-0000-4000-8000-000000000002' }).ok).toBe(false);
  });

  it('serves main’s read, a start’s one claim and main’s reply from the one registry', async () => {
    const artifactId = (await documents.store.create({ kind: 'dashboard', title: 'Board' }, { kind: 'human' })).id;
    // E3 M2 fix: the query the request names (a dataset gone would settle the request at once, as a conflict)
    await documents.store.writeWithAssets(artifactId, { kind: 'human' }, [], (doc) => setDataset(doc, 'live', { title: 'Live', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: null }, columns: [], rows: 0, state: { status: 'ok', at: 1 } }));
    const baseRevision = documents.store.revision(artifactId);
    const asked = requests.ask({ artifactId, datasetId: 'live', baseRevision, appSessionId: 'app-1' as AppSessionId, opId: 'app-1/toolu_1', server: 'fixture', tool: 'rows', args: {} }, new AbortController().signal);
    const [announcement] = emitted.filter((entry) => entry.name === 'maws.artifact.datasetRefresh');
    const { requestId } = announcement!.payload as { requestId: string };
    expect(Object.keys(announcement!.payload as object)).toEqual(['requestId']);
    expect(await call('artifacts.datasetRefreshRequest', { requestId })).toEqual({ request: { artifactId, datasetId: 'live', baseRevision, appSessionId: 'app-1', server: 'fixture', tool: 'rows', args: {} } });
    const start = { appSessionId: 'app-1', launchId: 'L1', cwd: '/work', artifactId, server: 'fixture', tool: 'rows', arguments: {}, fingerprint: 'f'.repeat(64), mode: 'read', dataset: { id: 'live', baseRevision, requestId } };
    await call('connectors.start', { ...start, operationId: '00000000-0000-4000-8000-0000000000a1' });
    await call('connectors.start', { ...start, operationId: '00000000-0000-4000-8000-0000000000a2' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = (await call('connectors.take', { operationId: '00000000-0000-4000-8000-0000000000a2' })) as { outcome: { message: string } };
    expect(second.outcome.message).toMatch(/no pending dataset refresh request/); // the request was claimed by the first
    expect(await call('maws.artifact.datasetRefreshed', { requestId, outcome: { ok: false, state: 'paused', reason: 'noRoute' } })).toEqual({ outcome: 'delivered' });
    expect(await asked).toMatchObject({ kind: 'refused', outcome: { reason: 'noRoute' } });
    expect(await call('maws.artifact.datasetRefreshed', { requestId, outcome: { ok: true } })).toEqual({ outcome: 'not_pending' });
    expect(await call('artifacts.datasetRefreshRequest', { requestId })).toEqual({ request: null });
  });

  it('ends a pending request when main’s client goes', async () => {
    const asked = requests.ask({ artifactId: '00000000-0000-4000-8000-000000000003', datasetId: 'live', baseRevision: 0, appSessionId: 'app-1' as AppSessionId, opId: null, server: 'fixture', tool: 'rows', args: {} }, new AbortController().signal);
    for (const hook of gone) hook();
    expect(await asked).toEqual({ kind: 'noClient' });
  });
});
