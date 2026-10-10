// An engine for e2e/browser-cua.spec.ts's seventh scene (the socket peer authentication spec of 2026-10-09, M2): MAWS's
// engine host runs it as a live (not replay) session's engine through MAWS_E2E_ENGINE_BIN, by way of a shell wrapper
// the scene writes, which names this Node and sets MAWS_CUA_STUB_VERSION. It answers `--version` in the pinned format;
// on a session launch it reads the cua socket from the `--settings` JSON's `env.CUA_BROWSER_BACKENDS` on its argv and
// starts test/support/cua-connector.mjs on it as its own child (as the engine starts `cua serve`), reporting to
// `cua-connector.json` in the session's working directory; then it stays silent and alive until its stdin closes.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write(`${process.env.MAWS_CUA_STUB_VERSION} (Claude Code)\n`);
  process.exit(0);
}

const at = args.indexOf('--settings');
const socket = at >= 0 ? JSON.parse(args[at + 1]).env?.CUA_BROWSER_BACKENDS : undefined;
if (typeof socket !== 'string' || socket === '') {
  process.stderr.write('cua engine stub: no CUA_BROWSER_BACKENDS in --settings\n');
  process.exit(64);
}
const connector = spawn(process.execPath, [join(fileURLToPath(new URL('.', import.meta.url)), 'cua-connector.mjs'), socket, join(process.cwd(), 'cua-connector.json')], { stdio: 'ignore' });
const end = () => {
  connector.kill();
  process.exit(0);
};
process.stdin.on('data', () => {}); // the host's initialize and anything after it: never answered
process.stdin.on('end', end);
process.on('SIGTERM', end);
process.on('SIGINT', end);
