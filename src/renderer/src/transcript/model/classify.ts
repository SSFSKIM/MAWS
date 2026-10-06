// X3 classification (C6 execution document, "X3 — classification"): tool name → category, presentation and the
// overrides, total over MCP, plugin and future tools. The table is the contract; `presentationOf` says which tool
// names are rows of another kind rather than cells.
import type { DenialKind, SafeguardVerdict } from '@shared/graph/enums';
import { MAWS_SERVER_NAME, type MawsToolName } from '@shared/maws/tools'; // E1
import type { ToolCategory, ToolClassification } from './rows';

export type Presentation = 'cell' | 'subagent' | 'agent_message' | 'question' | 'plan' | /* E1 */ 'ask' | 'delivery' | /* E2 */ 'artifact';

// E1 start: the names the engine gives the `maws` server's tools (X9), as tool uses carry them
export const MAWS_TOOL_USE: Record<MawsToolName, string> = {
  send_file: `mcp__${MAWS_SERVER_NAME}__send_file`, ask: `mcp__${MAWS_SERVER_NAME}__ask`, show_pane: `mcp__${MAWS_SERVER_NAME}__show_pane`,
  // E2 start: the artifact tools (an artifact row for the two writers, cells for the two readers)
  artifact_create: `mcp__${MAWS_SERVER_NAME}__artifact_create`, artifact_update: `mcp__${MAWS_SERVER_NAME}__artifact_update`,
  artifact_list: `mcp__${MAWS_SERVER_NAME}__artifact_list`, artifact_screenshot: `mcp__${MAWS_SERVER_NAME}__artifact_screenshot`,
  // E2 end
};
// E1 end

const ROW_KIND_TOOLS: Record<string, Presentation> = {
  Agent: 'subagent', Task: 'subagent', Workflow: 'subagent',
  SendMessage: 'agent_message',
  AskUserQuestion: 'question',
  ExitPlanMode: 'plan',
  // E1 start: an ask is a capsule, a delivered file a delivery row
  [MAWS_TOOL_USE.ask]: 'ask',
  [MAWS_TOOL_USE.send_file]: 'delivery',
  // E1 end
  // E2 start: an artifact version the agent registered is an artifact row
  [MAWS_TOOL_USE.artifact_create]: 'artifact',
  [MAWS_TOOL_USE.artifact_update]: 'artifact',
  // E2 end
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
  // E2 start: listing and screenshotting artifacts are cells of their own, as show_pane is
  [MAWS_TOOL_USE.artifact_list]: standalone('other'),
  [MAWS_TOOL_USE.artifact_screenshot]: standalone('other'),
  // E2 end
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
