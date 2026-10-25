// fixB (b)(c): the guard every e2e:discover step that reaches the login keychain runs under (e2e/support/keychain-guard.ts):
// a pending keychain prompt fails the step at once and stops what it started; an engine environment that would name
// another keychain item than its scratch configuration's is refused. A fake probe stands in for SecurityAgent.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertEngineKeychainEnv, assertNoKeychainPrompt, guardKeychain, killTree, loginShellEnvironment, securityAgentRunning, watchKeychainPrompt } from '../../e2e/support/keychain-guard';

const never = () => new Promise<never>(() => {});

describe('the keychain prompt guard', () => {
  it('runs a step with no prompt pending and answers its value', async () => {
    await expect(guardKeychain('a step', async () => 7, { probe: () => false, pollMs: 5 })).resolves.toBe(7);
  });

  it('refuses to start a step while a prompt is pending', async () => {
    const step = vi.fn(async () => 1);
    await expect(guardKeychain('the claim', step, { probe: () => true })).rejects.toThrow(/pending before the claim/);
    expect(step).not.toHaveBeenCalled();
  });

  it('fails a step at once when a prompt appears during it, after stopping what it started', async () => {
    let pending = false;
    const onPrompt = vi.fn();
    const started = Date.now();
    const guarded = guardKeychain('the sign-in', never, { probe: () => pending, pollMs: 5, onPrompt });
    setTimeout(() => (pending = true), 20);
    await expect(guarded).rejects.toThrow(/appeared during the sign-in/);
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(2_000); // not the step's own bound
  });

  it('fails a step that left a prompt behind', async () => {
    let pending = false;
    await expect(guardKeychain('the release', async () => void (pending = true), { probe: () => pending, pollMs: 1_000 })).rejects.toThrow(/pending after the release/);
  });

  it('fails closed when it cannot tell', async () => {
    const unknown = () => {
      throw new Error('pgrep failed');
    };
    expect(() => assertNoKeychainPrompt('here', unknown)).toThrow(/pgrep failed/);
    expect(typeof securityAgentRunning()).toBe('boolean'); // the real probe answers on this machine without a prompt
  });

  it('stops the step when the probe cannot tell during it, then fails (fix-D#2)', async () => {
    let calls = 0;
    const probe = () => {
      if (++calls === 1) return false; // the check before the step answers
      throw new Error('pgrep timed out');
    };
    const onPrompt = vi.fn();
    await expect(guardKeychain('the sign-in', never, { probe, pollMs: 5, onPrompt })).rejects.toThrow(/pgrep timed out/);
    expect(onPrompt).toHaveBeenCalledTimes(1); // nothing keeps running unmonitored
  });
});

describe('the app’s keychain watch', () => {
  it('stops the app at once on a prompt and answers the failure', async () => {
    let pending = false;
    const kill = vi.fn();
    const watch = watchKeychainPrompt(kill, { probe: () => pending, pollMs: 5 });
    await new Promise((r) => setTimeout(r, 20));
    expect(kill).not.toHaveBeenCalled();
    pending = true;
    await vi.waitFor(() => expect(kill).toHaveBeenCalledTimes(1));
    expect(watch.stop()?.message).toMatch(/appeared while the app ran/);
  });

  it('answers nothing when no prompt came', () => {
    expect(watchKeychainPrompt(() => {}, { probe: () => false }).stop()).toBeNull();
  });
});

describe('stopping what could have raised a prompt', () => {
  it('kills a process and its descendants, so a dialog’s requester does not outlive it', async () => {
    const parent = spawn('/bin/sh', ['-c', 'sleep 30 & echo $!; wait'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const grandchild = Number(await new Promise<string>((done) => parent.stdout.once('data', (d: Buffer) => done(d.toString().trim()))));
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive(grandchild)).toBe(true);
    killTree(parent.pid!);
    await vi.waitFor(() => expect(alive(grandchild)).toBe(false));
  });
});

describe('the engine’s keychain environment', () => {
  it('names the scratch store and nothing that would rename the engine’s items', () => {
    expect(() => assertEngineKeychainEnv({ CLAUDE_CONFIG_DIR: '/s/claude-config' }, '/s/claude-config', 'here')).not.toThrow();
    expect(() => assertEngineKeychainEnv({}, '/s/claude-config', 'here')).toThrow(/unset: the owner/);
    expect(() => assertEngineKeychainEnv({ CLAUDE_CONFIG_DIR: '/s/claude-config', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/x' }, '/s/claude-config', 'here')).toThrow(/CLAUDE_SECURESTORAGE_CONFIG_DIR/);
    expect(() => assertEngineKeychainEnv({ CLAUDE_CONFIG_DIR: '/s/claude-config', CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://x' }, '/s/claude-config', 'here')).toThrow(/CUSTOM_OAUTH_URL/);
  });
});

// fix-D#1: the engine host builds the engine's environment from the login shell's capture alone (src/shared/host/shell-env.ts,
// src/engine-host/launch.ts), so what the guard checks is that capture, read and fallen back on as the host does. Each
// fake `$SHELL` below is a script run as `<shell> -ilc 'env -0'`.
describe('the login shell environment the host captures', () => {
  let dir: string;
  const shell = (name: string, body: string) => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  const app = (SHELL: string) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', SHELL, CLAUDE_CONFIG_DIR: '/s/claude-config' });
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'maws-login-shell-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('refuses when the startup files unset the scratch CLAUDE_CONFIG_DIR, which the engine would then run without', () => {
    const env = app(shell('unsets', 'unset CLAUDE_CONFIG_DIR\nexec env -0'));
    const captured = loginShellEnvironment(env);
    expect(captured.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(() => assertEngineKeychainEnv(captured, '/s/claude-config', 'here')).toThrow(/unset: the owner/);
  });

  it('refuses when the startup files point CLAUDE_CONFIG_DIR elsewhere', () => {
    const env = app(shell('repoints', 'CLAUDE_CONFIG_DIR=/Users/owner/.claude; export CLAUDE_CONFIG_DIR\nexec env -0'));
    expect(() => assertEngineKeychainEnv(loginShellEnvironment(env), '/s/claude-config', 'here')).toThrow(/CLAUDE_CONFIG_DIR=\/Users\/owner\/.claude/);
  });

  it('reads the capture as the host does: rc noise before the first pair is skipped', () => {
    const env = app(shell('chatty', "printf 'welcome\\n'\nexec env -0"));
    const captured = loginShellEnvironment(env);
    expect(captured.CLAUDE_CONFIG_DIR).toBe('/s/claude-config');
    expect(Object.keys(captured).some((key) => key.includes('welcome'))).toBe(false);
  });

  it('falls back to the app environment, as the host does, when the capture fails or names no PATH', () => {
    const exits = app(shell('exits', 'exit 3'));
    expect(loginShellEnvironment(exits)).toEqual(exits);
    const noPath = app(shell('no-path', 'exec env -i CLAUDE_CONFIG_DIR=/elsewhere /usr/bin/env -0'));
    expect(loginShellEnvironment(noPath)).toEqual(noPath);
  });
});
