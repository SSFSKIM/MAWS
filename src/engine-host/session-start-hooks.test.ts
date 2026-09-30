import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_START_HOOK_MS, sessionStartHookMs } from './session-start-hooks';

const sessionStart = (...timeouts: (number | undefined)[]) => ({
  hooks: { SessionStart: [{ matcher: 'startup', hooks: timeouts.map((timeout) => ({ type: 'command', command: 'true', ...(timeout === undefined ? {} : { timeout }) })) }] },
});

describe('the SessionStart hook bound a launch runs with', () => {
  let base: string;
  let home: string;
  let project: string;
  const write = (file: string, content: unknown) => {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  };
  const plan = (over: { env?: Record<string, string>; flagSettings?: Record<string, unknown> } = {}) => ({ env: over.env ?? { HOME: home }, cwd: project, flagSettings: over.flagSettings ?? {} });
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'maws-hook-bound-'));
    home = join(base, 'home');
    project = join(base, 'project');
    mkdirSync(project, { recursive: true });
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('is the engine\'s 600 s when no settings file sets a SessionStart timeout, or one is missing or malformed', async () => {
    expect(await sessionStartHookMs(plan())).toBe(SESSION_START_HOOK_MS);
    write(join(home, '.claude', 'settings.json'), '{ not json');
    write(join(project, '.claude', 'settings.json'), sessionStart(undefined));
    write(join(project, '.claude', 'settings.local.json'), { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'x', timeout: 5000 }] }] } }); // another event's
    expect(await sessionStartHookMs(plan())).toBe(SESSION_START_HOOK_MS);
  });

  it('is the largest SessionStart timeout, in seconds, across the user, project, local and flag settings', async () => {
    write(join(home, '.claude', 'settings.json'), sessionStart(700));
    expect(await sessionStartHookMs(plan())).toBe(700_000);
    write(join(project, '.claude', 'settings.json'), sessionStart(30, 900));
    expect(await sessionStartHookMs(plan())).toBe(900_000);
    write(join(project, '.claude', 'settings.local.json'), sessionStart(1200));
    expect(await sessionStartHookMs(plan())).toBe(1_200_000);
    expect(await sessionStartHookMs(plan({ flagSettings: sessionStart(1500) }))).toBe(1_500_000);
  });

  it('reads the user settings under CLAUDE_CONFIG_DIR when the launch sets it, not HOME\'s', async () => {
    write(join(home, '.claude', 'settings.json'), sessionStart(700));
    write(join(base, 'scratch', 'settings.json'), sessionStart(800));
    expect(await sessionStartHookMs(plan({ env: { HOME: home, CLAUDE_CONFIG_DIR: join(base, 'scratch') } }))).toBe(800_000);
  });

  it('never holds less than 600 s (a hook from a source not read keeps the engine\'s default), nor past what a timer can hold', async () => {
    write(join(project, '.claude', 'settings.json'), sessionStart(60));
    expect(await sessionStartHookMs(plan())).toBe(SESSION_START_HOOK_MS);
    write(join(project, '.claude', 'settings.json'), sessionStart(1e9));
    expect(await sessionStartHookMs(plan())).toBeLessThan(2 ** 31 - 1 - 120_000);
  });
});
