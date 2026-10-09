// X4, the request card (charter §13 X4, owned by C7; C7 execution document, Request card): one component for the five
// request kinds and the notices, identical in every placement. It resolves the originating request (the prop, else
// `attention.request` through the attention store's cache), answers through `session.answer` with payloads `toAnswer`
// validated, reports the delivery (`answering`, `delivered` as one collapsed line until the item retires,
// `not_pending` for two seconds, `write_failed` back to pending with Retry), and owns the keyboard: Enter and Esc
// through C5's dispatcher, bound `within` the element that owns focus for the placement. Docked, that is the
// `DockedCardFrame` around the card; in an Overview card, the nearest ancestor with a `tabindex` (C5's article), since
// the article, not the card, holds focus there; hover and inline bind no key. Digits pick a permission's scope from
// the same owner. E1 M4b: a blocking `maws` ask's item (originating in `maws.ask.opened`) renders compact
// (`variants/Ask.tsx`), its one action opening the Question sheet; the card never answers it.
//
// The card imports the docked frame from its own module, never `composer/index.ts`, so no editor code reaches it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent, type PointerEvent } from 'react';
import { ATTENTION_HEADINGS, type AttentionTone } from '@shared/attention/headings';
import type { AttentionItem } from '@shared/graph/attention';
import type { RequestAnswer } from '@shared/engine/answers';
import type { SessionEvent } from '@shared/graph/events';
import { engineQuestionsOf, nativeQuestionsOf } from '@shared/engine/surface-rows';
import { SurfaceRow } from '../engine-surface/SurfaceRow';
import { useNow } from '../app/use-now';
import { DockedCardFrame } from '../composer/docked/DockedCardFrame';
import { ipc } from '../ipc/client';
import { BUTTON_LIKE_INPUTS } from '../keymap/dispatcher';
import { useKeyChord } from '../keymap/useKeyChord';
import { itemAge } from '../sidebar/derive';
import { useAttention } from '../stores/attention';
import { markDocked } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../transcript';
import { toAnswer } from './answers';
import { ASK_CARD } from './copy'; // E1 M4b
import { AskBody } from './variants/Ask'; // E1 M4b
import { CardButton, Controls, Muted } from './controls';
import { HoverPreview } from './preview/HoverPreview';
import { hoverApproval } from './quick-approval';
import { requesterName } from './requester';
import { mcpParts, toolVerb } from './tools';
import { DialogBody } from './variants/Dialog';
import { dialogTitle, declaredDialog } from './variants/dialog-kinds';
import { ElicitationBody } from './variants/Elicitation';
import { NoticeBody } from './variants/Notice';
import { PermissionBody } from './variants/Permission';
import { PlanBody } from './variants/Plan';
import { QuestionBody } from './variants/Question';
import type { CardKeys, Placement } from './variants/types';
import { displayTitle } from '../sessions/title';

export type { Placement } from './variants/types';

export interface RequestCardProps {
  item: AttentionItem; // any kind; the five request kinds render a card, the rest a notice
  request: SessionEvent | null; // the originating *.requested event; fetched through attention.request when null
  placement: Placement;
  paneIndex: 0 | 1 | null; // informational
  onAnswered?: (outcome: 'delivered' | 'not_pending' | 'write_failed') => void;
}

// The kind line (C5's table, so the Needs-you row, the hover and the card read alike); docked, the frame's title.
export const HEADINGS = ATTENTION_HEADINGS;
const TONE: Record<AttentionTone, string> = { warning: 'text-warning', info: 'text-info', danger: 'text-danger' };
const NOT_PENDING_MS = 2_000;

type Phase = 'pending' | 'answering' | 'delivered' | 'not_pending' | 'closed';
type Outcome = 'delivered' | 'not_pending' | 'write_failed';

// The one delivery path: `session.answer`, its outcome, and a Retry that sends the same answer again.
function useDelivery(item: AttentionItem, onAnswered: RequestCardProps['onAnswered']) {
  const [phase, setPhase] = useState<Phase>('pending');
  const [what, setWhat] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ retry: () => void; detail: string | null } | null>(null);
  const inFlight = useRef(false);

  const submit = useCallback(
    (answer: RequestAnswer, text: string, delivered?: () => void) => {
      const { requestId } = item.request;
      if (requestId === null) return;
      const send = async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPhase('answering');
        setFailed(null);
        const result = await ipc.invoke('session.answer', { appSessionId: item.appSessionId, requestId, answer });
        inFlight.current = false;
        const outcome: Outcome = result.ok ? result.value.outcome : 'write_failed';
        onAnswered?.(outcome);
        if (outcome === 'delivered') {
          setWhat(text);
          setPhase('delivered');
          delivered?.();
        } else if (outcome === 'not_pending') {
          setPhase('not_pending');
        } else {
          setPhase('pending');
          setFailed({ retry: () => void send(), detail: result.ok ? null : result.error.message });
        }
      };
      void send();
    },
    [item.appSessionId, item.request, onAnswered],
  );

  useEffect(() => {
    if (phase !== 'not_pending') return;
    const timer = setTimeout(() => setPhase('closed'), NOT_PENDING_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return { phase, what, failed, submit };
}

// Text entry, as C5's dispatcher defines it (`keymap/dispatcher.ts`, whose `BUTTON_LIKE_INPUTS` this reads): an input
// that takes a keypress as text, a textarea, a select, or inside a contenteditable.
export { BUTTON_LIKE_INPUTS };
const isTextEntry = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLInputElement && !BUTTON_LIKE_INPUTS.has(target.type)) ||
  (target instanceof Element && target.closest('[contenteditable]:not([contenteditable="false"])') !== null);

// A click counts only as the release of a pointer press on the same button (`detail` > 0): a keyboard- or
// script-synthesised click answers nothing (§5.1: the hover card approves by explicit click).
function usePointerOnly() {
  const pressed = useRef<EventTarget | null>(null);
  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void (pressed.current = event.currentTarget),
    byPointer: (event: MouseEvent<HTMLButtonElement>) => {
      const genuine = event.detail > 0 && pressed.current === event.currentTarget;
      pressed.current = null;
      return genuine;
    },
  };
}

function titleOf(request: SessionEvent | null, requester: string): { title: string | null; subtitle: string | null } {
  switch (request?.kind) {
    case 'permission.requested': {
      const mcp = mcpParts(request);
      return { title: mcp ? mcp.tool : (request.displayName ?? request.toolName), subtitle: `${requester} wants to ${toolVerb(request)}${mcp?.source ? ` · ${mcp.source}` : ''}` };
    }
    case 'question.requested':
      return { title: request.questions.length === 1 ? 'Question' : `${request.questions.length} questions`, subtitle: `${requester} asks` };
    case 'plan.requested':
      return { title: 'Plan', subtitle: `${requester} proposes a plan` };
    case 'dialog.requested':
      return { title: dialogTitle(request.dialogKind, request.payload), subtitle: null };
    case 'elicitation.requested':
      return { title: request.mcpServerName, subtitle: `${request.mcpServerName} asks for input` };
    case 'maws.ask.opened': // E1 M4b
      return { title: request.title ?? ASK_CARD.untitled, subtitle: null };
    default:
      return { title: null, subtitle: null };
  }
}

// Whether the request is one the card answers in place (the docked frame hosts only these).
const answerable = (request: SessionEvent | null): boolean =>
  request !== null &&
  (request.kind === 'permission.requested' ||
    request.kind === 'question.requested' ||
    request.kind === 'plan.requested' ||
    request.kind === 'elicitation.requested' ||
    (request.kind === 'dialog.requested' && declaredDialog(request.dialogKind, request.payload).ok));

// Keyed by the item: every piece of per-request state (the delivery phase, the answered line, a failure, the bound
// keys, a variant's picked scope or selections) belongs to one request, and a placement that renders the card unkeyed
// (C5's Overview card and hover card pass the session's next request into the same slot) must never carry it over.
export function RequestCard(props: RequestCardProps) {
  return <RequestCardFor key={props.item.id} {...props} />;
}

function RequestCardFor(props: RequestCardProps) {
  const { item, request: given, placement } = props;
  const fetched = useAttention((s) => s.requests.get(item.id));
  const unreadable = useAttention((s) => s.unreadable.get(item.id) ?? null);
  useEffect(() => {
    if (given === null) void useAttention.getState().loadRequest(ipc, item);
  }, [given, item]);
  const request = given ?? fetched ?? null;
  const loading = given === null && fetched === undefined && item.request.requestId !== null;

  const native = (event: SessionEvent | null, concealed = false) => (
    <NativeRequestCard {...props} request={event} loading={loading} unreadable={unreadable} concealed={concealed} />
  );
  if (request?.kind !== 'question.requested' || placement === 'hover') return native(request);

  return (
    <SurfaceRow
      appSessionId={item.appSessionId}
      component="AskUserQuestion"
      instanceId={request.toolUseId}
      props={{ tool: 'AskUserQuestion', questions: engineQuestionsOf(request.questions) }}
      enabled={item.state === 'pending'}
    >
      {(rewritten, { concealed }) => native({ ...request, questions: nativeQuestionsOf(rewritten.questions)! }, concealed)}
    </SurfaceRow>
  );
}

function NativeRequestCard({ item, request, placement, onAnswered, loading, unreadable, concealed }: RequestCardProps & {
  loading: boolean;
  unreadable: string | null;
  concealed: boolean;
}) {
  const record = useSessions((s) => s.records.get(item.appSessionId));
  const project = useSessions((s) => (record?.projectId ? (s.projects.get(record.projectId)?.name ?? null) : null));
  const rows = useTranscriptStore((s) => s.entries[item.appSessionId]?.rows);
  const now = useNow();
  const { phase, what, failed, submit } = useDelivery(item, onAnswered);
  const pointer = usePointerOnly();

  // The requests a docked placement shows: the transcript's slot then renders a pointer to it. A notice with no request
  // read (unreadable, or no longer held) shows nothing to answer, so the transcript keeps its own card.
  const { requestId } = item.request;
  const shown = request !== null;
  useEffect(() => (placement === 'docked' && requestId !== null && shown ? markDocked(item.appSessionId, requestId) : undefined), [placement, item.appSessionId, requestId, shown]);

  // The variant's Enter, Esc and digit actions, and whether it has each (a key it lacks stays unbound).
  const keys = useRef<CardKeys>({ accept: null, decline: null });
  const [bound, setBound] = useState({ accept: false, decline: false });
  const bindKeys = useCallback((next: CardKeys) => {
    keys.current = next;
    setBound((b) => (b.accept === (next.accept !== null) && b.decline === (next.decline !== null) ? b : { accept: next.accept !== null, decline: next.decline !== null }));
  }, []);
  const accept = useCallback(() => keys.current.accept?.(), []);
  const decline = useCallback(() => keys.current.decline?.(), []);
  const live = phase === 'pending' && item.state === 'pending' && !concealed;

  // Card placement: the focus owner is C5's article (the nearest `tabindex` ancestor), the card root without one.
  const rootRef = useRef<HTMLDivElement>(null);
  const ownerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    ownerRef.current = root ? (root.parentElement?.closest<HTMLElement>('[tabindex]') ?? root) : null;
  });
  const cardKeys = placement === 'card' && live;
  useKeyChord('request.accept', accept, { within: ownerRef, enabled: cardKeys && bound.accept });
  useKeyChord('request.decline', decline, { within: ownerRef, enabled: cardKeys && bound.decline });

  // Digits, from the element that owns the keys (the article, or the docked frame, which mounts once the request is
  // known to be answerable).
  const framed = placement === 'docked' && answerable(request) && !concealed;
  useEffect(() => {
    if (!live || (placement !== 'card' && placement !== 'docked')) return;
    const owner = placement === 'card' ? ownerRef.current : (rootRef.current?.closest<HTMLElement>('[data-docked-frame]') ?? null);
    if (!owner) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!/^[1-9]$/.test(event.key) || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || isTextEntry(event.target)) return;
      const digit = keys.current.digit;
      if (!digit) return;
      event.preventDefault();
      digit(Number(event.key));
    };
    owner.addEventListener('keydown', onKeyDown);
    return () => owner.removeEventListener('keydown', onKeyDown);
  }, [live, placement, framed]);

  if (phase === 'closed') return null;

  const heading = HEADINGS[item.kind];
  const busy = phase === 'answering';
  const requester = requesterName(rows ?? [], request?.agentId ?? item.request.agentId);
  const { title, subtitle } = titleOf(request, requester);
  const collapsed = phase === 'delivered' || (phase === 'pending' && item.state === 'delivered' && failed === null);
  const hover = placement === 'hover';
  const canAnswerHover = hover && hoverApproval(item, request) && record?.holder.kind !== 'terminal' && record?.holder.kind !== 'background_job';
  const openSession = () => useLayout.getState().openSession(item.appSessionId);
  const variant = { item, placement, busy: busy || concealed, submit, bindKeys };

  let body: ReactNode;
  if (loading) {
    body = (
      <p aria-busy className="m-0 text-fg-faint">
        Loading the request…
      </p>
    );
  } else if (phase === 'not_pending') {
    body = (
      <p role="status" className="m-0 text-fg-muted">
        Already answered elsewhere
      </p>
    );
  } else if (collapsed) {
    body = (
      <p role="status" className="m-0 text-fg-muted">
        Answered{what ? ` · ${what}` : ''}
      </p>
    );
  } else if (request?.kind === 'maws.ask.opened') {
    body = <AskBody appSessionId={item.appSessionId} request={request} />; // E1 M4b: every placement, the hover's too
  } else if (hover) {
    body = request ? <HoverPreview request={request} /> : <NoticeBody item={item} />;
  } else {
    switch (request?.kind) {
      case 'permission.requested':
        body = <PermissionBody {...variant} request={request} />;
        break;
      case 'question.requested':
        body = <QuestionBody {...variant} request={request} />;
        break;
      case 'plan.requested':
        body = <PlanBody {...variant} request={request} />;
        break;
      case 'dialog.requested':
        body = <DialogBody {...variant} request={request} />;
        break;
      case 'elicitation.requested':
        body = <ElicitationBody {...variant} request={request} />;
        break;
      default:
        body = <NoticeBody item={item} seenHere={placement === 'docked'} />;
    }
  }

  // Hover, the card sits in C5's dialog named for the session; the card itself is named for its request and tool.
  const named = hover ? { role: 'group', 'aria-label': title === null ? heading.text : `${heading.text}: ${title}` } : {};
  // W4: a question in the transcript is Claude Desktop's 480 px card; docked it fills the frame that stands in for the
  // composer, and the Overview card is its own width.
  const questionCard = placement === 'inline' && request?.kind === 'question.requested' ? 'max-w-[480px] rounded-lg border border-border bg-bg-raised p-3' : '';
  const content = (
    <div ref={rootRef} data-request-card={item.id} aria-busy={busy} {...named} className={`flex flex-col gap-3 text-fg ${placement === 'docked' || placement === 'inline' ? 'text-ui' : 'text-ui-sm'} ${questionCard}`}>
      {!framed && (
        <div className={`flex items-center gap-1.5 ${TONE[heading.tone]}`}>
          <span aria-hidden>{heading.char}</span>
          <span>{heading.text}</span>
          {request?.agentId && requester !== 'Main session' && <span className="text-fg-muted">from {requester}</span>}
        </div>
      )}
      {title !== null && (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-ui font-semibold">{title}</h3>
          {subtitle && <Muted>{subtitle}</Muted>}
          {hover && <Muted>{[project, record ? displayTitle(record) : null, itemAge(item, now)].filter(Boolean).join(' · ')}</Muted>}
        </div>
      )}
      {failed && (
        <div role="alert" className="flex items-center gap-2 rounded-sm border border-danger px-2.5 py-1.5 text-danger">
          <span className="flex-1" title={failed.detail ?? undefined}>
            Couldn't deliver the answer
          </span>
          <CardButton onClick={failed.retry}>Retry</CardButton>
        </div>
      )}
      {body}
      {request === null && unreadable !== null && (
        <div role="alert" className="flex items-center gap-2 text-danger">
          <span className="flex-1" title={unreadable}>
            The request could not be read
          </span>
          <CardButton onClick={() => void useAttention.getState().retryRequest(ipc, item)}>Retry</CardButton>
        </div>
      )}
      {request?.kind === 'permission.requested' && record && !collapsed && (
        <p className="m-0 truncate font-mono text-ui-sm text-fg-muted" title={record.directory}>
          {record.directory}
        </p>
      )}
      {canAnswerHover && !collapsed && <Muted>Approve applies to this request only.</Muted>}
      {(hover || (placement === 'card' && !answerable(request))) && request?.kind !== 'maws.ask.opened' && (
        <Controls>
          <CardButton onClick={openSession} className="mr-auto">
            Open session
          </CardButton>
          {canAnswerHover && !collapsed && request?.kind === 'permission.requested' && (
            <>
              <CardButton
                disabled={busy}
                title="Click to deny"
                onPointerDown={pointer.onPointerDown}
                onClick={(event) => pointer.byPointer(event) && submit(toAnswer({ kind: 'permission', decision: 'deny', message: '' }), 'Denied')}
              >
                Deny
              </CardButton>
              <CardButton
                tone="primary"
                disabled={busy}
                title="Click to approve"
                onPointerDown={pointer.onPointerDown}
                onClick={(event) => pointer.byPointer(event) && submit(toAnswer({ kind: 'permission', decision: 'allow', scope: 'once' }), 'Allowed once')}
              >
                Approve
              </CardButton>
            </>
          )}
        </Controls>
      )}
    </div>
  );

  if (!framed) return content;
  return (
    <DockedCardFrame appSessionId={item.appSessionId} title={heading.text} onAccept={live && bound.accept ? accept : null} onDecline={live && bound.decline ? decline : null}>
      {content}
    </DockedCardFrame>
  );
}
