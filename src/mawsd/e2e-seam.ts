// `daemon.e2eSeam` (M5b fix round 2; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D11): the end-to-end seams
// that live where the spine runs, read from `mawsd`'s own globals on the daemon shape as main's `app.evaluate` reads them
// in process on the embedded one: the scenario's manual clock (src/services/sessions/stub-source.ts) and the library's
// held refreshes (src/services/library/index.ts). Main relays to it under MAWS_E2E=1 (src/main/sessions/daemon-e2e-seams.ts),
// so a spec's seam reads the same on both shapes. Refused unless `mawsd` runs under MAWS_E2E=1.
import type { CommandInput } from '@shared/ipc/schema';

type Seams = { __maws_scenario?: { advanceTo(ms: number): void }; __maws_library?: { holdRefreshes(): Promise<void> } };

export async function runE2eSeam(input: CommandInput<'daemon.e2eSeam'>, env: NodeJS.ProcessEnv): Promise<void> {
  if (env.MAWS_E2E !== '1') throw new Error('daemon.e2eSeam is refused: mawsd does not run under MAWS_E2E=1');
  const seams = globalThis as Seams;
  if (input.seam === 'scenario.advanceTo') {
    if (!seams.__maws_scenario) throw new Error('no scenario clock: mawsd is not in launch mode scenario with MAWS_SCENARIO_CLOCK=manual');
    return seams.__maws_scenario.advanceTo(input.ms);
  }
  if (!seams.__maws_library) throw new Error('no library seam: the spine’s library is not running');
  await seams.__maws_library.holdRefreshes();
}
