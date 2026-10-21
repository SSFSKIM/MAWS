// A channel's stream (§4), from verified log events and the requests the browser has seen. The group chat shows what
// is addressed to the human: messages, questions (with their answer once given), what humans posted, and lifecycle as
// system lines; traffic between agents (`say`) folds into one row per run, a run being the says with no other row
// between them. A direct channel is one session's exchange with the human — its messages and questions, what humans
// sent it, its own lifecycle — with the agent traffic it took part in folded the same way, and its working record
// folded before each of its messages, as a label (a direct channel is drawn from the log only where its transcript is
// not: an offline machine, a machine that serves none; the composite's §9.1). A request (a permission prompt
// or a question that is not a log event) sits after the log entry the browser held when it first saw it; an async
// question's request is drawn on its `question` event, whose `src` is the call's id.
//
// `status` lines are drawn as set. `state` events are the daemon's record of a session's liveness and recur as it
// moves between busy, idle, and waiting, so only a change between running (busy, idle, waiting) and not running
// (stopped, gone, vacant, retired) is drawn — a session that stopped, or runs again — and the sidebar's presence says
// the rest. A session is taken as running from its `joined` (and before any event says otherwise).
//
// A live session's channel ends with a fold after its last item: its working record goes on.
import { writerMachine, type JsonObject, type LogEvent, type Raised, type Recipient } from 'desk-hub/protocol';
import { requestKey } from '../project/conversation';
import type { Channel } from '../shell/layout';
import { isQuestion } from './card-state';

export type Entry = { offset: number; event: LogEvent };

export type StreamItem =
  | { kind: 'message'; key: string; offset: number; event: LogEvent; session: string | null; from: string; text: string }
  | { kind: 'human'; key: string; offset: number; event: LogEvent; text: string; to: '*' | Recipient[]; wake: boolean }
  /** `request`: the call's id (the event's `src`); `ref`: the key of the request raised for it, if any (`requestKey`).
   * `questions`: the questions as sminos recorded them, a list; `text` is the same joined a paragraph each. */
  | { kind: 'question'; key: string; offset: number; event: LogEvent; session: string | null; from: string; text: string; questions: string[]; choices: string[]; request: string; ref: string; answered: { text: string; event: LogEvent } | null }
  /** A lifecycle line: `subject` is who it is about (an alias), `rest` its words after the subject, `text` the two. */
  | { kind: 'system'; key: string; offset: number; event: LogEvent; session: string | null; subject: string; rest: string; text: string }
  | { kind: 'agents'; key: string; says: Entry[] }
  | { kind: 'work'; key: string; offset: number; session: string }
  /** `request`: the request's id; `ref`: its key in the conversation's `requests`; `session`: the session that raised it.
   * `ts`: a bound below its time, the time of the last log entry the browser held when it first saw it (null before any):
   * a request carries no time of its own, and the daemon's frequent `state` events keep that entry close behind it. */
  | { kind: 'request'; key: string; request: string; ref: string; session: string; ts: string | null };

/**
 * A request as the stream places it: `key` is its key in the conversation's `requests` (machine, session, id); `at`
 * is the offset of the last log entry the browser held when it first saw it; `question` whether it is a question (an
 * exchange item, so a working-record fold stands before it: a native one has no `question` event to do it).
 */
export type PlacedRequest = { key: string; request: string; session: string; at: number; question?: boolean };

/** A request the browser holds, placed. */
export function placedRequest(record: { key: string; request: string; raised: Raised; at: number }): PlacedRequest {
  return { key: record.key, request: record.request, session: record.raised.session, at: record.at, question: isQuestion(record.raised.tool) };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** A `question` event's questions: sminos records the questions an ask put as a list; an older event carries one text. */
const questionList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : str(v) ? [str(v)] : []);
/** The same, drawn one paragraph each. */
const questionText = (v: unknown): string => questionList(v).join('\n\n');
const recipients = (to: unknown): Recipient[] =>
  Array.isArray(to) ? to.filter((r): r is Recipient => typeof r === 'object' && r !== null && typeof (r as Recipient).session === 'string') : [];
const addressedTo = (event: LogEvent, session: string) => recipients(event.to).some((r) => r.session === session);
/** The session a writer stands for: `<machine>/<session uuid>`; null for `hub/`, a machine's `human`, `legacy/`. */
export const writerSession = (writer: string): string | null => {
  const id = writer.slice(writer.indexOf('/') + 1);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
};

/**
 * The key of the request a session's `question` (or its `answered`) event belongs to: its writer's machine and session,
 * and its `src`.
 */
const questionRef = (event: LogEvent): string =>
  requestKey({ machine: writerMachine(event.writer) ?? '', session: writerSession(event.writer) ?? '', request: str(event.src) });

/**
 * A cross-project message's other end (the org directory's §6): the sender's copy, told by its `copy` key, names its
 * destinations — the project of each delivering event its `copy` points at (`"<project id>:<writer>:<seq>"`, or a list
 * of those when a broadcast's events in several projects deliver it), else its recipients' projects — and the
 * delivering event names its origin by `from_project` when that is another project. An event of this project alone is
 * neither.
 */
export function crossProject(event: LogEvent, here: string): { to: string[] } | { from: string } | null {
  const copy = typeof event.copy === 'string' ? [event.copy] : Array.isArray(event.copy) ? event.copy.filter((c): c is string => typeof c === 'string') : null;
  if (copy !== null) {
    const named = copy.flatMap((c) => (c.indexOf(':') > 0 ? [c.slice(0, c.indexOf(':'))] : []));
    const to = named.length > 0 ? named : [...new Set(recipients(event.to).map((r) => str((r as { project?: unknown }).project)).filter(Boolean))];
    return to.length > 0 ? { to } : null;
  }
  const from = event.from_project;
  return typeof from === 'string' && from !== '' && from !== here ? { from } : null;
}

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * How sminos names a broadcast's scope (the org directory's §5a; `scope_label` in doperpowers' `sminos.py`, pinned by
 * `test/fixtures/sminos-scope/`): `@org` for the whole org, else `@all` narrowed by ` in <projects>` and
 * ` on <machines>` (`--here`'s machine last), then ` (<states>)` when it reached only those; each list comma-joined, a
 * project by `projectName`.
 */
export function scopeLabel(scope: JsonObject, projectName: (id: string) => string): string {
  const words = (key: string): string[] => {
    const v = scope[key];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  };
  const projects = words('projects').map(projectName);
  const here = scope.here;
  const machines = [...words('machines'), ...(typeof here === 'string' && here !== '' ? [here] : [])];
  const states = words('states');
  let label = projects.length > 0 || machines.length > 0 ? '@all' : '@org';
  if (projects.length > 0) label += ` in ${projects.join(',')}`;
  if (machines.length > 0) label += ` on ${machines.join(',')}`;
  if (states.length > 0) label += ` (${states.join(',')})`;
  return label;
}

/** Whom a broadcast (an event with `wake`) names, by its `scope`: the scope's label (`scopeLabel`), or `@all` for a bare one. */
export function broadcastLabel(scope: unknown, projectName: (id: string) => string): string {
  return isObject(scope) ? scopeLabel(scope, projectName) : '@all';
}

/** A web member's id (DX7: 128 bits as 32 lowercase hex), which `retired` and spawn's `joined` record as `by`. */
const MEMBER_ID = /^[0-9a-f]{32}$/;

/** Who `by` names: you, another member of the org (by its id: the browser holds no member list), or what sminos wrote. */
export function byWhom(by: string, member: string | null): string {
  if (member !== null && by === member) return 'you';
  if (MEMBER_ID.test(by)) return `another member (${by.slice(0, 8)})`;
  return by;
}

/**
 * A lifecycle event's line: its subject, the session's alias as the sidebar names it now, and its words. A rename is
 * the one line whose subject is the alias as it stood before (`before`), so it reads "old is now new"; a rename to
 * the name the session already had says nothing.
 */
function systemLine(event: LogEvent, alias: (id: unknown) => string, member: string | null, projectName: (id: string) => string, before: string | null): { subject: string; rest: string } | null {
  const subject = alias(event.session);
  switch (event.kind) {
    case 'joined':
      // A relocated `joined` refreshes where a member works (the engine moved it within the project): no one joined.
      return event.relocated === true ? null : { subject, rest: `joined on ${str(event.machine)}` };
    case 'retired':
      if (event.reason === 'moved') return { subject, rest: `moved${str(event.project) ? ` to ${projectName(str(event.project))}` : ''}` };
      return { subject, rest: `${event.reason === 'ended' ? 'ended' : 'retired'}${str(event.by) ? ` by ${byWhom(str(event.by), member)}` : ''}` };
    case 'renamed': {
      const was = before ?? subject;
      return was === str(event.alias) ? null : { subject: was, rest: `is now ${str(event.alias)}` };
    }
    case 'in-charge':
      return { subject, rest: `is in charge of: ${str(event.text)}` };
    case 'status':
      return { subject, rest: str(event.text) ? `status: ${str(event.text)}` : 'cleared its status' };
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
 * signed-in member, named "you" where an event records it as `by`. `projectName`: a project's name by its id, for the
 * project a session moved to (by default the id's first eight characters).
 */
export function buildStream(
  channel: Channel,
  entries: readonly Entry[],
  aliases: ReadonlyMap<string, string>,
  requests: readonly PlacedRequest[],
  options: { live?: boolean; member?: string; projectName?: (id: string) => string } = {},
): StreamItem[] {
  const alias = (id: unknown) => (typeof id === 'string' ? (aliases.get(id) ?? id.slice(0, 8)) : '');
  const shown = entries.filter((e) => inChannel(e.event, channel));
  // A question's answer, wherever its channel draws it (a direct channel does not draw `answered` on its own), joined
  // by the session that asked as well as the call's id: an id may be minted per bridge.
  const answers = new Map<string, Entry>();
  for (const e of entries) if (e.event.kind === 'answered' && str(e.event.src)) answers.set(questionRef(e.event), e);
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
  const system = (key: string, offset: number, event: LogEvent, session: string | null, line: { subject: string; rest: string }) =>
    push({ kind: 'system', key, offset, event, session, ...line, text: `${line.subject} ${line.rest}` });
  const workBefore = (key: string, offset: number, session: string | null) => {
    if (channel.kind === 'session' && session === channel.session) push({ kind: 'work', key, offset, session });
  };
  // The entry each placed request was first seen behind, read off every entry rather than the channel's (a direct
  // channel draws few, the daemon's `state` events most often): the requests are placed in offset order, so one pass.
  let behind = 0;
  const tsBehind = (at: number): string | null => {
    while (behind < entries.length && entries[behind].offset <= at) behind++;
    return behind > 0 ? entries[behind - 1].event.ts : null;
  };
  const placeUpTo = (offset: number) => {
    while (next < placed.length && placed[next].at < offset) {
      const r = placed[next];
      // A question with no `question` event (a native one) is an exchange item: the working record before it folds.
      if (r.question) workBefore(`work:request:${r.key}`, r.at, r.session);
      push({ kind: 'request', key: `request:${r.key}`, request: r.request, ref: r.key, session: r.session, ts: tsBehind(r.at) });
      next++;
    }
  };
  /** Whether each session is running, as its `joined` and `state` events say: only a change is drawn. */
  const running = new Map<string, boolean>();
  /** Each session's alias as the log stood at this point, for a rename's "old is now new". */
  const named = new Map<string, string>();

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
        workBefore(`work:${offset}`, offset, session);
        push({ kind: 'message', key, offset, event, session, from: str(event.from), text: str(event.text) });
        break;
      }
      case 'question': {
        const session = writerSession(event.writer);
        const answer = answers.get(questionRef(event));
        workBefore(`work:${offset}`, offset, session);
        push({
          kind: 'question',
          key,
          offset,
          event,
          session,
          from: str(event.from),
          text: questionText(event.text),
          questions: questionList(event.text),
          choices: Array.isArray(event.choices) ? event.choices.filter((c): c is string => typeof c === 'string') : [],
          request: str(event.src),
          ref: questionRef(event),
          answered: answer ? { text: str(answer.event.text), event: answer.event } : null,
        });
        break;
      }
      case 'answered':
        if (!questionRefs.has(questionRef(event))) system(key, offset, event, writerSession(event.writer), { subject: str(event.from), rest: `was answered: ${str(event.text)}` });
        break;
      case 'state': {
        const session = str(event.session);
        const now = RUNNING.has(str(event.state));
        const was = running.get(session) ?? true;
        running.set(session, now);
        if (now !== was) system(key, offset, event, session, { subject: alias(session), rest: now ? `is running again on ${str(event.machine)}` : `${str(event.state)} on ${str(event.machine)}` });
        break;
      }
      default: {
        const session = str(event.session) || null;
        if (event.kind === 'joined') running.set(str(event.session), true);
        const line = systemLine(event, alias, options.member ?? null, options.projectName ?? ((id) => id.slice(0, 8)), named.get(str(event.session)) ?? null);
        if ((event.kind === 'joined' || event.kind === 'renamed') && str(event.alias)) named.set(str(event.session), str(event.alias));
        if (line !== null) system(key, offset, event, session, line);
      }
    }
  }
  placeUpTo(Infinity);
  flush();
  if (channel.kind === 'session' && options.live) items.push({ kind: 'work', key: 'work:live', offset: Number.MAX_SAFE_INTEGER, session: channel.session });
  return items;
}
