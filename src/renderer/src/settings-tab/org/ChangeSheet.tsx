// The change sheet (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end" and
// *Changes*): one change, shown before it is signed. Add person and Change email take their fields first; every change
// then reads `org.preview`, which composes it on the held head and runs the checks, and shows its lines one by one with
// the checks' warnings. Sign sends `org.change` with the change as previewed (normalized: `member.add`'s new id) and the
// digest naming what was shown, so main signs nothing else (`stale`); Touch ID follows in main. A change the checks
// refuse is named here, with no Sign, and never reaches Touch ID. Once this Mac can't sign (`may`: signed out, or no
// longer a root), Review and Sign are withdrawn and the sheet says why; a sign already in flight still shows its answer.
//
// M4b adds the machine kinds' fields: Owners (the org's admins, or people chosen from the members, a former member's id
// kept until unticked; Review waits for a change, since main refuses the same owners and an empty list) and Drop (the
// "Its key may be compromised" tick, `revoke`). A removal refused because the person owns a machine shows the composer's
// line "Change the machine's owners first", with a way to that machine's row (`machines`, `onGoTo`).
//
// A sign's answer reaches the page only from the sheet that sent it, still open, under the sign-in it opened under: an
// answer after the sheet closed lands nowhere, and one after that sign-in ended stays in the sheet (`signIn`, latched by
// `useOwnSignIn`), so it never closes a sheet opened since or tells a later sign-in's page about it.
import { useEffect, useState } from 'react';
import type { OrgChange, OrgView, PreviewResult, SignResult } from '@shared/ipc/schema/org';
import { ipc } from '../../ipc/client';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { CHOICE, PRIMARY, QUIET } from '../../sessions/ui';
import { ORG } from '../copy';
import { INPUT, Segment, TEXT_ACTION } from '../parts';
import { failed, memberName, OutcomeLine, signOutcome, useOpen, useOwnSignIn, type Outcome } from './parts';

type Role = 'admin' | 'member';
type Stage =
  | { at: 'fields' }
  | { at: 'composing' }
  | { at: 'shown'; preview: PreviewResult }
  | { at: 'signing'; preview: Extract<PreviewResult, { ok: true }> }
  | { at: 'signed'; preview: Extract<PreviewResult, { ok: true }>; version: number }
  | { at: 'ended'; preview: Extract<PreviewResult, { ok: true }>; outcome: Outcome };

// The fields a change takes before it is composed: Add person's email and role, Change email's new email, a machine's
// owners, and a drop's revoke tick.
const takesFields = (change: OrgChange): boolean => change.kind === 'member.add' || change.kind === 'member.email' || change.kind === 'machine.owners' || change.kind === 'machine.drop';

type Owners = Extract<OrgChange, { kind: 'machine.owners' }>['owners'];
const sameOwners = (a: Owners, b: Owners) => (a === 'org' || b === 'org' ? a === b : a.length === b.length && a.every((id) => b.includes(id)));

type Props = {
  title: string;
  change: OrgChange;
  /** The org's members, for a machine's owners. */
  members?: OrgView['members'];
  may: boolean;
  /** The sign-in standing now (`signInOf`); null while none does. */
  signIn: string | null;
  /** The machines a refusal may send the person to (a member who owns one isn't removed), with the way there. */
  machines?: readonly { name: string; ref: string }[];
  onGoTo?(ref: string): void;
  onClose(): void;
  onSigned(version: number): void;
};

export function ChangeSheet({ title, change: asked, members = [], may, signIn, machines = [], onGoTo, onClose, onSigned }: Props) {
  const open = useOpen();
  const own = useOwnSignIn(signIn);
  const [change, setChange] = useState<OrgChange>(asked);
  const [stage, setStage] = useState<Stage>(takesFields(asked) ? { at: 'fields' } : { at: 'composing' });
  const composing = stage.at === 'composing';

  // The preview, each time the sheet comes to compose: the latest one shown.
  useEffect(() => {
    if (!composing) return;
    let live = true;
    void ipc.invoke('org.preview', { change }).then((result) => {
      if (!live) return;
      if (result.ok) setStage({ at: 'shown', preview: result.value });
      else {
        failed(result.error);
        onClose();
      }
    });
    return () => {
      live = false;
    };
  }, [composing, change, onClose]);

  const sign = (preview: Extract<PreviewResult, { ok: true }>) => {
    setStage({ at: 'signing', preview });
    void ipc.invoke('org.change', { change: preview.change, digest: preview.digest }).then((result) => {
      if (!open.current) return;
      if (!result.ok) {
        failed(result.error);
        setStage({ at: 'shown', preview });
        return;
      }
      const signed: SignResult = result.value;
      if (signed.ok) setStage({ at: 'signed', preview, version: signed.version });
      else if (signed.reason === 'cancelled') setStage({ at: 'shown', preview }); // the person's own cancel: Sign again
      else setStage({ at: 'ended', preview, outcome: signOutcome(signed) });
    });
  };

  // A signed answer goes to the page and closes the sheet while its sign-in stands; otherwise it stays here.
  const delivered = stage.at === 'signed' && !own.ended ? stage.version : null;
  useEffect(() => {
    if (delivered === null) return;
    onSigned(delivered);
    onClose();
  }, [delivered, onSigned, onClose]);

  const fields = stage.at === 'fields';
  const preview = stage.at === 'composing' || stage.at === 'fields' ? null : stage.preview;
  const shown = preview !== null && preview.ok ? preview : null;
  // Sign while what was shown can still be signed: never on a refused preview, nor once a sign has ended.
  const signable = shown !== null && stage.at !== 'ended' && stage.at !== 'signed';
  const submit = () => {
    if (fields) {
      setChange(trimmed(change) ?? change);
      setStage({ at: 'composing' });
    } else if (shown !== null) sign(shown);
  };
  // Owners left as they are would be refused as no change: Review waits for one.
  const reviewable = trimmed(change) !== null && !(change.kind === 'machine.owners' && asked.kind === 'machine.owners' && sameOwners(change.owners, asked.owners));
  return (
    <Sheet title={title} width="w-[min(560px,90vw)]" onClose={onClose}>
      <SheetForm
        submitLabel={!may ? undefined : fields ? ORG.review : signable ? ORG.changeConfirm : undefined}
        submitClass={PRIMARY}
        canSubmit={fields ? reviewable : stage.at === 'shown'}
        onSubmit={submit}
        cancelLabel={ORG.cancel}
        extra={
          may && takesFields(asked) && !fields && stage.at !== 'signing' && stage.at !== 'signed' ? (
            <button type="button" onClick={() => setStage({ at: 'fields' })} className={`mr-auto ${QUIET}`}>
              {ORG.edit}
            </button>
          ) : undefined
        }
      >
        {fields ? (
          <Fields change={change} members={members} onChange={setChange} />
        ) : preview === null ? (
          <p className="m-0 text-ui-sm text-fg-muted">{ORG.composing}</p>
        ) : preview.ok ? (
          <Lines lines={preview.lines} warnings={preview.warnings} />
        ) : (
          <Refused preview={preview} machines={machines} onGoTo={onGoTo} />
        )}
        {stage.at === 'ended' && <OutcomeLine outcome={stage.outcome} />}
        {stage.at === 'signed' && own.ended && <OutcomeLine outcome={{ text: ORG.signed(stage.version), refused: false }} />}
        {!may && <p className="m-0 text-ui-sm text-warning">{ORG.readOnly}</p>}
      </SheetForm>
    </Sheet>
  );
}

// The change with its typed email trimmed, as sent; null while that email is empty, or no owner is chosen.
function trimmed(change: OrgChange): OrgChange | null {
  if (change.kind === 'machine.owners') return change.owners !== 'org' && change.owners.length === 0 ? null : change;
  if (change.kind !== 'member.add' && change.kind !== 'member.email') return change;
  const email = change.email.trim();
  return email === '' ? null : { ...change, email };
}

// Add person's email and role (a member unless chosen), or Change email's new email. Sent trimmed; main lower-cases.
function Fields({ change, members, onChange }: { change: OrgChange; members: OrgView['members']; onChange(next: OrgChange): void }) {
  if (change.kind === 'machine.owners') return <OwnersFields change={change} members={members} onChange={onChange} />;
  if (change.kind === 'machine.drop') {
    return (
      <label className="flex items-start gap-2 text-ui-sm leading-normal">
        <input type="checkbox" checked={change.revoke} onChange={(e) => onChange({ ...change, revoke: e.target.checked })} className={`mt-0.5 shrink-0 ${CHOICE}`} />
        <span>
          <span className="text-fg">{ORG.revokeKey}</span> <span className="text-fg-muted">{ORG.revokeKeyNote}</span>
        </span>
      </label>
    );
  }
  if (change.kind !== 'member.add' && change.kind !== 'member.email') return null;
  const label = change.kind === 'member.add' ? ORG.email : ORG.newEmail;
  return (
    <div className="flex flex-col gap-2 text-ui-sm">
      <label className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-fg-muted">{label}</span>
        <input
          aria-label={label}
          type="text"
          inputMode="email"
          value={change.email}
          onChange={(e) => onChange({ ...change, email: e.target.value })}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          className={INPUT}
        />
      </label>
      {change.kind === 'member.add' && (
        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-fg-muted">{ORG.role}</span>
          <Segment<Role>
            label={ORG.role}
            value={change.role}
            options={[
              { value: 'member', label: ORG.roles.member },
              { value: 'admin', label: ORG.roles.admin },
            ]}
            onChange={(role) => onChange({ ...change, role })}
          />
        </div>
      )}
    </div>
  );
}

// A machine's owners: the org (its admins), or people ticked from the members, in the members' order. An owner the head
// no longer lists stays ticked, as a former member, until unticked.
function OwnersFields({ change, members, onChange }: { change: Extract<OrgChange, { kind: 'machine.owners' }>; members: OrgView['members']; onChange(next: OrgChange): void }) {
  const [people, setPeople] = useState<string[]>(change.owners === 'org' ? [] : [...change.owners]); // kept across a switch to the org and back
  const [formerly] = useState(() => (change.owners === 'org' ? [] : change.owners.filter((id) => !members.some((m) => m.id === id))));
  const listed = [...members.map((m) => m.id), ...formerly];
  const pick = (chosen: string[]) => {
    setPeople(chosen);
    onChange({ ...change, owners: chosen });
  };
  const toggle = (id: string) => pick(listed.filter((each) => (each === id ? !people.includes(id) : people.includes(each))));
  return (
    <div className="flex flex-col gap-2 text-ui-sm">
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-fg-muted">{ORG.owners}</span>
        <Segment<'org' | 'people'>
          label={ORG.owners}
          value={change.owners === 'org' ? 'org' : 'people'}
          options={[
            { value: 'org', label: ORG.ownersKinds.org },
            { value: 'people', label: ORG.ownersKinds.people },
          ]}
          onChange={(kind) => onChange({ ...change, owners: kind === 'org' ? 'org' : people })}
        />
      </div>
      {change.owners !== 'org' && (
        <fieldset aria-label={ORG.ownersKinds.people} className="m-0 flex max-h-[min(40vh,320px)] min-w-0 flex-col gap-1.5 overflow-y-auto border-0 p-0.5">
          {listed.map((id) => (
            <label key={id} className="flex min-w-0 items-center gap-2">
              <input type="checkbox" checked={people.includes(id)} onChange={() => toggle(id)} className={`shrink-0 ${CHOICE}`} />
              <span className="min-w-0 text-fg">{memberName(members, id)}</span>
              <span className="min-w-0 text-fg-muted [overflow-wrap:anywhere]">{members.find((m) => m.id === id)?.email}</span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

function Lines({ lines, warnings }: { lines: string[]; warnings: string[] }) {
  return (
    <div className="text-ui-sm leading-normal">
      <p className="m-0 text-fg">{ORG.changeIntro}</p>
      <ul className="m-0 mt-2 list-disc pl-5 text-fg">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {warnings.map((warning, i) => (
        <p key={i} className="m-0 mt-2 text-warning">
          {ORG.changeWarning(warning)}
        </p>
      ))}
    </div>
  );
}

// A preview main refused: why, and each finding the checks named (a warning as a warning). A removal its ownership of a
// machine refuses (`owners-unknown`) offers the way to each such machine's row.
function Refused({ preview, machines, onGoTo }: { preview: Extract<PreviewResult, { ok: false }>; machines: readonly { name: string; ref: string }[]; onGoTo?(ref: string): void }) {
  const refusals = preview.findings.filter((f) => f.level === 'refuse').map((f) => f.detail);
  const owned = onGoTo !== undefined && preview.findings.some((f) => f.code === 'owners-unknown') ? machines : [];
  const warnings = preview.findings.filter((f) => f.level === 'warn').map((f) => f.detail);
  return (
    <div role="alert" className="text-ui-sm leading-normal">
      <p className="m-0 text-warning">{ORG.previewRefused[preview.reason]}</p>
      {preview.reason !== 'refused' && preview.detail !== undefined && <p className="m-0 mt-1 text-fg-muted">{preview.detail}</p>}
      {refusals.length > 0 && (
        <ul className="m-0 mt-2 list-disc pl-5 text-fg">
          {refusals.map((detail, i) => (
            <li key={i}>{detail}</li>
          ))}
        </ul>
      )}
      {warnings.map((warning, i) => (
        <p key={i} className="m-0 mt-2 text-warning">
          {ORG.changeWarning(warning)}
        </p>
      ))}
      {owned.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {owned.map((m) => (
            <button key={m.ref} type="button" className={TEXT_ACTION} onClick={() => onGoTo?.(m.ref)}>
              {ORG.goToMachine(m.name)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
