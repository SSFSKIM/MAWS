// The machine half of the settings as its readers see it (P5 O3-C, D6; contract O3X3): the library implements it in
// process (src/services/settings/machine.ts), and main's client settings service (src/main/client/settings.ts) composes
// the renderer's one `Settings` from it. At O3-D main implements it again over the services front.
import type { MachineSettings, SettingsPatch } from '../ipc/schema/settings';

export interface MachineSettingsService {
  state(): MachineSettings;
  // persists before returning and tells every listener; throws when the file may not be written (a run refused the
  // spine, an invalid or unknown file), changing nothing
  update(patch: SettingsPatch): MachineSettings;
  onChange(listener: (state: MachineSettings) => void): () => void;
}
