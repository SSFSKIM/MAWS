// The org key in this browser: unlock it (or set it up), or — unlocked — see which key it is (its fingerprint, the same
// in every browser holding the same key, and the org's own), where it is kept, and lock it; and the key's methods, each a
// copy the hub keeps locked: add one, remove one. An org with one method is told to add a second, since losing every
// method loses the key. A key the device failed to forget is reported whatever the state, with a retry, since a reload
// would load it again.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import type { OrgKey, WrappedKeyRecord, WrappedKeys } from 'desk-hub/protocol';
import type { Me } from '../../hub/me';
import { checkFingerprint, passphraseWork, subscribePassphraseWork } from '../../key/derive';
import { lock, stillHolds, useKeyHolder } from '../../key/holder';
import { addMethod, prepareMethod, rememberedMethod, removeMethod, type NewMethod, type OrgMethod, type PreparedMethod } from '../../key/unlock';
import { listWrappedKeys, WRAPPED_KEYS_QUERY } from '../../key/wrapped-keys';
import { buttonQuiet, buttonSecondary, Dialog } from '../common/Dialog';
import { explainKeyFailure } from './explain';
import { methodLabel } from './labels';
import { NewMethodForm } from './NewMethodForm';
import { OrgMethodForm } from './OrgMethodForm';
import { UnlockForm } from './UnlockForm';

export function KeyDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const { state, key, fingerprint, kept, forgetError } = useKeyHolder();
  return (
    <Dialog title="Org key" onClose={onClose}>
      {forgetError !== null && <ForgetFailed org={me.org.id} reason={forgetError} />}
      {state === 'unlocked' && key ? (
        <div className="flex flex-col gap-3" data-testid="unlocked">
          <p className="m-0 text-ui">
            Unlocked {kept === 'device' ? 'on this device' : 'for this tab'}. Fingerprint{' '}
            <code className="font-mono text-ui" data-testid="fingerprint">
              {fingerprint}
            </code>
          </p>
          <p className="m-0 text-ui-sm leading-5 text-fg-muted">Every browser that holds your org key shows this same fingerprint; one that shows another holds another key.</p>
          <PassphraseWork />
          <div>
            <button type="button" className={buttonSecondary} onClick={() => void lock(me.org.id)}>
              Lock
            </button>
          </div>
          <Methods me={me} held={key} fingerprint={fingerprint} />
        </div>
      ) : (
        <UnlockForm me={me} />
      )}
    </Dialog>
  );
}

/** The org key's methods, for a browser that holds the key. */
/** What the passphrase cost this device, once it was used in this tab (Argon2id: the phone's time is the owner's to read). */
function PassphraseWork() {
  // Subscribed, so a derivation made while the dialog is open (a passphrase method added) shows here at once.
  const work = useSyncExternalStore(subscribePassphraseWork, passphraseWork);
  if (!work) return null;
  return (
    <p className="m-0 text-ui-sm text-fg-muted" data-testid="passphrase-work">
      Deriving from the passphrase took {(work.ms / 1000).toFixed(1)} s on this device (Argon2id, {Math.round(work.cost.m / 1024)} MiB, t {work.cost.t}, p {work.cost.p}).
    </p>
  );
}

function Methods({ me, held, fingerprint }: { me: Me; held: OrgKey; fingerprint: string | null }) {
  const keys = useQuery({ queryKey: WRAPPED_KEYS_QUERY, queryFn: listWrappedKeys });
  const queries = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = me.member.role === 'admin';
  const changed = () => void queries.invalidateQueries({ queryKey: WRAPPED_KEYS_QUERY });
  if (keys.isPending) return null;
  if (keys.isError) {
    return (
      <p className="m-0 text-ui-sm text-danger" role="alert">
        The hub did not list the org key's methods: {keys.error.message}
      </p>
    );
  }
  const { key_check, keys: copies } = keys.data;
  const orgFingerprint = key_check === null ? null : checkFingerprint(key_check);

  const remove = async (copy: WrappedKeyRecord) => {
    setError(null);
    try {
      await removeMethod(copy.id, held);
    } catch (failure) {
      setError(explainKeyFailure(failure, 'change'));
    } finally {
      changed();
    }
  };

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-3" aria-label="Methods" data-testid="methods">
      {orgFingerprint !== null && orgFingerprint !== fingerprint && (
        <p className="m-0 rounded-md border border-danger px-3 py-2 text-ui-sm leading-5 text-danger" role="alert" data-testid="other-key">
          This browser holds another key than the org's (the org's fingerprint is <code className="font-mono">{orgFingerprint}</code>). Lock it, and unlock with one of the org's
          methods.
        </p>
      )}
      {copies.length === 1 && (
        <p className="m-0 rounded-md border border-warning px-3 py-2 text-ui-sm leading-5" data-testid="one-method">
          This is the org key's only method. If it is lost, so is the key: enrolled machines hold it, but nothing reads it back from them. Add a second method now.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-ui-sm font-semibold">Unlock methods</h3>
        {copies.length === 0 ? (
          <p className="m-0 text-ui-sm text-fg-muted">The hub holds no copy of the org key.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {copies.map((copy) => (
              <Method key={copy.id} copy={copy} removable={admin && copies.length > 1} onRemove={() => remove(copy)} />
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p className="m-0 text-ui-sm text-danger" role="alert" data-testid="key-error">
          {error}
        </p>
      )}
      {admin &&
        key_check !== null &&
        (adding ? (
          <AddMethod
            me={me}
            keys={keys.data}
            held={held}
            onDone={() => {
              setAdding(false);
              changed();
            }}
          />
        ) : (
          <div>
            <button type="button" className={buttonSecondary} onClick={() => (setAdding(true), setError(null))}>
              Add a method
            </button>
          </div>
        ))}
    </section>
  );
}

function Method({ copy, removable, onRemove }: { copy: WrappedKeyRecord; removable: boolean; onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-wrap items-baseline gap-2 border-b border-border py-1.5 text-ui last:border-b-0" data-method={copy.label} data-key={copy.id}>
      <span className="font-medium">{copy.label}</span>
      <span className="text-ui-sm text-fg-muted">{copy.method}</span>
      {removable &&
        (confirming ? (
          <span className="ml-auto flex items-baseline gap-2 text-ui-sm">
            Remove it? A browser that unlocks only with it can't any more.
            <button type="button" className={buttonQuiet} disabled={busy} onClick={() => (setBusy(true), void onRemove().finally(() => (setBusy(false), setConfirming(false))))}>
              Remove
            </button>
            <button type="button" className={buttonQuiet} disabled={busy} onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className={`${buttonQuiet} ml-auto`} onClick={() => setConfirming(true)} aria-label={`Remove ${copy.label}`}>
            Remove
          </button>
        ))}
    </li>
  );
}

/**
 * Adding a method: the new one first (a passkey made now, or a passphrase typed twice), its wrapping key held, then a
 * method the org already has, which opens the key's bytes once; a copy is locked under the new method and the bytes
 * wiped. Two steps, two clicks: a browser may refuse a second passkey prompt from one click.
 */
function AddMethod({ me, keys, held, onDone }: { me: Me; keys: WrappedKeys; held: OrgKey; onDone: () => void }) {
  const org = me.org.id;
  const [prepared, setPrepared] = useState<{ method: PreparedMethod; kind: NewMethod['kind'] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prepare = async (method: NewMethod) => {
    setError(null);
    try {
      setPrepared({ method: await prepareMethod(org, method), kind: method.kind });
    } catch (failure) {
      setError(explainKeyFailure(failure, 'change'));
    }
  };
  const confirm = async (method: OrgMethod) => {
    if (!prepared) return;
    setError(null);
    try {
      // A Lock pressed while the confirmation ran wins: no copy goes out for a key this tab no longer holds.
      await addMethod(org, keys, prepared.method, methodLabel(prepared.kind), method, held, () => stillHolds(held));
      onDone();
    } catch (failure) {
      setError(explainKeyFailure(failure, 'change'));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3" data-testid="add-method">
      {prepared === null ? (
        <>
          <p className="m-0 text-ui-sm leading-5 text-fg-muted">The new method first. A passkey made here syncs to your other browsers through your passwords.</p>
          <NewMethodForm me={me} passkeyText="Add a passkey" passphraseText="Add" onMethod={prepare} />
        </>
      ) : (
        <>
          <p className="m-0 text-ui-sm leading-5">Now confirm with a method the org already has: it opens the key, which is then locked for the new {prepared.kind} too.</p>
          <OrgMethodForm keys={keys} passkeyText="Confirm with passkey" passphraseText="Confirm" preferred={rememberedMethod(org)} onMethod={confirm} />
        </>
      )}
      {error && (
        <p className="m-0 text-ui-sm text-danger" role="alert" data-testid="key-error">
          {error}
        </p>
      )}
      <div>
        <button type="button" className={buttonQuiet} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
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
