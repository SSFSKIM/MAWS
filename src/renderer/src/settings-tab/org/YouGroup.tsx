// The Org page's You group (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end"):
// your account with Sign out, this Mac (its device id's first 8 and its fingerprint), the hub sign-in with its renewal,
// new keys, and your other devices. M1's and M3's lines moved here unchanged (OrgSection.tsx's Held and NewKeys): a
// registered Mac removed (with the new-keys offer), closed on its held chain (with Re-anchor), signed out, or signed in.
// Each attempt's refusal shows under its control; the shell hands down which, and the one with no control here.
import { formatClock } from '@shared/app/date-format';
import type { OrgRefusal, OrgView } from '@shared/ipc/schema/org';
import { ipc } from '../../ipc/client';
import { ORG } from '../copy';
import { Setting, TEXT_ACTION } from '../parts';
import { CodeField, DeviceLine, failed, Fingerprint, Refusal, UnplacedRefusal, type Attempt, type Registered } from './parts';

type Signer = NonNullable<Registered['signer']>;

/** The new-keys field is on the page: a removed device, or an unmarked key file, with no rekey under way. */
export function rekeyField(status: Registered): boolean {
  const signer = status.signer;
  if (signer === null || signer.rekeying !== null) return false;
  if (status.session === 'removed') return true;
  return status.session === 'signed-in' && status.problem !== 'held-chain' && signer.rekey === 'unmarked';
}

type Props = {
  status: Registered;
  view: OrgView | null;
  pending: boolean;
  refusalFor(attempt: Attempt): OrgRefusal | null;
  unplaced: OrgRefusal | null;
  signIn(): void;
  reanchor(code: string): void;
  rekey(code: string): void;
  cancel(): void;
};

export function YouGroup({ status, view, pending, refusalFor, unplaced, signIn, reanchor, rekey, cancel }: Props) {
  const signOut = () => {
    void ipc.invoke('org.signOut', undefined).then((result) => {
      if (!result.ok) failed(result.error);
    });
  };
  const me = view?.members.find((m) => m.you) ?? null;
  const thisMac = me?.devices.find((d) => d.thisMac) ?? null;
  const others = me?.devices.filter((d) => !d.thisMac) ?? null;
  return (
    <>
      <Setting label={ORG.account}>
        <span>{status.member.email}</span>
        {status.session === 'signed-in' && status.problem !== 'held-chain' && (
          <button type="button" className={TEXT_ACTION} onClick={signOut}>
            {ORG.signOut}
          </button>
        )}
      </Setting>
      <Setting label={ORG.device}>
        <span className="font-mono">{status.device.slice(0, 8)}</span>
        {thisMac !== null && (
          <span className="text-fg-muted">
            {ORG.thisMacFingerprint} <span className="font-mono text-fg">{thisMac.fingerprint}</span>
          </span>
        )}
      </Setting>
      <Held status={status} pending={pending} refusalFor={refusalFor} signIn={signIn} reanchor={reanchor} rekey={rekey} cancel={cancel} />
      {others !== null && (
        <Setting label={ORG.otherDevices}>
          {others.length === 0 ? <span className="text-fg-muted">{ORG.none}</span> : others.map((device) => <DeviceLine key={device.id} device={device} />)}
        </Setting>
      )}
      <UnplacedRefusal refusal={unplaced} />
    </>
  );
}

type HeldProps = Pick<Props, 'status' | 'pending' | 'refusalFor' | 'signIn' | 'reanchor' | 'rekey' | 'cancel'>;

// The registration's hub line: removed (with the new-keys offer), closed on its held chain, signed out, or signed in.
function Held({ status, pending, refusalFor, signIn, reanchor, rekey, cancel }: HeldProps) {
  const signer = status.signer;
  if (status.session === 'removed') {
    return (
      <>
        <Setting label={ORG.hub}>
          <span className="text-warning">{ORG.removed}</span>
        </Setting>
        {signer !== null && <NewKeys signer={signer} note={ORG.rejoinNote} pending={pending} refusal={refusalFor('rekey')} rekey={rekey} cancel={cancel} />}
      </>
    );
  }
  if (status.problem === 'held-chain') {
    return (
      <>
        <Setting label={ORG.problem}>
          <span className="text-warning">{ORG.problems['held-chain']}</span>
        </Setting>
        <CodeField action={ORG.reanchor} note={ORG.reanchorNote} pending={pending} refusal={refusalFor('reanchor')} onSend={reanchor} />
      </>
    );
  }
  if (status.session === 'signed-out') {
    return (
      <Setting label={ORG.hub}>
        <span className="text-fg-muted">{ORG.signedOut}</span>
        <button type="button" className={TEXT_ACTION} disabled={pending} onClick={signIn}>
          {ORG.signIn}
        </button>
        <Refusal refusal={refusalFor('signIn')} />
      </Setting>
    );
  }
  const access = status.hubAccess;
  const lapsed = access === 'expired' || access === 'denied';
  const rekeyOffered = signer !== null && (signer.rekey === 'unmarked' || signer.rekeying !== null);
  return (
    <>
      <Setting label={ORG.hub}>
        <span className={lapsed || access === 'unreachable' ? 'text-warning' : access === 'connected' ? '' : 'text-fg-muted'}>{ORG.hubAccess[access]}</span>
        {lapsed && (
          <button type="button" className={TEXT_ACTION} disabled={pending} onClick={signIn}>
            {ORG.signInAgain}
          </button>
        )}
        <Refusal refusal={refusalFor('signIn')} />
      </Setting>
      {rekeyOffered && <NewKeys signer={signer} note={ORG.rekeyNote} pending={pending} refusal={refusalFor('rekey')} rekey={rekey} cancel={cancel} />}
    </>
  );
}

// The new-keys offer: the code field sending org.rekey, or the rekey under way (its step with Cancel until the
// promotion, which can't be stopped once its intent is written; the new entry's fingerprint at approval).
function NewKeys({ signer, note, pending, refusal, rekey, cancel }: { signer: Signer; note: string; pending: boolean; refusal: OrgRefusal | null; rekey(code: string): void; cancel(): void }) {
  const rekeying = signer.rekeying;
  if (rekeying === null) return <CodeField action={ORG.makeNewKeys} note={note} pending={pending} refusal={refusal} onSend={rekey} />;
  return (
    <>
      <Setting label={ORG.newKeys}>
        <span>{rekeying.step === 'approval' && rekeying.expires !== null ? ORG.approvalUntil(formatClock(Date.parse(rekeying.expires))) : ORG.rekeySteps[rekeying.step]}</span>
        {rekeying.step !== 'promoting' && (
          <button type="button" className={TEXT_ACTION} onClick={cancel}>
            {ORG.cancel}
          </button>
        )}
      </Setting>
      {rekeying.step === 'approval' && rekeying.fingerprint !== null && <Fingerprint value={rekeying.fingerprint} />}
    </>
  );
}
