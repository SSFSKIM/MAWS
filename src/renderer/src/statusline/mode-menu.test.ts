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
    expect(MODE_OPTIONS.map((o) => o.mode)).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);
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
  });

  it('the live binding shows the effective mode and sets through session.setPermissionMode, answering the refusal in words', async () => {
    // as C3's host answers a refusal (engine-host/ipc.ts): the code and the control error's message together
    const fake = fakeClient({ 'session.setPermissionMode': { effective: 'default', refusal: 'auto_mode_model', error: 'Cannot set permission mode to auto: model not supported' } });
    const binding = liveModeBinding(record('a'), status('a'), models, fake.client);
    expect(binding).toMatchObject({ value: 'auto', refusal: null, autoUnavailable: null, disabled: null });
    expect(binding.options).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);
    expect(await binding.set('auto')).toEqual({ ok: false, error: 'This model does not support auto mode' });
    expect(fake.invoked('session.setPermissionMode')).toEqual([{ appSessionId: 'a' as AppSessionId, mode: 'auto' }]);
  });

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
