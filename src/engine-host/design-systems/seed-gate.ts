// Startup owns one bounded, failure-open readiness promise. The actual seed may finish after admission times out;
// both outcomes share one warning, never one per request or a second warning on a late failure.
const SEED_WAIT_MS = 8_000; // under the bridge's 10 s IPC timeout

export function seedReadiness(seed: Promise<unknown>, log: (line: string) => void): { seeded: Promise<void>; ready: Promise<void> } {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  let opened = false;
  const open = (warning?: string) => {
    if (opened) return;
    opened = true;
    clearTimeout(timer);
    if (warning) log(warning);
    release();
  };
  const timer = setTimeout(() => open(`seeding the built-in design systems timed out after ${SEED_WAIT_MS} ms; continuing with the current store`), SEED_WAIT_MS);
  const seeded = seed.then(
    () => open(),
    (error: unknown) => open(`seeding the built-in design systems failed: ${error instanceof Error ? error.message : String(error)}`),
  );
  return { seeded, ready };
}
