// The local-latency bench's engine as its callers see it (P5 O1, M1): the shell wrapper that MAWS_E2E_ENGINE_BIN names,
// and the stub's marker text and pace, which test/support/latency-engine-stub.mjs writes and its test reads back.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_ENGINE_VERSION } from './engine-pin';

export const LATENCY_STUB = join(__dirname, 'latency-engine-stub.mjs');
export const LATENCY_STUB_PACE_MS = 10; // one text delta every 10 ms, the recorded engine's median (O1 Surprises)

// The k-th delta's text of a turn (k from 1), and the pattern that finds one in the page.
export const markerOf = (turn: number, k: number): string => `⟦t${turn}:${k}⟧ `;
export const MARKER_SOURCE = '⟦t(\\d+):(\\d+)⟧';

// Ticket 851, M5 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, D14): what the prestart measure and its scenes
// set on the stub. `initMs` holds its initialize answer that long (the real engine's boot and SessionStart hooks run
// inside initialize, W1); `startsFile` gets one line per process start, so engine starts are counted outside the journal.
// The engine host passes no MAWS_* variable to an engine (src/engine-host/launch.ts's allow-list), so both are written
// into the wrapper, as the version is.
export interface LatencyEngineOptions {
  initMs?: number;
  startsFile?: string;
}

// One process start of the stub, as it writes it to its starts file: its pid, its clock's read (the bench's clock,
// `performance.timeOrigin + performance.now()`), the session id it was launched under and its engine arguments.
export interface LatencyEngineStart {
  pid: number;
  at: number;
  sessionId: string | null;
  args: string[];
}

// The starts a starts file holds, oldest first; none when the file is not there yet.
export const startsOf = (path: string): LatencyEngineStart[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as LatencyEngineStart) : []);

// An executable at `path` that runs the stub on this Node with its samples file, the engine's own arguments after it,
// and the pinned version for --version (as e2e/browser-cua.spec.ts's seventh scene wraps its engine stub).
export function writeLatencyEngine(path: string, samples: string, options: LatencyEngineOptions = {}): string {
  const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
  const vars = [
    `MAWS_LATENCY_STUB_VERSION=${quote(FIXTURE_ENGINE_VERSION)}`,
    ...(options.initMs === undefined ? [] : [`MAWS_LATENCY_STUB_INIT_MS=${quote(String(options.initMs))}`]),
    ...(options.startsFile === undefined ? [] : [`MAWS_LATENCY_STUB_STARTS_FILE=${quote(options.startsFile)}`]),
  ];
  writeFileSync(path, `#!/bin/sh\n${vars.join(' ')} exec ${quote(process.execPath)} ${quote(LATENCY_STUB)} ${quote(samples)} "$@"\n`, { mode: 0o755 });
  return path;
}
