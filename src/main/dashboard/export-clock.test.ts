// E3 M3 fix (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R4 and Decision Log 11, 12): a dashboard export
// in main captures one clock with its state, and every view of every format labels its query's staleness at that
// clock, whatever the time when its snapshot's pages arrive and whatever any window shows. A retained version's export
// keeps its saved labels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: class {} }));
import { setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { DATASET_STATES } from '@artifacts/dashboard/states';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument } from '@artifacts/document/tabs';
import { newDoc, stateV2 } from '@artifacts/yjs';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { DocumentExportContext, DocumentExporter, DocumentExportFormat, DocumentExportRequest } from '../artifacts/export-document';
import { registerDashboardExporters } from './export';

const ID = '00000000-0000-4000-8000-0000000000e3';
const AT = Date.UTC(2026, 9, 17, 9, 0);
const columns = [
  { name: 'region', type: 'string' as const },
  { name: 'total', type: 'number' as const },
];
const query = (ref: string, staleAfter: number): DatasetDescriptor => ({
  title: `Live ${ref.slice(-6, -5)}`,
  source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, staleAfter, snapshot: { ref, at: AT } },
  columns,
  rows: 1,
  updated: { at: AT, by: { kind: 'human' } },
  state: { status: 'ok', at: AT },
});

function state(): Uint8Array {
  const doc = newDoc();
  const chart = (id: string, source: string) => ({ type: 'chart', attrs: { id, source, spec: { view: 'table', title: `View ${id}` } } });
  createDocument(doc, { title: 'Board', body: schemaFor().nodeFromJSON({ type: 'doc', content: [chart('c1', 'a'), chart('c2', 'b')] }) });
  setDataset(doc, 'a', query('assets/query-a.json', 60)); // stale from AT + 60 s
  setDataset(doc, 'b', query('assets/query-b.json', 120)); // stale from AT + 120 s
  return stateV2(doc);
}

// The host's pages: b's arrives only after the clock has moved past b's boundary.
function host() {
  const call = vi.fn(async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>> => {
    if (name === 'designSystems.governing') return { ok: true, value: { system: { builtin: true } } } as never;
    if (name === 'artifacts.readDataset') {
      const read = input as CommandInput<'artifacts.readDataset'>;
      if (read.ref === 'assets/query-b.json') vi.setSystemTime(AT + 10 * 60_000);
      return { ok: true, value: { columns, rows: [['North', 1]], total: 1, truncated: false } } as never;
    }
    throw new Error(`unexpected ${name}`);
  });
  const out = new Map<DocumentExportFormat, DocumentExporter>();
  registerDashboardExporters((exporter) => (out.set(exporter.format, exporter), () => out.delete(exporter.format)), { call: call as never, env: {} });
  return out;
}

async function run(format: 'md' | 'html', versionId?: number): Promise<string> {
  const written = new Map<string, Uint8Array | string>();
  const ctx: DocumentExportContext = {
    title: 'Board',
    state: vi.fn(async () => state()),
    readAsset: vi.fn(async () => null),
    printToPdf: vi.fn(async () => new Uint8Array()),
    writeFile: vi.fn(async (path: string, data: Uint8Array | string) => void written.set(path, data)),
    signal: new AbortController().signal,
    assets: { list: async () => [] },
  };
  const request: DocumentExportRequest = { artifactId: ID, kind: 'dashboard', format, revision: 9, path: `/exports/${format}`, ...(versionId !== undefined && { versionId }) };
  vi.setSystemTime(AT + 90_000); // the export's capture: past a's boundary, before b's
  await host().get(format)!.run(request, ctx);
  return String(written.get(`/exports/${format}`));
}

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
afterEach(() => vi.useRealTimers());

describe('a dashboard export’s captured clock in main (E3 M3 fix)', () => {
  for (const format of ['md', 'html'] as const) {
    it(`${format}: labels each query at the clock captured with the state, not when its pages arrived`, async () => {
      const text = await run(format);
      expect(text).toContain(DATASET_STATES.staleSince(AT + 60_000)); // a: stale at the captured clock
      expect(text).not.toContain(DATASET_STATES.staleSince(AT + 120_000)); // b: its boundary passed only while it was read
    });
  }

  it('a retained version’s export keeps the saved labels', async () => {
    const text = await run('md', 4);
    expect(text).not.toContain('stale since');
  });
});
