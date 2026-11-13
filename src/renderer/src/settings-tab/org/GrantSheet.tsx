// The grant sheets (P5 O8 M4b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's "Rights" and
// "Re-granting"), opened from a machine's row (MachineRow.tsx), which reads the machine's grants as a sheet opens and
// hands them down.
//
// - GrantSheet: a person, then the rights (`spawn`, `shell`, `machine-admin`), each with one line on what it allows,
//   preselected as the person holds them now. Save sends `org.grants.set`; withdrawing is no rights. Main signs one grant
//   at its next version behind one confirmation that shows it, then delivers it. Owners hold every right and need none,
//   so an owner is offered only while they still hold a grant (to withdraw it).
// - RegrantSheet: each grant this Mac issued that the machine no longer holds, then `org.grants.regrant` naming the list
//   shown (`digest`), signed again for the machine's current key under one confirmation.
//
// Before Touch ID, main may bring the machine up to date (push the org's head to it) and read its ledger again, so from
// the press until the answer the sheet says so: never a dead button. Main offers no cancel for either, so none is shown:
// the sheet's own button reads Close meanwhile, and an answer that comes after it closed lands nowhere. Every refusal reads in its own words,
// and names what to do next or who can act (U11a board 540): main's detail follows only where it says what the line does not
// (`ledger-unread`'s which ledger, `storage`'s what could not be written, `refused`'s verdict code), and `ineligible`
// lists each problem `grantProblems` names, once. Once this Mac may no longer sign a grant there (its grants record
// damaged, or no longer an owner's device), Save is withdrawn and the sheet says why. With nobody to grant to, the sheet
// still says its read's state: reading, or why the read failed with Retry, and that everyone owns it only once known.
import { useState } from 'react';
import { GRANT_RIGHTS, type GrantRegrantResult, type GrantSetResult, type GrantsView } from '@shared/ipc/schema/org';
import { ipc } from '../../ipc/client';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { CHOICE, FIELD, PRIMARY } from '../../sessions/ui';
import { ORG } from '../copy';
import { failed, inWords, memberName, OUTCOME_UNKNOWN, Unread, useOpen, type Member, type Outcome, type ViewMachine } from './parts';

export type Right = (typeof GRANT_RIGHTS)[number];
/** A grant the sheet opens on: the person and the rights to sign again (a refused grant's Sign again…). */
export type GrantDraft = { member: string; rights: readonly Right[] };
type Shown = Extract<GrantsView, { ok: true }>;
type Refused = Extract<GrantSetResult, { ok: false }>;

const ordered = (rights: readonly Right[]): Right[] => GRANT_RIGHTS.filter((r) => rights.includes(r));
const same = (a: readonly Right[], b: readonly Right[]) => a.length === b.length && a.every((r) => b.includes(r));
const isOwner = (machine: ViewMachine, member: Member) => (machine.owners === 'org' ? member.role === 'admin' : machine.owners.includes(member.id));

/** How a signed grant stands at its machine, in the row's one line. */
function savedOutcome(machine: string, version: number, delivered: Extract<GrantSetResult, { ok: true }>['delivered']): Outcome {
  if (delivered === 'done') return { text: ORG.granted(version, machine), refused: false };
  if (delivered === 'pending') return { text: ORG.grantedPending(version, machine), refused: false };
  if (delivered.refused === 'not-newer') return { text: ORG.grantedNotNewer(version), refused: true };
  if (delivered.refused === OUTCOME_UNKNOWN) return { text: ORG.grantedOutcomeUnknown(version, machine), refused: true };
  return { text: `${ORG.grantedRefused(version, machine, ORG.grantVerdicts[delivered.refused])} · ${delivered.refused}`, refused: true };
}

// U11a board 540 (§B): the reasons whose detail main words as the line already says it (`ineligible`'s is its list, drawn
// below); any other reason's detail, one main gains later included, follows the line
const REPEATS = new Set<Refused['reason']>(['busy', 'invalid', 'no-change', 'stale', 'none', 'ineligible']);

function RefusedLine({ refused }: { refused: Refused }) {
  const detail = REPEATS.has(refused.reason) ? undefined : refused.detail;
  const text = [ORG.notSigned, ORG.grantRefusals[refused.reason], detail].filter((part) => part !== undefined && part !== '').join(' · ');
  return (
    <div role="alert" className="text-warning">
      <p className="m-0">{text}</p>
      {refused.problems !== undefined && refused.problems.length > 0 && (
        <ul className="m-0 mt-1 list-disc pl-5">
          {refused.problems.map((code) => (
            <li key={code}>{(ORG.grantProblems as Record<string, string>)[code] ?? code}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** While the machine's grants are unknown: a read still out, or why the last failed, with Retry. */
function ReadState({ machine, unread, retry }: { machine: string; unread: string | null; retry(): void }) {
  return unread === null ? <p className="m-0 text-fg-muted">{ORG.grantReading(machine)}</p> : <Unread line={unread} retry={retry} />;
}

type GrantProps = {
  machine: ViewMachine;
  members: readonly Member[];
  /** The machine's grants as the row last read them; null until a read answers. */
  grants: Shown | null;
  /** Why they are unknown while `grants` is null (a read refused or failed), said with Retry; null while one is out. */
  unread: string | null;
  onRetry(): void;
  /** This Mac may sign a grant on it now. */
  may: boolean;
  draft: GrantDraft | null;
  onClose(): void;
  onSaved(outcome: Outcome): void;
};

export function GrantSheet({ machine, members, grants, unread, onRetry, may, draft, onClose, onSaved }: GrantProps) {
  const open = useOpen();
  const [member, setMember] = useState(draft?.member ?? '');
  // The rights chosen here; null while they follow the person's as the machine's grants show them.
  const [chosen, setChosen] = useState<readonly Right[] | null>(draft?.rights ?? null);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<Refused | null>(null);
  // The person chosen stopped being offered (made an owner, or removed) while the sheet was open: chosen no longer.
  const [noLonger, setNoLonger] = useState(false);
  const { name } = machine;
  // Until a read of the machine's grants answers, nothing is known to compare with: no right to tick, no Save.
  const reading = grants === null;
  const holding = (id: string) => grants?.grants.find((g) => g.member === id) ?? null;
  const choices = members.filter((m) => !isOwner(machine, m) || holding(m.id) !== null);
  if (member !== '' && !saving && !reading && !choices.some((m) => m.id === member)) {
    setMember('');
    setChosen(null);
    setNoLonger(true);
  }
  const row = member === '' ? null : holding(member);
  // What the person holds now, to compare with: unknown before an answer, and for a grant the machine refused.
  const held: readonly Right[] | null = row === null ? (grants === null ? null : []) : row.state === 'refused' ? null : row.rights;
  const rights = chosen ?? held ?? [];
  const changed = held === null || !same(rights, held);
  // No rights for a person who holds some (or whose grant the machine refused) withdraws them.
  const withdraws = rights.length === 0 && (held === null ? row !== null : held.length > 0);
  const email = members.find((m) => m.id === member)?.email ?? '';

  const choose = (id: string) => {
    setMember(id);
    setChosen(null);
    setRefused(null);
    setNoLonger(false);
  };
  const toggle = (right: Right) => {
    setChosen(rights.includes(right) ? rights.filter((r) => r !== right) : [...rights, right]);
    setRefused(null);
  };
  const save = () => {
    setSaving(true);
    setRefused(null);
    void ipc.invoke('org.grants.set', { ref: machine.ref, member, rights: ordered(rights) }).then((result) => {
      if (!open.current) return;
      setSaving(false);
      if (!result.ok) return failed(result.error);
      const answer = result.value;
      if (answer.ok) {
        onSaved(savedOutcome(name, answer.version, answer.delivered));
        onClose();
      } else if (answer.reason !== 'cancelled' || answer.detail !== undefined) setRefused(answer); // a Touch ID cancel needs no line
    });
  };

  const offered = may && choices.length > 0;
  return (
    <Sheet title={ORG.grantTitle(name)} width="w-[min(520px,90vw)]" onClose={onClose}>
      <SheetForm
        submitLabel={!offered ? undefined : saving ? ORG.saving : withdraws ? ORG.grantWithdraw : ORG.grantSave}
        submitClass={PRIMARY}
        // No rights go only under Withdraw: a person who holds none is never sent none.
        canSubmit={member !== '' && !reading && changed && !saving && (rights.length > 0 || withdraws)}
        onSubmit={save}
        cancelLabel={saving ? ORG.close : ORG.cancel}
      >
        <div className="flex flex-col gap-3 text-ui-sm leading-normal">
          {choices.length === 0 ? (
            // nobody to grant to, as far as is known: until the grants are, the read's own state
            reading ? <ReadState machine={name} unread={unread} retry={onRetry} /> : <p className="m-0 text-fg-muted">{ORG.grantNobody}</p>
          ) : (
            <>
              <label className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-fg-muted">{ORG.grantPerson}</span>
                <select aria-label={ORG.grantPerson} value={member} disabled={saving} onChange={(e) => choose(e.target.value)} className={`${FIELD} min-w-0 flex-1`}>
                  <option value="" disabled>
                    {ORG.grantChoose}
                  </option>
                  {choices.map((m) => (
                    <option key={m.id} value={m.id}>{`${m.name} (${m.email})`}</option>
                  ))}
                </select>
              </label>
              <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                <legend className="mb-1 p-0 text-fg-muted">{ORG.grantRights}</legend>
                {GRANT_RIGHTS.map((right) => (
                  <label key={right} className="flex min-w-0 items-start gap-2">
                    <input type="checkbox" checked={rights.includes(right)} disabled={saving || reading || member === '' || !may} onChange={() => toggle(right)} className={`mt-0.5 shrink-0 ${CHOICE}`} />
                    <span className="min-w-0">
                      <span className="font-mono text-fg">{right}</span> <span className="text-fg-muted">{ORG.rightLines[right]}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {reading && <ReadState machine={name} unread={unread} retry={onRetry} />}
              {noLonger && <p className="m-0 text-warning">{ORG.grantNoLonger}</p>}
              {withdraws && <p className="m-0 text-fg-muted">{ORG.grantWithdrawLine(email, name)}</p>}
              <p className="m-0 text-fg-muted">{ORG.grantIntro}</p>
            </>
          )}
          {saving && (
            <p role="status" className="m-0 text-fg">
              {ORG.grantSaving(name)}
            </p>
          )}
          {refused !== null && <RefusedLine refused={refused} />}
          {!may && <p className="m-0 text-warning">{ORG.grantCantSign(name)}</p>}
        </div>
      </SheetForm>
    </Sheet>
  );
}

type RegrantProps = Omit<GrantProps, 'draft'>;

export function RegrantSheet({ machine, members, grants, unread, onRetry, may, onClose, onSaved }: RegrantProps) {
  const open = useOpen();
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<Extract<GrantRegrantResult, { ok: false }> | null>(null);
  const { name } = machine;
  const missing = grants?.missing ?? [];
  const digest = grants?.digest ?? null;
  const confirm = () => {
    if (digest === null) return;
    setSaving(true);
    setRefused(null);
    void ipc.invoke('org.grants.regrant', { ref: machine.ref, digest }).then((result) => {
      if (!open.current) return;
      setSaving(false);
      if (!result.ok) return failed(result.error);
      const answer = result.value;
      if (answer.ok) {
        onSaved({ text: ORG.regranted(answer.results.length, name), refused: false });
        onClose();
      } else if (answer.reason !== 'cancelled' || answer.detail !== undefined) setRefused(answer);
    });
  };
  const offered = may && missing.length > 0 && digest !== null;
  return (
    <Sheet title={ORG.regrantTitle(name)} width="w-[min(520px,90vw)]" onClose={onClose}>
      <SheetForm submitLabel={!offered ? undefined : saving ? ORG.saving : ORG.regrantConfirm} submitClass={PRIMARY} canSubmit={!saving} onSubmit={confirm} focusSubmit cancelLabel={saving ? ORG.close : ORG.cancel}>
        <div className="flex flex-col gap-2 text-ui-sm leading-normal">
          {grants === null ? (
            <ReadState machine={name} unread={unread} retry={onRetry} />
          ) : missing.length === 0 ? (
            <p className="m-0 text-fg-muted">{ORG.grantRefusals.none}</p>
          ) : (
            <>
              <p className="m-0 text-fg">{ORG.regrantIntro(name)}</p>
              <ul className="m-0 max-h-[min(40vh,320px)] list-disc overflow-y-auto pl-5 text-fg">
                {missing.map((g) => (
                  <li key={g.member}>
                    {memberName(members, g.member)}: {inWords(g.rights)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {saving && (
            <p role="status" className="m-0 text-fg">
              {ORG.grantSaving(name)}
            </p>
          )}
          {refused !== null && <RefusedLine refused={refused} />}
          {!may && <p className="m-0 text-warning">{ORG.grantCantSign(name)}</p>}
        </div>
      </SheetForm>
    </Sheet>
  );
}
