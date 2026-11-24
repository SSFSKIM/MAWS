// The prestart regression bound (ticket 851, M5; docs/doperpowers/plans/2026-11-24-prestart-engine.md, D14 (a), A6): a
// New chat's first row, from Send to its paint, with the engine prestarted at the first keystroke and without. The engine
// is test/support/latency-engine-stub.mjs, which the engine host launches through MAWS_E2E_ENGINE_BIN, holding its
// initialize answer 2 s (MAWS_LATENCY_STUB_INIT_MS: the real engine's boot and SessionStart hooks run inside initialize,
// W1) and writing one line per process start (MAWS_LATENCY_STUB_STARTS_FILE), so starts are counted outside the journal.
//
// Five pairs of runs, flag-off and flag-on in alternating order (e2e/support/prestart-measure.ts): flag-off is this
// branch with MAWS_E2E_PRESTART unset, where Send takes today's path (the "before" arm, Decision Log 2), flag-on sets it.
// Each run types for 3 s from its first key press to Send, longer than the stub's 2 s boot. A run whose key-to-Send
// interval falls outside 3 s ± 100 ms is reported and not counted. The bound: flag-on's median Send-to-paint at least
// 1.5 s below flag-off's, evaluated on a valid measure alone: each flag-on run started exactly one engine, before its
// Send, the one Send adopted, and each flag-off run none before its Send and exactly one after (the starts file's wall
// clock against the instant Enter was pressed). Both medians and their difference go to the log as one line, to an
// annotation and to test-results/prestart-latency.json.
//
// A measured group (gate.yml's MEASURED_E2E): `pnpm e2e:prestart-latency` sets MAWS_PRESTART_LATENCY_PERF=1 and runs in
// the foreground, since the paint is read through a frame a window behind another never draws. It spends nothing: the
// stub makes no network call, and MAWS_E2E brings the mock keychain.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURE_ENGINE_VERSION } from '../test/support/engine-pin';
import { writeLatencyEngine } from '../test/support/latency-engine';
import { PRESTART_BENCH } from '../test/support/prestart-latency';
import { launchMaws } from './support/launch';
import { measurePrestart } from './support/prestart-measure';

test.skip(process.env.MAWS_PRESTART_LATENCY_PERF !== '1', 'the prestart regression bound runs under pnpm e2e:prestart-latency (MAWS_PRESTART_LATENCY_PERF=1)');
test.describe.configure({ timeout: 30 * 60_000 });

test('prestart latency: flag-on’s median Send to first row is at least 1.5 s below flag-off’s, one engine start per Send (D14 (a))', async () => {
  const { judged, failures } = await measurePrestart({
    group: 'prestart-latency',
    boundMs: PRESTART_BENCH.boundMs,
    counts: true,
    engine: { kind: 'latency stub', version: FIXTURE_ENGINE_VERSION, initMs: PRESTART_BENCH.initMs },
    launch: async (arm, root) => {
      const directory = join(root, 'repo');
      const userData = join(root, 'ud');
      mkdirSync(directory);
      mkdirSync(userData);
      const startsFile = join(root, 'starts.jsonl');
      const bin = writeLatencyEngine(join(root, 'latency-engine'), join(root, 'samples.jsonl'), { initMs: PRESTART_BENCH.initMs, startsFile });
      const maws = await launchMaws({
        userData,
        syntheticEngineBin: bin, // the test-owned stub: measured process evidence kept, never a real engine's logs
        defaultRoute: 'direct', // the stub's get_status answers a direct launch's
        env: { MAWS_HARNESS: '0', MAWS_E2E_QUIET: '1', MAWS_HOST_MODE: 'daemon', MAWS_E2E_ENGINE_BIN: bin, MAWS_E2E_PRESTART: arm === 'on' ? '1' : '' },
        // the folder trusted and the user's default mode `default`, so the New chat's start guards pass with no card and
        // the launch runs no trust bootstrap and no auto-mode fallback (as e2e/local-latency.spec.ts's)
        prepare: ({ claudeConfigDir }) => {
          writeFileSync(join(claudeConfigDir, '.claude.json'), `${JSON.stringify({ projects: { [directory]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
          writeFileSync(join(claudeConfigDir, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
        },
      });
      return { maws, directory, startsFile };
    },
  });
  expect(failures, 'every run reached its first row and the end of its turn').toEqual([]);
  expect(judged.reasons, 'the measure is valid').toEqual([]);
  expect(judged.gainMs, `flag-on's median Send to first row at least ${PRESTART_BENCH.boundMs} ms below flag-off's`).toBeGreaterThanOrEqual(PRESTART_BENCH.boundMs);
});
