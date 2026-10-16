// P3-E2 M2 (ledger X23 as amended by parent Decision Log 8; XE5): the bounded read of a dataset snapshot by immutable
// ref and the format its descriptor names. Ownership is checked on every call, cache hits included; a page is bounded by
// rows and by encoded bytes and the caller continues at the rows actually returned; the parse cache is bounded, keyed by
// content and format, and rebuilt cold after a restart.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATASET_READ_MAX_BYTES, DATASET_READ_MAX_ROWS } from '@artifacts/dashboard/datasets';
import type { Actor } from '@shared/artifacts/actor';
import { ArtifactStoreError } from '../documents/errors';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { DatasetReader } from './read';

const human: Actor = { kind: 'human' };
const bytes = (text: string) => new TextEncoder().encode(text);

let dir: string;
let world: { storage: SqliteDocumentStorage; service: DocumentService; store: ArtifactStore };
const open = () => {
  const storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  const service = new DocumentService(storage, { log: () => {}, kindOf: (id) => storage.kindOf(id) });
  return { storage, service, store: new ArtifactStore(service, storage, { root: dir, log: () => {} }) };
};
const close = () => {
  world.store.close();
  world.service.close();
  world.storage.close();
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-dataset-read-'));
  world = open();
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

const board = async () => (await world.store.create({ kind: 'dashboard', title: 'Board' }, human)).id;
const upload = (artifactId: string, text: string, name = 'data.csv') => world.store.uploadAsset(artifactId, bytes(text), { name, mime: 'text/csv' }, human);
const refusal = (run: () => unknown): ArtifactStoreError => {
  try {
    run();
  } catch (error) {
    if (error instanceof ArtifactStoreError) return error;
    throw error;
  }
  throw new Error('read');
};

describe('DatasetReader', () => {
  it('answers a page of the parsed snapshot with its columns and total', async () => {
    const id = await board();
    const { ref } = await upload(id, 'region,sales\nSeoul,120\nBusan,98\nJeju,40\n');
    const reader = new DatasetReader(world.store);
    expect(reader.read(id, ref, { format: 'csv' })).toEqual({
      columns: [
        { name: 'region', type: 'string' },
        { name: 'sales', type: 'number' },
      ],
      rows: [
        ['Seoul', 120],
        ['Busan', 98],
        ['Jeju', 40],
      ],
      total: 3,
      truncated: false,
    });
    expect(reader.read(id, ref, { format: 'csv', offset: 1, limit: 1 })).toMatchObject({ rows: [['Busan', 98]], total: 3, truncated: true });
    expect(reader.read(id, ref, { format: 'csv', offset: 3 })).toMatchObject({ rows: [], total: 3, truncated: false });
  });

  it('reads one byte sequence as the format asked, after a restart with a cold cache too', async () => {
    const id = await board();
    const { ref } = await upload(id, 'a,b\tc\n1,2\t3\n');
    const names = (reader: DatasetReader, format: 'csv' | 'tsv') => reader.read(id, ref, { format }).columns.map((c) => c.name);
    expect(names(new DatasetReader(world.store), 'csv')).toEqual(['a', 'b\tc']);
    expect(names(new DatasetReader(world.store), 'tsv')).toEqual(['a,b', 'c']);
    close();
    world = open();
    const cold = new DatasetReader(world.store);
    expect(names(cold, 'tsv')).toEqual(['a,b', 'c']);
    expect(names(cold, 'csv')).toEqual(['a', 'b\tc']);
  });

  it('checks the artifact and the ref on every call, cache hits included', async () => {
    const a = await board();
    const b = await board();
    const { ref } = await upload(a, 'n\n1\n');
    const reader = new DatasetReader(world.store);
    expect(reader.read(a, ref, { format: 'csv' }).total).toBe(1);
    expect(refusal(() => reader.read(b, ref, { format: 'csv' }))).toMatchObject({ code: 'notFound' });
    expect(refusal(() => reader.read(a, 'assets/none.csv', { format: 'csv' }))).toMatchObject({ code: 'notFound' });
    await world.store.delete(a);
    expect(refusal(() => reader.read(a, ref, { format: 'csv' }))).toMatchObject({ code: 'notFound' });
  });

  it('refuses bytes the format does not parse, naming the line, and never caches the refusal as rows', async () => {
    const id = await board();
    const { ref } = await upload(id, 'a,b\n1\n');
    const reader = new DatasetReader(world.store);
    expect(refusal(() => reader.read(id, ref, { format: 'csv' }))).toMatchObject({ code: 'invalid', data: { line: 2 } });
    expect(refusal(() => reader.read(id, ref, { format: 'json' }))).toMatchObject({ code: 'invalid' });
  });

  it('bounds a page by rows and by encoded bytes, the caller continuing at the rows returned', async () => {
    const id = await board();
    const many = `n\n${Array.from({ length: DATASET_READ_MAX_ROWS + 500 }, (_, i) => String(i)).join('\n')}\n`;
    const { ref } = await upload(id, many);
    const reader = new DatasetReader(world.store);
    const first = reader.read(id, ref, { format: 'csv' });
    expect(first.rows).toHaveLength(DATASET_READ_MAX_ROWS);
    expect(first).toMatchObject({ total: DATASET_READ_MAX_ROWS + 500, truncated: true });
    // rows of about 100 KiB each: a page holds what fits in the byte bound, never `limit` rows
    const wide = `t\n${Array.from({ length: 30 }, (_, i) => `${i}${'x'.repeat(100 * 1024)}`).join('\n')}\n`;
    const big = await upload(id, wide, 'wide.csv');
    const page = reader.read(id, big.ref, { format: 'csv', limit: 30 });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.length).toBeLessThan(30);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(DATASET_READ_MAX_BYTES);
    const next = reader.read(id, big.ref, { format: 'csv', offset: page.rows.length, limit: 30 });
    expect(String(next.rows[0]![0]).startsWith(String(page.rows.length))).toBe(true);
  });

  it('refuses a single row larger than a page', async () => {
    const id = await board();
    const { ref } = await upload(id, `t\n${'y'.repeat(DATASET_READ_MAX_BYTES + 10)}\n`);
    expect(refusal(() => new DatasetReader(world.store).read(id, ref, { format: 'csv' }))).toMatchObject({ code: 'tooLarge', data: { row: 0 } });
  });

  it('keeps a bounded cache: the least recently read snapshot leaves first and is parsed again when asked', async () => {
    const id = await board();
    const refs = await Promise.all([0, 1, 2].map((k) => upload(id, `n\n${k}\n`, `d${k}.csv`)));
    const reader = new DatasetReader(world.store, { maxEntries: 2 });
    for (const { ref } of refs) reader.read(id, ref, { format: 'csv' });
    expect(reader.cached()).toHaveLength(2);
    expect(reader.read(id, refs[0]!.ref, { format: 'csv' }).rows).toEqual([[0]]);
    expect(reader.cached()).toHaveLength(2);
  });
});
