// The pairing sheet (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "Pairing from the app"
// and *Pairing*): this Mac as the approving device, for a device of yours or another member's first. The class is
// chosen here (a Mac running MAWS by default, or a browser with a passkey); Make a code starts the pairing, and the code
// it answers is shown once, here only, with Copy: no status carries it, nothing logs it, and the sheet drops it once the
// device answers, the pairing ends or the sheet closes. Then the frozen candidate's fingerprint to compare with the new
// device's screen, and Approve naming that candidate (`{generation, digest}`); Touch ID follows in main.
//
// An approval's end keeps apart a pairing that ended while Touch ID was open (main's `cancelled` with why) from one that
// ended, or whose device changed, before it (`stale`); the person's own cancel at Touch ID says nothing and leaves
// Approve. Closing the sheet while the pairing runs cancels it, since its code can't be shown again. Reopened on a
// running pairing (`follow`), the sheet takes it up without the code.
//
// An approval's answer shows below whatever the pairing's status says, since main publishes the pairing's end (an expiry,
// a cancel) before it answers. Beside Approve, and while an approval is pending, the sheet says what a cancel no longer
// withdraws once the signed state is kept, and that Discard is the way back. Once this Mac can't sign (`may`), Make a
// code, Approve and Start over are withdrawn and the sheet says why; an approval already in flight still shows its answer.
import { useState } from 'react';
import { formatClock } from '@shared/app/date-format';
import type { OrgPairingStatus, PairStartResult, SignResult } from '@shared/ipc/schema/org';
import { ipc } from '../../ipc/client';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { PRIMARY } from '../../sessions/ui';
import { ORG } from '../copy';
import { Segment, TEXT_ACTION } from '../parts';
import { failed, OutcomeLine, type Member, type Outcome } from './parts';

type DeviceClass = 'native-mac' | 'web-cards';
type Refused = Extract<PairStartResult, { ok: false }>;

function approveOutcome(result: SignResult): Outcome {
  if (result.ok) return null;
  if (result.reason === 'cancelled') return result.detail === undefined ? null : { text: ORG.pairEndedDuring, refused: true };
  if (result.reason === 'stale') return { text: [ORG.pairEndedBefore, result.detail].filter((part) => part !== undefined && part !== '').join(' · '), refused: true };
  return { text: [ORG.notApproved, ORG.signReasons[result.reason], result.detail].filter((part) => part !== undefined && part !== '').join(' · '), refused: true };
}

export function PairSheet({ member, pairing, follow, may, onClose }: { member: Member; pairing: OrgPairingStatus; follow: number | null; may: boolean; onClose(): void }) {
  const [kind, setKind] = useState<DeviceClass>('native-mac');
  // The pairing this sheet follows is the first of this member's with a generation above `since`; null before a start.
  const [since, setSince] = useState<number | null>(follow === null ? null : follow - 1);
  const [taken, setTaken] = useState(false); // the followed pairing has shown in the status
  const [code, setCode] = useState<{ value: string; expires: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [refused, setRefused] = useState<Refused | null>(null);
  const [approving, setApproving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [approved, setApproved] = useState<number | null>(null);

  const ours = since !== null && pairing !== null && pairing.member === member.id && pairing.generation > since ? pairing : null;
  if (ours !== null && !taken) setTaken(true);
  const gone = taken && ours === null;
  // A pairing this sheet started or took up that isn't known to have ended (its status may not have arrived yet).
  const live = since !== null && approved === null && !gone && (ours === null || ours.problem === null);
  // The code is shown until the device answers or the pairing ends, and never again.
  if (code !== null && (gone || (ours !== null && (ours.entry !== null || ours.problem !== null)))) setCode(null);

  const start = () => {
    setStarting(true);
    setRefused(null);
    setCopied(false);
    setSince(pairing?.generation ?? 0);
    void ipc.invoke('org.pair.start', { member: member.id, class: kind }).then((result) => {
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
    if (ours?.entry == null) return;
    setApproving(true);
    setOutcome(null);
    void ipc.invoke('org.pair.approve', { generation: ours.generation, digest: ours.entry.digest }).then((result) => {
      setApproving(false);
      if (!result.ok) failed(result.error);
      else if (result.value.ok) setApproved(result.value.version);
      else setOutcome(approveOutcome(result.value));
    });
  };
  const close = () => {
    setCode(null);
    if (live) {
      void ipc.invoke('org.pair.cancel', undefined).then((result) => {
        if (!result.ok) failed(result.error);
      });
    }
    onClose();
  };
  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => setCopied(true),
      (error: unknown) => console.error('[org] the pairing code was not copied', (error as Error).message),
    );
  };

  const choosing = since === null && approved === null;
  const problem = ours?.problem ?? null; // why the followed pairing ended
  // Without the right to sign (signed out, or no longer a root), nothing here starts or approves: only Cancel pairing,
  // Close and Done stay, and an approval already in flight still shows its answer.
  const form = choosing
    ? { submit: may ? ORG.makeCode : undefined, can: !starting, act: start, cancel: ORG.cancel }
    : approved !== null
      ? { submit: ORG.done, can: true, act: onClose, cancel: ORG.close }
      : problem !== null || gone
        ? { submit: may ? ORG.startOver : undefined, can: !approving, act: startOver, cancel: ORG.close }
        : { submit: may ? ORG.approve : undefined, can: ours?.entry != null && !approving, act: approve, cancel: ORG.cancelPairing };
  const expires = code?.expires ?? ours?.expires ?? null;

  return (
    <Sheet title={ORG.pairTitle(member.email, member.you)} width="w-[min(520px,90vw)]" onClose={close}>
      <SheetForm submitLabel={form.submit} submitClass={PRIMARY} canSubmit={form.can} onSubmit={form.act} cancelLabel={form.cancel}>
        <div className="flex flex-col gap-2 text-ui-sm leading-normal">
          {choosing ? (
            <>
              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-fg-muted">{ORG.pairKind}</span>
                <Segment<DeviceClass>
                  label={ORG.pairKind}
                  value={kind}
                  options={[
                    { value: 'native-mac', label: ORG.pairKinds['native-mac'] },
                    { value: 'web-cards', label: ORG.pairKinds['web-cards'] },
                  ]}
                  onChange={setKind}
                />
              </div>
              <p className="m-0 text-fg-muted">{member.you ? ORG.pairYoursNote : ORG.pairFirstNote}</p>
              {refused !== null && (
                <p role="alert" className="m-0 text-warning">
                  {[ORG.pairRefusals[refused.reason], refused.reason === 'later-device' ? undefined : refused.detail].filter((part) => part !== undefined && part !== '').join(' · ')}
                </p>
              )}
            </>
          ) : approved !== null ? (
            <p role="status" className="m-0 text-fg">
              {ORG.approved(approved)}
            </p>
          ) : problem !== null ? (
            <p role="alert" className="m-0 text-warning">
              {ORG.pairProblems[problem]}
            </p>
          ) : gone ? (
            <p className="m-0 text-fg-muted">{ORG.pairGone}</p>
          ) : ours?.entry != null ? (
            <>
              <span className="font-mono text-prose font-semibold tracking-wide text-fg select-all">{ours.entry.fingerprint}</span>
              <p className="m-0 text-fg-muted">{ORG.pairEntry(ours.entry.id.slice(0, 8), ORG.classes[ours.entry.class], ours.entry.keyStorage)}</p>
              <p className="m-0 text-fg">{ORG.pairCompare}</p>
            </>
          ) : (
            <>
              {code !== null ? (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 rounded-sm border border-border bg-bg-raised px-2 py-1 font-mono break-all text-fg select-all">
                      {code.value}
                    </span>
                    <button type="button" className={TEXT_ACTION} onClick={() => copy(code.value)}>
                      {copied ? ORG.copied : ORG.copy}
                    </button>
                  </div>
                  {expires !== null && <p className="m-0 text-fg-muted">{ORG.pairCodeNote(formatClock(Date.parse(expires)))}</p>}
                </>
              ) : starting ? null : (
                <p className="m-0 text-fg-muted">{ORG.pairCodeGone}</p>
              )}
              <p className="m-0 text-fg-muted">{ORG.pairWaiting}</p>
            </>
          )}
          {/* What a cancel can't withdraw once signed: beside Approve, and while an approval is pending however the pairing stands */}
          {approved === null && (approving || (ours?.entry != null && problem === null)) && <p className="m-0 text-fg-muted">{ORG.pairDurable}</p>}
          {/* An approval's answer, whatever main has published of the pairing's end meanwhile (an expiry, a cancel) */}
          <OutcomeLine outcome={outcome} />
          {!may && approved === null && <p className="m-0 text-warning">{ORG.readOnly}</p>}
        </div>
      </SheetForm>
    </Sheet>
  );
}
