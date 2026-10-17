// P3-E2 M2 (ledger X23 as amended by parent Decision Log 8; XE5): the bounded read of a dataset snapshot by immutable
// ref and the format its descriptor names. Ownership is checked on every call, cache hits included; a page is bounded by
// rows and by encoded bytes and the caller continues at the rows actually returned; the parse cache is bounded, keyed by
// content and format, and rebuilt cold after a restart.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATASET_READ_MAX_BYTES, DATASET_READ_MAX_ROWS } from '@artifacts/dashboard/datasets';
import { BENCH_ROWS, benchCsv } from '@artifacts/dashboard/fixtures/bench';
import { parseDataset, type ParsedDataset } from '@artifacts/dashboard/parse';
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

  it('refuses a JSON snapshot holding a number too large to read, rather than answer rows no JSON page carries (fix wave I3)', async () => {
    const id = await board();
    const { ref } = await upload(id, '[{"v": -1e400}]', 'inf.json');
    expect(refusal(() => new DatasetReader(world.store).read(id, ref, { format: 'json' }))).toMatchObject({ code: 'invalid', data: { line: 1 } });
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

  it('never answers a page past the byte bound, an exactly filled last page included (E2 M6: the page is sized as it serialises)', async () => {
    const id = await board();
    // a short row, then one whose cell makes the last page's JSON exactly fill the bound when it is counted as `truncated:
    // true`: the page answers `truncated: false`, one byte longer
    const empty = Buffer.byteLength(JSON.stringify({ columns: [{ name: 't', type: 'string' }], rows: [], total: 2, truncated: true }));
    const fill = DATASET_READ_MAX_BYTES - empty - '["a"],'.length - '[""]'.length;
    for (const width of [fill - 1, fill, fill + 1]) {
      const { ref } = await upload(id, `t\na\n${'x'.repeat(width)}\n`, `fill-${width}.csv`);
      const reader = new DatasetReader(world.store);
      const page = reader.read(id, ref, { format: 'csv' });
      expect(Buffer.byteLength(JSON.stringify(page)), `width ${width}`).toBeLessThanOrEqual(DATASET_READ_MAX_BYTES);
      const rest = reader.read(id, ref, { format: 'csv', offset: page.rows.length });
      expect(page.rows.length + rest.rows.length, `width ${width}: every row reached`).toBe(2);
      expect(Buffer.byteLength(JSON.stringify(rest)), `width ${width}`).toBeLessThanOrEqual(DATASET_READ_MAX_BYTES);
    }
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

  // E2 M6 (panel P2 scalpel-4#2, E's Decision Log 40): a sparse JSON file of a few kilobytes expands to rows x columns
  // cells; the cache charges what it holds, the expanded table, never the source's size.
  const sparse = (rows: number, keys: number, salt = 0) => JSON.stringify(Array.from({ length: rows }, (_, r) => ({ [`k${(r + salt) % keys}`]: r })));

  it('charges a cached snapshot its expanded cells, so a sparse JSON file is held at no less than its cell slots', async () => {
    const id = await board();
    const text = sparse(2_000, 256);
    expect(text.length).toBeLessThan(40_000);
    const slots = 2_000 * 256 * 8;
    const { ref } = await world.store.uploadAsset(id, bytes(text), { name: 'sparse.json', mime: 'application/json' }, human);
    const tight = new DatasetReader(world.store, { maxBytes: slots - 1 });
    expect(tight.read(id, ref, { format: 'json', limit: 10 }).total).toBe(2_000);
    expect(tight.cached()).toEqual([]);
    const roomy = new DatasetReader(world.store, { maxBytes: slots * 2 });
    roomy.read(id, ref, { format: 'json', limit: 10 });
    expect(roomy.cached()).toHaveLength(1);
  });

  it('never retains a snapshot larger than the whole cache, answering its pages and keeping the snapshots already held', async () => {
    const id = await board();
    const small = await upload(id, 'n\n1\n2\n');
    const { ref } = await world.store.uploadAsset(id, bytes(sparse(2_000, 256)), { name: 'sparse.json', mime: 'application/json' }, human);
    const reader = new DatasetReader(world.store, { maxBytes: 1024 * 1024 });
    reader.read(id, small.ref, { format: 'csv' });
    const first = reader.read(id, ref, { format: 'json', limit: 3 });
    expect(first).toMatchObject({ rows: [[0, ...Array(255).fill(null)], [null, 1, ...Array(254).fill(null)], [null, null, 2, ...Array(253).fill(null)]], total: 2_000, truncated: true });
    expect(reader.read(id, ref, { format: 'json', offset: 1_999, limit: 3 }).rows).toEqual([[...Array(207).fill(null), 1_999, ...Array(48).fill(null)]]);
    expect(reader.cached()).toEqual([`${world.store.listAssets(id).find((asset) => asset.ref === small.ref)!.sha256}:csv`]);
  });

  it('holds sparse snapshots under the default cap by their expanded size: two of 16,000 x 256 cells never stay together', async () => {
    const id = await board();
    const refs = await Promise.all([0, 1].map((salt) => world.store.uploadAsset(id, bytes(sparse(16_000, 256, salt)), { name: `s${salt}.json`, mime: 'application/json' }, human)));
    const reader = new DatasetReader(world.store);
    for (const { ref } of refs) expect(reader.read(id, ref, { format: 'json', limit: 1 }).total).toBe(16_000);
    expect(reader.cached()).toHaveLength(1);
  });

  // E2 M6 (the retained review's residual, E's Decision Log 41): the charge covers the whole entry, its columns (names,
  // types) and warnings as well as its rows, each string as the rows' strings are (two bytes a character at least)
  const textOf = (parsed: ParsedDataset) => [...parsed.columns.flatMap((column) => [column.name, column.type]), ...parsed.warnings].reduce((n, text) => n + 2 * text.length, 0);
  const retained = async (text: string, maxBytes: number) => {
    const id = await board();
    const { ref } = await upload(id, text, 'wide.csv');
    const reader = new DatasetReader(world.store, { maxBytes });
    reader.read(id, ref, { format: 'csv', limit: 1 });
    return reader.cached().length === 1;
  };

  it('charges a header-heavy table its column names and types, not only its rows: 256 long names and no row', async () => {
    const names = Array.from({ length: 256 }, (_, k) => `${'n'.repeat(250)}${k}`);
    const text = `${names.join(',')}\n`;
    const parsed = parseDataset(bytes(text), 'csv') as ParsedDataset;
    expect(parsed.rows).toHaveLength(0);
    const floor = bytes(text).length + textOf(parsed);
    expect(await retained(text, floor - 1)).toBe(false);
    expect(await retained(text, floor * 4)).toBe(true);
  });

  it('charges a warning-heavy table its warnings: a mismatch in each of 256 long-named columns', async () => {
    const names = Array.from({ length: 256 }, (_, k) => `${'w'.repeat(200)}${k}`);
    const text = [names.join(','), names.map(() => '1').join(','), names.map(() => '2').join(','), names.map(() => 'x').join(',')].join('\n');
    const parsed = parseDataset(bytes(text), 'csv') as ParsedDataset;
    expect(parsed.warnings).toHaveLength(256);
    const floor = bytes(text).length + textOf(parsed);
    expect(await retained(text, floor - 1)).toBe(false);
    expect(await retained(text, floor * 4)).toBe(true);
  });

  it('keeps the scale bench\'s ledger and its replacement together under the default cap, each parsed once for every page', async () => {
    const id = await board();
    const refs = await Promise.all([0, 1].map((variant) => upload(id, benchCsv(BENCH_ROWS, variant), `ledger${variant}.csv`)));
    const reader = new DatasetReader(world.store);
    for (const { ref } of refs) expect(reader.read(id, ref, { format: 'csv', limit: 1 }).total).toBe(BENCH_ROWS);
    expect(reader.cached()).toHaveLength(2);
  });
});
