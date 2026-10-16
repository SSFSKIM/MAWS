// This device's notifications (§4: Web Push): on or off, and why not when it cannot be. A notification says only who
// wants what; tapping it opens the card here, where it is verified before it is drawn — nothing is answered from the
// notification itself (§6). iOS shows the permission prompt only from a tap, and only in the installed app.
import { useEffect, useState } from 'react';
import { browserPushEnv, disablePush, enablePush, pushState, retryPush, type PushState } from '../../push/device';
import { failureBehind, recordPushOutcome, usePushOutcome } from '../../push/outcome';
import { registerServiceWorker } from '../../pwa/service-worker';
import { buttonPrimary, buttonSecondary, Dialog } from '../common/Dialog';
import { explainPushFailure as explain } from './explain';

const env = () => browserPushEnv(registerServiceWorker());

export function NotificationsDialog({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    pushState(env()).then(
      (s) => {
        if (!live) return;
        // Why the last attempt (the start's, the banner's, or this panel's before) left the device as it is, when it
        // saw a failure the state cannot carry: the hub's refusal of this endpoint, or of its push key.
        const why = failureBehind(s, usePushOutcome.getState().outcome);
        if (why !== null && s.kind === 'unsynced') return setState({ ...s, error: why });
        if (why !== null) setError(explain(why));
        setState(s);
      },
      (e: unknown) => live && setError(explain(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  const act = (action: typeof enablePush) => {
    setBusy(true);
    setError(null);
    void recordPushOutcome(action(env()))
      .then((outcome) => {
        if (outcome && 'state' in outcome) setState(outcome.state);
        else if (outcome) setError(explain(outcome.error));
      })
      .finally(() => setBusy(false));
  };
  return (
    <Dialog title="Notifications" onClose={onClose}>
      <div className="flex flex-col gap-3 text-ui" data-testid="notifications" data-state={state?.kind ?? 'loading'}>
        {state && <StateText state={state} />}
        {error && (
          <p className="m-0 text-ui-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {state?.kind === 'off' && (
          <button type="button" className={`${buttonPrimary} self-start`} disabled={busy} onClick={() => act(enablePush)}>
            Turn on notifications
          </button>
        )}
        {state?.kind === 'unsynced' && (
          <div className="flex gap-2">
            <button type="button" className={buttonPrimary} disabled={busy} onClick={() => act(retryPush)}>
              Retry
            </button>
            <button type="button" className={buttonSecondary} disabled={busy} onClick={() => act(disablePush)}>
              Turn off on this device
            </button>
          </div>
        )}
        {state?.kind === 'on' && (
          <button type="button" className={`${buttonSecondary} self-start`} disabled={busy} onClick={() => act(disablePush)}>
            Turn off on this device
          </button>
        )}
        <p className="m-0 text-ui-sm leading-5 text-fg-muted">A notification says only who wants what. Tap it to open the card here, where it is checked before it is shown; nothing is answered from the notification itself.</p>
      </div>
    </Dialog>
  );
}

function StateText({ state }: { state: PushState }) {
  switch (state.kind) {
    case 'on':
      return <p className="m-0 font-medium">On for this device.</p>;
    case 'unsynced':
      return (
        <>
          <p className="m-0 leading-5">This device is subscribed, but the hub does not hold its subscription yet, so no notification reaches it.</p>
          {state.error !== null && (
            <p className="m-0 text-ui-sm text-danger" role="alert" data-testid="push-error">
              {explain(state.error)}
            </p>
          )}
        </>
      );
    case 'off':
      return <p className="m-0 leading-5">Get a notification on this device when a session asks you something or sends you a message, while no window of yours shows its project.</p>;
    case 'denied':
      return <p className="m-0 leading-5">Notifications are blocked for the desk on this device. Allow them in the system's settings (on iPhone: Settings › Notifications › Desk), then come back here.</p>;
    case 'needs-install':
      return <p className="m-0 leading-5">On iPhone, the desk can notify you only once it is on your Home Screen. In Safari, tap Share, then Add to Home Screen, and open the desk from there.</p>;
    case 'unsupported':
      return <p className="m-0 leading-5">This browser cannot receive notifications from the desk.</p>;
  }
}
