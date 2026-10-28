// P5 O8 M1: Settings › Org (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The Org section"; Interfaces §B),
// the least UI a sign-in to the org needs. It reads `org.status` once and follows `org.changed`, and draws by the
// status: the pairing-code field, the sign-in's step (the fingerprint at approval), or the held registration with the
// hub's state, the org state's age and the problem held. A refusal is one line under the control that sent it. The
// code is trimmed, sent, and the field cleared; nothing the status carries is a code or a token, and nothing here
// shows one back.
// M3 (the document's M3, "The quiet line", "The pending slot", "New keys", "The co-root") adds this Mac as the org's
// signer below the held registration: the root line (or, for a key file without the backup mark, the new-keys offer
// instead), the weekly line with Re-sign now, the pending slot with Discard behind `abandon-pending`'s confirmation,
// `signing` with Reset behind its own, the superseded states' revocations, the machines still owing a delivery, the
// discarded proposals a hub or machine may hold, and a rekey's old device still listed. Quiet lines at the rows' weight.
import { useEffect, useState, type KeyboardEvent } from 'react';
import type { IpcError } from '@shared/ipc/schema';
import {
  ORG_HEAD_BACKSTOP_DAYS,
  ORG_HEAD_WARN_DAYS,
  type DiscardResult,
  type OrgAttempt,
  type OrgRefusal,
  type OrgSignerStatus,
  type OrgStatus,
  type SignResult,
} from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { formatClock } from '@shared/app/date-format';
import { useNow } from '../app/use-now';
import { GatewaySheet } from '../gateway/GatewaySheet';
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { toast } from '../stores/notices';
import { machineName } from '../stores/org-projects';
import { ORG } from './copy';
import { INPUT, Setting, TEXT_ACTION } from './parts';

type Attempt = Promise<{ ok: true; value: OrgAttempt } | { ok: false; error: IpcError }>;
type Registered = Extract<OrgStatus, { state: 'registered' }>;
type Signer = NonNullable<OrgSignerStatus>;
type Pending = NonNullable<Signer['pending']>;
/** Which control sent the last attempt, so its refusal lands under that control: a rekey's code field, or the others'. */
type Source = 'rekey' | 'other' | null;
/** A signer act's end in one line: muted when done, the warning tone when refused. */
type Outcome = { text: string; refused: boolean } | null;

const DAY_MS = 86_400_000;

// An IPC failure (not a refusal) is a toast, as a refused settings write is.
function failed(error: IpcError) {
  console.error('[org] command failed', error);
  toast({ level: 'warning', text: ORG.failed(error.message), actions: [], dismissible: true });
}

export function OrgSection() {
  const [status, setStatus] = useState<OrgStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<OrgRefusal | null>(null);
  const [source, setSource] = useState<Source>(null);

  useEffect(() => {
    let heard = false; // an event before the read's answer is newer than it
    let live = true;
    const off = ipc.on('org.changed', (next) => {
      heard = true;
      setStatus(next);
    });
    void ipc.invoke('org.status', undefined).then((result) => {
      if (!live || heard) return;
      if (result.ok) setStatus(result.value);
      else setReadError(result.error.message);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  // register, reanchor, signIn and rekey: the button waits for the answer; a refusal stays until the next attempt.
  const attempt = (send: Attempt, from: Source = 'other') => {
    setPending(true);
    setRefusal(null);
    setSource(from);
    void send.then((result) => {
      setPending(false);
      if (!result.ok) failed(result.error);
      else if (!result.value.ok) setRefusal(result.value.reason);
    });
  };
  const command = (name: 'org.cancel' | 'org.signOut') => {
    void ipc.invoke(name, undefined).then((result) => {
      if (!result.ok) failed(result.error);
    });
  };
  const signIn = () => attempt(ipc.invoke('org.signIn', undefined));

  if (status === null) return <p className={`m-0 py-1 text-ui-sm ${readError === null ? 'text-fg-muted' : 'text-warning'}`}>{readError === null ? ORG.reading : ORG.readFailed(readError)}</p>;
  const shown = refusal ?? (status.state === 'none' || status.state === 'registered' ? (status.refused ?? null) : null);

  switch (status.state) {
    case 'none':
      return (
        <>
          <Setting label={ORG.org}>
            <span className="text-fg-muted">{ORG.notSignedIn}</span>
          </Setting>
          <CodeField action={ORG.signIn} note={ORG.codeNote} pending={pending} refusal={shown} onSend={(code) => attempt(ipc.invoke('org.register', { code }))} />
        </>
      );
    case 'development':
      return (
        <Setting label={ORG.development} note={ORG.developmentNote}>
          <span className="font-mono">{status.org}</span>
        </Setting>
      );
    case 'registering':
      return (
        <>
          <Setting label={ORG.signingIn}>
            <span>{status.step === 'approval' && status.expires !== null ? ORG.approvalUntil(formatClock(Date.parse(status.expires))) : ORG.steps[status.step]}</span>
            <button type="button" className={TEXT_ACTION} onClick={() => command('org.cancel')}>
              {ORG.cancel}
            </button>
          </Setting>
          {status.step === 'approval' && status.fingerprint !== null && <Fingerprint value={status.fingerprint} />}
        </>
      );
    case 'registered':
      return (
        <>
          <Setting label={ORG.org}>
            <span className="font-mono">{status.org}</span>
          </Setting>
          <Setting label={ORG.account}>
            <span>{status.member.email}</span>
            {status.session === 'signed-in' && status.problem !== 'held-chain' && (
              <button type="button" className={TEXT_ACTION} onClick={() => command('org.signOut')}>
                {ORG.signOut}
              </button>
            )}
          </Setting>
          <Setting label={ORG.device}>
            <span className="font-mono">{status.device.slice(0, 8)}</span>
          </Setting>
          <Held
            status={status}
            pending={pending}
            refusal={shown}
            source={source}
            signIn={signIn}
            reanchor={(code) => attempt(ipc.invoke('org.reanchor', { code }))}
            rekey={(code) => attempt(ipc.invoke('org.rekey', { code }), 'rekey')}
            cancel={() => command('org.cancel')}
          />
        </>
      );
  }
}

type HeldProps = { status: Registered; pending: boolean; refusal: OrgRefusal | null; source: Source; signIn(): void; reanchor(code: string): void; rekey(code: string): void; cancel(): void };

// A registered Mac below its org, account and device rows (the account row carries Sign out when signed in): removed
// (with the new-keys offer), closed on its held chain, signed out, or signed in (with the signer's lines).
function Held({ status, pending, refusal, source, signIn, reanchor, rekey, cancel }: HeldProps) {
  const signer = status.signer;
  if (status.session === 'removed') {
    return (
      <>
        <Setting label={ORG.hub}>
          <span className="text-warning">{ORG.removed}</span>
        </Setting>
        {signer !== null && <NewKeys signer={signer} note={ORG.rejoinNote} pending={pending} refusal={refusal} rekey={rekey} cancel={cancel} />}
      </>
    );
  }
  if (status.problem === 'held-chain') {
    return (
      <>
        <Setting label={ORG.problem}>
          <span className="text-warning">{ORG.problems['held-chain']}</span>
        </Setting>
        <CodeField action={ORG.reanchor} note={ORG.reanchorNote} pending={pending} refusal={refusal} onSend={reanchor} />
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
        <Refusal refusal={refusal} />
      </Setting>
    );
  }
  const access = status.hubAccess;
  const lapsed = access === 'expired' || access === 'denied';
  const rekeyOffered = signer !== null && (signer.rekey === 'unmarked' || signer.rekeying !== null);
  // Signed in, the only attempts are Sign in again (offered while lapsed) and a rekey: a refusal this view didn't send
  // (the status's own, after a reload) is the rekey's when Sign in again isn't on offer.
  const rekeyRefused = rekeyOffered && (source === 'rekey' || (source === null && !lapsed));
  return (
    <>
      <Setting label={ORG.hub}>
        <span className={lapsed || access === 'unreachable' ? 'text-warning' : access === 'connected' ? '' : 'text-fg-muted'}>{ORG.hubAccess[access]}</span>
        {lapsed && (
          <button type="button" className={TEXT_ACTION} disabled={pending} onClick={signIn}>
            {ORG.signInAgain}
          </button>
        )}
        <Refusal refusal={rekeyRefused ? null : refusal} />
      </Setting>
      <HeadAge head={status.head} />
      {status.problem !== null && <Problem problem={status.problem} />}
      {signer !== null && <SignerLines signer={signer} device={status.device} />}
      {rekeyOffered && <NewKeys signer={signer} note={ORG.rekeyNote} pending={pending} refusal={rekeyRefused ? refusal : null} rekey={rekey} cancel={cancel} />}
    </>
  );
}

// The held problem in words; `signing` carries Reset behind its confirmation (org.resetSigning, the owner's explicit act).
function Problem({ problem }: { problem: NonNullable<Registered['problem']> }) {
  const [confirming, setConfirming] = useState(false);
  const reset = () => {
    setConfirming(false);
    void ipc.invoke('org.resetSigning', { confirmed: true }).then((result) => {
      if (!result.ok) failed(result.error);
    });
  };
  return (
    <Setting label={ORG.problem}>
      <span className="text-warning">{ORG.problems[problem]}</span>
      {problem === 'signing' && (
        <button type="button" className={TEXT_ACTION} onClick={() => setConfirming(true)}>
          {ORG.reset}
        </button>
      )}
      {confirming && (
        <GatewaySheet title={ORG.resetTitle} onClose={() => setConfirming(false)} canSubmit onSubmit={reset} submitLabel={ORG.resetConfirm} cancelLabel={ORG.cancel}>
          <p className="m-0 text-ui-sm leading-normal text-fg-muted">{ORG.resetBody}</p>
        </GatewaySheet>
      )}
    </Setting>
  );
}

// "a, b and c": machine names and holders in a line.
function inWords(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function signOutcome(result: SignResult): Outcome {
  if (result.ok) return { text: ORG.signed(result.version), refused: false };
  if (result.reason === 'cancelled') return null; // the person's own cancel at Touch ID needs no line
  return { text: [ORG.notSigned, ORG.signReasons[result.reason], result.detail].filter((part) => part !== undefined && part !== '').join(' · '), refused: true };
}

function discardOutcome(version: number, result: DiscardResult): Outcome {
  if (result.ok) return { text: ORG.discarded(version, result.unsent, result.hubVersion, result.forkAt), refused: false };
  return { text: result.reason === undefined ? ORG.notDiscarded : `${ORG.notDiscarded} · ${ORG.discardReasons[result.reason](version)}`, refused: true };
}

// This Mac as the org's signer: the root line (or the unmarked keys' words), the weekly line, and every other line
// only while it has something to say. The acts here (Re-sign now, Revoke again, Discard) end in one line on the Signer
// row, since the row that sent them may be gone once they settle.
function SignerLines({ signer, device }: { signer: Signer; device: string }) {
  const [acting, setActing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // The proposal Discard was pressed for, by its stateHash: the owner's consent is to that one proposal.
  const [confirming, setConfirming] = useState<string | null>(null);
  const machines = useMachines((s) => s.machines);
  const nameOf = (ref: string) => machineName(machines, ref as MachineRef, ipc.localMachine);

  const act = <T,>(send: Promise<{ ok: true; value: T } | { ok: false; error: IpcError }>, said: (value: T) => Outcome) => {
    setActing(true);
    setOutcome(null);
    void send.then((result) => {
      setActing(false);
      if (!result.ok) failed(result.error);
      else setOutcome(said(result.value));
    });
  };
  const sign = (name: 'org.resign' | 'org.revokeSuperseded') => act(ipc.invoke(name, undefined), signOutcome);
  const discard = (slot: Pending) => {
    setConfirming(null);
    act(ipc.invoke('org.discardPending', { confirmed: true, hash: slot.hash }), (result) => discardOutcome(slot.version, result));
  };

  const unmarked = signer.rekey === 'unmarked';
  const guide = !unmarked && !signer.root; // the root add guidance, for a marked device not yet a root
  const weekly = signer.root && signer.due && signer.maySign ? signer.ageDays : null; // the age, while the weekly line shows
  const slot = signer.pending;
  // The sheet closes once its proposal settles or another replaces it, so a confirmation never reaches another slot
  // (main refuses a stale hash too).
  if (confirming !== null && slot?.hash !== confirming) setConfirming(null);
  const asked = slot !== null && slot.hash === confirming ? slot : null;
  const offer = signer.offer;
  const held = signer.abandoned.filter((a) => a.hub || a.machines.length > 0); // a never-sent proposal can't show as a fork
  return (
    <>
      <Setting label={ORG.signer} note={guide ? ORG.rootNote(signer.fingerprint) : undefined}>
        {unmarked ? (
          <span className="text-fg-muted">{ORG.unmarked}</span>
        ) : signer.root ? (
          <span>{ORG.signs}</span>
        ) : (
          <>
            <span className="text-fg-muted">{ORG.makeRoot}</span>
            <span className="font-mono text-fg select-all">{ORG.rootCommand(device)}</span>
          </>
        )}
        {weekly !== null && (
          <>
            <span className="text-fg-muted">{ORG.weekly(weekly)}</span>
            <button type="button" className={TEXT_ACTION} disabled={acting} onClick={() => sign('org.resign')}>
              {ORG.resign}
            </button>
          </>
        )}
        {outcome !== null && (
          <span role={outcome.refused ? 'alert' : 'status'} className={`basis-full text-ui-sm ${outcome.refused ? 'text-warning' : 'text-fg-muted'}`}>
            {outcome.text}
          </span>
        )}
      </Setting>
      {slot !== null && (
        <Setting label={ORG.pending}>
          <span className={slot.fork || slot.refused !== null ? 'text-warning' : 'text-fg-muted'}>
            {slot.fork ? ORG.pendingFork(slot.version) : slot.refused !== null ? ORG.pendingRefused(slot.version, slot.refused) : ORG.pendingWaits(slot.version)}
          </span>
          {(slot.fork || slot.refused !== null) && (
            <button type="button" className={TEXT_ACTION} disabled={acting} onClick={() => setConfirming(slot.hash)}>
              {ORG.discard}
            </button>
          )}
        </Setting>
      )}
      {offer !== null && (offer.superseded > 0 || offer.withheld.length > 0) && (
        <Setting label={ORG.revocations}>
          {offer.superseded > 0 && <span>{ORG.offer(offer.superseded)}</span>}
          {offer.superseded > 0 && signer.maySign && (
            <button type="button" className={TEXT_ACTION} disabled={acting} onClick={() => sign('org.revokeSuperseded')}>
              {ORG.revoke}
            </button>
          )}
          {offer.withheld.map((name) => (
            <span key={name} className="basis-full text-ui-sm text-fg-muted">
              {ORG.withheld(name)}
            </span>
          ))}
        </Setting>
      )}
      {signer.owing.length > 0 && (
        <Setting label={ORG.deliveries}>
          {signer.owing.map((owed) => {
            const waiting = owed.machines.filter((ref) => !owed.tooLarge.includes(ref)).map(nameOf);
            const tooLarge = owed.tooLarge.map(nameOf);
            return (
              <span key={owed.version} className="basis-full text-fg-muted">
                {ORG.owing(owed.version, waiting.length === 0 ? null : inWords(waiting), tooLarge.length === 0 ? null : inWords(tooLarge))}
              </span>
            );
          })}
        </Setting>
      )}
      {held.length > 0 && (
        <Setting label={ORG.discardedRow}>
          {held.map((a) => (
            <span key={a.hash} className="basis-full text-fg-muted">
              {ORG.abandoned(a.version, inWords([...(a.hub ? [ORG.theHub] : []), ...a.machines.map(nameOf)]))}
            </span>
          ))}
        </Setting>
      )}
      {signer.oldDevice !== null && (
        <Setting label={ORG.oldDevice}>
          <span className="text-fg-muted">{ORG.oldDeviceLine}</span>
          <span className="font-mono text-fg select-all">{ORG.removeCommand(signer.oldDevice)}</span>
        </Setting>
      )}
      {asked !== null && (
        <GatewaySheet title={ORG.discardTitle(asked.version)} onClose={() => setConfirming(null)} canSubmit onSubmit={() => discard(asked)} submitLabel={ORG.discardConfirm} cancelLabel={ORG.cancel}>
          {asked.exposed ? (
            <>
              <p className="m-0 text-ui-sm leading-normal text-fg">{ORG.discardAtHub(asked.version, asked.fork)}</p>
              <p className="m-0 mt-2 text-ui-sm leading-normal text-fg-muted">{ORG.discardWarning(asked.version)}</p>
            </>
          ) : (
            <p className="m-0 text-ui-sm leading-normal text-fg-muted">{ORG.discardUnsent(asked.version)}</p>
          )}
        </GatewaySheet>
      )}
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

// A new device entry's fingerprint, large in the monospace token, to compare with the approving device's.
function Fingerprint({ value }: { value: string }) {
  return (
    <Setting label={ORG.fingerprint} note={ORG.fingerprintNote}>
      <span className="font-mono text-prose font-semibold tracking-wide text-fg select-all">{value}</span>
    </Setting>
  );
}

// The held org state's version and age in whole days, in the warning tone from ORG_HEAD_WARN_DAYS, the backstop named.
function HeadAge({ head }: { head: Registered['head'] }) {
  const now = useNow();
  const days = head === null ? 0 : Math.max(0, Math.floor((now - Date.parse(head.issued)) / DAY_MS));
  return (
    <Setting label={ORG.state} note={ORG.stateNote(ORG_HEAD_BACKSTOP_DAYS)}>
      {head === null ? <span className="text-fg-muted">{ORG.unverified}</span> : <span className={days >= ORG_HEAD_WARN_DAYS ? 'text-warning' : ''}>{ORG.version(head.version, days)}</span>}
    </Setting>
  );
}

// The pairing-code field: typed here, sent trimmed on the button or Enter, and cleared once sent.
function CodeField({ action, note, pending, refusal, onSend }: { action: string; note: string; pending: boolean; refusal: OrgRefusal | null; onSend(code: string): void }) {
  const [draft, setDraft] = useState('');
  const send = () => {
    const code = draft.trim();
    if (code === '' || pending) return;
    setDraft('');
    onSend(code);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') send();
    if (e.key === 'Escape') setDraft('');
  };
  return (
    <Setting label={ORG.code} note={note}>
      <input aria-label={ORG.code} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} spellCheck={false} autoComplete="off" className={`${INPUT} max-w-[320px] flex-1 font-mono`} />
      <button type="button" className={TEXT_ACTION} disabled={pending || draft.trim() === ''} onClick={send}>
        {action}
      </button>
      <Refusal refusal={refusal} />
    </Setting>
  );
}

function Refusal({ refusal }: { refusal: OrgRefusal | null }) {
  if (refusal === null) return null;
  return (
    <span role="alert" className="basis-full text-ui-sm text-warning">
      {refusalText(refusal)}
    </span>
  );
}

export function refusalText({ code, detail }: OrgRefusal): string {
  if (code === 'not-member') return ORG.refusals['not-member'](detail);
  return detail ? `${ORG.refusals[code]} · ${detail}` : ORG.refusals[code];
}
