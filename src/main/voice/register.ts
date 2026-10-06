// Main's `voice.*` handlers and the backend choice (E9 execution document, Design §3). The backend is chosen once, at
// startup, gated as the other end-to-end seams are (`src/main/files/e2e-pick.ts`, `src/main/sessions/e2e-trash.ts`):
// under `MAWS_E2E=1` with `MAWS_E2E_VOICE` set, the scripted backend; under `MAWS_E2E=1` without it, the real helper in
// probe-only mode (its reads never prompt, and `start` is refused), so the packaged run proves the bundled helper
// launches without ever opening the microphone; otherwise the real helper. Outside the harness `MAWS_E2E_VOICE` means
// nothing.
import type { CommandName } from '@shared/ipc/schema';
import type { VoiceEvent } from '@shared/ipc/schema/voice';
import type { MainHandler } from '../ipc/router';
import type { VoiceBackend } from './backend';
import { HelperBackend, helperPath } from './helper-backend';
import { ScriptedBackend, voiceScriptLog } from './scripted-backend';
import { VoiceService } from './service';

type Register = <N extends CommandName>(name: N, handler: MainHandler<N>) => void;

export function registerVoiceHandlers(service: VoiceService, register: Register): void {
  register('voice.status', ({ locale }) => service.status(locale));
  register('voice.start', (input, { sender }) => service.start(input, sender));
  register('voice.stop', (input, { sender }) => service.stop(input, sender));
  register('voice.cancel', (input, { sender }) => service.cancel(input, sender));
  register('voice.openPrivacySettings', ({ pane }) => service.openPrivacySettings(pane));
}

export interface StartVoiceOptions {
  env: NodeJS.ProcessEnv; // read again at each scripted probe and start, so pass main's own `process.env`
  packaged: boolean;
  appRoot: string; // the development app root (`process.cwd()`), where `pnpm build:helper` writes
  resourcesPath: string; // the packaged app's `Contents/Resources`
  emit(event: VoiceEvent): void;
  openExternal(url: string): Promise<void>;
  register: Register;
}

export function startVoice({ env, packaged, appRoot, resourcesPath, emit, openExternal, register }: StartVoiceOptions): { dispose(): void } {
  const e2e = env.MAWS_E2E === '1';
  const path = helperPath({ env, packaged, resourcesPath, appRoot });
  const scripted = e2e && env.MAWS_E2E_VOICE !== undefined;
  const backend: VoiceBackend = scripted ? new ScriptedBackend({ env, path }) : new HelperBackend({ path, probeOnly: e2e });
  if (e2e) {
    // What the end-to-end spec reads through `electronApp.evaluate`; never set outside the harness.
    (globalThis as { __mawsVoiceBackend?: string }).__mawsVoiceBackend = scripted ? 'scripted' : 'helper-probe-only';
    voiceScriptLog();
  }
  const service = new VoiceService(backend, { emit, openExternal, e2e });
  registerVoiceHandlers(service, register);
  return { dispose: () => service.dispose() };
}
