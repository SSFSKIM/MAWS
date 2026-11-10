// P5 O15 M2b (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Decision Log 25): what `numbersReadBack` costs
// the live path, once per engine line. The lines are every `in` frame of the probe's recordings as the engine writes it
// (JSON.stringify of the frame), timed as a whole set over several rounds beside JSON.parse of the same lines, which the
// transport already pays for each; the largest line is timed alone. Timing only, so it runs on request:
// `MAWS_BENCH=1 pnpm exec vitest run --project node src/engine-host/journal-numbers-bench.test.ts`, each number printed
// with the 1-minute load average beside it.
import { readdirSync, readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../../test/support/fixtures';
import { numbersReadBack } from './journal';

const ROUNDS = Number(process.env.MAWS_BENCH_ROUNDS ?? 30);
const report = (name: string, value: unknown) => console.log(`[numbers bench] ${name}: ${JSON.stringify(value)} (load ${loadavg()[0]!.toFixed(1)})`);

// The median of `ROUNDS` timings of `run` over every line, after one warm-up round, in ms.
function timed(lines: readonly string[], run: (line: string) => unknown): number {
  const rounds: number[] = [];
  for (let round = 0; round <= ROUNDS; round += 1) {
    const started = performance.now();
    for (const line of lines) run(line);
    if (round > 0) rounds.push(performance.now() - started);
  }
  return rounds.sort((a, b) => a - b)[Math.floor(rounds.length / 2)]!;
}

describe.skipIf(process.env.MAWS_BENCH !== '1')('numbersReadBack over the probe\'s engine lines', () => {
  it(`every in frame of the recordings, ${ROUNDS} rounds`, { timeout: 10 * 60_000 }, () => {
    const files = readdirSync(FIXTURE_DIR, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.jsonl'));
    const lines = files.flatMap((name) =>
      readFileSync(join(FIXTURE_DIR, name), 'utf8')
        .split('\n')
        .filter((text) => text.length > 0)
        .map((text) => JSON.parse(text) as { direction?: unknown; frame?: unknown })
        .filter((row) => row.direction === 'in')
        .map((row) => JSON.stringify(row.frame)),
    );
    expect(lines.length).toBeGreaterThan(5_000);
    expect(lines.every(numbersReadBack)).toBe(true);
    const bytes = lines.reduce((n, line) => n + Buffer.byteLength(line), 0);
    const detector = timed(lines, numbersReadBack);
    const parse = timed(lines, (line) => JSON.parse(line));
    report('lines', { lines: lines.length, bytes, meanBytes: Math.round(bytes / lines.length) });
    report('numbersReadBack', { msPerSet: +detector.toFixed(2), nsPerLine: Math.round((detector * 1e6) / lines.length), nsPerKiB: Math.round((detector * 1e6) / (bytes / 1024)) });
    report('JSON.parse, for scale', { msPerSet: +parse.toFixed(2), nsPerLine: Math.round((parse * 1e6) / lines.length), nsPerKiB: Math.round((parse * 1e6) / (bytes / 1024)) });
    const largest = lines.reduce((a, b) => (b.length > a.length ? b : a));
    const alone = timed([largest], numbersReadBack);
    report('the largest line alone', { bytes: Buffer.byteLength(largest), numbersReadBackMs: +alone.toFixed(3), parseMs: +timed([largest], (line) => JSON.parse(line)).toFixed(3) });
  });
});
