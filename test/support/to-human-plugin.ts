// P4-R7z (the P4 spec's Decision Log 92): a scratch config home where the to-human plugin registers its message tool, as
// the style resolver reads it (src/main/owner/resolve-style.ts, `messageTool`): doperpowers installed with its
// `to-human` output style declaring `declared`, the `to-human` plugin installed beside it, both enabled at user scope,
// and `doperpowers:to-human` selected. `toHuman: false` leaves the to-human plugin out (installed but disabled).
// Settings already in the home are kept, these keys merged over them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLUGIN_STYLE = 'doperpowers:to-human';

export function installToHumanPlugin(configHome: string, options: { declared?: number; toHuman?: boolean } = {}): void {
  const { declared = 6, toHuman = true } = options;
  const doperpowers = join(configHome, 'plugins', 'cache', 'doperpowers', 'doperpowers', '7.200.0');
  const plugin = join(configHome, 'plugins', 'cache', 'doperpowers', 'to-human', '0.7.1');
  mkdirSync(join(doperpowers, 'output-styles'), { recursive: true });
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(doperpowers, 'output-styles', 'to-human.md'), `---\nname: to-human\nmaws-to-human-contract: ${declared}\n---\n\nSend every message with mcp__to-human__message.\n`);
  const record = (installPath: string) => [{ scope: 'user', installPath, version: '0', installedAt: '2026-10-27T00:00:00.000Z', lastUpdated: '2026-10-27T00:00:00.000Z' }];
  writeFileSync(join(configHome, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'doperpowers@doperpowers': record(doperpowers), 'to-human@doperpowers': record(plugin) } }));
  const path = join(configHome, 'settings.json');
  const settings = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(path, JSON.stringify({ ...settings, outputStyle: PLUGIN_STYLE, enabledPlugins: { ...(settings.enabledPlugins as object | undefined), 'doperpowers@doperpowers': true, 'to-human@doperpowers': toHuman } }));
}
