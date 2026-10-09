// X3 identifiers (C6 execution document, "X3 — identifiers and classification"): every row and cell id is a
// deterministic function of X1 identifiers, never a position, so a re-derived turn yields the same ids and the
// virtualiser keeps its anchor and the reader's expansion state.
import type { ApiMessageId, EventId, MessageUuid, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';
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
  local: (message: MessageUuid) => row(`local:${message}`), // a local-command echo row
  localOfEvent: (id: EventId) => row(`local:${id}`),
  // E1 start: an `ask` call's capsule and a `send_file` call's delivery row, keyed by the tool use (the ask's askId)
  ask: (toolUse: ToolUseId) => row(`ask:${toolUse}`),
  delivery: (toolUse: ToolUseId) => row(`delivery:${toolUse}`),
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
};

export const cellId = {
  tool: (toolUse: ToolUseId) => cell(`cell:${toolUse}`),
  thinking: (apiMessageId: ApiMessageId, blockIndex: number) => cell(`cell:think:${blockIdentity(apiMessageId, blockIndex)}`),
  reads: (firstToolUse: ToolUseId) => cell(`cell:reads:${firstToolUse}`),
};
