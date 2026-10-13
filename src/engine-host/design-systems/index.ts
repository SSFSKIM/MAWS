// The engine host's design-system module (P3-D M6; docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D9, D10;
// Decision Log 3, 4, 7, 18): registers the `design_system` kind's adapter with A's document service (its file view and
// its publish), its linked-directory mirror writer with L's registry, and the context `artifact_create` attaches (A's
// `registerDesignSystemContext`); seeds the built-in systems into a store that never held one; and resolves the default
// chain for the agent's routes (`chain.governing`). Wired by one line beside P3-A's and P3-L's in `src/engine-host/index.ts`.
import { designSystemMirrorWriter } from '@artifacts/design-system/mirror';
import { createDesignSystemAdapter } from '@artifacts/design-system/model';
import { registerMirrorWriter } from '@artifacts/library/mirror';
import { loadDefaultAssets } from '@artifacts/types/design_system/default-assets';
import type { Documents } from '../documents';
import { DesignSystemChain } from './chain';
import { designSystemContext } from './context';
import { seedDefaults, type SeedDeps } from './seed';

export interface DesignSystems {
  /** The default chain over the store, for the agent's create and describe; null while the store is unavailable. */
  readonly chain: DesignSystemChain | null;
  /** Settles once seeding has run (or was not needed); never rejects (a failure is logged). */
  readonly seeded: Promise<void>;
  close(): void;
}

export interface DesignSystemsDeps {
  documents: Documents | null;
  log?: (line: string) => void;
  loadAssets?: SeedDeps['loadAssets'];
}

export function registerDesignSystems({ documents, log = (line) => console.error(`[design-systems] ${line}`), loadAssets = loadDefaultAssets }: DesignSystemsDeps): DesignSystems {
  const unregisterMirror = registerMirrorWriter('design_system', designSystemMirrorWriter);
  if (!documents) return { chain: null, seeded: Promise.resolve(), close: unregisterMirror };
  const { store, service } = documents;
  // The host has no DOM parser, so a publish checks canon by its paths and limits, not its structure (the page checks
  // structure with the renderer's DOMParser).
  store.registerAdapter(createDesignSystemAdapter());
  store.registerDesignSystemContext(async (system) => designSystemContext(service, system));
  const seeded = seedDefaults({ store, service, loadAssets, log }).then(
    () => {},
    (error: unknown) => log(`seeding the built-in design systems failed: ${error instanceof Error ? error.message : String(error)}`),
  );
  return { chain: new DesignSystemChain(store, service), seeded, close: unregisterMirror };
}
