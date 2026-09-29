// `pnpm dev:stub [-- --scenario <path>]`: `pnpm dev` in launch mode `scenario` (C5 execution document, Concrete Steps).
// The stub source plays test/fixtures/shell/nine-sessions.json unless another scenario is named, and the app runs with
// its own user-data directory so a scenario run never reads or writes the owner's real index, attention store or
// layout. MAWS_USER_DATA, when already set, wins.
const { spawn } = require('node:child_process');
const { homedir } = require('node:os');
const { join } = require('node:path');

const args = process.argv.slice(2).filter((arg) => arg !== '--');
let scenario = 'test/fixtures/shell/nine-sessions.json';
const at = args.indexOf('--scenario');
if (at !== -1) {
  scenario = args[at + 1];
  if (!scenario) throw new Error('--scenario needs a path');
  args.splice(at, 2);
}

const env = {
  ...process.env,
  MAWS_USER_DATA: process.env.MAWS_USER_DATA || join(homedir(), 'Library', 'Application Support', 'MAWS-stub'),
  MAWS_SESSION_SOURCE: `stub:${scenario}`,
};
console.log(`dev:stub: ${env.MAWS_SESSION_SOURCE}, user data ${env.MAWS_USER_DATA}`);
const child = spawn('electron-vite', ['dev', ...args], { env, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
