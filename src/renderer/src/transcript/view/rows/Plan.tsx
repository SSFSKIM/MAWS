// A plan in history (Derivation, *Requests*): the plan the model proposed through ExitPlanMode, rendered through the
// shared markdown pipeline and bounded (144 px) with Show more, and its outcome badge. No controls: a pending plan is
// C7's request card in the slot, never this row.
import { PLAN, planBadge } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useDisclosure } from '../context';
import { Markdown } from '../markdown/Markdown';

// A plan short enough to fit the collapsed height has nothing to show more of.
const LONG_LINES = 6;
const LONG_CHARS = 480;
const isLong = (plan: string) => plan.length > LONG_CHARS || plan.split('\n').filter((line) => line.trim().length > 0).length > LONG_LINES;

export function PlanRow({ row }: { row: Extract<Row, { kind: 'plan' }> }) {
  const [open, toggle] = useDisclosure(`plan:${row.id}`);
  const long = isLong(row.plan);
  return (
    <section className="transcript-plan" aria-label={PLAN.heading}>
      <div className="transcript-plan-header">
        <span>{PLAN.heading}</span>
        <span className="transcript-badge" data-outcome={row.outcome ?? 'pending'}>
          {planBadge(row.outcome, row.feedback)}
        </span>
      </div>
      <div className="transcript-plan-body" data-plan-body="" data-long={long ? '' : undefined} data-open={open ? '' : undefined}>
        <Markdown markdown={row.plan} live={false} />
      </div>
      {long && (
        <button type="button" className="transcript-quiet-button transcript-plan-more" aria-expanded={open} onClick={toggle}>
          {open ? PLAN.showLess : PLAN.showMore}
        </button>
      )}
    </section>
  );
}
