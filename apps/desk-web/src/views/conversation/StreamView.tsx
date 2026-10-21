// A channel's stream as a chat on the session view's rendering (§4, amended 2026-10-19): the rows sit in MAWS's
// reading column (`thread-column`) with its typography; a session's message is MAWS's answer prose (its text through
// MAWS's Markdown) under one header per run of a sender's messages (`conversation/chat.ts`); the owner's own message is
// MAWS's user bubble on the right (`Bubble.tsx`), each recipient's delivery outcome (DX4) as the bubble's foot, another
// human's a bubble on the left under who they are; a question is the session's request card while it can be answered
// here and MAWS's question receipt once it was, or while it waits elsewhere; lifecycle is a quiet run — one muted line
// per session, folded behind a count past a few — and agent-to-agent traffic a lifecycle line per run (a run of one
// drawn whole, more behind the count); a day separator stands where the calendar day changes; a direct channel's
// working record is a label saying where it is (`workLabel`); this tab's sends stand at the end on their way to the
// log. The item a tapped notification landed on is marked and scrolled to once it is drawn. A direct channel is drawn
// here only where the session view is not, on a phone as on a desktop: for a machine that is offline, and for a session
// whose machine serves no transcript (the composite's §9.1).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';
import { writerMachine, type LogEvent, type Recipient } from 'desk-hub/protocol';
import { dateFormats, formatClock } from '@shared/app/date-format';
import { askModAnswers } from '../../../../../src/renderer/src/transcript/model/ask-mod';
import { TranscriptActionsProvider } from '../../../../../src/renderer/src/transcript/view/context';
import { Markdown } from '../../../../../src/renderer/src/transcript/view/markdown/Markdown';
import { MessageIcon } from '../../../../../src/renderer/src/transcript/view/rows/icons';
import { chatBlocks, dayOf, type ChatBlock, type HumanItem, type QuietLine, type RunItem } from '../../conversation/chat';
import { broadcastLabel, byWhom, crossProject, type StreamItem } from '../../conversation/stream';
import { settledText, DELIVERY_TEXT } from '../../conversation/words';
import { deliveryKey, type OutboxItem, type RequestRecord } from '../../project/conversation';
import { useProjectName } from '../../state/grid';
import { questionsOf, RequestCard } from '../requests/RequestCard';
import { BROWSER_ACTIONS } from './browser-actions';
import { Bubble } from './Bubble';
import { useDesk } from './desk-context';

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const clock = (ts: string) => {
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? '' : formatClock(ms);
};
/** Past three lines, a quiet run folds behind its count. */
const QUIET_SHOWN = 3;

/**
 * The stream scrolls as a chat list does: a `column-reverse` scroller whose one child is the list in reading order, so
 * the bottom is the scroll origin. The browser then keeps the tail itself (the scroll position stays 0 at the bottom as
 * rows are added below), a change above a reader who has scrolled back moves nothing they see (it lies at the far end
 * from the origin), and its own scroll anchoring holds them in place when a row below them arrives or grows. Nothing
 * here anchors content, except on an engine without scroll anchoring (`useAnchoringFallback`); a resize of the
 * scroller itself is held on every engine (`useResizeHold`, or the fallback). It opens at the tail because the origin
 * is the tail, and a landing scrolls its card into view. The scroll position reads 0 at the bottom and negative upward
 * (Chrome, Safari, Firefox). The scroller is the rows' query container, as MAWS's is, so a wide table or code block in
 * a message breaks out as far as the pane allows and no further.
 */
export function StreamView({ items, outbox, landed = null, workLabel = 'on a computer' }: { items: StreamItem[]; outbox: OutboxItem[]; landed?: string | null; workLabel?: string }) {
  const landedRow = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  useResizeHold(scroller);
  useAnchoringFallback(scroller, list);
  const now = useDayClock();
  // A landing decides where the reader is: scrolled to its card.
  useEffect(() => {
    // Braced: Chrome's scrollIntoView returns a promise, which an effect must not return as its cleanup.
    landedRow.current?.scrollIntoView({ block: 'center' });
  }, [landed]);
  const blocks = chatBlocks(items);
  return (
    <div ref={scroller} className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto" data-testid="channel-events" data-transcript-scroller="">
      <ol ref={list} className="desk-chat m-0 list-none py-3">
        {items.length === 0 && outbox.length === 0 && <li className="thread-column text-ui-sm text-fg-muted">Nothing here yet.</li>}
        {blocks.map((block) => (
          <li key={block.key} className="thread-column transcript-row" data-block={block.kind}>
            <Block block={block} now={now} workLabel={workLabel} landed={landed} landedRow={landedRow} />
          </li>
        ))}
        {outbox.map((sent) => (
          <li key={sent.nonce} className="thread-column transcript-row" data-block="outbox">
            <Item kind="outbox" state={sent.state}>
              <Bubble
                className="desk-chat-send"
                aria-label="Your message, on its way"
                data-side="you"
                data-state={sent.state === 'refused' ? 'failed' : 'sending'}
                text={sent.text}
                at={null}
                foot={<div className="desk-delivery-foot">{sent.state === 'refused' ? `Not sent · the hub refused it (${sent.reason})` : 'Sending…'}</div>}
              />
            </Item>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The reader's place through a resize of the scroller itself, on an engine with scroll anchoring: the composer growing,
 * a keyboard that resizes the page, a rotation. The scroller keeps a reader at their distance from the bottom, its
 * scroll origin, so a change of its own height moves every row they see by as much, unless the engine's anchoring holds
 * them: Chrome's holds most such changes, WebKit's some (not the composer's), and none holds a reader the change clamps
 * at the oldest edge (a box that grew under a reader nearer that edge than it grew). Where the browser left the reader
 * at their distance from the bottom, or clamped them there, the view's top is put back where it was: where the reader
 * was when last seen, plus the box's height then, less its height now. Where its anchoring moved them, that stands: it
 * also follows the rows a rotation rewraps, which a distance cannot, and so does a place the reader scrolled to in the
 * same moment. Last seen is a scroll event's place or this observer's own; a scroll that arrives while a change of the
 * box's height is not handled yet is left for this observer to judge. A reader the browser left at the tail stays at
 * it. Without anchoring, the fallback holds a resize itself, with the rows it rewraps (`useAnchoringFallback`).
 */
function useResizeHold(scroller: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box || !CSS.supports('overflow-anchor', 'auto')) return;
    let height = box.clientHeight;
    let seen = -box.scrollTop; // the reader's distance from the bottom, when last seen
    const onScroll = () => {
      if (box.clientHeight === height) seen = -box.scrollTop;
    };
    const observer = new ResizeObserver(() => {
      const was = height;
      height = box.clientHeight;
      const now = -box.scrollTop;
      const left = Math.abs(now - seen) < 0.5;
      const clamped = height > was && now < seen && now >= box.scrollHeight - height - 1;
      if (height !== was && (left || clamped)) {
        const to = seen < 1 ? 0 : Math.max(0, seen + was - height);
        if (Math.abs(to - now) >= 0.5) box.scrollTop = -to;
      }
      seen = -box.scrollTop;
    });
    box.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(box);
    return () => {
      observer.disconnect();
      box.removeEventListener('scroll', onScroll);
    };
  }, [scroller]);
}

/**
 * Scroll anchoring for an engine that has none: Safari before 27, where `overflow-anchor` does not parse (WebKit gates
 * the property and the anchoring on one setting, so supporting the one is having the other). In the column-reverse
 * scroller only a change between a reader scrolled back and the bottom moves what they see, so that is all this holds:
 * while the reader is off the tail, a change in the list's height leaves the row at the top of their view where it was.
 * Each row's distance from the list's bottom is kept as last laid out, which no scroll changes; the row at the top of
 * the view is found among them at the scroll position now (so a scroll not yet reported counts), and the scroll position
 * moves by as much as that row's distance changed, before the frame is painted. At the tail, the origin follows.
 *
 * Where the scroll position no longer says where the reader was, the place they were last seen does (a scroll event's,
 * or this observer's own): after a resize of the scroller itself (the composer growing, a keyboard, a rotation), which
 * this holds too on such an engine, the view's top being that place plus the box's height then, its row found as the
 * list was laid out, so the rows a rotation rewraps move nothing either; and after a shrink of the list under a reader
 * nearer its oldest edge than the shrink, whom the browser clamps at the edge before this runs. A scroll that arrives
 * while either is not handled yet is left for the observer to judge: without anchoring the browser only leaves a reader
 * at their distance from the bottom or clamps them at the oldest edge, so a resize that finds them anywhere else found
 * a scroll of their own, which stands. A reader at the edge before the shrink stays.
 *
 * A row is an innermost item, not a block: a sender's run is one block holding many items, and an opened run of agent
 * traffic one item holding its lines, each an item of its own. A message arriving in the run the reader is in, or one
 * of its items growing, changes the block or the item from inside, so measured whole it would hold the run's bottom and
 * let the reader's row move. A block with no items in it (a day's separator, a folded quiet run) is its own row.
 */
function useAnchoringFallback(scroller: RefObject<HTMLDivElement | null>, list: RefObject<HTMLOListElement | null>) {
  useLayoutEffect(() => {
    const box = scroller.current;
    const ol = list.current;
    if (!box || !ol || CSS.supports('overflow-anchor', 'auto')) return;
    const fromBottom = (row: Element) => ol.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom;
    let laidOut: Array<[row: Element, fromBottom: number]> = []; // top row first
    let laidOutHeight = ol.offsetHeight;
    let height = box.clientHeight;
    let seen = -box.scrollTop; // the reader's distance from the bottom, when last seen
    const clamped = () => ol.offsetHeight < laidOutHeight && -box.scrollTop >= box.scrollHeight - box.clientHeight - 1;
    const onScroll = () => {
      if (box.clientHeight === height && !clamped()) seen = -box.scrollTop;
    };
    const observer = new ResizeObserver(() => {
      const was = height;
      height = box.clientHeight;
      const now = -box.scrollTop;
      const theirs = height !== was && Math.abs(now - seen) >= 0.5 && !(now < seen && now >= box.scrollHeight - height - 1);
      // The reader's distance from the bottom before this change, and the view's top as the list was laid out.
      const back = height !== was ? seen : clamped() ? Math.max(seen, now) : now;
      if (back >= 1 && !theirs) {
        const top = back + was;
        const anchor = laidOut.find(([row, at]) => at < top && row.isConnected);
        const moved = anchor ? fromBottom(anchor[0]) - anchor[1] : 0;
        const to = Math.max(0, top - height + moved);
        if (Math.abs(to - now) >= 0.5) box.scrollTop = -to;
      }
      // Read after any correction: a base read before the scroll would leave every distance off by it.
      const bottom = ol.getBoundingClientRect().bottom;
      const rows = [...ol.children].flatMap((block) => {
        const items = [...block.querySelectorAll('[data-item]')].filter((item) => !item.querySelector('[data-item]'));
        return items.length > 0 ? items : [block];
      });
      laidOut = rows.map((row) => [row, bottom - row.getBoundingClientRect().bottom]);
      laidOutHeight = ol.offsetHeight;
      seen = -box.scrollTop;
    });
    box.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(box);
    observer.observe(ol);
    return () => {
      observer.disconnect();
      box.removeEventListener('scroll', onScroll);
    };
  }, [scroller, list]);
}

/** One item's wrapper: its kind and log offset for the harness and the suites, and the landing's mark when it is the one. */
function Item({ kind, offset, state, landed, landedRow, children }: { kind: string; offset?: number; state?: string; landed?: boolean; landedRow?: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <div ref={landed ? landedRow : undefined} data-item={kind} data-offset={offset} data-state={state} {...(landed ? { 'data-landed': '', className: 'desk-landed' } : {})}>
      {children}
    </div>
  );
}

function Block({ block, now, workLabel, landed, landedRow }: { block: ChatBlock; now: number; workLabel: string; landed: string | null; landedRow: RefObject<HTMLDivElement | null> }) {
  switch (block.kind) {
    case 'day':
      return <DayRow ts={block.ts} now={now} />;
    case 'run':
      return <Run block={block} landed={landed} landedRow={landedRow} />;
    case 'human':
      return (
        <Item kind="human" offset={block.item.offset} landed={block.item.key === landed} landedRow={landedRow}>
          <Human item={block.item} />
        </Item>
      );
    case 'quiet':
      return <Quiet lines={block.lines} />;
    case 'agents':
      return (
        <Item kind="agents">
          <AgentRun says={block.item.says} />
        </Item>
      );
    case 'work':
      return (
        <Item kind="work">
          <WorkingRecord label={workLabel} />
        </Item>
      );
  }
}

/** A day's label against `now`: Today, Yesterday, else the date (the year with it when it is not this year's). */
export function dayLabel(ts: string, now: number): string {
  const formats = dateFormats();
  if (dayOf(ts) === dayOf(new Date(now).toISOString())) return formats.day(0);
  if (dayOf(ts) === dayOf(new Date(now - 86_400_000).toISOString())) return formats.day(1);
  return formats.shortDate(Date.parse(ts), now);
}

/**
 * The time the day separators are labelled against, one for the stream, changing only when the local day does: it is
 * read again at the next local midnight (a second past, so the new day has begun), and when the page is shown again,
 * since a phone's page sleeps through its timers and may wake on another day. The audit record's lines read it too.
 */
export function useDayClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const untilTomorrow = () => {
      const at = new Date();
      clearTimeout(timer);
      timer = setTimeout(read, new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime() - at.getTime() + 1000);
    };
    const read = () => {
      const at = Date.now();
      // The same day keeps the same value, so the stream draws again only when a label can change.
      setNow((was) => (dayOf(new Date(was).toISOString()) === dayOf(new Date(at).toISOString()) ? was : at));
      untilTomorrow();
    };
    const shown = () => {
      if (document.visibilityState === 'visible') read();
    };
    untilTomorrow();
    document.addEventListener('visibilitychange', shown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', shown);
    };
  }, []);
  return now;
}

/** A day's separator, as the session view's time rows, labelled against the stream's day clock. */
function DayRow({ ts, now }: { ts: string; now: number }) {
  const label = dayLabel(ts, now);
  return (
    <div role="separator" aria-label={label} className="transcript-time" data-testid="day">
      {label}
    </div>
  );
}

/**
 * Who a session's run is from: the alias it went out under, or — when its session has a title — the title, with that
 * alias muted beside it where it differs (`sessionName`); a run of requests alone, by the session as the sidebar names it,
 * or by its id's first eight characters while the sidebar does not know it yet (its `joined` not in the log yet).
 */
function author(from: string | null, session: { title: string | null; alias: string } | undefined, id: string | null): { who: string; alias?: string } {
  const alias = from ?? session?.alias ?? id?.slice(0, 8) ?? '';
  return session?.title && session.title !== alias ? { who: session.title, alias } : { who: session?.title ?? alias };
}

/** A run's header: one line, where a long name (a title) truncates, whole on hover, and the alias, machine and time keep
 * their width. */
function RunHead({ who, alias, machine, ts }: { who: string; alias?: string; machine?: string; ts: string | null }) {
  return (
    <div className="desk-chat-head flex items-baseline gap-2" data-testid="said">
      <span className="min-w-0 truncate text-ui font-semibold text-fg" data-testid="said-who" title={alias ? who : undefined}>
        {who}
      </span>
      {alias && (
        <span className="shrink-0 text-ui-sm text-fg-muted" data-testid="said-alias">
          {alias}
        </span>
      )}
      {machine && <span className="shrink-0 text-ui-sm text-fg-muted">@{machine}</span>}
      {ts && <span className="desk-chat-time shrink-0">{clock(ts)}</span>}
    </div>
  );
}

function Run({ block, landed, landedRow }: { block: Extract<ChatBlock, { kind: 'run' }>; landed: string | null; landedRow: RefObject<HTMLDivElement | null> }) {
  const { connection, sessions } = useDesk();
  const session = block.session ? sessions.get(block.session) : undefined;
  // The machine of a session the sidebar does not know yet is the one its request was raised on.
  const asked = block.items.find((item) => item.kind === 'request')?.ref;
  const raisedOn = useStore(connection.conversation.store, (s) => (asked === undefined ? undefined : s.requests[asked]?.machine));
  return (
    <div className="desk-chat-run" data-testid="run">
      <RunHead {...author(block.from, session, block.session)} machine={session?.machine ?? raisedOn} ts={block.ts} />
      {block.items.map((item) => (
        <Item key={item.key} kind={item.kind} offset={item.kind === 'request' ? undefined : item.offset} landed={item.key === landed} landedRow={landedRow}>
          <RunItemView item={item} />
        </Item>
      ))}
    </div>
  );
}

function RunItemView({ item }: { item: RunItem }) {
  switch (item.kind) {
    case 'message':
      return <Prose text={item.text} />;
    case 'question':
      return <QuestionItem item={item} />;
    case 'request':
      return <RequestCard request={item.ref} embedded />;
  }
}

/** A session's message: MAWS's answer prose. */
function Prose({ text }: { text: string }) {
  return (
    <div className="transcript-answer" data-testid="prose">
      <TranscriptActionsProvider actions={BROWSER_ACTIONS}>
        <Markdown markdown={text} live={false} />
      </TranscriptActionsProvider>
    </div>
  );
}

/**
 * Who posted a `human`: a web one by its member, which its code covers — "You" for the member signed in, another by id
 * (`byWhom`) — and one written on a machine (`<machine>/human`, sminos's own) as a human there.
 */
function humanWho(event: LogEvent, member: string): { who: string; mine: boolean; machine?: string } {
  if (typeof event.member === 'string') {
    const who = byWhom(event.member, member);
    return { who: who.charAt(0).toUpperCase() + who.slice(1), mine: event.member === member };
  }
  return { who: 'A human', mine: false, machine: writerMachine(event.writer) ?? undefined };
}

/**
 * A human's message: the owner's own as MAWS's user bubble on the right, another human's on the left under who they
 * are; where it went as the bubble's foot, and the whole bubble tinted when it reached no one it was meant for.
 */
function Human({ item }: { item: HumanItem }) {
  const { connection, member } = useDesk();
  const { who, mine, machine } = humanWho(item.event, member);
  const outcomes = useStore(connection.conversation.store, (s) => s.deliveries[deliveryKey({ writer: item.event.writer, seq: item.event.seq })]);
  const state = item.to === '*' ? 'record' : sendState(item.to.map((r) => outcomes?.[r.session]?.outcome ?? null));
  return (
    <Bubble
      className="desk-chat-send"
      aria-label={mine ? 'Your message' : `${who}’s message`}
      data-side={mine ? 'you' : 'other'}
      data-state={state}
      text={item.text}
      at={item.event.ts}
      head={mine ? undefined : <RunHead who={who} machine={machine} ts={item.event.ts} />}
      foot={<HumanEnds event={item.event} to={item.to} wake={item.wake} outcomes={outcomes} />}
    />
  );
}

/**
 * Where a send stands by its recipients' outcomes: tinted only when it reached none of them, every machine having held
 * it back or failed, and failed when any failed, since a failure is what the owner may have to act on.
 */
function sendState(outcomes: Array<string | null>): string {
  if (outcomes.length === 0) return 'record';
  if (outcomes.some((o) => o === null)) return 'pending';
  if (outcomes.every((o) => o === 'delivered')) return 'delivered';
  if (outcomes.every((o) => o === 'recorded' || o === 'refused-read-only' || o === 'failed')) return outcomes.includes('failed') ? 'failed' : 'held';
  return 'mixed';
}

/**
 * Where a `human` went, as the bubble's foot: a copy of one sent into other projects names each project and its
 * recipients there, and has no delivery outcome of its own (the delivering event in that project's log has them); any
 * other, its recipients' outcomes, and its origin when it came from another project.
 */
function HumanEnds({ event, to, wake, outcomes }: { event: LogEvent; to: '*' | Recipient[]; wake: boolean; outcomes: Record<string, { outcome: string; reason: string }> | undefined }) {
  const { connection } = useDesk();
  const name = useProjectName();
  const other = crossProject(event, connection.project);
  if (other !== null && 'to' in other) {
    const aliases = (project: string | null) =>
      to === '*' ? 'record' : to.filter((r) => project === null || (r as { project?: unknown }).project === project).map((r) => r.alias).join(', ');
    // One destination takes every recipient, as a copy of one project's event always did.
    const ends = other.to.length === 1 ? [`${name(other.to[0])}: ${aliases(null)}`] : other.to.map((p) => `${name(p)}: ${aliases(p)}`);
    return (
      <div className="desk-delivery-foot" data-testid="cross-project">
        → {ends.join(' · ')}
      </div>
    );
  }
  return (
    <>
      {other !== null && (
        <div className="desk-delivery-foot" data-testid="cross-project">
          from {name(other.from)}
        </div>
      )}
      <Deliveries to={to} broadcast={wake ? broadcastLabel(event.scope, name) : null} outcomes={outcomes} />
    </>
  );
}

/**
 * Each recipient's DX4 delivery outcome for a `human` this browser can see, kept by the hub across a reload: a glyph
 * (the stylesheet's, by outcome), the alias and the words. An outcome other than delivered carries the machine's reason
 * on its line (why it was only recorded, held back, or failed); a delivered one keeps it on hover. A broadcast first
 * says whom it named (`broadcast`: `@all`, or its scope's label), its recipients being who that was at sending.
 */
function Deliveries({ to, broadcast, outcomes }: { to: '*' | Recipient[]; broadcast: string | null; outcomes: Record<string, { outcome: string; reason: string }> | undefined }) {
  if (to === '*')
    return (
      <div className="desk-delivery-foot" data-testid="record">
        Recorded · delivered to no one
      </div>
    );
  return (
    <ul className="desk-delivery-foot desk-chat-deliveries" data-testid="deliveries">
      {broadcast !== null && <li data-wake="">{broadcast} at sending</li>}
      {to.map((r) => {
        // The latest outcome per recipient: a `recorded` one turns `delivered` when Resume brings the session back.
        const delivery = outcomes?.[r.session];
        const outcome = delivery?.outcome as keyof typeof DELIVERY_TEXT | undefined;
        const reason = delivery?.reason || null;
        return (
          <li key={r.session} data-recipient={r.session} data-outcome={outcome ?? 'pending'} title={reason ?? undefined}>
            {r.alias}: {outcome ? DELIVERY_TEXT[outcome] : 'not delivered yet'}
            {reason && outcome !== 'delivered' && <span className="desk-chat-reason" data-testid="delivery-reason">{` — ${reason}`}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The text doperpowers' ask mod returns for an ask answered with nothing (`answerText` in its `hooks/mods/ask.tsx`), which
 * sminos records as the `answered` event's text.
 */
const NONE_ANSWERED = 'The user did not answer the questions.';

/**
 * A session's question: its request card while a request for it is pending here (answerable in place, as at the
 * session view's tail); else MAWS's question receipt, one line per question reading "header (or the question) →
 * answer", the answers read from the log's `answered` with MAWS's own reader of the engine's summary, the headers from
 * the request where this browser saw it; a question not yet answered says what it waits for, or how its request was
 * settled without an answer.
 *
 * A line never holds text the reader did not parse, and never says "Not answered" of a question that was. An answer in
 * another shape (MAWS's own steer, one line per question) reads "answered" on each line, the text whole in the foot; a
 * summary that names some of the questions answered those alone, as the engine writes only the answers given. A request
 * settled as answered whose `answered` event has not arrived yet reads "answered", its foot saying where.
 */
function QuestionItem({ item }: { item: Extract<StreamItem, { kind: 'question' }> }) {
  const { connection, member } = useDesk();
  const record = useStore(connection.conversation.store, (s) => s.requests[item.ref]) as RequestRecord | undefined;
  if (record?.pending && !item.answered) return <RequestCard request={item.ref} embedded />;
  const raised = record ? questionsOf(record.raised).map((q) => ({ question: q.question, header: q.header })) : [];
  const questions = raised.length > 0 ? raised : item.questions.map((question) => ({ question, header: '' }));
  const text = item.answered?.text ?? null;
  const read = text === null ? null : askModAnswers(questions, { content: text, isError: false });
  const parsed = read !== null && Object.keys(read).length > 0 ? read : null;
  const settled = record?.settled ?? null;
  const waiting = text === null && settled === null;
  // What a line reads when no answer to its question was read.
  const unread =
    text !== null
      ? parsed !== null || text.trim() === NONE_ANSWERED
        ? 'Not answered'
        : 'answered'
      : settled !== null
        ? settled.outcome === 'answered'
          ? 'answered'
          : 'Not answered'
        : 'waiting';
  const foot =
    text !== null
      ? unread === 'answered'
        ? `Answered: ${text}`
        : null
      : settled !== null
        ? settledText(settled.winner, settled.outcome, settled.by, member)
        : 'Waiting for an answer';
  return (
    <section className="transcript-question desk-chat-question" aria-label="Question" data-testid="question" data-waiting={waiting ? '' : undefined}>
      <ul className="transcript-question-lines">
        {questions.map(({ question, header }) => {
          const answer = parsed?.[question];
          return (
            <li key={question} className="transcript-question-line" title={question}>
              <span className="transcript-question-label" data-long={header ? undefined : ''}>
                {header || question}
              </span>
              <span className="transcript-question-arrow" aria-hidden="true">
                →
              </span>
              <span className="transcript-question-answer" data-answer={answer === undefined ? 'none' : ''}>
                {answer ?? unread}
              </span>
            </li>
          );
        })}
      </ul>
      {foot !== null && (
        <div className="desk-question-foot" data-waiting={waiting ? '' : undefined} data-testid={waiting ? 'question-waiting' : 'question-settled'}>
          {foot}
        </div>
      )}
    </section>
  );
}

/**
 * A quiet run: a session's consecutive lifecycle events on one muted line, its words joined; a run of more than a few
 * lines folds behind their count and who they are about, and opens in place.
 */
function Quiet({ lines }: { lines: QuietLine[] }) {
  const [open, setOpen] = useState(false);
  const folded = lines.length > QUIET_SHOWN && !open;
  const list = (shown: QuietLine[]) => (
    <ul className="desk-chat-quiet" data-testid="quiet">
      {shown.map((line) => (
        <li key={line.key} data-item="system" data-offset={line.says[0].offset}>
          <span className="desk-chat-quiet-subject">{line.subject}</span>{' '}
          {line.says.map((say, i) => (
            <span key={say.offset} data-offset={say.offset}>
              {i > 0 && <span className="desk-chat-quiet-dot" aria-hidden="true">{' · '}</span>}
              {say.text}
            </span>
          ))}
          <span className="desk-chat-time"> {clock(line.ts)}</span>
        </li>
      ))}
    </ul>
  );
  if (lines.length <= QUIET_SHOWN) return list(lines);
  const who = [...new Set(lines.map((l) => l.subject))];
  const count = lines.reduce((n, l) => n + l.says.length, 0);
  return (
    <div className="desk-chat-quiet-run" data-testid="quiet-run">
      <button type="button" className="transcript-disclosure" aria-expanded={!folded} onClick={() => setOpen((o) => !o)}>
        <Chevron />
        {count} updates · {who.join(', ')}
        <span className="desk-chat-time">
          {clock(lines[0].ts)}–{clock(lines.at(-1)!.ts)}
        </span>
      </button>
      {!folded && list(lines)}
    </div>
  );
}

/** MAWS's disclosure chevron, drawn here so the chat's chunk carries none of the transcript's row pieces. */
function Chevron() {
  return (
    <svg className="transcript-chevron" viewBox="0 0 12 12" aria-hidden="true">
      <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Where a message from or to another project went (the org directory's §6): the sender's copy names its destinations
 * (`→ <project>, …`, as sminos's `chat` does), the delivering event its origin (`from <project>`), each by the name the
 * grid shows.
 */
function CrossProject({ event }: { event: LogEvent }) {
  const { connection } = useDesk();
  const name = useProjectName();
  const other = crossProject(event, connection.project);
  if (other === null) return null;
  return (
    <span className="desk-chat-elsewhere" data-testid="cross-project">
      {'to' in other ? `→ ${other.to.map(name).join(', ')}` : `from ${name(other.from)}`}
    </span>
  );
}

/**
 * One run of agent-to-agent traffic, as MAWS draws a message between sessions: a lifecycle line with the bubble mark. A
 * run of one is the line itself; more fold behind their count, their participants and their span, and open in place.
 */
function AgentRun({ says }: { says: Array<{ offset: number; event: LogEvent }> }) {
  const [open, setOpen] = useState(false);
  const name = useProjectName();
  const line = (event: LogEvent) => {
    const to = event.to === '*' ? 'record' : Array.isArray(event.to) ? (event.wake ? broadcastLabel(event.scope, name) : event.to.map((r) => str((r as { alias?: unknown }).alias)).join(', ')) : '';
    return (
      <>
        <span className="transcript-peer-who">{str(event.from)}</span> → <span className="transcript-peer-who">{to}</span>
        <CrossProject event={event} />
        <span className="desk-chat-time"> {clock(event.ts)}</span>
        <span className="desk-chat-said"> {str(event.text)}</span>
      </>
    );
  };
  if (says.length === 1)
    return (
      <div className="transcript-peer" data-testid="agent-run">
        <div className="transcript-lifecycle">
          <MessageIcon />
          <span className="transcript-peer-text">{line(says[0].event)}</span>
        </div>
      </div>
    );
  const who = [...new Set(says.map((s) => str(s.event.from)))];
  return (
    <div className="transcript-peer" data-testid="agent-run">
      <div className="transcript-lifecycle">
        <MessageIcon />
        <button type="button" className="transcript-disclosure desk-chat-agents" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Chevron />
          {says.length} messages between agents · {who.join(', ')}
          <span className="desk-chat-time">
            {clock(says[0].event.ts)}–{clock(says.at(-1)!.event.ts)}
          </span>
        </button>
      </div>
      {open && (
        <ul className="desk-chat-says" data-testid="agent-run-messages">
          {says.map((s) => (
            <li key={s.offset} data-item="say" data-offset={s.offset}>
              {line(s.event)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A direct channel's working record where this stream is drawn — a machine that is offline, a session whose machine
 * serves no transcript — as a label, never a button: wherever the machine serves the transcript, phone or desktop, the
 * channel is the session view, where the working record is MAWS's own per turn (the composite's §9.1).
 */
function WorkingRecord({ label }: { label: string }) {
  return (
    <p className="desk-chat-work" data-testid="working-record">
      Working record · {label}
    </p>
  );
}
