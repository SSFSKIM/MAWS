// X3 classification (C6 execution document, "X3 — classification"): tool name → category, presentation and the
// overrides, total over MCP, plugin and future tools. The table is the contract; `presentationOf` says which tool
// names are rows of another kind rather than cells.
import type { DenialKind, SafeguardVerdict } from '@shared/graph/enums';
import { MAWS_SERVER_NAME, MAWS_TOOL_NAMES, type MawsToolName } from '@shared/maws/tools'; // E1
import { HISTORICAL_ARTIFACT_UPDATE } from '@shared/maws/artifact-update'; // P3-A
import type { BrowserToolName } from '@shared/maws/browser'; // E4c
import type { ToolCategory, ToolClassification } from './rows';

export type Presentation = 'cell' | 'subagent' | 'agent_message' | 'question' | 'plan' | /* E1 */ 'ask' | 'delivery' | /* E7 */ 'agent_list' | /* E2 */ 'artifact' | /* E4c */ 'browser_action';

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

const ROW_KIND_TOOLS: Record<string, Presentation> = {
  Agent: 'subagent', Task: 'subagent', Workflow: 'subagent',
  SendMessage: 'agent_message',
  AskUserQuestion: 'question',
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

export function presentationOf(toolName: string): Presentation {
  return Object.hasOwn(ROW_KIND_TOOLS, toolName) ? ROW_KIND_TOOLS[toolName] : 'cell';
}

interface TableRow { category: ToolCategory; groupable: boolean; hidden: boolean }
const grouped = (category: ToolCategory, hidden = false): TableRow => ({ category, groupable: true, hidden });
const standalone = (category: ToolCategory): TableRow => ({ category, groupable: false, hidden: false });

const TABLE: Record<string, TableRow> = {
  Skill: grouped('skills'), ToolSearch: grouped('skills'),
  Read: grouped('exploration'), Glob: grouped('exploration'), LS: grouped('exploration'), LSP: grouped('exploration'), NotebookRead: grouped('exploration'),
  Grep: grouped('exploration'),
  Edit: grouped('files'), MultiEdit: grouped('files'), Write: grouped('files'), NotebookEdit: grouped('files'),
  Bash: grouped('commands'), BashOutput: grouped('commands'), KillShell: grouped('commands'), Monitor: grouped('commands'),
  WebFetch: grouped('web'), WebSearch: grouped('web'),
  EnterPlanMode: grouped('other', true), EnterWorktree: grouped('other', true), ExitWorktree: grouped('other', true),
  TodoWrite: grouped('other', true), TaskCreate: grouped('other', true), TaskUpdate: grouped('other', true), TaskList: grouped('other', true),
  TaskGet: grouped('other', true), TaskOutput: grouped('other', true), TaskStop: grouped('other', true),
  // E1 start: a pane shown for the model is a cell of its own, never folded into a group of MCP calls
  [MAWS_TOOL_USE.show_pane]: standalone('other'),
  // E1 end
  // E7 start: the scheduling tools by name (as the fallback would class them), so a job's creating call is a known cell
  // that Background work's `Open creating turn` jumps to (E7 execution document, Design §7)
  CronCreate: grouped('other'), CronList: grouped('other'), CronDelete: grouped('other'),
  // E7 end
  // E2 start: listing and screenshotting artifacts are cells of their own, as show_pane is (P3-A: as are the namespace's
  // other readers, its assets and its exports)
  [MAWS_TOOL_USE.artifact_list]: standalone('other'),
  [MAWS_TOOL_USE.artifact_screenshot]: standalone('other'),
  [MAWS_TOOL_USE.artifact_describe_type]: standalone('other'),
  [MAWS_TOOL_USE.artifact_read]: standalone('other'),
  [MAWS_TOOL_USE.artifact_upload_asset]: standalone('other'),
  [MAWS_TOOL_USE.artifact_list_assets]: standalone('other'),
  [MAWS_TOOL_USE.artifact_export]: standalone('other'),
  // E2 end
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
  terminalReason: string | null; // the turn's, once it closed
  turnClosed: boolean;
  humanDecision: boolean;
  safeguard: SafeguardVerdict;
  imageResult: boolean;
  isError: boolean;
}

export const isAbortedReason = (terminalReason: string | null) => terminalReason !== null && terminalReason.startsWith('aborted');

// The denial table under Derivation, one row per DENIAL_KINDS member. The interruption case needs the terminal reason,
// so it is decided when the turn closes; until then a user-rejected denial reads as denied.
export function denialDisposition(kind: DenialKind, terminalReason: string | null, turnClosed: boolean): { disposition: 'denied' | 'auto_denied' | 'stopped'; interruption: boolean } {
  switch (kind) {
    case 'user-rejected':
      return turnClosed && isAbortedReason(terminalReason) ? { disposition: 'stopped', interruption: true } : { disposition: 'denied', interruption: false };
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

// Total over tool names; `startsGroup` is the group state machine's (derive.ts) and starts false here.
export function classifyTool(toolName: string, _input: unknown, context: ClassifyContext): ToolClassification {
  const row = tableRowOf(toolName);
  let groupable = row.groupable;
  let denial: ToolClassification['denial'] = null;
  if (context.denial) {
    groupable = false;
    denial = { kind: context.denial.kind, reason: context.denial.reason, ...denialDisposition(context.denial.kind, context.terminalReason, context.turnClosed) };
  }
  if (context.humanDecision) groupable = false;
  if (context.imageResult) groupable = false;
  return {
    groupable,
    hidden: row.hidden,
    category: row.category,
    denial,
    subagentLifecycle: null,
    startsGroup: false,
    safeguard: context.safeguard,
    humanDecision: context.humanDecision,
  };
}
