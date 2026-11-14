// X3 classification (C6 execution document, "X3 — classification"): tool name → category, presentation and the
// overrides, total over MCP, plugin and future tools. The table is the contract; `presentationOf` says which tool
// names are rows of another kind rather than cells.
import type { DenialKind, SafeguardVerdict } from '@shared/graph/enums';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, ApiMessageId, ToolUseId } from '@shared/graph/ids';
import { MAWS_SERVER_NAME, MAWS_TOOL_NAMES, type MawsToolName } from '@shared/maws/tools'; // E1
import { HISTORICAL_ARTIFACT_UPDATE } from '@shared/maws/artifact-update'; // P3-A
import type { BrowserToolName } from '@shared/maws/browser'; // E4c
import { isMessageTool } from '@shared/owner/message-call'; // P4-R7
import type { ToolCategory, ToolClassification } from './rows';

export type Presentation = 'cell' | 'subagent' | 'agent_message' | 'question' | 'plan' | /* E1 */ 'ask' | 'delivery' | /* E7 */ 'agent_list' | /* E2 */ 'artifact' | /* E4c */ 'browser_action' | /* P4-R7 */ 'message';

// E1 start: the names the engine gives the `maws` server's tools (X9), as tool uses carry them
export const MAWS_TOOL_USE = Object.fromEntries(MAWS_TOOL_NAMES.map((name) => [name, `mcp__${MAWS_SERVER_NAME}__${name}`])) as Readonly<Record<MawsToolName, string>>;
// E1 end
// P3-A: E2's `artifact_update` as tool uses carried it, retired into `artifact_publish`; frozen, classifying only the
// journals and fixtures written before
export const HISTORICAL_ARTIFACT_UPDATE_TOOL_USE = `mcp__${MAWS_SERVER_NAME}__${HISTORICAL_ARTIFACT_UPDATE}`;

// E4c start: the six browser tools' names as tool uses carried them (each call a `browser_action` row). Frozen: the tools
// left the `maws` server on 2026-10-08 (P1 A-54), and these names classify only journals and fixtures written before.
export const HISTORICAL_BROWSER_TOOL_USE: Readonly<Record<BrowserToolName, string>> = Object.freeze({
  browser_tabs: 'mcp__maws__browser_tabs', browser_navigate: 'mcp__maws__browser_navigate',
  browser_snapshot: 'mcp__maws__browser_snapshot', browser_act: 'mcp__maws__browser_act',
  browser_eval: 'mcp__maws__browser_eval', browser_screenshot: 'mcp__maws__browser_screenshot',
});
// E4c end

// E13 start: the cua plugin's `js` tool (the in-app browser spec of 2026-10-08, "Action rows"), as the engine names it
// when the plugin is installed and when cua_repl is registered by hand. The agent's browser work arrives as these calls,
// opaque to MAWS; what it did in the in-app browser (`browser.agent.activity`) is shown under them.
export const CUA_JS_TOOLS = ['mcp__plugin_cua_cua_repl__js', 'mcp__cua_repl__js'] as const;
export const isCuaJsTool = (toolName: string): boolean => (CUA_JS_TOOLS as readonly string[]).includes(toolName);
// E13 end

// DC9 start (the desk's session view, 2026-10-17; desk composite §9.5): the ask mod's tool, which stands in for the
// built-in AskUserQuestion in a terminal session running the ask mod; its result is read in ask-mod.ts. The engine names
// it by the plugin that registers it: doperpowers' until the ask moved to the sminos plugin (doperpowers' sminos plugin
// design, §11), sminos's after. Transcripts and machines not yet rolled keep the old name, so both are read, for good.
export const ASK_MOD_TOOLS = ['mcp__sminos__AskUserQuestion', 'mcp__doperpowers__AskUserQuestion'] as const;
export const isAskModTool = (toolName: string): boolean => (ASK_MOD_TOOLS as readonly string[]).includes(toolName);
// DC9 end

const ROW_KIND_TOOLS: Record<string, Presentation> = {
  Agent: 'subagent', Task: 'subagent', Workflow: 'subagent',
  SendMessage: 'agent_message',
  AskUserQuestion: 'question',
  // DC9: the ask mod's question, a question as the built-in's is, under either name
  ...Object.fromEntries(ASK_MOD_TOOLS.map((name) => [name, 'question' as const])),
  ExitPlanMode: 'plan',
  // E1 start: an ask is a capsule, a delivered file a delivery row
  [MAWS_TOOL_USE.ask]: 'ask',
  [MAWS_TOOL_USE.send_file]: 'delivery',
  // E1 end
  // E7 start: a listing of the agents and sessions this one can message is a row of its own (E7 execution document,
  // Design §4)
  ListAgents: 'agent_list',
  // E7 end
  // E2 start: an artifact version the agent registered is an artifact row (P3-A: a publish too, as an update was)
  [MAWS_TOOL_USE.artifact_create]: 'artifact',
  [MAWS_TOOL_USE.artifact_publish]: 'artifact',
  [HISTORICAL_ARTIFACT_UPDATE_TOOL_USE]: 'artifact',
  // E2 end
  // E4c start: every historical browser tool call is a browser action row (E4c execution document, Design §10)
  ...Object.fromEntries(Object.values(HISTORICAL_BROWSER_TOOL_USE).map((name) => [name, 'browser_action' as const])),
  // E4c end
};

// P4-R7: a call of a message tool (`@shared/owner/message-call`: the to-human plugin's, and MAWS's former one in a
// recorded session) is the message it sends (derive.ts's `to_human` row).
export function presentationOf(toolName: string): Presentation {
  if (isMessageTool(toolName)) return 'message';
  return Object.hasOwn(ROW_KIND_TOOLS, toolName) ? ROW_KIND_TOOLS[toolName] : 'cell';
}

interface TableRow { category: ToolCategory; groupable: boolean }
const grouped = (category: ToolCategory): TableRow => ({ category, groupable: true });
const standalone = (category: ToolCategory): TableRow => ({ category, groupable: false });

const TABLE: Record<string, TableRow> = {
  Skill: grouped('skills'), ToolSearch: grouped('skills'),
  Read: grouped('exploration'), Glob: grouped('exploration'), LS: grouped('exploration'), LSP: grouped('exploration'), NotebookRead: grouped('exploration'),
  Grep: grouped('exploration'),
  Edit: grouped('files'), MultiEdit: grouped('files'), Write: grouped('files'), NotebookEdit: grouped('files'),
  Bash: grouped('commands'), PowerShell: grouped('commands'), BashOutput: grouped('commands'), KillShell: grouped('commands'), Monitor: grouped('commands'),
  WebFetch: grouped('web'), WebSearch: grouped('web'),
  // UX wave U2 (O-29; X3's classification as amended by the U2a document, decision 10): the bookkeeping calls are
  // ordinary steps of their run, nothing inside a run is hidden
  EnterPlanMode: grouped('other'), EnterWorktree: grouped('other'), ExitWorktree: grouped('other'),
  TodoWrite: grouped('other'), TaskCreate: grouped('other'), TaskUpdate: grouped('other'), TaskList: grouped('other'),
  TaskGet: grouped('other'), TaskOutput: grouped('other'), TaskStop: grouped('other'),
  // E1 start: a pane shown for the model is a cell of its own, never folded into a group of MCP calls
  [MAWS_TOOL_USE.show_pane]: standalone('other'),
  // E1 end
  // E7 start: the scheduling tools by name (as the fallback would class them), so a job's creating call is a known cell
  // that Background work's `Open creating turn` jumps to (E7 execution document, Design §7)
  CronCreate: grouped('other'), CronList: grouped('other'), CronDelete: grouped('other'),
  // E7 end
  // UX wave U2 (l6-artifacts-12): the artifact namespace's plain calls join runs and are named by the artifact's title,
  // as every other call is a step of its run (E2, P3-B M7, P3-E and P4-B4 had made each a cell of its own; each
  // document records the reversal). A screenshot stays one: its result is an image, which stands alone on every route
  [MAWS_TOOL_USE.artifact_list]: grouped('other'),
  [MAWS_TOOL_USE.artifact_screenshot]: standalone('other'),
  [MAWS_TOOL_USE.artifact_describe_type]: grouped('other'),
  [MAWS_TOOL_USE.artifact_read]: grouped('other'),
  [MAWS_TOOL_USE.artifact_upload_asset]: grouped('other'),
  [MAWS_TOOL_USE.artifact_list_assets]: grouped('other'),
  [MAWS_TOOL_USE.artifact_export]: grouped('other'),
  [MAWS_TOOL_USE.artifact_edit]: grouped('other'),
  [MAWS_TOOL_USE.artifact_comments]: grouped('other'),
  [MAWS_TOOL_USE.artifact_reply]: grouped('other'),
  [MAWS_TOOL_USE.artifact_resolve]: grouped('other'),
  [MAWS_TOOL_USE.artifact_dataset]: grouped('other'),
  [MAWS_TOOL_USE.artifact_search]: grouped('other'),
  // E13 start: a cua_repl `js` call is a cell of its own, never folded into a group of MCP calls, so the browser
  // activity under it is in view without opening a group (it folds with the turn's work, as every cell does)
  [CUA_JS_TOOLS[0]]: standalone('mcp'),
  [CUA_JS_TOOLS[1]]: standalone('mcp'),
  // E13 end
};

export const MCP_TOOL = /^mcp__([^_].*?)__(.+)$/;

// The table first (E1: a `maws` tool may have its own row), then the MCP pattern.
export function tableRowOf(toolName: string): TableRow {
  if (Object.hasOwn(TABLE, toolName)) return TABLE[toolName];
  return MCP_TOOL.test(toolName) ? grouped('mcp') : grouped('other');
}

export interface ClassifyContext {
  denial: { kind: DenialKind; reason: string | null } | null;
  turn: DenialTurn;
  continued: boolean; // work of the model followed the call's result in its turn (`continuedAfter`)
  humanDecision: boolean;
  safeguard: SafeguardVerdict;
  imageResult: boolean;
  isError: boolean;
}

export const isAbortedReason = (terminalReason: string | null) => terminalReason !== null && terminalReason.startsWith('aborted');

// How a refused call's turn stands: whether it closed, and whether it closed as stopped, the state its line reads
// (`closedAsStopped` in cells.ts), by the evidence each route has.
export interface DenialTurn {
  closed: boolean;
  stopped: boolean;
}

// The denial table under Derivation, one row per DENIAL_KINDS member. UX wave U2 (decision 23, the architect's ruling R1
// of 2026-11-13): a call the person rejected reads stopped from its result on, the same on every route; it reads denied
// only once work of the model followed its result in the same turn (`continued`) or its turn closed otherwise than
// stopped. A Stop and "Deny and stop the turn" leave exactly this; a Deny that lets the turn go on is `permission-rule`.
export function denialDisposition(kind: DenialKind, turn: DenialTurn, continued: boolean): { disposition: 'denied' | 'auto_denied' | 'stopped'; interruption: boolean } {
  switch (kind) {
    case 'user-rejected':
      return continued || (turn.closed && !turn.stopped) ? { disposition: 'denied', interruption: false } : { disposition: 'stopped', interruption: true };
    case 'permission-rule':
      return { disposition: 'denied', interruption: false };
    case 'automode-blocked':
    case 'automode-parsing-error':
      return { disposition: 'auto_denied', interruption: false };
    case 'automode-unavailable':
    case 'interrupted':
    case 'cancelled':
      return { disposition: 'stopped', interruption: false };
  }
}

// Whether an event is of the loop a transcript draws (`agentId`: the transcript's agent, null for the session's main
// loop). The main loop's events have no parent attribution. A child agent's own transcript keeps its events' attribution
// (the call that launched it, by the file's context and the wire's lane; none for a workflow agent), so its loop is its
// own agent's events, as its source selects them (`ownOf`, transcript/source/ipc.ts); an agent below it is not.
const ofLoop = (event: SessionEvent, agentId: AgentId | null) => (agentId === null ? event.parentToolUseId === null : event.agentId === agentId);

// UX wave U2 (decision 23): the turn's `user-rejected` results after which work of the model follows, in one pass over
// the turn's events. Work of the model is an assistant block of the transcript's own loop (`ofLoop`) that belongs to
// another API message than the one that made the call: a block's delta or completion, or a call, whose message id is set
// and is not the call's. The engine starts a call before its message is whole, so a later call of the same message is
// no such work; nor is another call's result, the interrupt marker, a steer, a hook's or a task's event, the engine's
// API error envelope, the block of an agent below the loop or the turn's end.
export function continuedAfter(events: readonly SessionEvent[], agentId: AgentId | null): ReadonlySet<ToolUseId> {
  const messageOf = new Map<ToolUseId, ApiMessageId | null>();
  // the rejected results no work has followed yet, grouped by the message that made their call: a block of another
  // message settles a whole group at once, so each result is visited once and the pass stays linear
  const waiting = new Map<ApiMessageId | null, ToolUseId[]>();
  const continued = new Set<ToolUseId>();
  for (const event of events) {
    if (!ofLoop(event, agentId)) continue;
    if (event.kind === 'tool.result') {
      if (event.denial !== 'user-rejected') continue;
      const of = messageOf.get(event.toolUseId) ?? null;
      const group = waiting.get(of);
      if (group) group.push(event.toolUseId);
      else waiting.set(of, [event.toolUseId]);
      continue;
    }
    const message = event.kind === 'tool.use' || event.kind === 'assistant.block.delta' || (event.kind === 'assistant.block.complete' && event.isApiErrorMessage !== true) ? event.apiMessageId : null;
    if (event.kind === 'tool.use') messageOf.set(event.toolUseId, event.apiMessageId);
    if (message === null || waiting.size === 0) continue;
    for (const [of, calls] of waiting) {
      if (of === message) continue;
      for (const call of calls) continued.add(call);
      waiting.delete(of);
    }
  }
  return continued;
}

// UX wave U2 (decision 23): a refused call that reads stopped is a member of its run, its status stopped (a Stop, the
// engine's interrupt or cancel); `automode-unavailable` reads stopped too but stands alone, for the person may have to
// act on it. Every other refusal (denied, auto-denied) stands alone.
export const stoppedMember = (denial: { kind: DenialKind; disposition: 'denied' | 'auto_denied' | 'stopped' }): boolean =>
  denial.disposition === 'stopped' && denial.kind !== 'automode-unavailable';

// Total over tool names; `startsGroup` is the group state machine's (derive.ts) and starts false here. UX wave U2
// (O-29): who allowed a call no longer decides whether it joins a run (only the live route knows it); `humanDecision`
// stays a fact of the classification.
export function classifyTool(toolName: string, _input: unknown, context: ClassifyContext): ToolClassification {
  const row = tableRowOf(toolName);
  let groupable = row.groupable;
  let denial: ToolClassification['denial'] = null;
  if (context.denial) {
    denial = { kind: context.denial.kind, reason: context.denial.reason, ...denialDisposition(context.denial.kind, context.turn, context.continued) };
    if (!stoppedMember(denial)) groupable = false;
  }
  if (context.imageResult) groupable = false;
  return {
    groupable,
    category: row.category,
    denial,
    subagentLifecycle: null,
    startsGroup: false,
    safeguard: context.safeguard,
    humanDecision: context.humanDecision,
  };
}
