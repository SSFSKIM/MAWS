// The hosted scenes' engine (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M2b; D28, D31): the stub engine of
// test/support/stub-engine.ts, a real process that plays a journal fixture over stdio by the replay transport's own
// rules, selected as the run's engine through MAWS_E2E_ENGINE_BIN, so each launch is a live lane B launch that runs
// under a real session host, where `replaySpec` spawns nothing. One stub per case's profile, written before the app that
// names it starts; each launch's journal is copied into the stub's fixture directory under the engine session id the
// launch pins (`--session-id`, or the `--resume` id), which the stub reads at its spawn. The pacing seam stays
// MAWS_E2E_REPLAY_ROW_MS's value, baked into the stub as `rowMs` (the launch's environment passes no `MAWS_*` key).
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import { launchDefaults } from '../../src/shared/composer/launch-defaults';
import { buildStubEngine, writeStubEngine as writeStubScript, type StubEngineOptions } from '../../test/support/stub-engine-bin';
import { invoke, value } from './c7-replay';
import { REPO_ROOT } from './launch';

export interface StubEngine {
  bin: string; // MAWS_E2E_ENGINE_BIN
  fixtures: string; // `<engine session id>.jsonl`, one per launch
}

// The stub's options a scene picks (test/support/stub-engine-bin.ts): the pace of its `in` rows, and P5 O16 M3c's
// directives, a `sleep` it parents (its pid a stderr line) and the frames it read (a stderr line at its exit)
export type StubSceneOptions = Pick<StubEngineOptions, 'rowMs' | 'spawnChild' | 'countStdin'>;

// The stub under `dir` (a case's scratch root, so the scratch's cleanup finds its processes by path).
export function writeStubEngine(dir: string, opts: StubSceneOptions = {}): StubEngine {
  const home = join(dir, 'stub-engine');
  const fixtures = join(home, 'fixtures');
  mkdirSync(fixtures, { recursive: true });
  const bundle = buildStubEngine(home);
  // a launch whose id names no journal plays none: the stub exits at once, naming the missing default
  const bin = writeStubScript(join(home, 'claude'), bundle, { ...opts, fixture: join(fixtures, 'unnamed-launch.jsonl'), fixtureDir: fixtures });
  return { bin, fixtures };
}

// A live launch's spec that plays `fixture` (a repository path or an absolute one) on the stub: the engine session id
// pinned (or the resumed one) and the journal copied under it; `direct`, since no relay serves the scenes.
export function stubSpec(stub: StubEngine, appSessionId: string, fixture: string, over: Partial<LaunchSpec> = {}): LaunchSpec {
  const resume = over.resume ?? null;
  const sessionId = resume === null ? (over.sessionId ?? randomUUID()) : null;
  copyFileSync(resolve(REPO_ROOT, fixture), join(stub.fixtures, `${resume === null ? sessionId : resume.sessionId}.jsonl`));
  return { ...launchDefaults(appSessionId as AppSessionId, '/tmp/maws-e2e-stub'), gateway: 'direct', ...over, appSessionId: appSessionId as AppSessionId, resume, sessionId: sessionId as LaunchSpec['sessionId'], replay: null };
}

// `launchReady`'s counterpart: launched on the stub, and ready.
export async function stubLaunchReady(page: Page, stub: StubEngine, appSessionId: string, fixture: string, over: Partial<LaunchSpec> = {}): Promise<void> {
  expect(value(await invoke(page, 'session.launch', { spec: stubSpec(stub, appSessionId, fixture, over) }))).toMatchObject({ status: 'launching' });
  await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId })).process, { timeout: 30_000 }).toBe('ready');
}
