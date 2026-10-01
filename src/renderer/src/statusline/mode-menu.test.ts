import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record, status } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { autoUnavailableReason, liveModeBinding, MODE_OPTIONS, MODE_REFUSAL_WORDS, nextMode } from './mode-menu';

const models = [
  { value: 'opus', resolvedModel: 'claude-opus', displayName: 'Opus', description: '', supportsAutoMode: true },
  { value: 'haiku', resolvedModel: 'claude-haiku', displayName: 'Haiku', description: '', supportsAutoMode: false },
];

describe('mode menu', () => {
  it('lists default, acceptEdits, plan, auto and bypassPermissions, the last behind a confirm', () => {
    expect(MODE_OPTIONS.map((o) => o.mode)).toEqual(['auto', 'bypassPermissions', 'default', 'acceptEdits', 'plan'] /* W3: auto and bypass first */);
    expect(MODE_OPTIONS.filter((o) => o.confirm).map((o) => o.mode)).toEqual(['bypassPermissions']);
    expect(MODE_REFUSAL_WORDS.auto_mode_model).toBe('This model does not support auto mode');
  });

  it('cycles default → acceptEdits → plan → auto → default, skipping auto when it is unavailable', () => {
    expect(nextMode('default', true)).toBe('acceptEdits');
    expect(nextMode('plan', true)).toBe('auto');
    expect(nextMode('auto', true)).toBe('default');
    expect(nextMode('plan', false)).toBe('default');
    expect(nextMode('bypassPermissions', true)).toBe('default');
    expect(nextMode(null, true)).toBe('default');
  });

  it('auto is unavailable when listModels marks the current model supportsAutoMode false', () => {
    const base = status('a');
    const onHaiku = { ...base, model: { requested: 'haiku', resolved: 'claude-haiku' } };
    expect(autoUnavailableReason(models, onHaiku.model)).toBe('This model does not support auto mode');
    expect(autoUnavailableReason(models, base.model)).toBeNull(); // claude-opus
    expect(autoUnavailableReason(null, onHaiku.model)).toBeNull(); // not known yet: offered, the engine refuses in words
    // Haiku asked for, the init frame still naming Opus: the engine already runs Haiku, so auto is unavailable
    expect(autoUnavailableReason(models, { requested: 'haiku', resolved: 'claude-opus' })).toBe('This model does not support auto mode');
    expect(autoUnavailableReason(models, { requested: 'opus', resolved: 'claude-haiku' })).toBeNull();
  });

  it('the live binding shows the effective mode and sets through session.setPermissionMode, answering the refusal in words', async () => {
    // as C3's host answers a refusal (engine-host/ipc.ts): the code and the control error's message together
    const fake = fakeClient({ 'session.setPermissionMode': { effective: 'default', refusal: 'auto_mode_model', error: 'Cannot set permission mode to auto: model not supported' } });
    const binding = liveModeBinding(record('a'), status('a'), models, fake.client);
    expect(binding).toMatchObject({ value: 'auto', refusal: null, autoUnavailable: null, disabled: null });
    expect(binding.options).toEqual(['auto', 'bypassPermissions', 'default', 'acceptEdits', 'plan'] /* W3: auto and bypass first */);
    expect(await binding.set('auto')).toEqual({ ok: false, error: 'This model does not support auto mode' });
    expect(fake.invoked('session.setPermissionMode')).toEqual([{ appSessionId: 'a' as AppSessionId, mode: 'auto' }]);
  });

  // C11 start: the transport branch in words (C11's widgets set the mode through this binding too)
  it('a rejected invoke moves nothing and says the engine did not answer, or why the host refused', async () => {
    const fake = fakeClient();
    const binding = liveModeBinding(record('a'), status('a'), models, fake.client);
    const timedOut = binding.set('plan');
    await fake.fail('session.setPermissionMode'); // code internal
    expect(await timedOut).toEqual({ ok: false, error: 'failed · showing the last value it reported' });
    const bridge = { invoke: async () => ({ ok: false, error: { code: 'timeout', message: 'set_permission_mode unanswered after 8 s' } }), on: () => () => {} } as unknown as Parameters<typeof liveModeBinding>[3];
    expect(await liveModeBinding(record('a'), status('a'), models, bridge).set('plan')).toEqual({ ok: false, error: 'The engine did not answer · showing the last value it reported' });
  });
  // C11 end

  it('a session with no ready process offers no change', () => {
    const exited = { ...status('a'), process: 'exited' as const };
    expect(liveModeBinding(record('a'), exited, models).disabled).toBe('The session is not running');
    expect(liveModeBinding(record('a'), null, models).disabled).toBe('The session is not running');
    expect(liveModeBinding(record('a', { permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_model' } }), null, null)).toMatchObject({
      value: 'default',
      refusal: 'auto_mode_model',
    });
  });
});
