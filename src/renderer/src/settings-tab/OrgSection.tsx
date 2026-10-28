// P5 O8 M1: Settings › Org (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The Org section"; Interfaces §B),
// the least UI a sign-in to the org needs. It reads `org.status` once and follows `org.changed`, and draws by the
// status: the pairing-code field, the sign-in's step (the fingerprint at approval), or the held registration with the
// hub's state, the org state's age and the problem held. A refusal is one line under the control that sent it. The
// code is trimmed, sent, and the field cleared; nothing the status carries is a code or a token, and nothing here
// shows one back.
import { useEffect, useState, type KeyboardEvent } from 'react';
import type { IpcError } from '@shared/ipc/schema';
import { ORG_HEAD_BACKSTOP_DAYS, ORG_HEAD_WARN_DAYS, type OrgAttempt, type OrgRefusal, type OrgStatus } from '@shared/ipc/schema/org';
import { formatClock } from '@shared/app/date-format';
import { useNow } from '../app/use-now';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { ORG } from './copy';
import { INPUT, Setting, TEXT_ACTION } from './parts';

type Attempt = Promise<{ ok: true; value: OrgAttempt } | { ok: false; error: IpcError }>;
type Registered = Extract<OrgStatus, { state: 'registered' }>;

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

  // register, reanchor and signIn: the button waits for the answer; a refusal stays until the next attempt.
  const attempt = (send: Attempt) => {
    setPending(true);
    setRefusal(null);
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
          {status.step === 'approval' && status.fingerprint !== null && (
            <Setting label={ORG.fingerprint} note={ORG.fingerprintNote}>
              <span className="font-mono text-prose font-semibold tracking-wide text-fg select-all">{status.fingerprint}</span>
            </Setting>
          )}
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
          <Held status={status} pending={pending} refusal={shown} signIn={signIn} reanchor={(code) => attempt(ipc.invoke('org.reanchor', { code }))} />
        </>
      );
  }
}

// A registered Mac below its org, account and device rows (the account row carries Sign out when signed in): removed,
// closed on its held chain, signed out, or signed in.
function Held({ status, pending, refusal, signIn, reanchor }: { status: Registered; pending: boolean; refusal: OrgRefusal | null; signIn(): void; reanchor(code: string): void }) {
  if (status.session === 'removed') {
    return (
      <Setting label={ORG.hub}>
        <span className="text-warning">{ORG.removed}</span>
      </Setting>
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
  return (
    <>
      <Setting label={ORG.hub}>
        <span className={lapsed || access === 'unreachable' ? 'text-warning' : access === 'connected' ? '' : 'text-fg-muted'}>{ORG.hubAccess[access]}</span>
        {lapsed && (
          <button type="button" className={TEXT_ACTION} disabled={pending} onClick={signIn}>
            {ORG.signInAgain}
          </button>
        )}
        <Refusal refusal={refusal} />
      </Setting>
      <HeadAge head={status.head} />
      {status.problem !== null && (
        <Setting label={ORG.problem}>
          <span className="text-warning">{ORG.problems[status.problem]}</span>
        </Setting>
      )}
    </>
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
