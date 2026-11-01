// The stub engine as an executable (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M2; D31): test/support/
// stub-engine.ts bundled with esbuild into one .mjs (it runs the replay transport's own code, whose `@shared` imports
// Node cannot load as they stand), and the shell wrapper MAWS_E2E_ENGINE_BIN names, which runs it on this Node with the
// stub's options baked in, since the launch's environment allowlist passes no `MAWS_*` key to the engine. The e2e
// harness's writer (M2b, e2e/support/stub-engine.ts) and the unit tests over a real session host share it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';

const REPO_ROOT = resolve(__dirname, '../..');
const ENTRY = join(REPO_ROOT, 'test/support/stub-engine.ts');
export const STUB_PRELUDE = join(REPO_ROOT, 'test/fixtures/engine/replay-handshake.jsonl'); // the launcher's REPLAY_PRELUDE

export interface StubEngineOptions {
  fixture: string; // the journal played by default (absolute, or relative to the repository)
  fixtureFor?: Record<string, string>; // by the engine session id a launch's `--session-id` or `--resume` names
  fixtureDir?: string; // `<dir>/<that id>.jsonl`, looked up at each spawn (e2e/support/stub-engine.ts)
  rowMs?: number; // each `in` row's pace (the scenes' MAWS_E2E_REPLAY_ROW_MS, read by the harness that writes this)
  spawnChild?: boolean; // a `sleep` the stub parents, its pid on stderr
  countStdin?: boolean; // the frames it read, on stderr at its exit
  printEnv?: string[]; // these variables of its environment, on stderr at its start
  burst?: { file: string; lines: number }; // padded status lines once `file` exists (P5 O16 M3a fix waves 1 and 2)
  gate?: string; // a `maws` tools/call waits until this file exists (P5 O16 M3c fix wave 2)
}

// The bundle, written once into `dir`.
export function buildStubEngine(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const outfile = join(dir, 'stub-engine.mjs');
  buildSync({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'error',
    tsconfig: join(REPO_ROOT, 'tsconfig.node.json'),
    banner: { js: "import { createRequire as __stubRequire } from 'node:module'; const require = __stubRequire(import.meta.url);" },
  });
  return outfile;
}

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

// An executable at `path` that runs the bundle at `bundle` with `opts`, the engine's own arguments after them.
export function writeStubEngine(path: string, bundle: string, opts: StubEngineOptions): string {
  const abs = (fixture: string) => resolve(REPO_ROOT, fixture);
  const args = ['--stub-fixture', abs(opts.fixture), '--stub-prelude', STUB_PRELUDE];
  for (const [id, fixture] of Object.entries(opts.fixtureFor ?? {})) args.push('--stub-fixture-for', `${id}=${abs(fixture)}`);
  if (opts.fixtureDir) args.push('--stub-fixture-dir', opts.fixtureDir);
  if (opts.rowMs) args.push('--stub-row-ms', String(opts.rowMs));
  if (opts.spawnChild) args.push('--stub-spawn-child');
  if (opts.countStdin) args.push('--stub-count-stdin');
  if (opts.printEnv?.length) args.push('--stub-print-env', opts.printEnv.join(','));
  if (opts.burst) args.push('--stub-burst', `${opts.burst.file},${opts.burst.lines}`);
  if (opts.gate) args.push('--stub-gate', opts.gate);
  writeFileSync(path, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(bundle)} ${args.map(quote).join(' ')} -- "$@"\n`, { mode: 0o755 });
  return path;
}
