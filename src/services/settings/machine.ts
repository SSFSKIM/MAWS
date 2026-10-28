// The machine half of the settings (P5 O3-A; docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3, contract O3X3): the
// fields every launch on the machine reads and `mawsd` reads with no app (the engine, the gateway, the auto fallback,
// the to-human switch, the idle time, the design-system defaults, the sweep), in `<profile>/machine-settings.json`, on a
// version line of its own. Electron-free and part of the spine: it runs in main until O3-D moves it into `mawsd`, and
// it is written only by the process that holds `spine.lock` (§2). In a run refused the spine it is read, never written.
// Main's client settings service (src/main/client/settings.ts) composes it with the client file into the renderer's one
// `Settings` and routes each field of a patch here or there.
import { MachineSettingsSchema, type MachineSettings } from '@shared/ipc/schema/settings';
import { applyMachinePatch, machineSettingsDefaults, migrateMachineSettings } from '@shared/settings/defaults';
import { openSettingsFile, type SettingsFileRules } from '@shared/settings/file-store';
import type { MachineSettingsService } from '@shared/spine/machine-settings';

export const machineSettingsRules: SettingsFileRules<MachineSettings> = {
  read: (raw) => ({ value: migrateMachineSettings(raw) }),
  defaults: machineSettingsDefaults,
  validate: (value) => MachineSettingsSchema.parse(value),
};

// `refused`: why this run may not write the machine's files (src/services/settings/spine-lock.ts), or why the split could
// not hand this file its fields (src/services/settings/split.ts). `unsplit`: the unified file's machine fields the split
// could not write, held in memory for this run in place of the absent file.
export function startMachineSettings(file: string, { refused, unsplit = null }: { refused: string | null; unsplit?: MachineSettings | null }): MachineSettingsService {
  const rules = unsplit === null ? machineSettingsRules : { ...machineSettingsRules, defaults: () => structuredClone(unsplit) };
  const store = openSettingsFile(file, rules, { refused });
  const listeners = new Set<(state: MachineSettings) => void>();
  return {
    state: () => store.value,
    update: (patch) => {
      const next = store.update((current) => applyMachinePatch(current, patch));
      for (const listener of listeners) listener(next);
      return next;
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
