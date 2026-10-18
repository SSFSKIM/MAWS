// A new way to unlock the org key — at the org's first setup, or added later: a passkey made now, or a passphrase typed
// twice (a mistyped one would lock a copy no one can open). A browser that can't use PRF with a passkey is told so
// plainly and offered the passphrase.
import { useId, useState, type FormEvent } from 'react';
import type { Me } from '../../hub/me';
import { passphraseProblem } from '../../key/derive';
import type { KeyMethod, NewMethod } from '../../key/unlock';
import { buttonPrimary, buttonSecondary, textInput } from '../common/Dialog';
import { NO_PRF_HERE, usePrfSupport } from './OrgMethodForm';

export function NewMethodForm(props: { me: Me; passkeyText: string; passphraseText: string; disabled?: boolean; onMethod: (method: NewMethod) => Promise<void> }) {
  const { me, passkeyText, passphraseText, disabled = false, onMethod } = props;
  const prf = usePrfSupport();
  const [busy, setBusy] = useState<KeyMethod | null>(null);
  const [progress, setProgress] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const first = useId();
  const second = useId();
  const off = disabled || busy !== null;

  async function run(method: NewMethod) {
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
    const found = passphraseProblem(passphrase) ?? (passphrase !== again ? 'The two passphrases differ.' : null);
    if (found) return setProblem(found);
    void run({ kind: 'passphrase', passphrase, progress: setProgress });
  };

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-2">
        <button type="button" className={buttonPrimary} disabled={off || prf === false} onClick={() => void run({ kind: 'passkey', orgName: me.org.name, email: me.member.email })}>
          {busy === 'passkey' ? 'Waiting for your passkey…' : passkeyText}
        </button>
        {prf === false && (
          <p className="m-0 text-ui-sm leading-5 text-fg-muted" data-testid="no-prf">
            {NO_PRF_HERE} Use a passphrase here.
          </p>
        )}
      </section>
      <form className="flex flex-col gap-2" onSubmit={submit} aria-label="New passphrase">
        <label className="text-ui-sm text-fg-muted" htmlFor={first}>
          Or a passphrase, at least 12 characters
        </label>
        <input id={first} type="password" autoComplete="new-password" className={textInput} value={passphrase} onChange={(event) => (setPassphrase(event.target.value), setProblem(null))} disabled={off} />
        <label className="text-ui-sm text-fg-muted" htmlFor={second}>
          The passphrase again
        </label>
        <div className="flex gap-2">
          <input id={second} type="password" autoComplete="new-password" className={textInput} value={again} onChange={(event) => (setAgain(event.target.value), setProblem(null))} disabled={off} />
          <button type="submit" className={buttonSecondary} disabled={off || passphrase === '' || again === ''}>
            {passphraseText}
          </button>
        </div>
        {busy === 'passphrase' && (
          <p className="m-0 text-ui-sm text-fg-muted" role="status">
            Deriving the key… {Math.round(progress * 100)}%
          </p>
        )}
      </form>
      {problem && (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
