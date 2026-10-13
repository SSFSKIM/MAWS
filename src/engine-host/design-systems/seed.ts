// Seeding the built-in systems (D9 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; Decision Log 7,
// "defaults are data"): when the store has never held a design system, deleted ones included, every bundled default is
// created as an ordinary Design System artifact the owner may edit: its entity (the human's), its assets uploaded, then
// its files written through the kind's model with the origin `{route: 'default', key}`. A store that once held a system
// is never seeded again, so an owner who deleted the defaults keeps them deleted, and a fresh store gets them.
//
// One default is three commits (the create, the assets, the write): A's store has no create that writes a document's
// first state in the same savepoint (its `artifact_create {kind, files}` will need one; reported to the architect). A
// host that dies between them leaves a system with no content, which the chain skips (it has no origin key).
import { writeSystem } from '@artifacts/design-system/model';
import { DEFAULT_SYSTEMS, type DefaultSystemSource } from '@artifacts/types/design_system/defaults';
import type { DefaultAsset } from '@artifacts/types/design_system/default-assets';
import type { Actor } from '@shared/artifacts/actor';
import type { DocumentService } from '../documents/service';
import type { ArtifactStore } from '../documents/store';

const HUMAN: Actor = { kind: 'human' }; // the owner's: X29 has no system actor, and the defaults are the owner's to edit

export interface SeedDeps {
  store: ArtifactStore;
  service: DocumentService;
  defaults?: readonly DefaultSystemSource[];
  loadAssets(key: string): Promise<DefaultAsset[]>;
  now?: () => number;
  log(line: string): void;
}

/** Seeds the defaults into a store that never held a design system; the ids it created, in the defaults' order. */
export async function seedDefaults({ store, service, defaults = DEFAULT_SYSTEMS, loadAssets, now = Date.now, log }: SeedDeps): Promise<string[]> {
  if (store.storage.readOnly) return [];
  const ever = store.list({ kind: 'design_system' }).length + store.list({ kind: 'design_system', deleted: true }).length;
  if (ever > 0) return [];
  const created: string[] = [];
  for (const source of defaults) {
    const { id } = await store.create({ kind: 'design_system', title: source.name }, HUMAN);
    created.push(id);
    for (const asset of await loadAssets(source.key)) await store.uploadAsset(id, asset.bytes, { name: asset.name, mime: asset.mime }, HUMAN);
    await service.writeAs(id, HUMAN, (doc) => void writeSystem(doc, source.files, { route: 'default', key: source.key, at: now() }, { name: source.name }));
  }
  log(`seeded the built-in design systems: ${defaults.map((source) => source.key).join(', ')}`);
  return created;
}
