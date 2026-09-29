import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureShellEnvironment, parseNulSeparatedEnv, runShellCapture, SHELL_CAPTURE_TIMEOUT_MS } from './shell-env';

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
});
