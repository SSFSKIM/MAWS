import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelperEvent } from './backend';
import { ScriptedBackend, voiceScriptLog } from './scripted-backend';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PATH = '/app/build/voice-helper/maws-voice-helper';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { __mawsVoiceScript?: unknown }).__mawsVoiceScript;
});

function setup(script: unknown = {}) {
  const env: NodeJS.ProcessEnv = { MAWS_E2E: '1', MAWS_E2E_VOICE: JSON.stringify(script) };
  const backend = new ScriptedBackend({ env, path: PATH });
  const events: HelperEvent[] = [];
  const start = (captureId = A, locale: string | null = null) => backend.start(captureId, locale, (event) => events.push(event));
  return { env, backend, events, start, types: () => events.map((event) => event.type) };
}

describe('scripted backend follows MAWS_E2E_VOICE', () => {
  it('emits permission and started, then the scripted partials at the scripted cadence', async () => {
    const h = setup({ partials: ['one', 'one two', 'one two three'], partialDelayMs: 100, startedDelayMs: 30 });
    await expect(h.start(A, 'en-GB')).resolves.toEqual({ accepted: true });
    expect(h.events).toEqual([]);
    await vi.advanceTimersByTimeAsync(30);
    expect(h.events).toEqual([
      { type: 'permission', id: A, microphone: 'authorized', speech: 'authorized' },
      { type: 'started', id: A, locale: 'en-GB' },
    ]);
    await vi.advanceTimersByTimeAsync(99);
    expect(h.types()).toEqual(['permission', 'started']);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.events.at(-1)).toEqual({ type: 'partial', id: A, text: 'one' });
    await vi.advanceTimersByTimeAsync(200);
    expect(h.events.slice(2).map((event) => (event as { text: string }).text)).toEqual(['one', 'one two', 'one two three']);
  });

  it('runs the shown defaults for an empty script: two partials 40 ms apart and the final "Hello world."', async () => {
    const h = setup({});
    await h.start();
    await vi.advanceTimersByTimeAsync(80);
    expect(h.events.slice(2)).toEqual([
      { type: 'partial', id: A, text: 'hello' },
      { type: 'partial', id: A, text: 'hello world' },
    ]);
    h.backend.stop(A);
    expect(h.events.at(-1)).toEqual({ type: 'final', id: A, text: 'Hello world.', timedOut: false });
    expect(h.events.find((event) => event.type === 'started')).toEqual({ type: 'started', id: A, locale: 'en-US' }); // null: the stub's system locale
  });

  it('emits the final at once on stop, the scripted text or else the last scripted partial, and clears the pending partials', async () => {
    const scripted = setup({ partials: ['a', 'a b', 'a b c'], final: 'A b c.' });
    await scripted.start();
    await vi.advanceTimersByTimeAsync(40);
    scripted.backend.stop(A);
    expect(scripted.events.at(-1)).toEqual({ type: 'final', id: A, text: 'A b c.', timedOut: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(scripted.types()).toEqual(['permission', 'started', 'partial', 'final']);

    const lastPartial = setup({ partials: ['x', 'x y'] });
    await lastPartial.start();
    await vi.advanceTimersByTimeAsync(0); // started, no partial yet: the final is still the script's answer
    lastPartial.backend.stop(A);
    expect(lastPartial.events.at(-1)).toEqual({ type: 'final', id: A, text: 'x y', timedOut: false });
  });

  it('answers a stop before started with an empty final, as the helper does when nothing was heard', async () => {
    const h = setup({ startedDelayMs: 500 });
    await h.start();
    h.backend.stop(A);
    expect(h.events).toEqual([{ type: 'final', id: A, text: '', timedOut: false }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.types()).toEqual(['final']);
  });

  it('emits cancelled on cancel at any point and clears every pending timer, so no started follows a cancel during the delay', async () => {
    const early = setup({ startedDelayMs: 500 });
    await early.start();
    await vi.advanceTimersByTimeAsync(50);
    early.backend.cancel(A);
    await vi.advanceTimersByTimeAsync(2000);
    expect(early.events).toEqual([{ type: 'cancelled', id: A }]);

    const late = setup({});
    await late.start();
    await vi.advanceTimersByTimeAsync(40);
    late.backend.cancel(A);
    await vi.advanceTimersByTimeAsync(2000);
    expect(late.types()).toEqual(['permission', 'started', 'partial', 'cancelled']);
  });

  it.each([
    ['a denied microphone', { microphone: 'denied', speech: 'authorized' }, 'microphone_denied'],
    ['a restricted microphone', { microphone: 'restricted', speech: 'notDetermined' }, 'microphone_denied'],
    ['denied speech recognition', { microphone: 'authorized', speech: 'denied' }, 'speech_denied'],
  ] as const)('emits permission then the denial and no started for %s', async (_, permission, code) => {
    const h = setup({ permission });
    await h.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.events).toEqual([
      { type: 'permission', id: A, ...permission },
      { type: 'error', id: A, code, message: expect.any(String) },
    ]);
  });

  it('emits permission then the scripted error instead of started', async () => {
    const h = setup({ error: { code: 'audio_failed', message: 'No audio input device is available.' } });
    await h.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.events.slice(1)).toEqual([{ type: 'error', id: A, code: 'audio_failed', message: 'No audio input device is available.' }]);
  });

  it('emits one more partial 20 ms after the final when the script asks for a late one', async () => {
    const h = setup({ lateAfterFinal: true });
    await h.start();
    await vi.advanceTimersByTimeAsync(80);
    h.backend.stop(A);
    await vi.advanceTimersByTimeAsync(19);
    expect(h.types().at(-1)).toBe('final');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.events.at(-1)).toMatchObject({ type: 'partial', id: A });
  });

  it('reports the helper missing for probe and start when the script says so', async () => {
    const h = setup({ helper: 'missing' });
    await expect(h.backend.probe(null)).resolves.toMatchObject({ helper: { state: 'missing', path: PATH }, backend: 'scripted', permission: null, locales: [] });
    await expect(h.start()).resolves.toEqual({ accepted: false, reason: 'helper_missing', path: PATH });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.events).toEqual([]);
  });

  it('probes as a ready helper with the scripted permission states, the stub system locale and the locale asked', async () => {
    const h = setup({ permission: { microphone: 'denied', speech: 'notDetermined' } });
    const status = await h.backend.probe('ko-KR');
    expect(status).toEqual({
      helper: { state: 'ready', path: PATH },
      backend: 'scripted',
      permission: { microphone: 'denied', speech: 'notDetermined' },
      systemLocale: 'en-US',
      locale: 'ko-KR',
      supportsOnDevice: true,
      locales: expect.arrayContaining(['en-US', 'ko-KR']),
    });
    await expect(h.backend.probe(null)).resolves.toMatchObject({ locale: 'en-US' });
  });

  it('reads the variable at each start, so a test changes the next answer through main’s environment', async () => {
    const h = setup({ partials: ['first'] });
    await h.start(A);
    await vi.advanceTimersByTimeAsync(0);
    h.backend.stop(A);
    h.env.MAWS_E2E_VOICE = JSON.stringify({ partials: ['second'] });
    await h.start(B);
    await vi.advanceTimersByTimeAsync(0);
    h.backend.stop(B);
    expect(h.events.filter((event) => event.type === 'final').map((event) => (event as { text: string }).text)).toEqual(['first', 'second']);
  });

  it('logs every start, stop and cancel on the global the end-to-end spec reads', async () => {
    const h = setup({});
    await h.start(A, 'en-US');
    h.backend.stop(A);
    await h.start(B, null);
    h.backend.cancel(B);
    expect(voiceScriptLog()).toEqual({ starts: [{ captureId: A, locale: 'en-US' }, { captureId: B, locale: null }], stops: [A], cancels: [B], privacyPanes: [] });
  });

  it('refuses a script that is not JSON or names a field it does not know, loudly', async () => {
    const h = setup();
    h.env.MAWS_E2E_VOICE = '{partials:';
    await expect(h.start()).rejects.toThrow(/MAWS_E2E_VOICE/);
    h.env.MAWS_E2E_VOICE = JSON.stringify({ partial: ['typo'] });
    await expect(h.backend.probe(null)).rejects.toThrow(/MAWS_E2E_VOICE/);
  });

  it('ignores stop and cancel for a capture it does not hold, and stops everything on dispose', async () => {
    const h = setup({});
    await h.start();
    h.backend.stop(B);
    h.backend.cancel(B);
    h.backend.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.events).toEqual([]);
  });
});
