// The e2e's spine seams on the daemon shape (M5b fix round 2; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D11):
// the scenario's manual clock (`__maws_scenario`) and the library's held refreshes (`__maws_library`) live where the spine
// runs, so on the daemon shape main installs the same two globals under MAWS_E2E=1, each a relay to `mawsd`'s
// `daemon.e2eSeam` (src/mawsd/e2e-seam.ts) that resolves once `mawsd` did it. A spec's `app.evaluate` reads them as it does
// in process on the embedded shape, awaiting what they answer.
//
// P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §K): `__maws_daemonRender.capture`, a capture
// through `mawsd`'s render seam (`daemon.e2eRender`), its PNG written to the path the spec names; the daemon shape's
// counterpart of `__maws_captures`, which captures in main.
import type { HostSupervisor } from '@shared/host/host-supervisor';
import type { CommandInput } from '@shared/ipc/schema';

type Seams = {
  __maws_scenario?: { advanceTo(ms: number): Promise<void> };
  __maws_library?: { holdRefreshes(): Promise<void> };
  __maws_daemonRender?: { capture(input: CommandInput<'daemon.e2eRender'>): Promise<void> }; // P5 O5 M4
};

export function installDaemonE2eSeams(hosts: Pick<HostSupervisor, 'dispatch'>, env: NodeJS.ProcessEnv): () => void {
  if (env.MAWS_E2E !== '1') return () => {};
  const ask = async (name: 'daemon.e2eSeam' | 'daemon.e2eRender', input: unknown) => {
    const answer = await hosts.dispatch('machine', name, input as never);
    if (!answer.ok) throw new Error(answer.error.message);
  };
  const relay = (input: CommandInput<'daemon.e2eSeam'>) => ask('daemon.e2eSeam', input);
  const seams = globalThis as Seams;
  const scenario = { advanceTo: (ms: number) => relay({ seam: 'scenario.advanceTo', ms }) };
  const library = { holdRefreshes: () => relay({ seam: 'library.holdRefreshes' }) };
  const render = { capture: (input: CommandInput<'daemon.e2eRender'>) => ask('daemon.e2eRender', input) }; // P5 O5 M4
  seams.__maws_scenario = scenario;
  seams.__maws_library = library;
  seams.__maws_daemonRender = render;
  return () => {
    if (seams.__maws_scenario === scenario) delete seams.__maws_scenario;
    if (seams.__maws_library === library) delete seams.__maws_library;
    if (seams.__maws_daemonRender === render) delete seams.__maws_daemonRender;
  };
}
