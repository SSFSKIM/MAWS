// Main's `voice.*` service (E9 execution document, Design §2): the one capture app-wide (one microphone), the client (the
// page instance) that owns it, and the gate every backend event passes before it reaches the renderer as `voice.event`.
//
// The reservation is synchronous: `start` records the capture before its first await, so two invokes racing through
// the router see each other and the second answers `busy`. `cancel` clears the capture at once whatever its phase; a
// `start` still awaiting its backend then answers `cancelled`, and every later event of that id is dropped. Events are
// forwarded only while their id is the active capture's and its phase admits them; a `final`, `cancelled` or `error`
// ends the capture.
import type { ClientId, ClientRef } from '@shared/ipc/client';
import type { VoiceEvent, VoicePrivacyPane, VoiceStartInput, VoiceStartResult, VoiceStatus } from '@shared/ipc/schema/voice';
import type { HelperEvent, VoiceBackend } from './backend';
import { voiceScriptLog } from './scripted-backend';

// The client an invoke came from is the page that holds a capture. Its end (a closed window, a crashed renderer or a
// reload) leaves no composer to send the capture's cancel.

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
  clientId: ClientId;
  phase: 'starting' | 'listening' | 'stopping';
  asked: boolean; // the backend was asked to start it, so only then has it anything to cancel
  unfollow(): void; // stops watching the owning page's end
}

export class VoiceService {
  private active: Capture | null = null;

  constructor(
    private readonly backend: VoiceBackend,
    private readonly deps: VoiceServiceDeps,
  ) {}

  status(locale: string | null): Promise<VoiceStatus> {
    return this.backend.probe(locale);
  }

  async start({ captureId, locale }: VoiceStartInput, client: ClientRef): Promise<VoiceStartResult> {
    if (this.active) return { accepted: false, reason: 'busy', path: null };
    const capture: Capture = { captureId, clientId: client.id, phase: 'starting', asked: false, unfollow: () => {} };
    this.active = capture;
    this.follow(capture, client);
    // A client that had already ended released the capture as it was followed: no composer is left to own a recording.
    if (this.active !== capture) return { accepted: false, reason: 'cancelled', path: null };
    capture.asked = true;
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

  stop({ captureId }: { captureId: string }, client: ClientRef): void {
    const capture = this.owned(captureId, client, 'stop');
    if (!capture || capture.phase === 'stopping') return; // a second stop waits for the final already on its way
    capture.phase = 'stopping';
    this.backend.stop(captureId);
  }

  cancel({ captureId }: { captureId: string }, client: ClientRef): void {
    const capture = this.owned(captureId, client, 'cancel');
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
    if (this.active) this.release(this.active);
    this.backend.dispose();
  }

  // The active capture when it is `captureId` and `client` owns it. A capture that already ended answers nothing (the
  // renderer's release can race its final); another client's command is ignored with a warning.
  private owned(captureId: string, client: ClientRef, command: string): Capture | null {
    const capture = this.active;
    if (!capture || capture.captureId !== captureId) return null;
    if (capture.clientId !== client.id) {
      console.warn(`[voice] ignored ${command} of capture ${captureId} from client ${client.id}; client ${capture.clientId} owns it`);
      return null;
    }
    return capture;
  }

  // Watches the owning client for as long as `capture` lives: its end cancels the capture (the helper would otherwise
  // keep recording for a composer that is gone, and every later start answer `busy`). Released captures unfollow.
  private follow(capture: Capture, client: ClientRef): void {
    capture.unfollow = client.onGone(() => {
      if (this.active !== capture) return;
      this.release(capture);
      if (capture.asked) this.backend.cancel(capture.captureId);
    });
  }

  private release(capture: Capture): void {
    if (this.active !== capture) return;
    this.active = null;
    capture.unfollow();
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
