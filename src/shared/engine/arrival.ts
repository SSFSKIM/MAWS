// One reading of every arrival (UX wave U3, UC-2; docs/doperpowers/specs/2026-11-12-ux-wave/U3-transcript-rows.md,
// Contracts, and its execution document docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, Interfaces A). What
// enters a session from elsewhere, read off the frame or row that carried it (its carrier) as the engine wrote it: a
// message from a peer or a subagent, a background task's notification, a scheduled prompt's firing, an answer to a
// question asked without waiting, a slash command's output, the person's own words sminos delivered, the bridge's wake,
// and MAWS's own consent message. The three places that turn the engine's frames and rows into X1 events (the live
// normaliser, the transcript-file backfill, the reader of another machine's rows) ask this module, so a class becomes
// the same events on every route. Pure: it imports nothing from the renderer or the engine host.
//
// The rules of reading (UC-2): (1) marks first, text second: a class is given only where the carrier's own marks allow
// it (its origin object, its envelope tag, its attachment type, `local_command_source`, the fields the engine writes for
// a scheduled fire), and the person's typed prompt is never an arrival, but for MAWS's own two texts (its answer
// envelope and its consent message) and a background session's prompt that opens with a whole sminos frame line
// (decision 19); (2) sminos's frame line says whose a delivered row is: `human` is the person (`own`), any other sender
// a peer; (3) one carrier can hold several arrivals; (4) what no class claims is left alone; (5) an arrival with two
// carriers is read once (`readNext`); (6) a notification block's outcome is its `<status>`, and none without one.
import { parseAskSteer } from '../maws/ask';
import { stripAnsi } from '../wire/ansi';
import type { Arrival } from './arrival-schema';
import { askAnswers, DISMISSED } from './ask-delivery';
import { INTERRUPT_MARKER, localCommandParts } from './engine-markers';
import { handbackReport, messageText, parsePeerMessage, peerEventsOf, sminosFrameAlias, sminosFrameOwners, sminosFrameSender, sminosParts } from './peer-envelope';
import { BRIDGE_WAKE_LINE, deliveredPrompts, deliveredText, firstLine, isBridgeWake, markedSteerWords, STEER_LINE } from './sminos-delivery';
import { notificationText, taskNotificationBlocks } from './task-notification';

export { ArrivalEntrySchema, CarriedArrivalSchema, carriedOf, type Arrival, type ArrivalEntry, type CarriedArrival } from './arrival-schema';

type Json = Record<string, unknown>;
type Answer = Extract<Arrival, { class: 'answer' }>;
type Task = Extract<Arrival, { class: 'task' }>;
type Own = Extract<Arrival, { class: 'own' }>;
type Peer = Extract<Arrival, { class: 'peer' }>;

/**
 * What earlier frames or rows of a session left open, for the frames and rows after them (rule 5, and the frame of a
 * task's end, which says nothing of the background alone). The module's own: a caller starts from `nothingOpen` and
 * passes back what `readNext` returned. Immutable: `readNext` returns a new value where anything changed.
 */
export interface OpenArrivals {
  /** The tasks the wire said started, by task id: their type, and whether they were in the background (`task_started`, `task_updated`). */
  readonly tasks: ReadonlyMap<string, { readonly type: string; readonly background: boolean }>;
  /** The runs whose `system/task_notification` said the report was handed back (`handback: 'send'`). */
  readonly handedBack: ReadonlySet<string>;
  /** The tasks whose hand-back waits for the task's next notification, which it claims, and no later one. */
  readonly handbacks: ReadonlySet<string>;
  /** A terminal's fire row, until the meta `user` row after it; `adjacent` while no other row has come between. */
  readonly fire: { readonly uuid: string; readonly adjacent: boolean } | null;
}

export const nothingOpen: OpenArrivals = Object.freeze({ tasks: new Map(), handedBack: new Set<string>(), handbacks: new Set<string>(), fire: null });

/** Every arrival one wire frame or one transcript row carries, in order. Empty for the person's typed prompt and for anything that is no arrival. */
export function readArrivals(row: unknown): Arrival[] {
  return readNext(row, nothingOpen).arrivals;
}

/**
 * The same reading in order (rule 5). `open` is what earlier frames or rows of the session left open: a run whose report
 * was handed back, a hand-back whose task notification has not come, a fire row, the tasks that were in the background.
 * A frame or row that is the second carrier of an arrival already read yields none. A caller gives it every frame or row
 * of a session in order, the ones that carry no arrival too.
 */
export function readNext(row: unknown, open: OpenArrivals): { arrivals: Arrival[]; open: OpenArrivals } {
  const record = object(row);
  const read = record === null ? { arrivals: [], open } : readRecord(record, open);
  const fire = read.open.fire;
  return fire !== null && fire.adjacent && !isFireRow(record) ? { arrivals: read.arrivals, open: { ...read.open, fire: { ...fire, adjacent: false } } } : read;
}

/** Whose turn it is when the arrival opens one: `own` and `consent` are the person's, `peer` a peer's, every other class the engine's. */
export function turnOriginOf(arrival: Arrival): 'human' | 'peer' | 'engine' {
  if (arrival.class === 'own' || arrival.class === 'consent') return 'human';
  return arrival.class === 'peer' ? 'peer' : 'engine';
}

/** MAWS's own answer envelope read from a message's text alone, for a message still waiting in MAWS's queue. */
export function readAnswerEnvelope(text: string): Answer | null {
  const steer = parseAskSteer(text);
  return steer === null ? null : { class: 'answer', tool: 'maws', call: steer.askId, summary: text, answers: steer.result.answers, dismissed: false };
}

/**
 * The one definition of the consent sentence: U1c sends it, the reader matches it whole. It is the engine's own
 * "Recently blocked" sentence for one call (`cli.pretty.js` of 2.1.322, the template that ends "if you would like."),
 * the command or the call's input quoted as one JSON string.
 */
export function consentMessage(kind: 'command' | 'call', subject: string): string {
  return `${consentHead(kind)}${JSON.stringify(subject)}${consentTail(kind)}`;
}
const consentHead = (kind: 'command' | 'call') => `Permission granted for this exact ${kind} only, as one whole string: `;
const consentTail = (kind: 'command' | 'call') =>
  `. This does not approve any other ${kind}, any part of this one, or running it with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry this exact ${kind} if you would like.`;

/** The consent a text is, whole, from its first word to its last; null for any other text, one word changed included. */
function consentOf(text: string): Extract<Arrival, { class: 'consent' }> | null {
  for (const kind of ['command', 'call'] as const) {
    const [head, tail] = [consentHead(kind), consentTail(kind)];
    if (!text.startsWith(head) || !text.endsWith(tail) || text.length < head.length + tail.length) continue;
    let subject: unknown;
    try {
      subject = JSON.parse(text.slice(head.length, text.length - tail.length));
    } catch {
      continue;
    }
    if (typeof subject === 'string' && consentMessage(kind, subject) === text) return { class: 'consent', kind, subject };
  }
  return null;
}

type Read = { arrivals: Arrival[]; open: OpenArrivals };
const none = (open: OpenArrivals): Read => ({ arrivals: [], open });

function readRecord(row: Json, open: OpenArrivals): Read {
  switch (row.type) {
    case 'user':
      return userRow(row, open);
    case 'attachment':
      return attachmentRow(row, open);
    case 'assistant':
      return { arrivals: commandOfFrame(row), open };
    case 'system':
      return systemRecord(row, open);
    case 'command_lifecycle':
      // A scheduled fire on the live wire (probe 2): no `user` frame, and the prompt's text is not on the wire.
      return { arrivals: row.state === 'started' && row.wakeup_source === 'schedule_wakeup' ? [{ class: 'schedule', prompt: null }] : [], open };
    default:
      return none(open);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// `user` frames and rows

function userRow(row: Json, open: OpenArrivals): Read {
  const content = object(row.message)?.content;
  if (Array.isArray(content) && content.length > 0 && content.every((block) => object(block)?.type === 'tool_result')) return none(open); // a tool's result continues the turn
  const origin = object(row.origin);
  const kind = origin?.kind;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? messageText(content.filter(isBlock)) : null;
  if (text === null) return none(open);
  if (kind === 'human') return { arrivals: personsPrompt(row, text), open };
  if (kind === 'peer' || (kind === undefined && parsePeerMessage(text)?.kind === 'teammate')) return peerMessage(text, origin, null, open);
  if (kind === 'plugin') return { arrivals: pluginRow(row), open };
  const notifications = notificationText(text, kind);
  if (notifications !== null) return notificationsOf(notifications, string(origin?.runId), open);
  if (row.turnOrigin === 'scheduled') return scheduledRow(row, text, open);
  return { arrivals: commandOfText(text, kind), open };
}

/**
 * The person's own prompt: never an arrival, but for MAWS's own texts (its answer envelope, its consent message) and, in
 * a background session sminos spawned, a prompt that opens with a whole frame line (decision 19). The session's kind is
 * read on the row itself: a row without it is the person's typed prompt, whatever its first line.
 */
function personsPrompt(row: Json, text: string): Arrival[] {
  const content = object(row.message)?.content;
  if (row.sessionKind === 'bg' && typeof content === 'string') {
    const delivery = framedDelivery(content, 'prompt', false);
    if (delivery !== null) return [delivery];
  }
  return personsText(text);
}

function personsText(text: string): Arrival[] {
  const consent = consentOf(text);
  if (consent !== null) return [consent];
  const answer = readAnswerEnvelope(text);
  return answer === null ? [] : [answer];
}

/** A row or a queued command of the peer origin (or a teammate's, which has none): the engine's inbox. */
function peerMessage(text: string, origin: Json | null, queuedPrompt: string | null, open: OpenArrivals): Read {
  const parsed = parsePeerMessage(text);
  if (parsed === null) {
    // An engine through 2.1.289 queued an inbox delivery raw, the frame the prompt's own first line.
    const raw = queuedPrompt === null ? null : framedDelivery(queuedPrompt, 'inbox', true);
    return { arrivals: raw === null ? [] : [raw], open };
  }
  if (parsed.kind === 'agent') {
    const report = handbackReport(parsed.body);
    const taskId = string(origin?.senderTaskId);
    const arrival: Arrival = { class: 'subagent', agentId: parsed.fromAgentId, body: parsed.body, report, taskId };
    return { arrivals: [arrival], open: report !== null && taskId !== null ? { ...open, handbacks: added(open.handbacks, taskId) } : open };
  }
  if (parsed.kind === 'teammate') return { arrivals: [inboxPeer(text, origin, 'team')], open };
  if (parsed.frame !== null) {
    const sender = sminosFrameSender(parsed.frame);
    return { arrivals: [sender === 'human' ? own('chat', parsed.frame, parsed.body) : inboxPeer(text, origin, 'inbox')], open };
  }
  const first = firstLine(parsed.body);
  if (first === STEER_LINE && parsed.body.length > STEER_LINE.length) return { arrivals: [own('steer', STEER_LINE, parsed.body.slice(STEER_LINE.length + 1))], open }; // X-032: `sminos steer`'s inbox fallback
  if (first === BRIDGE_WAKE_LINE) return { arrivals: [{ class: 'wake' }], open };
  return { arrivals: [inboxPeer(text, origin, 'inbox')], open };
}

/** A peer's message by the engine's inbox (or a teammate's), as the companion event reads it (`peerEventsOf`). */
function inboxPeer(text: string, origin: Json | null, via: 'inbox' | 'team'): Peer {
  const payload = peerEventsOf(text, null, origin);
  const parsed = parsePeerMessage(text);
  const frame = parsed !== null && parsed.kind !== 'agent' ? parsed.frame : null;
  if (payload === null || payload.kind !== 'peer.message') throw new Error('an envelope that parsed as a peer message has a peer message event');
  return {
    class: 'peer', via, sender: { name: payload.fromName, address: payload.from, session: payload.fromSession, owners: frame === null ? null : (sminosFrameOwners(frame)?.owners ?? null) },
    body: payload.text, frame, midTurn: payload.midTurn, lineage: payload.lineage, replyTo: payload.replyable ? payload.from : null,
  };
}

/** A row of the bridge's plugin: its answer prompt, its wake, or a delivery it submitted as the user or appended into the running turn. */
function pluginRow(row: Json): Arrival[] {
  const answers = answersOf(row);
  if (answers.length > 0) return answers;
  if (isBridgeWake(row)) return [{ class: 'wake' }];
  const prompts = deliveredPrompts(row);
  if (prompts === null || (prompts.kind !== 'submitted' && prompts.kind !== 'appended')) return [];
  const appended = prompts.kind === 'appended';
  if (appended) {
    const steer = markedSteerWords(row);
    if (steer !== null) return [own('steer', STEER_LINE, steer)];
  }
  const text = deliveredText(prompts);
  const delivery = text === null ? null : framedDelivery(text, 'bridge', appended);
  return delivery === null ? [] : [delivery];
}

/**
 * A delivery whose text opens with sminos's whole frame line, the words after it: the person's own when the frame names
 * `human`, else a peer's, named by the frame's alias (no address: neither the bridge nor a seat's prompt carries one).
 */
function framedDelivery(text: string, via: 'bridge' | 'prompt' | 'inbox', midTurn: boolean): Own | Peer | null {
  const { frame, body } = sminosParts(text);
  if (frame === null) return null;
  const sender = sminosFrameSender(frame)!;
  if (sender === 'human') return own('chat', frame, body);
  const owners = sminosFrameOwners(frame);
  return {
    class: 'peer', via, sender: { name: owners?.alias ?? sminosFrameAlias(frame), address: '', session: null, owners: owners?.owners ?? null },
    body, frame, midTurn, lineage: 'peer', replyTo: null,
  };
}

/** The person's own words sminos delivered; words that alone would read as the engine's interrupt marker keep their frame line before them. */
function own(via: 'chat' | 'steer', frame: string, words: string): Own {
  return { class: 'own', via, words: INTERRUPT_MARKER.test(words.trim()) ? `${frame}\n${words}` : words, frame };
}

/**
 * A meta `user` row of a scheduled fire (`turnOrigin: 'scheduled'`, probe 2: no origin object on any route), its text
 * the prompt: the arrival, unless a terminal's fire row before it is (rule 5), tied by `scheduledFireId` where the engine
 * wrote one, else by its place directly after.
 */
function scheduledRow(row: Json, text: string, open: OpenArrivals): Read {
  const fire = open.fire;
  const fireId = string(row.scheduledFireId);
  if (fire !== null && (fireId !== null ? fireId === fire.uuid : fire.adjacent)) return { arrivals: [], open: { ...open, fire: null } };
  return { arrivals: [{ class: 'schedule', prompt: text }], open };
}

// ---------------------------------------------------------------------------------------------------------------------
// Attachments: what the engine took in at a tool boundary or with the person's next prompt, and a hook's added context

function attachmentRow(row: Json, open: OpenArrivals): Read {
  const attachment = object(row.attachment);
  if (attachment?.type === 'hook_additional_context') return { arrivals: answersOf(row), open };
  if (attachment?.type !== 'queued_command' || typeof attachment.prompt !== 'string') return none(open);
  const prompt = attachment.prompt;
  const origin = object(attachment.origin);
  if (attachment.commandMode === 'task-notification') {
    if (attachment.isMeta === true) return none(open); // context, as the backfill reads it today
    const notifications = notificationText(prompt, origin?.kind ?? 'task-notification');
    return notifications === null ? none(open) : notificationsOf(notifications, string(attachment.runId) ?? string(origin?.runId), open);
  }
  if (origin?.kind === 'peer') {
    // The text the model read (`rendered`: the header and the trailer around the envelope) says more than the bare
    // prompt (whether the sender is inside this session), as the backfill's companion reads it.
    const rendered = Array.isArray(row.rendered) ? (row.rendered as unknown[]).map((part) => object(part)?.content).find((part): part is string => typeof part === 'string') : undefined;
    const text = rendered !== undefined && parsePeerMessage(rendered) !== null ? rendered : prompt;
    return peerMessage(text, origin, prompt, open);
  }
  if (origin?.kind === 'plugin') {
    // The bridge's submission into a running turn before doperpowers PR 233 appended it instead.
    const delivery = framedDelivery(prompt, 'bridge', true);
    return { arrivals: delivery === null ? [] : [delivery], open };
  }
  if (origin?.kind === 'human' && attachment.commandMode === 'prompt' && attachment.isMeta !== true) return { arrivals: personsText(prompt), open };
  return none(open);
}

/** The answers a plugin's prompt or a hook's context delivers, one arrival each, in order (rule 3). */
function answersOf(row: Json): Answer[] {
  return askAnswers(row).map(({ call, text }) => ({ class: 'answer', tool: 'sminos', call, summary: text, answers: null, dismissed: text === DISMISSED }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Task notifications

/**
 * The blocks of a notification carrier, each one arrival (rule 3), but the one a hand-back already read (rule 5: the
 * hand-back claims its task's next notification; on the live wire, a run the frame said was handed back). The carrier's
 * run is a single block's.
 */
function notificationsOf(text: string, carrierRun: string | null, open: OpenArrivals): Read {
  const blocks = taskNotificationBlocks(text);
  const runId = blocks.length === 1 ? carrierRun : null;
  let { handbacks, handedBack } = open;
  const arrivals: Arrival[] = [];
  for (const block of blocks) {
    if (block.taskId !== null && handbacks.has(block.taskId)) {
      handbacks = removed(handbacks, block.taskId);
      if (runId !== null && handedBack.has(runId)) handedBack = removed(handedBack, runId);
      continue;
    }
    if (runId !== null && handedBack.has(runId)) {
      handedBack = removed(handedBack, runId);
      continue;
    }
    arrivals.push({ class: 'task', taskId: block.taskId, toolUseId: block.toolUseId, runId, outcome: block.outcome, summary: block.summary, durationMs: block.durationMs, outputFile: block.outputFile, detail: block.detail });
  }
  return { arrivals, open: handbacks === open.handbacks && handedBack === open.handedBack ? open : { ...open, handbacks, handedBack } };
}

// ---------------------------------------------------------------------------------------------------------------------
// `system` frames and rows

function systemRecord(row: Json, open: OpenArrivals): Read {
  switch (row.subtype) {
    case 'task_started':
      return { arrivals: [], open: taskStarted(row, open) };
    case 'task_updated': {
      const id = string(row.task_id);
      const known = id === null ? undefined : open.tasks.get(id);
      if (id === null || object(row.patch)?.is_backgrounded !== true || known?.background === true) return none(open);
      return { arrivals: [], open: { ...open, tasks: withEntry(open.tasks, id, { type: known?.type ?? '', background: true }) } };
    }
    case 'task_notification':
      return taskFrame(row, open);
    case 'scheduled_task_fire': {
      const uuid = string(row.uuid);
      return { arrivals: [{ class: 'schedule', prompt: string(row.prompt) }], open: uuid === null ? open : { ...open, fire: { uuid, adjacent: true } } };
    }
    case 'local_command':
    case 'local_command_output':
      return { arrivals: typeof row.content === 'string' ? commandOfText(row.content, undefined) : [], open };
    default:
      return none(open);
  }
}

/** A task's start: its type and whether it runs in the background; a new run of a task ends what its earlier hand-back claimed. */
function taskStarted(row: Json, open: OpenArrivals): OpenArrivals {
  const id = string(row.task_id);
  if (id === null) return open;
  const tasks = withEntry(open.tasks, id, { type: string(row.task_type) ?? '', background: row.is_backgrounded === true });
  return { ...open, tasks, handbacks: open.handbacks.has(id) ? removed(open.handbacks, id) : open.handbacks };
}

/**
 * The live wire's `system/task_notification` frame: a carrier only for a background command or monitor (task type
 * `local_bash`, in the background by its start or a later update) that completed or failed, with a run, whose `summary`
 * is then the engine's sentence (probe 1). A foreground command's frame, a stopped task's (whose `summary` is its
 * description) and an agent's (the hand-back's note) are none. An agent's frame that says its report was handed back
 * marks the run, so the replayed frame that names it yields nothing (rule 5).
 */
function taskFrame(row: Json, open: OpenArrivals): Read {
  const [id, runId, summary] = [string(row.task_id), string(row.run_id), string(row.summary)];
  const handedBack = row.handback === 'send' && runId !== null ? added(open.handedBack, runId) : open.handedBack;
  const task = id === null ? undefined : open.tasks.get(id);
  const tasks = id !== null && task !== undefined ? without(open.tasks, id) : open.tasks;
  const next = { ...open, tasks, handedBack };
  const outcome = row.status === 'completed' || row.status === 'failed' ? row.status : null;
  if (task?.type !== 'local_bash' || !task.background || outcome === null || runId === null || summary === null) return { arrivals: [], open: next };
  const output = string(row.output_file);
  const arrival: Task = { class: 'task', taskId: id, toolUseId: string(row.tool_use_id), runId, outcome, summary, durationMs: null, outputFile: output === '' ? null : output, detail: null };
  return { arrivals: [arrival], open: next };
}

// ---------------------------------------------------------------------------------------------------------------------
// A slash command's output

/** The assistant frame the engine writes for a command's output (`local_command_source`, probe 4), never a model's answer. */
function commandOfFrame(row: Json): Arrival[] {
  if (typeof row.local_command_source !== 'string') return [];
  const parts = localCommandParts(row.local_command_source);
  if (parts === null) return [];
  const run = object(row.local_command_run);
  const command = string(run?.command);
  return [{ class: 'command', run: command === null ? null : { command, args: string(run?.args) ?? '' }, stdout: stripAnsi(parts.stdout), stderr: stripAnsi(parts.stderr) }];
}

/** A `user` frame or row, or a terminal's `system` row, whose whole text is a command's output tags; never the person's own text. */
function commandOfText(text: string, originKind: unknown): Arrival[] {
  if (originKind === 'human') return [];
  const parts = localCommandParts(text);
  return parts === null ? [] : [{ class: 'command', run: null, stdout: stripAnsi(parts.stdout), stderr: stripAnsi(parts.stderr) }];
}

// ---------------------------------------------------------------------------------------------------------------------

function isFireRow(row: Json | null): boolean {
  return row?.type === 'system' && row.subtype === 'scheduled_task_fire';
}

function object(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}
const string = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const isBlock = (value: unknown): value is { type: string } & Json => typeof object(value)?.type === 'string';
const added = (set: ReadonlySet<string>, value: string): ReadonlySet<string> => new Set([...set, value]);
const removed = (set: ReadonlySet<string>, value: string): ReadonlySet<string> => new Set([...set].filter((item) => item !== value));
function withEntry<V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> {
  return new Map([...map, [key, value]]);
}
function without<V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  return new Map([...map].filter(([k]) => k !== key));
}
