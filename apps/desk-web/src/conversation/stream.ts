// A channel's stream (§4), from verified log events and the requests the browser has seen. The group chat shows what
// is addressed to the human: messages, questions (with their answer once given), what humans posted, and lifecycle as
// system lines; traffic between agents (`say`) folds into one row per run, a run being the says with no other row
// between them. A direct channel is one session's exchange with the human — its messages and questions, what humans
// sent it, its own lifecycle — with the agent traffic it took part in folded the same way, and its working record
// folded before each of its messages (the unfolded transcript is DC6's slot). A request (a permission prompt or a
// question that is not a log event) sits after the log entry the browser held when it first saw it; an async question's
// request is drawn on its `question` event, whose `src` is the call's id.
//
// `status` lines are drawn as set. `state` events are the daemon's record of a session's liveness and recur as it
// moves between busy, idle, and waiting, so only a change between running (busy, idle, waiting) and not running
// (stopped, gone, vacant, retired) is drawn — a session that stopped, or runs again — and the sidebar's presence says
// the rest. A session is taken as running from its `joined` (and before any event says otherwise).
//
// Each working-record fold carries its bounds for DX8's `transcript` slot: the `src` of the session's exchange item
// before it and of the one after it (a `<message>` span's `<row uuid>#<span index>`; a question's call id), null for
// an open end; a live session's channel ends with an open-ended fold after its last item.
import { writerMachine, type LogEvent, type Raised, type Recipient } from 'desk-hub/protocol';
import { requestKey } from '../project/conversation';
import type { Channel } from '../shell/layout';
import { isQuestion } from './card-state';

export type Entry = { offset: number; event: LogEvent };

export type StreamItem =
  | { kind: 'message'; key: string; offset: number; event: LogEvent; session: string | null; from: string; text: string }
  | { kind: 'human'; key: string; offset: number; event: LogEvent; text: string; to: '*' | Recipient[]; wake: boolean }
  /** `request`: the call's id (the event's `src`); `ref`: the key of the request raised for it, if any (`requestKey`). */
  | { kind: 'question'; key: string; offset: number; event: LogEvent; session: string | null; from: string; text: string; choices: string[]; request: string; ref: string; answered: { text: string; event: LogEvent } | null }
  | { kind: 'system'; key: string; offset: number; event: LogEvent; text: string }
  | { kind: 'agents'; key: string; says: Entry[] }
  | { kind: 'work'; key: string; offset: number; session: string; range: { from: string | null; to: string | null } }
  /** `request`: the request's id; `ref`: its key in the conversation's `requests`. */
  | { kind: 'request'; key: string; request: string; ref: string };

/**
 * A request as the stream places it: `key` is its key in the conversation's `requests` (machine, session, id); `at`
 * is the offset of the last log entry the browser held when it first saw it; `question` whether it is a question (an exchange item, so it bounds the working record: a native one has no
 * `question` event to do it); `call` the transcript's tool-use id of the call it belongs to, the bound a question
 * gives the working record (its `request` when absent).
 */
export type PlacedRequest = { key: string; request: string; session: string; at: number; question?: boolean; call?: string };

/**
 * A request the browser holds, placed: a raised request names its transcript call as `toolUseId ?? request` (DX4,
 * composite 43a27604) — `toolUseId` is there only where the two differ, as for the ask mod's blocking question, raised
 * under the engine dialog's id while the transcript holds the outer call. Decisions and answers still go to `request`.
 */
export function placedRequest(record: { key: string; request: string; raised: Raised; at: number }): PlacedRequest {
  return { key: record.key, request: record.request, session: record.raised.session, at: record.at, question: isQuestion(record.raised.tool), call: record.raised.toolUseId ?? record.request };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const recipients = (to: unknown): Recipient[] =>
  Array.isArray(to) ? to.filter((r): r is Recipient => typeof r === 'object' && r !== null && typeof (r as Recipient).session === 'string') : [];
const addressedTo = (event: LogEvent, session: string) => recipients(event.to).some((r) => r.session === session);
/** The session a writer stands for: `<machine>/<session uuid>`; null for `hub/`, a machine's `human`, `legacy/`. */
export const writerSession = (writer: string): string | null => {
  const id = writer.slice(writer.indexOf('/') + 1);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
};

/** The key of the request a session's `question` event was raised as: its writer's machine and session, and its `src`. */
const questionRef = (event: LogEvent): string =>
  requestKey({ machine: writerMachine(event.writer) ?? '', session: writerSession(event.writer) ?? '', request: str(event.src) });

/** A web member's id (DX7: 128 bits as 32 lowercase hex), which `retired` and spawn's `joined` record as `by`. */
const MEMBER_ID = /^[0-9a-f]{32}$/;

/** Who `by` names: you, another member of the org (by its id: the browser holds no member list), or what sminos wrote. */
export function byWhom(by: string, member: string | null): string {
  if (member !== null && by === member) return 'you';
  if (MEMBER_ID.test(by)) return `another member (${by.slice(0, 8)})`;
  return by;
}

function systemText(event: LogEvent, alias: (id: unknown) => string, member: string | null): string | null {
  switch (event.kind) {
    case 'joined':
      return `${alias(event.session)} joined on ${str(event.machine)}`;
    case 'retired':
      return `${alias(event.session)} ${event.reason === 'ended' ? 'ended' : 'retired'}${str(event.by) ? ` by ${byWhom(str(event.by), member)}` : ''}`;
    case 'renamed':
      return `${alias(event.session)} is now ${str(event.alias)}`;
    case 'in-charge':
      return `${alias(event.session)} is in charge of: ${str(event.text)}`;
    case 'status':
      return str(event.text) ? `${alias(event.session)} status: ${str(event.text)}` : `${alias(event.session)} cleared its status`;
    default:
      return null;
  }
}

/** Whether an event belongs in the channel at all. */
function inChannel(event: LogEvent, channel: Channel): boolean {
  if (channel.kind === 'group') return true;
  const s = channel.session;
  switch (event.kind) {
    case 'human':
      return addressedTo(event, s);
    case 'say':
      return writerSession(event.writer) === s || addressedTo(event, s);
    case 'message':
    case 'question':
      return writerSession(event.writer) === s;
    case 'joined':
    case 'retired':
    case 'renamed':
    case 'in-charge':
    case 'status':
    case 'state':
      return event.session === s;
    default:
      return false;
  }
}

const RUNNING = new Set(['busy', 'idle', 'waiting']);

/**
 * `live`: the direct channel's session is running now, so its working record goes on past its last item. `member`: the
 * signed-in member, named "you" where an event records it as `by`.
 */
export function buildStream(
  channel: Channel,
  entries: readonly Entry[],
  aliases: ReadonlyMap<string, string>,
  requests: readonly PlacedRequest[],
  options: { live?: boolean; member?: string } = {},
): StreamItem[] {
  const alias = (id: unknown) => (typeof id === 'string' ? (aliases.get(id) ?? id.slice(0, 8)) : '');
  const shown = entries.filter((e) => inChannel(e.event, channel));
  // A question's answer, wherever its channel draws it (a direct channel does not draw `answered` on its own).
  const answers = new Map<string, Entry>();
  for (const e of entries) if (e.event.kind === 'answered' && str(e.event.src)) answers.set(str(e.event.src), e);
  const questionCalls = new Set(shown.filter((e) => e.event.kind === 'question').map((e) => str(e.event.src)));
  const questionRefs = new Set(shown.filter((e) => e.event.kind === 'question').map((e) => questionRef(e.event)));
  const placed = requests
    .filter((r) => (channel.kind === 'group' || r.session === channel.session) && !questionRefs.has(r.key))
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => a.at - b.at || a.i - b.i);

  const items: StreamItem[] = [];
  let run: Entry[] = [];
  let next = 0;
  const flush = () => {
    if (run.length > 0) items.push({ kind: 'agents', key: `agents:${run[0].offset}`, says: run });
    run = [];
  };
  const push = (item: StreamItem) => {
    flush();
    items.push(item);
  };
  /** The `src` of the channel's session's last exchange item: where the next working-record fold begins. */
  let lastSrc: string | null = null;
  const workBefore = (key: string, offset: number, session: string | null, src: string) => {
    if (channel.kind !== 'session' || session !== channel.session) return;
    push({ kind: 'work', key, offset, session, range: { from: lastSrc, to: src || null } });
    lastSrc = src || null;
  };
  const placeUpTo = (offset: number) => {
    while (next < placed.length && placed[next].at < offset) {
      const r = placed[next];
      // A question with no `question` event (a native one) is the exchange item that bounds the working record.
      if (r.question) workBefore(`work:request:${r.key}`, r.at, r.session, r.call ?? r.request);
      push({ kind: 'request', key: `request:${r.key}`, request: r.request, ref: r.key });
      next++;
    }
  };
  /** Whether each session is running, as its `joined` and `state` events say: only a change is drawn. */
  const running = new Map<string, boolean>();

  for (const entry of shown) {
    const { offset, event } = entry;
    placeUpTo(offset);
    const key = `${event.kind}:${offset}`;
    switch (event.kind) {
      case 'say':
        run.push(entry);
        break;
      case 'human':
        push({ kind: 'human', key, offset, event, text: str(event.text), to: event.to === '*' ? '*' : recipients(event.to), wake: event.wake === true });
        break;
      case 'message': {
        const session = writerSession(event.writer);
        workBefore(`work:${offset}`, offset, session, str(event.src));
        push({ kind: 'message', key, offset, event, session, from: str(event.from), text: str(event.text) });
        break;
      }
      case 'question': {
        const session = writerSession(event.writer);
        const answer = answers.get(str(event.src));
        workBefore(`work:${offset}`, offset, session, str(event.src));
        push({
          kind: 'question',
          key,
          offset,
          event,
          session,
          from: str(event.from),
          text: str(event.text),
          choices: Array.isArray(event.choices) ? event.choices.filter((c): c is string => typeof c === 'string') : [],
          request: str(event.src),
          ref: questionRef(event),
          answered: answer ? { text: str(answer.event.text), event: answer.event } : null,
        });
        break;
      }
      case 'answered':
        if (!questionCalls.has(str(event.src))) push({ kind: 'system', key, offset, event, text: `${str(event.from)} was answered: ${str(event.text)}` });
        break;
      case 'state': {
        const session = str(event.session);
        const now = RUNNING.has(str(event.state));
        const was = running.get(session) ?? true;
        running.set(session, now);
        if (now !== was) push({ kind: 'system', key, offset, event, text: now ? `${alias(session)} is running again on ${str(event.machine)}` : `${alias(session)} ${str(event.state)} on ${str(event.machine)}` });
        break;
      }
      default: {
        if (event.kind === 'joined') running.set(str(event.session), true);
        const text = systemText(event, alias, options.member ?? null);
        if (text !== null) push({ kind: 'system', key, offset, event, text });
      }
    }
  }
  placeUpTo(Infinity);
  flush();
  if (channel.kind === 'session' && options.live) items.push({ kind: 'work', key: 'work:live', offset: Number.MAX_SAFE_INTEGER, session: channel.session, range: { from: lastSrc, to: null } });
  return items;
}
