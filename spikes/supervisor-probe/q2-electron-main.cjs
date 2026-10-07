// E10 M0 Q2, the Electron half: spawn a detached child exactly as §Design 1 specifies (process.execPath as Node, own session, stdio to a log file, argv0, unref), print its pid, then quit (argv `quit`) or hold until killed (argv `hold`).
const { app } = require('electron'); const { spawn } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path');
const [mode, userData, childScript] = process.argv.slice(-3);
app.setPath('userData', userData); app.dock?.hide();
app.whenReady().then(() => {
  const logFd = fs.openSync(path.join(userData, 'host.log'), 'a');
  const child = spawn(process.execPath, [childScript, '--child', 'electron-' + mode], { detached: true, stdio: ['ignore', logFd, logFd], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, cwd: process.cwd(), argv0: 'maws-supervisor' });
  child.unref(); fs.closeSync(logFd); process.stdout.write(JSON.stringify({ electron: process.pid, child: child.pid }) + '\n');
  if (mode === 'quit') setTimeout(() => app.quit(), 300);
});
