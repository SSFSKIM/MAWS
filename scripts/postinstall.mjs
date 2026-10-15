// The package's postinstall (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.3). node-pty's darwin-arm64 prebuild
// ships its spawn helper without the execute bit, so the bit is set where that prebuild exists (the Mac); elsewhere
// (a Linux runner, where node-pty builds from source) there is nothing to set. Then Electron's own installer.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, statSync } from 'node:fs';
import process from 'node:process';

const helper = 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper';
if (existsSync(helper)) chmodSync(helper, statSync(helper).mode | 0o111);

const install = spawnSync('install-electron', { stdio: 'inherit' });
if (install.error) throw install.error;
process.exit(install.status ?? 1);
