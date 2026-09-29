// The strings that are decisions (C6 execution document, "Copy"). Every user-visible string of the presentation
// model lives here so it can be reviewed in one place; the count semantics are what §5.3 binds.
import type { DenialKind } from '@shared/graph/enums';
import { TOOL_CATEGORIES, type SubagentStatus, type ToolCategory } from './rows';
import { MCP_TOOL } from './classify';
import { duration } from './time';

export const plural = (n: number, noun: string, nouns = `${noun}s`) => `${n} ${n === 1 ? noun : nouns}`;
const capitalise = (text: string) => (text.length === 0 ? text : text[0].toUpperCase() + text.slice(1));
export const baseName = (path: string) => path.split('/').filter((part) => part.length > 0).at(-1) ?? path;
export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
const kilo = (n: number) => `${Math.round(n / 1000)}k`;
const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

// ---------------------------------------------------------------------------------------------------------------------
// Divider and turn summary

export interface DividerCopyInput {
  state: 'working' | 'completed' | 'stopped' | 'failed';
  origin: 'human' | 'engine' | 'peer';
  durationMs: number;
  toolCalls: number;
  denied: number;
  autoDenied: number;
}

function verb(state: DividerCopyInput['state'], origin: DividerCopyInput['origin'], durationMs: number): string {
  const t = duration(durationMs);
  switch (state) {
    case 'working': return durationMs < 1000 ? 'Working' : `Working for ${t}`;
    case 'completed': return origin === 'engine' ? `Continued for ${t}` : origin === 'peer' ? `Peer session worked for ${t}` : `Worked for ${t}`;
    case 'stopped': return `You stopped after ${t}`;
    case 'failed': return `Failed after ${t}`;
  }
}

export function dividerCopy(input: DividerCopyInput): string {
  const parts = [verb(input.state, input.origin, input.durationMs)];
  if (input.state !== 'working' && input.toolCalls > 0) parts.push(plural(input.toolCalls, 'tool call'));
  if (input.denied > 0) parts.push(`${input.denied} denied`);
  if (input.autoDenied > 0) parts.push(`${input.autoDenied} auto-denied`);
  return parts.join(' · ');
}

export interface TurnSummaryCopyInput extends Omit<DividerCopyInput, 'denied' | 'autoDenied'> {
  model: string | null;
  phrases: string; // the group phrases of the whole turn
  denied: { kind: DenialKind }[];
  safeguard: { reviewed: number; flagged: number; notEvaluated: number };
  costUsd: number | null;
  tokens: number | null;
  childAgents: number;
}

export function turnSummaryCopy(input: TurnSummaryCopyInput): string {
  const head = verb(input.state, input.origin, input.durationMs) + (input.model ? ` on ${input.model}` : '');
  const parts = [head];
  if (input.toolCalls > 0) parts.push(`${plural(input.toolCalls, 'tool call')}${input.phrases ? `: ${input.phrases}` : ''}`);
  if (input.denied.length > 0) parts.push(`${input.denied.length} denied (${[...new Set(input.denied.map((d) => d.kind))].join(', ')})`);
  if (input.safeguard.reviewed > 0) parts.push(`Auto mode reviewed ${plural(input.safeguard.reviewed, 'action')}, ${input.safeguard.flagged} flagged`);
  if (input.costUsd !== null && input.costUsd > 0) parts.push(`$${input.costUsd.toFixed(2)}`);
  if (input.tokens !== null && input.tokens > 0) parts.push(`${input.tokens.toLocaleString('en-US')} tokens`);
  if (input.childAgents > 0) parts.push(plural(input.childAgents, 'subagent'));
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------------------------------------------------
// Groups

export interface GroupPhraseInput {
  mcpServers: string[];
  skills: string[];
  toolsLoaded: number;
  editedFiles: string[];
  readFiles: string[];
  searches: string[];
  commands: string[];
  hooks: number;
  webQueries: string[];
  fetchedHosts: string[];
  other: number;
}

// Phrases in category order, joined by `, `, first letter capitalised; `other` only when it is the sole category.
export function groupSummary(input: GroupPhraseInput): string {
  const byCategory: Record<ToolCategory, string[]> = { mcp: [], skills: [], files: [], exploration: [], commands: [], web: [], other: [] };
  const servers = [...new Set(input.mcpServers)];
  if (servers.length > 0) byCategory.mcp.push(servers.length <= 3 ? `used ${list(servers)}` : `used ${plural(servers.length, 'source')}`);
  const skills = [...new Set(input.skills)];
  if (skills.length === 1) byCategory.skills.push(`loaded ${skills[0]} skill`);
  else if (skills.length > 1) byCategory.skills.push(`loaded ${plural(skills.length, 'skill')}`);
  if (input.toolsLoaded > 0) byCategory.skills.push(`loaded ${plural(input.toolsLoaded, 'tool')}`);
  const edited = [...new Set(input.editedFiles)];
  if (edited.length === 1) byCategory.files.push(`edited ${baseName(edited[0])}`);
  else if (edited.length > 1) byCategory.files.push(`edited ${plural(edited.length, 'file')}`);
  const read = [...new Set(input.readFiles)];
  if (read.length === 1) byCategory.exploration.push(`read ${baseName(read[0])}`);
  else if (read.length > 1) byCategory.exploration.push(`read ${plural(read.length, 'file')}`);
  for (const pattern of [...new Set(input.searches)]) byCategory.exploration.push(`searched for \`${pattern}\``);
  if (input.commands.length === 1) byCategory.commands.push(`ran \`${input.commands[0]}\``);
  else if (input.commands.length > 1) byCategory.commands.push(`ran ${plural(input.commands.length, 'command')}`);
  if (input.hooks > 0) byCategory.commands.push(`ran ${plural(input.hooks, 'hook')}`);
  for (const query of input.webQueries) byCategory.web.push(`searched the web for ${query}`);
  const hosts = [...new Set(input.fetchedHosts)];
  if (hosts.length === 1) byCategory.web.push(`fetched ${hosts[0]}`);
  else if (hosts.length > 1) byCategory.web.push(`fetched ${plural(hosts.length, 'page')}`);
  const phrases = TOOL_CATEGORIES.filter((category) => category !== 'other').flatMap((category) => byCategory[category]);
  if (phrases.length === 0 && input.other > 0) phrases.push(`used ${plural(input.other, 'tool')}`);
  return phrases.length === 0 ? 'Worked' : capitalise(phrases.join(', '));
}

export interface RunningTool { toolName: string; input: unknown; elapsedMs: number }

const inputString = (input: unknown, key: string): string | null => {
  if (typeof input !== 'object' || input === null) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
};

export function activeGroupLabel(running: RunningTool | null): string {
  if (!running) return 'Thinking';
  const { toolName, input, elapsedMs } = running;
  const mcp = MCP_TOOL.exec(toolName);
  if (mcp) return `Using ${mcp[1]}`;
  switch (toolName) {
    case 'Bash': return `Running \`${inputString(input, 'command') ?? toolName}\` for ${duration(elapsedMs)}`;
    case 'Read': case 'NotebookRead': return `Reading ${baseName(inputString(input, 'file_path') ?? inputString(input, 'notebook_path') ?? '')}`;
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return `Editing ${baseName(inputString(input, 'file_path') ?? inputString(input, 'notebook_path') ?? '')}`;
    case 'Grep': case 'Glob': return `Searching for \`${inputString(input, 'pattern') ?? ''}\``;
    case 'WebFetch': return `Fetching ${hostOf(inputString(input, 'url') ?? '')}`;
    case 'WebSearch': return `Searching the web for ${inputString(input, 'query') ?? ''}`;
    case 'Skill': return `Loading ${inputString(input, 'skill') ?? 'skill'}`;
    default: return `Using ${toolName}`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Cells

export type CellLabelInput =
  | { kind: 'shell'; command: string; status: 'running' | 'done' | 'error' | 'stopped'; durationMs: number; background: boolean }
  | { kind: 'edit'; path: string; change: 'create' | 'update' | 'delete'; added: number; removed: number }
  | { kind: 'read'; paths: string[] }
  | { kind: 'denied'; subject: string; disposition: 'denied' | 'auto_denied' | 'stopped'; denialKind: DenialKind; reason: string | null }
  | { kind: 'generic'; toolName: string; category: ToolCategory; detail?: string | null; scope?: string | null }
  | { kind: 'hook'; event: string; name: string };

export function cellLabel(input: CellLabelInput): string {
  switch (input.kind) {
    case 'shell': {
      const t = duration(input.durationMs);
      if (input.background) return `Started \`${input.command}\` in the background`;
      switch (input.status) {
        case 'running': return `Running \`${input.command}\` for ${t}`;
        case 'done': return `Ran \`${input.command}\` in ${t}`;
        case 'error': return `Failed \`${input.command}\` in ${t}`;
        case 'stopped': return `Stopped \`${input.command}\` after ${t}`;
      }
      break;
    }
    case 'edit':
      if (input.change === 'create') return `Created ${input.path}`;
      if (input.change === 'delete') return `Deleted ${input.path}`;
      return `Edited ${input.path} +${input.added} −${input.removed}`;
    case 'read':
      return input.paths.length === 1 ? `Read ${input.paths[0]}` : `Read ${plural(input.paths.length, 'file')}`;
    case 'denied': {
      const reason = input.reason ? ` · ${input.reason}` : '';
      switch (input.disposition) {
        case 'denied': return `Denied: \`${input.subject}\`${reason}`;
        case 'auto_denied': return `Auto mode blocked: \`${input.subject}\`${input.denialKind === 'automode-parsing-error' ? ' · review unreadable' : reason}`;
        case 'stopped': return `Stopped: \`${input.subject}\`${input.denialKind === 'automode-unavailable' ? ' · auto mode unavailable' : ''}`;
      }
      break;
    }
    case 'hook':
      return `Hook ${input.event} · ${input.name}`;
    case 'generic': {
      const mcp = MCP_TOOL.exec(input.toolName);
      if (mcp) return `Used ${mcp[1]}`;
      const detail = input.detail ?? null;
      switch (input.toolName) {
        case 'Skill': return `Loaded ${detail ?? 'a'} skill`;
        case 'ToolSearch': return `Loaded ${plural(Number(detail ?? 0), 'tool')}`;
        case 'Grep': case 'Glob': return `Searched for \`${detail ?? ''}\`${input.scope ? ` in ${input.scope}` : ''}`;
        case 'WebFetch': return `Fetched ${detail ?? ''}`;
        case 'WebSearch': return `Searched the web for ${detail ?? ''}`;
        case 'EnterPlanMode': return 'Entered plan mode';
        case 'EnterWorktree': return `Entered worktree ${detail ?? ''}`;
        case 'ExitWorktree': return 'Exited worktree';
        case 'SendUserFile': return `Sent ${detail ?? 'file'}`;
        default: return `Used ${input.toolName}`;
      }
    }
  }
  return '';
}

export const shellFooter = (status: 'done' | 'error' | 'stopped', exitCode: number | null, durationMs: number) => {
  const t = duration(durationMs);
  if (status === 'stopped') return `Stopped after ${t}`;
  if (exitCode === null) return status === 'error' ? `Failed · ${t}` : `✓ Exit code 0 · ${t}`;
  return exitCode === 0 ? `✓ Exit code 0 · ${t}` : `✕ Exit code ${exitCode} · ${t}`;
};

// A block that never streamed (disk history) has no duration: `Thought`, never a live-looking `Thinking`.
export const thinkingLabel = (live: boolean, durationMs: number | null) => (live ? 'Thinking' : durationMs === null ? 'Thought' : `Thought for ${duration(durationMs)}`);

export const SAFEGUARD_LINE = { not_flagged: 'Auto mode · reviewed · not flagged', flagged: 'Auto mode · flagged', not_evaluated: 'Auto mode · not reviewed' } as const;

// ---------------------------------------------------------------------------------------------------------------------
// Subagents, agent messages, plans, questions, slots, boundaries, errors

export function subagentSentence(names: string[], status: SubagentStatus): string {
  const subject = names.length <= 3 ? list(names) : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  switch (status) {
    case 'started': case 'working': return `${subject} started working`;
    case 'finished': return `${subject} finished`;
    case 'finished_with_errors': return `${subject} finished with errors`;
    case 'stopped': return `${subject} was stopped`;
  }
}

export const subagentDetail = (name: string, lastTool: string | null, elapsedMs: number) => [name, lastTool, duration(elapsedMs)].filter((part) => part !== null).join(' · ');

export const agentMessageCopy = (direction: 'to_child' | 'from_child' | 'between', name: string | null, text: string) => {
  if (direction === 'to_child') return `Sent message to ${name ?? 'agent'}: ${text}`;
  if (direction === 'from_child') return `Message from ${name ?? 'agent'}: ${text}`;
  return `Message from parent: ${text}`;
};

export const PLAN_OUTCOME_BADGE = { implement: 'Implemented', clear_and_implement: 'Cleared context and implemented', keep_planning: 'Kept planning' } as const;
export const planBadge = (outcome: keyof typeof PLAN_OUTCOME_BADGE | null, feedback: string | null) =>
  outcome === null ? 'Pending' : outcome === 'keep_planning' && feedback ? `${PLAN_OUTCOME_BADGE.keep_planning}: ${feedback}` : PLAN_OUTCOME_BADGE[outcome];

export const PLAN = { heading: 'Plan', showMore: 'Show more', showLess: 'Show less' } as const;
export const QUESTION = { heading: 'Question', chosen: 'Chosen', notAnswered: 'Not answered', answer: (text: string) => `Answer: ${text}` } as const;

export const requestSlotPlaceholder = (subject: string) => `Waiting for you · ${subject} · answer in the composer`;

export type BoundaryCopyInput =
  | { kind: 'compaction'; preTokens: number; postTokens: number | null; trigger: string; historical: boolean }
  | { kind: 'reset'; trigger: string | null }
  | { kind: 'retraction'; reason: string; fallbackModel: string | null }
  | { kind: 'rewind'; hiddenRows: number; revealed: boolean };

const RESET_TRIGGERS: Record<string, string> = { plan_approved: 'after plan approval', plan_approval: 'after plan approval', clear: 'cleared', cleared: 'cleared' };

export function boundaryCopy(input: BoundaryCopyInput): string {
  switch (input.kind) {
    case 'compaction': {
      const range = `${kilo(input.preTokens)} → ${input.postTokens === null ? '?' : kilo(input.postTokens)}`;
      return input.historical ? `Compacted earlier · ${range}` : `Context compacted · ${range} tokens · ${input.trigger}`;
    }
    case 'reset':
      return input.trigger === null ? 'Conversation reset' : `Conversation reset · ${RESET_TRIGGERS[input.trigger] ?? input.trigger}`;
    case 'retraction':
      return `Response retracted · ${input.reason}${input.fallbackModel ? ` · switched to ${input.fallbackModel}` : ''}`;
    case 'rewind':
      return `${rewindLabel(input.hiddenRows)} · ${REWIND_TOGGLE[input.revealed ? 'hide' : 'show']}`;
  }
}

// The rewind boundary's line without its toggle, and the toggle (the row renders the toggle as a button).
export const rewindLabel = (hiddenRows: number) => `Rewound to here · ${plural(hiddenRows, 'message')} hidden`;
export const REWIND_TOGGLE = { show: 'Show', hide: 'Hide' } as const;
export const NOT_IN_CONTEXT = 'Not in context'; // a revealed rewound branch: the model no longer has it

export const retryCopy = (attempt: number, max: number | null, status: number | null, error: string) =>
  `Retrying (${attempt}/${max ?? '?'}) · ${status === null ? '' : `${status} `}${error}`;
export const reconnectCopy = (phase: 'attempting' | 'reconnected' | 'failed', attempt: number, max: number | null, reason: string | null) =>
  phase === 'attempting' ? `Reconnecting (${attempt}/${max ?? '?'})…` : phase === 'reconnected' ? 'Reconnected' : `Could not reconnect${reason ? ` · ${reason}` : ''}`;
export const processExitCopy = (reason: string, lostAttentionCount: number) =>
  `Session process exited (${reason})${lostAttentionCount > 0 ? ` · ${plural(lostAttentionCount, 'approval')} lost` : ''}`;
export const bashHeader = (command: string) => `! ${command}`;
export const LOCAL_COMMAND_HEADER = 'Command output';
export const NOT_SENT = 'Not sent'; // a dropped user row: a steer the engine cancelled, or an idle prompt dropped before its init
export const bashFooter = (exitCode: number | null) => (exitCode === null ? '' : `exit ${exitCode}`);

// ---------------------------------------------------------------------------------------------------------------------
// Cell detail and receipts

// A mermaid fence whose diagram mermaid rejected (MermaidFence.tsx).
export const DIAGRAM = { failed: 'Diagram could not be drawn' } as const;

export const DETAIL = {
  copyCommand: 'Copy command',
  copyOutput: 'Copy output',
  copyAll: 'Copy all',
  openFullLog: 'Open full log',
  raw: 'Raw',
  cwd: 'cwd',
  sessionDirectory: 'Session directory',
  input: 'Input',
  result: 'Result',
  noDiff: 'No diff recorded',
  omitted: (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB omitted`,
  linesOmitted: (lines: number) => `${plural(lines, 'line')} omitted`,
  hookOutcome: (outcome: string, exitCode: number | null) => (exitCode === null ? outcome : `${outcome} · exit ${exitCode}`),
} as const;

// A spilled result's loader (residue *Spilled results*).
const sizeCopy = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`);
export const SPILL = {
  load: (bytes: number | null) => (bytes === null ? 'Load full result' : `Load full result (${sizeCopy(bytes)})`),
  loading: 'Loading the full result…',
  head: (shownBytes: number) => `Showing the first ${sizeCopy(shownBytes)}`,
  failed: (reason: string) => `Could not load the full result · ${reason}`,
  retry: 'Retry',
} as const;

// A transcript whose history could not be loaded (the store's failed hydration phase).
export const HYDRATION = { failed: (reason: string) => `Could not load this transcript · ${reason}`, retry: 'Retry' } as const;

export const RECEIPT = {
  heading: (files: number) => `${plural(files, 'file')} changed`,
  review: 'Review changes ↗',
  showMore: (n: number) => `Show ${n} more`,
  collapse: 'Collapse files',
  undo: 'Undo',
  reapply: 'Reapply',
  state: { applied: 'Changes applied', undoing: 'Undoing…', undone: 'Changes undone', reapplying: 'Reapplying…' },
  failed: (action: 'Undo' | 'Reapply', reason: string) => `${action} failed · ${reason}`,
} as const;
