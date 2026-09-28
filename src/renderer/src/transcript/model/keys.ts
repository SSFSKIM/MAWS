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
  reconnect: (firstAttempt: EventId) => row(`reconnect:${firstAttempt}`), // one row per episode, keyed by its first 'attempting' event, updated in place
  boundary: (id: EventId) => row(`boundary:${id}`),
  bash: (inputMessage: MessageUuid) => row(`bash:${inputMessage}`),
  bashOfEvent: (id: EventId) => row(`bash:${id}`),
  local: (message: MessageUuid) => row(`local:${message}`), // a local-command echo row
  localOfEvent: (id: EventId) => row(`local:${id}`),
};

export const cellId = {
  tool: (toolUse: ToolUseId) => cell(`cell:${toolUse}`),
  thinking: (apiMessageId: ApiMessageId, blockIndex: number) => cell(`cell:think:${blockIdentity(apiMessageId, blockIndex)}`),
  hook: (hookId: string) => cell(`cell:hook:${hookId}`),
  reads: (firstToolUse: ToolUseId) => cell(`cell:reads:${firstToolUse}`),
};
