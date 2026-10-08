// A MAWS built from this worktree (`pnpm build` or a harness build: out/main/index.js), launched through Playwright's
// Electron driver over its own profile so the M2 live proof can point cua's real host at a session's socket:
//
//   node spikes/cua-backend/serve-dev.mjs <userData under /tmp> <appSessionId>...
//
// It runs MAWS with MAWS_E2E=1 (the e2e seam) and MAWS_E2E_QUIET=1 (a transparent, click-through window), never the
// owner's profile (MAWS_USER_DATA) nor the owner's engine store (CLAUDE_CONFIG_DIR is a scratch directory), asks the
// seam for each named session's socket (cua's server listens from then on), prints one JSON line
// {sockets: {<id>: <path>}} and serves until SIGINT/SIGTERM, then closes the app. On exit it prints the seam's
// `inspect()` reading (connections, held commands, leased tabs per session).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';

const [userData, ...sessions] = process.argv.slice(2);
if (!userData || sessions.length === 0) {
  process.stderr.write('usage: serve-dev.mjs <userData> <appSessionId>...\n');
  process.exit(2);
}
const repo = resolve(fileURLToPath(import.meta.url), '../../..');
mkdirSync(join(userData, 'claude-config'), { recursive: true });
const engine = join(userData, 'replay-engine');
writeFileSync(engine, '#!/bin/sh\nif [ "$1" = --version ]; then echo "2.1.292 (Claude Code)"; exit 0; fi\nexit 64\n', { mode: 0o755 });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLAUDE|ELECTRON_|NODE_OPTIONS$)/.test(key)));
Object.assign(env, { MAWS_E2E: '1', MAWS_E2E_QUIET: '1', MAWS_HARNESS: '0', MAWS_USER_DATA: userData, CLAUDE_CONFIG_DIR: join(userData, 'claude-config'), MAWS_CLAUDE_USAGE_DIR: join(userData, 'claude-usage'), MAWS_E2E_ENGINE_BIN: engine });
const app = await _electron.launch({ args: [join(repo, 'out/main/index.js')], env, cwd: repo });
await app.firstWindow();
const sockets = {};
for (const id of sessions) sockets[id] = await app.evaluate((_electron, appSessionId) => globalThis.__maws_browser.cua.socketPathFor(appSessionId), id);
console.log(JSON.stringify({ sockets }));
const stop = async () => {
  try {
    console.log(JSON.stringify({ inspect: await app.evaluate(() => globalThis.__maws_browser.cua.inspect()) }));
  } finally {
    await app.close();
    process.exit(0);
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
