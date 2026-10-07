// Every widget string and foot in one table (C11 execution document, Repository map and the widget table under
// Interfaces "Widgets"). A foot reads `Read with <control> · <what is edited elsewhere>`; the sentences are the table's.
// Backticks in a sentence mark code, which the frame renders in mono.
import type { PermissionMode } from '@shared/graph/enums';
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import type { WidgetCommandName } from '../composer';
import { NOT_RUNNING } from '../statusline/mode-menu';
import { LAST_VALUE, NO_ANSWER } from '../ipc/transport-words';

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
  rewind: 'Rewind', // W3 (B7)
  btw: 'Side question', // E3
};

// `/usage` on a direct session: its windows are the engine's own, not ClaudeUsage's (C11 M6, live).
export const USAGE_DIRECT_FOOT: WidgetFoot = { readWith: 'get_usage', editedWhere: 'A direct session’s windows come from the engine’s own login' };

// W3: the model selector (`model`, `effort`, `fast`) is a menu, not a framed widget, and has no foot.
export type FramedWidgetName = Exclude<WidgetCommandName, 'model' | 'effort' | 'fast'>;
export const WIDGET_FOOT: Record<FramedWidgetName, WidgetFoot> = {
  permissions: { readWith: 'list_permission_rules', editedWhere: 'Sets the mode with `set_permission_mode` for this session only · rules are edited in their settings files; session grants come from approval cards' },
  usage: { readWith: 'get_usage', editedWhere: 'Windows come from ClaudeUsage; the engine reports none through the relay' },
  config: { readWith: 'get_settings and get_memory_dialog', editedWhere: "Settings are edited in their files or the terminal's `/config`; MAWS's own settings are in the Settings tab" },
  plugins: pluginsFoot(null), // E8: the widget words it with the paths `plugins.env` answers, once it has
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
  compact: { readWith: 'get_context_usage', editedWhere: 'Sends `/compact` as the next message · compaction rewrites the conversation; nothing on disk is truncated' },
  context: { readWith: 'get_context_usage', editedWhere: "Context is the engine's own accounting" },
  rename: { readWith: 'rename_session', editedWhere: 'Named through the engine, so the terminal sees it' },
  resume: { readWith: 'the sessions list', editedWhere: 'There is no resume control on the wire; a resume is a launch (C10)' },
  export: { readWith: 'export_conversation', editedWhere: "The engine's own text export; the JSONL stays where it is" },
  diff: { readWith: 'get_workspace_diff', editedWhere: 'Read-only; staging and commits are P1' },
  rewind: { readWith: 'rewind_conversation and rewind_files', editedWhere: 'The transcript on disk is never truncated: the next turn branches from the earlier message' }, // W3 (B7)
  btw: { readWith: 'side_question', editedWhere: 'Answered beside the running turn with no tools; nothing is added to the conversation · answers show in the Side pane' }, // E3
};

// The frame.
export const FRAME = { reading: 'Reading…', noAnswer: NO_ANSWER, lastValue: LAST_VALUE, readWith: 'Read with', close: (title: string) => `Close ${title}` };

// Words several widgets share.
export const SHARED = { none: 'none', on: 'on', off: 'off', yes: 'yes', no: 'no', reveal: 'Reveal', revealRefused: 'Finder was not opened for this path' };

// Permissions: a rule's source in words (an unknown source verbatim), the groups in the engine's order, the workspace.
export const PERMISSIONS = {
  source: {
    session: 'this session · grant',
    flagSettings: 'startup settings',
    projectSettings: '.claude/settings.json · project',
    userSettings: '~/.claude/settings.json · user',
    localSettings: '.claude/settings.local.json',
    policySettings: 'managed',
    cliArg: 'command line',
  } as Record<string, string>,
  group: { allow: 'Allow', ask: 'Ask', deny: 'Deny' },
  editability: { session: 'this session', readonly: 'read-only here', persistent: 'in a settings file' } as Record<string, string>,
  rules: (group: string) => `${group} rules`,
  none: 'No rules · every tool asks as the mode decides',
  effective: 'Effective',
  fromInit: 'from the init frame',
  workspace: 'Workspace',
  workspaceList: 'Workspace directories',
  original: 'original directory',
  added: 'added',
  managedOnly: 'Only managed rules apply',
  grants: (n: number) => `${n} session grant${n === 1 ? '' : 's'} · re-applied after a resume`,
};

// Usage.
export const USAGE = {
  cost: 'Cost',
  apiTime: 'API time',
  wallTime: 'Wall time',
  lines: 'Lines',
  model: (input: string, output: string, cacheRead: string, cacheWrite: string) => `${input} in · ${output} out · ${cacheRead} cache read · ${cacheWrite} cache write`,
  engineNone: 'the engine reports no windows through the relay',
  engineNoneDirect: 'the engine reports no windows for this login',
  engineDirect: "the engine's own windows (a direct session)",
  direct: 'Direct · the engine’s own login',
  noPlanLimits: 'The engine reported no plan limits',
  pinned: 'Pinned account',
  routing: 'Routing account',
  readingClaudeUsage: 'Reading ClaudeUsage…',
  unavailable: 'ClaudeUsage is not installed or has no data', // W2: the status line's usage popover said it; its own words now
  fiveHour: '5h',
  weekly: 'Weekly',
  windows: 'Windows',
  noReading: 'no reading',
  sinceReset: '0% · no reading since the window reset',
  resetsIn: (percent: number, when: string) => `${percent}% · resets in ${when}`,
  session: 'This session',
  accounting: 'Session accounting',
  models: 'Models',
  byModel: 'Tokens by model',
  noRecord: 'No record for this session',
};

// Context.
export const CONTEXT = {
  line: (used: string, max: string, percent: number, threshold: string | null) => `${used} of ${max} · ${percent}% · ${threshold === null ? 'autocompact off' : `autocompact at ${threshold}`}`,
  notInWindow: 'not in the window',
  bar: (names: string) => `Context: ${names}`,
  categories: 'Context categories',
  costs: 'What loads with every request',
  memoryFiles: 'Memory files',
  mcpTools: 'MCP tools',
  agents: 'Agents',
  commands: 'Commands',
  skills: 'Skills',
  listed: (count: string, tokens: string) => `${count} · ${tokens} tokens`,
  included: (included: string, total: string, tokens: string) => `${included} of ${total} · ${tokens} tokens`,
};

// Config.
export const CONFIG = {
  effective: 'Effective',
  effectiveList: 'Effective settings',
  noEffective: 'No settings in effect beyond the defaults',
  sources: 'Sources',
  sourceList: 'Settings sources',
  noKeys: 'no keys',
  applied: 'Applied',
  appliedList: 'Applied to this session',
  model: 'Model',
  effort: 'Effort',
  advisor: 'Advisor',
  ultracode: 'Ultracode',
  errors: 'Errors',
  openFile: 'Open file',
  mawsSettings: 'MAWS settings',
};

// Plugins.
export const PLUGINS = { lastReported: `${NOT_RUNNING} · the plugins it last reported`, none: 'The engine loaded no plugins', problems: 'Problems', problemList: 'Plugin problems', loaded: 'Loaded in this session', loadedList: 'Loaded plugins' };

// E8: the `/plugins` widget's foot. Every change runs the engine's CLI after a sheet; a listing writes no configuration
// but refreshes the engine's own catalogue cache (E8 D-12), and the CLI keeps its own records in its global config file
// (`plugins.env`'s `globalConfig`, verbatim). Until `plugins.env` answers, the foot names no path.
export function pluginsFoot(paths: { configHome: string; globalConfig: string } | null): WidgetFoot {
  const readWith = 'claude plugin list --json · marketplace list --json · system/init';
  if (paths === null) return { readWith, editedWhere: "Every change runs the engine's CLI after you confirm it · the files it writes are named once the engine is resolved" };
  const home = paths.configHome;
  return {
    readWith,
    editedWhere: `Every change runs the engine's CLI after you confirm it; the engine writes \`${home}/settings.json\` and \`${home}/plugins\` and keeps its own records in \`${paths.globalConfig}\` · listing refreshes the engine's own catalogue cache under \`${home}/plugins\``,
  };
}

// MCP.
export const MCP = { none: 'No MCP servers', list: 'MCP servers', scope: (scope: string) => `scope ${scope}`, from: (source: string) => `from ${source}`, tools: (n: number) => `${n} tool${n === 1 ? '' : 's'}` };

// Sandbox.
export const SANDBOX = {
  supported: 'supported',
  unsupported: (reason: string | null) => `unsupported${reason ? `: ${reason}` : ''}`,
  enabled: 'Enabled',
  enabledInSettings: 'Enabled in settings',
  locked: 'Locked',
  autoAllow: 'Auto-allow',
  available: 'available',
  notAvailable: 'not available',
  fallback: 'Unsandboxed fallback',
  unavailable: 'Unavailable',
  network: 'Network',
  managed: 'managed',
  settings: 'Sandbox settings',
  dependencies: 'Dependencies',
  excluded: 'Excluded commands',
  // the restriction lists in the terminal's order, by their wire keys
  restriction: {
    fs_deny_read: 'Deny reading',
    fs_allow_read: 'Allow reading',
    fs_allow_write: 'Allow writing',
    fs_deny_write: 'Deny writing',
    network_allowed_domains: 'Allowed domains',
    network_denied_domains: 'Denied domains',
    unix_sockets: 'Unix sockets',
    ignored_glob_patterns: 'Ignored patterns',
  },
};

// Hooks.
export const HOOKS = {
  none: 'No hooks configured',
  disabled: 'Hooks are disabled by policy',
  managedOnly: 'Only managed hooks run',
  pluginOnly: 'Only plugin hooks run',
  matcher: (matcher: string) => `matcher ${matcher}`,
  list: (event: string) => `${event} hooks`,
};

// Memory.
export const MEMORY = { missing: 'does not exist yet', files: 'Files', fileList: 'Memory files', folders: 'Folders', folderList: 'Memory folders', autoMemory: (status: string) => `Auto memory · ${status}`, addNote: 'Add a note' };

// Skills and agents.
export const SKILLS = { use: 'Use', none: 'No skills in the catalogue', list: 'Skills' };
export const AGENTS = { mention: 'Mention', none: 'No agents in the catalogue', list: 'Agents' };

// Diff.
export const DIFF = {
  none: 'No diff · not a git repository, or a merge, rebase or cherry-pick is in progress',
  workingTree: 'working tree',
  against: (branch: string) => `against ${branch}`,
  files: (n: string, one: boolean) => `${n} file${one ? '' : 's'}`,
  binary: 'binary',
  untracked: 'untracked',
  skipped: (n: string, one: boolean) => `${n} large file${one ? '' : 's'} skipped`,
  restricted: (n: string, one: boolean) => `${n} restricted file${one ? '' : 's'} not shown`,
  list: 'Changed files',
  openInReview: 'Open in Review',
  reviewUnavailable: 'Review is not available',
};

// Export.
export const EXPORT = {
  copy: 'Copy',
  copied: 'Copied',
  notCopied: (why: string) => `The export was not copied · ${why}`,
  saveAs: 'Save as…',
  saved: (path: string) => `Saved to ${path}`,
  notSaved: (why: string) => `The export was not saved · ${why}`,
  lines: (n: string) => `${n} lines`,
};

// ---- M3: the mutating widgets ---------------------------------------------------------------------------------------

// Operations (reload, reconnect, toggle): `Working…` from the receipt, then the outcome; a late success corrects an error.
export const OPERATION = {
  working: 'Working…',
  appliedAfterAll: 'Applied after all',
  failed: (message: string, code: string) => `${message} · ${code}`,
};

// Model, effort and fast mode (one component; `effort` and `fast` open it at their row).
export const MODEL = {
  group: { claude: 'Claude', gateway: 'Gateway' } as const,
  list: (group: string) => `${group} models`,
  oneM: '1M',
  cannotHoldAuto: `Cannot hold auto mode · runs in ${PERMISSION_MODE_LABELS.default}`,
  current: 'current',
  pending: 'set · the next init frame confirms it',
  none: 'The engine listed no models',
  unknownArg: (name: string) => `No model named ${name} in the engine's catalogue`,
  // set_model's refusal codes (SPEC 45 §45.16:3860–3880) in words; `error` follows as the caption
  code: {
    catalog_unknown: "Not in the engine's catalogue",
    restricted_by_org: 'Not allowed by your organization',
    unavailable_for_account: 'Not available for this account',
    not_offered: 'Not offered in this session',
    alias_1m_disabled: '1M context is turned off',
    alias_1m_unsupported: '1M context is not supported for this model',
    blocked_by_hook: 'A PreModelSwitch hook refused it',
    check_failed: 'The model check failed',
    invalid_request: 'The engine refused the request',
  } as Record<string, string>,
  refused: 'The engine refused the model',
  routingAccount: 'the routing account', // the gateway note's account when ClaudeUsage names none
  // an unstarted session's route (the architect's ruling of 2026-09-29, the D-19 surface on an unstarted tab)
  route: 'Route',
  directCannotServe: 'The direct route cannot serve these; choosing one starts the session on the relay',
  relayAskTitle: 'Start on the relay?',
  relayAsk: (name: string) => `${name} runs through ClaudeUsage’s relay · this session would start routed instead of direct`,
  keepDirect: 'Keep Direct',
  useRelay: 'Use the relay',
  // A gateway model's auto-mode note as the widget words it (§19; mockup 06 vignette 03): C10's `GATEWAY_AUTO_NOTE`
  // is its chip's one line; the widget's form names the account the local reviews are counted against.
  gatewayNote: {
    lead: 'Auto-mode reviews for this model run locally.',
    body: (account: string) => `A GPT route carries no Anthropic verdict, so the engine reviews each tool call itself on Sonnet 5 through ${account}. Those requests count against usage.`,
  },
  effort: 'Effort',
  unstarted: 'Applies when the session starts',
  fast: 'Fast mode',
  fastForOpus: 'Fast mode is for Opus',
  cooldown: 'on · cooling down',
  fastWarning: 'Fast mode disables the auto-mode server lane: reviews then run locally on Sonnet 5 and count against usage',
  keepAuto: 'Keep auto mode',
  cancel: 'Cancel',
  turnOn: 'Turn on fast mode',
  turnOff: 'Turn off fast mode',
  // fast_mode_disabled_reason in words (SPEC 06 §18.1:5030's table); `sdk_opt_in_required` is what the switch sends
  fastReason: {
    sdk_opt_in_required: 'Off until turned on here',
    not_first_party: 'Fast mode is only available when using the Anthropic API directly',
    disabled_by_env: 'Fast mode is not available',
    model_not_allowed: "This model is not in your organization's allowed models",
    pending: 'Checking fast mode availability',
    unknown: 'Fast mode is currently unavailable',
    free: 'Fast mode requires a paid subscription',
    preference: 'Fast mode has been disabled by your organization',
    extra_usage_disabled: 'Fast mode requires usage credits',
    network_error: 'Fast mode unavailable due to network connectivity issues',
  } as Record<string, string>,
};

// W3 (B7): the rewind picker's words (the terminal's Esc Esc picker).
export const REWIND = {
  messages: 'Your messages',
  none: 'No message of yours to rewind to yet',
  what: 'What to rewind',
  option: { conversation: 'Conversation', files: 'Files', both: 'Both' } as const,
  noCheckpoints: 'File checkpointing is off for this session, so its files cannot be rewound',
  busy: 'Wait for the turn to end, or stop it first',
  rewind: 'Rewind to before it',
  refused: (reason: string) => `The rewind was refused · ${reason}`,
  noReason: 'no reason given',
  filesRefused: 'The files could not be rewound',
  filesDone: 'Files rewound to before that message',
  filesNotRestored: (why: string) => `The conversation was rewound; its files were not · ${why}`,
};

// W3: the model selector's own words (Codex's two-view menu, r1-codex §5; Claude Desktop's slider ends).
export const SELECTOR = {
  effortView: 'Effort',
  modelView: 'Select model',
  selectModel: 'Select model',
  models: 'Models',
  effort: 'Effort',
  effortUnknown: 'Not known yet',
  noEffort: 'No effort setting',
  position: (word: string, at: number, of: number) => `${word}, ${at} of ${of}`,
  faster: 'Faster',
  smarter: 'Smarter',
  openModels: (model: string) => `${model} · Select model`,
  back: 'Back to effort',
  reset: "Reset effort to the model's default",
  default: 'Default',
  recommended: 'Recommended set of models',
  model: 'Model',
  setting: 'setting…',
  reading: 'Reading the models…',
  sessionOnly: 'For this session only',
  unknownEffort: (word: string) => `No effort level named ${word}`,
};

// A typed `/<widget> <args>` applied at Enter (the architect's correction of 2026-09-29): the toast after the control
// answered, in the widget's words; a refusal or the transport branch toasts the widget's error words instead.
export const TYPED = {
  model: (name: string, cannotHoldAuto = false) => `Model · ${name} · ${MODEL.pending}${cannotHoldAuto ? ` · ${MODEL.cannotHoldAuto}` : ''}`,
  effort: (level: string | null) => `Effort · ${level ?? "the model's default"} · ${MODEL.pending}`,
  fastOff: `Fast mode · off · ${MODEL.pending}`,
  mode: (mode: PermissionMode) => `Permission mode · ${PERMISSION_MODE_LABELS[mode]}`,
  // the permissions widget opened with an argument it did not apply
  modeAsks: (mode: PermissionMode) => `${PERMISSION_MODE_LABELS[mode]} asks first · choose it below`,
  modeUnknown: (arg: string) => `No permission mode named ${arg}`,
};

// Plugins' Reload.
export const RELOAD = {
  reload: 'Reload',
  done: 'Reloaded',
  reloaded: (commands: number, agents: number, plugins: number, errors: number) => `Reloaded · ${commands} commands · ${agents} agents · ${plugins} plugins · ${errors} error${errors === 1 ? '' : 's'}`,
  skills: (n: number) => `Reloaded · ${n} skill${n === 1 ? '' : 's'}`, // E8: `reload_skills`
};

// E8: plugin management in `/plugins` (E8 execution document, M2): the sections, the confirm sheet and a row's
// operation line. The engine's own `message` and `failureCode` are shown as it printed them, never paraphrased.
const sessionCount = (n: number) => `${n} session${n === 1 ? '' : 's'}`;
export const PLUGIN_MANAGEMENT = {
  reloadMods: 'Reload mods',
  reloadSkills: 'Reload skills',
  // Installed
  installed: 'Installed',
  installedList: 'Installed plugins',
  noInstalled: 'No plugins installed',
  enabled: 'enabled',
  disabled: 'disabled',
  enabledSwitch: (id: string) => `Enabled: ${id}`,
  update: 'Update',
  uninstall: 'Uninstall…',
  // Marketplaces
  marketplaces: 'Marketplaces',
  marketplaceList: 'Known marketplaces',
  noMarketplaces: 'No marketplaces configured',
  refresh: 'Refresh',
  remove: 'Remove…',
  addMarketplace: 'Add marketplace',
  addPlaceholder: 'owner/repo, URL or folder',
  add: 'Add…',
  chooseFolder: 'Choose folder…',
  // Available
  available: 'Available',
  filterPlaceholder: 'Filter available plugins',
  availableIn: (marketplace: string, n: number) => `${marketplace} · ${n} plugin${n === 1 ? '' : 's'}`,
  availableList: (marketplace: string) => `Available in ${marketplace}`,
  noAvailable: 'No plugins available to install',
  noMatch: 'No available plugin matches the filter',
  install: 'Install…',
  // the confirm sheet
  verb: {
    install: 'Install',
    update: 'Update',
    uninstall: 'Uninstall',
    enable: 'Enable',
    disable: 'Disable',
    'marketplace-add': 'Add marketplace',
    'marketplace-update': 'Refresh marketplace',
    'marketplace-remove': 'Remove marketplace',
  } as const,
  submit: { install: 'Install', update: 'Update', uninstall: 'Uninstall', enable: 'Enable', disable: 'Disable', 'marketplace-add': 'Add', 'marketplace-update': 'Refresh', 'marketplace-remove': 'Remove' } as const,
  title: (verb: string, target: string) => `${verb} ${target}?`,
  scope: 'Scope',
  scopeName: { user: 'User', project: 'Project', local: 'Local' } as const,
  inProject: (path: string) => `In ${path}`,
  writes: "The engine's CLI writes:",
  records: (globalConfig: string) => `and keeps its own records in ${globalConfig}`, // `plugins.env`'s path, verbatim
  dependencies: 'and the cache directories of any dependencies the marketplace declares, from this or an allowlisted marketplace, each enabled in the settings file above',
  overrides: 'and any enable or disable override for them in these settings files',
  elsewhere: (path: string) => `In ${path} · manage it from a session there`, // another project's installation, read-only here
  alsoUninstalls: (plugins: string[]) => `Also uninstalls ${plugins.length} plugin${plugins.length === 1 ? '' : 's'}: ${plugins.join(', ')}`,
  resolving: 'Resolving the engine…',
  unresolved: 'The engine could not be resolved; choose a binary in Settings › Engine', // a refusal that came with no words
  reloadsIn: (n: number) => `Reloads plugins in ${n} running ${n === 1 ? 'session' : 'sessions'}`,
  noSessionToReload: 'No running session to reload',
  nothingToReload: 'Nothing to reload: an added marketplace loads no plugin',
  understand: 'I understand',
  declaredTitle: (target: string) => `Run the command ${target} declares?`,
  declared: "The marketplace declares this command; the engine's CLI runs it only once you accept it:",
  runIt: 'Run it',
  // a row's operation line
  reloading: 'Reloading running sessions…',
  reloadedIn: (n: number) => `Reloaded in ${sessionCount(n)}`,
  reflected: 'reflected',
  notReflectedIn: (title: string) => `not reflected in ${title}`,
  mayOverride: 'a project setting may override it',
  failedIn: (title: string, error: string) => `failed in ${title} · ${error}`,
  versionChange: (from: string, to: string) => `${from} → ${to}`,
  done: 'Done',
  cancel: 'Stop', // `plugins.cancel`: stops the CLI, or drops an operation still queued behind another
  reloadAgain: 'Reload again',
};

// MCP's Reconnect and the persistent enable switch.
export const MCP_ACTIONS = {
  reconnect: 'Reconnect',
  reconnected: 'Reconnected',
  enabled: (name: string) => `Enabled: ${name}`,
  persisted: 'Recorded by the engine for this project in ~/.claude.json',
  done: 'Done',
  notConnected: (error: string) => `On · not connected · ${error}`,
  unconfirmed: (words: string) => `Unconfirmed · ${words}`,
  readAgain: 'Read again',
};

// Compact.
export const COMPACT = {
  instructions: 'Instructions',
  placeholder: 'What the summary should keep (optional)',
  now: 'Compact now',
  waitTurn: 'Wait for the turn',
  queuedFirst: 'Queued messages go first',
  unanswered: `${NO_ANSWER} · the command may still run; check the transcript before sending again`, // a send is no read: nothing to show "the last value" of
  open: 'Compact…',
};

// Rename.
export const RENAME = {
  title: 'New title',
  rename: 'Rename',
  renamed: (title: string) => `Renamed · ${title}`,
};

// Resume.
export const RESUME = {
  list: 'Sessions of this project',
  none: 'No other sessions in this project',
  open: 'Open',
  resume: 'Resume',
};
