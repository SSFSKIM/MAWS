// The dictation controller's state machine (E9 execution document, Design §6): one capture at a time, every answer and
// event identity-checked against the current capture id, over a fake client whose `voice.start` answers on demand and
// timers the test advances itself.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import type { VoiceEvent, VoiceStartResult } from '@shared/ipc/schema/voice';
import type { DictationSink } from '../editor/controller';
import type { FocusTarget } from '../../stores/composer';
import { DictationController, FINISH_TIMEOUT_MS } from './controller';
import { resetDictationStore, useDictationStore } from './store';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
// An event as a test writes it, the capture id optional (the current one by default); distributed over the kinds, since
// `Omit` of the union would keep only the fields every kind shares.
type EventWithoutId = VoiceEvent extends infer E ? (E extends VoiceEvent ? Omit<E, 'captureId'> & { captureId?: string } : never) : never;

function harness(options: { refuse?: boolean } = {}) {
  const invoked: [CommandName, unknown][] = [];
  const starts: ((result: { ok: true; value: VoiceStartResult } | { ok: false; error: { code: 'internal'; message: string } }) => void)[] = [];
  const client = {
    invoke: (name: CommandName, input: unknown) => {
      invoked.push([name, input]);
      if (name === 'voice.start') return new Promise((resolve) => starts.push(resolve));
      return Promise.resolve({ ok: true, value: undefined });
    },
    on: () => () => {},
    pathForFile: () => '',
  } as unknown as MawsBridge;

  const sink: string[] = []; // what the composer was told
  const ended: (() => void)[] = [];
  const begins: AppSessionId[] = [];
  const target = (appSessionId: AppSessionId): FocusTarget => ({
    focusEditor: () => {},
    focusFrame: () => {},
    insertText: () => {},
    dictation: {
      begin: (onEnded): DictationSink | null => {
        begins.push(appSessionId);
        if (options.refuse) return null;
        ended.push(onEnded);
        return {
          partial: (text) => void sink.push(`partial:${text}`),
          final: (text) => void sink.push(`final:${text}`),
          cancel: () => void sink.push('cancel'),
        };
      },
    },
  });

  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const controller = new DictationController(client, {
    target: (id) => (id === A || id === B ? target(id) : null),
    locale: () => 'en-US',
    now: () => now,
    setTimeout: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
  });

  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue;
      timers.delete(id);
      timer.run();
    }
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const answer = async (value: VoiceStartResult) => {
    starts.shift()!({ ok: true, value });
    await settle();
  };
  const fail = async (message: string) => {
    starts.shift()!({ ok: false, error: { code: 'internal', message } });
    await settle();
  };
  const captureId = () => (invoked.find(([name]) => name === 'voice.start')![1] as { captureId: string }).captureId;
  const event = (e: EventWithoutId) => controller.onEvent({ captureId: captureId(), ...e } as VoiceEvent);
  const sent = (name: CommandName) => invoked.filter(([n]) => n === name).map(([, input]) => input);
  return { controller, invoked, sink, ended, begins, timers, advance, answer, fail, captureId, event, sent };
}

const state = () => useDictationStore.getState();

beforeEach(() => resetDictationStore());
afterEach(() => resetDictationStore());

describe('dictation controller state machine', () => {
  it('with no session focused does nothing at all', () => {
    const h = harness();
    h.controller.press(null);
    expect(h.invoked).toEqual([]);
    expect(h.begins).toEqual([]);
    expect(state()).toMatchObject({ capture: null, notice: null });
  });

  it('a composer that takes no text gets a notice and no start', () => {
    const h = harness({ refuse: true });
    h.controller.press(A);
    expect(h.invoked).toEqual([]);
    expect(state().notice).toEqual({ appSessionId: A, kind: 'no_editor', message: 'Dictation needs a composer that can take text' });
    expect(state().capture).toBeNull();
  });

  it('press begins the sink and asks main to start with a fresh capture id and the chosen locale', () => {
    const h = harness();
    h.controller.press(A);
    expect(h.begins).toEqual([A]);
    const [input] = h.sent('voice.start') as [{ captureId: string; locale: string | null }];
    expect(input.locale).toBe('en-US');
    expect(input.captureId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(state().capture).toEqual({ appSessionId: A, captureId: input.captureId, phase: 'requesting', locale: null, interim: '' });
  });

  const refusals: [VoiceStartResult & { accepted: false }, string | null][] = [
    [{ accepted: false, reason: 'busy', path: null }, 'Another dictation is still finishing'],
    [{ accepted: false, reason: 'helper_missing', path: '/x/maws-voice-helper' }, 'Dictation is unavailable · helper not found at /x/maws-voice-helper'],
    [{ accepted: false, reason: 'helper_failed', path: '/x/maws-voice-helper' }, 'Dictation is unavailable · the helper did not start'],
    [{ accepted: false, reason: 'e2e_refused', path: null }, 'Dictation is off under the test harness'],
    [{ accepted: false, reason: 'cancelled', path: null }, null],
  ];
  for (const [refusal, message] of refusals) {
    it(`a start refused as ${refusal.reason} cancels the sink and ${message ? 'says why' : 'says nothing'}`, async () => {
      const h = harness();
      h.controller.press(A);
      await h.answer(refusal);
      expect(h.sink).toEqual(['cancel']);
      expect(state().capture).toBeNull();
      if (message === null) expect(state().notice).toBeNull();
      else expect(state().notice?.message.startsWith(message), state().notice?.message).toBe(true);
    });
  }

  for (const reason of ['keyup', 'lost'] as const) {
    it(`a ${reason} release while requesting cancels at once, and a late started is dropped`, async () => {
      const h = harness();
      h.controller.press(A);
      const id = h.captureId();
      h.controller.release(reason);
      expect(h.sent('voice.cancel')).toEqual([{ captureId: id }]);
      expect(h.sink).toEqual(['cancel']);
      expect(state().capture).toBeNull();
      await h.answer({ accepted: true });
      h.event({ kind: 'started', locale: 'en-US' });
      h.event({ kind: 'partial', text: 'hello' });
      expect(h.sink).toEqual(['cancel']);
      expect(h.sent('voice.stop')).toEqual([]);
    });
  }

  it('a denial waits for its error, then names the pane', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'permission', permission: { microphone: 'denied', speech: 'notDetermined' } });
    expect(state().capture?.phase).toBe('requesting');
    expect(h.sink).toEqual([]);
    h.event({ kind: 'error', code: 'microphone_denied', message: 'denied' });
    expect(h.sink).toEqual(['cancel']);
    expect(state().notice).toEqual({ appSessionId: A, kind: 'microphone_denied', message: 'Microphone access is off for MAWS' });
    expect(state().capture).toBeNull();
  });

  it('a restricted service says it cannot be turned on here', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'permission', permission: { microphone: 'authorized', speech: 'restricted' } });
    h.event({ kind: 'error', code: 'speech_denied', message: 'restricted' });
    expect(state().notice).toEqual({ appSessionId: A, kind: 'speech_denied', message: 'Speech recognition is off for MAWS and cannot be turned on here' });
  });

  it('errors before audio map to their notices', async () => {
    const cases: [Extract<VoiceEvent, { kind: 'error' }>['code'], string, string][] = [
      ['on_device_unavailable', 'unavailable', 'System Settings › Keyboard › Dictation'],
      ['locale_unsupported', 'unavailable', 'Dictation is unavailable'],
      ['recognizer_unavailable', 'unavailable', 'Dictation is unavailable'],
      ['helper_crashed', 'unavailable', 'Dictation is unavailable'],
      ['helper_failed', 'unavailable', 'the helper did not start'],
      ['audio_failed', 'failed', 'no input device'],
      ['busy', 'busy', 'Another dictation is still finishing'],
    ];
    for (const [code, kind, words] of cases) {
      resetDictationStore();
      const h = harness();
      h.controller.press(A);
      await h.answer({ accepted: true });
      h.event({ kind: 'error', code, message: 'no input device' });
      expect(h.sink, code).toEqual(['cancel']);
      expect(state().notice?.kind, code).toBe(kind);
      expect(state().notice?.message, code).toContain(words);
    }
  });

  it('started listens, records the locale and clears this session’s notice; partials draw and replace', async () => {
    const h = harness();
    useDictationStore.setState({ notice: { appSessionId: A, kind: 'failed', message: 'old' } });
    h.controller.press(A);
    await h.answer({ accepted: true });
    expect(state().notice).not.toBeNull(); // until the capture actually starts
    h.event({ kind: 'started', locale: 'en-US' });
    expect(state().capture).toMatchObject({ phase: 'listening', locale: 'en-US' });
    expect(state().notice).toBeNull();
    h.event({ kind: 'partial', text: 'hello' });
    h.event({ kind: 'partial', text: 'hello world' });
    expect(h.sink).toEqual(['partial:hello', 'partial:hello world']);
    expect(state().capture?.interim).toBe('hello world');
  });

  it('keeps another session’s notice when a capture starts', async () => {
    const h = harness();
    useDictationStore.setState({ notice: { appSessionId: B, kind: 'failed', message: 'old' } });
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    expect(state().notice?.appSessionId).toBe(B);
  });

  it('a final while still listening (Apple ended the task) settles, and the later release does nothing', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    h.event({ kind: 'final', text: '', timedOut: false });
    expect(h.sink).toEqual(['final:']);
    expect(state().capture).toBeNull();
    h.controller.release('keyup');
    expect(h.sent('voice.stop')).toEqual([]);
    expect(h.sent('voice.cancel')).toEqual([]);
  });

  it('keyup while listening stops and finishes; the final settles and the timer is gone', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    h.event({ kind: 'partial', text: 'hello' });
    h.controller.release('keyup');
    expect(h.sent('voice.stop')).toEqual([{ captureId: h.captureId() }]);
    expect(state().capture?.phase).toBe('finishing');
    expect(h.timers.size).toBe(1);
    h.event({ kind: 'final', text: 'Hello world.', timedOut: false });
    expect(h.sink).toEqual(['partial:hello', 'final:Hello world.']);
    expect(state().capture).toBeNull();
    expect(h.timers.size).toBe(0);
  });

  it('a final that never comes settles the last partial after the timeout and cancels on main', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    h.event({ kind: 'partial', text: 'hello' });
    h.controller.release('keyup');
    h.advance(FINISH_TIMEOUT_MS - 1);
    expect(state().capture?.phase).toBe('finishing');
    h.advance(1);
    expect(h.sink).toEqual(['partial:hello', 'final:hello']);
    expect(h.sent('voice.cancel')).toEqual([{ captureId: h.captureId() }]);
    expect(state().capture).toBeNull();
    h.event({ kind: 'final', text: 'late', timedOut: false });
    expect(h.sink).toEqual(['partial:hello', 'final:hello']);
  });

  it('lost while finishing changes nothing: the final still lands', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    h.controller.release('keyup');
    h.controller.release('lost');
    expect(h.sent('voice.cancel')).toEqual([]);
    h.event({ kind: 'final', text: 'Hello.', timedOut: false });
    expect(h.sink).toEqual(['final:Hello.']);
  });

  it('an error while finishing keeps the words on screen and says it failed', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    h.event({ kind: 'partial', text: 'hello' });
    h.controller.release('keyup');
    h.event({ kind: 'error', code: 'recognition_failed', message: 'Recognition stopped' });
    expect(h.sink).toEqual(['partial:hello', 'final:hello']);
    expect(state().notice).toEqual({ appSessionId: A, kind: 'failed', message: 'Dictation failed · Recognition stopped' });
    expect(state().capture).toBeNull();
    expect(h.timers.size).toBe(0);
  });

  it('lost while listening cancels on main and removes the words; an error while listening removes them too', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    h.event({ kind: 'partial', text: 'hello' });
    h.controller.release('lost');
    expect(h.sent('voice.cancel')).toEqual([{ captureId: h.captureId() }]);
    expect(h.sink).toEqual(['partial:hello', 'cancel']);
    expect(state().capture).toBeNull();

    const g = harness();
    g.controller.press(A);
    await g.answer({ accepted: true });
    g.event({ kind: 'started', locale: 'en-US' });
    g.event({ kind: 'error', code: 'audio_failed', message: 'the input went away' });
    expect(g.sink).toEqual(['cancel']);
    expect(state().notice?.kind).toBe('failed');
  });

  it('a cancelled event ends the capture and removes the words', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    h.event({ kind: 'partial', text: 'hello' });
    h.event({ kind: 'cancelled' });
    expect(h.sink).toEqual(['partial:hello', 'cancel']);
    expect(state()).toMatchObject({ capture: null, notice: null });
  });

  for (const phase of ['requesting', 'listening', 'finishing'] as const) {
    it(`the editor ending the sink while ${phase} cancels on main and calls the sink no more`, async () => {
      const h = harness();
      h.controller.press(A);
      if (phase !== 'requesting') {
        await h.answer({ accepted: true });
        h.event({ kind: 'started', locale: 'en-US' });
      }
      if (phase === 'finishing') h.controller.release('keyup');
      h.ended[0]!();
      expect(h.sent('voice.cancel')).toEqual([{ captureId: h.captureId() }]);
      expect(h.sink).toEqual([]);
      expect(state().capture).toBeNull();
      expect(h.timers.size).toBe(0);
      h.event({ kind: 'final', text: 'late', timedOut: false });
      expect(h.sink).toEqual([]);
    });
  }

  it('drops an event of another capture id', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    h.event({ kind: 'partial', text: 'stale', captureId: '00000000-0000-4000-8000-000000000000' });
    h.event({ kind: 'error', code: 'audio_failed', message: 'stale', captureId: '00000000-0000-4000-8000-000000000000' });
    expect(h.sink).toEqual([]);
    expect(state().capture?.phase).toBe('listening');
  });

  it('ignores a second press while a capture runs, from either session', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    h.controller.release('keyup');
    h.controller.press(A);
    h.controller.press(B);
    expect(h.begins).toEqual([A]);
    expect(h.sent('voice.start')).toHaveLength(1);
  });

  it('a start that fails on the bridge cancels the sink and says it failed', async () => {
    const h = harness();
    h.controller.press(A);
    await h.fail('main is gone');
    expect(h.sink).toEqual(['cancel']);
    expect(state().notice).toEqual({ appSessionId: A, kind: 'failed', message: 'Dictation failed · main is gone' });
    expect(state().capture).toBeNull();
  });

  it('dispose cancels a running capture on main and removes its words', async () => {
    const h = harness();
    h.controller.press(A);
    await h.answer({ accepted: true });
    h.event({ kind: 'started', locale: 'en-US' });
    h.event({ kind: 'partial', text: 'hello' });
    h.controller.dispose();
    expect(h.sent('voice.cancel')).toEqual([{ captureId: h.captureId() }]);
    expect(h.sink).toEqual(['partial:hello', 'cancel']);
    expect(state().capture).toBeNull();
  });
});
