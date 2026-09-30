// C12 M5 (docs/doperpowers/plans/2026-09-29-c12-finish.md, M5 task 2, Concrete Steps "M5 probe"): does the owner's login
// shell set the launch-environment variables X6 decides on? The capture X6 builds every engine environment from
// (`captureShellEnvironment`, C3's src/shared/host/shell-env.ts) runs from an environment like the one a Dock-launched
// app inherits (launchd's few keys), so this shell's own exports (a Claude session's included) do not leak into the
// answer, and only whether each variable is set is printed, never a value. It reads the process environment the owner's
// dotfiles produce, never ~/.claude. Runs only under the live project: `MAWS_LIVE=1 pnpm exec vitest run --project live
// test/live/launch-env.live.test.ts`.
import { afterAll, expect, it } from 'vitest';
import { captureShellEnvironment } from '@shared/host/shell-env';

const VARIABLES = ['CLAUDE_CODE_FORK_SUBAGENT', 'CLAUDE_CODE_ENABLE_TODO_TOOLS', 'CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS'] as const;
const LAUNCHD_KEYS = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR'] as const;

const saved = { ...process.env };
afterAll(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
});

it("reports whether the owner's login shell sets each launch-environment variable", async () => {
  const inherited = Object.fromEntries(VARIABLES.map((key) => [key, key in saved]));
  for (const key of Object.keys(process.env)) if (!(LAUNCHD_KEYS as readonly string[]).includes(key)) delete process.env[key];
  process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  const captured = await captureShellEnvironment({ cache: false, fallback: {} });
  expect(captured.PATH, 'the capture succeeded (a failure falls back to an empty environment here)').toBeDefined();
  const setByShell = Object.fromEntries(VARIABLES.map((key) => [key, key in captured]));
  console.log(JSON.stringify({ shell: saved.SHELL ?? '/bin/zsh', setByLoginShell: setByShell, setInThisProcess: inherited }));
});
