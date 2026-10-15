// Unlocking the org key in this browser (§6; DX7's wrapped keys; the DC5 plan's M2b), kept for this tab or on this
// device as the owner chooses. An org with no key yet is set up here, once: the browser draws the key at random and
// locks its first copy with a passkey or a passphrase. An org with a key is unlocked with any of its methods.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OrgKey, WrappedKeys } from 'desk-hub/protocol';
import type { Me } from '../../hub/me';
import { beginUnlock, type Keep } from '../../key/holder';
import { prepareMethod, rememberedMethod, rememberMethod, setUpOrgKey, unlockOrgKey, type NewMethod, type OrgMethod } from '../../key/unlock';
import { listWrappedKeys, WRAPPED_KEYS_QUERY } from '../../key/wrapped-keys';
import { explainKeyFailure } from './explain';
import { methodLabel } from './labels';
import { NewMethodForm } from './NewMethodForm';
import { OrgMethodForm } from './OrgMethodForm';
import { isInstalledApp } from '../../pwa/installed';
import { useSecondMethodPrompt } from './second-method';

export function UnlockForm({ me, onUnlocked }: { me: Me; onUnlocked?: () => void }) {
  const org = me.org.id;
  const keys = useQuery({ queryKey: WRAPPED_KEYS_QUERY, queryFn: listWrappedKeys });
  const queries = useQueryClient();
  // The installed app keeps the key on the device unless the owner unticks it; a browser tab forgets it with the tab.
  const [keep, setKeep] = useState<Keep>(() => (isInstalledApp() ? 'device' : 'session'));
  const [error, setError] = useState<string | null>(null);
  /** An attempt is running: where the key is kept is fixed at its start, so the control stays as it was until it ends. */
  const [running, setRunning] = useState(false);

  /** Begun before the method's prompt and derivation: a Lock pressed meanwhile wins, even after this form is gone. */
  async function attempt(work: (stillWanted: () => boolean) => Promise<OrgKey>, step: 'set-up' | 'unlock', method: NewMethod | OrgMethod) {
    setError(null);
    setRunning(true);
    const unlocking = beginUnlock(org);
    try {
      if (!(await unlocking.finish(await work(unlocking.current), keep))) return;
      rememberMethod(org, method.kind);
      if (step === 'set-up') useSecondMethodPrompt.setState({ due: true });
      onUnlocked?.();
    } catch (failure) {
      setError(explainKeyFailure(failure, step));
    } finally {
      setRunning(false);
      if (step === 'set-up') void queries.invalidateQueries({ queryKey: WRAPPED_KEYS_QUERY });
    }
  }

  const setUp = (method: NewMethod) => attempt(async (stillWanted) => setUpOrgKey(org, await prepareMethod(org, method), methodLabel(method.kind), stillWanted), 'set-up', method);
  const unlock = (wrapped: WrappedKeys) => (method: OrgMethod) => attempt(() => unlockOrgKey(org, wrapped, method), 'unlock', method);

  return (
    <div className="flex flex-col gap-4 text-left" data-testid="unlock">
      {keys.isPending ? (
        <p className="m-0 text-ui-sm text-fg-muted">Reading the org key's methods…</p>
      ) : keys.isError ? (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          The hub did not list the org key's methods: {keys.error.message}
        </p>
      ) : keys.data.key_check === null ? (
        <SetUp me={me} onMethod={setUp} />
      ) : (
        <>
          <p className="m-0 text-ui-sm leading-5 text-fg-muted">
            Your org key checks who wrote each project's log and signs what you send. The hub keeps it locked, one copy per method; it is opened here, and leaves this browser
            only inside a machine's enrollment code.
          </p>
          <OrgMethodForm keys={keys.data} passkeyText="Unlock with passkey" passphraseText="Unlock" preferred={rememberedMethod(org)} onMethod={unlock(keys.data)} />
        </>
      )}

      <label className="flex items-center gap-2 text-ui-sm">
        <input type="checkbox" checked={keep === 'device'} onChange={(event) => setKeep(event.target.checked ? 'device' : 'session')} disabled={running} />
        Keep unlocked on this device
        <span className="text-fg-muted">(otherwise it is forgotten when this tab closes)</span>
      </label>

      {error && (
        <p className="m-0 text-ui-sm text-danger" role="alert" data-testid="key-error">
          {error}
        </p>
      )}
    </div>
  );
}

function SetUp({ me, onMethod }: { me: Me; onMethod: (method: NewMethod) => Promise<void> }) {
  if (me.member.role !== 'admin') return <p className="m-0 text-ui-sm leading-5 text-fg-muted">The org has no key yet. An admin of the org sets it up.</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="set-up">
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">
        This org has no key yet. Set it up once, here: this browser draws it at random and locks a copy with a passkey or a passphrase. The hub keeps only locked copies; the key
        leaves this browser only inside a machine's enrollment code.
      </p>
      <NewMethodForm me={me} passkeyText="Set up with a passkey" passphraseText="Set up" onMethod={onMethod} />
    </div>
  );
}
