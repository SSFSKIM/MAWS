import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelCatalogueSchema } from '@shared/sessions/models';
import { loadJournal } from '../../test/support/fixtures';
import { BUILTIN_MODELS, ModelsCache } from './models-cache';

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-models-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

const file = () => join(userData, 'engine-host', 'models.json');
const readsModels = () => (loadJournal('pass1', 'reads').find((r) => r.seq === 3)!.frame as { response: { response: { models: unknown[] } } }).response.response.models;

describe('models catalogue cache', () => {
  it('answers the built-in list before any catalogue was seen: the five entries of reads.jsonl, no relay alias', async () => {
    const cache = new ModelsCache(userData);
    await cache.load();
    const answer = cache.answer();
    expect(ModelCatalogueSchema.parse(answer)).toEqual(answer);
    expect(answer).toEqual({ source: 'builtin', at: null, models: BUILTIN_MODELS });
    expect(BUILTIN_MODELS.map((m) => m.value)).toEqual(['default', 'opus', 'fable', 'sonnet', 'haiku']);
    expect(BUILTIN_MODELS.filter((m) => m.supportsAutoMode === false).map((m) => m.value)).toEqual(['haiku']);
    const recorded = readsModels() as { value: string; displayName: string }[];
    for (const entry of BUILTIN_MODELS) expect(recorded.find((m) => m.value === entry.value)?.displayName).toBe(entry.displayName);
  });

  it('keeps the latest catalogue temp-then-rename and answers it as cached, across a restart', async () => {
    const cache = new ModelsCache(userData, { now: () => '2026-09-29T10:00:00.000Z' });
    await cache.load();
    await cache.update(readsModels());
    expect(cache.answer()).toMatchObject({ source: 'cached', at: '2026-09-29T10:00:00.000Z' });
    expect(cache.answer().models.map((m) => m.value)).toContain('claude/astra');
    const onDisk = JSON.parse(await readFile(file(), 'utf8')) as { at: string; models: { value: string }[] };
    expect(onDisk.at).toBe('2026-09-29T10:00:00.000Z');
    expect(onDisk.models).toHaveLength(12);
    const again = new ModelsCache(userData);
    await again.load();
    expect(again.answer()).toEqual(cache.answer());
  });

  it('drops entries that are not catalogue entries and ignores an empty list', async () => {
    const cache = new ModelsCache(userData);
    await cache.load();
    await cache.update([{ value: 'sonnet', displayName: 'Sonnet 5' }, { value: 'broken' }, 'nonsense']);
    expect(cache.answer().models).toEqual([{ value: 'sonnet', displayName: 'Sonnet 5' }]);
    await cache.update([]);
    expect(cache.answer().models).toEqual([{ value: 'sonnet', displayName: 'Sonnet 5' }]);
  });

  it('answers the built-in list over an unreadable cache file, with a warning', async () => {
    await mkdir(join(userData, 'engine-host'), { recursive: true });
    await writeFile(file(), '{"at":');
    const warnings: string[] = [];
    const cache = new ModelsCache(userData, { warn: (m) => warnings.push(m) });
    await cache.load();
    expect(cache.answer().source).toBe('builtin');
    expect(warnings).toHaveLength(1);
  });
});
