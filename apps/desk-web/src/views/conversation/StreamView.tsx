// A channel's stream as rows (§4): a session's message (its text through MAWS's Markdown), what a human posted with
// each recipient's delivery outcome (DX4), a question with its choices — answerable in place while its request is
// pending — and its answer, lifecycle as system lines, agent-to-agent traffic folded into one row per run (a run of one
// drawn whole on one line), a direct channel's working record folded (unfolded, DC6's transcript slot), the requests
// in place, and this tab's sends on their way to the log. The item a tapped notification landed on is marked and
// scrolled to once it is drawn. On a phone the working record stays folded: the transcript is desktop-only (§4).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** How close to the bottom, in pixels, a reader counts as reading the tail. */
const TAIL_SLACK = 48;

/**
 * Keeps a scrolled list at its tail while the reader is there: it opens at the tail, and whatever is added or grows
 * below (a message, a card, Markdown drawn late) keeps it there; once the reader scrolls up, or a landing scrolls to its
 * card, it stays where it was put until the reader returns to the bottom.
 *
 * Whether the reader is at the tail is judged at each change, from the scroll position as it is now against the list as
 * it was last measured (its content height and its own height before this change), never from the last scroll event:
 * the browser delivers that a frame late, so a scroll to the bottom followed at once by a new row (desktop Chrome, 9 ms
 * apart) would read as the reader not being there.
 */
function useTail(items: StreamItem[], outbox: OutboxItem[], landed: string | null) {
  const list = useRef<HTMLOListElement>(null);
  const landedRow = useRef<HTMLLIElement>(null);
  /** The list as last measured: null before the first change, which opens at the tail. */
  const measured = useRef<{ content: number; box: number } | null>(null);
  // What was added moves the tail, before it is painted.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const was = measured.current;
    if (was === null || was.content - el.scrollTop - was.box <= TAIL_SLACK) el.scrollTop = el.scrollHeight;
    measured.current = { content: el.scrollHeight, box: el.clientHeight };
  }, [items, outbox]);
  // Rows that grow after they are drawn (Markdown loaded late, a card's preview), and the list's own box (the composer
  // growing beneath it), move it too.
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const was = measured.current;
      if (was === null || was.content - el.scrollTop - was.box <= TAIL_SLACK) el.scrollTop = el.scrollHeight;
      measured.current = { content: el.scrollHeight, box: el.clientHeight };
    });
    observer.observe(el);
    for (const row of el.children) observer.observe(row);
    return () => observer.disconnect();
  }, [items, outbox]);
  // A landing decides where the reader is: scrolled to its card, the reader is no longer at the tail.
  useEffect(() => {
    landedRow.current?.scrollIntoView({ block: 'center' });
  }, [landed]);
  return { list, landedRow };
}

export function StreamView({ items, outbox, landed = null }: { items: StreamItem[]; outbox: OutboxItem[]; landed?: string | null }) {
  const { list, landedRow } = useTail(items, outbox, landed);
  return (
    <ol ref={list} className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-4 py-3" data-testid="channel-events">
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
  );
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
