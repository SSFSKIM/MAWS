// X3, the presentation model (charter §13 X3, owned by C6; C6 execution document, Interfaces "X3"). The tree of rows,
// cells and cell detail that C7's cards and C8's drill-in render; derived from X1 events and never crossing a process,
// so these are TypeScript types (the snapshot suite's zod schemas join in M2).
import type * as z from 'zod';
import type { DenialKind, PLAN_OUTCOMES, SafeguardVerdict } from '@shared/graph/enums';
import type { ContentBlock, Question, TokenUsage } from '@shared/graph/events';
import type { AgentId, MessageUuid, RequestId, TaskId, ToolUseId } from '@shared/graph/ids';
import type { AskCancelReason } from '@shared/maws/ask'; // E1
import type { AskAnswer, AskQuestion } from '@shared/maws/tools'; // E1
// E3 start
import type { Anchor, AnchorKind } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
// E3 end
import type { ListingSection } from './agent-listing'; // E7
import type { BrowserToolName, BrowserWaitReason } from '@shared/maws/browser'; // E4c

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
        // E3 start: what the prompt is about, when MAWS framed it as an anchored comment (X10; parsed from its own text by
        // `userTextOf`, which strips the framing from `text`); absent on every other prompt
        anchor?: Anchor;
        // E3 end
      } // steer: sent while its turn was running (joins that turn at its delivery position, no turn of its own); dropped: the engine never ran it; lines: its hard line breaks (W2: the bubble folds by its rendered height, not by these)
    | { kind: 'assistant_text'; messageUuid: MessageUuid | null; blockIndex: number; markdown: string; live: boolean; phase: 'answer' | 'commentary'; forHuman?: boolean; model: string | null }
    | {
        kind: 'divider'; state: 'working' | 'completed' | 'stopped' | 'failed'; cause?: 'crash' /* E11: present when the engine, not the reader, stopped it */; origin: 'human' | 'engine' | 'peer'; startedAt: string; endedAt: string | null;
        toolCalls: number; denied: number; autoDenied: number; firstDeniedCell: CellId | null; expanded: boolean; summary: TurnSummary;
      }
    | { kind: 'group'; state: 'active' | 'completed'; cells: Cell[]; summary: string; activeLabel: string | null; icon: ToolCategory; expanded: boolean }
    | ({ kind: 'cell' } & Cell) // a standalone cell
    | { kind: 'receipt'; files: ChangedFile[]; added: number; removed: number; state: 'applied' | 'undoing' | 'undone' | 'reapplying'; canUndo: boolean; canReapply: boolean }
    | { kind: 'subagent'; agents: SubagentRef[]; sentence: string; status: SubagentStatus; overflow: number } // overflow: agents beyond the four glyphs
    | {
        kind: 'agent_message'; direction: 'to_child' | 'from_child' | 'between'; from: SubagentRef | null; to: SubagentRef | null; text: string;
        peer?: PeerMessage; report?: string; // E7: a message between sessions (`between`); an in-process agent's hand-back report
        body?: string; // E7: an in-process agent's whole message, when the text shows only its preview
      }
    | { kind: 'thinking'; messageUuid: MessageUuid | null; text: string; live: boolean; durationMs: number | null }
    | { kind: 'plan'; toolUseId: ToolUseId; plan: string; outcome: (typeof PLAN_OUTCOMES)[number] | null; feedback: string | null }
    | { kind: 'question'; toolUseId: ToolUseId; questions: Question[]; answers: Record<string, string> | null; error: string | null } // E1 (A-17): error, the engine's refusal of the call, tags stripped
    | {
        kind: 'request_slot'; requestId: RequestId; toolUseId: ToolUseId | null;
        requestKind: 'permission' | 'question' | 'plan' | 'dialog' | 'elicitation'; toolName: string | null; requestedAt: string;
      }
    | {
        kind: 'error'; severity: 'transient' | 'error' | 'notice'; text: string; attempt: { n: number; max: number | null } | null;
        scope: 'turn' | 'task' | 'process' | 'transport' | 'request' | 'api' | 'reconnect' | 'notice' | 'exit' | 'hook' | 'plugin'; lostAttentionCount: number | null; // R1: 'plugin', a plugin's log line (a dim notice) or load issue
        action?: 'edit_prompt' | 'engine_settings'; // W1: a hook blocked the turn's own prompt; the row offers Edit prompt (that prompt back into the composer). W13: a newer engine sent what MAWS did not understand; the row opens Settings › Engine
      }
    | { kind: 'boundary'; boundaryKind: 'compaction' | 'reset' | 'retraction' | 'rewind'; text: string; secondary?: string; detail: string | null; hiddenRows: number; revealed: boolean }
    | { kind: 'bash'; command: string; stdout: string; stderr: string; exitCode: number | null; cwd: string | null }
    | { kind: 'local_command'; messageUuid: MessageUuid | null; text: string } // the engine's `<local-command-stdout>` echo after a slash command (C3's `origin: 'local-command'`), tags stripped; a replayed row, never a bubble
    // E1 start: the `maws` server's rows (E1 execution document, Interfaces "The renderer"): an `ask` call's capsule and
    // a `send_file` call's delivery row, derived from the calls themselves and refined by the `maws.*` events
    | { kind: 'ask'; toolUseId: ToolUseId; askId: string; title: string | null; context: string | null; blocking: boolean; questions: AskQuestion[]; state: 'pending' | 'asked' | 'answered' | 'cancelled' | 'error'; answers: AskAnswer[] | null; error: string | null; cancelReason: AskCancelReason | null /* why a cancelled ask was cancelled, when an event said; else null */ }
    | { kind: 'delivery'; toolUseId: ToolUseId; files: { path: string; name: string; id: string | null }[]; caption: string | null; urgency: 'normal' | 'high'; error: string | null }
    // E1 end
    // E3 start: a side thread opened from this session (E3 execution document, Design §5 and §6): one row per child, in
    // the turn or loose block its first event landed in, updated in place by each summary. `label`, `anchorKind` and
    // `openedBy` are null until the thread's `opened` event is seen (a summary can arrive first); `turns` counts the
    // thread's ended turns, and `state` and `text` are the latest one's
    | {
        kind: 'side_thread'; childAppSessionId: AppSessionId; label: string | null; anchorKind: AnchorKind | null; openedBy: 'comment' | 'btw' | null;
        state: 'opened' | 'finished' | 'failed'; text: string | null; turns: number;
      }
    // E3 end
    // E7 start: a `ListAgents` result as the lists it names (E7 execution document, Design §4): pending until the result
    // arrives; `raw` is the result's text, the sections and notes its parse (agent-listing.ts)
    | { kind: 'agent_list'; toolUseId: ToolUseId; self: string | null; sections: ListingSection[]; notes: string[]; raw: string; pending: boolean }
    // E7 end
    // E2 start: an `artifact_create` or `artifact_update` call's row (E2 execution document, Design §9): from the call,
    // filled by its result and refined by `maws.delivery.artifact`; `title` null until a source names it (an update may
    // carry none), `deliverableId` and `version` null until the version is registered; `answered` once the call's result
    // is in (a result that does not parse leaves the version null on an answered row)
    | { kind: 'artifact'; toolUseId: ToolUseId; action: 'create' | 'update'; artifactId: string; title: string | null; htmlPath: string; deliverableId: string | null; version: number | null; error: string | null; answered: boolean }
    // E2 end
    // E4c start: a browser tool call's row (E4c execution document, Design §10): from the call (`action`, `tabId`,
    // `target` as `maws.browser.action` names them; `value`: a select's option, a key, a check or a scroll amount, never
    // what a fill typed), filled by its result (the page, `ms`, the element's role and name, a snapshot's whole size in
    // `chars` and whether it was cut in `truncated` (an eval's value too), a listing's `tabCount`, and `detail`: a snapshot's text or an eval's value) and refined by the event. `state`
    // cancelled: the turn closed with no result, or the engine stopped the call; `answered` once the result is in
    | {
        kind: 'browser_action'; toolUseId: ToolUseId; tool: BrowserToolName; action: string; tabId: string | null; target: string | null;
        targetRole: string | null; targetName: string | null; value: string | null; url: string | null; title: string | null; ms: number | null;
        deliverableId: string | null; error: string | null; waitedFor: BrowserWaitReason | null; waitedMs: number | null; chars: number | null; truncated: boolean;
        tabCount: number | null; state: 'running' | 'done' | 'error' | 'cancelled'; detail: string | null; answered: boolean;
      }
    // E4c end
  );

// E1: an ask as its capsule holds it, without the row base: what the Question sheet shows when the capsule reopens it
// (residue 14), so an answered ask reopens from its own data after a reload or in a disk-only session.
export type AskRowData = Omit<Extract<Row, { kind: 'ask' }>, keyof RowBase | 'kind'>;

// E7 start: a message between sessions (E7 execution document, Design §4). Inbound (`sender` set) from a `peer.message`;
// outbound (`recipient` set) from a SendMessage whose `to` names no agent of this transcript. `sender.name` is the
// envelope's `from-name` (null when it had none; the view labels the address as the TUI does); `recipient.address` the
// call's `to`, its `name` the one an earlier message from that address gave. `replyTo` is the address a Reply answers,
// null when the engine says SendMessage cannot reach it. `result` is an outbound send's: pending until its tool result,
// failed with `resultText` when the engine could not send it; `summary` the call's own summary.
export interface PeerMessage {
  sender: { name: string | null; address: string; session: string | null } | null;
  recipient: { name: string | null; address: string } | null;
  body: string;
  preview: string; // the body's first line, cut to 120 columns
  replyTo: string | null;
  toolUseId: ToolUseId | null;
  messageUuid: MessageUuid | null;
  result: 'pending' | 'sent' | 'failed' | null;
  resultText: string | null;
  summary: string | null;
}

// Whether a message's preview leaves some of its body out (more lines, or a cut first line): then the row offers the
// whole of it and the markdown copy quotes it. Surrounding whitespace hides nothing.
export const previewHidesBody = (body: string, preview: string): boolean => body.trim() !== preview;
// E7 end

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
  // E7 start: a workflow's run id, from the Workflow call's launch result (E7 execution document, Design §2)
  runId?: string;
  // E7 end
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
