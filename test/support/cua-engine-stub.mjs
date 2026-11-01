// An engine for e2e/browser-cua.spec.ts's seventh scene (the socket peer authentication spec of 2026-10-09, M2): MAWS's
// engine host runs it as a live (not replay) session's engine through MAWS_E2E_ENGINE_BIN, by way of a shell wrapper
// the scene writes, which names this Node and sets MAWS_CUA_STUB_VERSION. It answers `--version` in the pinned format;
// on a session launch it reads the cua socket from the `--settings` JSON's `env.CUA_BROWSER_BACKENDS` on its argv and
// starts test/support/cua-connector.mjs on it as its own child (as the engine starts `cua serve`), reporting to
// `cua-connector.json` in the session's working directory; then it stays silent and alive until its stdin closes.
//
// P5 O17 M8 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M8, "the ordinary start path"): with
// MAWS_CUA_STUB_READY=1 the engine comes ready, so a session reaches its engine through the ordinary start path
// (`session.create` and `session.start`, or a message that resumes it), which tells it the daemon's socket in its
// settings, never a raw `session.launch`: the engine protocol is test/support/latency-engine-stub.mjs's (each control
// answered from its recording, each user message one whole turn), run as this process's child on the same stdio, so this
// process stays the engine the host spawned and the connector stays its child, as cua's host is the engine's. The turns'
// samples go to `cua-engine-turns.jsonl` beside the report. With MAWS_CUA_STUB_RESPAWN=1 a connector that ends (a
// scene kills it) is started again, as the engine starts `cua serve` again; the new one reports to the same file.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
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

let ending = false;
let connector = null;
const startConnector = () => {
  connector = spawn(process.execPath, [join(here, 'cua-connector.mjs'), socket, join(process.cwd(), 'cua-connector.json')], { stdio: 'ignore' });
  connector.once('exit', () => {
    if (!ending && process.env.MAWS_CUA_STUB_RESPAWN === '1') setTimeout(startConnector, 200);
  });
};
startConnector();
const stopConnector = () => {
  ending = true;
  connector?.kill();
};

if (process.env.MAWS_CUA_STUB_READY === '1') {
  // stdin is the child's alone (this process never reads it), and its exit is this engine's
  const engine = spawn(process.execPath, [join(here, 'latency-engine-stub.mjs'), join(process.cwd(), 'cua-engine-turns.jsonl'), ...args], { stdio: 'inherit' });
  engine.once('exit', (code, signal) => {
    stopConnector();
    process.exit(code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1));
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => engine.kill(signal));
} else {
  const end = () => {
    stopConnector();
    process.exit(0);
  };
  process.stdin.on('data', () => {}); // the host's initialize and anything after it: never answered
  process.stdin.on('end', end);
  process.on('SIGTERM', end);
  process.on('SIGINT', end);
}
