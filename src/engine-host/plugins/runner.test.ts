// E8 M1: the runner spawns the engine's plugin CLI (here a fake binary written into a temp directory, whose behaviour
// each case writes) under the captured login-shell environment, serialises mutations, reports them as operations, and
// reloads ready sessions after a successful one. Timers that would take minutes are shortened through the timers seam.
import { spawn as nodeSpawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { validateEventPayload } from '@shared/ipc/validate';
import { READ_LINES } from '@shared/plugins/cli';
import type { BinaryCheck } from '../binary-info';
import type { ReloadTarget } from './reload-after';
import { CLI_TIMEOUT_MS, KILL_GRACE_MS, PluginsRunner, pluginsEnvironment, SETTLE_MS, type PluginsRunnerDeps } from './runner';

let root: string;
let fake: string; // the fake CLI's own directory: its behaviour, its call log, what it saw
let cwd: string;
let bin: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-plugins-runner-')));
  fake = join(root, 'fake');
  cwd = join(root, 'project');
  mkdirSync(fake);
  mkdirSync(cwd);
  bin = join(fake, 'claude');
  // Logs its argv (one call per line), its environment and its directory, then runs the case's behaviour.
  writeFileSync(bin, `#!/bin/sh\necho "$*" >> "${fake}/calls.log"\nenv > "${fake}/env.txt"\npwd -P > "${fake}/cwd.txt"\necho $$ > "${fake}/pid"\n. "${fake}/behaviour.sh"\n`);
  chmodSync(bin, 0o755);
  behave('');
});
let runner: PluginsRunner | null = null;
afterEach(async () => {
  await runner?.stop();
  runner = null;
  rmSync(root, { recursive: true, force: true });
});

const behave = (script: string) => writeFileSync(join(fake, 'behaviour.sh'), script);
const calls = () => (existsSync(join(fake, 'calls.log')) ? readFileSync(join(fake, 'calls.log'), 'utf8').trim().split('\n') : []);
const ok = (path: string): BinaryCheck => ({ path, testedVersion: '2.1.290', version: '2.1.290', ok: true, error: null });
const RESULT = (fields: Record<string, unknown>) => `echo '${JSON.stringify(fields)}'`;
const INSTALLED = RESULT({ command: 'install', outcome: 'ok', plugin: 'e8-probe@e8-scratch', pluginId: 'e8-probe@e8-scratch', scope: 'user', message: 'Successfully installed plugin: e8-probe@e8-scratch (scope: user)' });

// Seconds become milliseconds: the kill grace and the settle; the timeout case shortens the CLI's ceiling too.
const shortened = (short: Record<number, number>) => ({ setTimeout: (fn: () => void, ms: number) => setTimeout(fn, short[ms] ?? ms), clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout) });
const timers = shortened({ [KILL_GRACE_MS]: 100, [SETTLE_MS]: 5 });

function make(overrides: Partial<PluginsRunnerDeps> = {}) {
  const events: PluginsOperationEvent[] = [];
  let changed = 0;
  runner = new PluginsRunner({
    binary: async () => ok(bin),
    captureEnv: async () => ({ PATH: '/usr/bin:/bin', HOME: root, CLAUDE_CONFIG_DIR: join(root, 'config'), SSH_AUTH_SOCK: '/tmp/agent.sock', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SSE_PORT: '1234', ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'http://x', NODE_OPTIONS: '--inspect', TERM: 'xterm-256color' }),
    reloadTargets: () => [],
    emit: (event) => {
      const checked = validateEventPayload('plugins.operation', event);
      if (!checked.ok) throw new Error(`invalid plugins.operation: ${JSON.stringify(checked.issues)}`);
      events.push(event);
    },
    changed: () => void (changed += 1),
    timers,
    ...overrides,
  });
  const done = (opId: string) => until(() => events.find((e) => e.opId === opId && e.phase === 'done'), `${opId} done`);
  return { runner, events, changes: () => changed, done };
}

async function until<T>(check: () => T | undefined | false, what: string, ms = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('PluginsRunner mutations', () => {
  it('runs the exact argv in the operation’s directory and reports started, output, then the CLI’s result', async () => {
    behave(`echo "Cloning repository (timeout: 120s): https://example.com/m.git" >&2\n${INSTALLED}\n`);
    const { runner, events, done, changes } = make();
    const { opId } = await runner.start('install', { plugin: 'e8-probe@e8-scratch' }, cwd);
    const finished = await done(opId);
    expect(calls()).toEqual(['plugin install e8-probe@e8-scratch --json']);
    expect(readFileSync(join(fake, 'cwd.txt'), 'utf8').trim()).toBe(cwd);
    expect(events.filter((e) => e.opId === opId).map((e) => e.phase)).toEqual(['started', 'output', 'reloading', 'done']);
    expect(events.find((e) => e.phase === 'output')).toMatchObject({ action: 'install', target: 'e8-probe@e8-scratch', line: 'Cloning repository (timeout: 120s): https://example.com/m.git' });
    expect(finished.outcome).toEqual({ ok: true, result: expect.objectContaining({ command: 'install', outcome: 'ok', message: 'Successfully installed plugin: e8-probe@e8-scratch (scope: user)' }) });
    expect(finished.reload).toEqual({ sessions: [] }); // no session was ready
    expect(changes()).toBe(1);
  });

  it('runs under the whole captured environment less the nesting variables, with the updater off and a dumb terminal', async () => {
    behave(INSTALLED);
    const { runner, done } = make();
    await done((await runner.start('install', { plugin: 'p@m' }, cwd)).opId);
    const env = Object.fromEntries(readFileSync(join(fake, 'env.txt'), 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS']) expect(env[key], key).toBeUndefined();
    expect(env).toMatchObject({ CLAUDE_CONFIG_DIR: join(root, 'config'), SSH_AUTH_SOCK: '/tmp/agent.sock', DISABLE_AUTOUPDATER: '1', TERM: 'dumb', HOME: root });
    expect(pluginsEnvironment({ CLAUDECODE: '1', A: 'b' })).toEqual({ A: 'b', DISABLE_AUTOUPDATER: '1', TERM: 'dumb' });
  });

  it('serialises mutations: one started during another waits for it', async () => {
    behave(`if [ "$2" = "install" ]; then while [ ! -f "${fake}/go" ]; do sleep 0.02; done; ${INSTALLED}; else ${RESULT({ command: 'enable', outcome: 'ok', message: 'Successfully enabled plugin: p (scope: user)' })}; fi\n`);
    const { runner, done, events } = make();
    const first = await runner.start('install', { plugin: 'p@m' }, cwd);
    const second = await runner.start('enable', { plugin: 'p@m' }, cwd);
    await until(() => calls().length === 1, 'the first call');
    await new Promise((r) => setTimeout(r, 100));
    expect(calls()).toEqual(['plugin install p@m --json']); // the second waits
    expect(events.some((e) => e.opId === second.opId)).toBe(false);
    writeFileSync(join(fake, 'go'), '');
    await done(second.opId);
    expect(calls()).toEqual(['plugin install p@m --json', 'plugin enable p@m --json']);
    const order = events.map((e) => `${e.opId === first.opId ? 'first' : 'second'} ${e.phase}`);
    expect(order.indexOf('first done')).toBeLessThan(order.indexOf('second started'));
  });

  it('answers the receipt before any event of the operation', async () => {
    behave(INSTALLED);
    const { runner, events, done } = make();
    const receipt = runner.start('install', { plugin: 'p@m' }, cwd);
    const { opId } = await receipt;
    expect(events).toEqual([]);
    await done(opId);
  });

  it('surfaces a marketplace-declared command verbatim, and accepts it only through --accept-command, never -y', async () => {
    const shown = { sha256: 'e'.repeat(64), command: 'npx fetch-helper', kind: 'command-source' };
    behave(`case "$*" in *--accept-command*) ${INSTALLED};; *) ${RESULT({ command: 'install', outcome: 'failed', plugin: 'p@m', message: 'This plugin runs a command its marketplace declares', failureCode: 'command_source_refused', shownCommand: shown })}; exit 1;; esac\n`);
    const { runner, done } = make();
    const refused = await done((await runner.start('install', { plugin: 'p@m' }, cwd)).opId);
    expect(refused.outcome).toEqual({ ok: false, error: { code: 'cli_failed', message: 'This plugin runs a command its marketplace declares', failureCode: 'command_source_refused', shownCommand: shown } });
    expect(refused.reload).toBeUndefined();
    const accepted = await done((await runner.start('install', { plugin: 'p@m', acceptCommand: shown.sha256 }, cwd)).opId);
    expect(accepted.outcome).toMatchObject({ ok: true });
    expect(calls()).toEqual(['plugin install p@m --json', `plugin install p@m --accept-command ${shown.sha256} --json`]);
    for (const call of calls()) expect(call.split(' ')).not.toContain('-y');
  });

  it('maps the engine’s error, an argument error, a missing binary and a vanished directory', async () => {
    behave(`${RESULT({ command: 'install', outcome: 'failed', plugin: 'nope@e8-scratch', message: 'Plugin "nope" not found in marketplace "e8-scratch".', failureCode: 'not_found' })}\nexit 1\n`);
    const { runner, done, changes } = make();
    expect((await done((await runner.start('install', { plugin: 'nope@e8-scratch' }, cwd)).opId)).outcome).toEqual({ ok: false, error: { code: 'cli_failed', message: 'Plugin "nope" not found in marketplace "e8-scratch".', failureCode: 'not_found', shownCommand: null } });
    expect(changes()).toBe(1); // a failed mutation may still have refreshed a catalogue: the widget rereads
    behave(`echo "error: unknown option '--bogus'" >&2\nexit 1\n`);
    expect((await done((await runner.start('disable', { plugin: 'p@m' }, cwd)).opId)).outcome).toEqual({ ok: false, error: { code: 'no_result', message: "error: unknown option '--bogus'", failureCode: null, shownCommand: null } });

    const missing = make({ binary: async () => ({ path: join(root, 'nowhere/claude'), testedVersion: '2.1.290', version: null, ok: false, error: 'Claude Code is not installed' }) });
    expect((await missing.done((await missing.runner.start('enable', { plugin: 'p@m' }, cwd)).opId)).outcome).toEqual({ ok: false, error: { code: 'spawn_failed', message: 'Claude Code is not installed', failureCode: null, shownCommand: null } });
    const gone = make({ binary: async () => ok(join(root, 'gone')) });
    expect((await gone.done((await gone.runner.start('enable', { plugin: 'p@m' }, cwd)).opId)).outcome).toMatchObject({ ok: false, error: { code: 'spawn_failed', message: expect.stringContaining('ENOENT') } });
    const nodir = make();
    expect((await nodir.done((await nodir.runner.start('enable', { plugin: 'p@m' }, join(root, 'no-such-dir'))).opId)).outcome).toMatchObject({ ok: false, error: { code: 'spawn_failed', message: `no directory at ${join(root, 'no-such-dir')}` } });
  });

  it('cancel kills the running CLI and completes it cancelled; a queued one completes cancelled without running', async () => {
    behave('sleep 30\n');
    const { runner, done, events } = make();
    const running = await runner.start('marketplace-add', { source: 'owner/repo' }, cwd);
    const queued = await runner.start('marketplace-update', { name: 'm' }, cwd);
    await until(() => existsSync(join(fake, 'pid')) && readFileSync(join(fake, 'pid'), 'utf8').trim(), 'the pid');
    const pid = Number(readFileSync(join(fake, 'pid'), 'utf8'));
    expect(runner.cancel(queued.opId)).toBe(true);
    expect((await done(queued.opId)).outcome).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(events.filter((e) => e.opId === queued.opId).map((e) => e.phase)).toEqual(['done']);
    expect(runner.cancel(running.opId)).toBe(true);
    expect((await done(running.opId)).outcome).toMatchObject({ ok: false, error: { code: 'cancelled', failureCode: null } });
    expect(alive(pid)).toBe(false);
    expect(calls()).toEqual(['plugin marketplace add owner/repo --json']);
    expect(runner.cancel(running.opId)).toBe(false);
    expect(runner.cancel('nobody')).toBe(false);
  });

  it('kills a CLI still running at the ceiling, with SIGKILL when SIGTERM is ignored, and completes it timeout', async () => {
    behave(`trap '' TERM\nsleep 30\n`);
    const { runner, done } = make({ timers: shortened({ [CLI_TIMEOUT_MS]: 2_000, [KILL_GRACE_MS]: 100 }) });
    const { opId } = await runner.start('marketplace-add', { source: 'https://example.com/m.git' }, cwd);
    await until(() => existsSync(join(fake, 'pid')) && readFileSync(join(fake, 'pid'), 'utf8').trim(), 'the pid');
    const pid = Number(readFileSync(join(fake, 'pid'), 'utf8'));
    expect((await done(opId)).outcome).toMatchObject({ ok: false, error: { code: 'timeout', failureCode: null } });
    expect(alive(pid)).toBe(false);
  });

  it('marketplace add reloads nothing; the other successful mutations reload after the settle', async () => {
    behave(RESULT({ command: 'marketplace-add', outcome: 'ok', marketplace: 'e8-scratch', message: 'Successfully added marketplace: e8-scratch (declared in user settings)' }));
    const reloads: string[] = [];
    const target: ReloadTarget = { id: 'a' as AppSessionId, directory: cwd, reload: async () => (reloads.push('a'), { commands: [], agents: [], plugins: [{ name: 'e8-probe' }], error_count: 0 }) };
    const { runner, done, events } = make({ reloadTargets: () => [target] });
    const added = await done((await runner.start('marketplace-add', { source: '/m' }, cwd)).opId);
    expect(added.reload).toBeUndefined();
    expect(events.filter((e) => e.opId === added.opId).map((e) => e.phase)).toEqual(['started', 'done']);
    expect(reloads).toEqual([]);
    behave(INSTALLED);
    const installed = await done((await runner.start('install', { plugin: 'e8-probe@e8-scratch' }, cwd)).opId);
    expect(installed.reload).toEqual({ sessions: [{ appSessionId: 'a', outcome: 'reflected', error: null }] });
    expect(reloads).toEqual(['a']);
  });

  it('stop resolves once every child is gone, a TERM-ignoring one through SIGKILL, and closes admission', async () => {
    behave(`trap '' TERM\nsleep 30\n`);
    const { runner, done } = make();
    const { opId } = await runner.start('install', { plugin: 'p@m' }, cwd);
    await until(() => existsSync(join(fake, 'pid')) && readFileSync(join(fake, 'pid'), 'utf8').trim(), 'the pid');
    const pid = Number(readFileSync(join(fake, 'pid'), 'utf8'));
    await runner.stop();
    expect(alive(pid)).toBe(false); // dead when stop resolves, not later
    expect((await done(opId)).outcome).toMatchObject({ ok: false, error: { code: 'cancelled', message: 'stopped with the engine host' } });
    await expect(runner.start('install', { plugin: 'p@m' }, cwd)).rejects.toThrow(/stopping/);
    await expect(runner.read(READ_LINES.installed, cwd)).rejects.toThrow('stopped with the engine host');
  });

  it('a cancel while the binary is still being resolved completes cancelled and never spawns', async () => {
    let release!: (check: BinaryCheck) => void;
    const spawn = vi.fn(nodeSpawn);
    const { runner, done, events } = make({ binary: () => new Promise<BinaryCheck>((r) => (release = r)), spawn: spawn as unknown as typeof nodeSpawn });
    const { opId } = await runner.start('install', { plugin: 'p@m' }, cwd);
    await until(() => events.some((e) => e.opId === opId && e.phase === 'started'), 'started');
    expect(runner.cancel(opId)).toBe(true);
    release(ok(bin));
    expect((await done(opId)).outcome).toMatchObject({ ok: false, error: { code: 'cancelled', message: 'cancelled before the CLI finished' } });
    expect(spawn).not.toHaveBeenCalled();
    expect(calls()).toEqual([]);
  });

  it('a stop while the environment is still being captured never spawns', async () => {
    let release!: (env: Record<string, string>) => void;
    const spawn = vi.fn(nodeSpawn);
    const { runner, done, events } = make({ captureEnv: () => new Promise((r) => (release = r)), spawn: spawn as unknown as typeof nodeSpawn });
    const { opId } = await runner.start('install', { plugin: 'p@m' }, cwd);
    await until(() => events.some((e) => e.opId === opId && e.phase === 'started'), 'started');
    await runner.stop();
    release({ PATH: '/usr/bin:/bin' });
    expect((await done(opId)).outcome).toMatchObject({ ok: false, error: { code: 'cancelled', message: 'stopped with the engine host' } });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('a cancel kills a TERM-ignoring helper the CLI started with its output redirected, after the CLI itself exited', async () => {
    behave(`(trap '' TERM; exec sleep 30) >/dev/null 2>&1 </dev/null &\necho $! > "${fake}/helper"\nsleep 30\n`);
    const { runner, done } = make();
    const { opId } = await runner.start('marketplace-add', { source: 'owner/repo' }, cwd);
    await until(() => existsSync(join(fake, 'helper')) && readFileSync(join(fake, 'helper'), 'utf8').trim(), 'the helper pid');
    const helper = Number(readFileSync(join(fake, 'helper'), 'utf8'));
    expect(alive(helper)).toBe(true);
    expect(runner.cancel(opId)).toBe(true);
    expect((await done(opId)).outcome).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(alive(helper)).toBe(false);
  });

  it('decodes UTF-8 split across output chunks', async () => {
    // U+2026 (E2 80 A6) written in two parts with a pause between them, on stderr (an output line) and stdout (the result)
    behave(`printf 'Cloning \\342\\200' >&2; sleep 0.2; printf '\\246\\n' >&2\nprintf '{"command":"install","outcome":"ok","message":"done \\342\\200'; sleep 0.2; printf '\\246"}\\n'\n`);
    const { runner, done, events } = make();
    const { opId } = await runner.start('install', { plugin: 'p@m' }, cwd);
    const finished = await done(opId);
    expect(events.find((e) => e.opId === opId && e.phase === 'output')?.line).toBe('Cloning \u2026');
    expect(finished.outcome).toMatchObject({ ok: true, result: { message: 'done \u2026' } });
  });
});

describe('PluginsRunner reads', () => {
  it('runs a read freely, beside a running mutation, and answers its whole output', async () => {
    behave(`if [ "$2" = "install" ]; then sleep 30; else printf '[\\n  {"id": "p@m"}\\n]\\n'; fi\n`);
    const { runner } = make();
    await runner.start('install', { plugin: 'p@m' }, cwd);
    await until(() => calls().length === 1, 'the mutation');
    expect(await runner.read(READ_LINES.installed, cwd)).toEqual({ stdout: '[\n  {"id": "p@m"}\n]\n', stderr: '', code: 0 });
    expect(calls()).toEqual(['plugin install p@m --json', 'plugin list --json']);
  });

  it('rejects a read whose CLI could not run', async () => {
    const { runner } = make({ binary: async () => ({ path: '', testedVersion: '2.1.290', version: null, ok: false, error: 'Claude Code is not installed' }) });
    await expect(runner.read(READ_LINES.marketplaces, cwd)).rejects.toThrow('Claude Code is not installed');
  });
});
