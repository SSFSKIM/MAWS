// X3, the presentation model (charter §13 X3, owned by C6; C6 execution document, Interfaces "X3"). The tree of rows,
// cells and cell detail that C7's cards and C8's drill-in render; derived from X1 events and never crossing a process,
// so these are TypeScript types (the snapshot suite's zod schemas join in M2).
import type * as z from 'zod';
import type { DenialKind, PLAN_OUTCOMES, SafeguardVerdict } from '@shared/graph/enums';
import type { ContentBlock, Question, TokenUsage } from '@shared/graph/events';
import type { AgentId, MessageUuid, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';

export type TurnId = string & z.$brand<'TurnId'>; // `turn:<userMessageUuid>`; `turn:e<eventId>` for engine-initiated turns or a user message without uuid
export type RowId = string & z.$brand<'RowId'>; // formats in keys.ts
export type CellId = string & z.$brand<'CellId'>; // `cell:<toolUseId>`; `cell:think:<apiMessageId>:<blockIndex>`; `cell:reads:<firstToolUseId>` for a merged read cell

export const TOOL_CATEGORIES = ['mcp', 'skills', 'files', 'exploration', 'commands', 'web', 'other'] as const; // fixed summary order (X3); `other` is phrased only when it is the sole category
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

// Attached to every tool event at derivation time (X3's five fields, plus the two X1 facts the renderer shows in detail).
export interface ToolClassification {
  groupable: boolean; // false ⇒ standalone: the cell is a row of its own and breaks the group run
  hidden: boolean; // true ⇒ the cell exists in the expanded group but contributes no summary phrase (bookkeeping tools)
  category: ToolCategory;
  denial: { kind: DenialKind; disposition: 'denied' | 'auto_denied' | 'stopped'; interruption: boolean; reason: string | null } | null; // disposition from the denial table under Derivation; interruption: user-rejected inside an aborted turn
  subagentLifecycle: 'start' | 'progress' | 'finish' | 'message' | null;
  startsGroup: boolean; // a new group begins here even though the previous cell was groupable
  safeguard: SafeguardVerdict;
  humanDecision: boolean; // a permission.requested for this tool use was resolved by the human ('user')
}

export interface RowBase {
  id: RowId;
  turnId: TurnId | null;
  at: string;
}

export type Row = RowBase &
  (
    | { kind: 'time'; label: string } // "Today 1:12 AM"
    | {
        kind: 'user'; messageUuid: MessageUuid | null; text: string; attachments: Attachment[]; placeholders: number[]; lines: number; editable: boolean; steer: boolean; dropped: boolean;
        pending?: 'next' | 'held'; // W1: not taken yet, a dimmed tail bubble: 'next' a steer the engine delivers at the running turn's next step, 'held' in MAWS's queue until the turn ends
      } // steer: sent while its turn was running (joins that turn at its delivery position, no turn of its own); dropped: the engine never ran it; lines: its hard line breaks (W2: the bubble folds by its rendered height, not by these)
    | { kind: 'assistant_text'; messageUuid: MessageUuid | null; blockIndex: number; markdown: string; live: boolean; phase: 'answer' | 'commentary'; model: string | null }
    | {
        kind: 'divider'; state: 'working' | 'completed' | 'stopped' | 'failed'; origin: 'human' | 'engine' | 'peer'; startedAt: string; endedAt: string | null;
        toolCalls: number; denied: number; autoDenied: number; firstDeniedCell: CellId | null; expanded: boolean; summary: TurnSummary;
      }
    | { kind: 'group'; state: 'active' | 'completed'; cells: Cell[]; summary: string; activeLabel: string | null; icon: ToolCategory; expanded: boolean }
    | ({ kind: 'cell' } & Cell) // a standalone cell
    | { kind: 'receipt'; files: ChangedFile[]; added: number; removed: number; state: 'applied' | 'undoing' | 'undone' | 'reapplying'; canUndo: boolean; canReapply: boolean }
    | { kind: 'subagent'; agents: SubagentRef[]; sentence: string; status: SubagentStatus; overflow: number } // overflow: agents beyond the four glyphs
    | { kind: 'agent_message'; direction: 'to_child' | 'from_child' | 'between'; from: SubagentRef | null; to: SubagentRef | null; text: string }
    | { kind: 'thinking'; messageUuid: MessageUuid | null; text: string; live: boolean; durationMs: number | null }
    | { kind: 'plan'; toolUseId: ToolUseId; plan: string; outcome: (typeof PLAN_OUTCOMES)[number] | null; feedback: string | null }
    | { kind: 'question'; toolUseId: ToolUseId; questions: Question[]; answers: Record<string, string> | null }
    | {
        kind: 'request_slot'; requestId: RequestId; toolUseId: ToolUseId | null;
        requestKind: 'permission' | 'question' | 'plan' | 'dialog' | 'elicitation'; toolName: string | null; requestedAt: string;
      }
    | {
        kind: 'error'; severity: 'transient' | 'error' | 'notice'; text: string; attempt: { n: number; max: number | null } | null;
        scope: 'turn' | 'task' | 'process' | 'transport' | 'request' | 'api' | 'reconnect' | 'notice' | 'exit' | 'hook'; lostAttentionCount: number | null;
        action?: 'edit_prompt' | 'engine_settings'; // W1: a hook blocked the turn's own prompt; the row offers Edit prompt (that prompt back into the composer). W13: a newer engine sent what MAWS did not understand; the row opens Settings › Engine
      }
    | { kind: 'boundary'; boundaryKind: 'compaction' | 'reset' | 'retraction' | 'rewind'; text: string; detail: string | null; hiddenRows: number; revealed: boolean }
    | { kind: 'bash'; command: string; stdout: string; stderr: string; exitCode: number | null; cwd: string | null }
    | { kind: 'local_command'; messageUuid: MessageUuid | null; text: string } // the engine's `<local-command-stdout>` echo after a slash command (C3's `origin: 'local-command'`), tags stripped; a replayed row, never a bubble
  );

export type RowKind = Row['kind'];

export interface Attachment {
  kind: 'image' | 'file' | 'text';
  name: string;
  bytes: number | null;
  dataUrl: string | null;
  mediaType: string | null;
  text: string | null; // the content of a `text` attachment (pasted content, *Pasted content* under Derivation), null otherwise
}
export interface ChangedFile {
  path: string;
  change: 'create' | 'update' | 'delete';
  added: number;
  removed: number;
  cellId: CellId;
}
export interface SubagentRef {
  taskId: TaskId;
  agentId: AgentId | null;
  toolUseId: ToolUseId | null;
  name: string;
  glyph: number;
  kind: 'agent' | 'workflow';
  subagentType: string | null;
}
export type SubagentStatus = 'started' | 'working' | 'finished' | 'finished_with_errors' | 'stopped';

export interface Cell {
  id: CellId;
  toolUseId: ToolUseId | null;
  toolName: string;
  category: ToolCategory;
  classification: ToolClassification;
  status: 'running' | 'done' | 'error' | 'denied' | 'stopped';
  label: string; // the one line the collapsed cell shows (copy.ts)
  paths: string[]; // file chips; a merged read cell lists every path
  startedAt: string;
  endedAt: string | null;
  detail: CellDetail;
  expanded: boolean;
  agent: SubagentRef | null; // set when rendered inside a child transcript (variant 'child')
}

export type CellDetail =
  | {
      kind: 'shell'; command: string; description: string | null; cwd: string | null; stdout: string; stderr: string; exitCode: number | null; interrupted: boolean;
      backgroundTaskId: TaskId | null; truncated: Truncation | null; spill: Spill | null;
    }
  | { kind: 'edit'; filePath: string; change: 'create' | 'update' | 'delete'; hunks: Hunk[]; added: number; removed: number }
  | { kind: 'read'; files: { path: string; range: [number, number] | null }[]; preview: string | null; truncated: Truncation | null }
  | { kind: 'search'; query: string; scope: string | null; matches: number | null; output: string; truncated: Truncation | null }
  | { kind: 'web'; url: string | null; query: string | null; output: string; truncated: Truncation | null }
  | { kind: 'mcp'; server: string; tool: string; input: unknown; result: string | ContentBlock[]; structured: unknown; spill: Spill | null }
  | { kind: 'image'; images: { dataUrl: string; mediaType: string; alt: string | null }[]; caption: string | null }
  | { kind: 'thinking'; text: string; durationMs: number | null }
  | { kind: 'generic'; input: unknown; result: string | ContentBlock[]; structured: unknown; isError: boolean; spill: Spill | null; truncated: Truncation | null };

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[]; // the engine's structuredPatch shape, lines prefixed ' ', '+', '-'
}
export interface Truncation {
  shownHead: number;
  shownTail: number;
  omittedBytes: number;
}
export interface Spill {
  path: string;
  bytes: number | null;
  state: 'not_loaded' | 'loading' | 'loaded' | 'partial' | 'failed'; // partial (M5, additive): only the head was read (fs.readSpill truncated it at the 2 MB the loader reads)
  content: string | null;
}

export interface TurnSummary {
  durationMs: number | null;
  toolCalls: number;
  byCategory: Record<ToolCategory, number>;
  denials: { kind: DenialKind; cellId: CellId; disposition: 'denied' | 'auto_denied' | 'stopped'; interruption: boolean }[]; // `denied` counts disposition 'denied', `autoDenied` counts 'auto_denied'; 'stopped' entries are listed and counted in neither
  autoDenied: number;
  safeguard: { reviewed: number; flagged: number; notEvaluated: number }; // shown here and in cell detail only (§19)
  costUsd: number | null;
  usage: TokenUsage | null;
  model: string | null;
  childAgents: number;
  terminalReason: string | null;
}
