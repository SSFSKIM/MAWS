// The e2e's hold on a Tools choice's intent write (board ticket 854; docs/doperpowers/plans/2026-11-23-tool-choice.md,
// the fix wave). Under `MAWS_E2E=1` with `MAWS_E2E_INTENT_PATCH_HOLD` naming a file, a `session.intent.patch` that carries
// `mawsTools` waits, before the service reads it, until that file is gone (read every 100 ms, at most
// INTENT_PATCH_HOLD_MAX_MS): the choice is still being written when the scene presses Send (e2e/sessions.spec.ts), and
// the launch it then starts must carry it. Outside MAWS_E2E, or with no file named, there is no hold. The session
// service's handlers apply it (./service-register.ts).
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import type { SetupIntentPatch } from '@shared/sessions/intent';

export const INTENT_PATCH_HOLD_MAX_MS = 120_000;
const HOLD_POLL_MS = 100;

export interface IntentPatchHoldDeps {
  exists(path: string): boolean;
  sleep(ms: number): Promise<unknown>;
  now(): number;
}

const SYSTEM: IntentPatchHoldDeps = { exists: existsSync, sleep: (ms) => sleep(ms), now: () => Date.now() };

export function intentPatchHoldFor(env: NodeJS.ProcessEnv, deps: IntentPatchHoldDeps = SYSTEM): ((patch: SetupIntentPatch) => Promise<void>) | undefined {
  const hold = env.MAWS_E2E === '1' ? env.MAWS_E2E_INTENT_PATCH_HOLD : undefined;
  if (!hold) return undefined;
  return async (patch) => {
    if (patch.mawsTools === undefined) return;
    const until = deps.now() + INTENT_PATCH_HOLD_MAX_MS;
    while (deps.exists(hold) && deps.now() < until) await deps.sleep(HOLD_POLL_MS);
  };
}
