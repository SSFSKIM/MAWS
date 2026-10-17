// A channel's stream as rows (§4): a session's message (its text through MAWS's Markdown), what a human posted with
// each recipient's delivery outcome (DX4), a question with its choices — answerable in place while its request is
// pending — and its answer, lifecycle as system lines, agent-to-agent traffic folded into one row per run (a run of one
// drawn whole on one line), a direct channel's working record folded (unfolded, DC6's transcript slot), the requests
// in place, and this tab's sends on their way to the log. The item a tapped notification landed on is marked and
// scrolled to once it is drawn. On a phone the working record stays folded: the transcript is desktop-only (§4).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useStore } from 'zustand';
import { writerMachine, type LogEvent, type Recipient } from 'desk-hub/protocol';
import { TranscriptActionsProvider, type TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import { Markdown } from '../../../../../src/renderer/src/transcript/view/markdown/Markdown';
import { byWhom, type StreamItem } from '../../conversation/stream';
import { deliveryKey, type OutboxItem } from '../../project/conversation';
import { useSlot } from '../../shell/slots';
import { DELIVERY_TEXT } from '../../conversation/words';
import { useNarrow } from '../../shell/viewport';
import { RequestCard } from '../requests/RequestCard';
import { useDesk } from './desk-context';

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const time = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * The stream scrolls as a chat list does: a `column-reverse` scroller whose one child is the list in reading order, so
 * the bottom is the scroll origin. The browser then keeps the tail itself (the scroll position stays 0 at the bottom as
 * rows are added below), a change above a reader who has scrolled back moves nothing they see (it lies at the far end
 * from the origin), and its own scroll anchoring holds them in place when a row below them arrives or grows. Nothing
 * here measures or anchors, except on an engine without scroll anchoring (`useAnchoringFallback`): it opens at the tail
 * because the origin is the tail, and a landing scrolls its card into view. The scroll position reads 0 at the bottom
 * and negative upward (Chrome, Safari, Firefox).
 */
export function StreamView({ items, outbox, landed = null }: { items: StreamItem[]; outbox: OutboxItem[]; landed?: string | null }) {
  const landedRow = useRef<HTMLLIElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  useAnchoringFallback(scroller, list);
  // A landing decides where the reader is: scrolled to its card.
  useEffect(() => landedRow.current?.scrollIntoView({ block: 'center' }), [landed]);
  return (
    <div ref={scroller} className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto" data-testid="channel-events">
      <ol ref={list} className="m-0 list-none px-4 py-3">
        {items.length === 0 && outbox.length === 0 && <li className="text-ui-sm text-fg-muted">Nothing here yet.</li>}
        {items.map((item) => (
          <li
            key={item.key}
            ref={item.key === landed ? landedRow : undefined}
            data-item={item.kind}
            {...('offset' in item && item.kind !== 'work' ? { 'data-offset': item.offset } : {})}
            {...(item.key === landed ? { 'data-landed': '', className: '-mx-2 rounded-md bg-bg-waiting px-2 outline-1 outline-warning outline-solid' } : {})}
          >
            <Item item={item} />
          </li>
        ))}
        {outbox.map((sent) => (
          <li key={sent.nonce} data-item="outbox" data-state={sent.state}>
            <Said who="You" ts={null}>
              <Prose text={sent.text} />
              <p className={`m-0 text-ui-sm ${sent.state === 'refused' ? 'text-danger' : 'text-fg-muted'}`}>{sent.state === 'refused' ? `The hub refused it (${sent.reason}); it was not sent.` : 'Sending…'}</p>
            </Said>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Scroll anchoring for an engine that has none: Safari before 27, where `overflow-anchor` does not parse (WebKit gates
 * the property and the anchoring on one setting, so supporting the one is having the other). In the column-reverse
 * scroller only a change between a reader scrolled back and the bottom moves what they see, so that is all this holds:
 * while the reader is off the tail, a change in the list's height leaves the row at the top of their view where it was.
 * Each row's distance from the list's bottom is kept as last laid out, which no scroll changes; the row at the top of
 * the view is found among them at the scroll position now (so a scroll not yet reported counts), and the scroll position
 * moves by as much as that row's distance changed, before the frame is painted. At the tail, the origin follows. A list
 * that shrank has the browser clamp a reader at its oldest edge before this runs; they are left there, at the edge.
 */
function useAnchoringFallback(scroller: RefObject<HTMLDivElement | null>, list: RefObject<HTMLOListElement | null>) {
  useLayoutEffect(() => {
    const box = scroller.current;
    const ol = list.current;
    if (!box || !ol || CSS.supports('overflow-anchor', 'auto')) return;
    const fromBottom = (row: Element) => ol.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom;
    let laidOut: Array<[row: Element, fromBottom: number]> = []; // top row first
    const observer = new ResizeObserver(() => {
      const back = -box.scrollTop;
      if (back >= 1) {
        const anchor = laidOut.find(([row, was]) => was < back + box.clientHeight && row.isConnected);
        const moved = anchor ? fromBottom(anchor[0]) - anchor[1] : 0;
        if (moved > 0 || (moved < 0 && back < box.scrollHeight - box.clientHeight - 1)) box.scrollTop -= moved;
      }
      // Read after any correction: a base read before the scroll would leave every distance off by it.
      const bottom = ol.getBoundingClientRect().bottom;
      laidOut = [...ol.children].map((row) => [row, bottom - row.getBoundingClientRect().bottom]);
    });
    observer.observe(ol);
    return () => observer.disconnect();
  }, [scroller, list]);
}

/**
 * Who posted a `human`: a web one by its member, which its code covers — "You" for the member signed in, another by id
 * (`byWhom`) — and one written on a machine (`<machine>/human`, sminos's own) as a human there.
 */
function humanWho(event: LogEvent, member: string): { who: string; machine?: string } {
  if (typeof event.member === 'string') {
    const who = byWhom(event.member, member);
    return { who: who.charAt(0).toUpperCase() + who.slice(1) };
  }
  return { who: 'A human', machine: writerMachine(event.writer) ?? undefined };
}

function Item({ item }: { item: StreamItem }) {
  const { sessions, member } = useDesk();
  switch (item.kind) {
    case 'message': {
      const session = item.session ? sessions.get(item.session) : undefined;
      return (
        <Said who={item.from} machine={session?.machine} ts={item.event.ts}>
          <Prose text={item.text} />
        </Said>
      );
    }
    case 'human': {
      const { who, machine } = humanWho(item.event, member);
      return (
        <Said who={who} machine={machine} ts={item.event.ts}>
          <Prose text={item.text} />
          <Deliveries event={item.event} to={item.to} wake={item.wake} />
        </Said>
      );
    }
    case 'question':
      return <QuestionItem item={item} />;
    case 'system':
      return <p className="m-0 py-1 text-ui-sm text-fg-muted">{item.text}</p>;
    case 'agents':
      return <AgentRun says={item.says} />;
    case 'work':
      return <WorkingRecord session={item.session} range={item.range} />;
    case 'request':
      return <RequestItem request={item.ref} />;
  }
}

/** A request that is not a log event, drawn as the session's own message with the card as its body. `request`: its key. */
function RequestItem({ request }: { request: string }) {
  const { connection, sessions } = useDesk();
  const record = useStore(connection.conversation.store, (s) => s.requests[request]);
  if (!record) return null;
  const session = sessions.get(record.raised.session);
  return (
    <Said who={session?.alias ?? record.raised.session.slice(0, 8)} machine={record.machine} ts={null}>
      <RequestCard request={request} embedded />
    </Said>
  );
}

function Said({ who, machine, ts, children }: { who: string; machine?: string; ts: string | null; children: React.ReactNode }) {
  return (
    <div className="py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-ui font-semibold" data-testid="said-who">{who}</span>
        {machine && <span className="text-ui-sm text-fg-muted">@{machine}</span>}
        {ts && <span className="text-ui-sm text-fg-faint">{time(ts)}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * What MAWS's Markdown does with a link here: a web link opens in a new tab with no opener and no referrer (the page
 * never navigates away from the desk); a path chip names a file on the session's machine, which the browser cannot open.
 */
const BROWSER_ACTIONS: Partial<TranscriptActions> = {
  openExternal: (url) => void window.open(url, '_blank', 'noopener,noreferrer'),
};

function Prose({ text }: { text: string }) {
  return (
    <div className="font-prose text-prose leading-[var(--lh-prose)]" data-testid="prose">
      <TranscriptActionsProvider actions={BROWSER_ACTIONS}>
        <Markdown markdown={text} live={false} />
      </TranscriptActionsProvider>
    </div>
  );
}

/** Each recipient's DX4 delivery outcome for a `human` this browser can see, kept by the hub across a reload. */
function Deliveries({ event, to, wake }: { event: LogEvent; to: '*' | Recipient[]; wake: boolean }) {
  const { connection } = useDesk();
  const outcomes = useStore(connection.conversation.store, (s) => s.deliveries[deliveryKey({ writer: event.writer, seq: event.seq })]);
  if (to === '*') return <p className="m-0 text-ui-sm text-fg-faint">A record: delivered to no one</p>;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-3 p-0 text-ui-sm" data-testid="deliveries">
      {wake && <li className="text-fg-faint">@all at sending</li>}
      {to.map((r) => {
        // The latest outcome per recipient: a `recorded` one turns `delivered` when Resume brings the session back.
        const delivery = outcomes?.[r.session];
        const outcome = delivery?.outcome;
        const tone = outcome === 'delivered' ? 'text-fg-muted' : outcome === 'uncertain' ? 'text-fg-muted italic' : outcome ? 'text-warning' : 'text-fg-faint';
        return (
          <li key={r.session} data-recipient={r.session} data-outcome={outcome ?? 'pending'} className={tone}>
            {r.alias}: {outcome ? DELIVERY_TEXT[outcome] : 'not delivered yet'}
          </li>
        );
      })}
    </ul>
  );
}

function QuestionItem({ item }: { item: Extract<StreamItem, { kind: 'question' }> }) {
  const { connection, sessions } = useDesk();
  const pending = useStore(connection.conversation.store, (s) => s.requests[item.ref]);
  const session = item.session ? sessions.get(item.session) : undefined;
  return (
    <Said who={item.from} machine={session?.machine} ts={item.event.ts}>
      {pending && !item.answered ? (
        <RequestCard request={item.ref} embedded />
      ) : (
        <>
          <Prose text={item.text} />
          {item.choices.length > 0 && <p className="m-0 text-ui-sm text-fg-muted">{item.choices.join(' · ')}</p>}
        </>
      )}
      {item.answered ? (
        <p className="m-0 text-ui-sm text-fg-muted" data-testid="answered">
          Answered: {item.answered.text}
        </p>
      ) : (
        !pending && <p className="m-0 text-ui-sm text-warning">Open question</p>
      )}
    </Said>
  );
}

/** One run of agent-to-agent traffic: a run of one on one line; more fold behind a count, its participants, and its span. */
function AgentRun({ says }: { says: Array<{ offset: number; event: LogEvent }> }) {
  const [open, setOpen] = useState(false);
  const line = (event: LogEvent) => {
    const to = event.to === '*' ? 'record' : Array.isArray(event.to) ? (event.wake ? '@all' : event.to.map((r) => str((r as { alias?: unknown }).alias)).join(', ')) : '';
    return (
      <>
        <span className="text-fg">{str(event.from)}</span> → <span>{to}</span>
        <span className="ml-1.5 text-fg-faint">{time(event.ts)}</span>
        <span className="ml-1.5 text-fg">{str(event.text)}</span>
      </>
    );
  };
  if (says.length === 1)
    return (
      <p className="m-0 truncate py-1 text-ui-sm text-fg-muted" data-testid="agent-run">
        {line(says[0].event)}
      </p>
    );
  const who = [...new Set(says.map((s) => str(s.event.from)))];
  return (
    <div className="py-1 text-ui-sm text-fg-muted" data-testid="agent-run">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-sm px-1 -mx-1 hover:bg-bg-hover hover:text-fg">
        {open ? '▾' : '▸'} {says.length} messages between agents · {who.join(', ')} · {time(says[0].event.ts)}–{time(says.at(-1)!.event.ts)}
      </button>
      {open && (
        <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 border-l border-border pl-3" data-testid="agent-run-messages">
          {says.map((s) => (
            <li key={s.offset} data-offset={s.offset}>
              {line(s.event)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A direct channel's working record, folded as the to-human mod folds it; unfolded, DC6's live transcript. */
function WorkingRecord({ session, range }: { session: string; range: { from: string | null; to: string | null } }) {
  const { connection, sessions } = useDesk();
  const [open, setOpen] = useState(false);
  const Transcript = useSlot('transcript');
  const desk = sessions.get(session);
  const narrow = useNarrow();
  if (narrow)
    return (
      <p className="m-0 py-1 text-ui-sm text-fg-faint" data-testid="working-record">
        Working record · on a computer
      </p>
    );
  return (
    <div className="py-1 text-ui-sm text-fg-muted">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-sm border border-border px-2 py-0.5 hover:bg-bg-hover hover:text-fg" data-testid="working-record" data-from={range.from ?? ''} data-to={range.to ?? ''}>
        [ working record ]
      </button>
      {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
      {open && desk && <div className="mt-2"><Transcript project={connection.project} session={desk} plane={connection.client} range={range} /></div>}
    </div>
  );
}
