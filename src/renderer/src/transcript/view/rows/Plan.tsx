// A plan in history (Derivation, *Requests*): the plan the model proposed through ExitPlanMode, rendered through the
// shared markdown pipeline, its collapsed body bounded at 144 px (transcript.css), and its outcome badge. Show more
// appears when the rendered content overflows that box, measured after layout and again whenever the content's size
// changes (highlighting, diagrams and math render asynchronously), and Show less whenever the plan is open. No
// controls: a waiting plan is C7's request card in this row's place (UX wave U1b), never this body. W8: opening and
// closing run the shared disclosure motion between the 144 px preview and the whole plan. UX wave U1b (decision 8b):
// while the transcript has no outcome for it, the badge reads the call's lasting receipt (a settlement's words, or
// "Answered elsewhere") in the place of Pending; the transcript's own outcome wins once it has one.
import { useLayoutEffect, useState } from 'react';
import { useDisclosureMotion } from '../../../ui/disclosure';
import type { Row } from '../../model/rows';
import { useAttention, type Receipt } from '../../../stores/attention';
import { PLAN, planBadge, QUESTION } from '../../model/copy';
import { useDisclosure, useRowSession } from '../context';
import { Markdown } from '../markdown/Markdown';

// A receipt's words for a plan: a settlement's own, or "Dismissed" for one its terminal dismissed (decision 10's word);
// a question's answers are never a plan's.
const receiptWords = (receipt: Receipt): string => ('settled' in receipt ? receipt.settled : QUESTION.dismissed);

const PREVIEW_PX = 144; // the closed body's bound (transcript.css, `.transcript-plan-body`)

export function PlanRow({ row }: { row: Extract<Row, { kind: 'plan' }> }) {
  const [open, toggle] = useDisclosure(`plan:${row.id}`);
  const { ref: body } = useDisclosureMotion<HTMLDivElement>(open, { closedHeight: PREVIEW_PX });
  const [overflows, setOverflows] = useState(false);
  const session = useRowSession();
  const receipt = useAttention((s) => (session === null || row.outcome !== null ? undefined : s.receipts.get(session)?.get(row.toolUseId)));

  // Measured while collapsed only: an open body has no bound. Open stays in the transcript-wide disclosures while the
  // measurement is this mount's, so an open plan always offers Show less (a virtualiser remount resets the
  // measurement), and closing measures again (the user bubble's rule, rows/User.tsx).
  useLayoutEffect(() => {
    const element = body.current;
    if (!element || open) return;
    const measure = () => setOverflows(element.scrollHeight > PREVIEW_PX + 1); // the bound, not the box: a closing body is still taller
    measure();
    if (typeof ResizeObserver === 'undefined' || !element.firstElementChild) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [open, row.plan, body]);

  return (
    <section className="transcript-plan" aria-label={PLAN.heading}>
      <div className="transcript-plan-header">
        <span>{PLAN.heading}</span>
        <span className="transcript-badge" data-outcome={row.outcome ?? 'pending'}>
          {row.outcome === null && receipt !== undefined ? receiptWords(receipt) : planBadge(row.outcome, row.feedback)}
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
