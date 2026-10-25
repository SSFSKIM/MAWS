// fixB (b)(c): the guard every e2e:discover step that reaches the login keychain runs under (e2e/support/keychain-guard.ts):
// a pending keychain prompt fails the step at once and stops what it started; an engine environment that would name
// another keychain item than its scratch configuration's is refused. A fake probe stands in for SecurityAgent.
import { describe, expect, it, vi } from 'vitest';
import { assertEngineKeychainEnv, assertNoKeychainPrompt, guardKeychain, securityAgentRunning, watchKeychainPrompt } from '../../e2e/support/keychain-guard';

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

describe('the engine’s keychain environment', () => {
  it('names the scratch store and nothing that would rename the engine’s items', () => {
    expect(() => assertEngineKeychainEnv({ CLAUDE_CONFIG_DIR: '/s/claude-config' }, '/s/claude-config', 'here')).not.toThrow();
    expect(() => assertEngineKeychainEnv({}, '/s/claude-config', 'here')).toThrow(/unset: the owner/);
    expect(() => assertEngineKeychainEnv({ CLAUDE_CONFIG_DIR: '/s/claude-config', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/x' }, '/s/claude-config', 'here')).toThrow(/CLAUDE_SECURESTORAGE_CONFIG_DIR/);
    expect(() => assertEngineKeychainEnv({ CLAUDE_CONFIG_DIR: '/s/claude-config', CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://x' }, '/s/claude-config', 'here')).toThrow(/CUSTOM_OAUTH_URL/);
  });
});
