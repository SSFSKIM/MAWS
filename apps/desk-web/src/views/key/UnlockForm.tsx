// Unlocking the org key in this browser (§6; the DC5 plan's M2): from the owner's passkey through PRF, or from the
// passphrase where PRF is unavailable, kept for this tab or on this device as the owner chooses. Making the org's
// passkey is a separate, deliberate step: it is done once per org.
import { useEffect, useState, type FormEvent } from 'react';
import type { Me } from '../../hub/me';
import { passphraseProblem } from '../../key/derive';
import { beginUnlock, type Keep } from '../../key/holder';
import { PasskeyError, prfSupported } from '../../key/passkey';
import { deriveOrgKey, rememberedMethod, rememberMethod, type KeySource } from '../../key/unlock';
import { buttonPrimary, buttonQuiet, buttonSecondary, textInput } from '../common/Dialog';

type Busy = KeySource['kind'] | null;

export function UnlockForm({ me, onUnlocked }: { me: Me; onUnlocked?: () => void }) {
  const org = me.org.id;
  const [keep, setKeep] = useState<Keep>('session');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [prf, setPrf] = useState<boolean | null>(null);
  const remembered = rememberedMethod(org);
  useEffect(() => void prfSupported().then(setPrf), []);

  async function run(source: KeySource) {
    setBusy(source.kind);
    setError(null);
    setProgress(0);
    // Begun before the derivation, which takes seconds: a Lock pressed meanwhile wins, even after this form is gone.
    const attempt = beginUnlock(org);
    try {
      const raw = await deriveOrgKey(org, source);
      if (!(await attempt.finish(raw, keep))) return;
      rememberMethod(org, source.kind === 'passphrase' ? 'passphrase' : 'passkey');
      setPassphrase('');
      onUnlocked?.();
    } catch (failure) {
      setError(failure instanceof PasskeyError || failure instanceof TypeError ? failure.message : `Unlocking failed: ${String(failure)}`);
    } finally {
      setBusy(null);
    }
  }

  const submitPassphrase = (event: FormEvent) => {
    event.preventDefault();
    const problem = passphraseProblem(passphrase);
    if (problem) return setError(problem);
    void run({ kind: 'passphrase', passphrase, progress: setProgress });
  };

  return (
    <div className="flex flex-col gap-4 text-left" data-testid="unlock">
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">
        Your org key checks who wrote each project's log and signs what you send. It is derived here, from your passkey or your passphrase, and leaves this browser only inside a
        machine's enrollment code.
      </p>

      <section className="flex flex-col gap-2">
        <button type="button" className={buttonPrimary} disabled={busy !== null || prf === false} onClick={() => void run({ kind: 'passkey' })}>
          {busy === 'passkey' ? 'Waiting for your passkey…' : 'Unlock with passkey'}
        </button>
        {prf === false && <p className="m-0 text-ui-sm text-fg-muted">This browser cannot derive the key from a passkey. Use the passphrase.</p>}
      </section>

      <form className="flex flex-col gap-2" onSubmit={submitPassphrase} aria-label="Passphrase">
        <label className="text-ui-sm text-fg-muted" htmlFor="desk-passphrase">
          Or your passphrase{remembered === 'passphrase' ? ' (this browser used it last)' : ''}
        </label>
        <div className="flex gap-2">
          <input
            id="desk-passphrase"
            type="password"
            autoComplete="current-password"
            className={textInput}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            disabled={busy !== null}
          />
          <button type="submit" className={buttonSecondary} disabled={busy !== null || passphrase === ''}>
            Unlock
          </button>
        </div>
        {busy === 'passphrase' && (
          <p className="m-0 text-ui-sm text-fg-muted" role="status">
            Deriving the key… {Math.round(progress * 100)}%
          </p>
        )}
      </form>

      <label className="flex items-center gap-2 text-ui-sm">
        <input type="checkbox" checked={keep === 'device'} onChange={(event) => setKeep(event.target.checked ? 'device' : 'session')} disabled={busy !== null} />
        Keep unlocked on this device
        <span className="text-fg-muted">(otherwise it is forgotten when this tab closes)</span>
      </label>

      {error && (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <footer className="border-t border-border pt-3 text-ui-sm text-fg-muted">
        {creating ? (
          <div className="flex flex-col gap-2" data-testid="create-passkey">
            <p className="m-0 leading-5">
              Make the org's passkey once, in one browser; your other browsers use it through your passwords. Another passkey derives another key, which machines enrolled with
              this one refuse. With a passphrase instead, the first one you use is the org's.
            </p>
            <div className="flex gap-2">
              <button type="button" className={buttonSecondary} disabled={busy !== null} onClick={() => void run({ kind: 'new-passkey', orgName: me.org.name, email: me.member.email })}>
                {busy === 'new-passkey' ? 'Waiting for your passkey…' : 'Create the org passkey'}
              </button>
              <button type="button" className={buttonQuiet} onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={buttonQuiet} onClick={() => setCreating(true)} disabled={prf === false}>
            First time? Create the org's passkey
          </button>
        )}
      </footer>
    </div>
  );
}
