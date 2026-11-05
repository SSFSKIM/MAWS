// The machine half of the settings as its readers see it (P5 O3-C, D6; contract O3X3): the library implements it in
// process (src/services/settings/machine.ts), and main's client settings service (src/main/client/settings.ts) composes
// the renderer's one `Settings` from it. P5 O3-D M5b (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces
// §G, D25): on the daemon shape main implements it again over the services front (src/main/client/machine-settings-mirror.ts),
// whose write crosses a socket, so `update` is asynchronous in every backing.
import type { Route } from '../engine/route';
import type { MachineSettings, SettingsPatch } from '../ipc/schema/settings';

export interface MachineSettingsService {
  state(): MachineSettings;
  // resolves once the write persisted and every listener was told; rejects when the file may not be written (a run
  // refused the spine, an invalid or unknown file), changing nothing
  update(patch: SettingsPatch): Promise<MachineSettings>;
  onChange(listener: (state: MachineSettings) => void): () => void;
  // P5 O7 M9 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9 "The default, without a v2"): the machine's
  // default route, resolved (`machine-route.json`'s choice, else the rule over `gateway.defaultRoute`), and its set,
  // which writes `machine-route.json` and the legacy `gateway.defaultRoute` an older build reads; it resolves once both
  // persisted and every `onChange` listener was told, and rejects as `update` does. An `update` naming
  // `gateway.defaultRoute` (an older client's choice) chooses that route too.
  defaultRoute(): Route;
  setDefaultRoute(route: Route): Promise<Route>;
}
