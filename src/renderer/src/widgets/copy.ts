// Every widget string in one table (C11 execution document, Repository map and the widget table under Interfaces
// "Widgets"). E11's sitting (owner-notes 00-consolidated-plan §2.2) removed C11's `Read with … · …` foot from every
// frame: a change's scope, what it writes, a lock and a destructive consequence are said beside the control or in its
// sheet, in words, never as a footer naming the wire.
import type { PermissionMode } from '@shared/graph/enums';
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import type { WidgetCommandName } from '../composer';
import { STARTING_SESSION } from '../statusline/mode-menu';
import { NO_ANSWER } from '../ipc/transport-words';
// P2-C start (2026-10-09)
import type { ModRow } from '@shared/mods/registry';
import type { LaneOverride } from '@shared/owner/state';
// P2-C end

export const WIDGET_TITLE: Record<WidgetCommandName, string> = {
  model: 'Model & effort',
  effort: 'Effort',
  fast: 'Fast mode',
  permissions: 'Permissions', // the word cut (P516)
  usage: 'Usage',
  config: 'Config',
  plugins: 'Plugins',
  mcp: 'Connectors', // UX wave U11a (§C): the dialog's name, with `MCP.subtitle` beside it
  sandbox: 'Sandbox',
  hooks: 'Hooks',
  memory: 'Memory',
  skills: 'Skills',
  agents: 'Agents',
  status: 'Status',
  compact: 'Compact',
  context: 'Context',
  rename: 'Rename',
  resume: 'Resume session', // P2-D: the chooser's name
  export: 'Export',
  diff: 'Changes',
  rewind: 'Rewind', // W3 (B7)
  fork: 'Fork', // UX wave U4a (decision 18)
  btw: 'Side question', // E3
  'reload-plugins': 'Reload plugins', // E11 §2.2: the engine's terminal-only command as MAWS's action
};

// The frame. The word cut (P518, P523): `reading` and `starting` name the quiet spinner that stands for the wait; P519
// and P521 cut "Not read yet." and the "Read" before a cached answer's age; P525 shortens the stale line's tail, which
// the transport branch's own words (`transportWords`) keep long.
export const FRAME = {
  reading: 'Reading…',
  noAnswer: NO_ANSWER,
  lastValue: 'last reading shown',
  close: (title: string) => `Close ${title}`,
  // P2-A start (2026-10-09; the execution document §5.6, §10 Q5): a session with a record and no ready process
  loadNow: 'Load now',
  refresh: 'Refresh',
  starting: STARTING_SESSION,
  // P2-A end
};

// Words several widgets share.
export const SHARED = { none: 'none', on: 'on', off: 'off', yes: 'yes', no: 'no', reveal: 'Reveal', revealRefused: 'Finder was not opened for this path' };

// Permissions: a rule's source in words (an unknown source verbatim), the groups in the engine's order, the workspace.
// The word cut (P586): a source is one word, the same in Config's Sources and the hooks' list (N184); the settings file
// it names is the word's tooltip, which also says where rules are edited (P582). P587 leaves "in a settings file" off
// a rule's second line, P588 the first folder's "original directory".
export const PERMISSIONS = {
  source: {
    session: 'session',
    flagSettings: 'startup',
    projectSettings: 'project',
    userSettings: 'user',
    localSettings: 'local',
    policySettings: 'managed',
    cliArg: 'command line',
  } as Record<string, string>,
  sourceFile: { projectSettings: '.claude/settings.json', userSettings: '~/.claude/settings.json', localSettings: '.claude/settings.local.json' } as Record<string, string>,
  editedIn: (file: string) => `Edited in ${file}`,
  group: { allow: 'Allow', ask: 'Ask', deny: 'Deny' },
  editability: { session: 'this session', readonly: 'read-only here' } as Record<string, string>,
  rules: (group: string) => `${group} rules`,
  none: 'No rules', // the word cut (P584)
  workspace: 'Workspace',
  workspaceList: 'Workspace directories',
  added: 'added',
  managedOnly: 'Only managed rules apply',
  grants: (n: number) => `${n} session grant${n === 1 ? '' : 's'} · re-applied after a resume`,
  mode: 'Mode', // the group of the mode segment, which its note describes
  modeScope: 'The mode applies to this session only', // the word cut (P582): the segment's note
};

// Usage.
export const USAGE = {
  cost: 'Cost',
  apiTime: 'API time',
  wallTime: 'Wall time',
  lines: 'Lines',
  model: (input: string, output: string, cacheRead: string, cacheWrite: string) => `${input} in · ${output} out · ${cacheRead} cache read · ${cacheWrite} cache write`,
  direct: 'Direct', // the word cut (P592)
  noPlanLimits: 'The engine reported no plan limits',
  pinned: 'Pinned account',
  routing: 'Routing account',
  readingClaudeUsage: 'Reading ClaudeUsage', // the word cut (P596): the quiet spinner's name in the account line's place
  noAccount: 'Account not found', // N183: ClaudeUsage answered and names no account for this session, a settled state
  readFailed: "Couldn't read ClaudeUsage", // N183: the read failed and no snapshot is held; a later one replaces it
  unavailable: 'ClaudeUsage is not installed or has no data', // W2: the status line's usage popover said it; its own words now
  fiveHour: '5h',
  weekly: 'Weekly',
  windows: 'Windows',
  noReading: 'no reading',
  sinceReset: '0%', // the word cut (P594): the figure alone
  resetsIn: (percent: number, when: string) => `${percent}% · resets in ${when}`,
  session: 'This session',
  accounting: 'Session accounting',
  models: 'Models',
  byModel: 'Tokens by model',
  details: 'Details', // the word cut (P597, P598): the session's times, lines and tokens per model fold under it
  noRecord: 'No record for this session',
};

// Context.
export const CONTEXT = {
  line: (used: string, max: string, percent: number, threshold: string | null) => `${used} of ${max} · ${percent}% · ${threshold === null ? 'autocompact off' : `autocompact at ${threshold}`}`,
  notInWindow: 'not in the window',
  bar: (names: string) => `Context: ${names}`,
  categories: 'Context categories',
  costs: 'Every request', // the word cut (P602)
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
  noEffective: 'Defaults only', // the word cut (P606)
  sources: 'Sources',
  sourceList: 'Settings sources',
  applied: 'Applied', // the word cut (P609): Model and Effort leave it, since the model chip carries both
  appliedList: 'Applied to this session',
  advisor: 'Advisor',
  ultracode: 'Ultracode',
  errors: 'Errors',
  mawsSettings: 'MAWS settings',
};

// Plugins.
export const PLUGINS = { none: 'The engine loaded no plugins', problems: 'Problems', problemList: 'Plugin problems', loaded: 'Loaded in this session', loadedList: 'Loaded plugins' };

// MCP. UX wave U11a (§C): the Connectors dialog's head, its muted subtitle and the one sentence of what the switch
// reaches, each switch row's note with where the engine records the switch after it (the word cut, N148); `failed` and `off` are the status words Customize's copy does not
// hold (connector-status.ts).
export const MCP = {
  none: 'No connectors',
  list: 'Connectors',
  subtitle: 'MCP servers',
  reach: (place: string) => `A switch here is for this chat, and every session started in ${place} afterwards.`,
  recorded: 'The engine records it in ~/.claude.json.',
  failed: 'Failed',
  off: 'Off',
  scope: (scope: string) => `scope ${scope}`,
  from: (source: string) => `from ${source}`,
  tools: (n: number) => `${n} tool${n === 1 ? '' : 's'}`,
};

// UX wave U11a (§D, l8-settings-03): an unstarted tab's Connectors and Skills dialogs, what the three dialogs and the
// "+" › Connectors submenu say for a tab set to another machine, and the place named with no folder chosen.
export const BEFORE_START = {
  connectors: (place: string) => `Configured for ${place}`, // the word cut (P573, ruled 2026-11-20)
  skills: (place: string) => `On disk for ${place}`, // the word cut (P744)
  remote: (machine: string) => `Shown once the chat starts on ${machine}`,
  userConfiguration: 'your user configuration',
};

// The "+" › Connectors submenu's line where a started session lists no rows (connector-menu.ts); the word cut (P578,
// P579): still saying it is empty, and why, in a few words.
export const CONNECTOR_MENU = {
  noneReported: 'No connectors',
  notRunning: 'Session not running',
};

// Sandbox (E11 §2.2): on or off first, with why it is off or what happens to a command it cannot run; the engine's
// fields under Details.
export const SANDBOX = {
  on: 'Sandbox on',
  off: 'Sandbox off',
  notInSettings: 'Not turned on in your settings',
  notInEffect: 'Turned on in your settings but not in effect',
  unavailable: (reason: string) => `Turned on in your settings but unavailable: ${reason}`,
  unsupported: (reason: string | null) => `Not supported on this Mac${reason ? `: ${reason}` : ''}`,
  fallbackAllowed: 'A command that fails in the sandbox may run outside it, with your permission',
  fallbackRefused: 'Commands run only inside the sandbox',
  fallbackRefusedOthers: 'Other commands run only inside the sandbox', // under `outside`: the excluded ones are named first
  // the excluded commands, which run outside the sandbox whatever the fallback says: the first three, then a count
  outside: (commands: string[]) => `Runs outside it: ${commands.slice(0, 3).join(', ')}${commands.length > 3 ? ` and ${commands.length - 3} more` : ''}`,
  locked: 'Set by your organization', // the word cut (P614)
  details: 'Details', // the word cut (P617): no longer repeats the first read's settings, policy lock or fallback
  autoAllow: 'Auto-allow',
  available: 'available',
  notAvailable: 'not available',
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
export const MEMORY = { missing: 'not created', files: 'Files', fileList: 'Memory files', folders: 'Folders', folderList: 'Memory folders', autoMemory: (status: string) => `Auto memory · ${status}`, addNote: 'Add a note' };

// Skills and agents.
export const AGENTS = { mention: 'Mention', none: 'No agents', list: 'Agents' }; // the word cut (P627; P628 draws Mention on pointing)

// Diff. The word cut (P643, P647): the first line is the line counts, with what a branch comparison compares against;
// "No diff" keeps its reasons for the pointer.
export const DIFF = {
  none: 'No diff',
  noneWhy: 'Not a git repository, or a merge, rebase or cherry-pick is in progress',
  against: (branch: string) => `against ${branch}`,
  binary: 'binary',
  untracked: 'untracked',
  skipped: (n: string, one: boolean) => `${n} large file${one ? '' : 's'} skipped`,
  restricted: (n: string, one: boolean) => `${n} restricted file${one ? '' : 's'} not shown`,
  list: 'Changed files',
  openInReview: 'Open in Review',
  reviewUnavailable: 'Review is not available',
};

// Export. The word cut (P640, P638): `copied` is said to a screen reader while Copy shows its check; the preview line
// has no line count.
export const EXPORT = {
  copy: 'Copy',
  copied: 'Copied',
  notCopied: (why: string) => `The export was not copied · ${why}`,
  saveAs: 'Save as…',
  saved: (path: string) => `Saved to ${path}`,
  notSaved: (why: string) => `The export was not saved · ${why}`,
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
  cannotHoldAuto: 'Cannot hold auto mode', // L99: the mode it runs in is the chip's (and the setup note's), which the launch's fallback decides
  current: 'current',
  pending: 'setting…', // the word cut (C39): a change on its way, under the effort slider and on the fast-mode row
  none: 'No models', // the word cut (P551)
  unknownArg: (name: string) => `No model named ${name}`, // the word cut (P537)
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
  relayAskTitle: 'Start on the relay?',
  relayAsk: (name: string) => `${name} runs through ClaudeUsage’s relay · this session would start routed instead of direct`,
  keepDirect: 'Keep Direct',
  useRelay: 'Use the relay',
  // A gateway model's auto-mode note as the widget words it (§19; mockup 06 vignette 03): C10's `GATEWAY_AUTO_NOTE`
  // is its chip's one line; the widget's form names the account the local reviews are counted against (the word cut,
  // P534: one sentence, the consequence).
  gatewayNote: (account: string) => `Auto-mode reviews run locally and count against ${account}.`,
  effort: 'Effort',
  fast: 'Fast mode',
  fastForOpus: 'Fast mode is for Opus',
  cooldown: 'on · cooling down',
  fastWarning: 'Fast mode disables the auto-mode server lane: reviews then run locally on Sonnet 5 and count against usage',
  keepAuto: 'Keep auto mode',
  cancel: 'Cancel',
  turnOn: 'Turn on fast mode',
  turnOff: 'Turn off fast mode',
  // fast_mode_disabled_reason in words (SPEC 06 §18.1:5030's table); `sdk_opt_in_required` is what the switch sends,
  // and has no words: an off switch says it (the word cut, P541)
  fastReason: {
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
  none: 'Nothing to rewind to', // the word cut (P648)
  what: 'What to rewind',
  option: { conversation: 'Conversation', files: 'Files', both: 'Both' } as const,
  noCheckpoints: 'File checkpointing is off for this session, so its files cannot be rewound', // the word cut (P650): the greyed Files' and Both's reason alone
  busy: 'Wait for the turn to end, or stop it first',
  rewind: 'Rewind to before it',
  refused: (reason: string) => `The rewind was refused · ${reason}`,
  noReason: 'no reason given',
  filesRefused: 'The files could not be rewound',
  filesDone: 'Files rewound to before that message',
  filesNotRestored: (why: string) => `The conversation was rewound; its files were not · ${why}`,
  consequence: 'The next message continues from that point; the transcript on disk keeps everything', // E11 §2.2: was the foot's
};

// W3: the model selector's own words (Codex's two-view menu, r1-codex §5; Claude Desktop's slider ends).
export const SELECTOR = {
  effortView: 'Effort',
  modelView: 'Select model', // the model view's group name; its heading is `model` (the word cut, P544)
  models: 'Models',
  effort: 'Effort',
  effortUnknown: 'Not known yet',
  noEffort: 'No effort setting',
  position: (word: string, at: number, of: number) => `${word}, ${at} of ${of}`,
  faster: 'Faster',
  smarter: 'Smarter',
  openModels: (model: string) => `${model} · Select model`,
  back: 'Back to effort',
  reset: "Reset effort to the model's default", // the reset's name; its tooltip is `resetTip` (the word cut, P531)
  resetTip: 'Reset effort',
  default: 'Default',
  recommended: 'Recommended set of models',
  model: 'Model',
  setting: 'setting…', // the chip's word (C38), and the accessible name of the checked row's spinner (the word cut, P549)
  reading: 'Reading the models…', // the accessible name of the read's spinner (the word cut, P535)
  sessionOnly: 'For this session only',
  // P5 O9 M5 (the owner's Q1, as recommended): what a model or effort set on a terminal session through its bridge does
  terminalOnly: "The terminal's status line won't show this change", // the word cut (C41): the consequence alone
  unknownEffort: (word: string) => `No effort level named ${word}`,
};

// A typed `/<widget> <args>` applied at Enter (the architect's correction of 2026-09-29): the toast after the control
// answered, in the widget's words; a refusal or the transport branch toasts the widget's error words instead. The word
// cut (P558): the name and the new value, with no pending tail; a model that cannot hold auto mode still says so.
export const TYPED = {
  model: (name: string, cannotHoldAuto = false) => `Model · ${name}${cannotHoldAuto ? ` · ${MODEL.cannotHoldAuto}` : ''}`,
  effort: (level: string | null) => `Effort · ${level ?? "the model's default"}`,
  fastOff: 'Fast mode · off',
  mode: (mode: PermissionMode) => `Permission mode · ${PERMISSION_MODE_LABELS[mode]}`,
  // the permissions widget opened with an argument it did not apply
  modeAsks: (mode: PermissionMode) => `${PERMISSION_MODE_LABELS[mode]} asks first · choose it below`,
  modeUnknown: (arg: string) => `No permission mode named ${arg}`,
};

// Plugins' Reload. The word cut (P672): the receipt is "Reloaded", with the errors counted when there are some; P751:
// `/reload-plugins` says it in a toast and closes, its quiet spinner named `reloading` while it runs.
const errorCount = (n: number) => `${n} error${n === 1 ? '' : 's'}`;
export const RELOAD = {
  reload: 'Reload',
  done: 'Reloaded',
  reloaded: (errors: number) => (errors === 0 ? 'Reloaded' : `Reloaded · ${errorCount(errors)}`),
  skills: 'Reloaded', // E8: `reload_skills`
  reloading: 'Reloading plugins…',
  pluginsReloaded: (errors: number) => (errors === 0 ? 'Plugins reloaded' : `Plugins reloaded · ${errorCount(errors)}`),
};

// E8: plugin management in `/plugins` (E8 execution document, M2): the sections, the confirm sheet and a row's
// operation line. The engine's own `message` and `failureCode` are shown as it printed them, never paraphrased.
export const PLUGIN_MANAGEMENT = {
  otherMachine: 'This session runs on another machine; its plugins can’t be managed here yet.', // P5 O6 M4: until O4 spans machines
  reloadMods: 'Reload plugins', // E11 §2.2: one name for `reload_plugins` here, in the panel and as `/reload-plugins`
  reloadSkills: 'Reload skills',
  // Installed, Available and Marketplaces: P2-B's library (`LIBRARY`) draws them; Add marketplace keeps E8's field words
  addPlaceholder: 'owner/repo, URL or folder',
  chooseFolder: 'Choose folder…',
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
    'mcp-add': 'Add connector', // P4-AGG M4
    'mcp-remove': 'Remove connector',
  } as const,
  submit: { install: 'Install', update: 'Update', uninstall: 'Uninstall', enable: 'Enable', disable: 'Disable', 'marketplace-add': 'Add', 'marketplace-update': 'Refresh', 'marketplace-remove': 'Remove', 'mcp-add': 'Add', 'mcp-remove': 'Remove' } as const,
  title: (verb: string, target: string) => `${verb} ${target}?`,
  scope: 'Scope',
  scopeName: { user: 'User', project: 'Project', local: 'Local' } as const,
  inProject: (path: string) => `In ${path}`,
  details: 'Details', // the disclosure over the exact commands and the files they write (the owner's ruling, 2026-10-25)
  writes: "The engine's CLI writes:",
  records: (globalConfig: string) => `and keeps its own records in ${globalConfig}`, // `plugins.env`'s path, verbatim
  dependencies: 'and the cache directories of any dependencies the marketplace declares, from this or an allowlisted marketplace, each enabled in the settings file above',
  overrides: 'and any enable or disable override for them in these settings files',
  alsoUninstalls: (plugins: string[]) => `Also uninstalls ${plugins.length} plugin${plugins.length === 1 ? '' : 's'}: ${plugins.join(', ')}`,
  resolving: 'Resolving the engine…', // the word cut (P724): the quiet spinner's name
  unresolved: 'The engine could not be resolved; choose a binary in Settings › Engine', // a refusal that came with no words
  reloadsIn: (n: number) => `Reloads plugins in ${n} running ${n === 1 ? 'session' : 'sessions'}`,
  understand: 'I understand',
  declaredTitle: (target: string) => `Run the command ${target} declares?`,
  declared: "The marketplace declares this command; the engine's CLI runs it only once you accept it:",
  runIt: 'Run it',
  // a row's operation line
  reloading: 'Reloading running sessions…',
  notReflectedIn: (title: string) => `not reflected in ${title}`,
  mayOverride: 'a project setting may override it',
  failedIn: (title: string, error: string) => `failed in ${title} · ${error}`,
  versionChange: (from: string, to: string) => `${from} → ${to}`,
  done: 'Done',
  cancel: 'Stop', // `plugins.cancel`: stops the CLI, or drops an operation still queued behind another
  reloadAgain: 'Reload again',
};

// MCP's Reconnect and the persistent enable switch (what it reaches is each switch row's note: `MCP.reach`). The word
// cut (P569, P570): a quiet spinner named `working` on the knob or beside Reconnect while it works, and nothing under the
// row after a success; `done` stays only inside a doubt ("Unconfirmed · Done").
export const MCP_ACTIONS = {
  reconnect: 'Reconnect',
  working: 'Working…',
  enabled: (name: string) => `Enabled: ${name}`,
  done: 'Done',
  notConnected: (error: string) => `On · not connected · ${error}`,
  unconfirmed: (words: string) => `Unconfirmed · ${words}`,
  readAgain: 'Read again',
};

// Compact. The word cut (P629, P631): `instructions` is the field's name, not drawn; the button reads Compact.
export const COMPACT = {
  instructions: 'Instructions',
  placeholder: 'What the summary should keep (optional)',
  now: 'Compact',
  waitTurn: 'Wait for the turn',
  queuedFirst: 'Queued messages go first',
  unanswered: `${NO_ANSWER} · the command may still run; check the transcript before sending again`, // a send is no read: nothing to show "the last value" of
  open: 'Compact…',
  consequence: 'Summarises the conversation for the turns after it; the transcript on disk keeps everything', // E11 §2.2: was the foot's
};

// Rename. The word cut (P635, P637): `title` is the field's name, not drawn, and a rename that took closes the dialog
// with no line of its own (the new title shows where the session is named).
export const RENAME = {
  title: 'New title',
  rename: 'Rename',
  renaming: 'Renaming', // the quiet spinner while a typed title's rename is out
};

// Resume: P2-D's chooser has its words in resume/copy.ts.

// P2-B start (2026-10-09): the plugin library (the P2-B execution document §5.4 to §5.12; Claude Desktop's words where
// it has them, §10 Q9). The person's words; no provenance.
export const LIBRARY = {
  searchPlugins: 'Search plugins',
  show: 'Filter', // UX wave U11c (O-14): "Show" names Customize's row of kinds
  filter: { all: 'All plugins', enabled: 'Enabled', disabled: 'Disabled', loaded: 'Loaded in this session', otherProjects: 'Other projects' } as const,
  sortBy: 'Sort by',
  sort: { updated: 'Last updated', name: 'Name' } as const,
  group: {
    here: 'In this project',
    yours: 'Created by you',
    synced: 'Synced from claude.ai',
    anthropic: 'From Anthropic & Partners',
    added: 'From marketplaces you added',
    otherProjects: 'Other projects',
    builtIn: 'Built in', // the word cut (G223)
  } as const,
  list: 'Plugins',
  noneHere: 'No plugins installed for this project yet.',
  firstTitle: 'Add your first plugins',
  firstBody: 'Give Claude role-level expertise with plugins. Find them in Discover.',
  noMatch: 'Nothing matches these filters.',
  resetFilters: 'Reset filters',
  // Filter › Loaded in this session with nothing observed, or with no session (the word cut, P678)
  loadedUnknown: 'Not known yet',
  noSession: 'No running session',
  showAll: 'Show all',
  failed: "Couldn't load your plugins.",
  retry: 'Retry',
  manifestsFailed: "Couldn't read your plugins' details.", // `plugins.manifest` refused: the rows stay, by name
  // a row. The word cut (G215, G216, G218, G217, P683, P685): its switch in place of "Disabled" and the menu's Turn on or
  // off; its description (or its skills counted) and its date in its row note; where it is managed in a few words, the
  // switch's reason saying the rest; the three dots' tooltip "More", its name the longer words
  isNew: 'New',
  newTooltip: 'Added or updated in the last 14 days',
  by: (author: string) => `by ${author}`,
  skills: (n: number) => `${n} skill${n === 1 ? '' : 's'}`,
  enable: (name: string) => `Enable ${name}`,
  more: 'More',
  moreActions: (name: string) => `More actions for ${name}`,
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  update: 'Update',
  uninstall: 'Uninstall…',
  managedIn: (project: string) => `In ${project}`,
  managedInMany: (n: number) => `In ${n} other projects`,
  whereManaged: (where: string) => `${where} · manage it from a session there`, // a greyed switch's and Update's reason
  // the loaded line
  loadedCount: (n: number) => `${n} plugin${n === 1 ? '' : 's'} loaded in this session`,
  problems: (n: number) => `${n} problem${n === 1 ? '' : 's'}`,
  refresh: 'Refresh',
  missingDirectory: (directory: string) => `Directory not found: ${directory}`, // A's words for the state
  builtIntoClaudeCode: 'Built into Claude Code',
  loadedFromFolder: 'Loaded from a folder',
  // MAWS mods · Built in (X20)
  builtIn: 'Built in',
  // P2-C start (2026-10-09): the section's words (the P2-C document, §9 and its M6 Decision Log), in place of P2-B's interim words
  mod: {
    version: (n: number) => `Version ${n}`,
    // the word cut (G225, G226, N149): the description and the summaries' sentence are row notes; the source line is gone
    unavailable: (reason: string) => `MAWS mods can’t be read right now: ${reason}`,
    refused: (reason: string) => `Not saved: ${reason}`,
    appSwitch: (name: string) => `${name} in every session`,
    session: 'This session',
    sessionOverride: (name: string) => `${name} in this session`,
    override: (appOn: boolean): { value: LaneOverride; label: string }[] => [
      { value: 'inherit', label: `Default (${appOn ? 'On' : 'Off'})` },
      { value: 'on', label: 'On' },
      { value: 'off', label: 'Off' },
    ],
    pending: {
      'next-launch': 'Applies the next time this session starts',
      'next-compaction': 'Applies after this session’s next compaction',
    } satisfies Record<NonNullable<ModRow['pending']>, string>,
    // UX wave U2b (M7; the execution document, §M, "The switch"): the to-human row's second line, in the mods list alone
    summaries: {
      label: 'Summaries on fold lines',
      sentence: 'Each summary is one small model call by the to-human mod, on the session’s own account. Off: sessions MAWS starts make no new summaries from their next start, and summaries already made stay. A session started in a terminal follows the mod’s own setting.',
    },
  },
  // P2-C end
  // the detail (§5.7; Desktop's words where it has them, c24c8737b-BY-86Rbf.js)
  view: (name: string) => `View ${name}`,
  myItems: 'My items',
  backTo: (library: string) => `Back to ${library}`,
  updated: (when: string) => `updated ${when}`,
  enablePlugin: 'Enable plugin',
  updateTo: (version: string) => `Update to ${version}`,
  onLatest: 'On latest version',
  installedAt: 'Installed for',
  chip: { local: 'This project · only you', project: 'This project', user: 'User', yours: 'Created by you', synced: 'Synced' } as const,
  onlyYou: 'only you',
  otherProjects: (n: number) => `${n} other project${n === 1 ? '' : 's'}`,
  syncedThere: 'Synced from claude.ai · change it there',
  yoursThere: 'From your own folder · change it there',
  // the word cut (G235, P710, P712, P713, G239, G240, P706): "Not enabled" alone, "Not loaded yet" with Reload, no
  // heading over What's inside (its region's name), no sentence under its kinds or atop the Skills tab; "Connectors"
  notEnabledHere: 'Not enabled for this project',
  loadedHere: 'Loaded in this session',
  notLoadedHere: 'Not loaded yet',
  overview: 'Overview',
  whatsInside: 'What’s inside',
  andMore: (n: number) => `and ${n} more`,
  kind: { mcpServers: 'Connectors', agents: 'Agents', hooks: 'Hooks', monitors: 'Monitors', lspServers: 'Language servers', commands: 'Commands', skills: 'Skills' } as const,
  bundles: (n: number) => `${n} MCP bundle${n === 1 ? '' : 's'}`,
  hookModules: (n: number) => `${n} hooks module${n === 1 ? '' : 's'}`,
  partial: 'Some of this plugin’s files could not be read, so what’s inside may not all be listed.',
  missing: 'This plugin’s files are not on disk.',
  unread: 'What’s inside could not be read.',
  detailsFailed: "Couldn't read this plugin's details.", // the detail's `plugins.manifest` refused: the controls and facts stay
  // the switch and the Add menu (M5; §5.8, §5.9; Desktop's words where it has them)
  library: 'Library',
  add: 'Add',
  discoverPlugins: 'Discover plugins', // the word cut (P655): the /plugins Add menu's first row
  addMarketplace: 'Add marketplace',
  manageMarketplaces: 'Manage marketplaces',
  manageLine: 'Marketplaces added with Claude Code on this computer. Removing one also uninstalls its plugins.',
  noMarketplaces: 'None yet.', // the word cut (P739, P740)
  pluginsInstalled: (n: number) => `${n} plugin${n === 1 ? '' : 's'}`,
  checkForUpdates: 'Check for updates',
  remove: 'Remove…',
  done: 'Done',
  cancel: 'Cancel',
  sourceField: 'Source',
  sourceHelper: 'A GitHub owner/repo, a Git repository URL or a folder on this Mac.',
  trustWarning:
    'Make sure you trust a plugin before installing, updating, or using it. Plugins installed from marketplaces are not controlled by Anthropic, and Anthropic cannot verify that they will work as intended or that they won’t change. See each plugin’s homepage for more information.',
};
// M6: the skills library (§5.10; Desktop's Skills section where it has words). Its groups are My items' (`LIBRARY.group`).
export const SKILLS_LIBRARY = {
  list: 'Skills',
  search: 'Search skills',
  sort: { name: 'Name', plugin: 'Plugin name' } as const,
  useInChat: 'Use in chat', // the word cut (P746): on a row, drawn on pointing or focus
  // U11a (the branch panel's finding 1): why Use in chat is greyed for a skill of a plugin the launch profile turns off
  pluginOff: 'Off in the sessions MAWS runs: Settings › Sessions › Plugins in sessions',
  pluginsUnread: 'Reading Settings › Sessions › Plugins in sessions…',
  firstTitle: 'Add your first skills',
  firstBody: 'Skills teach Claude how you work. Plugins bring them: Customize › Discover, with Show set to Skills, lists the plugins that carry skills.',
  failed: "Couldn't load your skills.",
  invoke: 'Type',
  plugin: 'Plugin',
  source: 'Source',
};
// P2-B end
