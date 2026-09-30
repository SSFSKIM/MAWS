// How long a SessionStart hook may hold `initialize`'s answer (debt wave 5, widened in debt wave 6). 2.1.283 runs
// SessionStart hooks before it reads `initialize` and bounds each by 600 s (`La`) unless the hook sets its own `timeout`
// (seconds; SPEC 27 §5.3), so while a hook it reported started has not reported back the host holds the deadline at
// the largest `timeout` the launch's settings give a SessionStart hook, never below 600 s: the settings MAWS launches
// with (`--setting-sources user,project,local`, then the `--settings` JSON), read as the engine resolves them for the
// plan's environment and working directory. Managed settings, plugin hooks and a local settings file at a git root
// above the working directory are not read; a hook from those runs under the 600 s floor.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaunchPlan } from './launch';

export const SESSION_START_HOOK_MS = 600_000;
// A timer longer than 2^31 - 1 ms fires at once in Node; a configured timeout is held no longer than this.
const MAX_HOLD_MS = 2_147_483_647 - 600_000;

export async function sessionStartHookMs(plan: Pick<LaunchPlan, 'env' | 'cwd' | 'flagSettings'>): Promise<number> {
  const configDir = plan.env.CLAUDE_CONFIG_DIR || (plan.env.HOME ? join(plan.env.HOME, '.claude') : null);
  const files = [...(configDir === null ? [] : [join(configDir, 'settings.json')]), join(plan.cwd, '.claude', 'settings.json'), join(plan.cwd, '.claude', 'settings.local.json')];
  const sources = [...(await Promise.all(files.map(readSettings))), plan.flagSettings];
  let longest = SESSION_START_HOOK_MS;
  for (const seconds of sources.flatMap(sessionStartTimeouts)) longest = Math.max(longest, seconds * 1000);
  return Math.min(longest, MAX_HOLD_MS);
}

// `hooks.SessionStart`: matchers, each with its `hooks` list; the positive `timeout`s among them, in seconds.
function sessionStartTimeouts(settings: unknown): number[] {
  const matchers = (settings as { hooks?: { SessionStart?: unknown } } | null)?.hooks?.SessionStart;
  if (!Array.isArray(matchers)) return [];
  return matchers.flatMap((matcher) => {
    const hooks = (matcher as { hooks?: unknown } | null)?.hooks;
    if (!Array.isArray(hooks)) return [];
    return hooks.flatMap((hook) => {
      const timeout = (hook as { timeout?: unknown } | null)?.timeout;
      return typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0 ? [timeout] : [];
    });
  });
}

// A missing, unreadable or malformed file configures nothing.
async function readSettings(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}
