// The start import's gate (the P3-L document, M6b fix wave 1; Decision Log 39a): the X12 import a host start runs over
// the store (`./index.ts`) holds the store's gate until it ends, so an artifact tool call or a library read taken
// meanwhile finds the deliverables made before P3 as artifacts. The gate opens however the import ends: a failed import
// is logged where it runs and must not wedge the tools. A store no import holds is open.
import type { ArtifactStore } from '../documents/store';

const gates = new WeakMap<ArtifactStore, Promise<void>>();

export function holdForImport(store: ArtifactStore, imported: Promise<unknown>): void {
  gates.set(
    store,
    imported.then(
      () => undefined,
      () => undefined,
    ),
  );
}

export const importSettled = (store: ArtifactStore): Promise<void> => gates.get(store) ?? Promise.resolve();

// The gate, waited on for at most `ms`: a read main asks under its bridge's request timeout answers from the store as it
// is once the bound passes, and the import's own change events bring the rest.
export async function importSettledWithin(store: ArtifactStore, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([importSettled(store), new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  } finally {
    clearTimeout(timer);
  }
}
