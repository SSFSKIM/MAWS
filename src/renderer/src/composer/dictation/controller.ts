// The dictation controller (E9 execution document, Design §6): one capture at a time, from a press (the dictation key's
// down, or the microphone button) to the final text or its cancellation. It binds the capture to the session and the
// composer sink it got at the press, so a late event never reaches whichever composer is focused when it arrives, and
// it checks every `voice.*` answer and every `voice.event` against the current capture id first.
//
//   requesting  → main was asked to start; nothing has been heard. Any release cancels at once (the microphone must
//                 not open after the hold ended); `started` moves on, a refusal or an error ends with a notice.
//   listening   → partials draw at the caret. Releasing the key stops and waits for the final; losing the keyboard
//                 cancels; a final Apple sends on its own (a long silence) settles.
//   finishing   → the final settles; if none comes within FINISH_TIMEOUT_MS the last partial does, and an error keeps
//                 the words already on screen.
// In any phase the composer may end the sink itself (`onEnded`: an edit inside the words, a submission, a card over
// the box, unmount), and the capture is cancelled on main.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { VoiceEvent, VoicePermission } from '@shared/ipc/schema/voice';
import type { HoldRelease } from '../../keymap/useKeyChord';
import type { FocusTarget } from '../../stores/composer';
import type { DictationSink } from '../editor/controller';
import { errorNotice, failed, NO_EDITOR, refusalNotice, type NoticeCopy } from './copy';
import { useDictationStore, type DictationPhase } from './store';

export const FINISH_TIMEOUT_MS = 5_000;

type TimerHandle = number; // window.setTimeout's

export interface DictationDeps {
  target(appSessionId: AppSessionId): FocusTarget | null;
  locale(): string | null; // settings.voice.locale; null is the system's
  now(): number;
  setTimeout(run: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

interface Capture {
  appSessionId: AppSessionId;
  captureId: string;
  phase: DictationPhase;
  sink: DictationSink;
  locale: string | null; // the recognizer's, once `started` names it
  interim: string;
  permission: VoicePermission | null;
  timer: TimerHandle | null;
}

export class DictationController {
  private capture: Capture | null = null;

  constructor(
    private readonly client: MawsBridge,
    private readonly deps: DictationDeps,
  ) {}

  press(appSessionId: AppSessionId | null): void {
    if (this.capture !== null || appSessionId === null) return;
    const captureId = crypto.randomUUID();
    const sink = this.deps.target(appSessionId)?.dictation?.begin(() => this.sinkEnded(captureId)) ?? null;
    if (sink === null) return this.notify(appSessionId, NO_EDITOR);
    this.capture = { appSessionId, captureId, phase: 'requesting', sink, locale: null, interim: '', permission: null, timer: null };
    this.publish();
    void this.client.invoke('voice.start', { captureId, locale: this.deps.locale() }).then((result) => {
      const capture = this.current(captureId);
      if (capture === null) return;
      if (!result.ok) return this.end(capture, 'cancel', failed(result.error.message));
      if (!result.value.accepted) this.end(capture, 'cancel', refusalNotice(result.value));
    });
  }

  release(reason: HoldRelease): void {
    const capture = this.capture;
    if (capture === null) return;
    if (capture.phase === 'requesting' || (capture.phase === 'listening' && reason === 'lost')) {
      this.cancelOnMain(capture);
      return this.end(capture, 'cancel', null);
    }
    if (capture.phase === 'listening') {
      this.send('voice.stop', capture);
      capture.phase = 'finishing';
      capture.timer = this.deps.setTimeout(() => {
        capture.timer = null;
        if (this.capture !== capture) return;
        this.cancelOnMain(capture);
        this.end(capture, 'interim', null);
      }, FINISH_TIMEOUT_MS);
      this.publish();
    }
    // finishing: the stop is on its way and the final still lands
  }

  onEvent(event: VoiceEvent): void {
    const capture = this.current(event.captureId);
    if (capture === null) return;
    switch (event.kind) {
      case 'permission':
        capture.permission = event.permission; // a denial waits for its error
        return;
      case 'started':
        if (capture.phase !== 'requesting') return;
        capture.phase = 'listening';
        capture.locale = event.locale;
        if (useDictationStore.getState().notice?.appSessionId === capture.appSessionId) useDictationStore.setState({ notice: null });
        return this.publish();
      case 'partial':
        if (capture.phase === 'requesting') return;
        capture.interim = event.text;
        capture.sink.partial(event.text);
        return this.publish();
      case 'final':
        capture.sink.final(event.text);
        return this.end(capture, null, null);
      case 'cancelled':
        return this.end(capture, 'cancel', null);
      case 'error':
        if (capture.phase === 'finishing') return this.end(capture, 'interim', failed(event.message));
        return this.end(capture, 'cancel', errorNotice(event.code, event.message, capture.permission));
    }
  }

  // The controller going away (DictationKeys unmounted): a capture still running is cancelled on main; one finishing
  // keeps what is on screen, since its final can no longer arrive.
  dispose(): void {
    const capture = this.capture;
    if (capture === null) return;
    this.cancelOnMain(capture);
    this.end(capture, capture.phase === 'finishing' ? 'interim' : 'cancel', null);
  }

  // ---- internals ----------------------------------------------------------------------------------------------

  private current(captureId: string): Capture | null {
    return this.capture?.captureId === captureId ? this.capture : null;
  }

  // The composer ended the sink itself; it already settled or cleared its words.
  private sinkEnded(captureId: string): void {
    const capture = this.current(captureId);
    if (capture === null) return;
    this.cancelOnMain(capture);
    this.end(capture, null, null);
  }

  // Back to idle: the sink told how to leave its words (`cancel` removes them, `interim` settles the last partial, null
  // when it already ended), and a notice when there is one.
  private end(capture: Capture, sink: 'cancel' | 'interim' | null, notice: NoticeCopy | null): void {
    if (capture.timer !== null) this.deps.clearTimeout(capture.timer);
    capture.timer = null;
    this.capture = null;
    if (sink === 'cancel') capture.sink.cancel();
    else if (sink === 'interim') capture.sink.final(capture.interim);
    useDictationStore.setState({ capture: null });
    if (notice !== null) this.notify(capture.appSessionId, notice);
  }

  private notify(appSessionId: AppSessionId, notice: NoticeCopy): void {
    useDictationStore.setState({ notice: { appSessionId, ...notice } });
  }

  private publish(): void {
    const capture = this.capture;
    if (capture === null) return;
    const { appSessionId, captureId, phase, locale, interim } = capture;
    useDictationStore.setState({ capture: { appSessionId, captureId, phase, locale, interim } });
  }

  private cancelOnMain(capture: Capture): void {
    this.send('voice.cancel', capture);
  }

  private send(name: 'voice.stop' | 'voice.cancel', capture: Capture): void {
    void this.client.invoke(name, { captureId: capture.captureId }).then((result) => {
      if (!result.ok) console.warn(`[dictation] ${name} failed`, result.error);
    });
  }
}

// The controller DictationKeys mounted, for the toolbar's microphone button (one per window).
let mounted: DictationController | null = null;

export function provideDictation(controller: DictationController): () => void {
  mounted = controller;
  return () => {
    if (mounted === controller) mounted = null;
  };
}

export const mountedDictation = (): DictationController | null => mounted;
