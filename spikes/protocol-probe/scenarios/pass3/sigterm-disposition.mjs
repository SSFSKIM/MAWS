// C3 corrective (docs/doperpowers/ledgers/2026-09-30-c3-handshake-stall.md, child C3 of docs/charter.md): when does the
// pinned engine take over SIGTERM? The launch is C3's (flags, stdio pipes, `initialize` written at once) under a fresh
// scratch config home with no turn (no spend); SIGTERM is sent at a set delay after the spawn. An exit by the signal
// itself (code null, signal SIGTERM) means the default disposition ran, so the engine had not yet installed its own
// handler; the engine's handler exits 143. The C12 pre-run's two stalled resumes ended `signal: SIGTERM` at about 120 s,
// which places each stall before that point in the process's start.
//   node spikes/protocol-probe/scenarios/pass3/sigterm-disposition.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIN } from '../pass2/common.mjs';

const home = mkdtempSync('/private/tmp/maws-sigterm-disposition-');
writeFileSync(join(home, 'settings.json'), '{}\n');
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'en_US.UTF-8', TERM: 'dumb', CLAUDE_CONFIG_DIR: home, CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', ANTHROPIC_BASE_URL: 'http://127.0.0.1:8641', ANTHROPIC_AUTH_TOKEN: 'claudeusage-local-gateway' };
const FLAGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--include-partial-messages', '--forward-subagent-text', '--replay-user-messages', '--include-hook-events', '--setting-sources', 'user,project,local', '--model', 'haiku', '--settings', '{"dialogExpiry":"never"}'];

for (const delay of [5, 25, 50, 75, 100, 150, 250, 500, 1000]) {
  const t0 = Date.now();
  const child = spawn(BIN, FLAGS, { cwd: home, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let firstStdoutMs = null;
  child.stdout.on('data', () => (firstStdoutMs ??= Date.now() - t0));
  child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'sig-init', request: { subtype: 'initialize', supportedDialogKinds: ['auto_mode_server_fallback', 'refusal_fallback_prompt'], perTaskStopAffordance: true } })}\n`);
  const exit = await new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
    setTimeout(() => child.kill('SIGTERM'), delay);
  });
  console.log(JSON.stringify({ delayMs: delay, firstStdoutMs, ...exit, disposition: exit.signal === 'SIGTERM' ? 'default' : 'engine' }));
  await new Promise((resolve) => setTimeout(resolve, 300));
}
