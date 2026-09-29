import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelCatalogueSchema } from '@shared/sessions/models';
import { loadJournal } from '../../test/support/fixtures';
import { BUILTIN_MODELS, ModelsCache, modelsKey } from './models-cache';

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-models-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

const file = () => join(userData, 'engine-host', 'models.json');
const readsModels = () => (loadJournal('pass1', 'reads').find((r) => r.seq === 3)!.frame as { response: { response: { models: unknown[] } } }).response.response.models;
// a Direct launch's initialize (pass2/auto-unrouted seq 4): no relay aliases, the engine's own fable id
const directModels = () => (loadJournal('pass2', 'auto-unrouted').find((r) => r.seq === 4)!.frame as { response: { response: { models: unknown[] } } }).response.response.models;
const RELAY = modelsKey('2.1.283', 'gateway');
const DIRECT = modelsKey('2.1.283', 'direct');

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

  it('keeps each catalogue under its key temp-then-rename and answers it as cached, across a restart', async () => {
    const cache = new ModelsCache(userData, { now: () => '2026-09-29T10:00:00.000Z' });
    await cache.load();
    await cache.update(RELAY, readsModels());
    expect(cache.answer(RELAY)).toMatchObject({ source: 'cached', at: '2026-09-29T10:00:00.000Z' });
    expect(cache.answer(RELAY).models.map((m) => m.value)).toContain('claude/astra');
    const onDisk = JSON.parse(await readFile(file(), 'utf8')) as { entries: Record<string, { at: string; models: { value: string }[] }> };
    expect(Object.keys(onDisk.entries)).toEqual([RELAY]);
    expect(onDisk.entries[RELAY]!.at).toBe('2026-09-29T10:00:00.000Z');
    expect(onDisk.entries[RELAY]!.models).toHaveLength(12);
    const again = new ModelsCache(userData);
    await again.load();
    expect(again.answer(RELAY)).toEqual(cache.answer(RELAY));
  });

  it('a Direct launch and a relay launch keep their own lists; a key never seen answers the built-in list, no key the newest', async () => {
    let clock = 0;
    const cache = new ModelsCache(userData, { now: () => `2026-09-29T10:00:0${clock++}.000Z` });
    await cache.load();
    expect(cache.answer(DIRECT).source).toBe('builtin');
    await cache.update(RELAY, readsModels());
    expect(cache.answer(DIRECT)).toEqual({ source: 'builtin', at: null, models: BUILTIN_MODELS }); // the relay's aliases never answer for Direct
    await cache.update(DIRECT, directModels());
    const values = (key?: string) => cache.answer(key).models.map((m) => m.value);
    expect(values(RELAY)).toContain('claude/astra');
    expect(values(DIRECT)).toEqual(['default', 'opus', 'claude-fable-5-1[1m]', 'sonnet', 'haiku']);
    expect(values()).toEqual(values(DIRECT)); // the most recently updated
    await cache.update(RELAY, readsModels());
    expect(values()).toEqual(values(RELAY));
    expect(cache.answer(modelsKey('2.1.284', 'gateway')).source).toBe('builtin'); // another binary's catalogue is another key
    const again = new ModelsCache(userData);
    await again.load();
    expect(again.answer(DIRECT)).toEqual(cache.answer(DIRECT));
    expect(again.answer()).toEqual(cache.answer(RELAY));
  });

  it('drops entries that are not catalogue entries and ignores an empty list', async () => {
    const cache = new ModelsCache(userData);
    await cache.load();
    await cache.update(RELAY, [{ value: 'sonnet', displayName: 'Sonnet 5' }, { value: 'broken' }, 'nonsense']);
    expect(cache.answer(RELAY).models).toEqual([{ value: 'sonnet', displayName: 'Sonnet 5' }]);
    await cache.update(RELAY, []);
    expect(cache.answer(RELAY).models).toEqual([{ value: 'sonnet', displayName: 'Sonnet 5' }]);
  });

  it('answers the built-in list over an unreadable cache file, with a warning', async () => {
    await mkdir(join(userData, 'engine-host'), { recursive: true });
    for (const text of ['{"at":', '{"at":"2026-09-29T10:00:00.000Z","models":[]}' /* the unkeyed file before debt wave 3 */]) {
      await writeFile(file(), text);
      const warnings: string[] = [];
      const cache = new ModelsCache(userData, { warn: (m) => warnings.push(m) });
      await cache.load();
      expect(cache.answer().source).toBe('builtin');
      expect(warnings).toHaveLength(1);
    }
  });
});
