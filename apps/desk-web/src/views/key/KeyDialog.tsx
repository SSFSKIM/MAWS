// The org key in this browser: unlock it, or — unlocked — see which key it is (its fingerprint, the same in every
// browser holding the same key), where it is kept, and lock it. A key the device failed to forget is reported whatever
// the state, with a retry, since a reload would load it again.
import type { Me } from '../../hub/me';
import { lock, useKeyHolder } from '../../key/holder';
import { buttonSecondary, Dialog } from '../common/Dialog';
import { UnlockForm } from './UnlockForm';

export function KeyDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const { state, fingerprint, kept, forgetError } = useKeyHolder();
  return (
    <Dialog title="Org key" onClose={onClose}>
      {forgetError !== null && <ForgetFailed org={me.org.id} reason={forgetError} />}
      {state === 'unlocked' ? (
        <div className="flex flex-col gap-3" data-testid="unlocked">
          <p className="m-0 text-ui">
            Unlocked {kept === 'device' ? 'on this device' : 'for this tab'}. Fingerprint{' '}
            <code className="font-mono text-ui" data-testid="fingerprint">
              {fingerprint}
            </code>
          </p>
          <p className="m-0 text-ui-sm leading-5 text-fg-muted">Every browser that holds your org key shows this same fingerprint; one that shows another holds another key.</p>
          <div>
            <button type="button" className={buttonSecondary} onClick={() => void lock(me.org.id)}>
              Lock
            </button>
          </div>
        </div>
      ) : (
        <UnlockForm me={me} />
      )}
    </Dialog>
  );
}

/** This tab no longer holds the key, but the device still does: a reload would unlock with it until it is forgotten. */
export function ForgetFailed({ org, reason }: { org: string; reason: string }) {
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-md border border-danger px-3 py-2 text-ui-sm" role="alert" data-testid="forget-failed">
      <p className="m-0 leading-5 text-danger">
        Locked in this tab, but this device could not forget the key it kept ({reason}). Reloading would unlock again until it is forgotten.
      </p>
      <div>
        <button type="button" className={buttonSecondary} onClick={() => void lock(org)}>
          Try again
        </button>
      </div>
    </div>
  );
}
