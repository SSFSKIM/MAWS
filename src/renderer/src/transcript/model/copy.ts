// The strings that are decisions (C6 execution document, "Copy"). Every user-visible string of the presentation
// model lives here so it can be reviewed in one place; the count semantics are what §5.3 binds.
import type { DenialKind } from '@shared/graph/enums';
import type { AskAnswer } from '@shared/maws/tools'; // E1
import { TOOL_CATEGORIES, type SubagentStatus, type ToolCategory } from './rows';
import { MCP_TOOL } from './classify';
import { duration } from './time';

export const plural = (n: number, noun: string, nouns = `${noun}s`) => `${n} ${n === 1 ? noun : nouns}`;
const capitalise = (text: string) => (text.length === 0 ? text : text[0].toUpperCase() + text.slice(1));
export const baseName = (path: string) => path.split('/').filter((part) => part.length > 0).at(-1) ?? path;
// A path as the session reads it (W4, the receipt): relative to the session's directory when it lies inside it, else as
// recorded.
export function displayPath(path: string, directory: string | null): string {
  if (!directory) return path;
  const base = directory.endsWith('/') ? directory : `${directory}/`;
  return path.startsWith(base) ? path.slice(base.length) : path;
}
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
  cause?: 'crash' | null; // E11: a stopped turn its engine process ended reads in the engine's words, not "You stopped"
  origin: 'human' | 'engine' | 'peer';
  durationMs: number;
  toolCalls: number;
  denied: number;
  autoDenied: number;
}

function verb(state: DividerCopyInput['state'], origin: DividerCopyInput['origin'], durationMs: number, cause: DividerCopyInput['cause'] = null): string {
  const t = duration(durationMs);
  switch (state) {
    case 'working': return durationMs < 1000 ? 'Working' : `Working for ${t}`;
    case 'completed': return origin === 'engine' ? `Continued for ${t}` : origin === 'peer' ? `Peer session worked for ${t}` : `Worked for ${t}`;
    case 'stopped': return cause === 'crash' ? `Stopped after ${t} (engine process exited)` : `You stopped after ${t}`;
    case 'failed': return `Failed after ${t}`;
  }
}

export function dividerCopy(input: DividerCopyInput): string {
  const parts = [verb(input.state, input.origin, input.durationMs, input.cause)];
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
  const head = verb(input.state, input.origin, input.durationMs, input.cause) + (input.model ? ` on ${input.model}` : '');
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
  | { kind: 'generic'; toolName: string; category: ToolCategory; detail?: string | null; scope?: string | null };

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

// W8 (T1): a streaming block's label in the CLI's words (Claude Code 2.1.283, `cli.pretty.js`): the tier by how long the
// block has run, from 10, 20, 30 and 45 s (`Mo`, `Co`, `Io`, `_o` at :521212, chosen by `Lo` at :521223-521233), then
// ` with {effort} effort` when the session's effort is known (the spinner's `effortSuffix`, built by `xMt` at
// :477207-477214), then the elapsed time.
const THINKING_TIERS: readonly (readonly [number, string])[] = [[45_000, 'Deep in thought'], [30_000, 'Thinking some more'], [20_000, 'Thinking more'], [10_000, 'Still thinking']];
export const thinkingTier = (elapsedMs: number) => THINKING_TIERS.find(([from]) => elapsedMs >= from)?.[1] ?? 'Thinking';
export const liveThinkingLabel = (elapsedMs: number, effort: string | null) => `${thinkingTier(elapsedMs)}${effort ? ` with ${effort} effort` : ''} · ${duration(elapsedMs)}`;
// How far the label has turned to the warning colour: not before 10 s, wholly from 20 s, in eighths (the spinner's
// thinking intensity, `Tn` at :521172-521179, which colours its thinking text toward the theme's warning by `pC`'s
// eighths, :655065-655068, through `Do` at :521347 and the colour at :521357).
export const thinkingWarmth = (elapsedMs: number) => Math.round(Math.min(Math.max((elapsedMs - 10_000) / 10_000, 0), 1) * 8) / 8;

export const SAFEGUARD_LINE = { skipped: 'Auto mode · review skipped', not_flagged: 'Auto mode · reviewed · not flagged', flagged: 'Auto mode · flagged', not_evaluated: 'Auto mode · not reviewed' } as const;

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
export const QUESTION = { heading: 'Question', notAnswered: 'Not answered', skipped: 'Skipped' } as const;

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
      if (input.reason === 'transcript_branch') return 'Conversation continued from an earlier point';
      return `Response retracted · ${input.reason}${input.fallbackModel ? ` · switched to ${input.fallbackModel}` : ''}`;
    case 'rewind':
      return `${rewindLabel(input.hiddenRows)} · ${REWIND_TOGGLE[input.revealed ? 'hide' : 'show']}`;
  }
}

export const BRANCH_HISTORY_DETAIL = 'Later messages from the previous path are no longer part of the current conversation history';

// The rewind boundary's line without its toggle, and the toggle (the row renders the toggle as a button).
export const rewindLabel = (hiddenRows: number) => `Rewound to here · ${plural(hiddenRows, 'message')} hidden`;
export const REWIND_TOGGLE = { show: 'Show', hide: 'Hide' } as const;
export const NOT_IN_CONTEXT = 'Not in context'; // a revealed rewound branch: the model no longer has it

export const retryCopy = (attempt: number, max: number | null, status: number | null, error: string) =>
  `Retrying (${attempt}/${max ?? '?'}) · ${status === null ? '' : `${status} `}${error}`;
export const reconnectCopy = (phase: 'attempting' | 'reconnected' | 'failed', attempt: number, max: number | null, reason: string | null) =>
  phase === 'attempting' ? `Reconnecting (${attempt}/${max ?? '?'})…` : phase === 'reconnected' ? 'Reconnected' : `Could not reconnect${reason ? ` · ${reason}` : ''}`;
// C12 start: the memory budget's release and the resume after it (C12 execution document, "Surfaces of the budget")
export const RELEASED_COPY = 'Released to stay under the memory budget · sending resumes it';
export const IDLE_RELEASED_COPY = 'Stopped while idle · sending resumes it'; // E10: the supervisor's idle release (neutral: it also runs with MAWS open after an update)
export const RESUMING_COPY = 'Resuming…';
export const RESUMED_COPY = 'Resumed';
// C12 end
// E1: `lostAskCount` of the lost were blocking `maws` asks, named questions; the rest stay approvals.
const lostCopy = (lostAttentionCount: number, lostAskCount: number) => {
  const approvals = lostAttentionCount - lostAskCount;
  return [approvals > 0 ? plural(approvals, 'approval') : null, lostAskCount > 0 ? plural(lostAskCount, 'question') : null].filter((part) => part !== null).join(' and ');
};
export const processExitCopy = (reason: string, lostAttentionCount: number, lostAskCount = 0) =>
  reason === 'budget' ? RELEASED_COPY /* C12 */ : reason === 'idle' ? IDLE_RELEASED_COPY /* E10 */ : `Session process exited (${reason})${lostAttentionCount > 0 ? ` · ${lostCopy(lostAttentionCount, lostAskCount)} lost` : ''}`;
export const bashHeader = (command: string) => `! ${command}`;
export const LOCAL_COMMAND_HEADER = 'Command output';
export const NOT_SENT = 'Not sent'; // a dropped user row: a steer the engine cancelled, or an idle prompt dropped before its init
// W1: a message sent while a turn runs, Claude Desktop's dimmed tail bubble with its caption until the engine takes it,
// and a steer the engine took, inside the turn at the step where it arrived.
export const PENDING_CAPTION = { next: 'Sends at the next step', held: 'Sends when this turn ends' } as const;
export const STEERED_CAPTION = 'Sent during this turn';
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
} as const;

// A hook that got in the way (model/hooks.ts; Claude Desktop's words for the blocked prompt and the re-prompt). A reason
// is the hook's own first line, when it gave one.
const because = (reason: string | null) => (reason ? ` · ${reason}` : '');
// W13: the engine host's notice that a newer Claude Code sent what MAWS did not understand links to Settings › Engine
export const ENGINE_NOTICE = { settings: 'Settings › Engine' } as const;

export const HOOK = {
  blockedPrompt: (reason: string | null) => `A hook blocked your prompt${because(reason)}`,
  editPrompt: 'Edit prompt',
  reprompted: (reason: string | null) => `Hook re-prompted Claude${because(reason)}`,
  blocked: (name: string, reason: string | null) => `Hook ${name} blocked this step${because(reason)}`,
  failed: (name: string, exitCode: number | null, reason: string | null) => `Hook ${name} failed${exitCode === null ? '' : ` · exit ${exitCode}`}${because(reason)}`,
  cancelled: (name: string) => `Hook ${name} was cancelled`,
} as const;

// R1: what a plugin says through the engine (charter D-9 as amended 2026-10-01), always under its name: a log line (the
// terminal's dim notice under the plugin's name), a toast and a pinned status line as MAWS shows them, and a load
// error or warning from the session's init.
export const PLUGIN = {
  log: (plugin: string, text: string) => `${plugin}: ${text}`,
  toast: (plugin: string, text: string) => `${plugin}: ${text}`,
  status: (plugin: string, text: string) => `${plugin} · ${text}`,
  loadError: (plugin: string, message: string) => `Plugin ${plugin} failed to load${because(message)}`,
  loadWarning: (plugin: string, message: string) => `Plugin ${plugin} warned while loading${because(message)}`,
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

// ---------------------------------------------------------------------------------------------------------------------
// E1 start: the `maws` server's rows and cells (E1 execution document, M3's decisions), and the question row's refusal

export const ASK = {
  title: 'Questions', // the capsule's heading when the ask has no title
  count: (n: number) => `Asked ${plural(n, 'question')}`,
  state: { pending: 'Waiting for you', asked: 'Asked, answer when ready', answered: 'Answered', cancelled: 'Cancelled, the session ended' },
  withdrawn: 'Cancelled, the turn was interrupted', // a cancelled ask whose call the engine withdrew (`cancelReason: 'withdrawn'`)
  open: 'Open',
  viewAnswers: 'View answers',
  notAnswered: 'Not answered',
  decideForMe: 'Decide for me',
} as const;

// One answer as the answered capsule's line reads it: the labels (and what was typed under Other), the text, the paths,
// `<name> (<directory>)` for a repository, or the two non-answers.
export function askAnswerCopy(answer: AskAnswer | undefined): string {
  if (answer === undefined) return ASK.notAnswered;
  if (answer.status === 'skipped') return QUESTION.skipped;
  if (answer.status === 'decide_for_me') return ASK.decideForMe;
  const values = answer.value === undefined ? [] : Array.isArray(answer.value) ? answer.value : [answer.value];
  const value = answer.name !== undefined ? `${answer.name} (${values.join(', ')})` : values.join(', ');
  return [value, answer.otherText !== undefined ? `Other: ${answer.otherText}` : ''].filter((part) => part !== '').join(' · ');
}

const deliveredSubject = (files: readonly { name: string }[]) => (files.length === 1 ? files[0]!.name : plural(files.length, 'file'));
export const DELIVERY = {
  delivered: (files: readonly { name: string }[]) => `Delivered ${deliveredSubject(files)}`,
  delivering: (files: readonly { name: string }[]) => `Delivering ${deliveredSubject(files)}`,
  failed: (files: readonly { name: string }[]) => `Could not deliver ${deliveredSubject(files)}`,
  neverAnswered: (files: readonly { name: string }[]) => `Delivering ${deliveredSubject(files)} was never answered`, // E11
  openExternally: 'Open externally',
  reveal: 'Reveal in Finder',
} as const;

// E11 (W-C): the delivery row's one line: its refusal, else Delivering until the files are recorded (or never answered
// when its turn closed first), else Delivered.
export function deliveryHeading(row: { files: readonly { name: string; id: string | null }[]; error: string | null; neverAnswered?: true }): string {
  if (row.error !== null) return DELIVERY.failed(row.files);
  if (row.neverAnswered) return DELIVERY.neverAnswered(row.files);
  return row.files.some((file) => file.id === null) ? DELIVERY.delivering(row.files) : DELIVERY.delivered(row.files);
}

// A `show_pane` cell's line: what opened (a panel tool's title, a file's name), or why nothing did.
export const PANE_CELL = {
  opening: (pane: string) => `Opening the ${pane} pane`,
  opened: (name: string) => `Opened ${name}`,
  failed: (error: string) => `Could not open pane: ${error}`,
} as const;

// A-17: the engine refused an AskUserQuestion call before any request reached the human (a preview that is not HTML).
export const questionRefused = (text: string) => `The engine refused this question: ${text}`;
// E1 end

// E7 start: the messages between sessions and agents, the Reply under an inbound one, and the `ListAgents` listing (E7
// execution document, Design §4 and §10). A composer's `mode` is `reply` under a message from another session and
// `message` from a listing row; the line under it walks the steer that asks the session to send it.
type PeerMode = 'reply' | 'message';
export const peerMessageCopy = {
  inbound: (sender: string, preview: string) => `Message from ${sender}: ${preview}`,
  outbound: (recipient: string, preview: string) => `Sent to ${recipient}: ${preview}`,
  report: (title: string | null) => `Report from ${title ?? 'agent'}`, // a subagent's hand-back; the report folds under it
  sender: (name: string) => `@ ${name}`, // the row's lead, the address as its tooltip
  recipient: (name: string) => `To @ ${name}`,
  result: { pending: 'Sending', sent: 'Sent', failed: 'Not sent' } as const, // an outbound send's state
  showMessage: 'Show the whole message',
  showReport: 'Show the report',
  hide: 'Hide',
  reply: 'Reply',
  send: 'Send',
  label: (mode: PeerMode, session: string) => (mode === 'reply' ? `Reply via ${session}` : `Message via ${session}`),
  placeholder: (mode: PeerMode, name: string) => (mode === 'reply' ? `Reply to ${name}…` : `Message ${name}…`),
  disabled: {
    notRunningHere: (mode: PeerMode) => (mode === 'reply' ? 'Replying needs the session running here' : 'Messaging needs the session running here'),
    pending: (mode: PeerMode) => (mode === 'reply' ? 'Waiting for the last reply' : 'Waiting for the last message'),
  },
  asked: (mode: PeerMode, session: string, elapsed: string) => `Asked ${session} to ${mode === 'reply' ? 'reply' : 'send it'} · ${elapsed}`,
  askedTurnOpen: (mode: PeerMode, session: string, elapsed: string) =>
    `Asked ${session} to ${mode === 'reply' ? 'reply' : 'send it'} · ${elapsed} · ${session} sends it at its next tool boundary or when this turn ends`,
  askedLongWait: (mode: PeerMode, session: string, elapsed: string) =>
    `Asked ${session} to ${mode === 'reply' ? 'reply' : 'send it'} · ${elapsed} · ${session} is inside a long tool call; it sends it when that call returns or this turn ends`,
  forwarded: (mode: PeerMode, session: string) => (mode === 'reply' ? `${session} is replying with SendMessage` : `${session} is sending it with SendMessage`),
  sent: (mode: PeerMode, session: string) => (mode === 'reply' ? `${session} replied with SendMessage` : `${session} sent it with SendMessage`),
  failed: (mode: PeerMode, message: string) => `${mode === 'reply' ? 'Reply' : 'Message'} failed: ${message}`,
} as const;

export const agentListCopy = {
  pending: 'Listing the agents and sessions…',
  self: (self: string) => `This session is ${self}`,
  section: (title: string, count: number) => `${title} · ${count}`,
  message: 'Message',
  messageLabel: (name: string) => `Message ${name}`,
  serialized: (subagents: number, teammates: number, peers: number) => `Agents: ${plural(subagents, 'subagent')}, ${plural(teammates, 'teammate')}, ${plural(peers, 'peer session')}`,
} as const;
// E7 end

// ---------------------------------------------------------------------------------------------------------------------
// E2 start: the artifact tools' row and cells (E2 execution document, Design §9). A row names the artifact by its title,
// else by the id the agent gave it.

export const ARTIFACT = {
  created: (name: string, version: number | null) => (version === null ? `Artifact ${name}` : `Artifact ${name} · v${version}`),
  updated: (name: string, version: number | null) => (version === null ? `Updated artifact ${name}` : `Updated artifact ${name} · v${version}`),
  registering: (name: string) => `Registering artifact ${name}…`,
  neverAnswered: (name: string) => `Registering artifact ${name} was never answered`, // E11
  failed: (name: string, error: string) => `Could not register artifact ${name}: ${error}`,
  open: 'Open',
} as const;

// The host's refusal is written for the model: the tool's own prefix and, last, which tool to call instead. The human
// reads the reason alone, as the artifact cells show theirs.
const refusalForHuman = (error: string) => error.replace(/^artifact_(create|update): /, '').replace(/; use artifact_(create|update)$/, '');

// The row's one line: its refusal, else Registering until the result is in (never answered when its turn closed first,
// E11), else the version it registered (without a version when the result named none).
export function artifactHeading(row: { action: 'create' | 'update'; artifactId: string; title: string | null; version: number | null; error: string | null; answered: boolean; neverAnswered?: true }): string {
  const name = row.title ?? row.artifactId;
  if (row.error !== null) return ARTIFACT.failed(name, refusalForHuman(row.error));
  if (row.neverAnswered) return ARTIFACT.neverAnswered(name);
  if (row.version === null && !row.answered) return ARTIFACT.registering(name);
  return (row.action === 'create' ? ARTIFACT.created : ARTIFACT.updated)(name, row.version);
}

export const ARTIFACT_CELL = {
  listing: 'Listing artifacts',
  listed: (n: number | null) => (n === null ? 'Listed artifacts' : n === 0 ? 'Listed no artifacts' : `Listed ${plural(n, 'artifact')}`),
  listFailed: (error: string) => `Could not list artifacts: ${error}`,
  screenshotting: (id: string) => `Taking a screenshot of ${id}`,
  screenshot: (shot: { title: string; version: number; width: number; height: number } | null, id: string) =>
    shot === null ? `Screenshot of ${id}` : `Screenshot of ${shot.title} v${shot.version} (${shot.width} × ${shot.height})`,
  screenshotFailed: (error: string) => `Could not screenshot: ${error}`,
} as const;
// E2 end

// ---------------------------------------------------------------------------------------------------------------------
// E4c start: the browser tools' row (E4c execution document, Design §10). One line naming what the agent did to which
// page or element: past tense once done ("Clicked button "Submit""), the present while it runs or when the turn
// stopped it ("Clicking e12"), "Could not …" with the reason under it on a refusal. An element is named by its role and
// name when the result or the locator carries them, else by its ref or css; a page by its host. A fill never shows what
// it typed.

// One action's phrase in its three tenses: done, running (also a cancelled row's), and the infinitive "Could not" takes.
interface BrowserPhrase {
  done: string;
  running: string;
  base: string;
}
const phrase = (done: string, running: string, base: string): BrowserPhrase => ({ done, running, base });

const ELEMENT_MAX = 60;
const cut = (text: string) => (text.length > ELEMENT_MAX ? `${text.slice(0, ELEMENT_MAX - 1)}…` : text);

interface BrowserActionFacts {
  tool: string;
  action: string;
  target: string | null;
  targetRole: string | null;
  targetName: string | null;
  value: string | null;
  url: string | null;
  chars: number | null;
  truncated: boolean;
  tabCount: number | null;
  detail: string | null;
}

// The element an act or a targeted screenshot aimed at: `button "Submit"`, else the ref or the css as given.
function elementOf(row: BrowserActionFacts): string {
  if (row.targetRole !== null || row.targetName !== null) {
    return cut([row.targetRole, row.targetName !== null ? `"${row.targetName}"` : null].filter((part) => part !== null).join(' '));
  }
  return row.target === null ? 'the element' : cut(row.target);
}

// A page by its host; null for one with none (about:blank, data:, file:), so a heading reads without it. A string that
// is not a URL is shown as given, cut as an element is.
function pageHost(page: string): string | null {
  try {
    return new URL(page).host || null;
  } catch {
    return page === '' ? null : cut(page);
  }
}

function browserPhrase(row: BrowserActionFacts): BrowserPhrase {
  const page = row.url ?? (row.action === 'open' || row.action === 'url' ? row.target : null);
  const host = page === null ? null : pageHost(page);
  const on = host === null ? '' : ` ${host}`;
  const somePage = ` ${host ?? 'a page'}`;
  const el = elementOf(row);
  switch (`${row.tool}:${row.action}`) {
    case 'browser_tabs:open': return phrase(`Opened${somePage}`, `Opening${somePage}`, `open${somePage}`);
    case 'browser_tabs:close': return phrase('Closed tab', 'Closing tab', 'close the tab');
    case 'browser_tabs:select': return phrase(`Selected tab${on}`, 'Selecting tab', 'select the tab');
    case 'browser_tabs:list': return phrase(row.tabCount === null ? 'Listed tabs' : `Listed ${plural(row.tabCount, 'tab')}`, 'Listing tabs', 'list tabs');
    case 'browser_navigate:url': return phrase(`Navigated to${somePage}`, `Navigating to${somePage}`, `navigate to${somePage}`);
    case 'browser_navigate:back': return phrase('Went back', 'Going back', 'go back');
    case 'browser_navigate:forward': return phrase('Went forward', 'Going forward', 'go forward');
    case 'browser_navigate:reload': return phrase(`Reloaded ${host ?? 'the page'}`, 'Reloading', 'reload');
    case 'browser_snapshot:snapshot': {
      const of = [row.target === null ? null : cut(row.target), host].filter((part) => part !== null).join(' on ');
      const kept = row.truncated && row.detail !== null ? `${row.detail.length.toLocaleString('en-US')} of ` : '';
      const size = row.chars === null ? '' : ` (${kept}${row.chars.toLocaleString('en-US')} chars)`;
      return phrase(`Snapshot${of === '' ? '' : ` of ${of}`}${size}`, 'Taking a snapshot', 'take a snapshot');
    }
    case 'browser_act:click': return phrase(`Clicked ${el}`, `Clicking ${el}`, `click ${el}`);
    case 'browser_act:fill': return phrase(`Filled ${el}`, `Filling ${el}`, `fill ${el}`);
    case 'browser_act:select': {
      const option = row.value === null ? 'an option' : `"${cut(row.value)}"`;
      return phrase(`Selected ${option} in ${el}`, `Selecting ${option} in ${el}`, `select ${option} in ${el}`);
    }
    case 'browser_act:check':
      return row.value === 'false' ? phrase(`Unchecked ${el}`, `Unchecking ${el}`, `uncheck ${el}`) : phrase(`Checked ${el}`, `Checking ${el}`, `check ${el}`);
    case 'browser_act:press': {
      const key = row.value === null ? 'a key' : cut(row.value);
      return phrase(`Pressed ${key}`, `Pressing ${key}`, `press ${key}`);
    }
    case 'browser_act:hover': return phrase(`Hovered over ${el}`, `Hovering over ${el}`, `hover over ${el}`);
    case 'browser_act:scroll':
      return row.value === null ? phrase(`Scrolled ${el} into view`, `Scrolling ${el} into view`, `scroll ${el} into view`) : phrase(`Scrolled ${el} by ${row.value} px`, `Scrolling ${el} by ${row.value} px`, `scroll ${el} by ${row.value} px`);
    case 'browser_eval:eval': return phrase('Evaluated an expression', 'Evaluating an expression', 'evaluate an expression');
    case 'browser_screenshot:screenshot': {
      const of = row.target === 'page' || row.target === 'fullPage' ? on : ` ${el}`;
      return phrase(`${row.target === 'fullPage' ? 'Full-page screenshot' : 'Screenshot'}${of === '' ? '' : ` of${of}`}`, 'Taking a screenshot', 'take a screenshot');
    }
    default: { // arguments the host refused: what the call was, by its tool
      const noun = `browser ${row.tool.replace(/^browser_/, '')}`;
      return phrase(capitalise(noun), capitalise(noun), `run ${noun}`);
    }
  }
}

export const BROWSER_ACTION = {
  failed: (base: string) => `Could not ${base}`,
  cancelled: 'Cancelled, the turn was interrupted',
  waitingHuman: (elapsed: string) => `Waiting · you have the page · ${elapsed}`,
  waitingCover: (elapsed: string) => `Waiting · a sheet covers the page · ${elapsed}`,
  waited: (reason: 'human' | 'cover', ms: number) => (reason === 'human' ? `waited ${took(ms)} for you` : `waited ${took(ms)} under a sheet`),
  openTab: 'Open tab',
  open: 'Open',
  show: (tool: string) => (tool === 'browser_eval' ? 'Show value' : 'Show snapshot'),
  hide: (tool: string) => (tool === 'browser_eval' ? 'Hide value' : 'Hide snapshot'),
} as const;

// How long an action took: browser actions are often under a second, which `duration` would round to 0s.
export function took(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`;
  return duration(ms);
}

// The row's one line, by its state.
export function browserActionHeading(row: BrowserActionFacts & { state: 'running' | 'done' | 'error' | 'cancelled' }): string {
  const words = browserPhrase(row);
  switch (row.state) {
    case 'done': return words.done;
    case 'running':
    case 'cancelled': return words.running;
    case 'error': return BROWSER_ACTION.failed(words.base);
  }
}

// A refusal as the person reads it: without the tool's name, which the model's text opens with.
export const browserActionError = (error: string) => capitalise(error.replace(/^browser_[a-z]+: /, ''));
// E4c end
