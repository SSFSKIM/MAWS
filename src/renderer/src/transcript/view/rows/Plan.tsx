// A plan in history (Derivation, *Requests*): the plan the model proposed through ExitPlanMode, rendered through the
// shared markdown pipeline, its collapsed body bounded at 144 px (transcript.css), and its outcome badge. Show more
// appears when the rendered content overflows that box, measured after layout and again whenever the content's size
// changes (highlighting, diagrams and math render asynchronously), and Show less whenever the plan is open. No
// controls: a pending plan is C7's request card in the slot, never this row.
import { useLayoutEffect, useRef, useState } from 'react';
import { PLAN, planBadge } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useDisclosure } from '../context';
import { Markdown } from '../markdown/Markdown';

export function PlanRow({ row }: { row: Extract<Row, { kind: 'plan' }> }) {
  const [open, toggle] = useDisclosure(`plan:${row.id}`);
  const body = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  // Measured while collapsed only: an open body has no bound. Open stays in the transcript-wide disclosures while the
  // measurement is this mount's, so an open plan always offers Show less (a virtualiser remount resets the
  // measurement), and closing measures again (the user bubble's rule, rows/User.tsx).
  useLayoutEffect(() => {
    const element = body.current;
    if (!element || open) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined' || !element.firstElementChild) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [open, row.plan]);

  return (
    <section className="transcript-plan" aria-label={PLAN.heading}>
      <div className="transcript-plan-header">
        <span>{PLAN.heading}</span>
        <span className="transcript-badge" data-outcome={row.outcome ?? 'pending'}>
          {planBadge(row.outcome, row.feedback)}
        </span>
      </div>
      <div ref={body} className="transcript-plan-body" data-plan-body="" data-overflows={overflows ? '' : undefined} data-open={open ? '' : undefined}>
        <div>
          <Markdown markdown={row.plan} live={false} />
        </div>
      </div>
      {(open || overflows) && (
        <button type="button" className="transcript-quiet-button transcript-plan-more" aria-expanded={open} onClick={toggle}>
          {open ? PLAN.showLess : PLAN.showMore}
        </button>
      )}
    </section>
  );
}
