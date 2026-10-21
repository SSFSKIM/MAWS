// The two steps every code the Machines dialog makes goes through (§6, DX7; the provisioning-keys spec, §5): a
// confirmation with one of the org key's methods, and the code shown once. The confirmation opens the key's copy once
// more as bytes (the held key cannot be read), checks they are the held key, and hands them to what it confirms — a
// one-time enrollment, a provisioning key — which asks the hub for its token, builds the code around the bytes, and
// wipes them. The code step shows the code with what to do with it; closing it discards the code: nothing keeps it.
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { Me } from '../../hub/me';
import { useKeyHolder } from '../../key/holder';
import { openOrgKeyBytes, rememberedMethod, type OrgMethod } from '../../key/unlock';
import { listWrappedKeys, WRAPPED_KEYS_QUERY } from '../../key/wrapped-keys';
import { buttonPrimary, buttonQuiet, buttonSecondary } from '../common/Dialog';
import { OrgMethodForm } from '../key/OrgMethodForm';

/** A code made, and what the owner is told to do with it. */
export type Issued = {
  code: string;
  /** Where the code goes, drawn above it. */
  instructions: ReactNode;
  /** Where the code may be kept, drawn below it: it holds the org key. */
  keep: string;
};

/** What a confirmation is for. */
export type Confirming = {
  /** The question, as the owner reads it. */
  question: ReactNode;
  /** What the code will do, before "Confirm with one of the org key's methods." */
  meaning: ReactNode;
  /** Asks the hub, builds the code around the org key's bytes, and wipes them. */
  issue: (key: Uint8Array) => Promise<Issued>;
  /** Why it failed, in words. */
  explain: (failure: unknown) => string;
};

export function ConfirmStep(props: { me: Me; confirming: Confirming; onCancel: () => void; onIssued: (issued: Issued) => void }) {
  const { me, confirming, onCancel, onIssued } = props;
  const held = useKeyHolder((s) => s.key);
  const keys = useQuery({ queryKey: WRAPPED_KEYS_QUERY, queryFn: listWrappedKeys });
  const [error, setError] = useState<string | null>(null);

  async function confirm(method: OrgMethod) {
    if (!held || !keys.data) return setError('The org key is locked. Unlock it first.');
    setError(null);
    let key: Uint8Array | null = null;
    try {
      // The held key cannot be read: its copy is opened once more, checked to be the held key, and wiped once built in.
      key = await openOrgKeyBytes(me.org.id, keys.data, method, held);
      // Locked while it opened: the owner took the key out of this browser, so no code carries it out either.
      if (useKeyHolder.getState().key !== held) return setError('The org key was locked meanwhile, so no code was made. Unlock it and try again.');
      onIssued(await confirming.issue(key));
    } catch (failure) {
      setError(confirming.explain(failure));
    } finally {
      key?.fill(0);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="enroll-confirm">
      <p className="m-0 text-ui">{confirming.question}</p>
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">
        {confirming.meaning} Confirm with one of the org key's methods.
      </p>
      {keys.data ? (
        <OrgMethodForm keys={keys.data} passkeyText="Confirm with passkey" passphraseText="Confirm" preferred={rememberedMethod(me.org.id)} onMethod={confirm} />
      ) : keys.isError ? (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          The hub did not list the org key's methods: {keys.error.message}
        </p>
      ) : null}
      <div>
        <button type="button" className={buttonQuiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="m-0 text-ui-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function CodeStep(props: { issued: Issued; onDone: () => void }) {
  const { issued, onDone } = props;
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="flex flex-col gap-3" data-testid="enroll-code">
      {issued.instructions}
      <pre className="m-0 max-h-40 overflow-auto rounded-md border border-border bg-bg p-2.5 font-mono text-code break-all whitespace-pre-wrap select-all" data-testid="enrollment-code">
        {issued.code}
      </pre>
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">This is the only time the code is shown: closing this discards it. {issued.keep}</p>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonSecondary} onClick={() => void navigator.clipboard.writeText(issued.code).then(() => setCopied(true), () => setCopied(false))}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className={buttonPrimary} onClick={onDone}>
          Done
        </button>
        {copied === false && <span className="text-ui-sm text-danger">Copying failed; select the text instead.</span>}
      </div>
    </div>
  );
}
