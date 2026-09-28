// The request preview: C5's fallback for the `requestCard` slot (X4; C5 execution document, Slots) in all three
// placements until C7's card lands, and the body of the sidebar's hover card. It shows what is being asked (kind, wait,
// requesting agent, tool, a bounded preview of the input, the questions or the plan, the cwd) and offers "Open
// session". Only in the hover placement, and only for a permission request whose tool is read-only (§5.1, shared
// `READ_ONLY_TOOLS`), it also offers Approve and Deny by explicit click; they answer allow-once or a plain deny through
// C3's `session.answer` and never offer another scope (scopes are the docked card's, X4). "Explicit click" is literal:
// the buttons stay focusable and labelled, but a click a key synthesised (Enter or Space on a focused button) answers
// nothing, because keyboard approval belongs to the focused session pane or Overview card alone (§5.1, binding).
import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import { isReadOnlyRequest } from '@shared/attention/read-only-tools';
import type { RequestAnswer } from '@shared/engine/answers';
import type { Slots } from '../app/slots';
import { useNow } from '../app/use-now';
import { ipc } from '../ipc/client';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { isOpen } from '../attention/derive';
import { needsYouAge } from './derive';

type Tone = 'warning' | 'info' | 'danger';
const HEADINGS: Record<AttentionItem['kind'], { char: string; tone: Tone; text: string }> = {
  permission: { char: '◐', tone: 'warning', text: 'Approval needed' },
  question: { char: '?', tone: 'warning', text: 'Question' },
  plan: { char: '◇', tone: 'info', text: 'Plan review' },
  dialog: { char: '◐', tone: 'warning', text: 'Dialog' },
  elicitation: { char: '◐', tone: 'warning', text: 'Input requested' },
  auto_mode_unavailable: { char: '!', tone: 'danger', text: 'Auto mode unavailable' },
  error: { char: '!', tone: 'danger', text: 'Error' },
  interrupted: { char: '!', tone: 'danger', text: 'Interrupted' },
  held_peer_message: { char: '✉', tone: 'info', text: 'Held message' },
};
const TONE: Record<Tone, string> = { warning: 'text-warning', info: 'text-info', danger: 'text-danger' };

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'LS']);
const PLAN_LINES = 6;

const field = (input: unknown, key: string): string | null => {
  const value = input !== null && typeof input === 'object' ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : null;
};
const pretty = (value: unknown) => JSON.stringify(value ?? null, null, 2);

// The title line and the bounded text of the preview box, by request kind.
function describe(request: SessionEvent): { title: string; input: string | null } {
  switch (request.kind) {
    case 'permission.requested': {
      const { toolName, input } = request;
      const title = request.displayName ?? toolName;
      if (toolName === 'Bash') return { title, input: field(input, 'command') ?? pretty(input) };
      if (FILE_TOOLS.has(toolName)) return { title, input: field(input, 'file_path') ?? field(input, 'notebook_path') ?? field(input, 'path') ?? pretty(input) };
      return { title, input: pretty(input) };
    }
    case 'plan.requested':
      return { title: 'Plan', input: request.plan.split('\n').slice(0, PLAN_LINES).join('\n') };
    case 'question.requested':
      return { title: request.questions.length === 1 ? 'Question' : `${request.questions.length} questions`, input: null };
    case 'dialog.requested':
      return { title: request.dialogKind, input: pretty(request.payload) };
    case 'elicitation.requested':
      return { title: request.mcpServerName, input: pretty(request.payload) };
    default:
      return { title: request.kind, input: null };
  }
}

type Delivery = 'idle' | 'sending' | 'not_delivered';

export const RequestPreview: Slots['requestCard'] = ({ item, request, placement }) => {
  const record = useSessions((s) => s.records.get(item.appSessionId));
  const projectName = useSessions((s) => (record?.projectId ? (s.projects.get(record.projectId)?.name ?? null) : null));
  const now = useNow();
  const [delivery, setDelivery] = useState<Delivery>('idle');

  const heading = HEADINGS[item.kind];
  const shown = request ? describe(request) : { title: item.summary, input: null };
  const foreign = record?.holder.kind === 'terminal' || record?.holder.kind === 'background_job';
  const canAnswer = placement === 'hover' && item.kind === 'permission' && isOpen(item) && !foreign && isReadOnlyRequest(request);
  const where = [projectName, record?.title.text, `waiting ${needsYouAge(item, now)}`].filter(Boolean).join(' · ');

  // The button a pointer pressed; a click counts only as the release of that press (`detail` > 0: a keyboard- or
  // script-synthesised click reports 0, and has no pointerdown before it).
  const pressed = useRef<EventTarget | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    pressed.current = event.currentTarget;
  };
  const byPointer = (event: MouseEvent<HTMLButtonElement>) => {
    const genuine = event.detail > 0 && pressed.current === event.currentTarget;
    pressed.current = null;
    return genuine;
  };

  const answer = async (value: RequestAnswer) => {
    if (request?.kind !== 'permission.requested') return;
    setDelivery('sending');
    const result = await ipc.invoke('session.answer', { appSessionId: item.appSessionId, requestId: request.requestId, answer: value });
    // A delivered answer retires the item, and with it this card; anything else leaves the request where it was.
    setDelivery(result.ok && result.value.outcome === 'delivered' ? 'idle' : 'not_delivered');
  };

  return (
    <div className="flex flex-col gap-3 text-ui-sm text-fg">
      <div className={`flex items-center gap-1.5 ${TONE[heading.tone]}`}>
        <span aria-hidden>{heading.char}</span>
        <span>{heading.text}</span>
        {request?.agentId && <span className="text-fg-muted">from agent {request.agentId}</span>}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-ui font-semibold">{shown.title}</h3>
        <p className="m-0 text-fg-muted">{where}</p>
      </div>
      {request?.kind === 'question.requested' ? (
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
      ) : (
        shown.input !== null && (
          <pre
            data-testid="request-input"
            className="m-0 max-h-[8lh] overflow-auto rounded-sm border border-border bg-bg px-2.5 py-2 font-mono text-ui-sm break-words whitespace-pre-wrap"
          >
            {shown.input}
          </pre>
        )
      )}
      {request?.kind === 'permission.requested' && request.description && <p className="m-0 text-fg-muted">{request.description}</p>}
      {!request && item.summary !== shown.title && <p className="m-0 text-fg-muted">{item.summary}</p>}
      {record && (
        <p className="m-0 truncate font-mono text-fg-muted" title={record.directory}>
          {record.directory}
        </p>
      )}
      {canAnswer && <p className="m-0 text-fg-muted">Approve applies to this request only.</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => useLayout.getState().openSession(item.appSessionId)}
          className="rounded-sm border border-border-strong px-2.5 py-1 whitespace-nowrap text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2"
        >
          Open session
        </button>
        {delivery === 'not_delivered' && <span className="text-danger">Not delivered</span>}
        {canAnswer && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={delivery === 'sending'}
              title="Click to deny"
              onPointerDown={onPointerDown}
              onClick={(event) => byPointer(event) && void answer({ kind: 'permission', decision: 'deny' })}
              className="rounded-sm border border-border-strong px-2.5 py-1 text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint"
            >
              Deny
            </button>
            <button
              type="button"
              disabled={delivery === 'sending'}
              title="Click to approve"
              onPointerDown={onPointerDown}
              onClick={(event) => byPointer(event) && void answer({ kind: 'permission', decision: 'allow', scope: 'once' })}
              className="rounded-sm border border-fg bg-fg px-2.5 py-1 text-bg outline-accent hover:bg-fg-muted focus-visible:outline-2 disabled:bg-fg-faint"
            >
              Approve
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
