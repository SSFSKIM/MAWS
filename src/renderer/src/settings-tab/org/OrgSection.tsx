// P5 O8: Settings › Org (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md). M1 made it the least UI a sign-in
// needs, M3 added this Mac as the org's signer, and M4a makes it the Org page, split by group (*The split*). This shell
// keeps the status read and the state switch: none (the pairing-code field), development, registering (the sign-in's
// step, the fingerprint at approval), and registered, drawn in Q1's four groups: You, People, Machines and Org. It reads
// `org.status` once and follows `org.changed`, and reads `org.view` (the held head as the page draws it) again at each
// `org.changed` while registered. People and Machines draw only from a view, which a registration without a verified
// head lacks.
//
// The sign-in's attempts (register, re-anchor, sign in, rekey) start here. A refusal shows under the control that sent
// it: the status's names its attempt (`refused.attempt`), and an attempt's own answer is the control's that sent it. A
// refusal that names no attempt (the key file refused at load), or whose control isn't on the page, keeps a row of its
// own, never dropped. Nothing the status carries is a code or a token; a pairing's code is the pairing sheet's alone.
import { useEffect, useState } from 'react';
import type { OrgAttempt, OrgRefusal, OrgStatus, OrgView } from '@shared/ipc/schema/org';
import { formatClock } from '@shared/app/date-format';
import { ipc } from '../../ipc/client';
import { ORG } from '../copy';
import { Setting, TEXT_ACTION } from '../parts';
import { MachinesGroup } from './MachinesGroup';
import { OrgGroup } from './OrgGroup';
import { PeopleGroup } from './PeopleGroup';
import { CodeField, failed, Fingerprint, Group, UnplacedRefusal, type Attempt, type Invoked, type Registered } from './parts';
import { rekeyField, YouGroup } from './YouGroup';

// The attempts whose control is on the page for `status`, as YouGroup and the code field draw them.
function placed(status: OrgStatus): ReadonlySet<Attempt> {
  if (status.state === 'none') return new Set(['register']);
  if (status.state !== 'registered') return new Set();
  if (status.session === 'removed') return new Set(rekeyField(status) ? ['rekey'] : []);
  if (status.problem === 'held-chain') return new Set(['reanchor']);
  if (status.session === 'signed-out') return new Set(['signIn']);
  return new Set(rekeyField(status) ? ['signIn', 'rekey'] : ['signIn']);
}

export function OrgSection() {
  const [status, setStatus] = useState<OrgStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [view, setView] = useState<OrgView | null>(null);
  const [pending, setPending] = useState(false);
  // An attempt's own refusal (its answer), with the attempt this page sent; the status's names its own.
  const [answered, setAnswered] = useState<OrgRefusal | null>(null);

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

  // The view follows the head, which only an `org.changed` moves: read again at each, the latest read kept.
  const registered = status?.state === 'registered';
  useEffect(() => {
    if (!registered) return;
    let live = true;
    void ipc.invoke('org.view', undefined).then((result) => {
      if (!live) return;
      if (result.ok) setView(result.value);
      else failed(result.error);
    });
    return () => {
      live = false;
    };
  }, [status, registered]);

  // register, reanchor, signIn and rekey: the button waits for the answer; a refusal stays until the next attempt.
  const attempt = (send: Invoked<OrgAttempt>, from: Attempt) => {
    setPending(true);
    setAnswered(null);
    void send.then((result) => {
      setPending(false);
      if (!result.ok) failed(result.error);
      else if (!result.value.ok) setAnswered({ ...result.value.reason, attempt: result.value.reason.attempt ?? from });
    });
  };
  const cancel = () => {
    void ipc.invoke('org.cancel', undefined).then((result) => {
      if (!result.ok) failed(result.error);
    });
  };

  if (status === null) return <p className={`m-0 py-1 text-ui-sm ${readError === null ? 'text-fg-muted' : 'text-warning'}`}>{readError === null ? ORG.reading : ORG.readFailed(readError)}</p>;
  const shown = answered ?? (status.state === 'none' || status.state === 'registered' ? (status.refused ?? null) : null);
  const here = placed(status);
  const placedAt = (at: Attempt): OrgRefusal | null => (shown !== null && shown.attempt === at && here.has(at) ? shown : null);
  const unplaced = shown !== null && (shown.attempt === undefined || !here.has(shown.attempt)) ? shown : null;

  switch (status.state) {
    case 'none':
      return (
        <>
          <Setting label={ORG.org}>
            <span className="text-fg-muted">{ORG.notSignedIn}</span>
          </Setting>
          <CodeField action={ORG.signIn} note={ORG.codeNote} pending={pending} refusal={placedAt('register')} onSend={(code) => attempt(ipc.invoke('org.register', { code }), 'register')} />
          <UnplacedRefusal refusal={unplaced} />
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
            <button type="button" className={TEXT_ACTION} onClick={cancel}>
              {ORG.cancel}
            </button>
          </Setting>
          {status.step === 'approval' && status.fingerprint !== null && <Fingerprint value={status.fingerprint} />}
        </>
      );
    case 'registered':
      return <RegisteredPage status={status} view={view} pending={pending} placedAt={placedAt} unplaced={unplaced} attempt={attempt} cancel={cancel} />;
  }
}

type PageProps = {
  status: Registered;
  view: OrgView | null;
  pending: boolean;
  placedAt(at: Attempt): OrgRefusal | null;
  unplaced: OrgRefusal | null;
  attempt(send: Invoked<OrgAttempt>, from: Attempt): void;
  cancel(): void;
};

function RegisteredPage({ status, view, pending, placedAt, unplaced, attempt, cancel }: PageProps) {
  return (
    <>
      <Group id="you" title={ORG.groups.you}>
        <YouGroup
          status={status}
          view={view}
          pending={pending}
          refusalFor={placedAt}
          unplaced={unplaced}
          signIn={() => attempt(ipc.invoke('org.signIn', undefined), 'signIn')}
          reanchor={(code) => attempt(ipc.invoke('org.reanchor', { code }), 'reanchor')}
          rekey={(code) => attempt(ipc.invoke('org.rekey', { code }), 'rekey')}
          cancel={cancel}
        />
      </Group>
      {view !== null && (
        <>
          <Group id="people" title={ORG.groups.people}>
            <PeopleGroup view={view} pairing={status.pairing} />
          </Group>
          <Group id="machines" title={ORG.groups.machines}>
            <MachinesGroup view={view} />
          </Group>
        </>
      )}
      <Group id="org" title={ORG.groups.org}>
        <OrgGroup status={status} view={view} />
      </Group>
    </>
  );
}
