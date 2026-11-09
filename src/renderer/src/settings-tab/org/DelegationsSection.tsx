// The Org group's Delegations section (P5 O8 M4c, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4c's "At its
// end", *The view* and *The destination*; Decision Log, "M4c's refresh at its cut" items 7-9 and 16). A section of the Org
// group, not a fifth group, drawn from the view (`OrgView.delegations`, `strayKeys`, `hubKeys`):
//
// - Each delegation is a row (DelegationRow.tsx): its prefix, owners, expiry in words, uses, certified machines, the
//   hub's side of it with Retry where a hub half is left, and an unsent one's reason with its actions.
// - The hub's key list is an admin's read: a list that didn't read says so here, never reading as "no keys", with Retry
//   (`org.delegation.readKeys`, a read now under this sign-in); the stray keys it shows (hub keys no delegation names)
//   each carry Revoke behind a confirmation.
// - New delegation: Create opens the create sheet (DelegationSheet.tsx) while this Mac may sign, an admin's, a code
//   destination set, no other create running and no signed state pending; otherwise it says why. Renew and Drop go
//   through the change sheet. The section's signing acts end in one line on this row, since the row that sent one may
//   be gone once it settles (as the Machines group's Enroll row carries Owners' and Drop's).
// - Code destination: where a new delegation's code goes (`org.provisioningSecret.*`, main's own file), with Save; a
//   damaged file shows its reason and Reset behind a confirmation, and is never edited over.
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDayTime } from '@shared/app/date-format';
import { ProvisioningSecretSchema, type OrgChange, type OrgView, type ProvisioningSecret, type ProvisioningSecretReading } from '@shared/ipc/schema/org';
import { GatewaySheet } from '../../gateway/GatewaySheet';
import { ipc } from '../../ipc/client';
import { ORG } from '../copy';
import { INPUT, Setting, TEXT_ACTION } from '../parts';
import { ChangeSheet } from './ChangeSheet';
import { DelegationRow, StrayKey } from './DelegationRow';
import { DelegationSheet } from './DelegationSheet';
import { failed, OutcomeLine, signInOf, useOpen, type Outcome, type Registered } from './parts';

type Asked = { title: string; change: OrgChange };

/** A destination reading that names one (not unset, not damaged), else null. */
export const destinationOf = (reading: ProvisioningSecretReading | undefined): ProvisioningSecret | null => (reading === undefined || reading === null || 'damaged' in reading ? null : reading);

/** Main's destination file, read while `shown`, again on `reload`; undefined until the first answer. */
function useDestination(shown: boolean) {
  const open = useOpen();
  const latest = useRef(0);
  const [reading, setReading] = useState<ProvisioningSecretReading | undefined>(undefined);
  const reload = useCallback(() => {
    const mine = ++latest.current;
    void ipc.invoke('org.provisioningSecret.get', undefined).then((result) => {
      if (!open.current || latest.current !== mine) return;
      if (result.ok) setReading(result.value);
      else failed(result.error);
    });
  }, [open]);
  useEffect(() => {
    if (shown) reload();
  }, [shown, reload]);
  return { reading, reload };
}

export function DelegationsSection({ status, view }: { status: Registered; view: OrgView }) {
  const admin = view.members.find((m) => m.you)?.role === 'admin';
  const may = view.maySign;
  const signedIn = status.session === 'signed-in';
  const signIn = signInOf(status);
  const slot = signedIn ? (status.signer?.pending ?? null) : null;
  const { creating } = status.delegations;
  const destination = useDestination(admin && may);
  const dest = destinationOf(destination.reading);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const ask = (title: string, change: OrgChange) => {
    setOutcome(null);
    setAsked({ title, change });
  };
  const openCreate = () => {
    setOutcome(null);
    destination.reload(); // the sheet names where the code goes: read it again as it opens
    setSheetOpen(true);
  };
  const reading = destination.reading;
  const blocked =
    reading === null ? ORG.createNoDestination : reading !== undefined && 'damaged' in reading ? ORG.createDamaged : creating ? ORG.createWaits : slot !== null ? ORG.createPending : null;
  const { at, failed: unread } = view.hubKeys;
  return (
    <div data-org-section="delegations" className="mt-2">
      <h5 className="m-0 mt-1 mb-0.5 text-ui-sm font-medium text-fg">{ORG.delegations}</h5>
      {view.delegations.length === 0 && <p className="m-0 py-1 text-ui-sm text-fg-muted">{ORG.noDelegations}</p>}
      {view.delegations.map((delegation) => (
        <DelegationRow key={delegation.id} delegation={delegation} members={view.members} hubSide={admin} hubKeys={view.hubKeys} may={may} signedIn={signedIn} slot={slot} creating={creating} ask={ask} said={setOutcome} />
      ))}
      {admin && unread && <HubKeysUnread at={at} signedIn={signedIn} />}
      {admin && view.strayKeys.length > 0 && (
        <Setting label={ORG.strayKeys} note={ORG.strayNote}>
          {view.strayKeys.map((stray) => (
            <StrayKey key={stray.id} stray={stray} signedIn={signedIn} />
          ))}
        </Setting>
      )}
      <Setting label={ORG.newDelegation}>
        {!admin ? (
          <span className="text-fg-muted">{ORG.delegationsAdmins}</span>
        ) : !may ? (
          <span className="text-fg-muted">{ORG.delegationsCantSign}</span>
        ) : (
          <>
            <button type="button" className={TEXT_ACTION} disabled={reading === undefined || blocked !== null} onClick={openCreate}>
              {ORG.createAction}
            </button>
            {blocked !== null && <span className="text-fg-muted">{blocked}</span>}
          </>
        )}
        <OutcomeLine outcome={outcome} />
      </Setting>
      {admin && may && <DestinationField reading={reading} reload={destination.reload} />}
      {asked !== null && (
        <ChangeSheet title={asked.title} change={asked.change} members={view.members} may={may} signIn={signIn} onClose={() => setAsked(null)} onSigned={(version) => setOutcome({ text: ORG.signed(version), refused: false })} />
      )}
      {sheetOpen && <DelegationSheet destination={dest} members={view.members} may={may} signIn={signIn} creating={creating} delegations={view.delegations} slot={slot} rev={status.delegations.rev} onClose={() => setSheetOpen(false)} onCreated={setOutcome} />}
    </div>
  );
}

// A hub key list that didn't read, with Retry: a read now, past main's freshness, under this sign-in. The view follows
// main's own rev; a read that failed again says so here.
function HubKeysUnread({ at, signedIn }: { at: string | null; signedIn: boolean }) {
  const open = useOpen();
  const [acting, setActing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const retry = () => {
    setActing(true);
    setOutcome(null);
    void ipc.invoke('org.delegation.readKeys', undefined).then((result) => {
      if (!open.current) return;
      setActing(false);
      if (!result.ok) failed(result.error);
      else if (result.value.failed) setOutcome({ text: ORG.hubKeysStillFailed, refused: true });
    });
  };
  return (
    <Setting label={ORG.hubKeys}>
      <span className="text-warning">{ORG.hubKeysFailed(at === null ? null : formatDayTime(Date.parse(at)))}</span>
      {signedIn && (
        <button type="button" className={TEXT_ACTION} disabled={acting} onClick={retry}>
          {ORG.retry}
        </button>
      )}
      <OutcomeLine outcome={outcome} />
    </Setting>
  );
}

const FIELDS = ['project', 'secret', 'account'] as const;
type Field = (typeof FIELDS)[number];

// The code's destination: the three values with Save, or a damaged file's reason with Reset.
function DestinationField({ reading, reload }: { reading: ProvisioningSecretReading | undefined; reload(): void }) {
  const open = useOpen();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [confirming, setConfirming] = useState(false);
  const reset = () => {
    setConfirming(false);
    setOutcome(null);
    void ipc.invoke('org.provisioningSecret.reset', { confirmed: true }).then((result) => {
      if (!open.current) return;
      if (!result.ok) failed(result.error);
      else if (!result.value.ok) setOutcome({ text: [ORG.notSaved, ORG.destinationWrite[result.value.reason], result.value.detail].join(' · '), refused: true });
      reload();
    });
  };
  const saved = (value: ProvisioningSecret | null) => {
    setOutcome({ text: value === null ? ORG.cleared : ORG.saved, refused: false });
    reload();
  };
  const refused = (next: Outcome, damaged: boolean) => {
    setOutcome(next);
    if (damaged) reload(); // the file turned out damaged: show it so
  };
  return (
    <Setting label={ORG.destination} note={ORG.destinationNote}>
      {reading === undefined ? (
        <span className="text-fg-muted">{ORG.destinationReading}</span>
      ) : reading !== null && 'damaged' in reading ? (
        <>
          <span className="text-warning">{ORG.destinationDamaged(reading.damaged)}</span>
          <button type="button" className={TEXT_ACTION} onClick={() => setConfirming(true)}>
            {ORG.reset}
          </button>
        </>
      ) : (
        // A new reading starts the form again from what main holds.
        <DestinationForm key={JSON.stringify(reading)} saved={reading} onStart={() => setOutcome(null)} onSaved={saved} onRefused={refused} />
      )}
      <OutcomeLine outcome={outcome} />
      {confirming && (
        <GatewaySheet title={ORG.resetDestinationTitle} onClose={() => setConfirming(false)} canSubmit onSubmit={reset} submitLabel={ORG.resetConfirm} cancelLabel={ORG.cancel}>
          <p className="m-0 text-ui-sm leading-normal text-fg-muted">{ORG.resetDestinationBody}</p>
        </GatewaySheet>
      )}
    </Setting>
  );
}

type FormProps = { saved: ProvisioningSecret | null; onStart(): void; onSaved(value: ProvisioningSecret | null): void; onRefused(outcome: Outcome, damaged: boolean): void };

// All three values, each held to its grammar here as main holds it (every one reaches gcloud's argv), or all three
// cleared to unset it. Save waits for a change that main would take.
function DestinationForm({ saved, onStart, onSaved, onRefused }: FormProps) {
  const open = useOpen();
  const [draft, setDraft] = useState<Record<Field, string>>({ project: saved?.project ?? '', secret: saved?.secret ?? '', account: saved?.account ?? '' });
  const [saving, setSaving] = useState(false);
  const typed = { project: draft.project.trim(), secret: draft.secret.trim(), account: draft.account.trim() };
  const empty = FIELDS.every((f) => typed[f] === '');
  const filled = FIELDS.every((f) => typed[f] !== '');
  const invalid = FIELDS.find((f) => typed[f] !== '' && !ProvisioningSecretSchema.shape[f].safeParse(typed[f]).success);
  const value: ProvisioningSecret | null | undefined = empty ? null : filled && invalid === undefined ? typed : undefined;
  const changed = value !== undefined && JSON.stringify(value) !== JSON.stringify(saved);
  const hint = invalid !== undefined ? ORG.destinationInvalid[invalid] : !empty && !filled ? ORG.destinationPartial : null;
  const save = () => {
    if (value === undefined || !changed || saving) return;
    setSaving(true);
    onStart();
    void ipc.invoke('org.provisioningSecret.set', { value }).then((result) => {
      if (!open.current) return;
      setSaving(false);
      if (!result.ok) failed(result.error);
      else if (result.value.ok) onSaved(value);
      else onRefused({ text: [ORG.notSaved, ORG.destinationWrite[result.value.reason], result.value.detail].join(' · '), refused: true }, result.value.reason === 'damaged');
    });
  };
  return (
    <>
      {FIELDS.map((field) => (
        <label key={field} className="flex min-w-0 basis-full items-center gap-2">
          <span className="w-16 shrink-0 text-fg-muted">{ORG.destinationFields[field]}</span>
          <input
            aria-label={ORG.destinationFields[field]}
            value={draft[field]}
            onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            spellCheck={false}
            autoComplete="off"
            className={`${INPUT} max-w-[420px] font-mono`}
          />
        </label>
      ))}
      <button type="button" className={TEXT_ACTION} disabled={!changed || saving} onClick={save}>
        {saving ? ORG.saving : ORG.save}
      </button>
      {hint !== null && <span className="text-warning">{hint}</span>}
    </>
  );
}
