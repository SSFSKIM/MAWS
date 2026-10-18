// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R2): `artifact_read`'s datasets footer over a query.
// A query never fetched says so (`notFetched`) and names no update; a fetched one names its `server · tool` and the
// fetch's provenance, as a file names its file.
import { describe, expect, it } from 'vitest';
import { setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { newDoc } from '@artifacts/yjs';
import { datasetFooter } from './answers';

const AT = Date.UTC(2026, 9, 17, 9, 0);
const base = { title: 'Live sales', state: { status: 'ok' as const, at: AT } };
const author = () => ({ by: 'user' as const });

describe('the datasets footer over a query (E3)', () => {
  it('lists a never-fetched query as not fetched, with no update', () => {
    const doc = newDoc();
    const unfetched: DatasetDescriptor = { ...base, source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: null }, columns: [], rows: 0 };
    setDataset(doc, 'live', unfetched);
    setDataset(doc, 'failed', { ...unfetched, state: { status: 'error', message: 'the tool answered no rows', at: AT } });
    expect(datasetFooter(doc, author)).toEqual([
      { id: 'failed', title: 'Live sales', file: 'fixture · rows', columns: [], rows: 0, notFetched: true, state: { status: 'error', message: 'the tool answered no rows' } },
      { id: 'live', title: 'Live sales', file: 'fixture · rows', columns: [], rows: 0, notFetched: true },
    ]);
  });

  it('lists a fetched query with its fetch provenance', () => {
    const doc = newDoc();
    setDataset(doc, 'live', { ...base, source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref: 'assets/query-a.json', at: AT } }, columns: [{ name: 'v', type: 'number' }], rows: 2, updated: { at: AT, by: { kind: 'human' } } });
    expect(datasetFooter(doc, author)).toEqual([{ id: 'live', title: 'Live sales', file: 'fixture · rows', columns: [{ name: 'v', type: 'number' }], rows: 2, updated: { at: '2026-10-17T09:00:00.000Z', by: 'user' } }]);
  });
});
