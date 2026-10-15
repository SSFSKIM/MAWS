// The grid's one-time banner offering notifications in the installed app (src/push/banner.ts says when it is due).
// Turn on is the tap iOS needs for its permission prompt; whatever the answer, the banner goes, and Menu keeps the
// lasting control. Not now hides it for good on this device.
import { useEffect, useState } from 'react';
import { useKeyHolder } from '../../key/holder';
import { bannerDismissed, bannerDue, dismissBanner } from '../../push/banner';
import { browserPushEnv, enablePush, pushState, type PushEnv, type PushState } from '../../push/device';
import { isInstalledApp } from '../../pwa/installed';
import { registerServiceWorker } from '../../pwa/service-worker';

const deviceEnv = () => browserPushEnv(registerServiceWorker());

/** The banner where it is due: the installed app, unlocked, notifications off, never dismissed. */
export function GridPushBanner() {
  const unlocked = useKeyHolder((s) => s.state === 'unlocked');
  const [state, setState] = useState<PushState | null>(null);
  const installed = isInstalledApp();
  useEffect(() => {
    if (!installed || !unlocked || bannerDismissed()) return;
    let live = true;
    pushState(deviceEnv()).then(
      (s) => live && setState(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [installed, unlocked]);
  if (!bannerDue({ installed, unlocked, state, dismissed: bannerDismissed() })) return null;
  return <PushBanner env={deviceEnv} onDone={() => setState(null)} />;
}

export function PushBanner({ env, onDone }: { env: () => PushEnv; onDone?: () => void }) {
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (gone) return null;
  const finish = () => {
    setGone(true);
    onDone?.();
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-bg-raised px-4 py-2.5 text-ui-sm md:px-6" role="region" aria-label="Notifications" data-testid="push-banner">
      <span className="min-w-0 flex-1 text-fg">Get a notification when a session asks you something, even with the app closed.</span>
      <button
        type="button"
        className="h-9 rounded-md border border-fg bg-fg px-3 font-medium text-bg"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          // Any answer ends the offer: on, a refusal (iOS asks only once), or a failure Menu's panel can retry.
          void enablePush(env())
            .catch(() => null)
            .finally(() => {
              dismissBanner();
              finish();
            });
        }}
      >
        Turn on
      </button>
      <button
        type="button"
        className="h-9 rounded-md px-2 text-fg-muted hover:bg-bg-hover hover:text-fg"
        onClick={() => {
          dismissBanner();
          finish();
        }}
      >
        Not now
      </button>
    </div>
  );
}
