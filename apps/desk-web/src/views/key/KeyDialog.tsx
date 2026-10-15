// The org key in this browser: unlock it, or — unlocked — see which key it is (its fingerprint, the same in every
// browser holding the same key), where it is kept, and lock it.
import { useState } from 'react';
import type { Me } from '../../hub/me';
import { lock, useKeyHolder } from '../../key/holder';
import { buttonSecondary, Dialog } from '../common/Dialog';
import { UnlockForm } from './UnlockForm';

export function KeyDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const { state, fingerprint, kept } = useKeyHolder();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Org key" onClose={onClose}>
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
            <button type="button" className={buttonSecondary} onClick={() => void lock(me.org.id).catch((failure: unknown) => setError(`Forgetting the key failed: ${String(failure)}`))}>
              Lock
            </button>
          </div>
          {error && (
            <p className="m-0 text-ui-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <UnlockForm me={me} />
      )}
    </Dialog>
  );
}
