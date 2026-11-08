// The enrollment sheet (P5 O8 M4b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's "Enroll a machine"
// and *The enrollment*): this Mac as the enrolling admin's device, as `deployment admin enroll [--replace]` is. Built as
// the pairing sheet is (PairSheet.tsx).
//
// - It takes a name, or starts as "Re-enroll <machine>" from that machine's row. Make a code starts the enrollment
//   (`org.enroll.start`), and the code it answers is shown once, here only, with Copy: no status carries it, nothing
//   logs it, and the sheet drops it once the machine posts its key, the enrollment ends or the sheet closes. Beside it,
//   what the machine runs: `mawsd enroll`, the code pasted at its hidden prompt and never passed as an argument, with
//   `--replace` while the machine is still enrolled; and when the code stops working.
// - It waits until the machine posts its key, then shows the name, ref and key id to compare with `mawsd keys --json` on
//   the machine, and Approve names that candidate (`{generation, digest}`); Touch ID follows in main.
// - Every start refusal and every end has its own line: a problem the status names (an expiry, `key-changed`, …), the
//   sign-in ending, an approval answered `stale` (it ended or its key changed before Touch ID) or `cancelled` with why
//   (it ended while Touch ID was open). The person's own cancel at Touch ID says nothing and leaves Approve.
// - Cancel is always there: closing the sheet while the enrollment runs cancels it, since its code can't be shown again,
//   and closing it on one that ended clears it from the page. Reopened on a running enrollment (`follow`), the sheet takes it up without the code. Once this Mac can't sign
//   (`may`), Make a code, Approve and Start over are withdrawn and the sheet says why; an approval in flight still answers.
import { useState } from 'react';
import { formatClock } from '@shared/app/date-format';
import type { EnrollStartResult, OrgEnrollingStatus, SignResult } from '@shared/ipc/schema/org';
import { ipc } from '../../ipc/client';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { PRIMARY } from '../../sessions/ui';
import { ORG } from '../copy';
import { INPUT, TEXT_ACTION } from '../parts';
import { failed, OutcomeLine, type Outcome, type ViewMachine } from './parts';

type Refused = Extract<EnrollStartResult, { ok: false }>;
// A start refusal whose detail main words as the line already does.
const SAID = new Set<Refused['reason']>(['not-root', 'not-admin']);

function approveOutcome(result: SignResult): Outcome {
  if (result.ok) return null;
  if (result.reason === 'cancelled') return result.detail === undefined ? null : { text: ORG.enrollEndedDuring, refused: true };
  if (result.reason === 'stale') return { text: [ORG.enrollEndedBefore, result.detail].filter((part) => part !== undefined && part !== '').join(' · '), refused: true };
  return { text: [ORG.notEnrolled, ORG.signReasons[result.reason], result.detail].filter((part) => part !== undefined && part !== '').join(' · '), refused: true };
}

type Props = {
  /** The machine a re-enrollment replaces; null for a new one. */
  replace: ViewMachine | null;
  /** The running enrollment's generation to take up; null to start one. */
  follow: number | null;
  enrolling: OrgEnrollingStatus;
  may: boolean;
  /** The sign-in stands. */
  signedIn: boolean;
  onClose(): void;
};

export function EnrollSheet({ replace, follow, enrolling, may, signedIn, onClose }: Props) {
  const [name, setName] = useState('');
  // The enrollment this sheet follows is the first one, for its machine, with a generation above `since`; null before a start.
  const [since, setSince] = useState<number | null>(follow === null ? null : follow - 1);
  const [taken, setTaken] = useState(false); // the followed enrollment has shown in the status
  const [code, setCode] = useState<{ value: string; expires: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [refused, setRefused] = useState<Refused | null>(null);
  const [approving, setApproving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [approved, setApproved] = useState<{ name: string; version: number } | null>(null);

  const ours = since !== null && enrolling !== null && enrolling.replace === (replace?.ref ?? null) && enrolling.generation > since ? enrolling : null;
  if (ours !== null && !taken) setTaken(true);
  // It ended without a problem to name: cancelled elsewhere, or the sign-in ended (which also leaves a start unanswered).
  const gone = approved === null && since !== null && ((taken && ours === null) || !signedIn);
  // An enrollment this sheet started or took up that isn't known to have ended (its status may not have arrived yet).
  const live = since !== null && approved === null && !gone && (ours === null || ours.problem === null);
  // The code is shown until the machine posts its key or the enrollment ends, and never again.
  if (code !== null && (gone || (ours !== null && (ours.candidate !== null || ours.problem !== null)))) setCode(null);

  const machineName = replace?.name ?? name.trim();
  const start = () => {
    if (machineName === '') return;
    setStarting(true);
    setRefused(null);
    setCopied(false);
    setSince(enrolling?.generation ?? 0);
    void ipc.invoke('org.enroll.start', replace === null ? { name: machineName } : { name: machineName, replace: replace.ref }).then((result) => {
      setStarting(false);
      if (!result.ok) {
        failed(result.error);
        setSince(null);
      } else if (!result.value.ok) {
        setRefused(result.value);
        setSince(null);
      } else setCode({ value: result.value.code, expires: result.value.expires });
    });
  };
  const startOver = () => {
    setSince(null);
    setTaken(false);
    setCode(null);
    setOutcome(null);
  };
  const approve = () => {
    const candidate = ours?.candidate;
    if (ours === null || candidate == null) return;
    setApproving(true);
    setOutcome(null);
    void ipc.invoke('org.enroll.approve', { generation: ours.generation, digest: candidate.digest }).then((result) => {
      setApproving(false);
      if (!result.ok) failed(result.error);
      else if (result.value.ok) setApproved({ name: candidate.name, version: result.value.version });
      else setOutcome(approveOutcome(result.value));
    });
  };
  const close = () => {
    setCode(null);
    // A running enrollment is cancelled, since its code can't be shown again; an ended one is cleared from the page.
    if (live || ours !== null) {
      void ipc.invoke('org.enroll.cancel', undefined).then((result) => {
        if (!result.ok) failed(result.error);
      });
    }
    onClose();
  };
  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => setCopied(true),
      (error: unknown) => console.error('[org] the enrollment code was not copied', (error as Error).message),
    );
  };

  const choosing = since === null && approved === null;
  const problem = ours?.problem ?? null;
  const candidate = ours?.candidate ?? null;
  const form = choosing
    ? { submit: may ? ORG.makeCode : undefined, can: !starting && machineName !== '', act: start, cancel: ORG.cancel }
    : approved !== null
      ? { submit: ORG.done, can: true, act: onClose, cancel: ORG.close }
      : problem !== null || gone
        ? { submit: may && signedIn ? ORG.startOver : undefined, can: !approving, act: startOver, cancel: ORG.close }
        : { submit: may ? ORG.approve : undefined, can: candidate !== null && !approving, act: approve, cancel: ORG.cancelEnrollment };
  const expires = code?.expires ?? ours?.expires ?? null;

  return (
    <Sheet title={replace === null ? ORG.enrollTitle : ORG.reenrollTitle(replace.name)} width="w-[min(520px,90vw)]" onClose={close}>
      <SheetForm submitLabel={form.submit} submitClass={PRIMARY} canSubmit={form.can} onSubmit={form.act} cancelLabel={form.cancel}>
        <div className="flex flex-col gap-2 text-ui-sm leading-normal">
          {choosing ? (
            <>
              {replace === null ? (
                <>
                  <label className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-fg-muted">{ORG.machineName}</span>
                    <input aria-label={ORG.machineName} value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoComplete="off" autoFocus className={INPUT} />
                  </label>
                  <p className="m-0 text-fg-muted">{ORG.enrollNameNote}</p>
                </>
              ) : (
                <p className="m-0 text-fg-muted">{ORG.reenrollNote(replace.name)}</p>
              )}
              {refused !== null && (
                <p role="alert" className="m-0 text-warning">
                  {[ORG.enrollRefusals[refused.reason], SAID.has(refused.reason) ? undefined : refused.detail].filter((part) => part !== undefined && part !== '').join(' · ')}
                </p>
              )}
            </>
          ) : approved !== null ? (
            <p role="status" className="m-0 text-fg">
              {ORG.enrollApproved(approved.name, approved.version)}
            </p>
          ) : problem !== null ? (
            <p role="alert" className="m-0 text-warning">
              {ORG.enrollProblems[problem]}
            </p>
          ) : gone ? (
            <p className="m-0 text-fg-muted">{signedIn ? ORG.enrollGone : ORG.enrollSignedOut}</p>
          ) : candidate !== null ? (
            <>
              <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
                {(['name', 'ref', 'keyId'] as const).map((field) => (
                  <div key={field} className="contents">
                    <dt className="text-fg-muted">{ORG.enrollFields[field]}</dt>
                    <dd className="m-0 font-mono font-semibold break-all text-fg select-all">{candidate[field]}</dd>
                  </div>
                ))}
              </dl>
              <p className="m-0 text-fg">{ORG.enrollCompare}</p>
            </>
          ) : (
            <>
              {code !== null ? (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 rounded-sm border border-border bg-bg-raised px-2 py-1 font-mono break-all text-fg select-all">{code.value}</span>
                    <button type="button" className={TEXT_ACTION} onClick={() => copy(code.value)}>
                      {copied ? ORG.copied : ORG.copy}
                    </button>
                  </div>
                  <p className="m-0 text-fg-muted">
                    {ORG.enrollRun} <span className="font-mono text-fg">{ORG.enrollCommand}</span> {ORG.enrollPaste}
                  </p>
                  {expires !== null && <p className="m-0 text-fg-muted">{ORG.enrollCodeNote(formatClock(Date.parse(expires)))}</p>}
                </>
              ) : starting ? null : (
                <p className="m-0 text-fg-muted">{ORG.enrollCodeGone}</p>
              )}
              <p className="m-0 text-fg-muted">{ORG.enrollWaiting(ours?.name ?? machineName)}</p>
            </>
          )}
          {/* What a cancel can't withdraw once signed: beside Approve, and while an approval is pending however the enrollment stands */}
          {approved === null && (approving || (candidate !== null && problem === null && !gone)) && <p className="m-0 text-fg-muted">{ORG.pairDurable}</p>}
          <OutcomeLine outcome={outcome} />
          {!may && approved === null && <p className="m-0 text-warning">{ORG.enrollCantSign}</p>}
        </div>
      </SheetForm>
    </Sheet>
  );
}
