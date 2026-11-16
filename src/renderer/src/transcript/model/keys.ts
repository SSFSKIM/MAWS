// X3 identifiers (C6 execution document, "X3 — identifiers and classification"): every row and cell id is a
// deterministic function of X1 identifiers, never a position, so a re-derived turn yields the same ids and the
// virtualiser keeps its anchor and the reader's expansion state.
import type { AgentId, ApiMessageId, AppSessionId, EventId, MessageUuid, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { CellId, RowId, TurnId } from './rows';

const row = (id: string) => id as RowId;
const cell = (id: string) => id as CellId;

// Text and thinking rows key on the block identity, which a live delta already carries (*Streaming*).
export const blockIdentity = (apiMessageId: ApiMessageId, blockIndex: number) => `${apiMessageId}:${blockIndex}`;

export const turnId = {
  ofMessage: (uuid: MessageUuid) => `turn:${uuid}` as TurnId,
  ofEvent: (id: EventId) => `turn:e${id}` as TurnId, // engine-initiated turns, or a user message without uuid
};

export const rowId = {
  time: (turn: TurnId) => row(`time:${turn}`),
  timeOfRow: (loose: RowId) => row(`time:${loose}`), // a separator before a loose row (one outside any turn)
  user: (uuid: MessageUuid) => row(`user:${uuid}`),
  userOfEvent: (id: EventId) => row(`user:${id}`),
  // UX wave U1c (Interfaces §C, 5): the n-th grant of a person's message drawn as an approval row beside it, keyed by the
  // message's uuid (its event's id when it has none) and the grant's place among the message's marks
  grant: (message: MessageUuid | EventId, n: number) => row(`grant:${message}:${n}`),
  text: (apiMessageId: ApiMessageId, blockIndex: number) => row(`text:${blockIdentity(apiMessageId, blockIndex)}`),
  think: (apiMessageId: ApiMessageId, blockIndex: number) => row(`think:${blockIdentity(apiMessageId, blockIndex)}`),
  divider: (turn: TurnId) => row(`divider:${turn}`),
  group: (firstCell: CellId) => row(`group:${firstCell}`),
  cell: (id: CellId) => id as RowId & CellId, // a standalone cell's row is keyed by its CellId (the `cell` row variant carries both brands)
  receipt: (turn: TurnId) => row(`receipt:${turn}`),
  subagent: (task: TaskId) => row(`subagent:${task}`), // a grouped sentence uses its first task id
  agentMessage: (id: EventId) => row(`agentmsg:${id}`),
  plan: (toolUse: ToolUseId) => row(`plan:${toolUse}`),
  question: (toolUse: ToolUseId) => row(`question:${toolUse}`),
  slot: (request: RequestId) => row(`slot:${request}`),
  error: (id: EventId) => row(`error:${id}`),
  retry: (turn: TurnId) => row(`retry:${turn}`),
  hook: (hookId: string) => row(`hook:${hookId}`), // a hook that got in the way (W1), keyed by the engine's hook id
  held: (queueId: string) => row(`held:${queueId}`), // W1: a message held in MAWS's queue, a tail bubble until it is released
  reconnect: (firstAttempt: EventId) => row(`reconnect:${firstAttempt}`), // one row per episode, keyed by its first 'attempting' event, updated in place
  boundary: (id: EventId) => row(`boundary:${id}`),
  bash: (inputMessage: MessageUuid) => row(`bash:${inputMessage}`),
  bashOfEvent: (id: EventId) => row(`bash:${id}`),
  // UX wave U3 (the U3a document, decision 11): a notice by what both forms of a session share, the run a task's end names,
  // else its carrier (its message's uuid, or the event's id when it has none) and its place in the carrier's arrivals
  notice: (runId: string | null, carrier: MessageUuid | EventId, index: number) => row(runId !== null ? `notice:${runId}` : `notice:${carrier}:${index}`),
  local: (message: MessageUuid) => row(`local:${message}`), // a local-command echo row
  localOfEvent: (id: EventId) => row(`local:${id}`),
  cut: (id: EventId) => row(`cut:${id}`), // P5 O9: a reply an interrupt cut off, as the sminos bridge records it
  // E1 start: an `ask` call's capsule and a `send_file` call's delivery row, keyed by the tool use (the ask's askId)
  ask: (toolUse: ToolUseId) => row(`ask:${toolUse}`),
  delivery: (toolUse: ToolUseId) => row(`delivery:${toolUse}`),
  toHuman: (toolUse: ToolUseId) => row(`to-human:${toolUse}`), // P4-R7: a message tool's call, keyed by its tool use as an ask is
  // E1 end
  sideThread: (child: string) => row(`side:${child}`), // E3: one row per side thread, keyed by the child's app session id
  // E7 start: a `ListAgents` call's listing row, keyed by the tool use
  agentList: (toolUse: ToolUseId) => row(`agents:${toolUse}`),
  // E7 end
  // E2 start: an artifact call's row, keyed by the tool use
  artifact: (toolUse: ToolUseId) => row(`artifact:${toolUse}`),
  // E2 end
  // E4c start: a browser tool call's row, keyed by the tool use
  browserAction: (toolUse: ToolUseId) => row(`browser:${toolUse}`),
  // E4c end
  // E13: a browser activity standing alone, keyed by the number the window gave it on arrival
  browserActivity: (seq: number) => row(`browser-activity:${seq}`),
  // UX wave U2b (Interfaces §C): a stretch's line in the to-human view where MAWS draws it, closed (`› working record`)
  // or open (`‹ fold to report`, under its last row): two rows, so each keeps its own place in the list
  recordFold: (stretch: string, open: boolean) => row(`record-fold:${open ? 'open' : 'closed'}:${stretch}`),
};

export const cellId = {
  tool: (toolUse: ToolUseId) => cell(`cell:${toolUse}`),
  thinking: (apiMessageId: ApiMessageId, blockIndex: number) => cell(`cell:think:${blockIdentity(apiMessageId, blockIndex)}`),
  reads: (firstToolUse: ToolUseId) => cell(`cell:reads:${firstToolUse}`),
};

// UX wave U1b (Interfaces §C, decision 1): the transcript's end row, one per transcript, whose id is constant so the
// virtual list keeps its measured height; its request id names the transcript it ends, for the host seam's renderer.
// The prefix is no request id the engine (a UUID) or a bridge (a tool-use id) makes, and the parts are URI-encoded, so
// a session id and an agent id of any text round-trip and the one `/` reads unambiguously.
export const END_ROW = row('request-end');
const END_PREFIX = 'maws-transcript-end:';
export function endRequestId(appSessionId: AppSessionId, agentId: AgentId | null): RequestId {
  return `${END_PREFIX}${encodeURIComponent(appSessionId)}${agentId === null ? '' : `/${encodeURIComponent(agentId)}`}` as RequestId;
}
export function endRequestOf(requestId: RequestId): { appSessionId: AppSessionId; agentId: AgentId | null } | null {
  if (!requestId.startsWith(END_PREFIX)) return null;
  const [session, agent, ...rest] = requestId.slice(END_PREFIX.length).split('/');
  if (session === '' || rest.length > 0) return null;
  try {
    return { appSessionId: decodeURIComponent(session) as AppSessionId, agentId: agent === undefined ? null : (decodeURIComponent(agent) as AgentId) };
  } catch {
    return null; // a malformed escape: no id this module made
  }
}
