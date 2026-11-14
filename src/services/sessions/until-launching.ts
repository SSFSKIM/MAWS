// A setup's answer for an asker on another machine, which no `session.setup` event reaches (P5 O7 M4's spawn; the UX
// wave, U9 M2, a fork): its `launching` (null: the record exists and the launch is under way), or its `failed` (the
// error's own sentence). Tapped before the start, since its setup's events may come before the start's answer.
import type { AppSessionId } from '@shared/graph/ids';
import type { SetupEvent } from '@shared/sessions/setup';

/** A way to hear the setups' events: the services bus's `onEmitted('session.setup', …)`, or the session service's own. */
export type OnSetup = (listener: (event: SetupEvent) => void) => () => void;

export function untilLaunching(onSetup: OnSetup, appSessionId: AppSessionId): { done: Promise<string | null>; cancel(): void } {
  let off = () => {};
  const done = new Promise<string | null>((resolve) => {
    off = onSetup((event) => {
      if (event.appSessionId !== appSessionId) return;
      if (event.phase === 'launching' || event.phase === 'ready') resolve(null);
      else if (event.phase === 'failed') resolve(event.outcome?.kind === 'error' ? event.outcome.message : (event.detail ?? `the setup failed (${event.outcome?.kind ?? 'unknown'})`));
      else return;
      off();
    });
  });
  return { done, cancel: () => off() };
}
