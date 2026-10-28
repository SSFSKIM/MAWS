// The Device panel (P5 O13 M3): this browser as a `web-cards` device of the org — the part of the desk that answers a
// cut-over machine's cards with a passkey. It takes the pairing code the owner's Mac prints (`deployment admin pair
// --class web-cards`), shows the entry's fingerprint while the Mac waits for the owner to compare it, then the device's
// state, its passkey's relying party, the org state's version and age, and this device's notifications; and Forget,
// which deletes the record and its keys here (the org state lists the device until the Mac removes it).
//
// Of the org state it draws the version and the head's age alone. While `deployment admin` is the org's one admin
// device nothing else signs a successor, and a machine refuses every remote action once the head is 30 days old
// (`src/endpoint/org-sync.ts`'s backstop), so from day 21 the panel says to refresh it.
import { useEffect, useState } from 'react';
import { formatClock } from '@shared/app/date-format';
import type { Me } from '../../hub/me';
import { browserPushEnv, pushState, type PushState } from '../../push/device';
import { registerServiceWorker } from '../../pwa/service-worker';
import { bootDevice } from '../../cards/boot';
import { deviceController, RegisterError, useDevice } from '../../cards/register';
import { CardsPasskeyError } from '../../cards/cards-passkey';
import { HubRequestError } from '../../hub/http';
import { buttonDanger, buttonPrimary, buttonSecondary, Dialog, textInput } from '../common/Dialog';

const DAY_MS = 86_400_000;
/** From this age the panel warns; the machines' backstop is 30 days. */
export const AGE_WARNING_DAYS = 21;

/** The head's age in whole days at `now`. */
export const ageInDays = (issued: string, now: number) => Math.max(0, Math.floor((now - Date.parse(issued)) / DAY_MS));

const REFUSED: Record<string, string> = {
  'bad-link': "it isn't the org this device's pairing code names (another recovery key, or another org)",
  'not-root-signed': "no root key the pairing code names signed it",
  rollback: 'it is older than the state this device holds',
  fork: 'it differs from the state this device holds at the same version',
};

function explain(error: unknown): string {
  if (error instanceof RegisterError || error instanceof CardsPasskeyError) return error.message;
  if (error instanceof HubRequestError) return `The hub refused the pairing (${error.code})${error.message !== error.code ? `: ${error.message}` : '.'}`;
  return error instanceof Error ? error.message : String(error);
}

export function DevicePanel({ me, onClose }: { me: Me; onClose: () => void }) {
  const { loaded, record, fingerprint, head, refused } = useDevice();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  // A browser that is no device yet starts the device's part here (cards/boot.ts); one that is started at the app's start.
  useEffect(() => void bootDevice(me), [me]);
  const deviceKey = record === null ? null : `${record.deviceId} ${record.state.kind}`;
  useEffect(() => {
    let live = true;
    pushState(browserPushEnv(registerServiceWorker())).then(
      (state) => live && setPush(state),
      () => live && setPush(null),
    );
    return () => {
      live = false;
    };
  }, [deviceKey]);

  const pair = () => {
    const controller = deviceController();
    if (controller === null) return setError('This device is still loading; try again in a moment.');
    setBusy(true);
    setError(null);
    controller
      .register(code, me)
      .then(() => setCode(''))
      .catch((e: unknown) => setError(explain(e)))
      .finally(() => setBusy(false));
  };
  const forget = () => {
    setBusy(true);
    void deviceController()
      ?.forget()
      .catch((e: unknown) => setError(explain(e)))
      .finally(() => {
        setBusy(false);
        setForgetting(false);
      });
  };

  const state = !loaded ? 'loading' : (record?.state.kind ?? 'none');
  const age = head === null ? null : ageInDays(head.issued, now);
  return (
    <Dialog title="Device" onClose={onClose}>
      <div className="flex flex-col gap-3 text-ui" data-testid="device-panel" data-state={state}>
        {state === 'loading' && <p className="m-0 text-fg-muted">Reading this device…</p>}
        {(state === 'none' || state === 'expired') && (
          <>
            {state === 'expired' ? (
              <p className="m-0 leading-5">The pairing expired before your Mac approved it. Pair again with a new code.</p>
            ) : (
              <p className="m-0 leading-5">Make this browser a device of the org that answers the cards of machines moved to MAWS, with a passkey. On your Mac, run <code>deployment admin pair --class web-cards</code> and paste the code it prints here.</p>
            )}
            <form
              aria-label="Pair"
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                pair();
              }}
            >
              <label className="flex flex-col gap-1 text-ui-sm text-fg-muted">
                Pairing code
                <textarea className={`${textInput} min-h-16 font-mono text-ui-sm break-all`} value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false} autoComplete="off" />
              </label>
              <button type="submit" className={`${buttonPrimary} self-start`} disabled={busy || code.trim() === ''}>
                {busy ? 'Pairing…' : 'Pair this device'}
              </button>
            </form>
          </>
        )}
        {record?.state.kind === 'pending' && (
          <>
            <p className="m-0 font-medium" data-testid="device-state">
              Waiting for approval on your Mac — fingerprint <span className="font-mono" data-testid="device-fingerprint">{fingerprint}</span>
            </p>
            <p className="m-0 text-ui-sm leading-5 text-fg-muted">
              Approve on the Mac only if it shows this same fingerprint. The code expires at {formatClock(Date.parse(record.state.expires))}.
            </p>
          </>
        )}
        {record?.state.kind === 'listed' && (
          <p className="m-0 font-medium" data-testid="device-state">
            Listed, version {record.state.version}
          </p>
        )}
        {record?.state.kind === 'removed' && (
          <p className="m-0 leading-5" data-testid="device-state">
            Removed from the org at version {record.state.version}: this device answers nothing now. Forget it here, then pair again if you mean to.
          </p>
        )}
        {refused !== null && record !== null && (
          <p className="m-0 text-ui-sm text-danger" role="alert" data-testid="device-refused">
            The hub served an org state this device didn't take: {REFUSED[refused] ?? `it doesn't verify (${refused})`}.
          </p>
        )}
        {error && (
          <p className="m-0 text-ui-sm text-danger" role="alert" data-testid="device-error">
            {error}
          </p>
        )}
        {head !== null && age !== null && record?.state.kind === 'listed' && (
          <p className="m-0 text-ui-sm text-fg-muted" data-testid="device-org-state">
            Org state version {head.version}, issued {age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`}.
          </p>
        )}
        {age !== null && age > AGE_WARNING_DAYS && record?.state.kind === 'listed' && (
          <p className="m-0 text-ui-sm text-danger" role="alert" data-testid="device-age-warning">
            The org state is {age} days old; run <code>deployment admin refresh</code> on your Mac before day 30, or this phone's answers stop.
          </p>
        )}
        {record !== null && (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-sm">
            <dt className="text-fg-muted">Device</dt>
            <dd className="m-0 truncate font-mono" data-testid="device-id">
              {record.deviceId}
            </dd>
            <dt className="text-fg-muted">Passkey for</dt>
            <dd className="m-0 truncate" data-testid="device-rp">
              {record.passkey.rpId}
            </dd>
            <dt className="text-fg-muted">Notifications</dt>
            <dd className="m-0" data-testid="device-push">
              {pushText(push)}
            </dd>
          </dl>
        )}
        {record !== null &&
          (forgetting ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <p className="m-0 text-ui-sm leading-5">
                Forget deletes this device's keys from this browser. The org state lists it until your Mac removes it: <code>deployment admin remove-device {record.deviceId}</code>.
              </p>
              <div className="flex gap-2">
                <button type="button" className={buttonDanger} disabled={busy} onClick={forget}>
                  Forget this device
                </button>
                <button type="button" className={buttonSecondary} disabled={busy} onClick={() => setForgetting(false)}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={`${buttonSecondary} self-start`} onClick={() => setForgetting(true)}>
              Forget…
            </button>
          ))}
      </div>
    </Dialog>
  );
}

/** This device's notifications in a few words, as the Notifications dialog reads them. */
function pushText(state: PushState | null): string {
  switch (state?.kind) {
    case undefined:
      return '…';
    case 'on':
      return 'On for this device';
    case 'unsynced':
      return 'Subscribed, but the hub does not hold it: open Notifications to retry';
    case 'off':
      return 'Off (turn them on in Notifications)';
    case 'denied':
      return 'Blocked in the system settings';
    case 'needs-install':
      return 'Add the desk to the Home Screen first';
    case 'unsupported':
      return 'Not available in this browser';
  }
}
