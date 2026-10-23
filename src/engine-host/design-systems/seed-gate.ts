// Only design-system/artifact consumers wait for seeding, never the host or its sessions. One bounded gate per store
// opens on completion, failure or timeout; late callers do not restart the wait. Seeding itself may finish afterward.
import type { ArtifactStore } from '../documents/store';

// Under the bridge's 10 s IPC timeout, leaving time to answer from the current committed store on timeout.
const SEED_WAIT_MS = 8_000;
const gates = new WeakMap<ArtifactStore, Promise<void>>();
const ready = Promise.resolve();

/** Installs the shared bounded wait; returns the actual seed's completion, failure-open and logged once. */
export function holdForSeed(store: ArtifactStore, seeded: Promise<unknown>, log: (line: string) => void): Promise<void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  gates.set(store, gate);
  let opened = false;
  const open = (warning?: string) => {
    if (opened) return;
    opened = true;
    clearTimeout(timer);
    gates.delete(store);
    if (warning) log(warning);
    release();
  };
  const timer = setTimeout(() => open(`seeding the built-in design systems timed out after ${SEED_WAIT_MS} ms; continuing with the current store`), SEED_WAIT_MS);
  return seeded.then(
    () => open(),
    (error: unknown) => open(`seeding the built-in design systems failed: ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** An unheld or already settled store adds no timer or fixed delay. */
export const seedSettled = (store: ArtifactStore): Promise<void> => gates.get(store) ?? ready;
