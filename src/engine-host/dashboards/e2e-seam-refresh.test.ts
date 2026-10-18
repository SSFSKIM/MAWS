// E3 M4 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R5, Decision Log 13): the dashboard acceptance seam
// with the host's registry of agents' dataset refreshes injected, as the host's entry injects its own. A session's
// `artifact_dataset {refresh: true}` asks the injected registry, as that session (the seam's session name is the app
// session id the request carries, so a live data run names the session the owner's Start launched), and answers what
// the registry settles. Without one, the refresh is refused as unavailable and nothing is asked: E2's seam unchanged.
// Main is played only by its reply that nothing was published; no publication is staged here.
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDataset } from '@artifacts/dashboard/datasets';
import { artifactRefusalOf } from '@shared/maws/tools';
import { DatasetRefreshRequests, type DatasetRefreshRead } from '../connectors/dataset-requests';
import { registerDocumentKind, type DocumentKind } from '../documents/kinds/document';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { registerDashboards, type Dashboards } from '.';
import { DashboardE2eSeam, startDashboardE2eSeam, type DashboardCallAnswer, type DashboardSeamAnswer } from './e2e-seam';

// the app session id a real Start mints (record-actions.ts: a UUID), as the e2e names it to the seam
const STARTED = '6f1c2a9e-3b7d-4e21-9a55-0c8d7e6f5a41';
const SOURCE = { kind: 'query', server: 'fixture', tool: 'read_series', args: { series: 'signups' }, schedule: 30 } as const;

let data: string;
let world: { storage: SqliteDocumentStorage; service: DocumentService; store: ArtifactStore; kind: DocumentKind; dashboards: Dashboards };
let requests: DatasetRefreshRequests;
let announced: { requestId: string; read: DatasetRefreshRead | null }[];
let seam: DashboardE2eSeam | null;

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'maws-dashboard-seam-refresh-'));
  const storage = SqliteDocumentStorage.open(join(data, 'store.sqlite'), { log: () => {} });
  const service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id) });
  const store = new ArtifactStore(service, storage, { root: data, log: () => {} });
  world = { storage, service, store, kind: registerDocumentKind(store), dashboards: registerDashboards({ documents: { store, service } }) };
  announced = [];
  requests = new DatasetRefreshRequests({ hasClient: () => true, announce: (requestId) => announced.push({ requestId, read: requests.read(requestId) }) });
  seam = null;
});
afterEach(() => {
  seam?.close();
  world.dashboards.close();
  world.kind.close();
  world.store.close();
  world.service.close();
  world.storage.close();
  rmSync(data, { recursive: true, force: true });
});

const answered = (answer: DashboardSeamAnswer): DashboardCallAnswer => {
  if (!answer.ok || !('isError' in answer)) throw new Error(`not a call's answer: ${JSON.stringify(answer)}`);
  return answer;
};
const result = <T,>(answer: DashboardSeamAnswer): T => {
  const call = answered(answer);
  if (call.isError) throw new Error(`a refusal: ${call.text}`);
  return call.result as T;
};
const until = async (done: () => boolean, what: string) => {
  for (let k = 0; k < 300 && !done(); k++) await new Promise((resolve) => setTimeout(resolve, 10));
  if (!done()) throw new Error(`timed out waiting for ${what}`);
};

// A dashboard with a configured query dataset (no fetch), made through the seam as the session; answers its id.
async function configured(on: DashboardE2eSeam, session: string): Promise<string> {
  const { artifactId } = result<{ artifactId: string }>(await on.run({ cmd: 'call', session, tool: 'artifact_create', args: { kind: 'dashboard', title: 'Signups', content: '# Signups ^h1\n' } }));
  result(await on.run({ cmd: 'call', session, tool: 'artifact_dataset', args: { artifact: artifactId, id: 'signups', title: 'Signups', source: SOURCE, baseRevision: 'last' } }));
  return artifactId;
}
const refresh = (on: DashboardE2eSeam, session: string, artifactId: string) => on.run({ cmd: 'call', session, tool: 'artifact_dataset', args: { artifact: artifactId, id: 'signups', refresh: true, baseRevision: 'last' } });

describe('the dashboard seam’s dataset refresh (E3 M4)', () => {
  it('with the host’s registry injected, asks it as the named session and answers what main settles, nothing published', async () => {
    seam = new DashboardE2eSeam(world.store, join(data, 'cwd'), requests);
    const artifactId = await configured(seam, STARTED);
    const base = world.store.revision(artifactId);
    const pending = refresh(seam, STARTED, artifactId);
    await until(() => announced.length === 1, 'the refresh request’s announcement');
    expect(announced[0]!.read).toEqual({ artifactId, datasetId: 'signups', baseRevision: base, appSessionId: STARTED, server: 'fixture', tool: 'read_series', args: { series: 'signups' } });
    expect(requests.answer(announced[0]!.requestId, { ok: false, state: 'revoked', reason: 'notGranted' })).toBe('delivered');
    const answer = answered(await pending);
    expect(answer.isError).toBe(true);
    expect(artifactRefusalOf(answer.text)).toMatchObject({ reason: 'unavailable', dataset: 'signups' });
    expect(answer.text).toContain('has not granted fixture · read_series');
    expect(world.store.revision(artifactId), 'nothing written').toBe(base);
    expect(readDataset(world.store.service.live(artifactId), 'signups')).toMatchObject({ source: { snapshot: null }, rows: 0 });
  });

  it('without a registry, refuses the refresh as unavailable and asks nothing, as E2’s seam always has', async () => {
    seam = new DashboardE2eSeam(world.store, join(data, 'cwd'));
    const artifactId = await configured(seam, STARTED);
    const answer = answered(await refresh(seam, STARTED, artifactId));
    expect(answer.isError).toBe(true);
    expect(artifactRefusalOf(answer.text)).toMatchObject({ reason: 'unavailable' });
    expect(answer.text).toContain('this run of MAWS cannot refresh a dataset');
    expect(announced).toEqual([]);
  });

  it('startDashboardE2eSeam keeps its log argument and hands the registry to the seam it serves over the file channel', async () => {
    const dir = join(data, 'dashboard-e2e');
    const lines: string[] = [];
    const served = startDashboardE2eSeam(world.store, dir, (line) => lines.push(line), requests);
    let n = 0;
    const send = async (command: unknown): Promise<DashboardSeamAnswer> => {
      const name = `${String(++n).padStart(8, '0')}.json`;
      writeFileSync(join(dir, 'in', `${name}.tmp`), JSON.stringify(command));
      renameSync(join(dir, 'in', `${name}.tmp`), join(dir, 'in', name));
      const out = join(dir, 'out', name);
      await until(() => existsSync(out), `the answer to ${name}`);
      return JSON.parse(readFileSync(out, 'utf8')) as DashboardSeamAnswer;
    };
    try {
      const { artifactId } = result<{ artifactId: string }>(await send({ cmd: 'call', session: STARTED, tool: 'artifact_create', args: { kind: 'dashboard', title: 'Signups', content: '# Signups ^h1\n' } }));
      result(await send({ cmd: 'call', session: STARTED, tool: 'artifact_dataset', args: { artifact: artifactId, id: 'signups', source: SOURCE, baseRevision: 'last' } }));
      const pending = send({ cmd: 'call', session: STARTED, tool: 'artifact_dataset', args: { artifact: artifactId, id: 'signups', refresh: true, baseRevision: 'last' } });
      await until(() => announced.length === 1, 'the refresh request’s announcement');
      expect(announced[0]!.read).toMatchObject({ artifactId, appSessionId: STARTED });
      requests.answer(announced[0]!.requestId, { ok: false, state: 'paused', reason: 'noRoute' });
      const answer = answered(await pending);
      expect(answer.isError).toBe(true);
      expect(answer.text).toContain('does not have fixture connected');
      expect(lines.filter((line) => /error|fail/i.test(line))).toEqual([]);
    } finally {
      served.close();
    }
  });
});
