// The M3 live proof's MAWS (the in-app browser spec of 2026-10-08): the worktree's built main (out/main/index.js, `pnpm
// build` or a harness build) run by the Electron binary itself, with no Playwright driver attached. serve-dev.mjs
// launches through Playwright's Electron driver, whose own CDP client attaches to every page and dismisses any
// JavaScript dialog that has no listener of its own, so a page's alert under it never reaches the vendor (found by M3's
// first run: the dialog closed 1 ms after it opened with nobody answering it). This keeps MAWS's pages as the product
// has them.
//
//   node_modules/.bin/electron spikes/cua-backend/serve-plain.cjs <userData under /tmp> <appSessionId>...
//
// Same environment as serve-dev.mjs: MAWS_E2E=1 (the seam, for opening the named sessions' sockets), MAWS_E2E_QUIET=1
// (a transparent, click-through window), a scratch engine store; never the owner's profile. Prints one JSON line
// {sockets: {<id>: <path>}} and serves until SIGTERM to the Electron process, then prints the seam's `inspect()` and
// quits (a signal to node_modules/.bin/electron's wrapper ends Electron before it can print).
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const [userData, ...sessions] = process.argv.slice(process.defaultApp ? 2 : 1).filter((arg) => !arg.startsWith('-'));
if (!userData || sessions.length === 0) {
  process.stderr.write('usage: electron serve-plain.cjs <userData> <appSessionId>...\n');
  process.exit(2);
}
mkdirSync(join(userData, 'claude-config'), { recursive: true });
const engine = join(userData, 'replay-engine');
writeFileSync(engine, '#!/bin/sh\nif [ "$1" = --version ]; then echo "2.1.292 (Claude Code)"; exit 0; fi\nexit 64\n', { mode: 0o755 });
for (const key of Object.keys(process.env)) if (/^(CLAUDE|NODE_OPTIONS$)/.test(key)) delete process.env[key];
Object.assign(process.env, { MAWS_E2E: '1', MAWS_E2E_QUIET: '1', MAWS_HARNESS: '0', MAWS_USER_DATA: userData, CLAUDE_CONFIG_DIR: join(userData, 'claude-config'), MAWS_CLAUDE_USAGE_DIR: join(userData, 'claude-usage'), MAWS_E2E_ENGINE_BIN: engine });

require(join(__dirname, '../../out/main/index.js'));
const { app } = require('electron');

app.whenReady().then(async () => {
  while (!globalThis.__maws_browser?.cua) await new Promise((resolve) => setTimeout(resolve, 100));
  const sockets = Object.fromEntries(sessions.map((id) => [id, globalThis.__maws_browser.cua.socketPathFor(id)]));
  process.stdout.write(`${JSON.stringify({ sockets })}\n`);
});
process.on('SIGTERM', () => {
  process.stdout.write(`${JSON.stringify({ inspect: globalThis.__maws_browser?.cua.inspect() ?? null })}\n`);
  app.quit();
});
