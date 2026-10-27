// The profile a machine's default `mawsd` serves (P5 O2 M5, Interfaces "The profile and the files"; M8's Linux profile
// decision): the directory Electron's `userData` is for productName MAWS, so a machine's layout does not depend on
// whether an app runs there. `mawsd`'s CLI (M6) and the app's default-profile check (M7) read it; the RL10 file's
// literal paths for the sminos daemon follow it.
import { join } from 'node:path';

export function defaultProfileDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'MAWS');
  const config = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith('/') ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(config, 'MAWS');
}
