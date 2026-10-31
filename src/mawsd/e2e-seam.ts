// `daemon.e2eSeam` (M5b fix round 2; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D11): the end-to-end seams
// that live where the spine runs, read from `mawsd`'s own globals on the daemon shape as main's `app.evaluate` reads them
// in process on the embedded one: the scenario's manual clock (src/services/sessions/stub-source.ts) and the library's
// held refreshes (src/services/library/index.ts). Main relays to it under MAWS_E2E=1 (src/main/sessions/daemon-e2e-seams.ts),
// so a spec's seam reads the same on both shapes. Refused unless `mawsd` was started under MAWS_E2E=1: `allowed` is
// mawsd's own reading of its environment at its start (daemon.ts), never anything a request carries.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { CommandInput } from '@shared/ipc/schema';
import type { MawsArtifactCapture, MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';

type Seams = { __maws_scenario?: { advanceTo(ms: number): void }; __maws_library?: { holdRefreshes(): Promise<void> } };

export async function runE2eSeam(input: CommandInput<'daemon.e2eSeam'>, allowed: boolean): Promise<void> {
  if (!allowed) throw new Error('daemon.e2eSeam is refused: mawsd was not started under MAWS_E2E=1');
  const seams = globalThis as Seams;
  if (input.seam === 'scenario.advanceTo') {
    if (!seams.__maws_scenario) throw new Error('no scenario clock: mawsd is not in launch mode scenario with MAWS_SCENARIO_CLOCK=manual');
    return seams.__maws_scenario.advanceTo(input.ms);
  }
  if (!seams.__maws_library) throw new Error('no library seam: the spine’s library is not running');
  await seams.__maws_library.holdRefreshes();
}

// P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §K): `daemon.e2eRender`, a capture through
// the render seam fed as the engine host's `maws.artifact.capture` would be, its PNG written to `to` for the e2e to read.
// Refused unless `mawsd` runs under MAWS_E2E=1, as the seams above.
export async function runE2eRender(input: CommandInput<'daemon.e2eRender'>, allowed: boolean, capture: (request: MawsArtifactCapture) => Promise<MawsArtifactCapturedResult>): Promise<void> {
  if (!allowed) throw new Error('daemon.e2eRender is refused: mawsd was not started under MAWS_E2E=1');
  const { artifactId, revision, width, height, to } = input;
  const result = await capture({ appSessionId: 'e2e-render' as AppSessionId, requestId: `e2e-render-${randomUUID()}` as RequestId, artifactId, revision, width, height });
  if (!result.ok) throw new Error(`the capture failed: ${result.error}`);
  await writeFile(to, Buffer.from(result.png, 'base64'));
}
