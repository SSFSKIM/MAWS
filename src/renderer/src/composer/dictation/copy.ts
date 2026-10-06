// The dictation notices' words (E9 execution document, Design §4 and §6): a refused start by its reason, an error by its
// code. A denial names its System Settings pane (the toolbar adds the button that opens it); a language with no
// on-device model points at where macOS downloads them.
import type { VoicePermission, VoiceErrorCode, VoiceStartResult } from '@shared/ipc/schema/voice';
import type { DictationNoticeKind } from './store';

// The toolbar microphone's tooltip: a click is the primary way (the owner's ruling, 2026-10-06), and a chord bound to
// `composer.dictate` in Settings › Keyboard is named as the hold that does the same.
export const micTitle = (chord: string | null): string => `Click to dictate · on this Mac${chord === null ? '' : ` · or hold ${chord}`}`;

export interface NoticeCopy {
  kind: DictationNoticeKind;
  message: string;
}

export const NO_EDITOR: NoticeCopy = { kind: 'no_editor', message: 'Dictation needs a composer that can take text' };
const BUSY: NoticeCopy = { kind: 'busy', message: 'Another dictation is still finishing' };
const UNAVAILABLE = 'Dictation is unavailable';
const HELPER_DID_NOT_START: NoticeCopy = { kind: 'unavailable', message: `${UNAVAILABLE} · the helper did not start` };

export const failed = (message: string): NoticeCopy => ({ kind: 'failed', message: message.trim() === '' ? 'Dictation failed' : `Dictation failed · ${message}` });

// `cancelled` says nothing: the hold ended before main answered, which the human did themselves.
export function refusalNotice(refusal: Extract<VoiceStartResult, { accepted: false }>): NoticeCopy | null {
  switch (refusal.reason) {
    case 'busy':
      return BUSY;
    case 'helper_missing':
      return { kind: 'unavailable', message: `${UNAVAILABLE} · helper not found at ${refusal.path ?? 'its build path'}${import.meta.env.DEV ? ' · run pnpm build:helper' : ''}` };
    case 'helper_failed':
      return HELPER_DID_NOT_START;
    case 'e2e_refused':
      return { kind: 'unavailable', message: 'Dictation is off under the test harness' };
    case 'cancelled':
      return null;
  }
}

// `permission`: the states the capture's `permission` event reported, if one came (a restricted service, an MDM
// policy, cannot be turned on by the owner).
export function errorNotice(code: VoiceErrorCode, message: string, permission: VoicePermission | null): NoticeCopy {
  const restricted = (state: VoicePermission['microphone'] | undefined) => (state === 'restricted' ? ' and cannot be turned on here' : '');
  switch (code) {
    case 'microphone_denied':
      return { kind: 'microphone_denied', message: `Microphone access is off for MAWS${restricted(permission?.microphone)}` };
    case 'speech_denied':
      return { kind: 'speech_denied', message: `Speech recognition is off for MAWS${restricted(permission?.speech)}` };
    case 'on_device_unavailable':
      return { kind: 'unavailable', message: `${UNAVAILABLE} · this language has no on-device model · download it in System Settings › Keyboard › Dictation` };
    case 'locale_unsupported':
      return { kind: 'unavailable', message: `${UNAVAILABLE} · Apple's speech recognition does not support this language` };
    case 'recognizer_unavailable':
      return { kind: 'unavailable', message: `${UNAVAILABLE} · speech recognition is not available right now` };
    case 'helper_crashed':
      return { kind: 'unavailable', message: `${UNAVAILABLE} · the helper stopped` };
    case 'helper_failed':
      return HELPER_DID_NOT_START;
    case 'busy':
      return BUSY;
    case 'audio_failed':
    case 'recognition_failed':
    case 'bad_request':
      return failed(message);
  }
}
