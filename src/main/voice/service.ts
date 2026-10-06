// Main's `voice.*` service (E9 execution document, Design §2): the one capture app-wide (one microphone), the window that
// owns it, and the gate every backend event passes before it reaches the renderer as `voice.event`.
//
// The reservation is synchronous: `start` records the capture before its first await, so two invokes racing through
// the router see each other and the second answers `busy`. `cancel` clears the capture at once whatever its phase; a
// `start` still awaiting its backend then answers `cancelled`, and every later event of that id is dropped. Events are
// forwarded only while their id is the active capture's and its phase admits them; a `final`, `cancelled` or `error`
// ends the capture.
import type { VoiceEvent, VoicePrivacyPane, VoiceStartInput, VoiceStartResult, VoiceStatus } from '@shared/ipc/schema/voice';
import type { HelperEvent, VoiceBackend } from './backend';
import { voiceScriptLog } from './scripted-backend';

// The window an invoke came from: its id, and its end (a closed or crashed window cancels the capture it owns).
export interface VoiceSender {
  readonly id: number;
  once(event: 'destroyed', listener: () => void): unknown;
}

export interface VoiceServiceDeps {
  emit(event: VoiceEvent): void;
  openExternal(url: string): Promise<void>;
  e2e: boolean; // under MAWS_E2E=1 the privacy pane is recorded, never opened
}

const PRIVACY_PANES: Record<VoicePrivacyPane, string> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  speech: 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
};

interface Capture {
  captureId: string;
  senderId: number;
  phase: 'starting' | 'listening' | 'stopping';
}

export class VoiceService {
  private active: Capture | null = null;
  private readonly followed = new Set<number>(); // the windows whose `destroyed` is already followed

  constructor(
    private readonly backend: VoiceBackend,
    private readonly deps: VoiceServiceDeps,
  ) {}

  status(locale: string | null): Promise<VoiceStatus> {
    return this.backend.probe(locale);
  }

  async start({ captureId, locale }: VoiceStartInput, sender: VoiceSender): Promise<VoiceStartResult> {
    this.follow(sender);
    if (this.active) return { accepted: false, reason: 'busy', path: null };
    const capture: Capture = { captureId, senderId: sender.id, phase: 'starting' };
    this.active = capture;
    let result: VoiceStartResult;
    try {
      result = await this.backend.start(captureId, locale, (event) => this.forward(capture, event));
    } catch (error) {
      this.release(capture);
      throw error;
    }
    if (this.active !== capture) return { accepted: false, reason: 'cancelled', path: null }; // cancelled meanwhile
    if (!result.accepted) this.release(capture);
    return result;
  }

  stop({ captureId }: { captureId: string }, sender: VoiceSender): void {
    const capture = this.owned(captureId, sender, 'stop');
    if (!capture || capture.phase === 'stopping') return; // a second stop waits for the final already on its way
    capture.phase = 'stopping';
    this.backend.stop(captureId);
  }

  cancel({ captureId }: { captureId: string }, sender: VoiceSender): void {
    const capture = this.owned(captureId, sender, 'cancel');
    if (!capture) return;
    this.release(capture);
    this.backend.cancel(captureId);
  }

  async openPrivacySettings(pane: VoicePrivacyPane): Promise<void> {
    if (this.deps.e2e) {
      voiceScriptLog().privacyPanes.push(pane);
      return;
    }
    await this.deps.openExternal(PRIVACY_PANES[pane]);
  }

  dispose(): void {
    this.active = null;
    this.backend.dispose();
  }

  // The active capture when it is `captureId` and `sender` owns it. A capture that already ended answers nothing (the
  // renderer's release can race its final); another window's command is ignored with a warning.
  private owned(captureId: string, sender: VoiceSender, command: string): Capture | null {
    const capture = this.active;
    if (!capture || capture.captureId !== captureId) return null;
    if (capture.senderId !== sender.id) {
      console.warn(`[voice] ignored ${command} of capture ${captureId} from window ${sender.id}; window ${capture.senderId} owns it`);
      return null;
    }
    return capture;
  }

  private follow(sender: VoiceSender): void {
    if (this.followed.has(sender.id)) return;
    const id = sender.id; // read now: a destroyed webContents' properties may no longer answer
    this.followed.add(id);
    sender.once('destroyed', () => {
      this.followed.delete(id);
      const capture = this.active;
      if (capture?.senderId !== id) return;
      this.release(capture);
      this.backend.cancel(capture.captureId);
    });
  }

  private release(capture: Capture): void {
    if (this.active === capture) this.active = null;
  }

  private forward(capture: Capture, event: HelperEvent): void {
    if (this.active !== capture || event.id !== capture.captureId) return; // stale: another capture's, or this one ended
    const { captureId } = capture;
    switch (event.type) {
      case 'permission':
        if (capture.phase !== 'starting') return;
        this.deps.emit({ kind: 'permission', captureId, permission: { microphone: event.microphone, speech: event.speech } });
        return;
      case 'started':
        if (capture.phase !== 'starting') return;
        capture.phase = 'listening';
        this.deps.emit({ kind: 'started', captureId, locale: event.locale });
        return;
      case 'partial':
        if (capture.phase === 'starting') return;
        this.deps.emit({ kind: 'partial', captureId, text: event.text });
        return;
      case 'final':
        this.release(capture);
        this.deps.emit({ kind: 'final', captureId, text: event.text, timedOut: event.timedOut });
        return;
      case 'cancelled':
        this.release(capture);
        this.deps.emit({ kind: 'cancelled', captureId });
        return;
      case 'error':
        this.release(capture);
        this.deps.emit({ kind: 'error', captureId, code: event.code, message: event.message });
        return;
    }
  }
}
