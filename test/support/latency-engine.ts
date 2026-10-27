// The local-latency bench's engine as its callers see it (P5 O1, M1): the shell wrapper that MAWS_E2E_ENGINE_BIN names,
// and the stub's marker text and pace, which test/support/latency-engine-stub.mjs writes and its test reads back.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_ENGINE_VERSION } from './engine-pin';

export const LATENCY_STUB = join(__dirname, 'latency-engine-stub.mjs');
export const LATENCY_STUB_PACE_MS = 10; // one text delta every 10 ms, the recorded engine's median (O1 Surprises)

// The k-th delta's text of a turn (k from 1), and the pattern that finds one in the page.
export const markerOf = (turn: number, k: number): string => `⟦t${turn}:${k}⟧ `;
export const MARKER_SOURCE = '⟦t(\\d+):(\\d+)⟧';

// An executable at `path` that runs the stub on this Node with its samples file, the engine's own arguments after it,
// and the pinned version for --version (as e2e/browser-cua.spec.ts's seventh scene wraps its engine stub).
export function writeLatencyEngine(path: string, samples: string): string {
  const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
  writeFileSync(path, `#!/bin/sh\nMAWS_LATENCY_STUB_VERSION=${quote(FIXTURE_ENGINE_VERSION)} exec ${quote(process.execPath)} ${quote(LATENCY_STUB)} ${quote(samples)} "$@"\n`, { mode: 0o755 });
  return path;
}
