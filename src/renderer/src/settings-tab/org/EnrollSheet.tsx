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
//   and closing it on one that ended clears it from the page. Reopened on a running enrollment (`follow`), the sheet
//   takes it up without the code, and still says when it ends. Once this Mac can't sign (`may`), Make a code, Approve
//   and Start over are withdrawn and the sheet says why; an approval in flight still answers.
// - The sheet owns one run under one sign-in (`EnrollRun`, judged against each status by `observed`): a start owns
//   exactly the generation its answer names (main's run for that start), a run taken up the generation it was shown at;
//   no other generation is ever the sheet's, whatever its name. Once that run leaves the status, another takes its place
//   (already so when the answer comes), or the sign-in changes, the sheet's run has ended for good: no code, no Approve,
//   nothing of another's to cancel, and only an explicit Start over begins again. While a start's answer is out the
//   sheet owns no generation, and its only cancel is the sender's own null.
// - The sheet's own sign-in (`useOwnSignIn`) is latched apart from its run: once it ends, even after the run ended, the
//   sheet offers no start again under any later sign-in, the same member's included.
//   Every answer is fenced to the run that asked: a start's to its token, an approval's to its generation.
import { useRef, useState } from 'react';
import { formatClock } from '@shared/app/date-format';
import type { EnrollStartResult, OrgEnrollingStatus, SignResult } from '@shared/ipc/schema/org';
import { ipc } from '../../ipc/client';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { PRIMARY } from '../../sessions/ui';
import { ORG } from '../copy';
import { INPUT, TEXT_ACTION } from '../parts';
import { failed, OutcomeLine, useOpen, useOwnSignIn, type Outcome, type ViewMachine } from './parts';

type Refused = Extract<EnrollStartResult, { ok: false }>;
type Code = { value: string; expires: string };
// A start refusal whose detail main words as the line already does (U11a board 540, §B); any other's detail follows the line.
const SAID = new Set<Refused['reason']>(['not-root', 'not-admin', 'shape', 'machine-name-taken', 'certified-machine', 'no-machine', 'cancelled']);

/**
 * The sheet's own enrollment. `choosing`: none yet, a refused start's answer with it. `starting`: a start this sheet sent
 * (`token`), under `owner`, its answer still out: no generation is its own yet. `running`: its run, latched at the
 * `generation` the start's answer named (`token` null for a run taken up), and the code while it may show. `ended`: its
 * run left the status, or the sign-in ended; final.
 */
export type EnrollRun =
  | { at: 'choosing'; refused: Refused | null }
  | { at: 'starting'; owner: string; token: number }
  | { at: 'running'; owner: string; generation: number; token: number | null; code: Code | null }
  | { at: 'ended'; why: 'gone' | 'signed-out'; generation: number | null };

/**
 * The run as the status `enrolling` and the sign-in `signIn` leave it; the same object when nothing changed. A start
 * waits on its answer whatever the status shows. The code goes once the machine posts its key or the run ends with a
 * problem.
 */
export function observed(run: EnrollRun, enrolling: OrgEnrollingStatus, signIn: string | null): EnrollRun {
  if (run.at === 'choosing' || run.at === 'ended') return run;
  if (signIn !== run.owner) return { at: 'ended', why: 'signed-out', generation: run.at === 'running' ? run.generation : null };
  if (run.at === 'starting') return run;
  if (enrolling === null || enrolling.generation !== run.generation) return { at: 'ended', why: 'gone', generation: run.generation };
  if (run.code !== null && (enrolling.candidate !== null || enrolling.problem !== null)) return { ...run, code: null };
  return run;
}

/**
 * A start's answer (null: the command failed), taken only by the start that sent it, still waiting on it: a refusal
 * returns to choosing, and an ok latches the run the answer names, with its code (`observed` then ends it if that run is
 * no longer the status's).
 */
export function started(run: EnrollRun, token: number, answer: EnrollStartResult | null): EnrollRun {
  if (run.at !== 'starting' || run.token !== token) return run;
  if (answer === null || !answer.ok) return { at: 'choosing', refused: answer };
  return { at: 'running', owner: run.owner, generation: answer.generation, token, code: { value: answer.code, expires: answer.expires } };
}

const generationOf = (run: EnrollRun): number | null => (run.at === 'running' || run.at === 'ended' ? run.generation : null);

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
  /** The sign-in standing now (`signInOf`); null while none does. */
  signIn: string | null;
  onClose(): void;
};

export function EnrollSheet({ replace, follow, enrolling, may, signIn, onClose }: Props) {
  const open = useOpen();
  const own = useOwnSignIn(signIn);
  const tokens = useRef(0);
  const [name, setName] = useState('');
  const [run, setRun] = useState<EnrollRun>(() => (follow !== null && signIn !== null ? { at: 'running', owner: signIn, generation: follow, token: null, code: null } : { at: 'choosing', refused: null }));
  const [copied, setCopied] = useState(false);
  // An approval in flight, and its answer, each by the generation it was for: shown only beside that run.
  const [approving, setApproving] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ generation: number; outcome: Outcome } | null>(null);
  const [approved, setApproved] = useState<{ generation: number; name: string; version: number } | null>(null);

  const seen = observed(run, enrolling, signIn);
  if (seen !== run) setRun(seen);
  const generation = generationOf(seen);
  const ours = seen.at === 'running' ? enrolling : null; // the status names this run (observed checked its generation)
  const done = approved !== null && approved.generation === generation ? approved : null;
  const said = outcome !== null && outcome.generation === generation ? outcome.outcome : null;

  const machineName = replace?.name ?? name.trim();
  const start = () => {
    if (machineName === '' || own.ended || signIn === null) return;
    const token = ++tokens.current;
    setCopied(false);
    setOutcome(null);
    setApproved(null);
    setRun({ at: 'starting', owner: signIn, token });
    void ipc.invoke('org.enroll.start', replace === null ? { name: machineName } : { name: machineName, replace: replace.ref }).then((result) => {
      if (!open.current) return;
      if (!result.ok) failed(result.error);
      setRun((current) => started(current, token, result.ok ? result.value : null));
    });
  };
  const startOver = () => {
    setRun({ at: 'choosing', refused: null });
    setOutcome(null);
    setApproved(null);
  };
  const approve = () => {
    const candidate = ours?.candidate;
    if (seen.at !== 'running' || candidate == null) return;
    const asked = seen.generation;
    setApproving(asked);
    setOutcome(null);
    void ipc.invoke('org.enroll.approve', { generation: asked, digest: candidate.digest }).then((result) => {
      if (!open.current) return;
      setApproving((current) => (current === asked ? null : current));
      if (!result.ok) failed(result.error);
      else if (result.value.ok) setApproved({ generation: asked, name: candidate.name, version: result.value.version });
      else setOutcome({ generation: asked, outcome: approveOutcome(result.value) });
    });
  };
  const close = () => {
    // Its own run alone is cancelled (a running one, since its code can't be shown again; one ended with a problem, to
    // clear it from the page), by its generation, or a start whose run isn't shown yet as null: main cancels nothing
    // else (`not-current`, which needs no word once the sheet has closed). `observed` has already ended the run that left
    // the status or outlived its sign-in.
    if ((seen.at === 'starting' || seen.at === 'running') && done === null) {
      void ipc.invoke('org.enroll.cancel', { generation: seen.at === 'running' ? seen.generation : null }).then((result) => {
        if (!result.ok) failed(result.error);
      });
    }
    onClose();
  };
  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => open.current && setCopied(true),
      (error: unknown) => console.error('[org] the enrollment code was not copied', (error as Error).message),
    );
  };

  const refused = seen.at === 'choosing' ? seen.refused : null;
  const problem = ours?.problem ?? null;
  const candidate = ours?.candidate ?? null;
  const code = seen.at === 'running' ? seen.code : null;
  const pending = approving !== null && approving === generation;
  // A start, or a start again, only under the sheet's own sign-in, and never over another enrollment under way.
  const mayStart = may && !own.ended;
  const form =
    seen.at === 'choosing'
      ? { submit: mayStart ? ORG.makeCode : undefined, can: machineName !== '', act: start, cancel: ORG.cancel }
      : done !== null
        ? { submit: ORG.done, can: true, act: onClose, cancel: ORG.close }
        : seen.at === 'ended' || problem !== null
          ? { submit: mayStart ? ORG.startOver : undefined, can: !pending, act: startOver, cancel: ORG.close }
          : { submit: may ? ORG.approve : undefined, can: candidate !== null && !pending, act: approve, cancel: ORG.cancelEnrollment };
  const expires = ours?.expires ?? code?.expires ?? null;

  return (
    <Sheet title={replace === null ? ORG.enrollTitle : ORG.reenrollTitle(replace.name)} width="w-[min(520px,90vw)]" onClose={close}>
      <SheetForm submitLabel={form.submit} submitClass={PRIMARY} canSubmit={form.can} onSubmit={form.act} cancelLabel={form.cancel}>
        <div className="flex flex-col gap-2 text-ui-sm leading-normal">
          {seen.at === 'choosing' ? (
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
          ) : done !== null ? (
            <p role="status" className="m-0 text-fg">
              {ORG.enrollApproved(done.name, done.version)}
            </p>
          ) : seen.at === 'ended' ? (
            <p className="m-0 text-fg-muted">{seen.why === 'signed-out' ? ORG.enrollSignedOut : ORG.enrollGone}</p>
          ) : problem !== null ? (
            <p role="alert" className="m-0 text-warning">
              {ORG.enrollProblems[problem]}
            </p>
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
                  <p className="m-0 text-fg-muted">{ORG.enrollCodeNote}</p>
                  <p className="m-0 text-fg-muted">
                    {ORG.enrollRun} <span className="font-mono text-fg">{ORG.enrollCommand}</span> {ORG.enrollPaste}
                  </p>
                </>
              ) : (
                seen.at === 'running' && seen.token === null && <p className="m-0 text-fg-muted">{ORG.enrollCodeGone}</p>
              )}
              {expires !== null && <p className="m-0 text-fg-muted">{ORG.enrollExpires(formatClock(Date.parse(expires)))}</p>}
              <p className="m-0 text-fg-muted">{ORG.enrollWaiting(ours?.name ?? machineName)}</p>
            </>
          )}
          {/* What a cancel can't withdraw once signed: beside Approve, and while an approval is pending however the enrollment stands */}
          {done === null && (pending || (candidate !== null && problem === null && seen.at === 'running')) && <p className="m-0 text-fg-muted">{ORG.pairDurable}</p>}
          <OutcomeLine outcome={said} />
          {own.ended && done === null && !(seen.at === 'ended' && seen.why === 'signed-out') && <p className="m-0 text-fg-muted">{ORG.enrollSignInEnded}</p>}
          {!may && done === null && <p className="m-0 text-warning">{ORG.enrollCantSign}</p>}
        </div>
      </SheetForm>
    </Sheet>
  );
}
