// What the dictation controller shows (E9 execution document, Design §6): the one capture app-wide (one microphone) with
// the session it writes into, and the latest notice with the session whose toolbar shows it. The controller is the only
// writer; the microphone control reads both by session.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';

export type DictationPhase = 'requesting' | 'listening' | 'finishing';

export interface DictationCapture {
  appSessionId: AppSessionId;
  captureId: string;
  phase: DictationPhase;
  locale: string | null; // the recognizer's, once `started` names it
  interim: string; // the latest partial
}

export type DictationNoticeKind = 'microphone_denied' | 'speech_denied' | 'unavailable' | 'failed' | 'busy' | 'no_editor';

// Shown in that session's toolbar until the next capture there starts listening, or its × is pressed.
export interface DictationNotice {
  appSessionId: AppSessionId;
  kind: DictationNoticeKind;
  message: string;
}

export interface DictationState {
  capture: DictationCapture | null;
  notice: DictationNotice | null;
}

export const useDictationStore = create<DictationState>()(() => ({ capture: null, notice: null }));

export function dismissDictationNotice(appSessionId: AppSessionId): void {
  if (useDictationStore.getState().notice?.appSessionId === appSessionId) useDictationStore.setState({ notice: null });
}

export function resetDictationStore(): void {
  useDictationStore.setState({ capture: null, notice: null });
}
