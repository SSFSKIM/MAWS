// Transcript-to-X1 backfill (C4 execution document, "Chain follower and backfill", the mapping table): one disk record
// in, the X1 events it stands for out. Used by the chain follower for every record it puts on the chain and by the
// replay engine's transcript source (M5). Disk records carry no journal row, so every event has `seq: null` and a
// deterministic id (`<uuid>`, `<uuid>#<n>`, `session:<id>:started`), which is what lets a consumer that receives the
// same backfill twice deduplicate.
import type { ContentBlock, EventBase, SessionEvent } from '@shared/graph/events';
import type { AgentId, ApiMessageId, EventId, MessageUuid, ParentToolUseId, SessionId, TaskId, ToolUseId } from '@shared/graph/ids';
import { isNoContent, type AgentMeta, type TranscriptRecord } from '@shared/wire/transcript';
import { slashCommandLine } from '@shared/wire/local-command';
import { denialKindOf, INTERRUPT_MARKER } from '../normalizer-support';
import { apiRetryOfApiError } from '../normalizer-system';
import { messageText, parsePeerMessage, peerEventsOf } from '@shared/engine/peer-envelope'; // E7
import { nothingOpen, readNext, type Arrival, type OpenArrivals } from '@shared/engine/arrival'; // UX wave U3 (UC-2)
import { localCommandText } from '@shared/engine/engine-markers';
import { isBridgeRow, isMirrorLine } from '@shared/engine/sminos-delivery';
import { notificationText, taskNotificationBlocks, type TaskNotificationBlock } from '@shared/engine/task-notification';
import { isMadeUpFinalAnswer } from '@shared/owner/message-call';
import { INTERRUPT_CUT, parseInterruptCut } from '@shared/lane-a/interrupt-cut';

// The three engine strings that name a spilled result (SPEC 12.12 and 20.10); the structured field wins when present.
export const SPILL_MARKER = /(?:Full output saved to|were saved to|was saved to):? (\/[^\r\n]+\.(?:txt|json))(?=[.;\s]|$)/;

const TEXT_CAP = 200;
const EPOCH = '1970-01-01T00:00:00.000Z';

// What the parent's mapping needs to know about a child agent when it meets the `Agent` tool use that spawned it:
// the sidecar's meta (agent-<id>.meta.json, keyed by its `toolUseId`) and, when the sidecar transcript is readable,
// its first user record as the prompt. M3's subagents reader supplies the production lookup.
export interface SubagentLookup {
  byToolUseId(toolUseId: string): { agentId: AgentId; meta: AgentMeta; prompt: string | null } | null;
}

export interface BackfillContext {
  readonly sessionId: SessionId;
  readonly agentId: AgentId | null;
  readonly parentToolUseId: ParentToolUseId | null;
  readonly seenToolUses: Map<string, TaskId>; // Agent tool uses that started a subagent, for subagent.finished on their result
  // Agent tool uses read before their child's meta existed: a tailer reads the assistant record before the tool runs
  // and writes the meta, so the lookup is asked again at the tool use's result and at its task notification.
  readonly pendingAgents: Set<string>;
  readonly notificationSources: Set<string>;
  readonly notificationTools: Set<string>;
  readonly subagents: SubagentLookup | null;
  lastAt: string; // the previous event's `at`, inherited by records without a timestamp
  started: boolean; // session.started emitted (once per follow)
  lastTurnUserUuid: MessageUuid | null; // the last turn.started, for turn.ended.userMessageUuids
  // Inside a tool loop: the last word was a tool result, so the engine owes a model call, and the mid-turn fold that
  // takes or drops queued steers runs before it. Set by a tool result that is not an interrupt marker; cleared by an
  // assistant record, an interrupt marker, a prompt that opens a turn and `system/turn_duration`. It tells a blocked
  // steer (blockedPrompt, below) from a blocked prompt of its own.
  inToolLoop: boolean;
  lastAssistantWasApiError: boolean;
  // P5 O9: the rows a sminos bridge appended lately, by their words on one line, waiting for the transcript line that
  // says which of them were the owner's words delivered into a running turn (sminosDelivery, below)
  readonly bridgeRows: Map<string, { uuid: MessageUuid; content: string }>;
  // P5 O9 (the fix wave): whether a turn runs, from its `turn.started` (or, UX wave U3, the model's output) to its
  // `turn.ended` or an interrupt marker, and what the bridge delivered while none did, waiting for the turn that answers
  // it (withWaitingWords): the owner's words, and (UX wave U3) a peer's delivery the bridge appended, as the events it
  // maps to. UX wave U3 (UC-2): whether this mapping saw the last turn end (`idle`; `running` is false too for a history
  // whose start the mapping never saw, a page of rows, where a delivery is drawn at its row), and whether the running
  // turn has had no model output yet, so that what the engine queued reached the model with the prompt that opened it
  // (a task the host stopped while the session was idle)
  running: boolean;
  idle: boolean;
  unanswered: boolean;
  readonly waitingWords: Waiting[];
  // P5 O9 (the M10 sitting): the latest `<local-command-caveat>` record, whose child is a command the terminal ran
  // (localCommandTurn, below)
  localCaveat: MessageUuid | null;
  // UX wave U3 (UC-2; the U3a document, M3): what the arrivals reader left open after the records mapped so far, which
  // it reads in order (rule 5); whether the last record was a delivery the bridge appended, whose mirror line then
  // draws nothing; and the last record when it was a command's `user` row, whose `system` copy under it is no second
  // command
  arrivals: OpenArrivals;
  appendedLast: boolean;
  commandLast: MessageUuid | null;
}

// What the bridge delivered while no turn ran (withWaitingWords), placed when a turn starts: the owner's words (`words`
// null when they were drawn at their row already, desk-web's older steer), or a peer's delivery as its events.
type Waiting = { kind: 'own'; uuid: MessageUuid; words: string | null } | { kind: 'peer'; events: SessionEvent[] };

export function createBackfillContext(init: {
  sessionId: SessionId;
  agent: { agentId: AgentId; parentToolUseId: ParentToolUseId | null } | null; // a workflow agent names no tool use (its meta has no toolUseId)
  subagents?: SubagentLookup;
  // what the arrivals reader already read of this session elsewhere (a gap's reseed reads on from the live wire's reader)
  arrivals?: OpenArrivals;
}): BackfillContext {
  return {
    sessionId: init.sessionId,
    agentId: init.agent?.agentId ?? null,
    parentToolUseId: init.agent?.parentToolUseId ?? null,
    seenToolUses: new Map(),
    pendingAgents: new Set(),
    notificationSources: new Set(),
    notificationTools: new Set(),
    subagents: init.subagents ?? null,
    lastAt: EPOCH,
    started: false,
    lastTurnUserUuid: null,
    inToolLoop: false,
    lastAssistantWasApiError: false,
    bridgeRows: new Map(),
    running: false,
    idle: false,
    unanswered: false,
    waitingWords: [],
    localCaveat: null,
    arrivals: init.arrivals ?? nothingOpen,
    appendedLast: false,
    commandLast: null,
  };
}

// The base fields of an event synthesised outside a record (anchors, branches, rewrites); the caller picks the id.
export function eventBase(ctx: BackfillContext, id: string): EventBase {
  return { id: id as EventId, sessionId: ctx.sessionId, at: ctx.lastAt, seq: null, agentId: ctx.agentId, parentToolUseId: ctx.parentToolUseId };
}

export function recordToEvents(record: TranscriptRecord, ctx: BackfillContext): SessionEvent[] {
  if (typeof record.uuid !== 'string') return [];
  const uuid = record.uuid as MessageUuid;
  if (typeof record.timestamp === 'string') ctx.lastAt = record.timestamp;
  // UX wave U3 (UC-2): what this record carries from elsewhere, read in order, so an arrival with two carriers is read
  // once (rule 5). The reader says what a carrier is and whose; where its events go stays here.
  const openFire = ctx.arrivals.fire;
  const read = readNext(record, ctx.arrivals);
  ctx.arrivals = read.open;
  const arrivals = read.arrivals;
  const afterAppended = ctx.appendedLast;
  ctx.appendedLast = false;
  const echoedCommand = record.type === 'system' && ctx.commandLast !== null && record.parentUuid === ctx.commandLast && localCommandKind(record) === 'echo';
  ctx.commandLast = record.type === 'user' && localCommandKind(record) === 'echo' ? uuid : null;
  const events: SessionEvent[] = [];
  let ordinal = 0;
  const base = (): EventBase => {
    const id = ordinal === 0 ? uuid : `${uuid}#${ordinal}`;
    ordinal += 1;
    return eventBase(ctx, id);
  };

  if (!ctx.started && typeof record.cwd === 'string') {
    ctx.started = true;
    const id = ctx.agentId === null ? `session:${ctx.sessionId}:started` : `session:${ctx.sessionId}:agent:${ctx.agentId}:started`;
    events.push({
      ...eventBase(ctx, id),
      kind: 'session.started',
      cwd: record.cwd,
      engineVersion: typeof record.version === 'string' ? record.version : null,
      resumedFrom: null,
      forked: Boolean(record.forkedFrom),
    });
  }

  // The meta row of a terminal's fire, the arrival's second carrier, which the reader tied to the fire row before it
  // (UX wave U3, the U3a document, M3): it makes no message of its own (firesMeta)
  const firesMeta = openFire !== null && read.open.fire === null && arrivals.length === 0 && isScheduledPrompt(record) ? (openFire.uuid as MessageUuid) : null;

  switch (record.type) {
    case 'user':
      if (arrivals.length === 0) noteBridgeRow(record, uuid, ctx);
      if (firesMeta !== null) firesMetaEvents(firesMeta, uuid, ctx, base, events);
      else userEvents(record, uuid, arrivals, ctx, base, events);
      break;
    case 'assistant':
      assistantEvents(record, uuid, ctx, base, events);
      break;
    case 'system':
      if (!echoedCommand) systemEvents(record, arrivals, afterAppended, ctx, base, events);
      break;
    case 'attachment': // context injections: on the chain, nothing to show, except a relay's receipt in a child, a prompt taken mid-turn (W1) and what arrived from elsewhere (UC-2)
      if (taskNotificationAttachment(record, uuid, arrivals, ctx, base, events)) break;
      if (peerQueuedMessage(record, uuid, arrivals, ctx, base, events)) break; // E7
      if (arrivalAttachment(record, uuid, arrivals, base, events)) break;
      if (ctx.agentId === null) steeredPrompt(record, arrivals, base, events);
      else coordinatorMessage(record, uuid, ctx, base, events);
      break;
    case 'progress': // never on the chain; the follower keeps only its skeleton
      break;
    default:
      events.push({ ...base(), kind: 'frame.unknown', frameType: `transcript:${record.type}`, subtype: null });
  }
  return withWaitingWords(record.type === 'user' && arrivals.some((arrival) => arrival.class === 'wake'), events, ctx, base);
}

type Base = () => EventBase;

// Debt wave 4 (C8b's receipt ask): a message SendMessage queued for a live child reaches the child's transcript only as
// a `queued_command` attachment with the coordinator origin, written at the child's next tool round, which the model
// reads as a system reminder (pass3/relay-to-child seq 232 and 351, the recorded line: `attachment { type, prompt,
// source_uuid, origin: { kind: 'coordinator' }, isMeta: true }`). It becomes the child's synthetic `user.message` with
// the prompt as its content, as the resumed child's own `isMeta` user record already does, so C8b's relay sees the
// receipt; a synthetic message opens no turn and renders no row. Other attachments in a child's transcript stay unshown
// (the main transcript's are steeredPrompt's, below).
function coordinatorMessage(record: TranscriptRecord, uuid: MessageUuid, ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  const attachment = record.attachment as { type?: unknown; prompt?: unknown; origin?: { kind?: unknown } } | undefined;
  if (attachment?.type !== 'queued_command' || attachment.origin?.kind !== 'coordinator' || typeof attachment.prompt !== 'string') return;
  events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: attachment.prompt, isReplay: false, isSynthetic: true, origin: 'coordinator', bash: null });
}

// W1: a prompt the engine took into the running turn at a tool boundary is written to the main transcript only as a
// `queued_command` attachment after that tool's result, never as a user record: a stream-json `next` steer
// (test/fixtures/transcripts/w1-steer-next-disk.jsonl line 32) and a prompt the interactive terminal queued mid-turn
// (w1-terminal-queued.jsonl line 26) alike, `{ type, prompt, source_uuid, commandMode: 'prompt', origin: { kind:
// 'human' }, humanTurn: true }`. It becomes what the live stream shows: the prompt's `user.message` under its own uuid
// (`source_uuid`, the uuid it was written with), then the engine's `started` for it, which folds it into the open turn
// at this point (the reducer's `next` path), so a reloaded session places the steer where the live one did. A queued
// command of another origin (a task notification, a coordinator's) or a meta one is a context injection, as before.
function humanQueuedPrompt(record: TranscriptRecord): { messageUuid: MessageUuid; content: string | ContentBlock[] } | null {
  if (record.type !== 'attachment') return null;
  const attachment = record.attachment as { type?: unknown; prompt?: unknown; source_uuid?: unknown; commandMode?: unknown; origin?: { kind?: unknown }; isMeta?: unknown } | undefined;
  if (attachment?.type !== 'queued_command' || attachment.origin?.kind !== 'human' || attachment.commandMode !== 'prompt' || attachment.isMeta === true) return null;
  if (typeof attachment.source_uuid !== 'string' || attachment.source_uuid.length === 0) return null;
  const content = typeof attachment.prompt === 'string' ? attachment.prompt : Array.isArray(attachment.prompt) ? attachment.prompt.filter(isContentBlock) : null;
  return content === null ? null : { messageUuid: attachment.source_uuid as MessageUuid, content };
}

function steeredPrompt(record: TranscriptRecord, arrivals: Arrival[], base: Base, events: SessionEvent[]): void {
  const prompt = humanQueuedPrompt(record);
  if (prompt === null) return;
  const { messageUuid, content } = prompt;
  events.push({ ...base(), kind: 'user.message', messageUuid, content, isReplay: false, isSynthetic: false, origin: 'human', bash: null, ...consentOf(arrivals) });
  events.push({ ...base(), kind: 'command.lifecycle', commandUuid: messageUuid, state: 'started' });
}

// UX wave U3 (UC-2, class `consent`; the U3a document, decision 10): MAWS's own "Approve and retry" message keeps the
// events the person's prompt or steer makes, and carries the arrival on its message, which draws it as one line.
function consentOf(arrivals: Arrival[]): { arrival?: Extract<Arrival, { class: 'consent' }>[] } {
  const consent = arrivals.filter((arrival): arrival is Extract<Arrival, { class: 'consent' }> => arrival.class === 'consent');
  return consent.length > 0 ? { arrival: consent } : {};
}

// E7 start: a message from another session, or an in-process agent's SendMessage to this conversation (E7 execution
// document, Design §4, Decision Log 22; M0's e7-peer-transcripts). Delivered while the session was idle it is a `user`
// record of the peer origin, `isMeta`, after which the engine runs a turn of its own (the live stream opens it at the
// engine's `system/init`, with no prompt uuid, and its result names none: pass3/e7-peer-a seq 71-156), so it opens that
// turn here too. Taken into a running turn at a tool boundary it is a `queued_command` attachment whose `prompt` is the
// bare envelope the live frame carries, under that frame's uuid (`source_uuid`), and whose `rendered` text adds the
// header and reply suffix the model read. Each becomes the live stream's synthetic peer `user.message` and the parsed
// event beside it, from the parser the live normaliser uses.
//
// UX wave U3 (UC-2; the U3a document, decision 4): a record the arrivals reader claims as a peer's or a subagent's
// message (`arrival`) is synthetic whatever its own flag, so it never opens a pending turn of the person's beside its
// own; its turn is a peer's, or the engine's for a subagent's (a hand-back's turn reads "Continued for"). A delivery
// sminos framed (the bridge's row, a background session's prompt, an inbox delivery an old engine queued raw) has no
// envelope, so its companion is the arrival's. A peer text no class claims keeps the flag and the bubble it has.
function peerMessage(record: TranscriptRecord, uuid: MessageUuid, arrival: PeerArrival | null, ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  const raw = messageContent(record) as string | unknown[];
  const content = typeof raw === 'string' ? raw : raw.filter(isContentBlock);
  // Inside a tool loop the engine takes it into the running turn, as it does a task notification there
  // (taskNotificationAttachment): no turn of its own. Nor does a delivery the bridge appended into the running turn.
  if (!ctx.inToolLoop && !isBridgeRow(record)) {
    ctx.lastTurnUserUuid = null;
    ctx.lastAssistantWasApiError = false;
    events.push({ ...base(), kind: 'turn.started', userMessageUuid: null, origin: arrival?.class === 'subagent' ? 'task-notification' : 'peer' });
  }
  const isSynthetic = arrival !== null || record.isMeta === true || isTeammateMessage(record);
  events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content, isReplay: false, isSynthetic, origin: 'peer', bash: null });
  const companion = companionOf(peerEventsOf(messageText(content), uuid, record.origin), arrival, uuid);
  if (companion) events.push({ ...base(), ...companion });
}

type PeerArrival = Extract<Arrival, { class: 'peer' | 'subagent' }>;
type Companion = NonNullable<ReturnType<typeof peerEventsOf>>;

// The parsed event beside a peer's message: the envelope's, else, for a delivery sminos framed, the arrival's own
// (Interfaces C: the sender's alias from the frame line, the words after it, no address, so never replyable).
function companionOf(parsed: Companion | null, arrival: PeerArrival | null, messageUuid: MessageUuid): Companion | null {
  if (parsed !== null || arrival?.class !== 'peer') return parsed;
  return {
    kind: 'peer.message', messageUuid, from: arrival.sender.address, fromSession: arrival.sender.session, fromName: arrival.sender.name, fromMode: null, fromPlugin: null,
    hopChain: [], text: arrival.body, midTurn: arrival.midTurn, lineage: arrival.lineage, replyable: false,
  };
}

// E11 S2(d): a teammate's message to the lead of a team an interactive terminal formed (2.1.293; pass3/e7-team-terminal,
// the lead's transcript line 35) is a plain `user` record, no origin and no `isMeta`, whose text is the header and a
// `<teammate-message teammate_id=…>` envelope. It is a peer message all the same (its turn the engine's, its message
// synthetic like the live peer frame), never the owner's prompt.
function isTeammateMessage(record: TranscriptRecord): boolean {
  const content = messageContent(record);
  return record.type === 'user' && record.origin === undefined && typeof content === 'string' && parsePeerMessage(content)?.kind === 'teammate';
}

// A `user` record of the peer origin that carries text: a string, or blocks with a text block and no tool result (an
// image beside the text too, whose text blocks the companion parses, as live parses the same frame's); or a teammate's.
function isPeerPrompt(record: TranscriptRecord): boolean {
  if (record.type !== 'user') return false;
  if ((record.origin as { kind?: unknown } | undefined)?.kind !== 'peer') return isTeammateMessage(record);
  const content = messageContent(record);
  if (typeof content === 'string') return true;
  return Array.isArray(content) && content.some((block) => isContentBlock(block) && block.type === 'text') && content.every((block) => isContentBlock(block) && block.type !== 'tool_result');
}

// Shared with the follower's unended-turn rule: a record that opens a turn on this mapping, `startsTurn`'s human prompts
// (the boundary the rewind rules read) and a peer message, which opens its own (E7). A peer record inside a tool loop
// opens none, but the turn it joins was already open, so the rule's answer is the same. UX wave U3: a scheduled fire's
// meta row opens the engine's turn too, and so does a command a terminal wrote as a `system` row (whose turn ends where
// it starts), and a terminal's fire row, which opens its own at its row (its meta row then continues that turn). The
// bridge's wake and its answer prompt are `startsTurn`'s already.
export function opensTurn(record: TranscriptRecord): boolean {
  return startsTurn(record) || (isPeerPrompt(record) && !isInterruptMarker(record)) || isScheduledPrompt(record) || (record.type === 'system' && (localCommandKind(record) === 'echo' || record.subtype === 'scheduled_task_fire'));
}

function peerQueuedMessage(record: TranscriptRecord, uuid: MessageUuid, arrivals: Arrival[], ctx: BackfillContext, base: Base, events: SessionEvent[]): boolean {
  const attachment = record.attachment as { type?: unknown; prompt?: unknown; source_uuid?: unknown; origin?: { kind?: unknown } } | undefined;
  if (attachment?.type !== 'queued_command' || attachment.origin?.kind !== 'peer' || typeof attachment.prompt !== 'string') return false;
  const messageUuid = queuedUuid(record, uuid);
  // UX wave U3 (UC-2): the owner's own send or steer through the inbox, and the bridge's wake through it, taken into
  // the running turn, are not a peer's (rule 2)
  if (arrivals[0]?.class === 'own' || arrivals[0]?.class === 'wake') return arrivalAttachment(record, uuid, arrivals, base, events);
  events.push({ ...base(), kind: 'user.message', messageUuid, content: attachment.prompt, isReplay: false, isSynthetic: true, origin: 'peer', bash: null });
  const rendered = Array.isArray(record.rendered) ? (record.rendered as { content?: unknown }[]).find((part) => typeof part?.content === 'string')?.content as string | undefined : undefined;
  const parsed = (rendered === undefined ? null : peerEventsOf(rendered, messageUuid, attachment.origin)) ?? peerEventsOf(attachment.prompt, messageUuid, attachment.origin);
  const companion = companionOf(parsed, peerArrivalOf(arrivals), messageUuid);
  if (companion) events.push({ ...base(), ...companion });
  return true;
}

const peerArrivalOf = (arrivals: Arrival[]): PeerArrival | null => {
  const [first] = arrivals;
  return first?.class === 'peer' || first?.class === 'subagent' ? first : null;
};

// A queued command's message uuid: the one it was written with (`source_uuid`), else the attachment's own.
function queuedUuid(record: TranscriptRecord, uuid: MessageUuid): MessageUuid {
  const source = (record.attachment as { source_uuid?: unknown } | undefined)?.source_uuid;
  return typeof source === 'string' && source.length > 0 ? (source as MessageUuid) : uuid;
}
// E7 end

// Desktop's history adapter unwraps queued task notifications as user records. At a tool boundary they are synthetic
// context for the running turn, not a new prompt; outside the loop they can trigger an engine follow-up. Old records
// lack source_uuid; their tool-use identity is the only stable delivery identity available.
function taskNotificationAttachment(record: TranscriptRecord, uuid: MessageUuid, arrivals: Arrival[], ctx: BackfillContext, base: Base, events: SessionEvent[]): boolean {
  const attachment = record.attachment as { type?: unknown; commandMode?: unknown; prompt?: unknown; source_uuid?: unknown; isMeta?: unknown } | undefined;
  if (attachment?.type !== 'queued_command' || attachment.commandMode !== 'task-notification') return false;
  if (attachment.isMeta === true || typeof attachment.prompt !== 'string') return true;
  const source = typeof attachment.source_uuid === 'string' && attachment.source_uuid ? attachment.source_uuid as MessageUuid : null;
  // in the tool loop, or with the prompt that opened the running turn, before the model answered (UX wave U3, UC-2: a
  // task the host stopped while idle sits directly above that prompt), the engine takes it into that turn: no turn of its own
  userEvents({ ...record, type: 'user', isMeta: record.isMeta === true || ctx.inToolLoop || ctx.unanswered, origin: { kind: 'task-notification' }, message: { role: 'user', content: attachment.prompt } }, source ?? uuid, arrivals, ctx, base, events, source);
  return true;
}

function userEvents(record: TranscriptRecord, uuid: MessageUuid, arrivals: Arrival[], ctx: BackfillContext, base: Base, events: SessionEvent[], sourceUuid: MessageUuid | null = uuid): void {
  const content = messageContent(record);
  if (isNoContent(content)) return; // P5 O9: the engine's word for a message with none: no prompt, no turn
  // W1 (A5): the summary `/compact` writes after its boundary (`isCompactSummary`, w1-compact.jsonl line 29) is the
  // engine's context for the model, which the live stream sends as a synthetic frame: no bubble and no turn, like meta.
  const isMeta = record.isMeta === true || record.isCompactSummary === true;
  const originKind = (record.origin as { kind?: unknown } | undefined)?.kind;
  const humanOrigin = originKind === 'human' ? 'human' : null;
  const marker = isInterruptMarker(record);
  const local = isLocalCommandOutput(record);
  const turn = (origin: string | null): void => {
    if (isMeta || marker || local) return; // the marker belongs to the turn it interrupted, a command's output to the command's turn (W1)
    openTurn(uuid, origin, ctx, base, events);
  };
  if (marker) ctx.inToolLoop = false; // an interrupt ends the loop: no model call follows
  // P5 O9 (the M10 sitting): the reply an interrupt cut off, as the sminos bridge records it after the interrupt's marker
  // and note (1.27.16): the model's context in the turn it cut, never a prompt or a turn; drawn marked cut off.
  const cut = interruptCutText(record);
  if (cut !== null) {
    events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: cut, isReplay: false, isSynthetic: true, origin: INTERRUPT_CUT, bash: null });
    return;
  }
  // UX wave U3 (UC-2): what the record carries from elsewhere becomes the same events on every route (the U3a document,
  // Interfaces C); MAWS's own answer envelope and consent message are the person's prompt, as below
  if (arrivals.some((arrival) => arrival.class !== 'consent' && !(arrival.class === 'answer' && arrival.tool === 'maws'))) {
    arrivalEvents(record, uuid, arrivals, ctx, base, events, sourceUuid);
    return;
  }
  // E7 start
  if (!marker && isPeerPrompt(record)) {
    peerMessage(record, uuid, null, ctx, base, events);
    return;
  }
  // E7 end
  if (typeof content === 'string' && marker) {
    events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content, isReplay: false, isSynthetic: isMeta, origin: 'interrupt-marker', bash: null });
    return;
  }
  if (typeof content === 'string') {
    // UX wave U3 (rule 5): the second carrier of an agent's end, the task notification its hand-back claimed, yields no
    // row and no turn, but still ends its task (decision 13); a typed prompt is never one, whatever its text (rule 1)
    const notifications = humanOrigin === null ? notificationText(content, originKind) : null;
    if (notifications !== null) {
      const blocks = taskNotificationBlocks(notifications);
      if (!seenNotification(blocks, sourceUuid, ctx)) taskState(blocks, ctx, base, events);
      return;
    }
    const bash = parseBash(content);
    const command = localCommandTurn(record, ctx);
    turn(humanOrigin);
    events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: bashStripped(content, bash), isReplay: false, isSynthetic: isMeta, origin: humanOrigin, bash, ...consentOf(arrivals) });
    if (command) events.push(endedOf(base, uuid, null));
    if (record.isMeta === true) hookFeedback(content, uuid, base, events);
    return;
  }
  if (!Array.isArray(content)) return;
  const blocks = content.filter(isContentBlock);
  const results = blocks.filter((block) => block.type === 'tool_result');
  const others = blocks.filter((block) => block.type !== 'tool_result');
  if (others.length > 0) {
    turn(humanOrigin);
    events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: others, isReplay: false, isSynthetic: isMeta, origin: marker ? 'interrupt-marker' : humanOrigin, bash: null, ...consentOf(arrivals) });
  }
  const structured = record.toolUseResult ?? null;
  const persisted = (structured as { persistedOutputPath?: unknown } | null)?.persistedOutputPath;
  // A background agent's tool_result is its launch acknowledgement, not its outcome (`isAsync: true`); the outcome
  // arrives later as a <task-notification> user record.
  const asyncLaunched = (structured as { status?: unknown } | null)?.status === 'async_launched';
  if (results.length > 0 && !marker) ctx.inToolLoop = true;
  // UX wave U2 (O-29): the kind of a refusal, from the row's own `toolDenialKind`, which the engine makes the wire's
  // `non_execution_kind` from for a row that holds exactly one result (`cli.pretty.js:237652-237668` of 2.1.322); a word
  // this build does not know is no kind, as the normaliser reads the wire's
  const fileDenial = results.length === 1 ? denialKindOf(typeof record.toolDenialKind === 'string' ? record.toolDenialKind : undefined) : null;
  for (const block of results) {
    const toolUseId = block.tool_use_id;
    if (typeof toolUseId !== 'string' || toolUseId.length === 0) continue;
    const resultContent = block.content;
    const content: string | ContentBlock[] = typeof resultContent === 'string' ? resultContent : Array.isArray(resultContent) ? resultContent.filter(isContentBlock) : '';
    const text = typeof content === 'string' ? content : content.map((b) => (typeof b.text === 'string' ? b.text : '')).join('\n');
    const isError = block.is_error === true;
    startPendingSubagent(ctx, toolUseId, base, events);
    events.push({
      ...base(),
      kind: 'tool.result',
      toolUseId: toolUseId as ToolUseId,
      content,
      isError,
      structured,
      spillPath: typeof persisted === 'string' ? persisted : (SPILL_MARKER.exec(text)?.[1] ?? null),
      denial: fileDenial === 'unknown' ? null : fileDenial,
      safeguard: 'not_evaluated',
      messageUuid: uuid,
    });
    const taskId = ctx.seenToolUses.get(toolUseId);
    if (taskId !== undefined && !asyncLaunched) {
      events.push({
        ...base(),
        kind: 'subagent.finished',
        taskId,
        status: isError ? 'failed' : 'completed',
        summary: text.length > 0 ? text.slice(0, TEXT_CAP) : null,
        outputFile: null,
        reason: null,
      });
    }
  }
}

// UX wave U3 start (UC-2; the U3a document, Interfaces C, and M3). What each class the reader gives a `user` record
// becomes, the same events every caller makes of it: the turn it opens, when it opens one, and its message.
function arrivalEvents(record: TranscriptRecord, uuid: MessageUuid, arrivals: Arrival[], ctx: BackfillContext, base: Base, events: SessionEvent[], sourceUuid: MessageUuid | null): void {
  const [first] = arrivals as [Arrival, ...Arrival[]];
  const content = messageContent(record) as string | unknown[];
  const written = typeof content === 'string' ? content : content.filter(isContentBlock);
  const isMeta = record.isMeta === true || record.isCompactSummary === true;
  switch (first.class) {
    case 'peer':
    case 'subagent': {
      if (isBridgeRow(record)) {
        // a delivery the bridge appended into the running turn: at its row, but held for the turn that starts next when
        // this mapping saw the last turn end, as the owner's words are (withWaitingWords)
        ctx.appendedLast = true;
        const delivered: SessionEvent[] = [];
        peerMessage(record, uuid, first, ctx, base, delivered);
        if (ctx.idle) ctx.waitingWords.push({ kind: 'peer', events: delivered });
        else events.push(...delivered);
        return;
      }
      peerMessage(record, uuid, first, ctx, base, events);
      return;
    }
    case 'own': {
      if (isBridgeRow(record)) {
        ctx.appendedLast = true;
        if (ctx.idle) ctx.waitingWords.push({ kind: 'own', uuid, words: first.words });
        else steered(uuid, first.words, base, events);
        return;
      }
      if (ctx.inToolLoop) return steered(uuid, first.words, base, events);
      openTurn(uuid, 'human', ctx, base, events);
      events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: first.words, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
      return;
    }
    case 'command': {
      localCommandTurn(record, ctx); // the caveat's command is behind it
      events.push(commandOutput(uuid, arrivals, base));
      return;
    }
    case 'task': {
      const blocks = taskNotificationBlocks(notificationText(typeof content === 'string' ? content : messageText(written as ContentBlock[]), (record.origin as { kind?: unknown } | undefined)?.kind) ?? '');
      if (seenNotification(blocks, sourceUuid, ctx)) return;
      if (!isMeta) openTurn(uuid, 'task-notification', ctx, base, events);
      events.push(carried(uuid, written, arrivals, base));
      taskState(blocks, ctx, base, events);
      return;
    }
    default: {
      // `schedule` (a headless session's meta row), `wake`, and an `answer` by the plugin's prompt: the engine's turn
      if (!ctx.inToolLoop) openTurn(uuid, 'task-notification', ctx, base, events);
      events.push(carried(uuid, written, arrivals, base));
    }
  }
}

// What an attachment carries from elsewhere, taken into the running turn (UX wave U3, UC-2): the owner's own words
// queued there (through the inbox, or the bridge's submission before doperpowers PR 233), a peer's delivery the bridge
// queued, the bridge's wake through the inbox, and answers a hook's context gave a tool's result or the next prompt.
// False when it carries none of these, for the readers after it.
function arrivalAttachment(record: TranscriptRecord, uuid: MessageUuid, arrivals: Arrival[], base: Base, events: SessionEvent[]): boolean {
  const [first] = arrivals;
  const attachment = record.attachment as { type?: unknown; prompt?: unknown; content?: unknown } | undefined;
  if (first === undefined) return false;
  if (attachment?.type === 'hook_additional_context') {
    const text = Array.isArray(attachment.content) ? attachment.content.filter((part): part is string => typeof part === 'string').join('\n') : '';
    events.push(carried(uuid, text, arrivals, base));
    return true;
  }
  if (attachment?.type !== 'queued_command' || typeof attachment.prompt !== 'string') return false;
  const messageUuid = queuedUuid(record, uuid);
  if (first.class === 'own') {
    steered(messageUuid, first.words, base, events);
    return true;
  }
  if (first.class === 'wake') {
    events.push(carried(messageUuid, attachment.prompt, arrivals, base));
    return true;
  }
  if (first.class !== 'peer') return false;
  events.push({ ...base(), kind: 'user.message', messageUuid, content: attachment.prompt, isReplay: false, isSynthetic: true, origin: 'peer', bash: null });
  events.push({ ...base(), ...companionOf(null, first, messageUuid)! });
  return true;
}

// A turn that opens at a record: the person's, a peer's or the engine's, named by its prompt's uuid.
function openTurn(uuid: MessageUuid, origin: string | null, ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  ctx.lastTurnUserUuid = uuid;
  ctx.inToolLoop = false;
  ctx.lastAssistantWasApiError = false;
  events.push({ ...base(), kind: 'turn.started', userMessageUuid: uuid, origin });
}

// A terminal's fire's meta row (rule 5's second pair): it continues the engine's turn its fire opened, making nothing.
// Where that turn no longer runs, the follower's synthesised exit having closed it (endedByExit), the row opens the
// engine's turn, as a person's prompt read then opens the person's; the fire's line stays in the turn it opened.
function firesMetaEvents(fire: MessageUuid, uuid: MessageUuid, ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  if (!ctx.running || ctx.lastTurnUserUuid !== fire) openTurn(uuid, 'task-notification', ctx, base, events);
}

/**
 * The follower synthesised the exit of the session's unended turn (`process.exited`, past the rows mapped so far): the
 * turn no longer runs, so what is read later and would continue it opens its own.
 */
export function endedByExit(ctx: BackfillContext): void {
  ctx.running = ctx.unanswered = false;
  ctx.idle = true;
}

const isScheduledPrompt = (record: TranscriptRecord) => record.type === 'user' && record.turnOrigin === 'scheduled';

// The synthetic message of an arrival of the carried classes (Interfaces C): the carrier's text, never a prompt.
function carried(messageUuid: MessageUuid, content: string | ContentBlock[], arrivals: Arrival[], base: Base): SessionEvent {
  const arrival = arrivals.filter((entry): entry is Extract<Arrival, { class: 'task' | 'schedule' | 'answer' | 'wake' }> => entry.class === 'task' || entry.class === 'schedule' || entry.class === 'answer' || entry.class === 'wake');
  return { ...base(), kind: 'user.message', messageUuid, content, isReplay: false, isSynthetic: true, origin: 'task-notification', bash: null, arrival };
}

// The owner's words taken into the running turn: what the live stream shows for a prompt folded in there.
function steered(messageUuid: MessageUuid, words: string, base: Base, events: SessionEvent[]): void {
  events.push({ ...base(), kind: 'user.message', messageUuid, content: words, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
  events.push({ ...base(), kind: 'command.lifecycle', commandUuid: messageUuid, state: 'started' });
}

// A slash command's output (class `command`): the engine's own tag around it, its terminal escapes removed, in the turn
// that runs, which is its command's.
function commandOutput(messageUuid: MessageUuid, arrivals: Arrival[], base: Base): SessionEvent {
  const content = localCommandText(arrivals.flatMap((arrival) => (arrival.class === 'command' ? [arrival] : [])));
  return { ...base(), kind: 'user.message', messageUuid, content, isReplay: false, isSynthetic: false, origin: 'local-command', bash: null };
}

// A notification already mapped (the same delivery in a queued command and in a row): nothing again. Old records lack a
// source uuid; their tool-use identity is the only stable delivery identity available.
function seenNotification(blocks: TaskNotificationBlock[], sourceUuid: MessageUuid | null, ctx: BackfillContext): boolean {
  const tools = blocks.flatMap((block) => (block.toolUseId === null ? [] : [block.toolUseId]));
  const duplicate = sourceUuid !== null ? ctx.notificationSources.has(sourceUuid) : tools.length > 0 && tools.every((tool) => ctx.notificationTools.has(tool));
  if (duplicate) return true;
  if (sourceUuid !== null) ctx.notificationSources.add(sourceUuid);
  for (const tool of tools) ctx.notificationTools.add(tool);
  return false;
}

// Task state is not an arrival (decision 13): every block of a notification that ends its task ends it, whether or not
// the reader made an arrival of it; a block that claims no end (`outcome: null`) ends nothing. The real completion of a
// background agent is the notification naming the tool use that started it.
function taskState(blocks: TaskNotificationBlock[], ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  for (const block of blocks) {
    if (block.outcome === null || block.toolUseId === null) continue;
    const started = ctx.seenToolUses.get(block.toolUseId) ?? startPendingSubagent(ctx, block.toolUseId, base, events);
    if (started !== undefined) {
      const summary = block.result ?? block.summary;
      events.push({ ...base(), kind: 'subagent.finished', taskId: block.taskId === null ? started : (block.taskId as TaskId), status: block.outcome, summary: summary.slice(0, TEXT_CAP), outputFile: block.outputFile, reason: null });
    } else if (block.taskId !== null) {
      // Like the live normaliser, an outcome without a known task type is a task.notification.
      events.push({ ...base(), kind: 'task.notification', taskId: block.taskId as TaskId, toolUseId: block.toolUseId as ToolUseId, status: block.outcome, summary: block.result ?? block.summary, outputFile: block.outputFile, reason: null, arrivals: true });
    }
  }
}
// UX wave U3 end

// UX wave U8c-2 (M5, §K): the tools the transcript draws as a shell call. Such a call carries the folder its row
// records, which says where the command ran even after the agent moved; no other call carries one.
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'Monitor']);

function assistantEvents(record: TranscriptRecord, uuid: MessageUuid, ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  const message = record.message as { id?: unknown; model?: unknown; content?: unknown } | undefined;
  const content = Array.isArray(message?.content) ? message.content.filter(isContentBlock) : [];
  // Every disk assistant record carries the API message id; the record uuid stands in if one ever lacks it.
  const apiMessageId = (typeof message?.id === 'string' && message.id.length > 0 ? message.id : uuid) as ApiMessageId;
  const model = typeof message?.model === 'string' ? message.model : '';
  const apiBlockIndex = typeof record.apiBlockIndex === 'number' ? record.apiBlockIndex : null;
  // UX wave U2 (X1): the engine's recorded duration of the record's thinking block (`thinkingDurationMs`), on that
  // block's event when the record holds exactly one thinking block and the value is a duration
  const recordedMs = record.thinkingDurationMs;
  const thinkingDurationMs = typeof recordedMs === 'number' && Number.isFinite(recordedMs) && recordedMs >= 0 && content.filter((block) => block.type === 'thinking').length === 1 ? recordedMs : undefined;
  ctx.inToolLoop = false;
  ctx.lastAssistantWasApiError = record.isApiErrorMessage === true;
  if (isNoResponseMarker(record)) return; // resume bookkeeping still resets the assistant context above
  if (isMadeUpFinalAnswer(record)) return; // the to-human plugin's answer after a final message: no request, nothing said
  content.forEach((block, i) => {
    events.push({
      ...base(),
      kind: 'assistant.block.complete',
      messageUuid: uuid,
      apiMessageId,
      blockIndex: apiBlockIndex === null ? i : apiBlockIndex + i,
      block,
      model,
      supersedes: [],
      aborted: false,
      userMessageUuids: [],
      ...(record.isApiErrorMessage === true && { isApiErrorMessage: true }),
      ...(typeof record.error === 'string' && { error: record.error }),
      ...(block.type === 'thinking' && thinkingDurationMs !== undefined && { thinkingDurationMs }),
    });
    if (block.type !== 'tool_use' || typeof block.id !== 'string' || block.id.length === 0) return;
    const toolUseId = block.id as ToolUseId;
    const toolName = typeof block.name === 'string' ? block.name : '';
    events.push({ ...base(), kind: 'tool.use', toolUseId, toolName, input: block.input, apiMessageId, messageUuid: uuid, ...(SHELL_TOOLS.has(toolName) && typeof record.cwd === 'string' && { cwd: record.cwd }) });
    if (toolName !== 'Agent') return;
    if (startSubagent(ctx, toolUseId, base, events) === null) ctx.pendingAgents.add(toolUseId);
  });
}

// `subagent.started` for the child the lookup knows under this tool use; its task id, or null when the meta is unknown.
function startSubagent(ctx: BackfillContext, toolUseId: string, base: Base, events: SessionEvent[]): TaskId | null {
  const child = ctx.subagents?.byToolUseId(toolUseId) ?? null;
  if (child === null) return null;
  const taskId = child.agentId as string as TaskId;
  ctx.seenToolUses.set(toolUseId, taskId);
  events.push({
    ...base(),
    kind: 'subagent.started',
    taskId,
    toolUseId: toolUseId as ToolUseId,
    description: child.meta.description,
    subagentType: child.meta.agentType,
    isBackground: child.meta.requestShape === 'background',
    spawnDepth: child.meta.spawnDepth ?? 1,
    prompt: child.prompt,
  });
  return taskId;
}

// The late start of an Agent tool use read before its meta existed; undefined when it is not pending or still unknown.
function startPendingSubagent(ctx: BackfillContext, toolUseId: string, base: Base, events: SessionEvent[]): TaskId | undefined {
  if (!ctx.pendingAgents.has(toolUseId)) return undefined;
  const taskId = startSubagent(ctx, toolUseId, base, events);
  if (taskId === null) return undefined;
  ctx.pendingAgents.delete(toolUseId);
  return taskId;
}

function systemEvents(record: TranscriptRecord, arrivals: Arrival[], afterAppended: boolean, ctx: BackfillContext, base: Base, events: SessionEvent[]): void {
  const subtype = typeof record.subtype === 'string' ? record.subtype : null;
  switch (subtype) {
    case 'compact_boundary': {
      const meta = record.compactMetadata as { trigger?: unknown; preTokens?: unknown; postTokens?: unknown } | undefined;
      events.push({
        ...base(),
        kind: 'boundary.compaction',
        trigger: typeof meta?.trigger === 'string' ? meta.trigger : 'unknown',
        preTokens: typeof meta?.preTokens === 'number' ? meta.preTokens : 0,
        postTokens: typeof meta?.postTokens === 'number' ? meta.postTokens : null, // W1: 2.1.283 writes it (w1-compact.jsonl line 28)
        logicalParentUuid: typeof record.logicalParentUuid === 'string' ? (record.logicalParentUuid as MessageUuid) : null,
        historical: true,
      });
      return;
    }
    case 'turn_duration':
      // Accounting is not on disk per turn; `seq: null` marks the event synthesised and C6 shows duration, not cost.
      ctx.inToolLoop = false;
      events.push({
        ...base(),
        kind: 'turn.ended',
        result: ctx.lastAssistantWasApiError ? 'error_during_execution' : 'success',
        isError: ctx.lastAssistantWasApiError,
        terminalReason: null,
        resultText: null,
        durationMs: typeof record.durationMs === 'number' ? record.durationMs : 0,
        numTurns: 1,
        costUsd: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null },
        permissionDenials: [],
        errors: [],
        userMessageUuids: ctx.lastTurnUserUuid === null ? [] : [ctx.lastTurnUserUuid],
        origin: null,
        resultIndex: null,
        isEchoReceipt: false,
      });
      return;
    case 'api_error': {
      // The event live makes from the engine's `api_retry` twin of this record (normalizer-system.ts); a record without
      // its retry counters stays a compatibility signal.
      const retry = apiRetryOfApiError(record);
      events.push(retry === null ? { ...base(), kind: 'frame.unknown', frameType: 'system', subtype } : { ...base(), ...retry });
      return;
    }
    case 'model_refusal_fallback':
    case 'model_refusal_no_fallback':
      // Disk uses camelCase (the live stream uses snake_case). No-fallback retracts no messages on the live path.
      events.push({
        ...base(),
        kind: 'boundary.retraction',
        retractedMessageUuids: subtype === 'model_refusal_fallback' && Array.isArray(record.retractedMessageUuids)
          ? record.retractedMessageUuids.filter((uuid): uuid is MessageUuid => typeof uuid === 'string') : [],
        reason: typeof record.content === 'string' ? record.content : 'model refusal',
        fallbackModel: subtype === 'model_refusal_fallback' && typeof record.fallbackModel === 'string' ? record.fallbackModel : null,
      });
      return;
    case 'scheduled_task_fire':
      // UX wave U3 (UC-2, rule 5): a terminal's fire is the arrival, its line at its own row, in the engine's turn it
      // opens there; the meta row after it continues that turn (firesMetaEvents)
      if (arrivals.length > 0) {
        openTurn(record.uuid as MessageUuid, 'task-notification', ctx, base, events);
        events.push(carried(record.uuid as MessageUuid, typeof record.content === 'string' ? record.content : '', arrivals, base));
      }
      return;
    case 'stop_hook_summary':
    case 'away_summary':
    case 'bridge_status':
    case 'permission_retry':
      return;
    case 'local_command':
    case 'local_command_output': {
      if (isNoContent(record.content)) return; // P5 O9: a command that said nothing (`/reload-plugins`)
      const uuid = record.uuid as MessageUuid;
      // UX wave U3 (UC-2, class `command`): a command's output, in the engine's tag, its escapes removed
      if (arrivals.length > 0) return void events.push(commandOutput(uuid, arrivals, base));
      // the command itself, written by a terminal as this row (the U3a document, M3): the person's command, mapped as
      // the user row of one is (its bubble, its turn, and the turn's end where it starts: a local command runs no model)
      if (localCommandKind(record) === 'echo') {
        ctx.inToolLoop = false;
        openTurn(uuid, null, ctx, base, events);
        events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: record.content as string, isReplay: false, isSynthetic: false, origin: null, bash: null });
        events.push(endedOf(base, uuid, null));
        return;
      }
      events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: typeof record.content === 'string' ? record.content : '', isReplay: false, isSynthetic: record.isMeta === true, origin: 'local-command', bash: null });
      return;
    }
    case 'informational': {
      // UX wave U3 (UC-2, rule 5): the bridge's mirror of a delivery it appended is that delivery's second carrier
      if (afterAppended && isMirrorLine(record)) return;
      if (sminosDelivery(record, ctx, base, events)) return;
      const blocked = blockedPrompt(record);
      if (blocked === null) {
        const text = typeof record.content === 'string' ? withoutMirroredCut(record.content).trim() : '';
        if (record.level === 'info') return;
        if (record.level !== 'warning' && record.level !== 'notice') break; // preserve unknown shapes as compatibility signals
        if (text) events.push({ ...base(), kind: 'notice.posted', level: record.level, text, key: 'informational' });
        return;
      }
      // The prompt, from the record's "Original prompt:"; none when the hook suppressed it, though a queue operation
      // before the record may still hold its text, left unread as the hook asked.
      const uuid = record.uuid as MessageUuid;
      const prompt = (): void => {
        if (blocked.prompt !== null) events.push({ ...base(), kind: 'user.message', messageUuid: uuid, content: blocked.prompt, isReplay: false, isSynthetic: false, origin: null, bash: null });
      };
      // Inside a tool loop it is a queued `next` steer the hook rejected at the mid-turn fold, and the turn runs on
      // (2.1.283 cli.pretty.js 806590-806624, the fold's dropped prompts and their notices; 810567-810575, yielded inside
      // the running turn; from the bundle, not recorded): read as steeredPrompt reads a delivered steer, its bubble
      // folded into the running turn here (the record's uuid standing in for the steer's), then the hook that blocked it.
      if (ctx.inToolLoop) {
        prompt();
        events.push({ ...base(), kind: 'command.lifecycle', commandUuid: uuid, state: 'started' });
        blockingHook(uuid, 'UserPromptSubmit', blocked.blockingError, base, events);
        return;
      }
      // Otherwise a turn of its own as the live stream has it: the prompt, the hook that blocked it, and the end of a
      // turn that ran nothing (num_turns 0).
      ctx.lastTurnUserUuid = uuid;
      events.push({ ...base(), kind: 'turn.started', userMessageUuid: uuid, origin: null });
      prompt();
      blockingHook(uuid, 'UserPromptSubmit', blocked.blockingError, base, events);
      events.push(endedOf(base, uuid, blocked.text));
      return;
    }
  }
  events.push({ ...base(), kind: 'frame.unknown', frameType: 'transcript:system', subtype });
}

// Debt wave 7 (W1's hook notices after a reload): disk carries no hook events, so a hook that got in the way is read
// from what the engine writes instead, as the hook events the live stream has for it (pass3/hooks-blocking seq 30 and
// 57, pass3/hooks-flipped seq 30, 65 and 82; the same runs on disk: test/fixtures/transcripts/w1-hooks-blocking.jsonl
// lines 24 and 31, dw7-hooks-flipped.jsonl lines 24, 31 and 35).
//
// On disk the engine keeps a blocking error's text (`blockingError`: the hook's JSON `reason`, or `[<command>]: <stderr>`
// when it exited 2), not how the hook signalled it, nor its exit code, output or hook id. The finish is stated in the
// form the hook protocol defines a blocking error by, exit code 2 with the reason on stderr, which C6's hook notice
// reads as blocking (model/hooks.ts) whichever way the hook blocked live; the `[<command>]: ` prefix is dropped, since
// live stderr carries the reason alone. The record's uuid stands in for the hook id.
function blockingHook(hookId: string, hookEvent: string, blockingError: string, base: Base, events: SessionEvent[]): void {
  const stderr = blockingError.replace(COMMAND_PREFIX, '');
  events.push({ ...base(), kind: 'hook.started', hookId, hookName: hookEvent, hookEvent });
  events.push({ ...base(), kind: 'hook.finished', hookId, hookName: hookEvent, hookEvent, outcome: 'error', exitCode: 2, stdout: '', stderr });
}

const COMMAND_PREFIX = /^\[[^\n]*?\]: /;

// A Stop hook that blocked (re-prompting Claude) leaves, per blocking hook, a meta user record `<Event> hook
// feedback:\n<blockingError>` whichever way it blocked (2.1.283's `ffn`, the one formatter for Stop, TeammateIdle,
// TaskCreated and TaskCompleted blocks). Its `hook_blocking_error` attachment is written only for a JSON block, and the
// `stop_hook_summary` record's `hookErrors` also lists non-blocking failures, so neither is read.
const HOOK_FEEDBACK = /^(\w+) hook feedback:\n([\s\S]*)$/;
function hookFeedback(content: string, uuid: MessageUuid, base: Base, events: SessionEvent[]): void {
  const match = HOOK_FEEDBACK.exec(content);
  if (match !== null) blockingHook(uuid, match[1], match[2], base, events);
}

// P5 O9 (the M8 sitting; doperpowers `sminos/hooks/mods/bridge.tsx`, `appendDelivery`): a terminal session's sminos bridge
// gives words it delivers while a turn runs (the bridge's `deliver` from MAWS, sminos's send) to the running turn as a
// row of its own, which the engine keeps as it keeps every row a plugin appends: a meta `user` record of the plugin's
// origin whose content is the words, as text. The bridge's other rows (an interrupt's marker and note, a stop's note)
// are kept alike, so the record alone does not say which are the owner's. The transcript line the bridge writes after a
// delivery's row does: a `system/informational` record reading `sminos: delivered: <the words on one line>`. So each
// such row is held by its words until a line names them; then the words are what lane B's mid-turn send reads as
// (steeredPrompt): the owner's words folded into the running turn at that point, under the row's own uuid, which the
// bridge's `delivered` names, and the line no notice. A line naming no row this context saw stays a notice.
const SMINOS_DELIVERED = 'sminos: delivered: ';
const BRIDGE_ROWS_HELD = 32;
const oneLine = (text: string) => text.replaceAll('\n', ' ');

function noteBridgeRow(record: TranscriptRecord, uuid: MessageUuid, ctx: BackfillContext): void {
  const origin = record.origin as { kind?: unknown; name?: unknown } | undefined;
  if (record.isMeta !== true || origin?.kind !== 'plugin' || origin.name !== 'sminos') return;
  const content = messageContent(record);
  const blocks = Array.isArray(content) ? content.filter(isContentBlock) : [];
  const text = typeof content === 'string' ? content : blocks.length > 0 && blocks.every((b) => b.type === 'text' && typeof b.text === 'string') ? blocks.map((b) => b.text as string).join('') : null;
  if (text === null || text.trim() === '') return;
  ctx.bridgeRows.delete(oneLine(text));
  ctx.bridgeRows.set(oneLine(text), { uuid, content: text });
  while (ctx.bridgeRows.size > BRIDGE_ROWS_HELD) ctx.bridgeRows.delete(ctx.bridgeRows.keys().next().value as string);
}

function sminosDelivery(record: TranscriptRecord, ctx: BackfillContext, base: Base, events: SessionEvent[]): boolean {
  if (typeof record.content !== 'string' || !record.content.startsWith(SMINOS_DELIVERED)) return false;
  const key = record.content.slice(SMINOS_DELIVERED.length);
  const row = ctx.bridgeRows.get(key);
  if (row === undefined) return false;
  ctx.bridgeRows.delete(key);
  if (ctx.idle) ctx.waitingWords.push({ kind: 'own', uuid: row.uuid, words: row.content });
  else steered(row.uuid, row.content, base, events);
  return true;
}

// P5 O9 (the fix wave): words the bridge delivers while no turn runs go in as such a row too: after a stop, since the
// engine then refuses a plugin's prompt (the bridge wakes the session through its inbox, which the engine keeps as a
// peer message); or the row lands as the turn it was given into ends (the bridge's wake is then its prompt as the user).
// No turn runs to take them as sent during it, so they are a prompt waiting for the turn that answers them, placed at
// that turn's start. The bridge's wake opens a turn of the words', the first its prompt (the wake's own text the model's
// context, no bubble) and any others sent during it; any other turn that starts first takes them all as sent during it.
// A turn the interrupt left open on this mapping (the marker opens and ends nothing here) is not one that runs: the next
// turn's start closes it, stopped, so the words are not placed before it (they would fold into that turn).
// (UX wave U3: the wake is the reader's class `wake`, its line the wake's notice in that turn; a peer's delivery the
// bridge appended while no turn ran waits too, as its events; desk-web's older, unmarked steer, drawn at its row by
// `appended-turn.ts`, waits for its turn's start alone. A mapping that never saw a turn end, a page of rows, draws a
// delivery at its row, as one into a running turn.)
function withWaitingWords(wake: boolean, events: SessionEvent[], ctx: BackfillContext, base: Base): SessionEvent[] {
  const start = events.findIndex((event) => event.kind === 'turn.started');
  const said = (row: Extract<Waiting, { kind: 'own' }>): SessionEvent[] => (row.words === null ? [] : [{ ...base(), kind: 'user.message', messageUuid: row.uuid, content: row.words, isReplay: false, isSynthetic: false, origin: 'human', bash: null }]);
  const taken = (rows: Waiting[]) => rows.flatMap((row): SessionEvent[] => (row.kind === 'peer' ? row.events : [...said(row), { ...base(), kind: 'command.lifecycle', commandUuid: row.uuid, state: 'started' }]));
  let out = events;
  if (start >= 0 && ctx.waitingWords.length > 0) {
    const waiting = ctx.waitingWords.splice(0);
    const first = wake ? waiting.find((row) => row.kind === 'own') : undefined;
    if (first !== undefined) {
      ctx.lastTurnUserUuid = first.uuid;
      const opened = { ...events[start], userMessageUuid: first.uuid, origin: null } as SessionEvent;
      out = [...events.slice(0, start), opened, ...said(first), ...taken(waiting.filter((row) => row !== first)), ...events.slice(start + 1)];
    } else out = [...events, ...taken(waiting)];
  } else if (ctx.waitingWords.length > 0 && events.some((event) => MODEL_RUNS.has(event.kind))) {
    // the model's output with no turn started (a history whose start was not held): the reducer places it with the
    // waiting prompt, as it would
    out = [...ctx.waitingWords.splice(0).flatMap((row) => (row.kind === 'peer' ? row.events : said(row))), ...events];
  }
  for (const event of out) {
    if (event.kind === 'turn.started' || MODEL_RUNS.has(event.kind)) {
      ctx.running = true;
      ctx.idle = false;
      ctx.unanswered = event.kind === 'turn.started';
    } else if (event.kind === 'turn.ended' || (event.kind === 'user.message' && event.origin === 'interrupt-marker')) {
      ctx.running = ctx.unanswered = false;
      ctx.idle = true;
    }
  }
  return out;
}
const MODEL_RUNS = new Set<SessionEvent['kind']>(['assistant.block.complete', 'tool.use']);

/**
 * A prompt the person sent that no turn ran to take, already drawn where it went in: the next turn that starts takes it
 * (withWaitingWords). For desk-web's drawing of the bridge's older, unmarked steer (`appended-turn.ts`), which this
 * mapping reads as a prompt queued into the turn.
 */
export function waitForTurn(ctx: BackfillContext, messageUuid: MessageUuid): void {
  if (!ctx.running) ctx.waitingWords.push({ kind: 'own', uuid: messageUuid, words: null });
}

// P5 O9 (the M10 sitting): the sminos bridge's mirror of an interrupt's rows for the terminal (`<plugin>: interrupt: …`)
// ends, from 1.27.16, with up to 300 characters of the reply the interrupt cut off. That reply is drawn from its own
// row (interruptCutText), so the notice drops it and keeps the rest.
const MIRRORED_CUT = / The reply it cut off: [\s\S]*$/;
const withoutMirroredCut = (text: string) => (/^(?:sminos|doperpowers): interrupt: /.test(text) ? text.replace(MIRRORED_CUT, '') : text);

// The sminos bridge's row of an interrupt's cut-off reply (`@shared/lane-a/interrupt-cut`), its whole text: a meta user
// row of its plugin (sminos, or doperpowers before sminos 1.0.0) whose one text block opens with the row's line; else null.
function interruptCutText(record: TranscriptRecord): string | null {
  const origin = record.origin as { kind?: unknown; name?: unknown } | undefined;
  if (record.type !== 'user' || record.isMeta !== true || origin?.kind !== 'plugin' || (origin.name !== 'sminos' && origin.name !== 'doperpowers')) return null;
  const text = singleText(record);
  return text !== null && parseInterruptCut(text) !== null ? text : null;
}

// The end of a turn that ran nothing (`num_turns` 0), as the live stream has one: a prompt a hook blocked, a command the
// terminal ran.
function endedOf(base: Base, uuid: MessageUuid, resultText: string | null): SessionEvent {
  return {
    ...base(),
    kind: 'turn.ended',
    result: 'success',
    isError: false,
    terminalReason: null,
    resultText,
    durationMs: 0,
    numTurns: 0,
    costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null },
    permissionDenials: [],
    errors: [],
    userMessageUuids: [uuid],
    origin: null,
    resultIndex: null,
    isEchoReceipt: false,
  };
}

// P5 O9 (the M10 sitting): a command typed at the terminal (`/model haiku`, `/effort low`) is written as three user
// records: the engine's `<local-command-caveat>` (meta), the command's own record under it (`<command-name>…`, not
// meta), then its output (2.1.312, the sitting's transcript; w1-compact.jsonl lines 30-32 on 2.1.283). The command's
// record opens its turn as any prompt does, its words the person's bubble, but a local command runs no model: nothing
// on disk ends that turn (no `turn_duration`), so its turn ends where it starts, as the live stream's `result` for a
// local command ends it, and the output joins it. Only the record under a caveat: a skill's command record has none,
// and its turn runs the model. Called on every user record with text a context maps, in order.
function localCommandTurn(record: TranscriptRecord, ctx: BackfillContext): boolean {
  const kind = localCommandKind(record);
  const caveat = ctx.localCaveat;
  ctx.localCaveat = kind === 'caveat' && typeof record.uuid === 'string' ? (record.uuid as MessageUuid) : null;
  return kind === 'echo' && caveat !== null && record.parentUuid === caveat;
}

// A prompt a UserPromptSubmit hook blocked leaves no user record, only a system `informational` record:
// `UserPromptSubmit operation blocked by hook:\n<blockingError>` and, unless the hook suppressed it, `\n\nOriginal
// prompt: <prompt>` (2.1.283 cli.pretty.js 525245-525248). The first such separator splits them. The same record is
// written for a prompt submitted on its own and for a steer dropped at the mid-turn fold (systemEvents tells them apart
// by `inToolLoop`), so the follower does not count it as a turn end.
const BLOCKED_PROMPT = 'UserPromptSubmit operation blocked by hook:\n';
const ORIGINAL_PROMPT = '\n\nOriginal prompt: ';
function blockedPrompt(record: TranscriptRecord): { text: string; blockingError: string; prompt: string | null } | null {
  if (record.type !== 'system' || record.subtype !== 'informational' || typeof record.content !== 'string' || !record.content.startsWith(BLOCKED_PROMPT)) return null;
  const text = record.content;
  const rest = text.slice(BLOCKED_PROMPT.length);
  const at = rest.indexOf(ORIGINAL_PROMPT);
  return at < 0 ? { text, blockingError: rest, prompt: null } : { text, blockingError: rest.slice(0, at), prompt: rest.slice(at + ORIGINAL_PROMPT.length) };
}

// A prompt that opens a turn: a `user` record, not `isMeta`, not an interrupt marker, whose content is text or blocks
// with no tool result (a tool result continues the turn its tool use is in). The follower reads turn boundaries by it.
export function startsTurn(record: TranscriptRecord): boolean {
  if (record.type !== 'user' || record.isMeta === true || record.isCompactSummary === true || isInterruptMarker(record) || isLocalCommandOutput(record)) return false; // W1: a compact summary and a command's output too
  const content = messageContent(record);
  if (isNoContent(content)) return false; // P5 O9: the engine's word for a message with none
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  const blocks = content.filter(isContentBlock);
  return blocks.length > 0 && blocks.every((block) => block.type !== 'tool_result');
}

// The marker the engine writes after an interrupt (`[Request interrupted by user]`, `… for tool use`): C3's
// `INTERRUPT_MARKER`, tested on the string content or on the joined text of the record's non-result blocks when all of
// them are text (the array form is the common one on disk). C3's normaliser tags it `origin: 'interrupt-marker'` on the
// wire; the backfill does the same, and it opens no turn.
function isInterruptMarker(record: TranscriptRecord): boolean {
  if (record.type !== 'user' || (record.origin as { kind?: unknown } | undefined)?.kind === 'human') return false;
  const content = messageContent(record);
  let text: string | null = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const others = content.filter(isContentBlock).filter((block) => block.type !== 'tool_result');
    if (others.length > 0 && others.every((block) => block.type === 'text' && typeof block.text === 'string')) text = others.map((block) => block.text as string).join('');
  }
  return text !== null && INTERRUPT_MARKER.test(text.trim());
}

// W1 (A5): a slash command's output, `<local-command-stdout>…` after the command's own record (w1-compact.jsonl line
// 32, the terminal's `/exit` in w1-terminal-queued.jsonl), is the engine's echo, not a prompt: it belongs to the
// command's turn, as the live stream's replay of it does (pass3/compact seq 45), so it opens none of its own (a turn of
// its own read "Worked for 0s" under a bubble-less divider).
function isLocalCommandOutput(record: TranscriptRecord): boolean {
  return localCommandKind(record) === 'caveat' || localCommandKind(record) === 'output';
}

// Shared with the follower: engine-tagged local history, not arbitrary slash-prefixed human/skill prompts.
// A user command echo also needs a preceding caveat to distinguish it from a skill invocation. UX wave U3: a terminal
// writes a command itself as a `system` row too (`u3-terminal-commands-r1`, lines 56, 70 and 77), its whole text the
// command's tags: that row is the command's echo, and every other such row its output.
export function localCommandKind(record: TranscriptRecord): 'caveat' | 'echo' | 'output' | null {
  if (record.type === 'system') {
    if (record.subtype !== 'local_command' && record.subtype !== 'local_command_output') return null;
    return typeof record.content === 'string' && slashCommandLine(record.content) !== null ? 'echo' : 'output';
  }
  if (record.type !== 'user') return null;
  const text = singleText(record);
  if (text === null) return null;
  if (/^\s*<local-command-caveat>/.test(text)) return 'caveat';
  if (/^\s*<local-command-(stdout|stderr)>/.test(text)) return 'output';
  return slashCommandLine(text) === null ? null : 'echo';
}

// Shared with the follower: human prompts are barriers even when encoded outside user records.
// A queued steer need not open a turn, so this is deliberately broader than startsTurn.
export function isHumanPrompt(record: TranscriptRecord): boolean {
  return (startsTurn(record) && !isTaskNotification(record)) || blockedPrompt(record) !== null || humanQueuedPrompt(record) !== null;
}

// SPEC 35 resume cleanup (i6): matching prose from a real model or diagnostic is not bookkeeping.
export function isNoResponseMarker(record: TranscriptRecord): boolean {
  return record.type === 'assistant' && record.isApiErrorMessage !== true
    && (record.message as { model?: unknown } | undefined)?.model === '<synthetic>'
    && singleText(record) === 'No response requested.';
}

export function singleText(record: TranscriptRecord): string | null {
  const content = messageContent(record);
  return typeof content === 'string' ? content : Array.isArray(content) && content.length === 1 && isContentBlock(content[0]) && content[0].type === 'text' && typeof content[0].text === 'string' ? content[0].text : null;
}

function messageContent(record: TranscriptRecord): unknown {
  return (record.message as { content?: unknown } | undefined)?.content;
}

const isContentBlock = (value: unknown): value is ContentBlock & { [k: string]: unknown } =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

type Bash = Extract<SessionEvent, { kind: 'user.message' }>['bash'];

// Bash-mode messages carry their command and output as tags (`<bash-input>`, `<bash-stdout>…<bash-exit-code>`).
function parseBash(content: string): Bash {
  const input = /^<bash-input>([\s\S]*?)<\/bash-input>/.exec(content);
  if (input) return { part: 'input', command: input[1] };
  const stdout = /<bash-stdout>([\s\S]*?)<\/bash-stdout>/.exec(content);
  if (!stdout) return null;
  const stderr = /<bash-stderr>([\s\S]*?)<\/bash-stderr>/.exec(content);
  const exit = /<bash-exit-code>(-?\d+)<\/bash-exit-code>/.exec(content);
  return { part: 'output', stdout: stdout[1], stderr: stderr?.[1] ?? '', exitCode: exit ? Number(exit[1]) : 0 };
}

// C1's derivation rule: the tags are stripped from the content and `bash` is filled.
function bashStripped(content: string, bash: Bash): string {
  if (bash === null) return content;
  if (bash.part === 'input') return bash.command;
  return bash.stderr.length > 0 ? `${bash.stdout}\n${bash.stderr}` : bash.stdout;
}

// The same disk shape used by the follower's response-delivery classification: a user record whose text is the engine's
// `<task-notification>` blocks (SPEC 20.9), read as the arrivals reader reads them (`@shared/engine/task-notification`).
export function isTaskNotification(record: TranscriptRecord): boolean {
  const content = messageContent(record);
  return record.type === 'user' && typeof content === 'string' && notificationText(content, (record.origin as { kind?: unknown } | undefined)?.kind) !== null;
}
