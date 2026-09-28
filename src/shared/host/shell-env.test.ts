// carried by C9 until the rebase over C3 (wave-2 ledger d.12)
import { describe, expect, it } from 'vitest';
import { captureShellEnvironment, parseCapturedEnvironment, SHELL_ENV_MARKER } from './shell-env';

describe('login-shell environment capture (C9 stand-in for C3)', () => {
  it('parses NUL-separated pairs after the marker, ignoring what a chatty rc file printed before it', () => {
    const output = `Welcome!\nlast login\n${SHELL_ENV_MARKER}PATH=/usr/bin:/bin\0MULTI=line one\nline two\0EMPTY=\0EQ=a=b\0`;
    expect(parseCapturedEnvironment(output)).toEqual({ PATH: '/usr/bin:/bin', MULTI: 'line one\nline two', EMPTY: '', EQ: 'a=b' });
  });

  it('yields null when the marker never appeared or no pair followed it', () => {
    expect(parseCapturedEnvironment('PATH=/bin\0')).toBeNull();
    expect(parseCapturedEnvironment(`${SHELL_ENV_MARKER}`)).toBeNull();
  });

  it('captures a real shell environment, and null for a shell that cannot run', async () => {
    const env = await captureShellEnvironment({ shell: '/bin/sh', timeoutMs: 5_000 });
    expect(env?.PATH).toEqual(expect.any(String));
    await expect(captureShellEnvironment({ shell: '/nonexistent/shell', timeoutMs: 5_000 })).resolves.toBeNull();
  });
});
// carried by C9 until the rebase over C3 (wave-2 ledger d.12)
