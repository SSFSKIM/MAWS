// Prime @electron/get v5's cache before install-electron. Its installer still checks
// the zip against electron/checksums.json, including on cache hits. No npm deps:
// CI runs this before pnpm install, after restoring the existing Electron cache.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function prefetchElectron() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1') return;
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).devDependencies.electron;
  const platform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform;
  let arch = process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || process.arch;
  // Match install.js's Rosetta selection when Node itself is x64 on an arm64 Mac.
  if (platform === 'darwin' && process.platform === 'darwin' && arch === 'x64' && process.env.npm_config_arch === undefined) {
    const translated = spawnSync('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' });
    if (translated.stdout?.trim() === '1') arch = 'arm64';
  }
  const file = `electron-v${version}-${platform}-${arch}.zip`;
  // Cache.getCacheDirectory hashes the URL's parent (no trailing slash), not the
  // file URL. Defaults match env-paths('electron', { suffix: '' }) on our runners.
  const key = createHash('sha256').update(`https://github.com/electron/electron/releases/download/v${version}`).digest('hex');
  const cache = process.env.electron_config_cache || (process.platform === 'darwin'
    ? join(homedir(), 'Library/Caches/electron')
    : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'electron'));
  const dest = join(cache, key, file);
  if (existsSync(dest)) return;
  const fetched = spawnSync('bash', [fileURLToPath(new URL('../.github/scripts/release-fetch.sh', import.meta.url)), 'electron/electron', `v${version}`, file, dest], { stdio: 'inherit' });
  if (fetched.error) throw fetched.error;
  if (fetched.status !== 0) throw new Error(`Electron prefetch failed (exit ${fetched.status})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prefetchElectron();
