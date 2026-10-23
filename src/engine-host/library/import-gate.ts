// The start import's gate (the P3-L document, M6b fix wave 1; Decision Log 39a): the X12 import a host start runs over
// the store (`./index.ts`) holds the store's gate until it ends, so an artifact tool call or a library read taken
// meanwhile finds the deliverables made before P3 as artifacts. The gate opens however the import ends: a failed import
// is logged where it runs and must not wedge the tools. A store no import holds is open.
import type { ArtifactStore } from '../documents/store';

const gates = new WeakMap<ArtifactStore, { settled: Promise<void>; startedAt: number }>();

export function holdForImport(store: ArtifactStore, imported: Promise<unknown>): void {
  gates.set(store, {
    startedAt: Date.now(),
    settled: imported.then(
      () => undefined,
      () => undefined,
    ),
  });
}

export const importSettled = (store: ArtifactStore): Promise<void> => gates.get(store)?.settled ?? Promise.resolve();

// Readiness budget starts with the import, not each request: startup seed admission must not stack another full wait
// ahead of this one. Past the shared deadline a read answers current state; import change events bring the rest.
export async function importSettledWithin(store: ArtifactStore, ms: number): Promise<void> {
  const gate = gates.get(store);
  if (!gate) return;
  const remaining = ms - (Date.now() - gate.startedAt);
  if (remaining <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([gate.settled, new Promise<void>((resolve) => (timer = setTimeout(resolve, remaining)))]);
  } finally {
    clearTimeout(timer);
  }
}
