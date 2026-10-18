// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R2, R4; E's Decision Log 48 (4)): the query arm of the
// dataset descriptor. A configured query that was never fetched has `snapshot: null` and no `updated`; a fetched one
// names its snapshot and keeps `updated`; a file descriptor is unchanged. `snapshotOf` answers null for the unfetched
// arm, so no consumer asks for bytes; `datasetStateAt` adds the render-time stale label beside the stored state.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { newDoc } from '../yjs';
import { QUERY_SCHEDULE_SECONDS, readDataset, setDataset, snapshotOf, type DatasetDescriptor, type FetchedQueryDatasetDescriptor, type FileDatasetDescriptor, type UnfetchedQueryDatasetDescriptor } from './datasets';
import { DATASET_STATES, datasetStateAt, sourceLabel } from './states';

const AT = Date.UTC(2026, 9, 17, 9, 0);
const session = { kind: 'session', appSessionId: 'app-q' as AppSessionId } as const;

const QUERY = { kind: 'query', server: 'fixture', tool: 'rows', args: { region: 'west' }, schedule: 30, staleAfter: 120 } as const;
const unfetched = (over: Partial<UnfetchedQueryDatasetDescriptor['source']> = {}): UnfetchedQueryDatasetDescriptor => ({
  title: 'Live sales',
  source: { ...QUERY, snapshot: null, ...over },
  columns: [],
  rows: 0,
  state: { status: 'ok', at: AT },
});
const fetched = (at = AT): FetchedQueryDatasetDescriptor => ({
  title: 'Live sales',
  source: { ...QUERY, snapshot: { ref: 'assets/query-1.json', at } },
  columns: [{ name: 'v', type: 'number' }],
  rows: 3,
  updated: { at, by: { kind: 'human' } },
  state: { status: 'ok', at: AT },
});
/** A value no arm admits, as a replica or a careless caller could hand it over. */
const invalid = (value: object) => value as unknown as DatasetDescriptor;

describe('the query descriptor (E3)', () => {
  it('stores and reads a configured query that was never fetched: no snapshot, no rows, no updated', () => {
    const doc = newDoc();
    setDataset(doc, 'live', unfetched());
    expect(readDataset(doc, 'live')).toEqual(unfetched());
    expect(snapshotOf(readDataset(doc, 'live')!)).toBeNull();
  });

  it('stores a fetched query with its snapshot and updated, read as JSON by its ref', () => {
    const doc = newDoc();
    setDataset(doc, 'live', fetched());
    expect(readDataset(doc, 'live')).toEqual(fetched());
    expect(snapshotOf(fetched())).toEqual({ ref: 'assets/query-1.json', format: 'json' });
  });

  it('refuses the inconsistent arms: an unfetched query with updated, a fetched one without, a file without updated', () => {
    const doc = newDoc();
    expect(() => setDataset(doc, 'a', invalid({ ...unfetched(), updated: { at: AT, by: { kind: 'human' } } }))).toThrow();
    expect(() => setDataset(doc, 'b', invalid({ ...fetched(), updated: undefined }))).toThrow();
    const file: FileDatasetDescriptor = {
      title: 'Sales',
      source: { kind: 'file', ref: 'assets/s.csv', name: 's.csv', format: 'csv', sha256: 'a'.repeat(64), size: 3 },
      columns: [],
      rows: 0,
      updated: { at: AT, by: session },
      state: { status: 'ok', at: AT },
    };
    setDataset(doc, 'c', file);
    expect(() => setDataset(doc, 'd', invalid({ ...file, updated: undefined }))).toThrow();
    // a value written by a replica in an inconsistent arm reads as no descriptor, never throwing
    doc.get('datasets').setAttr('junk', { ...unfetched(), updated: { at: AT, by: { kind: 'human' } } });
    expect(readDataset(doc, 'junk')).toBeNull();
  });

  it('bounds the schedule to 30 s to 24 h inclusive and staleAfter to a positive integer', () => {
    expect(QUERY_SCHEDULE_SECONDS).toEqual({ min: 30, max: 86_400 });
    const doc = newDoc();
    for (const schedule of [30, 3_600, 86_400]) setDataset(doc, `ok${schedule}`, unfetched({ schedule }));
    for (const schedule of [29, 86_401, 30.5, 0]) expect(() => setDataset(doc, 'bad', unfetched({ schedule })), String(schedule)).toThrow();
    for (const staleAfter of [0, -1, 1.5]) expect(() => setDataset(doc, 'bad', unfetched({ staleAfter })), String(staleAfter)).toThrow();
    const manual: UnfetchedQueryDatasetDescriptor['source'] = { ...unfetched().source };
    delete manual.schedule;
    delete manual.staleAfter;
    setDataset(doc, 'manual', { ...unfetched(), source: manual });
    expect(readDataset(doc, 'manual')?.source).toEqual(manual);
  });
});

describe('the query states (E3)', () => {
  it('labels a never-fetched query "not fetched", with no fabricated time or author', () => {
    expect(DATASET_STATES.notFetched).toBe('not fetched');
    expect(sourceLabel(unfetched(), 'You')).toBe('Live sales · fixture · rows · not fetched');
    expect(sourceLabel({ ...unfetched(), state: { status: 'error', message: 'the tool answered no rows', at: AT } }, 'You')).toBe('Live sales · fixture · rows · not fetched · the tool answered no rows');
  });

  it('keeps the fetched label: the server and tool, the fetch provenance and the operational state', () => {
    expect(sourceLabel(fetched(), 'You')).toBe('Live sales · fixture · rows · updated 2026-10-17 09:00 UTC by You');
    expect(sourceLabel({ ...fetched(), state: { status: 'paused', at: AT + 5 } }, 'You')).toBe(`Live sales · fixture · rows · updated 2026-10-17 09:00 UTC by You · ${DATASET_STATES.paused}`);
  });

  it('datasetStateAt: stale from snapshot.at + staleAfter, beside (never instead of) the stored state; none unfetched or without staleAfter', () => {
    const d = fetched();
    expect(datasetStateAt(d, AT + 119_999)).toEqual({ state: d.state, notFetched: false });
    expect(datasetStateAt(d, AT + 120_000)).toEqual({ state: d.state, notFetched: false, staleSince: AT + 120_000 });
    const paused = { ...d, state: { status: 'paused' as const, at: AT + 200_000 } };
    expect(datasetStateAt(paused, AT + 500_000)).toEqual({ state: paused.state, notFetched: false, staleSince: AT + 120_000 });
    expect(datasetStateAt(unfetched(), AT + 10_000_000)).toEqual({ state: unfetched().state, notFetched: true });
    const never: FetchedQueryDatasetDescriptor['source'] = { ...d.source };
    delete never.staleAfter;
    expect(datasetStateAt({ ...d, source: never }, AT + 10_000_000)).toEqual({ state: d.state, notFetched: false });
    const file: FileDatasetDescriptor = { ...d, source: { kind: 'file', ref: 'assets/s.csv', name: 's.csv', format: 'csv', sha256: 'a'.repeat(64), size: 3 } };
    expect(datasetStateAt(file, AT + 10_000_000)).toEqual({ state: d.state, notFetched: false });
    expect(DATASET_STATES.staleSince(AT + 120_000)).toBe('stale since 2026-10-17 09:02 UTC');
  });
});

// E3 M1 fix wave (task review finding 4): the descriptor is a discriminated union of three arms, at runtime and in the
// type: a file (its bind's `updated` required), a fetched query (its fetch's `updated` required) and a query never
// fetched (`snapshot: null`, no `updated`, no rows, no columns).
describe('the descriptor union (E3)', () => {
  it('refuses an unfetched query that claims rows or columns', () => {
    const doc = newDoc();
    expect(() => setDataset(doc, 'rows', invalid({ ...unfetched(), rows: 3 }))).toThrow();
    expect(() => setDataset(doc, 'columns', invalid({ ...unfetched(), columns: [{ name: 'v', type: 'number' }] }))).toThrow();
    doc.get('datasets').setAttr('junk', { ...unfetched(), rows: 2 });
    expect(readDataset(doc, 'junk')).toBeNull();
  });

  it('types each arm: a file and a fetched query need updated; an unfetched query may have neither updated nor rows', () => {
    const state = { status: 'ok' as const, at: AT };
    const file: FileDatasetDescriptor = { title: 'Sales', source: { kind: 'file', ref: 'assets/s.csv', name: 's.csv', format: 'csv', sha256: 'a'.repeat(64), size: 3 }, columns: [], rows: 0, updated: { at: AT, by: session }, state };
    // @ts-expect-error a file's descriptor names who bound it
    const fileWithout: FileDatasetDescriptor = { title: 'Sales', source: file.source, columns: [], rows: 0, state };
    // @ts-expect-error a fetched query's descriptor names its fetch's provenance
    const fetchedWithout: FetchedQueryDatasetDescriptor = { title: 'Live', source: { kind: 'query', server: 's', tool: 't', args: {}, snapshot: { ref: 'assets/q.json', at: AT } }, columns: [], rows: 0, state };
    // @ts-expect-error a query never fetched has no update to name
    const unfetchedWith: UnfetchedQueryDatasetDescriptor = { title: 'Live', source: { kind: 'query', server: 's', tool: 't', args: {}, snapshot: null }, columns: [], rows: 0, updated: { at: AT, by: session }, state };
    // @ts-expect-error a query never fetched has no rows
    const unfetchedRows: UnfetchedQueryDatasetDescriptor = { title: 'Live', source: { kind: 'query', server: 's', tool: 't', args: {}, snapshot: null }, columns: [], rows: 3, state };
    // the union narrows by its arm: a file's or a fetched query's updated needs no check, nor its snapshot
    const by = (d: FileDatasetDescriptor | FetchedQueryDatasetDescriptor) => d.updated.by;
    expect(by(file)).toEqual(session);
    expect(snapshotOf(file).ref).toBe('assets/s.csv');
    expect([fileWithout, fetchedWithout, unfetchedWith, unfetchedRows]).toHaveLength(4);
  });
});
