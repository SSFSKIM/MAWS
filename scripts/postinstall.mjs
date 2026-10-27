// The package's postinstall (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.3). node-pty's darwin-arm64 prebuild
// ships its spawn helper without the execute bit, so the bit is set where that prebuild exists (the Mac); elsewhere
// (a Linux runner, where node-pty builds from source) there is nothing to set. Then Electron's own installer, unless
// ELECTRON_SKIP_BINARY_DOWNLOAD=1, which Electron 44's installer no longer reads itself: a Linux machine with no app
// (devenv/setup.sh, P5 O2 M8) needs node-pty built and no Electron binary.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, statSync } from 'node:fs';
import process from 'node:process';

const helper = 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper';
if (existsSync(helper)) chmodSync(helper, statSync(helper).mode | 0o111);

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1') {
  process.stdout.write('postinstall: ELECTRON_SKIP_BINARY_DOWNLOAD=1, so no Electron binary is installed\n');
  process.exit(0);
}

const install = spawnSync('install-electron', { stdio: 'inherit' });
if (install.error) throw install.error;
process.exit(install.status ?? 1);
