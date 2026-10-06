// The app's one dictation controller and its key (E9 execution document, Design §6): mounted once from App.tsx beside
// ComposerAppKeys (and from the composer harness). Holding `composer.dictate` (unbound by default; a chord bound in
// Settings › Keyboard) presses for the focused pane's session, resolved centrally as ⌘L resolves it; letting go
// releases. Main's `voice.event`s reach the controller here, and the toolbar's microphone button, whose clicks toggle a
// capture, reaches it through `mountedDictation`. Losing input (the window's blur, a hidden document) cancels any
// capture, a click-started one included.
import { useEffect, useMemo } from 'react';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { useKeyChord } from '../../keymap/useKeyChord';
import { useComposerStore } from '../../stores/composer';
import { useSettings } from '../../stores/settings';
import { focusedSession } from '../ComposerAppKeys';
import { DictationController, provideDictation } from './controller';

const now = () => Date.now(); // the controller's clock, read when it runs, never during a render

export function DictationKeys({ client = ipc }: { client?: MawsBridge }) {
  const controller = useMemo(
    () =>
      new DictationController(client, {
        target: (appSessionId) => useComposerStore.getState().focusTargets.get(appSessionId) ?? null,
        locale: () => useSettings.getState().state?.settings.voice.locale ?? null,
        now,
        setTimeout: (run, ms) => window.setTimeout(run, ms),
        clearTimeout: (handle) => window.clearTimeout(handle),
      }),
    [client],
  );
  useEffect(() => {
    const off = client.on('voice.event', (event) => controller.onEvent(event));
    const withdraw = provideDictation(controller);
    // Loss of input ends a capture whatever started it: the dispatcher's own 'lost' reaches only a key hold, and a
    // click-started capture has no key whose release could report a switch to another app or a native permission
    // dialog. A second release on an idle controller does nothing, so a key hold is not cancelled twice.
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
