// The Org page's Machines group (P5 O8 M4a and M4b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, *Machines
// in M4a* and M4b's "At its end"). Each machine the held head lists, and each certified one, is a row (MachineRow.tsx):
// its signed name, its owners by name, its key id, whether it is up (the renderer's `useMachines` store, never the view:
// a link can drop with no new head), its actions and its rights.
//
// The org state's changes (Enroll a machine, Re-enroll, Owners, Drop) are a root's, so they show only while this Mac may
// sign (`maySign`); an admin whose Mac can't is told to enroll from one that does. Owners and Drop go through the change
// sheet (M4a's preview and change pipeline) with the machine kinds' fields; enrolling and re-enrolling through the
// enrollment sheet, one at a time, and a running one shows here (Show… takes it up without its code). A machine this run
// dropped whose hub row the delete didn't take out stays as a row of its own: "Signed. The hub still lists <name>: Retry",
// Retry calling `org.drop.retry`, which deletes the row alone. Grant… is the row's, and follows `mayGrant` (Fork B).
import { useState } from 'react';
import { formatClock } from '@shared/app/date-format';
import type { DropRetryResult, OrgChange, OrgView } from '@shared/ipc/schema/org';
import { ipc } from '../../ipc/client';
import { ORG } from '../copy';
import { Setting, TEXT_ACTION } from '../parts';
import { ChangeSheet } from './ChangeSheet';
import { EnrollSheet } from './EnrollSheet';
import { MachineRow } from './MachineRow';
import { failed, OutcomeLine, signInOf, type Outcome, type Registered, type ViewMachine } from './parts';

type Asked = { title: string; change: OrgChange };
/** The enrollment sheet: a new machine (`replace` null) or a re-enrollment, `follow` the running one it takes up. */
type Enrolling = { replace: ViewMachine | null; follow: number | null };

export function MachinesGroup({ view, status }: { view: OrgView; status: Registered }) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const [enrollOn, setEnrollOn] = useState<Enrolling | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const may = view.maySign;
  const admin = view.members.find((m) => m.you)?.role === 'admin';
  const enrolling = status.enrolling;
  const signIn = signInOf(status);
  const ask = (title: string, change: OrgChange) => {
    setOutcome(null);
    setAsked({ title, change });
  };
  const enroll = (replace: ViewMachine | null, follow: number | null) => {
    setOutcome(null);
    setEnrollOn({ replace, follow });
  };
  // The new machine's enrollment, while one shows in the status (a re-enrollment shows on its machine's row).
  const fresh = enrolling !== null && enrolling.replace === null ? enrolling : null;
  return (
    <>
      {view.machines.length === 0 && <p className="m-0 py-1 text-ui-sm text-fg-muted">{ORG.noMachines}</p>}
      {view.machines.map((machine) => (
        <MachineRow
          key={machine.ref}
          machine={machine}
          view={view}
          signIn={signIn}
          admin={admin}
          enrolling={enrolling !== null && enrolling.replace === machine.ref ? enrolling : null}
          ask={ask}
          reenroll={(follow) => enroll(machine, follow)}
        />
      ))}
      {status.hubRowsLeft.map((left) => (
        <HubRowLeft key={left.name} name={left.name} />
      ))}
      <Setting label={ORG.enroll}>
        {fresh !== null ? (
          <>
            <span className={fresh.problem === null ? 'text-fg-muted' : 'text-warning'}>{fresh.problem === null ? ORG.enrollingUntil(fresh.name, formatClock(Date.parse(fresh.expires))) : ORG.enrollProblems[fresh.problem]}</span>
            <button type="button" className={TEXT_ACTION} onClick={() => enroll(null, fresh.generation)}>
              {ORG.enrollShow}
            </button>
          </>
        ) : !admin ? (
          <span className="text-fg-muted">{ORG.enrollAdmins}</span>
        ) : may ? (
          <button type="button" className={TEXT_ACTION} onClick={() => enroll(null, null)}>
            {ORG.enrollAction}
          </button>
        ) : (
          <span className="text-fg-muted">{ORG.enrollCantSign}</span>
        )}
        <OutcomeLine outcome={outcome} />
      </Setting>
      {asked !== null && (
        <ChangeSheet title={asked.title} change={asked.change} members={view.members} may={may} signIn={signIn} onClose={() => setAsked(null)} onSigned={(version) => setOutcome({ text: ORG.signed(version), refused: false })} />
      )}
      {enrollOn !== null && <EnrollSheet replace={enrollOn.replace} follow={enrollOn.follow} enrolling={enrolling} may={may} signIn={signIn} onClose={() => setEnrollOn(null)} />}
    </>
  );
}

// A dropped machine whose hub row is still listed: Retry deletes the row alone, signing nothing.
function HubRowLeft({ name }: { name: string }) {
  const [retrying, setRetrying] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const retry = () => {
    setRetrying(true);
    setOutcome(null);
    void ipc.invoke('org.drop.retry', { name }).then((result) => {
      setRetrying(false);
      if (!result.ok) failed(result.error);
      else setOutcome(retryOutcome(result.value));
    });
  };
  return (
    <Setting label={name}>
      <span className="text-fg-muted">{ORG.hubRowLeft(name)}</span>
      <button type="button" className={TEXT_ACTION} disabled={retrying} onClick={retry}>
        {ORG.retry}
      </button>
      <OutcomeLine outcome={outcome} />
    </Setting>
  );
}

function retryOutcome(result: DropRetryResult): Outcome {
  if (result.ok) return null; // the row leaves the status
  return { text: [ORG.notRetried, ORG.retryReasons[result.reason], result.detail].filter((part) => part !== undefined && part !== '').join(' · '), refused: true };
}
