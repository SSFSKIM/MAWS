// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R2, R4; E's Decision Log 48 (4)): the query arm of the
// dataset descriptor. A configured query that was never fetched has `snapshot: null` and no `updated`; a fetched one
// names its snapshot and keeps `updated`; a file descriptor is unchanged. `snapshotOf` answers null for the unfetched
// arm, so no consumer asks for bytes; `datasetStateAt` adds the render-time stale label beside the stored state.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { newDoc } from '../yjs';
import { QUERY_SCHEDULE_SECONDS, readDataset, setDataset, snapshotOf, type DatasetDescriptor } from './datasets';
import { DATASET_STATES, datasetStateAt, sourceLabel } from './states';

const AT = Date.UTC(2026, 9, 17, 9, 0);
const session = { kind: 'session', appSessionId: 'app-q' as AppSessionId } as const;

const unfetched = (over: Partial<Extract<DatasetDescriptor['source'], { kind: 'query' }>> = {}): DatasetDescriptor => ({
  title: 'Live sales',
  source: { kind: 'query', server: 'fixture', tool: 'rows', args: { region: 'west' }, schedule: 30, staleAfter: 120, snapshot: null, ...over },
  columns: [],
  rows: 0,
  state: { status: 'ok', at: AT },
});
const fetched = (at = AT): DatasetDescriptor => ({
  ...unfetched({ snapshot: { ref: 'assets/query-1.json', at } }),
  columns: [{ name: 'v', type: 'number' }],
  rows: 3,
  updated: { at, by: { kind: 'human' } },
});

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
    expect(() => setDataset(doc, 'a', { ...unfetched(), updated: { at: AT, by: { kind: 'human' } } })).toThrow();
    const noUpdated: DatasetDescriptor = { ...fetched() };
    delete noUpdated.updated;
    expect(() => setDataset(doc, 'b', noUpdated)).toThrow();
    const file: DatasetDescriptor = {
      title: 'Sales',
      source: { kind: 'file', ref: 'assets/s.csv', name: 's.csv', format: 'csv', sha256: 'a'.repeat(64), size: 3 },
      columns: [],
      rows: 0,
      updated: { at: AT, by: session },
      state: { status: 'ok', at: AT },
    };
    setDataset(doc, 'c', file);
    const fileWithout: DatasetDescriptor = { ...file };
    delete fileWithout.updated;
    expect(() => setDataset(doc, 'd', fileWithout)).toThrow();
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
    const manual = { ...(unfetched().source as Extract<DatasetDescriptor['source'], { kind: 'query' }>) };
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
    const never = { ...(d.source as Extract<DatasetDescriptor['source'], { kind: 'query' }>) };
    delete never.staleAfter;
    expect(datasetStateAt({ ...d, source: never }, AT + 10_000_000)).toEqual({ state: d.state, notFetched: false });
    const file: DatasetDescriptor = { ...d, source: { kind: 'file', ref: 'assets/s.csv', name: 's.csv', format: 'csv', sha256: 'a'.repeat(64), size: 3 } };
    expect(datasetStateAt(file, AT + 10_000_000)).toEqual({ state: d.state, notFetched: false });
    expect(DATASET_STATES.staleSince(AT + 120_000)).toBe('stale since 2026-10-17 09:02 UTC');
  });
});
