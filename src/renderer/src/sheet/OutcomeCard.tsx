// An outcome a session accepted and has not delivered yet (the composite's §4.3, "Accepted"; frame 2): read-only, on the
// column's ground, in the receipt's shape, `q4 Clash rule → Keep the earlier sailing`. It leaves when delivered.
import type { SheetOutcome } from '@shared/sheet/model';
import { receiptOf } from '@shared/sheet/words';
import { SHEET_WORDS } from './copy';

export interface OutcomeCardProps {
  outcome: SheetOutcome;
}

export function OutcomeCard({ outcome }: OutcomeCardProps) {
  const receipt = outcome.kind === 'answer' ? receiptOf(outcome.picks, outcome.text) : SHEET_WORDS.dismissed;
  return (
    <div data-sheet-outcome={outcome.id} className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border px-3 py-2 text-fg">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-ui-sm text-fg-faint tabular-nums">{outcome.id}</span>
        {outcome.question.header && <span className="transcript-question-label shrink-0">{outcome.question.header}</span>}
        <span aria-hidden="true" className="transcript-question-arrow shrink-0">
          →
        </span>
        <span className="transcript-question-answer min-w-0 flex-1">{receipt}</span>
      </div>
      <p className="m-0 text-fg-muted">{SHEET_WORDS.accepted}</p>
    </div>
  );
}
