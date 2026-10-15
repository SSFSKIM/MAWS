// Seeding's failure modes over A's real store (P3-D M6b; docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D9,
// Decision Log 26): each default is one transaction (its entity, its files and its origin, A's create with `initial`), so
// no host death leaves an empty system; a seeding cut short between defaults goes on at the next start; an asset upload
// that fails is logged and retried at the next start, and a system deleted meanwhile is dropped from the retry.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSystem } from '@artifacts/design-system/model';
import { DEFAULT_SYSTEMS, type DefaultSystemSource } from '@artifacts/types/design_system/defaults';
import type { DefaultAsset } from '@artifacts/types/design_system/default-assets';
import { applyV2, newDoc } from '@artifacts/yjs';
import { openDocuments, type Documents } from '../documents';
import { seedDefaults, type SeedDeps } from './seed';

const FONT: DefaultAsset = { name: 'face.woff2', mime: 'font/woff2', bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32]) };
const LICENSE: DefaultAsset = { name: 'OFL.txt', mime: 'text/plain', bytes: new TextEncoder().encode('SIL Open Font License') };

let dir: string;
let documents: Documents;
let logs: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-seed-'));
  documents = openDocuments(dir, () => {})!;
  logs = [];
});
afterEach(() => {
  documents.close();
  rmSync(dir, { recursive: true, force: true });
});

// The bundled defaults under test keys, so a case can break one; `broken` keys get a token file that does not validate.
const sources = (broken: string[] = []): DefaultSystemSource[] =>
  DEFAULT_SYSTEMS.map((source) => ({ ...source, files: broken.includes(source.key) ? { ...source.files, 'tokens.tokens.json': '{"color": {"accent": {"$value": "not a colour"}}}' } : source.files }));

function seed(over: Partial<SeedDeps> = {}) {
  return seedDefaults({ store: documents.store, service: documents.service, loadAssets: async (key) => (key === 'official' ? [FONT, LICENSE] : []), log: (line) => logs.push(line), ...over });
}
// A restart: the store and its meta as the last run committed them.
function restart(): void {
  documents.close();
  documents = openDocuments(dir, () => {})!;
}

const ever = () => [...documents.store.list({ kind: 'design_system' }), ...documents.store.list({ kind: 'design_system', deleted: true })];
const originOf = (id: string) => {
  const doc = newDoc();
  applyV2(doc, documents.service.readState(id).state);
  return readSystem(doc).meta?.origin;
};
const originKeyOf = (id: string) => originOf(id)?.key;
const keys = () => ever().map((system) => originKeyOf(system.id)).sort();
const assetNames = (key: string) => documents.store.listAssets(ever().find((system) => originKeyOf(system.id) === key)!.id).map((asset) => asset.name).sort();

describe('one transaction per default', () => {
  it('a default whose first write fails leaves no system at all, never an empty one', async () => {
    const broken = DEFAULT_SYSTEMS[1]!.key;
    await expect(seed({ defaults: sources([broken]) })).rejects.toThrow();
    // the defaults before it are whole; it left no row, live or deleted
    expect(keys()).toEqual(DEFAULT_SYSTEMS.slice(0, 1).map((source) => source.key));
    for (const system of ever()) expect(originOf(system.id)?.route).toBe('default');
  });

  it('a seeding cut short goes on at the next start with the defaults it had not made, and makes none twice', async () => {
    const broken = DEFAULT_SYSTEMS[1]!.key;
    await expect(seed({ defaults: sources([broken]) })).rejects.toThrow();
    restart();
    const created = await seed({ defaults: sources() });
    expect(created).toHaveLength(DEFAULT_SYSTEMS.length - 1);
    expect(keys()).toEqual(DEFAULT_SYSTEMS.map((source) => source.key).sort());
    restart();
    expect(await seed({ defaults: sources() })).toEqual([]);
    expect(ever()).toHaveLength(DEFAULT_SYSTEMS.length);
  });

  it('a finished seeding never runs again, even after the owner deletes every default', async () => {
    await seed();
    for (const system of documents.store.list({ kind: 'design_system' })) await documents.store.delete(system.id);
    restart();
    expect(await seed()).toEqual([]);
    expect(documents.store.list({ kind: 'design_system' })).toEqual([]);
  });
});

describe('the assets, uploaded after the create', () => {
  it('an upload that fails is logged, the system stays whole, and the next start uploads what is missing', async () => {
    await seed({ loadAssets: async (key) => { if (key === 'official') throw new Error('the font file is gone'); return []; } });
    expect(keys()).toEqual(DEFAULT_SYSTEMS.map((source) => source.key).sort()); // every system is there, with its files
    expect(assetNames('official')).toEqual([]);
    expect(logs).toContainEqual(expect.stringMatching(/official.*assets.*the font file is gone.*next start/));
    restart();
    const loadAssets = vi.fn(async (key: string) => (key === 'official' ? [FONT, LICENSE] : []));
    expect(await seed({ loadAssets })).toEqual([]); // nothing is created again
    expect(assetNames('official')).toEqual(['OFL.txt', 'face.woff2']);
    restart();
    loadAssets.mockClear();
    await seed({ loadAssets });
    expect(loadAssets).not.toHaveBeenCalled(); // the retry is done
  });

  it('a retry uploads only the assets still missing', async () => {
    let calls = 0;
    await seed({
      loadAssets: async (key) => {
        if (key !== 'official') return [];
        calls += 1;
        return [FONT, { ...LICENSE, get bytes(): Uint8Array { throw new Error('read failed halfway'); } }];
      },
    });
    expect(calls).toBe(1);
    expect(assetNames('official')).toEqual(['face.woff2']);
    restart();
    await seed();
    expect(assetNames('official')).toEqual(['OFL.txt', 'face.woff2']); // the font was not uploaded twice
  });

  it('a system deleted before its retry is dropped from it', async () => {
    await seed({ loadAssets: async (key) => { if (key === 'official') throw new Error('gone'); return []; } });
    const official = ever().find((system) => originKeyOf(system.id) === 'official')!;
    await documents.store.delete(official.id);
    restart();
    const loadAssets = vi.fn(async () => [FONT]);
    await seed({ loadAssets });
    expect(loadAssets).not.toHaveBeenCalled();
  });
});
