// The prestart acceptance on the pinned engine (ticket 851, M5; docs/doperpowers/plans/2026-11-24-prestart-engine.md,
// D14 (b), A6): the same paired runs as e2e/prestart-latency.spec.ts, on the unmodified engine the Discover group runs
// (e2e/support/real-engine.ts: MAWS_E2E_ENGINE_BIN, which scripts/provision-engine.sh exports in the gate, else the
// installed 2.1.309; its path and version recorded), with what a person's engine does at its start: a scratch user
// configuration holding three SessionStart hooks of 200 ms each, which run inside initialize (W1), each writing its own
// marker in the run's scratch once its sleep has ended, so a run whose hooks did not all run fails. It spends nothing:
// the Messages API is the loopback stand-in (e2e/support/model-stub.ts) on the gateway route through MAWS_RELAY_URL,
// which answers the relay's health check (GET /api/hello) with 200, and the turn's request with a reply carrying a
// marker the page looks for.
//
// Reported, with no bound: both medians of Send to first row and their difference (the log's line, an annotation and
// test-results/prestart-engine.json). The live model's own time to message_start (0.6 to 1.4 s on 2026-11-23) is the
// same in both arms and is not in these numbers; it is recorded beside them as that estimate. Asserted: every run
// reached its first row and the end of its turn with its three hooks run, the measure is valid (enough runs counted in
// each arm), and every flag-on Send took the prestarted engine.
//
// A measured group (gate.yml's MEASURED_E2E): `pnpm e2e:prestart-engine` sets MAWS_PRESTART_ENGINE_PERF=1 and runs in
// the foreground; the gate provisions the engine for it as for e2e:discover.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { launchMaws } from './support/launch';
import { startModelStub, type ModelStub } from './support/model-stub';
import { measurePrestart } from './support/prestart-measure';
import { markerHookCommand } from '../test/support/prestart-latency';
import { realEngine } from './support/real-engine';

test.skip(process.env.MAWS_PRESTART_ENGINE_PERF !== '1', 'the prestart acceptance runs under pnpm e2e:prestart-engine (MAWS_PRESTART_ENGINE_PERF=1)');
test.describe.configure({ timeout: 40 * 60_000 });

// Three SessionStart hooks of 200 ms each under `dir`, each writing its own marker once its sleep ended (a hook that
// failed or never ran writes none); their commands differ, so the engine runs each (it runs one copy of a repeated one)
const HOOK_NUMBERS = [1, 2, 3];
const hookMarker = (dir: string, n: number) => join(dir, `session-start-hook-${n}.done`);
const hooksIn = (dir: string) => HOOK_NUMBERS.map((n) => ({ type: 'command', command: markerHookCommand(hookMarker(dir, n)) }));
const REPLY = '⟦t1:1⟧ The prestart acceptance reply.'; // a marker of test/support/latency-engine.ts's pattern, which the page finds
const MESSAGE_START_ESTIMATE_MS = [600, 1_400]; // the live model's own time to message_start, measured 2026-11-23

test('prestart acceptance: Send to first row on the pinned engine with three 200 ms SessionStart hooks, flag off and on, reported (D14 (b))', async () => {
  const engine = realEngine();
  let stub: ModelStub | null = null;
  try {
    stub = await startModelStub(REPLY, { sideText: 'Prestart acceptance' });
    const relay = stub.url;
    const { judged, failures } = await measurePrestart({
      group: 'prestart-engine',
      boundMs: null,
      counts: false,
      engine: { kind: 'pinned engine', bin: engine.bin.replace(homedir(), '~'), version: engine.version, sessionStartHooks: hooksIn('<scratch>/hooks'), api: 'the loopback Messages stand-in on the gateway route', liveModelMessageStartEstimateMs: MESSAGE_START_ESTIMATE_MS },
      launch: async (arm, root) => {
        const userData = join(root, 'ud'); // a given profile must exist (launch.ts makes its engine store inside it)
        const hooks = join(root, 'hooks');
        mkdirSync(userData);
        mkdirSync(hooks);
        const maws = await launchMaws({
          userData,
          realEngine: { projects: 1 },
          defaultRoute: 'gateway',
          env: { MAWS_RELAY_URL: relay, MAWS_E2E_PRESTART: arm === 'on' ? '1' : '' },
          // the user configuration's hooks, and its default mode `default` (no auto-mode fallback); the scratch's
          // `.claude.json` already trusts the project
          prepare: ({ claudeConfigDir }) => {
            writeFileSync(join(claudeConfigDir, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' }, hooks: { SessionStart: [{ hooks: hooksIn(hooks) }] } }, null, 2)}\n`);
          },
        });
        const verify = () => {
          const missing = HOOK_NUMBERS.filter((n) => !existsSync(hookMarker(hooks, n)));
          if (missing.length > 0) throw new Error(`flag-${arm}: SessionStart hook ${missing.join(', ')} of 3 did not complete, so the start measured is not the one with three hooks`);
        };
        return { maws, directory: maws.realEngine!.scratch.projects[0]!, startsFile: null, verify };
      },
    });
    console.log(`prestart-engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}); the live model's own message_start, ${MESSAGE_START_ESTIMATE_MS.join(' to ')} ms, is the same in both arms and not in these numbers`);
    expect(failures, 'every run reached its first row and the end of its turn, its three hooks run').toEqual([]);
    expect(judged.reasons, 'the measure is valid, and every flag-on Send took the prestarted engine').toEqual([]);
  } finally {
    await stub?.close();
  }
});
