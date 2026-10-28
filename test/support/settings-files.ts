// A profile's settings as main opens them since P5 O3-A (src/main/index.ts's `startSpineData`, holding spine.lock): the
// split of a unified file run once, the machine half's service, and the renderer's one `Settings` composed over both, for
// the suites that read or patch the settings without Electron.
import { composeSettings, type ComposedSettings } from '../../src/main/client/settings-store';
import { startMachineSettings } from '../../src/main/settings/machine';
import { settingsPaths, splitSettingsFiles } from '../../src/main/settings/split';

export function openSettingsFiles(profile: string): ComposedSettings {
  const paths = settingsPaths(profile);
  const split = splitSettingsFiles(paths, undefined, () => {});
  const machine = startMachineSettings(paths.machine, { refused: split.machineRefused, unsplit: split.unsplit });
  return composeSettings({ clientFile: paths.client, machine });
}
