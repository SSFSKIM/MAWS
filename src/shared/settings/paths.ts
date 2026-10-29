// The profile's two settings files (P5 O3-A §1: `settings.json` the client's, written by main; `machine-settings.json`
// the machine's, written by the spine under `spine.lock`). Neutral ground (P5 O3-C): main reads the client file's shape
// before the spine's data is opened, and the spine's split (src/services/settings/split.ts) writes both.
import { join } from 'node:path';

export const SETTINGS_FILES = { client: 'settings.json', machine: 'machine-settings.json' } as const;
export interface SettingsPaths {
  client: string;
  machine: string;
}
export const settingsPaths = (profile: string): SettingsPaths => ({ client: join(profile, SETTINGS_FILES.client), machine: join(profile, SETTINGS_FILES.machine) });
