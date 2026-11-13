// X4, the request card (charter §13 X4, owned by C7; C7 execution document, Request card): one component for the five
// request kinds and the notices, identical in every placement. It resolves the originating request (the prop, else
// `attention.request` through the attention store's cache), answers through `session.answer` with payloads `toAnswer`
// validated, reports the delivery (`answering`; `delivered` standing as it was, its controls disabled, until its item
// leaves the session's list, UX wave U1's UC-1 and U1a's §C; `not_pending` for two seconds; `write_failed` back to
// pending with Retry), and owns the keyboard: Enter and Esc (and a permission prompt's ⌘↩ and ⇧⌘↩, UX wave U1a §D)
// through C5's dispatcher, bound `within` the element that owns focus for the placement, each on a fresh press only.
// Docked, that is the `DockedCardFrame` around the card; in an Overview card, the nearest ancestor with a `tabindex` (C5's
// article), since the article, not the card, holds focus there; hover and inline bind no key. Digits pick a question's
// option from the same owner. U1a §D: a permission prompt opens on one line saying what is asked (`askedLine`), where the
// other kinds have their title; the hover placement keeps its heading, its "wants to" line and the folder line, and offers
// Allow once and Deny as the one rule for answers from outside a pane admits (U1a §H, `outsideAnswers`). U1a §I: a
// file change says "Create" or "Edit" as its diff against the file read on the session's machine says (`proposed`). E1 M4b: a
// blocking `maws` ask's item (originating in `maws.ask.opened`) renders compact (`variants/Ask.tsx`), its one action
// opening the Question sheet; the card never answers it. P5 O8 M7a: a placement
// that asks for it (`askInPlace`: the project channel's waiting cards) draws the sheet's body inline instead, which
// answers through `maws.ask.answer` as the sheet does; the sheet stays the session pane's.
//
// P5 O9 M6: each option is drawn from the session's controls port (`answerCapability`), disabled in place with its reason
// where the port can't carry it. A request its session's terminal asks too says so ("Also asked in the terminal: the first
// answer wins", the owner's Q3), and settles in place as the race ended ("Answered in the terminal: Allowed"), a late
// answer included; past a background request's window it reads "Answer this in the terminal" (`lane-a/race.ts`).
// UX wave U1a (M2, §E): a question's stepper has Dismiss (the decline Esc sends; on a terminal's asynchronous question,
// the bridge's dismissal, which no key sends) and a double-click that picks a single choice and goes on.
//
// The card imports the docked frame from its own module, never `composer/index.ts`, so no editor code reaches it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent, type PointerEvent } from 'react';
import { ATTENTION_HEADINGS, type AttentionTone } from '@shared/attention/headings';
import type { AttentionItem } from '@shared/graph/attention';
import type { RequestAnswer } from '@shared/engine/answers';
import type { SessionEvent } from '@shared/graph/events';
import { engineQuestionsOf, nativeQuestionsOf } from '@shared/engine/surface-rows';
import { SurfaceRow } from '../engine-surface/SurfaceRow';
import { useNow } from '../app/use-now';
import { DockedCardFrame } from '../composer/docked/DockedCardFrame';
import { ipc } from '../ipc/client';
import { answerSession, useSessionControls } from '../session/controls/controls-for'; // P5 O9 M4
import type { Capability } from '../session/controls/types'; // P5 O9 M6
import { RACE, settledWords, terminalOnlyNow, useRace } from '../lane-a/race'; // P5 O9 M6
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
import { proposedChange, proposedFilePath } from './preview/proposed';
import { useProposedFile } from './preview/use-proposed-file';
import { requesterName } from './requester';
import { askedLine, mcpParts, toolVerb } from './tools';
import { DialogBody } from './variants/Dialog';
import { dialogTitle, declaredDialog } from './variants/dialog-kinds';
import { ElicitationBody } from './variants/Elicitation';
import { NoticeBody } from './variants/Notice';
import { PermissionBody } from './variants/Permission';
import { PlanBody } from './variants/Plan';
import { QuestionBody } from './variants/Question';
import { gated, type CardKeys, type Placement } from './variants/types';
import { displayTitle } from '../sessions/title';
import { waits } from '@shared/attention/kinds'; // UC-1
import { outsideAnswers } from '@shared/attention/outside-answers'; // U1a §H
// P2-C start (2026-10-10)
import { bareOf } from '@shared/machine/address';
import { workingFolder } from '@shared/sessions/working-folder'; // UX wave U8c-2
import { markIdOf } from '@shared/owner/marks';
import { openAnchor, ownerAnchorOf, type ItemAnchor } from '../attention/anchor';
import { markRead } from '../owner/report/answering';
import { ESSENTIAL } from '../owner/report/copy';
// P2-C end

export type { Placement } from './variants/types';

export interface RequestCardProps {
  item: AttentionItem; // any kind; the five request kinds render a card, the rest a notice
  request: SessionEvent | null; // the originating *.requested event; fetched through attention.request when null
  placement: Placement;
  paneIndex: 0 | 1 | null; // informational
  onAnswered?: (outcome: 'delivered' | 'not_pending' | 'write_failed') => void;
  askInPlace?: boolean; // P5 O8 M7a: a MAWS ask answers here, through the Question sheet's body, rather than opening the sheet
}

// The kind line (C5's table, so the Needs-you row, the hover and the card read alike); docked, the frame's title.
export const HEADINGS = ATTENTION_HEADINGS;
const TONE: Record<AttentionTone, string> = { warning: 'text-warning', info: 'text-info', danger: 'text-danger', accent: 'text-accent' /* P2-C */ };
const NOT_PENDING_MS = 2_000;
const KEY_NAMES = ['accept', 'decline', 'allowOnce', 'allowLasting'] as const;
const NO_KEYS: Record<(typeof KEY_NAMES)[number], boolean> = { accept: false, decline: false, allowOnce: false, allowLasting: false };
const CARRIED: Capability = { available: true }; // no port: today's delivery path refuses it in the holder's words
// U1a §H: the two answers the hover card may give, the once-only allow and the plain deny
const ALLOW_ONCE = toAnswer({ kind: 'permission', decision: 'allow', scope: 'once' });
const DENY = toAnswer({ kind: 'permission', decision: 'deny', message: '' });

// `sent`: the answer was delivered, and the card stands as it was, its controls disabled, until the session's list no
// longer holds its item, which every route's holder says at once (UC-1, U1a's §C); the card never hides on its own word.
type Phase = 'pending' | 'answering' | 'sent' | 'not_pending' | 'closed';
type Outcome = 'delivered' | 'not_pending' | 'write_failed';

// The one delivery path: the session's controls port (lane B: `session.answer`), its outcome, and a Retry that sends
// the same answer again.
function useDelivery(item: AttentionItem, onAnswered: RequestCardProps['onAnswered']) {
  const [phase, setPhase] = useState<Phase>('pending');
  const [failed, setFailed] = useState<{ retry: () => void; detail: string | null } | null>(null);
  const inFlight = useRef(false);

  const submit = useCallback(
    (answer: RequestAnswer, _what: string, delivered?: () => void) => { // the card draws no "Answered · <what>" (§C)
      const { requestId } = item.request;
      if (requestId === null) return;
      const send = async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPhase('answering');
        setFailed(null);
        const result = await answerSession(item, answer);
        inFlight.current = false;
        const outcome: Outcome = result.ok ? result.value.outcome : 'write_failed';
        onAnswered?.(outcome);
        if (outcome === 'delivered') {
          setPhase('sent');
          delivered?.();
        } else if (outcome === 'not_pending') {
          setPhase(terminalOnlyNow(item) ? 'pending' : 'not_pending'); // P5 O9 M6: the terminal's to answer, still pending
        } else {
          setPhase('pending');
          setFailed({ retry: () => void send(), detail: result.ok ? null : result.error.message });
        }
      };
      void send();
    },
    [item, onAnswered],
  );

  useEffect(() => {
    if (phase !== 'not_pending') return;
    const timer = setTimeout(() => setPhase('closed'), NOT_PENDING_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return { phase, failed, submit };
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

// Keyed by the item: every piece of per-request state (the delivery phase, its sent state, a failure, the bound
// keys, a variant's picked scope or selections) belongs to one request, and a placement that renders the card unkeyed
// (C5's Overview card and hover card pass the session's next request into the same slot) must never carry it over.
// UC-1: an item that no longer waits (its answer delivered: only a machine on an older build still lists one) is drawn
// by no placement and binds no key.
export function RequestCard(props: RequestCardProps) {
  if (!waits(props.item)) return null;
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
      enabled={waits(item)}
    >
      {(rewritten, { concealed }) => native({ ...request, questions: nativeQuestionsOf(rewritten.questions)! }, concealed)}
    </SurfaceRow>
  );
}

function NativeRequestCard({ item, request, placement, onAnswered, loading, unreadable, concealed, askInPlace = false }: RequestCardProps & {
  loading: boolean;
  unreadable: string | null;
  concealed: boolean;
}) {
  const record = useSessions((s) => s.records.get(item.appSessionId));
  const project = useSessions((s) => (record?.projectId ? (s.projects.get(record.projectId)?.name ?? null) : null));
  const rows = useTranscriptStore((s) => s.entries[item.appSessionId]?.rows);
  const now = useNow();
  const { phase, failed, submit } = useDelivery(item, onAnswered);
  const pointer = usePointerOnly();
  // P5 O9 M6: what the session's port carries, and how the race with its terminal stands
  const controls = useSessionControls(item.appSessionId);
  const capability = useCallback((answer: RequestAnswer): Capability => controls?.answerCapability(item, answer) ?? CARRIED, [controls, item]);
  const race = useRace(item);
  // U1a §I: a file change's diff, against its file as read on the session's machine; the first line and the preview both
  // follow it. The read's answer lands nowhere once the card has answered, so what was approved stays drawn as it was.
  const fileRequest = request?.kind === 'permission.requested' && placement !== 'hover' ? request : null;
  const file = useProposedFile(item.appSessionId, item.id, fileRequest && proposedFilePath(fileRequest.toolName, fileRequest.input), phase !== 'pending');
  const proposed = useMemo(() => (fileRequest ? proposedChange(fileRequest.toolName, fileRequest.input, file) : null), [fileRequest, file]);

  // The requests a docked placement shows: the transcript's slot then renders a pointer to it. A notice with no request
  // read (unreadable, or no longer held) shows nothing to answer, so the transcript keeps its own card.
  const { requestId } = item.request;
  const shown = request !== null;
  useEffect(() => (placement === 'docked' && requestId !== null && shown ? markDocked(item.appSessionId, requestId) : undefined), [placement, item.appSessionId, requestId, shown]);

  // The variant's key actions, and whether it has each (a key it lacks stays unbound).
  const keys = useRef<CardKeys>({ accept: null, decline: null });
  const [bound, setBound] = useState(NO_KEYS);
  const bindKeys = useCallback((next: CardKeys) => {
    keys.current = next;
    const has = { accept: next.accept != null, decline: next.decline != null, allowOnce: next.allowOnce != null, allowLasting: next.allowLasting != null };
    setBound((b) => (KEY_NAMES.every((name) => b[name] === has[name]) ? b : has));
  }, []);
  const accept = useCallback(() => keys.current.accept?.(), []);
  const decline = useCallback(() => keys.current.decline?.(), []);
  const allowOnce = useCallback(() => keys.current.allowOnce?.(), []);
  const allowLasting = useCallback(() => keys.current.allowLasting?.(), []);
  const live = phase === 'pending' && !concealed && race.settled === null; // M6: a settled race answers nothing

  // Card placement: the focus owner is C5's article (the nearest `tabindex` ancestor), the card root without one.
  const rootRef = useRef<HTMLDivElement>(null);
  const ownerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    ownerRef.current = root ? (root.parentElement?.closest<HTMLElement>('[tabindex]') ?? root) : null;
  });
  const cardKeys = placement === 'card' && live;
  useKeyChord('request.accept', accept, { within: ownerRef, enabled: cardKeys && bound.accept, fresh: true });
  useKeyChord('request.decline', decline, { within: ownerRef, enabled: cardKeys && bound.decline, fresh: true });
  useKeyChord('request.allowOnce', allowOnce, { within: ownerRef, enabled: cardKeys && bound.allowOnce, fresh: true });
  useKeyChord('request.allowLasting', allowLasting, { within: ownerRef, enabled: cardKeys && bound.allowLasting, fresh: true });

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

  if (phase === 'closed' && race.settled === null) return null; // M6: a settlement stays said while its placement shows it

  const heading = HEADINGS[item.kind];
  const sent = phase === 'sent';
  const busy = phase === 'answering' || sent; // sent: disabled until the list lets the item go
  const requester = requesterName(rows ?? [], request?.agentId ?? item.request.agentId);
  const { title, subtitle } = titleOf(request, requester);
  const hover = placement === 'hover';
  // U1a §D: a permission prompt's first line, outside the hover placement, in place of the kind line and the title
  const asked = request?.kind === 'permission.requested' && !hover ? askedLine(request, proposed) : null;
  const from = request?.agentId && requester !== 'Main session' ? requester : null;
  // U1a §H: what the one rule for answers from outside a pane admits on the hover card, each button by the session's port
  // on its own answer (P5 O9 M6: a session held elsewhere has a port only while its bridge drives it)
  const outside = hover && waits(item) && controls !== null ? outsideAnswers(request, 'hover') : null;
  const hoverAllow = outside?.allowOnce === true && capability(ALLOW_ONCE).available;
  const hoverDeny = outside?.deny === true && capability(DENY).available;
  // P2-C start (2026-10-10; M6): a question an agent left or a must-read opens at its mark in the report, and a must-read
  // offers Mark read; neither is answered here (the card in the session answers a question)
  const anchor = ownerAnchorOf(item);
  const openSession = () => (anchor !== null ? openAnchor(item.appSessionId, anchor, (id) => useLayout.getState().openSession(id)) : useLayout.getState().openSession(item.appSessionId));
  // P2-C end
  const variant = { item, placement, busy: busy || concealed, submit, bindKeys, capability };
  const settled = sent ? null : race.settled; // M6: a settlement after our own delivered answer is ours: nothing to say
  // U1a §G: a dismissal this app made of an asynchronous question says nothing: its card leaves at once
  const settledText = settled === null ? null : settledWords(settled, { asyncQuestion: item.kind === 'async_input' });
  if (settled !== null && settledText === null) return null;

  let body: ReactNode;
  if (loading) {
    body = (
      <p aria-busy className="m-0 text-fg-faint">
        Loading the request…
      </p>
    );
  } else if (settled !== null) {
    body = (
      <p role="status" className="m-0 text-fg-muted">
        {settledText}
      </p>
    );
  } else if (phase === 'not_pending') {
    body = (
      <p role="status" className="m-0 text-fg-muted">
        Already answered elsewhere
      </p>
    );
  } else if (request?.kind === 'maws.ask.opened') {
    body = <AskBody appSessionId={item.appSessionId} request={request} inPlace={hover || askInPlace} />;
  } else if (hover) {
    body = request ? <HoverPreview request={request} /> : <NoticeBody item={item} />;
  } else {
    switch (request?.kind) {
      case 'permission.requested':
        body = <PermissionBody {...variant} request={request} proposed={proposed ?? undefined} />;
        break;
      case 'question.requested': {
        // U1a §E: Dismiss sends the decline the form's Esc sends (an asynchronous question's: the bridge's dismissal),
        // gated as that decline is; a double-click on a single-choice option picks it and goes on
        const declining = toAnswer({ kind: 'permission', decision: 'deny', message: '' });
        body = <QuestionBody {...variant} request={request} dismiss={{ ...gated(capability(declining)), run: () => submit(declining, 'Dismissed') }} doubleClick />;
        break;
      }
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
      {asked !== null && (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 flex items-baseline gap-1.5 text-ui font-semibold">
            <span aria-hidden className={TONE[heading.tone]}>
              {heading.char}
            </span>
            <span>{asked}</span>
            {from !== null && <span className="font-normal text-fg-muted"> · from {from}</span>}
          </h3>
          {race.asked && settled === null && <Muted>{race.terminalOnly ? RACE.terminal : RACE.asked}</Muted>}
        </div>
      )}
      {!framed && asked === null && (
        <div className={`flex items-center gap-1.5 ${TONE[heading.tone]}`}>
          <span aria-hidden>{heading.char}</span>
          <span>{heading.text}</span>
          {from !== null && <span className="text-fg-muted">from {from}</span>}
        </div>
      )}
      {title !== null && asked === null && (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-ui font-semibold">{title}</h3>
          {subtitle && <Muted>{subtitle}</Muted>}
          {race.asked && settled === null && <Muted>{race.terminalOnly ? RACE.terminal : RACE.asked}</Muted>}
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
      {request?.kind === 'permission.requested' && hover && record && ( // UX wave U8c-2: where the call will run, the agent's folder
        <p className="m-0 truncate font-mono text-ui-sm text-fg-muted" title={workingFolder(record).cwd}>
          {workingFolder(record).cwd}
        </p>
      )}
      {hoverAllow && <Muted>Approve applies to this request only.</Muted>}
      {(hover || (placement === 'card' && !answerable(request))) && request?.kind !== 'maws.ask.opened' && (
        <Controls>
          <CardButton onClick={openSession} className="mr-auto">
            Open session
          </CardButton>
          {/* P2-C start (2026-10-10) */}
          {item.kind === 'essential_unread' && anchor !== null && (
            <MarkRead appSessionId={item.appSessionId} anchor={anchor} />
          )}
          {/* P2-C end */}
          {hoverDeny && (
            <CardButton disabled={busy} title="Click to deny" onPointerDown={pointer.onPointerDown} onClick={(event) => pointer.byPointer(event) && submit(DENY, 'Denied')}>
              Deny
            </CardButton>
          )}
          {hoverAllow && (
            <CardButton
              tone="primary"
              disabled={busy}
              title="Click to allow once"
              onPointerDown={pointer.onPointerDown}
              onClick={(event) => pointer.byPointer(event) && submit(ALLOW_ONCE, 'Allowed once')}
            >
              Allow once
            </CardButton>
          )}
        </Controls>
      )}
    </div>
  );

  if (!framed) return content;
  return (
    <DockedCardFrame
      appSessionId={item.appSessionId}
      title={heading.text}
      onAccept={live && bound.accept ? accept : null}
      onDecline={live && bound.decline ? decline : null}
      onAllowOnce={live && bound.allowOnce ? allowOnce : null}
      onAllowLasting={live && bound.allowLasting ? allowLasting : null}
    >
      {content}
    </DockedCardFrame>
  );
}

// P2-C start (2026-10-10; M6's fix wave): a must-read's Mark read; one that failed is said on the card beside it, the
// button staying to try again
function MarkRead({ appSessionId, anchor }: { appSessionId: AttentionItem['appSessionId']; anchor: ItemAnchor }) {
  const [failed, setFailed] = useState<string | null>(null);
  const read = async () => {
    setFailed(null);
    setFailed(await markRead(appSessionId, [markIdOf(bareOf(appSessionId), 'essential', anchor)])); // P5 O6 M2: main's mark id, on the bare session id
  };
  return (
    <>
      {failed !== null && (
        <span role="alert" className="text-danger">
          {ESSENTIAL.notMarked(failed)}
        </span>
      )}
      <CardButton onClick={() => void read()}>{ESSENTIAL.markRead}</CardButton>
    </>
  );
}
// P2-C end
