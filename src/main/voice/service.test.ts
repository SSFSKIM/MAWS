import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceEvent, VoiceStartResult, VoiceStatus } from '@shared/ipc/schema/voice';
import type { HelperEvent, VoiceBackend } from './backend';
import { voiceScriptLog } from './scripted-backend';
import { VoiceService, type VoiceSender } from './service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const STATUS: VoiceStatus = { helper: { state: 'ready', path: '/h' }, backend: 'helper', permission: { microphone: 'authorized', speech: 'authorized' }, systemLocale: 'ko-KR', locale: 'ko-KR', supportsOnDevice: true, locales: ['en-US', 'ko-KR'] };

// A backend whose `start` answers when the test says so, and whose sink the test drives.
function fakeBackend() {
  const starts: { captureId: string; locale: string | null; sink: (event: HelperEvent) => void; answer: (result: VoiceStartResult) => void }[] = [];
  const backend = {
    kind: 'helper' as const,
    probe: vi.fn(async () => STATUS),
    start: vi.fn((captureId: string, locale: string | null, sink: (event: HelperEvent) => void) => new Promise<VoiceStartResult>((answer) => starts.push({ captureId, locale, sink, answer }))),
    stop: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn(),
  } satisfies VoiceBackend;
  return { backend, starts };
}

const sender = (id: number) => Object.assign(new EventEmitter(), { id }) satisfies VoiceSender;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { __mawsVoiceScript?: unknown }).__mawsVoiceScript;
});

function setup(e2e = false) {
  const { backend, starts } = fakeBackend();
  const emitted: VoiceEvent[] = [];
  const openExternal = vi.fn(async () => {});
  const service = new VoiceService(backend, { emit: (event) => emitted.push(event), openExternal, e2e });
  return { backend, starts, emitted, openExternal, service };
}

// A capture that the backend accepted and that reported `started`.
async function listening(h: ReturnType<typeof setup>, captureId = A, from = sender(1)) {
  const answer = h.service.start({ captureId, locale: 'en-US' }, from);
  h.starts.at(-1)!.answer({ accepted: true });
  await expect(answer).resolves.toEqual({ accepted: true });
  h.starts.at(-1)!.sink({ type: 'permission', id: captureId, microphone: 'authorized', speech: 'authorized' });
  h.starts.at(-1)!.sink({ type: 'started', id: captureId, locale: 'en-US' });
  return { sink: h.starts.at(-1)!.sink, from };
}

describe('voice service owns one capture and drops late events', () => {
  it('accepts one start and answers busy to a second from any sender while the first still awaits its backend', async () => {
    const h = setup();
    const first = h.service.start({ captureId: A, locale: null }, sender(1));
    await expect(h.service.start({ captureId: B, locale: null }, sender(1))).resolves.toEqual({ accepted: false, reason: 'busy', path: null });
    await expect(h.service.start({ captureId: B, locale: null }, sender(2))).resolves.toEqual({ accepted: false, reason: 'busy', path: null });
    expect(h.backend.start).toHaveBeenCalledOnce();
    expect(h.starts[0]).toMatchObject({ captureId: A, locale: null });
    h.starts[0]!.answer({ accepted: true });
    await expect(first).resolves.toEqual({ accepted: true });
  });

  it('forwards permission, started, partial and final for the active capture, then frees the microphone', async () => {
    const h = setup();
    const { sink } = await listening(h);
    sink({ type: 'partial', id: A, text: 'hello' });
    sink({ type: 'final', id: A, text: 'Hello.', timedOut: false });
    expect(h.emitted).toEqual([
      { kind: 'permission', captureId: A, permission: { microphone: 'authorized', speech: 'authorized' } },
      { kind: 'started', captureId: A, locale: 'en-US' },
      { kind: 'partial', captureId: A, text: 'hello' },
      { kind: 'final', captureId: A, text: 'Hello.', timedOut: false },
    ]);
    const next = h.service.start({ captureId: B, locale: null }, sender(1));
    expect(h.backend.start).toHaveBeenCalledTimes(2);
    h.starts[1]!.answer({ accepted: true });
    await expect(next).resolves.toEqual({ accepted: true });
  });

  it('drops a partial for another capture id, a partial after the final, and a second started', async () => {
    const h = setup();
    const { sink } = await listening(h);
    sink({ type: 'started', id: A, locale: 'en-US' });
    sink({ type: 'partial', id: B, text: 'not mine' });
    sink({ type: 'final', id: A, text: 'Hello.', timedOut: false });
    sink({ type: 'partial', id: A, text: 'late' });
    expect(h.emitted.map((event) => event.kind)).toEqual(['permission', 'started', 'final']);
  });

  it('forwards partials while stopping and a no-speech final before any stop', async () => {
    const h = setup();
    const { sink, from } = await listening(h);
    sink({ type: 'final', id: A, text: '', timedOut: false }); // Apple ended the task on its own
    expect(h.emitted.at(-1)).toEqual({ kind: 'final', captureId: A, text: '', timedOut: false });
    const second = await listening(h, B, from);
    h.service.stop({ captureId: B }, from);
    second.sink({ type: 'partial', id: B, text: 'hello world' });
    second.sink({ type: 'final', id: B, text: 'Hello world.', timedOut: true });
    expect(h.emitted.slice(-2)).toEqual([
      { kind: 'partial', captureId: B, text: 'hello world' },
      { kind: 'final', captureId: B, text: 'Hello world.', timedOut: true },
    ]);
  });

  it.each([
    ['cancelled', { type: 'cancelled', id: A }, { kind: 'cancelled', captureId: A }],
    ['error', { type: 'error', id: A, code: 'recognition_failed', message: 'Retry' }, { kind: 'error', captureId: A, code: 'recognition_failed', message: 'Retry' }],
  ] as const)('forwards %s and clears the capture', async (_, event, forwarded) => {
    const h = setup();
    const { sink } = await listening(h);
    sink(event);
    sink({ type: 'partial', id: A, text: 'late' });
    expect(h.emitted.at(-1)).toEqual(forwarded);
    h.service.start({ captureId: B, locale: null }, sender(1));
    expect(h.backend.start).toHaveBeenCalledTimes(2);
  });

  it('forwards a denial as permission then the error, with no started', async () => {
    const h = setup();
    const answer = h.service.start({ captureId: A, locale: null }, sender(1));
    h.starts[0]!.answer({ accepted: true });
    await answer;
    h.starts[0]!.sink({ type: 'permission', id: A, microphone: 'denied', speech: 'notDetermined' });
    h.starts[0]!.sink({ type: 'error', id: A, code: 'microphone_denied', message: 'Microphone access is denied for this app.' });
    expect(h.emitted.map((event) => event.kind)).toEqual(['permission', 'error']);
  });

  it('frees the microphone when the backend refuses the start, and answers its reason', async () => {
    const h = setup();
    const answer = h.service.start({ captureId: A, locale: null }, sender(1));
    h.starts[0]!.answer({ accepted: false, reason: 'helper_missing', path: '/h' });
    await expect(answer).resolves.toEqual({ accepted: false, reason: 'helper_missing', path: '/h' });
    h.service.start({ captureId: B, locale: null }, sender(1));
    expect(h.backend.start).toHaveBeenCalledTimes(2);
  });

  it('frees the microphone when the backend throws, and lets the failure through', async () => {
    const h = setup();
    h.backend.start.mockRejectedValueOnce(new Error('MAWS_E2E_VOICE is not JSON'));
    await expect(h.service.start({ captureId: A, locale: null }, sender(1))).rejects.toThrow('MAWS_E2E_VOICE is not JSON');
    h.service.start({ captureId: B, locale: null }, sender(1));
    expect(h.backend.start).toHaveBeenCalledTimes(2);
  });

  it('cancels a start still awaiting its backend: the backend hears it, the start answers cancelled and a later started is dropped', async () => {
    const h = setup();
    const from = sender(1);
    const answer = h.service.start({ captureId: A, locale: null }, from);
    h.service.cancel({ captureId: A }, from);
    expect(h.backend.cancel).toHaveBeenCalledExactlyOnceWith(A);
    h.starts[0]!.answer({ accepted: true });
    await expect(answer).resolves.toEqual({ accepted: false, reason: 'cancelled', path: null });
    h.starts[0]!.sink({ type: 'started', id: A, locale: 'en-US' });
    expect(h.emitted).toEqual([]);
  });

  it('cancels the capture whatever its phase, at once, and drops whatever its backend says afterwards', async () => {
    const h = setup();
    const { sink, from } = await listening(h);
    h.service.stop({ captureId: A }, from);
    h.service.cancel({ captureId: A }, from);
    expect(h.backend.cancel).toHaveBeenCalledExactlyOnceWith(A);
    sink({ type: 'final', id: A, text: 'Hello.', timedOut: false });
    sink({ type: 'cancelled', id: A });
    expect(h.emitted.map((event) => event.kind)).toEqual(['permission', 'started']);
  });

  it('stops once: a second stop waits for the final already on its way', async () => {
    const h = setup();
    const { from } = await listening(h);
    h.service.stop({ captureId: A }, from);
    h.service.stop({ captureId: A }, from);
    expect(h.backend.stop).toHaveBeenCalledExactlyOnceWith(A);
  });

  it('answers stop and cancel for a capture that is not active with nothing, and tells the backend nothing', async () => {
    const h = setup();
    const { sink, from } = await listening(h);
    sink({ type: 'final', id: A, text: 'Hello.', timedOut: false });
    h.service.stop({ captureId: A }, from);
    h.service.cancel({ captureId: A }, from);
    h.service.cancel({ captureId: B }, from);
    expect(h.backend.stop).not.toHaveBeenCalled();
    expect(h.backend.cancel).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores stop and cancel from another window, with a warning', async () => {
    const h = setup();
    await listening(h, A, sender(1));
    h.service.stop({ captureId: A }, sender(2));
    h.service.cancel({ captureId: A }, sender(2));
    expect(h.backend.stop).not.toHaveBeenCalled();
    expect(h.backend.cancel).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('cancels the capture when its window is destroyed, and follows each window once', async () => {
    const h = setup();
    const from = sender(1);
    const { sink } = await listening(h, A, from);
    sink({ type: 'final', id: A, text: '', timedOut: false });
    await listening(h, B, from);
    expect(from.listenerCount('destroyed')).toBe(1);
    from.emit('destroyed');
    expect(h.backend.cancel).toHaveBeenCalledExactlyOnceWith(B);
    h.service.start({ captureId: A, locale: null }, sender(2));
    expect(h.backend.start).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['its renderer is gone', (from: ReturnType<typeof sender>) => from.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })],
    ['its page reloads', (from: ReturnType<typeof sender>) => from.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })],
  ])('cancels the capture when %s, and accepts the next start', async (_, end) => {
    const h = setup();
    const from = sender(1);
    const { sink } = await listening(h, A, from);
    end(from);
    expect(h.backend.cancel).toHaveBeenCalledExactlyOnceWith(A);
    sink({ type: 'partial', id: A, text: 'late' });
    expect(h.emitted.map((event) => event.kind)).toEqual(['permission', 'started']);
    const next = h.service.start({ captureId: B, locale: null }, from);
    h.starts.at(-1)!.answer({ accepted: true });
    await expect(next).resolves.toEqual({ accepted: true });
  });

  it.each([
    ['a same-document navigation', { isMainFrame: true, isSameDocument: true }],
    ['a subframe navigation', { isMainFrame: false, isSameDocument: false }],
  ])('keeps the capture through %s', async (_, details) => {
    const h = setup();
    const from = sender(1);
    await listening(h, A, from);
    from.emit('did-start-navigation', details);
    expect(h.backend.cancel).not.toHaveBeenCalled();
    await expect(h.service.start({ captureId: B, locale: null }, sender(2))).resolves.toEqual({ accepted: false, reason: 'busy', path: null });
  });

  it('stops following the window once its capture ends, whichever way it ends', async () => {
    const h = setup();
    const from = sender(1);
    const watched = () => ['destroyed', 'render-process-gone', 'did-start-navigation'].map((event) => from.listenerCount(event));
    const { sink } = await listening(h, A, from);
    expect(watched()).toEqual([1, 1, 1]);
    sink({ type: 'final', id: A, text: '', timedOut: false });
    expect(watched()).toEqual([0, 0, 0]);
    await listening(h, B, from);
    h.service.cancel({ captureId: B }, from);
    expect(watched()).toEqual([0, 0, 0]);
    await listening(h, A, from);
    from.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    expect(watched()).toEqual([0, 0, 0]);
    from.emit('destroyed');
    expect(h.backend.cancel.mock.calls).toEqual([[B], [A]]);
  });

  it('a destroyed window that holds no capture cancels nothing', async () => {
    const h = setup();
    const owner = sender(1);
    await listening(h, A, owner);
    const other = sender(2);
    h.service.start({ captureId: B, locale: null }, other); // busy, but the window is followed
    other.emit('destroyed');
    expect(h.backend.cancel).not.toHaveBeenCalled();
  });

  it('answers voice.status from the backend probe for the locale asked', async () => {
    const h = setup();
    await expect(h.service.status('en-US')).resolves.toEqual(STATUS);
    expect(h.backend.probe).toHaveBeenCalledExactlyOnceWith('en-US');
  });

  it('opens the privacy pane through the shell, and under the harness records it and opens nothing', async () => {
    const h = setup();
    await h.service.openPrivacySettings('microphone');
    await h.service.openPrivacySettings('speech');
    expect(h.openExternal.mock.calls).toEqual([
      ['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'],
      ['x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition'],
    ]);
    const e2e = setup(true);
    await e2e.service.openPrivacySettings('microphone');
    expect(e2e.openExternal).not.toHaveBeenCalled();
    expect(voiceScriptLog().privacyPanes).toEqual(['microphone']);
  });

  it('disposes its backend and forwards nothing after', async () => {
    const h = setup();
    const { sink } = await listening(h);
    h.service.dispose();
    sink({ type: 'partial', id: A, text: 'late' });
    expect(h.backend.dispose).toHaveBeenCalledOnce();
    expect(h.emitted.map((event) => event.kind)).toEqual(['permission', 'started']);
  });
});
