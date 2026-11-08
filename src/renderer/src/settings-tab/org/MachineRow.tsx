// One machine's row on the Org page (P5 O8 M4b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's "At its
// end"): its name, whether it is up, its owners by name and its key id; its actions; and its rights.
//
// - Actions. Grant… where `mayGrant` says (Fork B: this device's step-up key may sign a grant there, an owner's or an
//   admin's for an org-owned machine, root or not). Owners…, Re-enroll… (an admin's: the mint is) and Drop… while this
//   Mac may sign, never on a certified machine (its owners are its delegation's, and change with it), and no Drop for
//   this Mac's own machine (`this-machine`: it leaves through `mawsd endpoint unenroll` on it).
// - Rights, the machine's own word (`org.grants.view`): each member who holds a grant, with their rights; a grant not
//   yet delivered marked "Not yet on <machine>"; one the machine refused with its reason and Sign again…; a machine that
//   didn't answer shown as of its last answer; the grants this Mac issued that the machine no longer holds, with
//   Re-grant…; and a damaged grants record said so, with nothing offering to sign. Owners hold every right and need none.
// - The read reads the machine's ledger, so it runs when the row opens, when a sheet of its opens, at its
//   `org.grants.changed` and when the sign-in changes; never at each `org.changed`. Only the latest read lands, and none
//   once the sign-in it was made under has ended; the sheets close with that sign-in too.
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatClock, formatDayTime } from '@shared/app/date-format';
import type { GrantsView, OrgChange, OrgEnrollingStatus, OrgView } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../../ipc/client';
import { useMachines } from '../../stores/machines';
import { ORG } from '../copy';
import { Chip, Setting, TEXT_ACTION } from '../parts';
import { GrantSheet, RegrantSheet, type GrantDraft } from './GrantSheet';
import { failed, inWords, machineRowId, memberName, OutcomeLine, type Outcome, type ViewMachine } from './parts';

type Shown = Extract<GrantsView, { ok: true }>;
type Sheet = { at: 'grant'; draft: GrantDraft | null; signIn: string } | { at: 'regrant'; signIn: string };

/** The machine's grants as main last answered them under `signIn`, and a read of them again. */
function useGrantsView(ref: string, signIn: string | null): { view: GrantsView | null; reload(): void } {
  const [held, setHeld] = useState<{ signIn: string | null; view: GrantsView | null }>({ signIn, view: null });
  if (held.signIn !== signIn) setHeld({ signIn, view: null }); // another sign-in: nothing read under the last one shows
  const latest = useRef(0); // the read whose answer may land; any earlier one is dropped
  const scope = useRef({ live: false }); // the row as mounted for this sign-in: a read still out after it lands nowhere
  const reload = useCallback(() => {
    if (signIn === null) return;
    const under = scope.current;
    const mine = ++latest.current;
    void ipc.invoke('org.grants.view', { ref }).then((result) => {
      if (!under.live || latest.current !== mine) return;
      if (result.ok) setHeld({ signIn, view: result.value });
      else failed(result.error);
    });
  }, [ref, signIn]);
  useEffect(() => {
    const mounted = { live: true };
    scope.current = mounted;
    reload();
    const off = ipc.on('org.grants.changed', (changed) => {
      if (changed.ref === ref) reload();
    });
    return () => {
      mounted.live = false;
      off();
    };
  }, [reload, ref]);
  return { view: held.signIn === signIn ? held.view : null, reload };
}

type RowProps = {
  machine: ViewMachine;
  view: OrgView;
  /** The sign-in standing now; null while none does. */
  signIn: string | null;
  /** You are an admin (an admin re-enrolls). */
  admin: boolean;
  /** This machine's re-enrollment, while one shows in the status. */
  enrolling: OrgEnrollingStatus;
  ask(title: string, change: OrgChange): void;
  reenroll(follow: number | null): void;
};

export function MachineRow({ machine, view, signIn, admin, enrolling, ask, reenroll }: RowProps) {
  const linked = useMachines((s) => s.machines.get(machine.ref as MachineRef)?.state ?? 'unknown');
  const grants = useGrantsView(machine.ref, signIn);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  if (sheet !== null && sheet.signIn !== signIn) setSheet(null); // the sign-in it opened under has ended
  const { name, ref, certified } = machine;
  const may = view.maySign && !certified;
  const thisMac = ref === ipc.localMachine;
  const damaged = grants.view?.ok === false && grants.view.reason === 'damaged';
  const mayGrant = machine.mayGrant && !damaged;
  const shown = grants.view?.ok === true ? grants.view : null;
  const me = view.members.find((m) => m.you)?.id;
  // Who may read every member's entry: an owner, or an admin for an org-owned machine; anyone else reads their own.
  const seesAll = machine.owners === 'org' ? admin : me !== undefined && machine.owners.includes(me);
  const open = (next: Sheet) => {
    setOutcome(null);
    grants.reload(); // read again as the sheet opens
    setSheet(next);
  };
  const grant = (draft: GrantDraft | null) => signIn !== null && open({ at: 'grant', draft, signIn });
  const owners = (owned: ViewMachine['owners']): string => (owned === 'org' ? ORG.ownedByOrg : ORG.ownedBy(inWords(owned.map((id) => memberName(view.members, id)))));
  return (
    <div id={machineRowId(ref)} tabIndex={-1} className="rounded-sm outline-accent data-sought:outline-2">
      <Setting label={name}>
        <span className={linked === 'up' ? 'text-fg' : 'text-fg-muted'}>{ORG.machineState[linked]}</span>
        {thisMac && <Chip>{ORG.thisMacMark}</Chip>}
        <span className="text-fg-muted">{owners(machine.owners)}</span>
        <span className="font-mono text-fg-muted">{ORG.machineKey(machine.keyId)}</span>
        {mayGrant && (
          <button type="button" className={TEXT_ACTION} onClick={() => grant(null)}>
            {ORG.grant}
          </button>
        )}
        {may && (
          <button type="button" className={TEXT_ACTION} onClick={() => ask(ORG.changeTitles['machine.owners'](name), { kind: 'machine.owners', ref, owners: machine.owners })}>
            {ORG.ownersAction}
          </button>
        )}
        {may && admin && enrolling === null && (
          <button type="button" className={TEXT_ACTION} onClick={() => reenroll(null)}>
            {ORG.reenroll}
          </button>
        )}
        {may && !thisMac && (
          <button type="button" className={TEXT_ACTION} onClick={() => ask(ORG.changeTitles['machine.drop'](name), { kind: 'machine.drop', ref, revoke: false })}>
            {ORG.drop}
          </button>
        )}
        {certified && machine.delegation !== null && <span className="basis-full text-fg-muted">{ORG.certifiedOwners(machine.delegation)}</span>}
        {enrolling !== null && (
          <div className="flex basis-full flex-wrap items-center gap-2">
            <span className={enrolling.problem === null ? 'text-fg-muted' : 'text-warning'}>{enrolling.problem === null ? ORG.reenrollingUntil(formatClock(Date.parse(enrolling.expires))) : ORG.enrollProblems[enrolling.problem]}</span>
            <button type="button" className={TEXT_ACTION} onClick={() => reenroll(enrolling.generation)}>
              {ORG.enrollShow}
            </button>
          </div>
        )}
        {damaged && <span className="basis-full text-warning">{ORG.grantsDamaged}</span>}
        {shown !== null && <Rights machine={machine} view={view} shown={shown} seesAll={seesAll} mayGrant={mayGrant} signAgain={grant} regrant={() => signIn !== null && open({ at: 'regrant', signIn })} />}
        <OutcomeLine outcome={outcome} />
      </Setting>
      {sheet?.at === 'grant' && (
        <GrantSheet machine={machine} members={view.members} grants={shown} may={mayGrant} draft={sheet.draft} onClose={() => setSheet(null)} onSaved={setOutcome} />
      )}
      {sheet?.at === 'regrant' && <RegrantSheet machine={machine} members={view.members} grants={shown} may={mayGrant} onClose={() => setSheet(null)} onSaved={setOutcome} />}
    </div>
  );
}

type RightsProps = { machine: ViewMachine; view: OrgView; shown: Shown; seesAll: boolean; mayGrant: boolean; signAgain(draft: GrantDraft): void; regrant(): void };

function Rights({ machine, view, shown, seesAll, mayGrant, signAgain, regrant }: RightsProps) {
  const { name } = machine;
  return (
    <>
      {shown.grants.map((g) => {
        const listed = view.members.some((m) => m.id === g.member);
        return (
          <div key={g.member} data-org-grant className="flex min-w-0 basis-full flex-wrap items-center gap-2">
            <span>{memberName(view.members, g.member)}</span>
            <span className="text-fg-muted">{g.rights.length === 0 ? ORG.withdrawn : inWords(g.rights)}</span>
            {g.state === 'pending' && <Chip>{ORG.notYetOn(name)}</Chip>}
            {g.state === 'refused' && (
              <>
                <span className="text-warning">{g.reason === 'not-newer' ? ORG.notNewer : ORG.grantRefusedBy(name, g.reason ?? 'refused')}</span>
                {mayGrant && listed && (
                  <button type="button" className={TEXT_ACTION} onClick={() => signAgain({ member: g.member, rights: g.rights })}>
                    {ORG.signAgain}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
      {shown.grants.length === 0 && <span className="basis-full text-fg-muted">{seesAll ? ORG.onlyOwners : ORG.noRightsYou}</span>}
      {!shown.live && <span className="basis-full text-fg-muted">{shown.asOf === null ? ORG.rightsUnanswered(name) : ORG.rightsAsOf(name, formatDayTime(Date.parse(shown.asOf)))}</span>}
      {shown.missing.length > 0 && (
        <div className="flex min-w-0 basis-full flex-wrap items-center gap-2">
          <span className="text-warning">{ORG.missingGrants(shown.missing.length, name)}</span>
          {mayGrant && (
            <button type="button" className={TEXT_ACTION} onClick={regrant}>
              {ORG.regrant}
            </button>
          )}
        </div>
      )}
    </>
  );
}
