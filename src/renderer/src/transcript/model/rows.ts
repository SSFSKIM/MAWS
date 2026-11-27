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
import type { Destination } from '@shared/anchor/message';
import type { AppSessionId } from '@shared/graph/ids';
// E3 end
import type { ListingSection } from './agent-listing'; // E7
import type { BrowserToolName, BrowserWaitReason } from '@shared/maws/browser'; // E4c
import type { BrowserActivity } from '@shared/browser/activity'; // E13
import type { Arrival } from '@shared/engine/arrival-schema'; // UX wave U3
import type { Range } from '@shared/engine/composed-content'; // ticket 733a

/** UX wave U1c: what a grant names (the U1c document, Interfaces §B); here with the row types, so they need nothing of `blocked.ts`. */
export interface BlockedCall { kind: 'command' | 'call'; subject: string }

export type TurnId = string & z.$brand<'TurnId'>; // `turn:<userMessageUuid>`; `turn:e<eventId>` for engine-initiated turns or a user message without uuid
export type RowId = string & z.$brand<'RowId'>; // formats in keys.ts
export type CellId = string & z.$brand<'CellId'>; // `cell:<toolUseId>`; `cell:think:<apiMessageId>:<blockIndex>`; `cell:reads:<firstToolUseId>` for a merged read cell

export const TOOL_CATEGORIES = ['mcp', 'skills', 'files', 'exploration', 'commands', 'web', 'other'] as const; // fixed summary order (X3); `other` is phrased only when it is the sole category
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

// Attached to every tool event at derivation time (X3's five fields, plus the two X1 facts the renderer shows in detail).
export interface ToolClassification {
  groupable: boolean; // false ⇒ standalone: the cell is a row of its own and breaks the group run
  category: ToolCategory;
  denial: { kind: DenialKind; disposition: 'denied' | 'auto_denied' | 'stopped'; interruption: boolean; reason: string | null } | null; // disposition from the denial table under Derivation; interruption: user-rejected inside an aborted turn
  subagentLifecycle: 'start' | 'progress' | 'finish' | 'message' | null;
  startsGroup: boolean; // a new group begins here even though the previous cell was groupable
  safeguard: SafeguardVerdict;
  humanDecision: boolean; // a permission.requested for this tool use was resolved by the human ('user')
}

// E11 (scale-review C scalpel-2#1): the framing X10's parse took off an anchored prompt besides its anchor: where the
// comment went (null for a `/btw` promotion, which has no lead) and whether its lead announced a screenshot.
export interface AnchorFrame {
  destination: Destination | null;
  screenshot: boolean;
}

// UX wave U5a (Interfaces §H, decision 13): one comment of a message that carried several, in the order made; `attachment`
// is the index in the row's `attachments` of the screenshot its lead announced, when every announced one can be paired
export interface UserComment {
  anchor: Anchor;
  text: string;
  attachment?: number;
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
        unread?: true; // UX wave U4a (decision 12): it waited behind a turn and has neither started nor been dropped; a mount with a stack draws it there, not here
        answer?: true; // board ticket 715: its content is one of MAWS's answer envelopes whole, read as the split reads it (`answerEnvelopeOf`)
        // E3 start: what the prompt is about, when MAWS framed it as an anchored comment (X10; parsed from its own text by
        // `userTextOf`, which strips the framing from `text`); absent on every other prompt
        anchor?: Anchor;
        anchorFrame?: AnchorFrame; // E11 (scale-review C scalpel-2#1): how MAWS framed it, beside `anchor`, so an edit resends the comment framed again
        // E3 end
        comments?: UserComment[]; // UX wave U5a (§H): a message of two or more comments, which then has no `anchor` and no `anchorFrame`
        commentsTo?: 'thread'; // UX wave U5a (M5's review): such a message framed for a side thread, which only a thread opens with
        // UX wave U3 (UC-2, class `consent`; the U3a document, decision 10): the prompt is MAWS's "Approve and retry" for
        // a call auto mode blocked, drawn as one line of the person's act, never a bubble; absent on every other prompt
        consent?: { kind: 'command' | 'call'; subject: string };
        // UX wave U1c (the U1c document, Design 2): on an approval row drawn beside a message (its own `messageUuid` is
        // null: no point to rewind to, no prompt to edit), the message it stands beside, so the rows go where it goes
        beside?: MessageUuid;
        // UX wave U1c (Decision Log 45): on an approval row, the engine has started its message (its turn accepted); the
        // one sign by which its blocked call reads approved, absent in every state before that and in any the model
        // cannot place
        started?: true;
        // Ticket 733a (its document, Design 4 and §D): where each pasted segment of one of MAWS's forms (an anchored message,
        // a promotion, a plan prompt) was drawn in place in `text`, in order, as `placeholders` records each chip's place;
        // absent when none was. Layout only: what an edit sends again is the form's own reader's to say
        composed?: Range[];
      } // steer: sent while its turn was running (joins that turn at its delivery position, no turn of its own); dropped: the engine never ran it; lines: its hard line breaks (W2: the bubble folds by its rendered height, not by these)
    | { kind: 'assistant_text'; messageUuid: MessageUuid | null; blockIndex: number; markdown: string; live: boolean; phase: 'answer' | 'commentary'; forHuman?: boolean; model: string | null; cut?: true; partway?: true; reportOnly?: true } // cut (P5 O9): a terminal session's reply an interrupt cut before the engine wrote it, which the session kept none of; partway: its text starts partway through; reportOnly (UX wave U2b): set by the mirror alone, on a closed stretch's head, whose words outside its messages are out of sight
    | {
        kind: 'divider'; state: 'working' | 'completed' | 'stopped' | 'failed'; cause?: 'crash' | 'message' /* E11: present when the engine, not the reader, stopped it; UX wave U4a: `message`, a message sent now ended it */; origin: 'human' | 'engine' | 'peer'; startedAt: string; endedAt: string | null;
        toolCalls: number; denied: number; autoDenied: number; firstDeniedCell: CellId | RowId | null; expanded: boolean; summary: TurnSummary; files?: ChangedFile[];
        // UX wave U3 (UC-2, "The rows"): on a turn the person did not start, what stands at its head and opened it, for U2
        // to name the turn from: that arrival's class and its row's words (no lead mark, no owners)
        opener?: { class: Arrival['class']; line: string };
        // UX wave U2 (O-15; the U2a document, Interfaces §B): what the turn did, by caption.ts's builder over every step of
        // the turn, ordered by what changed and capped (`''` while the turn runs and for a turn with no step); every part's
        // text, uncapped (empty while it runs), for the popover; and the lines the main loop's finished edits added and
        // removed, for every turn, a running one included
        caption: string;
        fold?: number; // the word cut (T2): the count the caption ends in (`+6`), absent for none
        parts: string[];
        counts: ChangedLines;
      }
    // UX wave U2 (O-29; Interfaces §B): `summary` is the run's caption (caption.ts), `counts` its finished edits' lines
    | { kind: 'group'; state: 'active' | 'completed'; cells: Cell[]; summary: string; fold?: number /* the word cut (T2): the count `summary` ends in, absent for none */; counts: ChangedLines; icon: ToolCategory; expanded: boolean }
    | ({ kind: 'cell'; runExpanded?: boolean /* board ticket 852: present on a run of one (groups.ts `drawsAsRun`), its run's open state */ } & Cell) // a standalone cell
    | { kind: 'receipt'; files: ChangedFile[]; added: number; removed: number; state: 'applied' | 'undoing' | 'undone' | 'reapplying'; canUndo: boolean; canReapply: boolean }
    | { kind: 'subagent'; agents: SubagentRef[]; sentence: string; status: SubagentStatus; phases?: Record<string, string>; exited?: true; overflow: number } // overflow: agents beyond the four glyphs; phases (the word cut, T87): each working workflow's phase by its task id, for its glyph's or line's pointing; exited (UX wave U3b, decision 19): every agent it names ended with the session's process, the row stopped
    | {
        kind: 'agent_message'; direction: 'to_child' | 'from_child' | 'between'; from: SubagentRef | null; to: SubagentRef | null; text: string;
        // the word cut (T73): whether the message comes in from the party its line names or goes out to it, apart from its
        // routing (a child's send to `main` is routed up, `from_child`, and goes out to main)
        flow: 'in' | 'out';
        peer?: PeerMessage; report?: string; // E7: a message between sessions (`between`); an in-process agent's hand-back report
        body?: string; // E7: an in-process agent's whole message; U3 (O-12): of every message to or from a subagent, which its line opens to
      }
    | { kind: 'thinking'; messageUuid: MessageUuid | null; text: string; live: boolean; durationMs: number | null; recordedMs: number | null; clock?: 'wall' } // clock (P5 O7 M10): a terminal session's streamed block (lane A's overlay), its `at` this window's time when first drawn, not an event's
    // UX wave U1b (Interfaces §B): `waiting` while the session's list holds a request for the call (its form is drawn in
    // the row); `dismissed` for an asynchronous question whose delivery says it was dismissed. Each written only when true
    | { kind: 'plan'; toolUseId: ToolUseId; plan: string; outcome: (typeof PLAN_OUTCOMES)[number] | null; feedback: string | null; waiting?: true }
    | { kind: 'question'; toolUseId: ToolUseId; questions: Question[]; answers: Record<string, string> | null; error: string | null /* E1 (A-17): the engine's refusal of the call, tags stripped */; waiting?: true; dismissed?: true }
    // The question sheet's C3 M5 (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §I): a call of the
    // sminos tool in the sheet's form (`isSheetCall`), one line per entry of its `ask`, from the transcript alone (S8):
    // its result's first line, later calls and the deliveries' blocks the transcript holds. `error`: the engine's refusal
    // of the whole call, its tags stripped
    | { kind: 'sheet'; toolUseId: ToolUseId; state: 'running' | 'done' | 'nothing' | 'unknown' | 'error'; lines: SheetRowLine[]; withdrew: string[]; notDone: string | null; error: string | null }
    | {
        kind: 'request_slot'; requestId: RequestId; toolUseId: ToolUseId | null;
        requestKind: 'permission' | 'question' | 'plan' | 'dialog' | 'elicitation'; toolName: string | null; requestedAt: string;
      }
    | {
        kind: 'error'; severity: 'transient' | 'error' | 'notice'; text: string; attempt: { n: number; max: number | null } | null;
        scope: 'turn' | 'task' | 'process' | 'transport' | 'request' | 'api' | 'reconnect' | 'notice' | 'exit' | 'hook' | 'plugin'; lostAttentionCount: number | null; // R1: 'plugin', a plugin's log line (a dim notice) or load issue
        action?: 'edit_prompt' | 'engine_settings'; // W1: a hook blocked the turn's own prompt; the row offers Edit prompt (that prompt back into the composer). W13: a newer engine sent what MAWS did not understand; the row opens Settings › Engine
      }
    | { kind: 'gap'; text: string } // P5 O7 M2: events here were not delivered (model/gap.ts): "Earlier history isn't available"
    | { kind: 'boundary'; boundaryKind: 'compaction' | 'reset' | 'retraction' | 'rewind'; text: string; secondary?: string; detail: string | null; hiddenRows: number; revealed: boolean }
    | { kind: 'bash'; command: string; stdout: string; stderr: string; exitCode: number | null; cwd: string | null }
    // UX wave U3 (UC-2, "The rows"; the U3a document, Interfaces D): what the engine told the agent of a background task's
    // end, a scheduled prompt's firing, an answer to a question asked without waiting, or the sminos bridge's wake, as one
    // line. `text` is the engine's sentence for a task; `detail` what it delivered with it (opened under the line);
    // `outputFile` the task's output, which "Open output" opens where the mount gives an act for it
    | {
        kind: 'notice'; class: 'task' | 'schedule' | 'answer' | 'wake'; outcome: 'completed' | 'failed' | 'stopped' | null;
        text: string; durationMs: number | null; detail: string | null; taskId: TaskId | null; toolUseId: ToolUseId | null; outputFile: string | null;
      }
    // the engine's `<local-command-stdout>` echo after a slash command (C3's `origin: 'local-command'`), tags stripped; never
    // a bubble. UX wave U3b (Interfaces B): drawn as a light line, with four marks, each present only where it says something
    | { kind: 'local_command'; messageUuid: MessageUuid | null; text: string;
        error?: true;                               // all of it came in <local-command-stderr>
        run?: { command: string; args: string };    // commandOf(event.arrival).run: the command the engine ran
        plain?: true;                               // commandOf(event.arrival).plain: a terminal's text, not markdown
        lone?: true }                               // its turn holds no bubble of a command, or it has no turn
    // E1 start: the `maws` server's rows (E1 execution document, Interfaces "The renderer"): an `ask` call's capsule and
    // a `send_file` call's delivery row, derived from the calls themselves and refined by the `maws.*` events
    | { kind: 'ask'; toolUseId: ToolUseId; askId: string; title: string | null; context: string | null; blocking: boolean; questions: AskQuestion[]; state: 'pending' | 'asked' | 'answered' | 'cancelled' | 'error'; answers: AskAnswer[] | null; error: string | null; cancelReason: AskCancelReason | null /* why a cancelled ask was cancelled, when an event said; else null */; waiting?: true /* UX wave U1b */ }
    | { kind: 'delivery'; toolUseId: ToolUseId; files: { path: string; name: string; id: string | null }[]; caption: string | null; urgency: 'normal' | 'high'; error: string | null; neverAnswered?: true /* E11: its turn closed with no result and no event */ }
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
    | { kind: 'agent_list'; toolUseId: ToolUseId; self: string | null; sections: ListingSection[]; notes: string[]; raw: string; pending: boolean; neverAnswered?: true /* E11: as the delivery row's */ }
    // E7 end
    // E2 start: an `artifact_create` or `artifact_update` call's row (E2 execution document, Design §9): from the call,
    // filled by its result and refined by `maws.delivery.artifact`; `title` null until a source names it (an update may
    // carry none), `deliverableId` and `version` null until the version is registered; `answered` once the call's result
    // is in (a result that does not parse leaves the version null on an answered row)
    // P2-E1: `ownerAppSessionId`, from the result or the event, when the version is a side thread's ancestor's record's
    | {
        kind: 'artifact'; toolUseId: ToolUseId; action: 'create' | 'update' | 'delete' /* UX wave U10b */; artifactId: string; title: string | null; htmlPath: string; deliverableId: string | null; version: number | null; error: string | null; answered: boolean;
        neverAnswered?: true /* E11: as the delivery row's */; ownerAppSessionId?: AppSessionId /* P2-E1 */;
        revision?: number /* P3-L (M6b fix wave 2): the revision the call wrote, when its answer or event named it */;
        why?: string /* UX wave U10b (M5, §C.4): a refused delete's reason key, read from the refusal's JSON */;
      }
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
    // E13 start: what an agent did in the in-app browser through cua (the in-app browser spec of 2026-10-08, "Action
    // rows"; M3 fix wave), a persistent row as the browser action row is: under the cua_repl `js` call it happened in
    // (`toolUseId`, and `turnId` its turn), or standalone with neither (a download that completed after its turn, a dialog
    // MAWS answered by default). Never derived from X1 events: the transcript view places it (browser-activity.ts)
    | { kind: 'browser_activity'; toolUseId: ToolUseId | null; appSessionId: AppSessionId; tabId: string; activity: BrowserActivity }
    // E13 end
    // UX wave U2b (the execution document, Interfaces §C): a stretch's line in the to-human view where MAWS draws it,
    // never derived here, placed by the mirror (`owner/view/mirror.ts`): `stretch` is the stretch's key, `open` once the
    // reader opened it (the line then stands under the stretch's last row). M7 (§M): `label`, on a closed line alone, the
    // words it reads (the stretch's newest call while it grows, else the mod's stored summary); absent, `working record`
    | { kind: 'record_fold'; stretch: string; open: boolean; label?: string }
    // P4-R7: a call of a message tool the host reads (`@shared/owner/message-call`; classify.ts, `presentationOf`) as the
    // to-human message it sends, at the call's place among the turn's rows, drawn as a message and never as an MCP row:
    // `pending` until its result is in.
    // A refused or failed call, or one whose turn closed without a result, is the engine's own cell instead. It stays
    // in view when its turn's work folds whatever the owner lane says: a message is always addressed to the human, as
    // a `<message>` span is, which the presenter draws with the lane off and so keeps (derive.ts, `isPersistentRow`).
    | { kind: 'to_human'; toolUseId: ToolUseId; text: string; pending: boolean }
    // UX wave U3b (decision 17, Interfaces §E): what the session is doing now that no turn line says, at the drawn list's
    // end: placed by the view (`view/compacting.ts`), never derived and never in the store's rows; `since` when this
    // window first saw the session compacting
    | { kind: 'activity'; activity: 'compacting'; since: string }
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
  // P5 O15 M2b: owners, the names the sender's sminos frame wrote as its owners (an email or a member id), as written;
  // null: the frame attested none, or there was no frame
  sender: { name: string | null; address: string; session: string | null; owners: string[] | null } | null;
  recipient: { name: string | null; address: string } | null;
  body: string;
  preview: string; // the body's first line, cut to 120 columns; U3 (O-12): without a leading `@address` token, which the opened body keeps
  replyTo: string | null;
  toolUseId: ToolUseId | null;
  messageUuid: MessageUuid | null;
  result: 'pending' | 'sent' | 'failed' | 'unanswered' | null; // E11: 'unanswered', its turn closed with no result
  resultText: string | null;
  summary: string | null;
}

// Whether a message's preview leaves some of its body out (more lines, or a cut first line): then the row offers the
// whole of it and the markdown copy quotes it. Surrounding whitespace hides nothing.
export const previewHidesBody = (body: string, preview: string): boolean => body.trim() !== preview;
// A text's first line cut to 120 columns, as the TUI previews a message (the line's ellipsis at the column's edge is the
// view's). UX wave U3 (O-12): a message's preview leaves out a leading `@address` token, which names whom it was sent to;
// the opened message keeps it.
const PREVIEW_COLUMNS = 120;
export function firstLineOf(text: string): string {
  const line = text.trimStart().split('\n')[0]!.trimEnd();
  return line.length > PREVIEW_COLUMNS ? `${line.slice(0, PREVIEW_COLUMNS - 1)}…` : line;
}
const LEADING_ADDRESS = /^@\S+\s+/;
export function previewOf(body: string): string {
  const rest = body.trimStart().replace(LEADING_ADDRESS, '');
  return firstLineOf(rest.trim() === '' ? body : rest);
}

// UX wave U3 (O-12): what a message's line leaves out, for the markdown copy: a hand-back's report, or the whole message
// when its line shows only part of it; null when the line holds it all. Opened, the line always shows the whole message.
export function messageMore(row: Extract<Row, { kind: 'agent_message' }>): string | null {
  if (row.report !== undefined) return row.report;
  const body = row.peer?.body ?? row.body;
  return body !== undefined && previewHidesBody(body, row.peer?.preview ?? previewOf(body)) ? body : null;
}
// E7 end

export type RowKind = Row['kind'];

/**
 * One entry of a sheet call, as its row's line (§I). `id` is the question it is on the sheet as, null for a refused
 * entry and for every entry of a call whose outcome is not known; `entry` its place in the call's `ask`, from 1;
 * `revises` whether the entry named an id (a revise, as the call put it). `place`: `here` in the last call of the
 * transcript that added or revised the question, `revised_below` in every earlier one, `refused` for an entry not
 * asked. `outcome` what the transcript holds of the question, on its `here` line only.
 */
export interface SheetRowLine {
  id: string | null;
  entry: number;
  header: string | null;
  sentence: string;
  revises: boolean;
  place: 'here' | 'revised_below' | 'refused';
  outcome: { how: 'answered'; receipt: string } | { how: 'dismissed' } | { how: 'withdrawn' } | null;
}

export interface Attachment {
  kind: 'image' | 'file' | 'text';
  name: string;
  bytes: number | null;
  dataUrl: string | null;
  mediaType: string | null;
  text: string | null; // the content of a `text` attachment (pasted content, *Pasted content* under Derivation), null otherwise
}
export interface ChangedLines {
  added: number;
  removed: number;
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
  label: string; // diagnostic/copy label (copy.ts)
  summary?: string; // optional engine summary; never replaces a denial diagnostic
  moved?: true; // UX wave U4a (decision 33): the engine moved the call to the background (rec.moved)
  paths: string[]; // file chips; a merged read cell lists every path
  reads?: ToolUseId[]; // UX wave U2b (M7; §M): on a merged read cell alone, each member read's tool-use id, in order
  startedAt: string;
  endedAt: string | null;
  detail: CellDetail;
  expanded: boolean;
  agent: SubagentRef | null; // set when rendered inside a child transcript (variant 'child')
  // UX wave U2 (decision 20): the call has its result and its recorded status still reads running, a call moved to the
  // background; a mod's draw-time status does not change it
  background: boolean;
  // UX wave U2 (Interfaces §B): what the call's row reads in its done form, where its own label reads another (a stopped
  // call's `Stopped: …`, a failed artifact call's `Could not …`): the words a caption gives a call of no kind
  doneLabel?: string;
  // UX wave U2 (decision 13): why a failed call failed, the first line of its error, which its row draws after the label;
  // only on a cell whose status is `error` (a refused call says why in its label, a stopped one did not fail)
  error?: string;
  /** UX wave U1c: what a grant for this call names; present only on a call auto mode blocked that has a name. */
  blocked?: BlockedCall;
}

export type CellDetail =
  | {
      kind: 'shell'; command: string; description: string | null; cwd: string | null; stdout: string; stderr: string; exitCode: number | null; interrupted: boolean;
      backgroundTaskId: TaskId | null; truncated: Truncation | null; spill: Spill | null;
      rowCwd?: string; // UX wave U8c-2 (§K): the folder the call's row records, where the call was read from rows; absent live
    }
  | { kind: 'edit'; filePath: string; change: 'create' | 'update' | 'delete'; hunks: Hunk[]; added: number; removed: number }
  | { kind: 'read'; files: { path: string; range: [number, number] | null }[]; preview: string | null; truncated: Truncation | null }
  | { kind: 'search'; query: string; scope: string | null; matches: number | null; output: string; truncated: Truncation | null }
  | { kind: 'web'; url: string | null; query: string | null; output: string; truncated: Truncation | null }
  | { kind: 'mcp'; server: string; tool: string; input: unknown; result: string | ContentBlock[]; structured: unknown; spill: Spill | null }
  | { kind: 'image'; images: { dataUrl: string; mediaType: string; alt: string | null }[]; caption: string | null }
  | { kind: 'thinking'; text: string; durationMs: number | null; recordedMs: number | null }
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
  denials: { kind: DenialKind; cellId: CellId | RowId; disposition: 'denied' | 'auto_denied' | 'stopped'; interruption: boolean }[]; // `denied` counts disposition 'denied', `autoDenied` counts 'auto_denied'; 'stopped' entries are listed and counted in neither. `cellId` is a refused sent message's row id where the refusal is that row's (the architect's ruling of 2026-11-13: a fold never hides a denial)
  autoDenied: number;
  safeguard: { reviewed: number; flagged: number; notEvaluated: number }; // shown here and in cell detail only (§19)
  costUsd: number | null;
  usage: TokenUsage | null;
  model: string | null;
  childAgents: number;
  terminalReason: string | null;
}
