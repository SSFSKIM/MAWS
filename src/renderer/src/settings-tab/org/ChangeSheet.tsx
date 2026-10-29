// The change sheet (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "At its end" and
// *Changes*): one change, shown before it is signed. Add person and Change email take their fields first; every change
// then reads `org.preview`, which composes it on the held head and runs the checks, and shows its lines one by one with
// the checks' warnings. Sign sends `org.change` with the change as previewed (normalized: `member.add`'s new id) and the
// digest naming what was shown, so main signs nothing else (`stale`); Touch ID follows in main. A change the checks
// refuse is named here, with no Sign, and never reaches Touch ID. Once this Mac can't sign (`may`: signed out, or no
// longer a root), Review and Sign are withdrawn and the sheet says why; a sign already in flight still shows its answer.
import { useEffect, useState } from 'react';
import type { OrgChange, PreviewResult, SignResult } from '@shared/ipc/schema/org';
import { ipc } from '../../ipc/client';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { PRIMARY, QUIET } from '../../sessions/ui';
import { ORG } from '../copy';
import { INPUT, Segment } from '../parts';
import { failed, OutcomeLine, signOutcome, type Outcome } from './parts';

type Role = 'admin' | 'member';
type Stage =
  | { at: 'fields' }
  | { at: 'composing' }
  | { at: 'shown'; preview: PreviewResult }
  | { at: 'signing'; preview: Extract<PreviewResult, { ok: true }> }
  | { at: 'ended'; preview: Extract<PreviewResult, { ok: true }>; outcome: Outcome };

// The fields a change takes before it is composed: Add person's email and role, Change email's new email.
const takesFields = (change: OrgChange): boolean => change.kind === 'member.add' || change.kind === 'member.email';

export function ChangeSheet({ title, change: asked, may, onClose, onSigned }: { title: string; change: OrgChange; may: boolean; onClose(): void; onSigned(version: number): void }) {
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
      if (!result.ok) {
        failed(result.error);
        setStage({ at: 'shown', preview });
        return;
      }
      const signed: SignResult = result.value;
      if (signed.ok) {
        onSigned(signed.version);
        onClose();
      } else if (signed.reason === 'cancelled') setStage({ at: 'shown', preview }); // the person's own cancel: Sign again
      else setStage({ at: 'ended', preview, outcome: signOutcome(signed) });
    });
  };

  const fields = stage.at === 'fields';
  const preview = stage.at === 'composing' || stage.at === 'fields' ? null : stage.preview;
  const shown = preview !== null && preview.ok ? preview : null;
  // Sign while what was shown can still be signed: never on a refused preview, nor once a sign has ended.
  const signable = shown !== null && stage.at !== 'ended';
  const submit = () => {
    if (fields) {
      setChange(trimmed(change) ?? change);
      setStage({ at: 'composing' });
    } else if (shown !== null) sign(shown);
  };
  return (
    <Sheet title={title} width="w-[min(560px,90vw)]" onClose={onClose}>
      <SheetForm
        submitLabel={!may ? undefined : fields ? ORG.review : signable ? ORG.changeConfirm : undefined}
        submitClass={PRIMARY}
        canSubmit={fields ? trimmed(change) !== null : stage.at === 'shown'}
        onSubmit={submit}
        cancelLabel={ORG.cancel}
        extra={
          may && takesFields(asked) && !fields && stage.at !== 'signing' ? (
            <button type="button" onClick={() => setStage({ at: 'fields' })} className={`mr-auto ${QUIET}`}>
              {ORG.edit}
            </button>
          ) : undefined
        }
      >
        {fields ? (
          <Fields change={change} onChange={setChange} />
        ) : preview === null ? (
          <p className="m-0 text-ui-sm text-fg-muted">{ORG.composing}</p>
        ) : preview.ok ? (
          <Lines lines={preview.lines} warnings={preview.warnings} />
        ) : (
          <Refused preview={preview} />
        )}
        {stage.at === 'ended' && <OutcomeLine outcome={stage.outcome} />}
        {!may && <p className="m-0 text-ui-sm text-warning">{ORG.readOnly}</p>}
      </SheetForm>
    </Sheet>
  );
}

// The change with its typed email trimmed, as sent; null while that email is empty.
function trimmed(change: OrgChange): OrgChange | null {
  if (change.kind !== 'member.add' && change.kind !== 'member.email') return change;
  const email = change.email.trim();
  return email === '' ? null : { ...change, email };
}

// Add person's email and role (a member unless chosen), or Change email's new email. Sent trimmed; main lower-cases.
function Fields({ change, onChange }: { change: OrgChange; onChange(next: OrgChange): void }) {
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

// A preview main refused: why, and each finding the checks named (a warning as a warning).
function Refused({ preview }: { preview: Extract<PreviewResult, { ok: false }> }) {
  const refusals = preview.findings.filter((f) => f.level === 'refuse').map((f) => f.detail);
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
    </div>
  );
}
