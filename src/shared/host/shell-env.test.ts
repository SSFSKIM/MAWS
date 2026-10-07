import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureShellEnvironment, invalidateShellEnvironment, parseNulSeparatedEnv, runShellCapture, SHELL_CAPTURE_TIMEOUT_MS } from './shell-env';

let dir: string;
beforeEach(() => {
  vi.restoreAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'maws-shell-env-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// A stand-in for `$SHELL`, invoked as `<shell> -ilc 'env -0'`: it ignores the flags and runs the body.
function fakeShell(body: string): string {
  const path = join(dir, 'shell.sh');
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

// Real shells under a loaded full suite can take seconds to start: each capture gets the production 5 s timeout and each
// case room for two of them (M5 review).
describe('login-shell environment capture (X6)', { timeout: 15_000 }, () => {
  it('parses NUL-separated pairs so multi-line values and = in values survive', () => {
    const text = 'PATH=/a:/b\0MULTI=line one\nline two\0EQ=a=b=c\0\0EMPTY=\0';
    expect(parseNulSeparatedEnv(text)).toEqual({ PATH: '/a:/b', MULTI: 'line one\nline two', EQ: 'a=b=c', EMPTY: '' });
  });

  it('tolerates a chatty rc file by scanning for the first NUL-terminated pair', () => {
    const text = 'Welcome to the shell!\nfortune of the day\nPATH=/a\0HOME=/h\0';
    expect(parseNulSeparatedEnv(text)).toEqual({ PATH: '/a', HOME: '/h' });
  });

  it('runs the shell as a login shell with env -0 and returns its exports', async () => {
    const shell = fakeShell('echo "flags: $*" >&2; MAWS_CAPTURED=yes; export MAWS_CAPTURED; exec env -0');
    const env = await runShellCapture({ shell, timeoutMs: SHELL_CAPTURE_TIMEOUT_MS });
    expect(env.MAWS_CAPTURED).toBe('yes');
    expect(env.PATH).toEqual(expect.any(String));
  });

  it('passes -ilc and the env -0 command to the shell', async () => {
    const shell = fakeShell('printf "ARGS=%s\\0PATH=/x\\0" "$*"');
    const env = await runShellCapture({ shell, timeoutMs: SHELL_CAPTURE_TIMEOUT_MS });
    expect(env.ARGS).toBe('-ilc env -0');
  });

  it('falls back to the given environment with a warning when the shell hangs past the timeout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shell = fakeShell('sleep 30');
    const env = await captureShellEnvironment({ shell, timeoutMs: 100, fallback: { PATH: '/fallback', OTHER: 'x' }, cache: false });
    expect(env).toEqual({ PATH: '/fallback', OTHER: 'x' });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/shell environment capture failed/);
  });

  // Whole-branch review: an interactive zsh ignores SIGTERM and an rc file may read stdin; a capture that never settles
  // is memoised and hangs every later launch, in the engine host and C9's PTY host alike.
  it('falls back within the timeout when the shell ignores SIGTERM and a child keeps its output open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const started = Date.now();
    const env = await captureShellEnvironment({ shell: fakeShell("trap '' TERM; sleep 30"), timeoutMs: 500, fallback: { PATH: '/fallback' }, cache: false });
    expect(env).toEqual({ PATH: '/fallback' });
    expect(Date.now() - started).toBeLessThan(500 + 1_500);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/timed out after 500 ms/);
  });

  it('runs the shell with stdin closed: an rc file that reads stdin sees end of input instead of waiting forever', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const started = Date.now();
    const env = await captureShellEnvironment({ shell: fakeShell("trap '' TERM; read line && exec env -0"), timeoutMs: 2_000, fallback: { PATH: '/fallback' }, cache: false });
    expect(env).toEqual({ PATH: '/fallback' }); // the read failed at end of input, so the shell printed nothing
    expect(Date.now() - started).toBeLessThan(2_000 + 1_500);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('falls back when the shell prints no PATH', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = await captureShellEnvironment({ shell: fakeShell('printf "ONLY=x\\0"'), timeoutMs: SHELL_CAPTURE_TIMEOUT_MS, fallback: { PATH: '/fallback' }, cache: false });
    expect(env).toEqual({ PATH: '/fallback' });
    expect(warn.mock.calls[0]![0]).toMatch(/no PATH/);
  });

  it('falls back when the shell does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = await captureShellEnvironment({ shell: join(dir, 'missing'), timeoutMs: SHELL_CAPTURE_TIMEOUT_MS, fallback: { PATH: '/fallback' }, cache: false });
    expect(env).toEqual({ PATH: '/fallback' });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('captures once per host start: the default call is memoised', async () => {
    const shell = fakeShell('printf "MAWS_ONCE=%s\\0PATH=/x\\0" "$$"');
    const first = await captureShellEnvironment({ shell, timeoutMs: SHELL_CAPTURE_TIMEOUT_MS });
    const second = await captureShellEnvironment({ shell, timeoutMs: SHELL_CAPTURE_TIMEOUT_MS });
    expect(second).toBe(first);
    expect(first.MAWS_ONCE).toMatch(/^\d+$/);
    expect(SHELL_CAPTURE_TIMEOUT_MS).toBe(5_000);
  });

  // E10 (§Design 1 "Long-lived host hygiene"): a supervisor outlives the app, so a client's connect is when the owner is
  // back; the cached capture is dropped then and the next launch captures the shell again, once
  it('captures again, once, after the cache is invalidated', async () => {
    const shell = fakeShell('printf "MAWS_ONCE=%s\\0PATH=/x\\0" "$$"');
    invalidateShellEnvironment(); // whatever an earlier case cached
    const first = await captureShellEnvironment({ shell, timeoutMs: SHELL_CAPTURE_TIMEOUT_MS });
    invalidateShellEnvironment();
    const second = await captureShellEnvironment({ shell, timeoutMs: SHELL_CAPTURE_TIMEOUT_MS });
    const third = await captureShellEnvironment({ shell, timeoutMs: SHELL_CAPTURE_TIMEOUT_MS });
    expect(second).not.toBe(first);
    expect(second.MAWS_ONCE).not.toBe(first.MAWS_ONCE); // another shell ran
    expect(third).toBe(second);
  });
});
