// Opening the org key with a method it already has — to unlock, to confirm a new method, to confirm an enrollment: one
// of the org's passkeys (the browser offers only those) or its passphrase, as the org's copies allow. A browser that
// can't use PRF with a passkey is told so plainly, with the passphrase offered where the org has one.
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { WrappedKeys } from 'desk-hub/protocol';
import { passphraseProblem } from '../../key/derive';
import { prfSupported } from '../../key/passkey';
import type { KeyMethod, OrgMethod } from '../../key/unlock';
import { buttonPrimary, buttonSecondary, textInput } from '../common/Dialog';

/** Whether this browser says it can evaluate PRF: null until it answers, or when it does not say (trying tells). */
export function usePrfSupport(): boolean | null {
  const [prf, setPrf] = useState<boolean | null>(null);
  useEffect(() => void prfSupported().then(setPrf), []);
  return prf;
}

export const NO_PRF_HERE = "This browser can't use a passkey for the org key: it has no WebAuthn PRF, the extension the key's copies are locked with.";

export function OrgMethodForm(props: {
  keys: WrappedKeys;
  /** What each control says, e.g. "Unlock with passkey" and "Unlock". */
  passkeyText: string;
  passphraseText: string;
  /** The method this browser used last, drawn first. */
  preferred: KeyMethod | null;
  disabled?: boolean;
  onMethod: (method: OrgMethod) => Promise<void>;
}) {
  const { keys, passkeyText, passphraseText, preferred, disabled = false, onMethod } = props;
  const prf = usePrfSupport();
  const [busy, setBusy] = useState<KeyMethod | null>(null);
  const [progress, setProgress] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const field = useId();
  const hasPasskey = keys.keys.some((k) => k.method === 'passkey');
  const hasPassphrase = keys.keys.some((k) => k.method === 'passphrase');
  const off = disabled || busy !== null;

  async function run(method: OrgMethod) {
    setBusy(method.kind);
    setProgress(0);
    setProblem(null);
    try {
      await onMethod(method);
    } finally {
      setBusy(null);
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = passphraseProblem(passphrase);
    if (found) return setProblem(found);
    void run({ kind: 'passphrase', passphrase, progress: setProgress });
  };

  return (
    <div className="flex flex-col gap-3">
      {hasPasskey && (
        <section className="flex flex-col gap-2">
          <button type="button" className={preferred === 'passphrase' && hasPassphrase ? buttonSecondary : buttonPrimary} disabled={off || prf === false} onClick={() => void run({ kind: 'passkey' })}>
            {busy === 'passkey' ? 'Waiting for your passkey…' : passkeyText}
          </button>
          {prf === false && (
            <p className="m-0 text-ui-sm leading-5 text-fg-muted" data-testid="no-prf">
              {NO_PRF_HERE} {hasPassphrase ? 'Use the passphrase.' : 'The org has no passphrase: unlock in a browser that can, and add one there.'}
            </p>
          )}
        </section>
      )}
      {hasPassphrase && (
        <form className="flex flex-col gap-2" onSubmit={submit} aria-label="Passphrase">
          <label className="text-ui-sm text-fg-muted" htmlFor={field}>
            {hasPasskey ? 'Or the passphrase' : 'The passphrase'}
            {preferred === 'passphrase' ? ' (this browser used it last)' : ''}
          </label>
          <div className="flex gap-2">
            <input
              id={field}
              type="password"
              autoComplete="current-password"
              className={textInput}
              value={passphrase}
              onChange={(event) => (setPassphrase(event.target.value), setProblem(null))}
              disabled={off}
            />
            <button type="submit" className={preferred === 'passphrase' || !hasPasskey ? buttonPrimary : buttonSecondary} disabled={off || passphrase === ''}>
              {passphraseText}
            </button>
          </div>
          {busy === 'passphrase' && (
            <p className="m-0 text-ui-sm text-fg-muted" role="status">
              Deriving the key… {Math.round(progress * 100)}%
            </p>
          )}
        </form>
      )}
      {problem && (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
