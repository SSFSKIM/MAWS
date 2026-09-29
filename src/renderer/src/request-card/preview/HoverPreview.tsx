// What the hover placement shows of a request (§5.1): a read-only preview, never a form. Permission input bounded as
// the full card bounds it, the questions and their options, the plan's first lines, a dialog's payload, an
// elicitation's message.
import type { SessionEvent } from '@shared/graph/events';
import { pretty } from '../controls';
import { ToolPreview } from './ToolPreview';

const PLAN_LINES = 6;
const BOX = 'm-0 max-h-[8lh] overflow-auto rounded-sm border border-border bg-bg px-2.5 py-2 font-mono text-ui-sm break-words whitespace-pre-wrap';

export function HoverPreview({ request }: { request: SessionEvent }) {
  switch (request.kind) {
    case 'permission.requested':
      return <ToolPreview request={request} compact />;
    case 'question.requested':
      return (
        <ul data-testid="request-input" className="m-0 flex max-h-48 list-none flex-col gap-2 overflow-auto p-0">
          {request.questions.map((q) => (
            <li key={q.question} className="flex flex-col gap-1">
              <span className="text-fg-muted">{q.header}</span>
              <span>{q.question}</span>
              <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                {q.options.map((o) => (
                  <li key={o.label} className="rounded-sm border border-border px-1.5 py-0.5">
                    {o.label}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      );
    case 'plan.requested':
      return (
        <pre data-testid="request-input" className={BOX}>
          {request.plan.split('\n').slice(0, PLAN_LINES).join('\n')}
        </pre>
      );
    case 'dialog.requested':
      return (
        <pre data-testid="request-input" className={BOX}>
          {pretty(request.payload)}
        </pre>
      );
    case 'elicitation.requested': {
      const message = (request.payload as { message?: unknown } | null)?.message;
      return (
        <p data-testid="request-input" className="m-0">
          {typeof message === 'string' ? message : request.mcpServerName}
        </p>
      );
    }
    default:
      return null;
  }
}
