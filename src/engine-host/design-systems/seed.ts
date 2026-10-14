// Seeding the built-in systems (D9 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; Decision Log 7,
// "defaults are data"): when the store has never held a design system, deleted ones included, every bundled default is
// created as an ordinary Design System artifact the owner may edit, with the origin `{route: 'default', key}`. A store
// that once held a system is never seeded again, so an owner who deleted the defaults keeps them deleted, and a fresh
// store gets them.
//
// Each default is one transaction: A's create with `initial` (A's Decision Log 40) writes the entity, the system's files
// and its origin in one savepoint, so no host death leaves an empty system. The assets follow in their own commits (A's
// upload needs the live entity), so the store's meta keeps a seeding record, written in the same savepoints: the
// defaults still to create, and the systems whose bundled assets are not all uploaded yet. The next start goes on from
// it, so a seeding cut short between defaults finishes, and an asset upload that failed is logged and retried. A store
// with no record that holds a system was seeded before the record existed, or made by the owner: it is left alone.
import { writeSystem } from '@artifacts/design-system/model';
import { DEFAULT_SYSTEMS, type DefaultSystemSource } from '@artifacts/types/design_system/defaults';
import type { DefaultAsset } from '@artifacts/types/design_system/default-assets';
import type { Actor } from '@shared/artifacts/actor';
import type { DocumentService } from '../documents/service';
import type { ArtifactStore } from '../documents/store';

const HUMAN: Actor = { kind: 'human' }; // the owner's: X29 has no system actor, and the defaults are the owner's to edit

/** The store meta key of the seeding record. */
export const SEEDING_KEY = 'designSystems.seeding';
/** What seeding has left to do: the default keys not yet created, and the seeded systems still owed their assets. */
interface SeedingRecord {
  keys: string[];
  assets: { id: string; key: string }[];
}

export interface SeedDeps {
  store: ArtifactStore;
  service: DocumentService;
  defaults?: readonly DefaultSystemSource[];
  loadAssets(key: string): Promise<DefaultAsset[]>;
  now?: () => number;
  log(line: string): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function readRecord(store: ArtifactStore): SeedingRecord | null {
  const raw = store.storage.getMeta(SEEDING_KEY);
  return raw === null ? null : (JSON.parse(raw) as SeedingRecord);
}
/** Inside a savepoint: the record as `change` leaves it, so it commits with the write it describes. */
function updateRecord(store: ArtifactStore, change: (record: SeedingRecord) => SeedingRecord): void {
  store.storage.setMeta(SEEDING_KEY, JSON.stringify(change(readRecord(store) ?? { keys: [], assets: [] })));
}

/**
 * Seeds the defaults into a store that never held a design system, or goes on with a seeding a host death cut short,
 * then uploads the assets still owed. Answers the ids it created, in the defaults' order. A create that fails rejects
 * (its default stays in the record for the next start); an asset upload that fails is logged and retried at the next.
 */
export async function seedDefaults({ store, service, defaults = DEFAULT_SYSTEMS, loadAssets, now = Date.now, log }: SeedDeps): Promise<string[]> {
  if (store.storage.readOnly) return [];
  let pending = readRecord(store)?.keys;
  if (pending === undefined) {
    const ever = store.list({ kind: 'design_system' }).length + store.list({ kind: 'design_system', deleted: true }).length;
    if (ever > 0) return [];
    const fresh: SeedingRecord = { keys: defaults.map((source) => source.key), assets: [] };
    await service.inBatch(() => updateRecord(store, () => fresh));
    pending = fresh.keys;
  }
  const created: string[] = [];
  for (const key of pending) {
    const source = defaults.find((candidate) => candidate.key === key);
    if (!source) {
      await service.inBatch(() => updateRecord(store, (r) => ({ ...r, keys: r.keys.filter((k) => k !== key) }))); // no longer bundled
      continue;
    }
    const system = await store.create(
      { kind: 'design_system', title: source.name, initial: (doc) => void writeSystem(doc, source.files, { route: 'default', key, at: now() }, { name: source.name }) },
      HUMAN,
      (artifact) => updateRecord(store, (r) => ({ keys: r.keys.filter((k) => k !== key), assets: [...r.assets, { id: artifact.id, key }] })),
    );
    created.push(system.id);
  }
  if (created.length > 0) log(`seeded the built-in design systems: ${pending.filter((key) => defaults.some((source) => source.key === key)).join(', ')}`);
  await uploadOwedAssets(store, service, loadAssets, log);
  return created;
}

/** Each seeded system still owed its assets gets the bundled ones it lacks (by name); a deleted one is dropped. */
async function uploadOwedAssets(store: ArtifactStore, service: DocumentService, loadAssets: SeedDeps['loadAssets'], log: SeedDeps['log']): Promise<void> {
  for (const { id, key } of readRecord(store)?.assets ?? []) {
    if (store.get(id)?.kind === 'design_system') {
      try {
        const held = new Set(store.listAssets(id).map((asset) => asset.name));
        for (const asset of await loadAssets(key)) if (!held.has(asset.name)) await store.uploadAsset(id, asset.bytes, { name: asset.name, mime: asset.mime }, HUMAN);
      } catch (error) {
        log(`the built-in system ${key}'s assets could not all be uploaded (${message(error)}); retried at the next start`);
        continue;
      }
    }
    await service.inBatch(() => updateRecord(store, (r) => ({ ...r, assets: r.assets.filter((owed) => owed.id !== id) })));
  }
}
