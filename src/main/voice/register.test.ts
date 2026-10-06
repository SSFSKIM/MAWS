import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '@shared/ipc/schema';
import { startVoice } from './register';

const A = '11111111-1111-4111-8111-111111111111';
const MISSING = '/nonexistent/maws-voice-helper';

type Handler = (input: unknown, context: { sender: unknown }) => unknown;

function launch(env: NodeJS.ProcessEnv) {
  const handlers = new Map<CommandName, Handler>();
  const emit = vi.fn();
  const openExternal = vi.fn(async () => {});
  const voice = startVoice({
    env,
    packaged: false,
    appRoot: '/repo',
    resourcesPath: '/MAWS.app/Contents/Resources',
    emit,
    openExternal,
    register: (name, handler) => void handlers.set(name, handler as Handler),
  });
  const sender = Object.assign(new EventEmitter(), { id: 1 });
  const invoke = (name: CommandName, input: unknown) => handlers.get(name)!(input, { sender });
  return { voice, handlers, emit, openExternal, invoke };
}

const holder = globalThis as { __mawsVoiceBackend?: string; __mawsVoiceScript?: unknown };

afterEach(() => {
  delete holder.__mawsVoiceBackend;
  delete holder.__mawsVoiceScript;
});

describe('voice registration chooses its backend once, at startup', () => {
  it('registers the five voice commands', () => {
    const { handlers, voice } = launch({ MAWS_VOICE_HELPER: MISSING });
    expect([...handlers.keys()]).toEqual(['voice.status', 'voice.start', 'voice.stop', 'voice.cancel', 'voice.openPrivacySettings']);
    voice.dispose();
  });

  it('runs the scripted backend under the harness when MAWS_E2E_VOICE is set', async () => {
    const { invoke, voice, emit } = launch({ MAWS_E2E: '1', MAWS_E2E_VOICE: '{}', MAWS_VOICE_HELPER: MISSING });
    expect(holder.__mawsVoiceBackend).toBe('scripted');
    await expect(invoke('voice.status', { locale: null })).resolves.toMatchObject({ backend: 'scripted', helper: { state: 'ready' } });
    vi.useFakeTimers();
    try {
      await expect(invoke('voice.start', { captureId: A, locale: null })).resolves.toEqual({ accepted: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(emit.mock.calls.map(([event]) => event.kind)).toEqual(['permission', 'started']);
    } finally {
      voice.dispose();
      vi.useRealTimers();
    }
  });

  it('runs the real helper probe-only under the harness without a script: start is refused, the pane is only recorded', async () => {
    const { invoke, voice, openExternal } = launch({ MAWS_E2E: '1', MAWS_VOICE_HELPER: MISSING });
    expect(holder.__mawsVoiceBackend).toBe('helper-probe-only');
    await expect(invoke('voice.start', { captureId: A, locale: null })).resolves.toEqual({ accepted: false, reason: 'e2e_refused', path: null });
    await expect(invoke('voice.status', { locale: null })).resolves.toMatchObject({ backend: 'helper', helper: { state: 'missing', path: MISSING } });
    await invoke('voice.openPrivacySettings', { pane: 'speech' });
    expect(openExternal).not.toHaveBeenCalled();
    expect(holder.__mawsVoiceScript).toMatchObject({ privacyPanes: ['speech'] });
    voice.dispose();
  });

  it('runs the real helper outside the harness, whatever MAWS_E2E_VOICE says, and leaves no harness global', async () => {
    const { invoke, voice, openExternal } = launch({ MAWS_E2E_VOICE: '{}', MAWS_VOICE_HELPER: MISSING });
    expect(holder.__mawsVoiceBackend).toBeUndefined();
    await expect(invoke('voice.start', { captureId: A, locale: null })).resolves.toEqual({ accepted: false, reason: 'helper_missing', path: MISSING });
    await invoke('voice.openPrivacySettings', { pane: 'microphone' });
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    voice.dispose();
  });
});
