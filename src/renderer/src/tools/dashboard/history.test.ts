// P3-E2 M4 (E's Decision Log 8 and 28 (4)): the history hook's path to B's rail. `extraChanges` on HistoryApiDeps
// reaches the HistoryApi B's controller reads, and on DocumentTabDeps reaches the tab's history; a dashboard's tab state
// gives its dataset changes there, while a document's tab, made without it, has no hook (B's history unchanged).
import { describe, expect, it, vi } from 'vitest';
import { datasetChanges } from '@artifacts/dashboard/history';
import type { ArtifactHost } from '@artifacts/host';
import type { MawsBridge } from '@shared/ipc/schema';
import { createHistoryApi } from '../document/history-api';
import { DocumentTabState, type DocumentTabDeps } from '../document/tab-state';
import { DashboardTabState } from './tab-state';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
  invoke: (async () => ({ ok: false, error: { code: 'internal', message: 'not here' } })) as unknown as MawsBridge['invoke'],
  on: (() => () => {}) as unknown as MawsBridge['on'],
};
const deps = (): DocumentTabDeps => ({
  host: { open: () => new Promise(() => {}), identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' }) } as unknown as ArtifactHost,
  ipc,
  log: () => {},
  confirm: () => true,
  sessionTitle: () => undefined,
  sessions: () => [],
});

describe('the history hook’s path (P3-E2 M4)', () => {
  it('HistoryApiDeps.extraChanges is the api’s hook; absent, the api has none', () => {
    const hook = vi.fn(() => []);
    const host = { versionState: vi.fn(), attributions: vi.fn() };
    const viewedAt = { get: () => null, set: () => {} };
    expect(createHistoryApi({ artifactId: A, ipc, host, viewedAt, log: () => {}, extraChanges: hook }).extraChanges).toBe(hook);
    expect('extraChanges' in createHistoryApi({ artifactId: A, ipc, host, viewedAt, log: () => {} })).toBe(false);
  });

  it('a dashboard tab’s history counts its dataset changes; a document tab’s has no hook', () => {
    const dashboard = new DashboardTabState({ artifactId: A, kind: 'dashboard', surface: 'panel' }, deps());
    const document = new DocumentTabState({ artifactId: A, kind: 'document', surface: 'panel' }, deps());
    try {
      expect(dashboard.document.history.extraChanges).toBe(datasetChanges);
      expect(document.history.extraChanges).toBeUndefined();
    } finally {
      dashboard.dispose();
      document.dispose();
    }
  });
});
