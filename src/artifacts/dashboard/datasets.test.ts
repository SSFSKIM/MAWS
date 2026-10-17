// The dashboard's datasets root (P3-E2 M2; XE5): one descriptor per dataset id in the dashboard's one Y.Doc.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { applyV1, diffV1, newDoc } from '../yjs';
import { DATASET_LIMITS, DATASETS_ROOT, datasetIdFromSource, datasetIdProblem, listDatasets, readDataset, removeDataset, setDataset, type FileDatasetDescriptor } from './datasets'; // E3: the file arm

const descriptor = (over: Partial<FileDatasetDescriptor> = {}): FileDatasetDescriptor => ({ // E3: the file arm of the descriptor union
  title: 'Sales',
  source: { kind: 'file', ref: 'assets/sales.csv', name: 'sales.csv', format: 'csv', sha256: 'a'.repeat(64), size: 42 },
  columns: [
    { name: 'region', type: 'string' },
    { name: 'sales', type: 'number', mismatches: 1 },
  ],
  rows: 2,
  updated: { at: 1_760_000_000_000, by: { kind: 'session', appSessionId: 'app-1' as AppSessionId } },
  state: { status: 'ok', at: 1_760_000_000_000 },
  ...over,
});

describe('datasets', () => {
  it('writes, reads, lists and removes descriptors under the datasets root, and they converge on a replica', () => {
    const doc = newDoc();
    setDataset(doc, 'sales', descriptor());
    setDataset(doc, 'costs', descriptor({ title: 'Costs', rowKey: 'region' }));
    expect(readDataset(doc, 'sales')).toEqual(descriptor());
    expect(listDatasets(doc).map(({ id }) => id)).toEqual(['costs', 'sales']);
    const other = newDoc();
    applyV1(other, diffV1(doc));
    expect(readDataset(other, 'costs')).toEqual(descriptor({ title: 'Costs', rowKey: 'region' }));
    removeDataset(doc, 'sales');
    expect(readDataset(doc, 'sales')).toBeNull();
    expect(listDatasets(doc).map(({ id }) => id)).toEqual(['costs']);
  });

  it('reads a malformed or foreign value as no descriptor, never throwing', () => {
    const doc = newDoc();
    const root = doc.get(DATASETS_ROOT);
    root.setAttr('junk', { title: 3 });
    root.setAttr('text', 'nope');
    expect(readDataset(doc, 'junk')).toBeNull();
    expect(readDataset(doc, 'text')).toBeNull();
    expect(readDataset(doc, 'absent')).toBeNull();
    expect(readDataset(doc, '__proto__')).toBeNull();
    expect(listDatasets(doc)).toEqual([]);
  });

  it('reads a chart block\'s source as the dataset id it names: a string trimmed of its padding, anything else empty', () => {
    expect(datasetIdFromSource('sales')).toBe('sales');
    expect(datasetIdFromSource('  sales\n')).toBe('sales');
    expect(datasetIdFromSource('\n\nsales\n\n')).toBe('sales');
    expect(datasetIdFromSource('   ')).toBe('');
    for (const other of [undefined, null, 7, true, ['sales'], { id: 'sales' }]) expect(datasetIdFromSource(other)).toBe('');
  });

  it('takes ids of 1 to 64 letters, digits, _ and -, never a prototype key', () => {
    expect(datasetIdProblem('sales_2026-q1')).toBeNull();
    for (const id of ['', 'a'.repeat(65), 'a b', 'ü', 'a/b']) expect(datasetIdProblem(id), id).not.toBeNull();
    expect(datasetIdProblem('__proto__')).toBe('"__proto__" is reserved');
    expect(() => setDataset(newDoc(), 'a b', descriptor())).toThrow(/dataset id/);
  });

  it('holds at most the limit of datasets; replacing one at the limit is still possible', () => {
    const doc = newDoc();
    for (let i = 0; i < DATASET_LIMITS.datasets; i++) setDataset(doc, `d${i}`, descriptor());
    expect(() => setDataset(doc, 'one-more', descriptor())).toThrow(`a dashboard holds at most ${DATASET_LIMITS.datasets} datasets`);
    setDataset(doc, 'd0', descriptor({ title: 'Replaced' }));
    expect(readDataset(doc, 'd0')?.title).toBe('Replaced');
  });
});
