// The default chain on the host (D9 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md): which system governs
// an artifact the agent makes or asks about, from the defaults main relays (`artifacts.setDefaults`, persisted in the
// store's meta) and the store's live systems. Own id, then the Space's default, then the owner's, then the house system
// (the earliest-created live system whose origin key is `maws`), else the bundled floor; a deleted or missing id is
// skipped down the chain, never an error. The order is `governingSystem`'s (governing.ts), the renderer's too.
import { governingSystem, type DesignSystemRef } from '@artifacts/design-system/governing';
import { readOrigin } from '@artifacts/design-system/model';
import { HOUSE_KEY } from '@artifacts/types/design_system/defaults';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import type { DocumentService } from '../documents/service';
import type { ArtifactStore } from '../documents/store';

export type GoverningSystem = DesignSystemRef | { builtin: 'maws' };

export class DesignSystemChain {
  constructor(
    private readonly store: ArtifactStore,
    private readonly service: DocumentService,
  ) {}

  /** A live design system's id: not deleted, and of the kind. */
  live(id: string): boolean {
    return this.store.get(id)?.kind === 'design_system';
  }

  /** The house system: the earliest-created live system whose origin key is `maws`; null when none is left. */
  house(): string | null {
    const systems = this.store.list({ kind: 'design_system' }).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return systems.find((system) => this.originKey(system.id) === HOUSE_KEY)?.id ?? null;
  }

  /** The system governing an artifact (or one about to be made) with these fields. */
  governing(target: { designSystemId?: string; spaceId?: string }): GoverningSystem {
    const { owner, spaces } = this.store.defaults();
    const live = (id: string) => this.live(id);
    const before = governingSystem(target, { owner, spaces, house: null }, live);
    return 'builtin' in before ? governingSystem(target, { owner, spaces, house: this.house() }, live) : before; // the house read only when needed
  }

  private originKey(id: string): string | undefined {
    const loaded = this.service.loaded(id);
    if (loaded) return readOrigin(loaded)?.key;
    const doc: Doc = newDoc();
    try {
      applyV2(doc, this.service.readState(id).state);
      return readOrigin(doc)?.key;
    } finally {
      doc.destroy();
    }
  }
}
