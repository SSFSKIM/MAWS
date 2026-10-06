// What main's voice service drives (E9 execution document, Interfaces "`VoiceBackend`"): the helper backend, which
// spawns the bundled Swift helper, or the scripted backend, the end-to-end stand-in. Both speak the helper's event shapes
// (`./protocol.ts`), so the service maps one vocabulary to `voice.event` whichever is behind it.
import type { VoiceStartResult, VoiceStatus } from '@shared/ipc/schema/voice';
import type { HelperEvent } from './protocol';

export type { HelperEvent } from './protocol';

export interface VoiceBackend {
  readonly kind: 'helper' | 'scripted';
  // Non-prompting: the helper's state, the permission states and the locales.
  probe(locale: string | null): Promise<VoiceStatus>;
  // Resolves once the command was accepted (or refused); `permission`, `started` and the rest arrive through `sink`,
  // each naming its capture id.
  start(captureId: string, locale: string | null, sink: (event: HelperEvent) => void): Promise<VoiceStartResult>;
  stop(captureId: string): void;
  // Valid in every phase, the wait for `start`'s answer included: after it, the capture never opens the microphone.
  cancel(captureId: string): void;
  dispose(): void;
}
