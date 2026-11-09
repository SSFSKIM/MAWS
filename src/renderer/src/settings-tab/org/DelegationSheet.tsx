// The create sheet (P5 O8 M4c, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4c's *The create transaction*
// and *The destination*; Decision Log, "M4c's refresh at its cut" item 16). A new delegation from its fields: a label (the
// hub key's, 1 to 100 characters), a prefix, a life in whole days and a use cap (none, or 1 to the most a key takes),
// both held here inside the provisioning bounds, and its machines' owners. It names where the code goes ("<project>/
// <secret> as a new version") and when devcloud uses it, then sends one `org.delegation.create`; the mint, the one Touch
// ID, the code's write and the publish are all main's.
//
// - The code is never shown, copied or held here: no answer carries it (main's strict output schemas admit none, and the
//   client checks each answer against them), and the sheet draws only what an answer says.
// - Each outcome has its line and its next step: `secret-store` with what's missing, a refusal (a mint disagreement
//   among them, its key revoked), `busy`, a cancel (its key revoked), and a write that left the delegation signed and
//   unsent, which offers "Write the code again" while this run holds its key pair (the view's `unsent.rewrite`), else
//   says to Discard it from its row. A success reaches the page with the code's version and time, and closes the sheet.
// - Its ownership follows the enrollment sheet's guards, without its code: each request is fenced by its token (only
//   the latest one's answer lands, and none once the sheet has closed), and the sheet belongs to the sign-in it opened
//   under (`useOwnSignIn`). Once that ends, an answer stays in the sheet, offers nothing and reaches nothing of the page,
//   since a create the ended run made is main's to end (its key a stray, or its slot only Discard's). A create has no
//   generation on the IPC: main's own run check answers an ended run's request, and the sheet shows what it said.
import { useEffect, useRef, useState } from 'react';
import { formatDayTime } from '@shared/app/date-format';
import { DELEGATION_MAX_USES, DELEGATION_TTL_DAYS, type DelegationCreateInput, type OrgDelegationRow, type OrgView, type ProvisioningSecret, type SignResult } from '@shared/ipc/schema/org';
import { ipc } from '../../ipc/client';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { PRIMARY } from '../../sessions/ui';
import { ORG } from '../copy';
import { INPUT, Segment } from '../parts';
import { OwnersPicker, type Owners } from './ChangeSheet';
import { failed, OutcomeLine, useOpen, useOwnSignIn, type Invoked, type Outcome } from './parts';

/** A new delegation's life offered first: the hub's default key life (desk-hub's PROVISIONING_KEY_TTL_S, 90 days). */
const DEFAULT_DAYS = 90;
const LABEL_MAX = 100;
const PREFIX_MAX = 64;

type Draft = { label: string; prefix: string; days: string; capped: boolean; cap: string; owners: Owners };
type Asked = 'create' | 'rewrite';
type Stage = { at: 'fields' } | { at: 'asking'; token: number; asked: Asked } | { at: 'answered'; asked: Asked; result: SignResult; prefix: string };

const whole = (text: string, min: number, max: number): number | null => {
  const n = Number(text);
  return text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** The create's input from the fields, and which fields are out of their bounds (an empty one isn't yet). */
function read(draft: Draft): { input: DelegationCreateInput | null; label: boolean; days: boolean; cap: boolean } {
  const label = draft.label.trim();
  const prefix = draft.prefix.trim();
  const ttlDays = whole(draft.days, DELEGATION_TTL_DAYS.min, DELEGATION_TTL_DAYS.max);
  const cap = draft.capped ? whole(draft.cap, 1, DELEGATION_MAX_USES) : null;
  const ok = label.length >= 1 && label.length <= LABEL_MAX && prefix.length >= 1 && prefix.length <= PREFIX_MAX && ttlDays !== null && (!draft.capped || cap !== null) && (draft.owners === 'org' || draft.owners.length > 0);
  return {
    input: ok ? { label, prefix, ttlDays, maxUses: draft.capped ? cap : null, owners: draft.owners } : null,
    label: label.length > LABEL_MAX,
    days: draft.days.trim() !== '' && ttlDays === null,
    cap: draft.capped && draft.cap.trim() !== '' && cap === null,
  };
}

const created = (prefix: string, result: Extract<SignResult, { ok: true }>): string =>
  ORG.created(prefix, result.version, result.secret === undefined ? null : { version: result.secret.version, time: formatDayTime(Date.parse(result.secret.createTime)) });

/** A refused answer's line: the create's or the write's words for its reason, then main's detail; a bare cancel says nothing. */
function refusedLine(asked: Asked, result: Extract<SignResult, { ok: false }>): Outcome {
  if (result.reason === 'cancelled' && result.detail === undefined) return null; // the person's own cancel, nothing minted
  const [lead, line] = asked === 'create' ? [ORG.notCreated, ORG.createReasons[result.reason]] : [ORG.notWritten, ORG.rewriteReasons[result.reason]];
  return { text: [lead, line, result.detail].filter((part) => part !== undefined && part !== '').join(' · '), refused: true };
}

type Props = {
  /** Where the code goes (main's file as last read); null while none is set. */
  destination: ProvisioningSecret | null;
  members: OrgView['members'];
  may: boolean;
  /** The sign-in standing now (`signInOf`); null while none does. */
  signIn: string | null;
  /** A create or a write of this Mac's is under way (the status's `delegations.creating`), in any window. */
  creating: boolean;
  /** The delegation the view lists unsent (the pending slot's), for "Write the code again". */
  unsent: OrgDelegationRow | null;
  onClose(): void;
  onCreated(outcome: Outcome): void;
};

export function DelegationSheet({ destination, members, may, signIn, creating, unsent, onClose, onCreated }: Props) {
  const open = useOpen();
  const own = useOwnSignIn(signIn);
  const tokens = useRef(0);
  const me = members.find((m) => m.you)?.id;
  const [draft, setDraft] = useState<Draft>({ label: '', prefix: '', days: String(DEFAULT_DAYS), capped: false, cap: '', owners: me === undefined ? 'org' : [me] });
  const [stage, setStage] = useState<Stage>({ at: 'fields' });
  const fields = read(draft);

  const send = (asked: Asked, prefix: string, request: () => Invoked<SignResult>) => {
    const token = ++tokens.current;
    setStage({ at: 'asking', token, asked });
    void request().then((result) => {
      if (!open.current || tokens.current !== token) return;
      if (result.ok) setStage({ at: 'answered', asked, result: result.value, prefix });
      else {
        failed(result.error);
        // a write that failed as a command leaves the delegation as it was: unsent
        setStage(asked === 'create' ? { at: 'fields' } : { at: 'answered', asked, result: { ok: false, reason: 'unsent' }, prefix });
      }
    });
  };
  const create = () => {
    const input = fields.input;
    if (input === null || destination === null || own.ended) return;
    send('create', input.prefix, () => ipc.invoke('org.delegation.create', input));
  };
  const rewrite = (id: string, prefix: string) => {
    if (own.ended) return;
    send('rewrite', prefix, () => ipc.invoke('org.delegation.rewrite', { id }));
  };

  // A success goes to the page and closes the sheet while its sign-in stands; otherwise it stays here.
  const answer = stage.at === 'answered' ? stage : null;
  const delivered = answer !== null && answer.result.ok && !own.ended ? answer : null;
  useEffect(() => {
    if (delivered === null || !delivered.result.ok) return;
    onCreated({ text: created(delivered.prefix, delivered.result), refused: false });
    onClose();
  }, [delivered, onCreated, onClose]);

  // Signed and held unsent (by the create, or still after a write): no second create, only its own way on.
  const held = answer !== null && !answer.result.ok && (answer.result.reason === 'unsent' || answer.asked === 'rewrite');
  const editing = stage.at === 'fields' || (stage.at === 'asking' && stage.asked === 'create') || (answer !== null && !answer.result.ok && !held);
  const asking = stage.at === 'asking';
  const line = answer === null ? null : answer.result.ok ? { text: created(answer.prefix, answer.result), refused: false } : refusedLine(answer.asked, answer.result);
  const writable = held && !own.ended && may && unsent !== null && unsent.unsent?.rewrite === true;
  const form = asking
    ? { submit: stage.asked === 'create' ? ORG.creating : ORG.writing, can: false, act: () => {}, cancel: ORG.close }
    : held
      ? { submit: writable ? ORG.writeAgain : undefined, can: !creating, act: () => unsent !== null && rewrite(unsent.id, answer.prefix), cancel: ORG.close }
      : answer !== null && answer.result.ok
        ? { submit: undefined, can: false, act: () => {}, cancel: ORG.close }
        : { submit: may && !own.ended ? ORG.createConfirm : undefined, can: fields.input !== null && destination !== null && !creating, act: create, cancel: ORG.cancel };

  return (
    <Sheet title={ORG.createTitle} width="w-[min(560px,90vw)]" onClose={onClose}>
      <SheetForm submitLabel={form.submit} submitClass={PRIMARY} canSubmit={form.can} onSubmit={form.act} cancelLabel={form.cancel}>
        <div className="flex flex-col gap-2 text-ui-sm leading-normal">
          {destination === null ? (
            <p className="m-0 text-warning">{ORG.createSheetNoDestination}</p>
          ) : (
            <>
              <p className="m-0 text-fg">{ORG.createDestination(destination.project, destination.secret)}</p>
              <p className="m-0 text-fg-muted">{ORG.createDevcloud}</p>
            </>
          )}
          {editing && <Fields draft={draft} problems={fields} disabled={asking} members={members} onChange={setDraft} />}
          {editing && !asking && <p className="m-0 text-fg-muted">{ORG.createIntro}</p>}
          {asking && <p role="status" className="m-0 text-fg-muted">{stage.asked === 'create' ? ORG.creatingLine : ORG.writing}</p>}
          <OutcomeLine outcome={line} />
          {held && !own.ended && unsent !== null && unsent.unsent?.rewrite === false && <p className="m-0 text-fg-muted">{ORG.createUnsentDiscard}</p>}
          {editing && !asking && creating && <p className="m-0 text-fg-muted">{ORG.createWaits}</p>}
          {own.ended && <p className="m-0 text-fg-muted">{ORG.createSignInEnded}</p>}
          {!may && !own.ended && <p className="m-0 text-warning">{ORG.readOnly}</p>}
        </div>
      </SheetForm>
    </Sheet>
  );
}

type FieldsProps = { draft: Draft; problems: { label: boolean; days: boolean; cap: boolean }; disabled: boolean; members: OrgView['members']; onChange(next: Draft): void };

// The fields, each beside its bounds; a bound turns to the warning tone once the field is outside it.
function Fields({ draft, problems, disabled, members, onChange }: FieldsProps) {
  const note = (text: string, problem: boolean) => <p className={`m-0 pl-23 ${problem ? 'text-warning' : 'text-fg-muted'}`}>{text}</p>;
  return (
    <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <label className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-fg-muted">{ORG.createFields.label}</span>
        <input aria-label={ORG.createFields.label} value={draft.label} onChange={(e) => onChange({ ...draft, label: e.target.value })} spellCheck={false} autoComplete="off" autoFocus className={INPUT} />
      </label>
      {note(ORG.createLabelNote, problems.label)}
      <label className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-fg-muted">{ORG.createFields.prefix}</span>
        <input aria-label={ORG.createFields.prefix} value={draft.prefix} onChange={(e) => onChange({ ...draft, prefix: e.target.value })} spellCheck={false} autoComplete="off" className={`${INPUT} font-mono`} />
      </label>
      {note(ORG.createPrefixNote, false)}
      <label className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-fg-muted">{ORG.createFields.ttl}</span>
        <input
          aria-label={ORG.createFields.ttl}
          type="number"
          inputMode="numeric"
          min={DELEGATION_TTL_DAYS.min}
          max={DELEGATION_TTL_DAYS.max}
          value={draft.days}
          onChange={(e) => onChange({ ...draft, days: e.target.value })}
          className={`${INPUT} max-w-24`}
        />
        <span className="text-fg-muted">{ORG.days}</span>
      </label>
      {note(ORG.createTtlBounds(DELEGATION_TTL_DAYS.min, DELEGATION_TTL_DAYS.max), problems.days)}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="w-20 shrink-0 text-fg-muted">{ORG.createFields.uses}</span>
        <Segment<'none' | 'cap'>
          label={ORG.createFields.uses}
          value={draft.capped ? 'cap' : 'none'}
          options={[
            { value: 'none', label: ORG.createUsesKinds.none },
            { value: 'cap', label: ORG.createUsesKinds.cap },
          ]}
          onChange={(kind) => onChange({ ...draft, capped: kind === 'cap' })}
        />
        {draft.capped && (
          <input
            aria-label={ORG.createUseCap}
            type="number"
            inputMode="numeric"
            min={1}
            max={DELEGATION_MAX_USES}
            value={draft.cap}
            onChange={(e) => onChange({ ...draft, cap: e.target.value })}
            className={`${INPUT} max-w-24`}
          />
        )}
      </div>
      {draft.capped && note(ORG.createUsesBounds(DELEGATION_MAX_USES), problems.cap)}
      <OwnersPicker owners={draft.owners} members={members} onChange={(owners) => onChange({ ...draft, owners })} />
    </fieldset>
  );
}
