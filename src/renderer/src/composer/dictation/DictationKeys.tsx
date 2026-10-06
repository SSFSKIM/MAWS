// The app's one dictation controller and its key (E9 execution document, Design §6): mounted once from App.tsx beside
// ComposerAppKeys (and from the composer harness). Holding `composer.dictate` (⌥Space by default) presses for the
// focused pane's session, resolved centrally as ⌘L resolves it; letting go releases. Main's `voice.event`s reach the
// controller here, and the toolbar's microphone button reaches it through `mountedDictation`. Losing input (the window's
// blur, a hidden document) cancels any capture, the pointer's included.
import { useEffect, useMemo } from 'react';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { useKeyChord } from '../../keymap/useKeyChord';
import { useComposerStore } from '../../stores/composer';
import { useSettings } from '../../stores/settings';
import { focusedSession } from '../ComposerAppKeys';
import { DictationController, provideDictation } from './controller';

export function DictationKeys({ client = ipc }: { client?: MawsBridge }) {
  const controller = useMemo(
    () =>
      new DictationController(client, {
        target: (appSessionId) => useComposerStore.getState().focusTargets.get(appSessionId) ?? null,
        locale: () => useSettings.getState().state?.settings.voice.locale ?? null,
        now: () => Date.now(),
        setTimeout: (run, ms) => window.setTimeout(run, ms),
        clearTimeout: (handle) => window.clearTimeout(handle),
      }),
    [client],
  );
  useEffect(() => {
    const off = client.on('voice.event', (event) => controller.onEvent(event));
    const withdraw = provideDictation(controller);
    // Loss of input ends a capture whatever started it: the dispatcher's own 'lost' reaches only a key hold, and a
    // pointer released over another app or under a native permission dialog never reaches the button. A second release
    // on an idle controller does nothing, so a key hold is not cancelled twice.
    const lost = () => controller.release('lost');
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') lost();
    };
    window.addEventListener('blur', lost);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', lost);
      document.removeEventListener('visibilitychange', onVisibility);
      off();
      withdraw();
      controller.release('lost');
      controller.dispose();
    };
  }, [client, controller]);
  useKeyChord('composer.dictate', () => controller.press(focusedSession()), { onRelease: (reason) => controller.release(reason) });
  return null;
}
