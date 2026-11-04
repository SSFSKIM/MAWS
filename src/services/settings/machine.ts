// The machine half of the settings (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3, contract O3X3): the
// fields every launch on the machine reads and `mawsd` reads with no app (the engine, the gateway, the auto fallback,
// the to-human switch, the idle time, the design-system defaults, the sweep), in `<profile>/machine-settings.json`, on a
// version line of its own. Electron-free and part of the spine: it runs in main until O3-D moves it into `mawsd`, and
// it is written only by the process that holds `spine.lock` (§2). In a run refused the spine it is read, never written.
// Main's client settings service (src/main/client/settings.ts) composes it with the client file into the renderer's one
// `Settings` and routes each field of a patch here or there.
// P5 O7 M9 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9 "The default, without a v2"): and the machine's
// default route, in `machine-route.json` beside it, under the same writer and the same refusal.
import { dirname, join } from 'node:path';
import type { LegacyRoute, Route } from '@shared/engine/route';
import { MACHINE_ROUTE_VERSION, MachineRouteSchema, MachineSettingsSchema, type MachineRoute, type MachineSettings } from '@shared/ipc/schema/settings';
import { applyMachinePatch, legacyDefaultRoute, machineSettingsDefaults, migrateMachineRoute, migrateMachineSettings, resolveDefaultRoute } from '@shared/settings/defaults';
import { openSettingsFile, type SettingsFileRules, type SettingsFileStore } from '@shared/settings/file-store';
import { SETTINGS_FILES } from '@shared/settings/paths';
import type { MachineSettingsService } from '@shared/spine/machine-settings';

export const machineSettingsRules: SettingsFileRules<MachineSettings> = {
  read: (raw) => ({ value: migrateMachineSettings(raw) }),
  defaults: machineSettingsDefaults,
  validate: (value) => MachineSettingsSchema.parse(value),
};

// P5 O7 M9: null while the file is absent (or unreadable, or a version this build does not know, which also refuses its
// writes): the default is then the rule's over the machine file
export const machineRouteRules: SettingsFileRules<MachineRoute | null> = {
  read: (raw) => ({ value: migrateMachineRoute(raw) }),
  defaults: () => null,
  validate: (value) => MachineRouteSchema.parse(value),
};

export interface MachineSettingsOptions {
  refused: string | null;
  unsplit?: MachineSettings | null;
  // P5 O7 M9: the machine route's legacy route at a set of `machine` (src/shared/engine/route.ts's legacyRouteOf over the
  // machine's effective base URL); absent, the legacy field keeps what it holds
  legacyOfMachine?: () => Promise<LegacyRoute>;
}

// `refused`: why this run may not write the machine's files (src/services/settings/spine-lock.ts), or why the split could
// not hand this file its fields (src/services/settings/split.ts). `unsplit`: the unified file's machine fields the split
// could not write, held in memory for this run in place of the absent file.
export function startMachineSettings(file: string, { refused, unsplit = null, legacyOfMachine }: MachineSettingsOptions): MachineSettingsService {
  const rules = unsplit === null ? machineSettingsRules : { ...machineSettingsRules, defaults: () => structuredClone(unsplit) };
  const store = openSettingsFile(file, rules, { refused });
  const routeStore = openSettingsFile(join(dirname(file), SETTINGS_FILES.route), machineRouteRules, { refused });
  const listeners = new Set<(state: MachineSettings) => void>();
  const tell = () => {
    for (const listener of listeners) listener(store.value);
    return store.value;
  };
  return {
    state: () => store.value,
    // P5 O3-D M5b (Interfaces §G): persisted and told synchronously, as before; the promise settles at once
    update: async (patch) => {
      const chosen = patch.gateway?.defaultRoute;
      if (chosen === undefined) store.update((current) => applyMachinePatch(current, patch));
      else choose(store, routeStore, chosen, (current) => applyMachinePatch(current, patch));
      return tell();
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    defaultRoute: () => resolveDefaultRoute(routeStore.value, store.value.gateway.defaultRoute),
    setDefaultRoute: async (route) => {
      if (refused !== null) throw new Error(`${file} is not written this run: ${refused}`); // before asking the legacy route
      const machineLegacy = route === 'machine' && legacyOfMachine ? await legacyOfMachine() : null;
      choose(store, routeStore, route, (current) => applyMachinePatch(current, { gateway: { defaultRoute: legacyDefaultRoute(route, machineLegacy ?? current.gateway.defaultRoute) } }));
      tell();
      return route;
    },
  };
}

// One choice of the default, both files or neither as far as the files' own rules can tell: the machine file is read for
// its update first, then the route file is written inside that update, so a file either store refuses (refused, invalid,
// a version this build does not know) fails the choice before anything is written. Only a failed write of the machine
// file itself, after the route file's, leaves the route chosen here with the legacy field as it was.
function choose(store: SettingsFileStore<MachineSettings>, routeStore: SettingsFileStore<MachineRoute | null>, route: Route, change: (current: MachineSettings) => MachineSettings): void {
  store.update((current) => {
    const next = change(current);
    routeStore.update(() => ({ version: MACHINE_ROUTE_VERSION, defaultRoute: route }));
    return next;
  });
}

