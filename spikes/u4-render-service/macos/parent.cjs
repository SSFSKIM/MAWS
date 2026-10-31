// The production tree of the macOS half: a plain-Node parent (what a LaunchAgent-run mawsd is: the app binary run as
// Node) spawning the Electron probe as a windowless child without ELECTRON_RUN_AS_NODE, under launchd's GUI domain.
// Run as: ELECTRON_RUN_AS_NODE=1 <electron> parent.cjs <electron> <main.cjs> --accessory --out <dir> --fixture <dir>
// Writes <out>/parent.json with the child's exit and timing; the child's stdout and stderr go to <out>/child-*.txt.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [electron, main, ...args] = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args[outAt + 1] : process.cwd();
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const started = Date.now();
const stdout = fs.openSync(path.join(out, 'child-stdout.txt'), 'w');
const stderr = fs.openSync(path.join(out, 'child-stderr.txt'), 'w');
const child = spawn(electron, [main, ...args], { env, stdio: ['ignore', stdout, stderr], argv0: 'maws-render-host' });
const record = (extra) => fs.writeFileSync(path.join(out, 'parent.json'), JSON.stringify({ parentPid: process.pid, parentIsNode: Boolean(process.versions.electron) && process.env.ELECTRON_RUN_AS_NODE === '1', childPid: child.pid, ms: Date.now() - started, ...extra }, null, 2));
child.on('error', (error) => { record({ error: error.message }); process.exit(1); });
child.on('exit', (code, signal) => { record({ code, signal }); process.exit(code ?? 1); });
