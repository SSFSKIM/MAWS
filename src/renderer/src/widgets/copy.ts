// Every widget string and foot in one table (C11 execution document, Repository map and the widget table under
// Interfaces "Widgets"). A foot reads `Read with <control> · <what is edited elsewhere>`; the sentences are the table's.
// Backticks in a sentence mark code, which the frame renders in mono.
import type { WidgetCommandName } from '../composer';

export interface WidgetFoot {
  readWith: string; // the engine's read or control, by its wire name
  editedWhere: string | null; // what the widget will not edit and where it is edited instead
}

export const WIDGET_TITLE: Record<WidgetCommandName, string> = {
  model: 'Model & effort',
  effort: 'Effort',
  fast: 'Fast mode',
  permissions: 'Permissions & rules',
  usage: 'Usage',
  config: 'Config',
  plugins: 'Plugins',
  mcp: 'MCP servers',
  sandbox: 'Sandbox',
  hooks: 'Hooks',
  memory: 'Memory',
  skills: 'Skills',
  agents: 'Agents',
  status: 'Status',
  compact: 'Compact',
  context: 'Context',
  rename: 'Rename',
  resume: 'Resume',
  export: 'Export',
  diff: 'Changes',
};

export const WIDGET_FOOT: Record<WidgetCommandName, WidgetFoot> = {
  model: { readWith: 'list_models', editedWhere: "Set for this session only · your default model and effort are set in settings or the terminal's `/model`" },
  effort: { readWith: 'list_models', editedWhere: "Set for this session only · your default model and effort are set in settings or the terminal's `/model`" },
  fast: { readWith: 'list_models', editedWhere: "Set for this session only · your default model and effort are set in settings or the terminal's `/model`" },
  permissions: { readWith: 'list_permission_rules', editedWhere: 'Rules are edited in their settings files; session grants come from approval cards' },
  usage: { readWith: 'get_usage', editedWhere: 'Windows come from ClaudeUsage; the engine reports none through the relay' },
  config: { readWith: 'get_settings', editedWhere: "Settings are edited in their files or the terminal's `/config`; MAWS's own settings are in the Settings tab" },
  plugins: { readWith: 'system/init', editedWhere: "Enable and disable in settings (`enabledPlugins`) or the terminal's `/plugins`; the engine lists what it loaded" },
  mcp: {
    readWith: 'mcp_status',
    editedWhere: 'Servers are configured in `.mcp.json` and settings · Reconnect is for this session · Enable and disable: recorded by the engine for this project in `~/.claude.json`',
  },
  sandbox: { readWith: 'get_sandbox_dialog', editedWhere: "Sandbox is enabled in settings (`sandbox`); the terminal's toggle writes there" },
  hooks: { readWith: 'get_hooks_listing', editedWhere: "Hooks are edited in settings and plugins; MAWS's own callback hooks are not listed by the engine (none in P0)" },
  memory: { readWith: 'get_memory_dialog', editedWhere: 'Memory files are edited in your editor; Reveal opens their folder' },
  skills: { readWith: 'get_skills_dialog and system/init', editedWhere: 'Skills are files under `.claude/skills` and plugins; the palette runs them' },
  agents: { readWith: 'initialize', editedWhere: 'Agents are files under `.claude/agents` and plugins' },
  status: { readWith: 'get_status', editedWhere: 'What `/status` prints in the terminal' },
  compact: { readWith: 'get_context_usage', editedWhere: 'Compaction rewrites the conversation; nothing on disk is truncated' },
  context: { readWith: 'get_context_usage', editedWhere: "Context is the engine's own accounting" },
  rename: { readWith: 'rename_session', editedWhere: 'Named through the engine, so the terminal sees it' },
  resume: { readWith: 'the sessions list', editedWhere: 'There is no resume control on the wire; a resume is a launch (C10)' },
  export: { readWith: 'export_conversation', editedWhere: "The engine's own text export; the JSONL stays where it is" },
  diff: { readWith: 'get_workspace_diff', editedWhere: 'Read-only; staging and commits are P1' },
};

// The frame's states.
export const READING = 'Reading…';
export const NO_ANSWER = 'The engine did not answer';

// The widgets M3 builds, registered now so every name opens something.
export const ARRIVES_IN_M3 = 'This widget arrives with the next C11 milestone.';

// Permissions: a rule's source in words (unknown sources verbatim), and the groups in the engine's order.
export const RULE_SOURCE: Record<string, string> = {
  session: 'this session · grant',
  flagSettings: 'startup settings',
  projectSettings: '.claude/settings.json · project',
  userSettings: '~/.claude/settings.json · user',
  localSettings: '.claude/settings.local.json',
  policySettings: 'managed',
  cliArg: 'command line',
};
export const RULE_GROUP = { allow: 'Allow', ask: 'Ask', deny: 'Deny' } as const;
export const RULE_EDITABILITY: Record<string, string> = { session: 'this session', readonly: 'read-only here', persistent: 'in a settings file' };
export const WORKSPACE = 'Workspace';
export const NO_RULES = 'No rules · every tool asks as the mode decides';
export const EFFECTIVE_MODE = 'from the init frame';

// Usage.
export const ENGINE_WINDOWS_NONE = 'the engine reports no windows through the relay';
export const ENGINE_WINDOWS_DIRECT = "the engine's own windows (a direct session)";
export const NO_RECORD = 'No record for this session';

// Context.
export const NOT_IN_WINDOW = 'not in the window';

// Plugins.
export const NO_PLUGINS = 'The engine loaded no plugins';

// MCP.
export const NO_SERVERS = 'No MCP servers';

// Hooks.
export const NO_HOOKS = 'No hooks configured';
export const HOOKS_DISABLED_BY_POLICY = 'Hooks are disabled by policy';

// Memory.
export const FILE_MISSING = 'does not exist yet';
export const REVEAL = 'Reveal';
export const REVEAL_REFUSED = 'Finder was not opened for this path';
export const ADD_NOTE = 'Add a note';

// Skills and agents.
export const USE = 'Use';
export const MENTION = 'Mention';
export const NO_SKILLS = 'No skills in the catalogue';
export const NO_AGENTS = 'No agents in the catalogue';

// Diff.
export const NO_DIFF = 'No diff · not a git repository, or a merge, rebase or cherry-pick is in progress';
export const OPEN_IN_REVIEW = 'Open in Review';

// Export.
export const COPY = 'Copy';
export const COPIED = 'Copied';
export const SAVE_AS = 'Save as…';
export const SAVED = (path: string) => `Saved to ${path}`;

// Config.
export const OPEN_FILE = 'Open file';
export const MAWS_SETTINGS = 'MAWS settings';
export const NO_EFFECTIVE = 'No settings in effect beyond the defaults';
