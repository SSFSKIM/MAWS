// The stub engine (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Orientation and M2; D28, D31): a journal fixture
// played as a real process over real stdio, for the scenes and tests that need a child a session host holds, since the
// in-process replay spawns nothing. Its rules are the replay transport's own (src/engine-host/replay-transport.ts: the
// handshake prelude, the recorded ids mapped onto the host's, unrecorded reads answered empty, a held `out` row waiting
// for the matching write, the e2e pacing), because this module drives `replayEngine` itself: each stdin line is a
// write, each frame the replay plays is a stdout line, each stderr row a stderr line, and the replay's exit is the
// process's. test/support/stub-engine-bin.ts bundles it with esbuild into one .mjs and writes the executable wrapper
// that MAWS_E2E_ENGINE_BIN names, with the stub's options baked in (the launch's allowlist passes no `MAWS_*` key).
//
//   stub-engine.mjs --stub-fixture <journal> --stub-prelude <journal> [options] -- [engine arguments…]
//
// Options: `--stub-fixture-for <engine session id>=<journal>` plays that journal for a launch whose `--session-id` or
// `--resume` names the id; `--stub-row-ms <n>` paces each `in` row; the directives `--stub-spawn-child` (a `sleep` it
// parents, its pid printed as the stderr line `stub-engine child <pid>`, ended with the stub), `--stub-count-stdin`
// (the stderr line `stub-engine stdin <frames> frames, <user> user` at its exit) and `--stub-print-env <K1,K2>` (each
// as the stderr line `stub-engine env K=V` at its start). `--version` alone answers the tested version. A write the
// fixture never recorded ends the replay as a mismatch: the reason on stderr and exit 1. An `end_session` and the end of
// stdin end it with 0, SIGTERM with the signal, as the engine does.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import type { StdinFrame } from '@shared/wire/frames';
import { TESTED_ENGINE_VERSION } from '../../src/engine-host/engine-compat';
import { appReplayHandshake } from '../../src/engine-host/replay-handshake';
import { replayEngine } from '../../src/engine-host/replay-transport';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split === -1 ? [] : argv.slice(0, split);
const engineArgs = split === -1 ? argv : argv.slice(split + 1);

if (engineArgs.length === 1 && engineArgs[0] === '--version') {
  process.stdout.write(`${TESTED_ENGINE_VERSION} (Claude Code)\n`);
  process.exit(0);
}

const option = (name: string): string | undefined => {
  const at = own.lastIndexOf(name);
  return at === -1 ? undefined : own[at + 1];
};
const flag = (name: string): boolean => own.includes(name);
const engineOption = (name: string): string | undefined => {
  const at = engineArgs.indexOf(name);
  return at === -1 ? undefined : engineArgs[at + 1];
};

function readJournal(path: string): JournalRow[] {
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => parseJournalRow(JSON.parse(line)));
}

function fixtureOf(): string {
  const id = engineOption('--session-id') ?? engineOption('--resume');
  for (let i = 0; i < own.length; i += 1) {
    if (own[i] !== '--stub-fixture-for') continue;
    const [key, path] = (own[i + 1] ?? '').split(/=(.*)/s);
    if (key === id && path) return path;
  }
  const fixture = option('--stub-fixture');
  if (!fixture) {
    process.stderr.write('stub-engine: no --stub-fixture\n');
    process.exit(64);
  }
  return fixture;
}

const prelude = option('--stub-prelude');
if (!prelude) {
  process.stderr.write('stub-engine: no --stub-prelude\n');
  process.exit(64);
}

for (const key of (option('--stub-print-env') ?? '').split(',').filter(Boolean)) process.stderr.write(`stub-engine env ${key}=${process.env[key] ?? ''}\n`);

let child: ChildProcess | null = null;
if (flag('--stub-spawn-child')) {
  child = spawn('sleep', ['600'], { stdio: 'ignore' });
  process.stderr.write(`stub-engine child ${child.pid}\n`);
}

const rows = appReplayHandshake(readJournal(fixtureOf()), null);
const rowMs = Number(option('--stub-row-ms') ?? 0);
const replay = replayEngine(rows, { prelude: readJournal(prelude), surfaceReads: true, rowDelayMs: Number.isFinite(rowMs) && rowMs > 0 ? rowMs : undefined });

let frames = 0;
let users = 0;
let mismatch: string | null = null;
let stdinEnded = false;

// The initialize request is launch-owned (its trust attestation among the fields): the recorded one takes the written
// one's request, as appReplayHandshake projects the app's own, so a launch with or without trust matches.
function adoptInitialize(frame: { type?: string; request?: { subtype?: string } }): void {
  if (frame.type !== 'control_request' || frame.request?.subtype !== 'initialize') return;
  for (const row of rows) {
    const recorded = row.frame as { type?: string; request?: { subtype?: string } };
    if (row.direction === 'out' && recorded.type === 'control_request' && recorded.request?.subtype === 'initialize') recorded.request = structuredClone(frame.request);
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (line.trim().length === 0) return;
  let frame: StdinFrame;
  try {
    frame = JSON.parse(line) as StdinFrame;
  } catch {
    process.stderr.write(`stub-engine: a stdin line that is not JSON: ${line.slice(0, 120)}\n`);
    return;
  }
  frames += 1;
  if ((frame as { type?: string }).type === 'user') users += 1;
  adoptInitialize(frame as never);
  replay.write(frame).catch((error: unknown) => {
    // a mismatch is also an item (below); a write after the replay ended is the engine's dropped input
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('the replay ended')) process.stderr.write(`stub-engine: a write was not played: ${message}\n`);
  });
});
input.on('close', () => {
  stdinEnded = true;
  replay.kill('SIGTERM'); // the engine ends with its input; reported as exit 0 below
});

process.on('SIGTERM', () => replay.kill('SIGTERM'));

void (async () => {
  const stderr = (async () => {
    for await (const { text } of replay.stderr) process.stderr.write(`${text}\n`);
  })();
  for await (const item of replay.frames) {
    if (item.error) {
      if (item.error.kind === 'replay_mismatch') mismatch ??= item.error.message;
      continue; // a stand-in's note (an unrecorded read): its answer follows as a frame
    }
    process.stdout.write(`${JSON.stringify(item.frame)}\n`);
  }
  await stderr;
  const exit = await replay.exited;
  if (flag('--stub-count-stdin')) process.stderr.write(`stub-engine stdin ${frames} frames, ${users} user\n`);
  child?.kill('SIGTERM');
  if (mismatch !== null) process.stderr.write(`stub-engine: ${mismatch}\n`);
  const done = () => {
    if (mismatch !== null) process.exit(1);
    if (exit.signal === 'SIGTERM' && !stdinEnded) {
      process.removeAllListeners('SIGTERM');
      process.kill(process.pid, 'SIGTERM');
      return;
    }
    process.exit(exit.code ?? 0);
  };
  if (process.stdout.writableNeedDrain) process.stdout.once('drain', done);
  else done();
})();
