// The Settings tab's words (C11 execution document, Interfaces "Settings tab"; mockup 06 vignette 04). Every row says
// where its value comes from and what MAWS will not touch.
// Amended 2026-11-13, UX wave U11 (l8-settings-06): a Settings row's note is one line; where its value comes from and
// what MAWS will not touch sit behind the row's More, and what a whole section shares is said once under its heading.
// Engine is split into Sessions, Engine and Supervisor, and the index is grouped.
import { MAX_IDLE_MINUTES } from '@shared/ipc/schema/settings'; // E10
import { MAX_APP_MCP_SERVERS } from '@shared/engine/app-mcp-servers'; // P4-R8

export const SECTIONS = {
  engine: 'Engine',
  gateway: 'Gateway',
  keyboard: 'Keyboard',
  voice: 'Voice', // E9
  appearance: 'Appearance',
  notifications: 'Notifications',
  sessions: 'Sessions',
  browser: 'Browser', // E4a: Settings › Browser (settings version 11)
  artifacts: 'Artifacts', // P3-D: Settings › Artifacts (settings version 14)
  org: 'Org', // P5 O8 M1: Settings › Org, the sign-in to the org, last in the index
  supervisor: 'Supervisor', // U11a M9: the background supervisor and the memory budget, out of Engine (the owner's name)
  usage: 'Usage', // UX wave U7b (O-47): the usage panel, which the title bar's ring links to
} as const;

export const INDEX = {
  title: 'Settings',
  footer: "Stored in MAWS's own Application Support folder. Nothing here writes into ~/.claude.",
  writeFailed: (why: string) => `The setting was not saved · ${why}`,
  reading: 'Reading settings…',
  // U11a M9 (l8-settings-06): the index's two group headings (an ampersand: "Sessions and engine" does not fit its width),
  // and its last link
  groups: { app: 'App', sessions: 'Sessions & engine' },
  customize: 'Customize',
  // U11a M10 (l8-settings-06): the search at the index's top; a result is a name with what stands under it, a row's
  // section, or one of these
  search: 'Search settings',
  noMatch: 'No matching settings',
  under: { section: 'Section', customize: 'Plugins, skills and connectors' },
};

// U11a M9 (l8-settings-06): a row's note is one line; the rest is behind More, opened in place. A note's words are its
// row's states (rows.ts): `line`, `more`, and `state` for a line that reports a condition the person must act on, which
// is never cut. A {name} in the words is a value the row fills in (a size, a number of minutes, a name).
export const NOTE = { more: 'More', less: 'Less' };

export const ENGINE = {
  // W13 (charter D-1 as amended 2026-10-01): the installed Claude Code by default, never refused for its version
  binary: 'Binary',
  change: 'Change…',
  useInstalled: 'Use installed',
  // E11 2.8: {version} is the release E11's live sittings ran, as the compat notice words it
  binaryNotes: {
    installed: { line: 'New sessions start on your installed Claude Code.', more: "Found again at every launch: ~/.local/bin/claude, else claude on your shell's PATH. Running sessions keep the binary they started on. MAWS was verified against Claude Code {version}." },
    chosen: { line: 'New sessions start on the binary you chose.', more: 'Running sessions keep the binary they started on. MAWS was verified against Claude Code {version}.' },
  },
  binaryReading: 'Reading the binary…',
  update: 'Update',
  updateAction: 'Update Claude Code…',
  updateNotes: {
    installed: { line: 'Runs claude update in a terminal tab.', more: 'New sessions start on the new version; running sessions keep theirs.' },
    chosen: { line: 'Runs claude update in a terminal tab.', more: 'New sessions stay on your chosen binary until Use installed. Running sessions keep theirs.' },
  },
  configHome: 'Config home',
  readOnly: 'read-only to MAWS',
  configHomeNotes: { default: { line: 'Where the engine keeps transcripts, settings and trust.' } },
};

// U11a M9 (l8-settings-06): Settings › Sessions, what shapes a session MAWS runs; the line under its heading says once
// what its rows' notes each said before
export const SESSIONS = {
  line: 'For sessions MAWS runs. Terminal sessions and your Claude Code settings files are not changed.',
  subagent: 'Subagent model',
  subagentPlaceholder: 'inherit', // W3: the engine's own word for no override (each agent's model, else the session's)
  subagentNotes: { default: { line: 'The model subagents use in new sessions; empty inherits.', more: 'Set as CLAUDE_CODE_SUBAGENT_MODEL at launch. Session info shows what a session actually got.' } },
  // W3 (charter D-18 as amended 2026-10-01)
  autoFallback: 'When auto mode is unavailable',
  autoFallbackNotes: { default: { line: 'The mode MAWS sets when the engine refuses auto for a session.', more: "Some models (Haiku), fast mode and auto mode's circuit breaker refuse auto. MAWS says so in the session, and the next resume asks for auto again." } },
  archive: 'Archive sessions inactive for',
  archiveNotes: { default: { line: 'Archived sessions can be restored from the sidebar.', more: 'Pinned, live, waiting and background-running sessions stay, as do worktrees with uncommitted changes.' } },
};

// P4-A2 start: the launch profile every session MAWS launches runs under (settings version 17); Settings › Sessions (U11a M9)
export const LAUNCH_PROFILE = {
  plugins: 'Plugins in sessions',
  pluginsNotes: { default: { line: 'Switch a plugin off to keep it out of the sessions MAWS runs.', more: "The list is what your Claude Code settings turn on. A change applies at a session's next launch." } },
  pluginsReading: 'Reading your plugins…',
  pluginsNone: 'Your settings turn on no plugins.',
  pluginOn: (id: string) => `Load ${id} in MAWS sessions`,
  hooks: 'Hooks in sessions',
  hooksNotes: { default: { line: "None turns off every hook in the sessions MAWS runs, the to-human plugin's included.", more: "Hooks come from your settings and your plugins. Without the to-human plugin's hooks a session runs without MAWS's report. A change applies at a session's next launch." } }, // P4-R7z: the plugin's message tool needs its hooks
  hooksYours: 'Yours',
  hooksNone: 'None',
};
// P4-A2 end

// P4-R8 start: Settings › Sessions › MCP servers (settings version 16; Engine's until U11a M9)
export const MCP_SERVERS = {
  label: 'MCP servers',
  notes: { default: { line: 'Extra HTTP servers for the sessions MAWS runs.', more: "An entry wins over a server of the same name in your own or a project's config. A Claude Code sign-in for a server of the same name and URL, without custom headers, carries over. A change applies at a session's next launch." } },
  name: 'Server name',
  url: 'Server URL',
  namePlaceholder: 'name',
  urlPlaceholder: 'https://…/mcp',
  add: 'Add',
  remove: (name: string) => `Remove ${name}`,
  badName: 'A name takes letters, digits, hyphens and underscores, up to 64 of them.',
  reservedName: 'That name is reserved by Claude Code or MAWS.',
  badUrl: "Enter the server's http or https URL.",
  duplicate: (name: string) => `${name} is already in the list.`,
  full: `The list holds at most ${MAX_APP_MCP_SERVERS} servers.`,
};
// P4-R8 end

// C12 start: the memory budget's rows in Settings › Supervisor (Engine's until U11a M9; C12 execution document, "Surfaces of the budget")
export const BUDGET_SETTINGS = {
  // W7 start: the switch (settings version 7); off hides the rows below it
  enabled: 'Memory budget',
  enabledLabel: 'Release idle sessions to stay under a memory limit',
  enabledNotes: { on: {}, off: { line: 'Off: an engine process ends only on archive, quit or stop.', more: 'Session info still shows the memory they use.' } },
  limit: 'Limit',
  // W7 end
  budget: 'Memory budget', // the limit's field
  placeholder: 'default',
  // the default's size while the setting is the default and the host has said it ({size}); without it once a limit is set
  limitNotes: {
    sized: { line: 'Default: 25% of physical memory ({size}).', more: 'Past it the least recently used idle session is released. Send resumes a released session.' },
    unsized: { line: 'Default: 25% of physical memory.', more: 'Past it the least recently used idle session is released. Send resumes a released session.' },
  },
  useDefault: 'Use default',
  invalid: 'Enter the memory budget in GB, at least 0.5',
  stateful: 'Stateful MCP servers',
  statefulNotes: { default: { line: 'A session connected to one of these is never released.', more: 'For servers whose state is lost when their process ends. Names match exactly; the field suggests those live sessions report.' } },
  addServer: 'Add a stateful MCP server',
  addPlaceholder: 'server name',
  remove: (name: string) => `Remove ${name}`,
};

// C12 end

// E10 start: the Background supervisor, Settings › Supervisor since U11a M9 (E10 execution document, §Design 11; settings version 10)
const sessions = (n: number) => (n === 0 ? 'no sessions' : `${n} ${n === 1 ? 'session' : 'sessions'}`);
// The idle time as the supervisor holds it: whole minutes from the setting, seconds under the e2e seam
const idleSpan = (ms: number) => (ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`);
export const SUPERVISOR = {
  title: 'Background supervisor', // U11a M9: its group's name; the section's heading stands where it was drawn
  status: 'Status',
  reading: 'Reading…',
  running: (since: string, pid: number, live: number, exit: string) => `Running since ${since} · pid ${pid} · ${sessions(live)} · ${exit}`,
  exitsAfter: (idleExitMs: number) => `exits ${idleSpan(idleExitMs)} after the last session ends`,
  exitsNever: 'never exits on its own',
  exitsWithLast: 'exits when its last session ends', // exit-when-idle armed (an update, or the incompatible wait)
  starting: 'Starting',
  restarting: 'Restarting',
  notRunning: 'Not running',
  heldLock: 'Not running · another supervisor holds its lock and does not answer',
  waiting: (live: number) => `Waiting · the previous version's supervisor still runs ${sessions(live)}; MAWS moves to a new one when they become idle`,
  // what the background process is for, once main has answered; while an older version's is waited for, a state, whole
  statusNotes: {
    reading: {},
    default: { line: 'Sessions run in this background process, so they can keep running after MAWS quits.' },
    waiting: { line: "This version of MAWS cannot use it. Restart now stops those sessions and starts this version's supervisor; Send resumes each from its transcript.", state: true as const },
  },
  restartNow: 'Restart now',
  idle: 'Exit when idle',
  idleField: 'Minutes before the supervisor exits when idle',
  idleNever: 'never', // the empty field's placeholder
  idleUnit: 'min',
  idleNotes: {
    minutes: { line: 'With MAWS closed, the supervisor exits {minutes} min after its last session ends.', more: 'A kept session idle that long is stopped; Send resumes it. Empty means never.' },
    never: { line: 'Never · the supervisor keeps running after its last session ends, even with MAWS closed.' },
  },
  idleInvalid: `Enter whole minutes from 1 to ${MAX_IDLE_MINUTES}, or leave the field empty for never`,
  stopAll: 'Stop all',
  stopAllAction: 'Stop all sessions and the supervisor…',
  stopAllNotes: { default: { line: 'Every session stops; Send resumes each from its transcript.', more: 'A fresh supervisor starts in its place.' } },
  confirm: (live: number) => (live === 0 ? 'No session is running. Stop the supervisor and start a fresh one?' : `Stop ${sessions(live)} and the supervisor?`),
  confirmAction: 'Stop all',
  cancel: 'Cancel',
  stopping: 'Stopping…',
  stopFailed: (why: string) => `The supervisor was not stopped · ${why}`,
  // P5 O2 M7: the machine daemon's line
  daemon: 'Machine daemon',
  daemonLine: (kind: 'unit' | 'private', pid: number, machine: string) => `${kind === 'unit' ? 'At login' : 'This profile only'} · pid ${pid} · machine ${machine}`,
  daemonConnecting: 'Connecting',
};
// E10 end

export const GATEWAY = {
  defaultRoute: 'Default route',
  routes: { machine: 'Machine’s own', gateway: 'ClaudeUsage relay', direct: 'Direct' }, // P5 O7 M9: machine
  // W2: no status line. P5 O7 M9: the machine's own route, every machine's default, says what it means
  defaultRouteNotes: {
    default: { line: 'New sessions start on this route.', more: 'A session can be switched from its Session info.' },
    machine: { line: 'New sessions start on this route.', more: 'A session can be switched from its Session info. Machine’s own: MAWS injects nothing; the machine’s own settings, environment and login decide, as claude in its terminal would.' },
  },
  // P5 O7 M9: a choice an older daemon dropped (main's mirror's words)
  routeDropped: 'This machine’s mawsd predates the machine route; choose gateway or direct until it runs this build.',
  policy: 'Relay unreachable at launch',
  policies: { ask: 'Ask each time', wait: 'Wait for the relay', direct: 'Run direct' },
  policyNotes: { default: {}, direct: { line: 'A session on a gateway model (claude/…) is asked instead: Direct cannot serve it.' } },
  offerDirect: 'Per-session Direct',
  offerDirectLabel: 'Offer "Switch to Direct…" in Session info', // W2: no status line
  offerDirectNotes: { default: { line: "The relay card's Run direct stays either way: Direct is the fallback when the relay is unreachable." } },
  directLogin: 'Direct login',
  directLoginKnown: (login: string, email: string | null) => ["engine's own", login, email].filter(Boolean).join(' · '),
  directLoginUnknown: 'unknown until a Direct session runs',
  directLoginNotes: { default: { line: 'Only Direct sessions use it.', more: "MAWS never stores a token; ClaudeUsage holds the relay's accounts." } }, // the sign-in and its Copy follow the line
  signIn: 'Sign in: run claude /login in a terminal',
  signInCommand: 'claude /login',
  copy: 'Copy',
  copied: 'Copied',
  relay: 'Relay',
  openClaudeUsage: 'Open ClaudeUsage',
};

export const KEYBOARD = {
  hint: '⇧Tab cycles permission mode as in the terminal',
  change: 'Change',
  recording: 'Press keys… esc cancels',
  was: (display: string) => `Was ${display}`,
  unbound: 'Unbound',
  conflict: (title: string) => `Already bound to ${title} · unbind it first`,
  fixedKey: (title: string) => `${title} keeps this key`, // UX wave U4a: a key an editor handles itself, which cannot be unbound
  menuNeedsModifier: 'A menu shortcut needs ⌘, ⌃ or ⌥',
  appNeedsModifier: 'An app-wide shortcut needs ⌘, ⌃ or ⌥',
  reserved: (item: string) => `Reserved by macOS · ${item}`,
  reset: 'Reset to defaults',
  resetTitle: 'Reset every key binding?',
  resetBody: 'Every shortcut you changed or unbound returns to its default.',
  resetConfirm: 'Reset',
  cancel: 'Cancel',
  table: 'Key bindings',
};

// E9 start: Settings › Voice (E9 execution document, Design §9; M4): the hold that dictates, the recognition language
// (settings version 9), and what main's probe reports. Recognition is on-device only, so a language without a model on
// this Mac is refused when dictation starts and said so here.
export const VOICE = {
  shortcut: 'Shortcut',
  changeInKeyboard: 'Change in Keyboard',
  // the default, unbound: the toolbar's microphone is the primary control (the owner's ruling of 2026-10-06)
  shortcutNotes: {
    bound: { line: 'Hold the shortcut to dictate into the focused composer.', more: "Or click the microphone in the composer's toolbar to start, and again to stop." },
    unbound: { line: "Click the microphone in the composer's toolbar to start dictating, and again to stop.", more: 'A shortcut, once bound, dictates into the focused composer while you hold it.' },
  },
  language: 'Language',
  system: (locale: string | null) => (locale === null ? 'System' : `System (${locale})`),
  noOnDeviceMark: 'no on-device model',
  languageNotes: { default: { line: "Recognised on this Mac by Apple's speech recognition.", more: 'MAWS stores no audio and no transcript.' } },
  helper: 'Helper',
  helperFound: 'Found at',
  helperMissing: 'Not found at',
  helperNotes: { default: {}, build: { line: 'run pnpm build:helper', state: true as const } }, // a development build without the helper
  helperFailed: (message: string) => `Did not start · ${message}`,
  scripted: 'scripted recognizer (test harness)',
  reading: 'Reading…',
  microphone: 'Microphone',
  speech: 'Speech recognition',
  permission: {
    authorized: 'Allowed',
    notDetermined: 'Not asked yet · macOS asks the first time you dictate',
    denied: 'Off for MAWS',
    restricted: 'Off for MAWS and cannot be turned on here',
  },
  permissionUnknown: 'Unknown until the helper answers',
  openSystemSettings: 'Open System Settings',
  // the pane as System Settings names it, for the toast when the button could not open it
  paneByHand: { microphone: 'Microphone', speech: 'Speech Recognition' },
  openFailed: (why: string, pane: string) => `Could not open System Settings: ${why}. Open System Settings › Privacy & Security › ${pane} by hand.`,
  recognition: 'Recognition',
  onDevice: 'On this Mac',
  noOnDevice: 'No on-device model · download it in System Settings › Keyboard › Dictation',
};
// E9 end

export const APPEARANCE = {
  theme: 'Theme',
  themes: { light: 'Light', dark: 'Dark', system: 'System' },
  themeHint: 'native chrome follows',
  monoFont: 'Monospace font',
  monoFontPlaceholder: 'the default stack (SF Mono)',
  monoFontNotes: { default: { line: 'Name a Nerd Font to draw prompt glyphs in the terminal' } },
  // W2: Claude Desktop's setting, in its words
  transcriptWidth: 'Transcript width',
  transcriptWidths: { 768: 'Narrow', 960: 'Medium', 1280: 'Wide' },
  transcriptWidthNotes: { default: { line: 'Maximum width of the transcript and composer columns' } },
  // U+E0A0 (branch) and U+E0B0 (right arrow): the powerline glyphs a prompt draws
  preview: 'main  ~/project  $',
};

export const NOTIFICATIONS = {
  when: 'When a session finishes or needs you',
  enabledLabel: 'Notify when I am not looking at that session',
  delivery: { os: 'macOS: allowed', fallback: 'macOS: not delivered · MAWS falls back to a dock bounce and a toast' },
  kinds: 'For',
  kind: {
    turnFinished: 'Turn finished',
    approvals: 'approvals',
    questions: 'questions',
    planReviews: 'plan reviews',
    errors: 'errors',
    heldPeerMessages: 'held peer messages',
    // P2-C start (2026-10-09): settings 12's two owner-channel groups (the P2-C document, §9); M6 lists them
    asyncInput: 'questions an agent left for you',
    essential: 'must-read messages',
    // P2-C end
  },
  // P2-C start (2026-10-10): the to-human mod's app switch (BUILT_IN_MODS' name)
  toHuman: {
    label: 'Messages to you',
    name: 'To-human',
    notes: { default: { line: 'Agents message you and ask questions you answer in place; a session reads as their report.', more: 'The view follows at once; the instructions, the next time each session starts.' } },
  },
  // P2-C end
  approvalsCaption: 'permission requests, dialogs and MCP elicitations',
  heldNever: 'Never notifies in this version',
  sound: 'Sound',
  on: 'on',
  off: 'off',
};

// E4a start: Settings › Browser (E4a execution document, Design §9 and §16; settings version 11): which profile new tabs
// browse with, the address field's search, and where a page's new-window links open.
export const BROWSER = {
  profile: 'Profile',
  defaultProfile: 'Default',
  missingProfile: (profileDir: string) => `${profileDir} · not found`,
  profileNotes: { default: { line: 'Applies to tabs opened from now on. The address bar shows which profile a tab browses with.' } },
  search: 'Search engine',
  searchNotes: { default: { line: 'Use %s for the search text' } },
  searchInvalid: 'Enter an http or https address with %s where the search text goes',
  useDefault: 'Use default',
  links: 'Links that open a new window',
  linkTargets: { 'in-app': 'In MAWS', external: 'In the system browser' },
  linksNotes: { inApp: { line: 'In MAWS, such a link opens as a new tab of the same session.' }, external: {} },
  // cua #90: settings 12's switch
  bookmarksBar: 'Bookmarks bar',
  bookmarksBarLabel: 'Show the bookmarks bar',
  bookmarksBarNotes: { default: { line: 'An imported profile’s Chrome bookmarks, under the address bar. ⌘⇧B in the browser.' } },
  // E4b start: the imported Chrome profiles (E4b execution document, Design §11; Decision Log 35)
  chromeProfile: 'Chrome profile',
  import: 'Import a Chrome profile…',
  chromeProfileNotes: { default: { line: 'A one-time copy of its history, cookies and extensions. Chrome is never changed.' }, running: {} },
  // U11a M9: the rows made at run time, one per imported profile and one per extension of each; drawn by their own names
  importedProfile: 'Imported Chrome profile',
  importedProfileNotes: { default: { line: '{summary}', state: true as const } }, // the import's summary
  importing: (step: string) => `Import running · ${step}`,
  show: 'Show',
  lastImport: (outcome: 'cancelled' | 'failed') => (outcome === 'cancelled' ? 'The last import was cancelled' : 'The last import failed'),
  importedOn: (date: string) => `Imported ${date}`,
  showReport: 'Show report',
  remove: 'Remove imported profile',
  extensions: 'Extensions',
  extensionNotes: { default: {}, wallet: { line: 'Wallet extensions start off' } },
  // cua #90: what an extension's popup cannot do in MAWS's browser (its spec's S1: `chrome.tabs.query` never answers the page)
  popupLimit: 'Extension popups can’t see the current tab here, so ad blockers and per-site toggles may not work.',
  toggles: [
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ] as const,
  // E4b end
};
// E4a end

// P3-D start (2026-10-13): Settings › Artifacts (settings version 14; docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md
// D9): the design-system defaults
export const ARTIFACTS = {
  exportAuthorName: 'Export author name',
  exportAuthorNotes: { default: { line: 'Name on your DOCX comments; blank uses “{name}”.', more: 'Agent comments keep their session name.' } },
  suggestedAuthor: (name: string) => `Use ${name}`,
  defaultSystem: 'Default design system',
  house: 'House system',
  defaultSystemNotes: {
    default: { line: 'Used by documents, decks and designs that name no system of their own.', more: 'A Space’s default comes first. The house system is MAWS.' },
    readFailed: { line: 'Could not read the design systems · {why}', state: true as const },
  },
  missing: 'A deleted system · the house system applies', // the owner's default: the chain's next link is the house
  missingSpace: 'A deleted system · the next default applies', // a Space's: yours first, then the house
  bySpace: 'By Space',
  bySpaceNotes: { spaces: { line: 'A Space’s default comes before yours.' }, none: { line: 'No Spaces yet. A Space can have its own default design system.' } },
  useMine: 'Use my default',
  spaceSystem: (space: string) => `Design system for ${space}`,
  reading: 'Reading design systems…',
} as const;
// P3-D end

// P5 O8 M1 start: Settings › Org (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The Org section"), the
// least a sign-in to the org needs. No words here carry a pairing code: the field's text goes out and is never shown back.
// M4a grows it into the Org page (settings-tab/org/): Q1's four groups, the change sheet and the pairing sheet. The code
// a pairing makes is shown by the pairing sheet alone, and no words here carry it either.
export const ORG = {
  reading: 'Reading the org…',
  readFailed: (why: string) => `Could not read the org · ${why}`,
  failed: (why: string) => `The org did not answer · ${why}`,
  org: 'Org',
  notSignedIn: 'This Mac isn’t signed in to an org.',
  code: 'Pairing code',
  codeNote: 'Get one from a device already in the org: an admin pairs it from their Org page (Pair a device), or deployment admin pair --class native-mac.',
  signIn: 'Sign in',
  signInAgain: 'Sign in again',
  signOut: 'Sign out',
  cancel: 'Cancel',
  signingIn: 'Signing in',
  steps: { browser: 'Finish signing in in the browser.', checking: 'Checking the org…', approval: 'Waiting for approval.' },
  approvalUntil: (time: string) => `Waiting for approval until ${time}.`,
  fingerprint: 'Fingerprint',
  fingerprintNote: 'Compare it with the approving device, then approve there.',
  account: 'Account',
  device: 'This Mac',
  hub: 'Hub',
  hubAccess: {
    connected: 'Connected',
    connecting: 'Connecting…',
    expired: 'Sign-in expired',
    denied: 'The hub no longer admits this account',
    unreachable: 'Can’t reach the hub',
    'signing-in': 'Signing in…',
  },
  state: 'Org state',
  version: (version: number, days: number) => `Version ${version} · ${days === 1 ? '1 day' : `${days} days`} old`,
  unverified: 'Not verified yet',
  stateNote: (backstop: number) => `Machines stop taking requests once the org state is ${backstop} days old.`,
  problem: 'Problem',
  problems: {
    'held-chain': 'The org state this Mac holds didn’t verify, so the org stays closed here until you re-anchor.',
    rollback: 'The hub served an older org state than this Mac holds. It was refused.',
    fork: 'The hub served an org state that conflicts with the one this Mac holds. It was refused.',
    directory: 'MAWS’s org folder isn’t private to you, so it wasn’t used.',
    signing: 'This Mac’s record of the org states it signed is missing or damaged, so it signs nothing until you reset it. A state it sent before the damage could still surface as a fork.',
  },
  reanchor: 'Re-anchor',
  reanchorNote: 'Re-anchoring replaces the org state this Mac trusted with the one the code’s device vouches for.',
  removed: 'This Mac is no longer in the org.',
  signedOut: 'Signed out',
  development: 'Development',
  developmentNote: 'This session comes from MAWS_DEV_ORG.',
  refusals: {
    'bad-code': 'That pairing code isn’t valid.',
    'other-org': 'That code is for a different org from the one this Mac is in.',
    access: 'The browser sign-in didn’t finish.',
    'not-member': (email: string | undefined) => (email ? `${email} isn’t a member of this org.` : 'That account isn’t a member of this org.'),
    keys: 'This Mac’s device keys couldn’t be used.',
    chain: 'The org state from the hub didn’t verify.',
    removed: 'This Mac has been removed from the org.',
    expired: 'The approval wasn’t given in time. Start again with a new code.',
    hub: 'Couldn’t reach the hub.',
    busy: 'Another sign-in is running.',
    directory: 'MAWS’s org folder isn’t private to you, so nothing could be saved there.',
  },
  // M3: this Mac as the org's signer
  signer: 'Signer',
  signs: 'This Mac signs the org state.',
  weekly: (days: number) => `Org state is ${days} days old`,
  resign: 'Re-sign now',
  makeRoot: 'Make this Mac a root: run',
  // The id after `--`: a base64url key id may start with '-', which the admin's option parser would read as an option.
  rootCommand: (device: string) => `deployment admin root add -- ${device}`,
  rootNote: (fingerprint: string) => `Its confirmation names this Mac’s fingerprint, ${fingerprint}. Compare the two before you confirm.`,
  unmarked: 'This Mac’s keys weren’t kept out of Time Machine backups when they were made, so it signs nothing. Make new keys with a pairing code.',
  signed: (version: number) => `Signed version ${version}.`,
  notSigned: 'Not signed',
  // M4c: a drop answered stale: the hub tells apps of states, not certificates, so a machine the delegation certified
  // since the preview is the likely change (the architect, R8)
  dropStale: 'This delegation may have certified a machine since you opened it: preview the drop again.',
  signReasons: {
    'not-root': 'This Mac isn’t a root of the org.',
    unmarked: 'This Mac’s keys can’t sign: make new keys first.',
    signing: 'The record of signed states is damaged.',
    cancelled: 'Touch ID was cancelled.',
    pending: 'A state this Mac signed is still pending.',
    invalid: 'The signed state didn’t verify.',
    hub: 'The hub didn’t take it.',
    busy: 'Another signing is running.',
    refused: 'The checks refused it.',
    stale: 'What would be signed changed since it was shown.',
    // M4c, a delegation's create
    'secret-store': 'Its provisioning code has nowhere to go yet: fix what’s named, then try again.',
    unsent: 'Signed, but its provisioning code isn’t stored: Write the code again from its row.',
  },
  pending: 'Pending',
  pendingWaits: (version: number) => `Version ${version} is signed and waits for the hub.`,
  pendingRefused: (version: number, why: string) => `The hub refused version ${version} · ${why}`,
  pendingFork: (version: number) => `Version ${version} conflicts with another version ${version} at the hub: a fork.`,
  discard: 'Discard…',
  discardTitle: (version: number) => `Discard version ${version}?`,
  discardConfirm: 'Discard',
  // abandon-pending's distinctions (apps/desk-hub/deploy/admin.ts): never sent, or exposed with the fork warning
  discardUnsent: (version: number) => `Version ${version} was never sent: nothing was posted, so nothing can show it as a fork.`,
  discardAtHub: (version: number, fork: boolean) => (fork ? `The hub holds another version ${version}: a fork.` : `Version ${version} isn’t at the hub.`),
  discardWarning: (version: number) =>
    `A later sign may make another successor of version ${version - 1}, which a hub or machine that kept these bytes could show as a fork: discard it only once you know why the hub refused it.`,
  discarded: (version: number, unsent: boolean, hubVersion: number, forkAt: number | undefined) =>
    unsent
      ? `Discarded version ${version}. It was never sent.`
      : forkAt !== undefined
        ? `Discarded version ${version}. The hub holds another version ${forkAt} (a fork); its head is version ${hubVersion}.`
        : `Discarded version ${version}. The hub’s head is version ${hubVersion}.`,
  notDiscarded: 'Not discarded',
  discardReasons: {
    held: (version: number) => `The hub holds version ${version} now: it settled.`,
    hub: () => 'Couldn’t read the hub.',
    none: () => 'Nothing is pending.',
    signing: () => 'The record of signed states is damaged.',
    stale: () => 'The pending state changed since you confirmed: nothing was discarded.',
  },
  reset: 'Reset…',
  resetTitle: 'Reset the signing record?',
  resetBody: 'MAWS starts an empty record and can sign again. A state this Mac sent before the damage could still surface as a fork if the hub or a machine kept it.',
  resetConfirm: 'Reset',
  revocations: 'Revocations',
  offer: (keys: number) => `A recovery dropped the revocation of ${keys === 1 ? '1 key' : `${keys} keys`}.`,
  revoke: 'Revoke again…',
  // The sheet Revoke again opens: Touch ID shows one line, so everything the signature carries is read here first.
  revokeTitle: 'Sign these revocations?',
  revokeIntro: 'One new org state carries all of this, signed with Touch ID:',
  revokeWarning: (text: string) => `Warning: ${text}`,
  revokeConfirm: 'Sign',
  withheld: (name: string) => `Not offered: ${name}. Revoking it would remove this Mac’s own keys or the org’s last root, so settle it another way.`,
  deliveries: 'Deliveries',
  owing: (version: number, waiting: string | null, tooLarge: string | null) =>
    [`Version ${version}`, waiting === null ? null : `waiting for ${waiting} to acknowledge`, tooLarge === null ? null : `too large to send to ${tooLarge}, which catches up from the hub`]
      .filter((part) => part !== null)
      .join(' · '),
  discardedRow: 'Discarded',
  abandoned: (version: number, holders: string) => `Version ${version} · ${holders} may still hold it`,
  theHub: 'the hub',
  oldDevice: 'Old device',
  oldDeviceLine: 'Still listed in the org state. A root removes it.',
  removeOld: 'Remove…',
  newKeys: 'New keys',
  makeNewKeys: 'Make new keys',
  rekeySteps: { browser: 'Finish signing in in the browser.', checking: 'Checking the org…', approval: 'Waiting for approval.', promoting: 'Switching to the new keys…' },
  rekeyNote: 'Get a code from a device already in the org (an admin pairs it from their Org page, or deployment admin pair --class native-mac). This Mac stays signed in on its old keys until the new ones are approved.',
  rejoinNote: 'To rejoin, make new keys with a pairing code from a device already in the org (an admin pairs it from their Org page, or deployment admin pair --class native-mac).',
  // M4a: the Org page's groups (Q1)
  groups: { you: 'You', people: 'People', machines: 'Machines', org: 'Org' },
  thisMacFingerprint: 'fingerprint',
  otherDevices: 'Your other devices',
  none: 'None',
  refused: 'Refused',
  classes: { 'native-mac': 'Mac', 'web-cards': 'browser' },
  roles: { admin: 'admin', member: 'member' },
  rootMark: 'root',
  thisMacMark: 'this Mac',
  youMark: 'you',
  noDevices: 'No devices yet.',
  readOnly: 'Only a root signs org changes.',
  rootsAre: (emails: string) => `The roots are ${emails}.`,
  noRootListed: 'No root is listed.',
  addPerson: 'Add person…',
  removePerson: 'Remove person…',
  makeAdmin: 'Make admin…',
  makeMember: 'Make member…',
  changeEmail: 'Change email…',
  removeDevice: 'Remove device…',
  makeDeviceRoot: 'Make a root…',
  pairDevice: 'Pair a device…',
  // The rule the page states in place of Pair a device (M4a's "The rule the page states"): a later device of a member who
  // doesn't sign waits for the countersign flow; one who signs pairs it from their own app.
  laterDevice: 'Their next device is paired from one of their own devices, a flow not built yet.',
  laterDeviceRoot: 'They pair their next device from their own Org page.',
  pairingUntil: (time: string) => `Pairing a device until ${time}`,
  pairingShow: 'Show…',
  machineState: { up: 'Up', connecting: 'Connecting…', down: 'Offline', unknown: 'Not connected' },
  ownedBy: (names: string) => `Owned by ${names}`,
  ownedByOrg: 'Owned by the org',
  formerMember: 'a former member',
  noMachines: 'No machines are enrolled yet.',
  // M4b: the Machines group's actions. Enroll, Re-enroll, Owners and Drop sign the org state (a root's, `maySign`);
  // Grant… signs a grant, which a machine's owner may (an admin for an org-owned one), root or not.
  machineKey: (kid: string) => `key ${kid}`,
  certifiedOwners: (delegation: string) => `Certified through delegation ${delegation}: its owners are the delegation’s, and change with it.`,
  ownersAction: 'Owners…',
  reenroll: 'Re-enroll…',
  drop: 'Drop…',
  grant: 'Grant…',
  enroll: 'Enroll a machine',
  enrollAction: 'Enroll a machine…',
  enrollCantSign: 'This Mac can’t sign: enroll from an admin’s Mac that does.',
  enrollAdmins: 'An admin enrolls machines from their Org page.',
  enrollingUntil: (name: string, time: string) => `Enrolling ${name} until ${time}`,
  reenrollingUntil: (time: string) => `Re-enrolling until ${time}`,
  enrollShow: 'Show…',
  hubRowLeft: (name: string) => `Signed. The hub still lists ${name}:`,
  retry: 'Retry',
  notRetried: 'Not deleted',
  retryReasons: { none: 'No drop of this name waits for its hub row.', hub: 'Couldn’t reach the hub.', refused: 'The hub refused the delete.' },
  // A machine's rights (RL §5.5): each member's grant as the machine's own ledger holds it, or as this Mac issued it
  rightLines: {
    spawn: 'Start sessions on it.',
    shell: 'Open a terminal and forward ports on it, outside any session.',
    'machine-admin': 'Connect, sign in and disconnect its connectors, and choose the connector tools its dashboards may use.',
  },
  onlyOwners: 'Only its owners have rights on it, and they hold every one.',
  noRightsYou: 'You hold no rights on it.',
  withdrawn: 'every right withdrawn',
  notYetOn: (machine: string) => `Not yet on ${machine}`,
  notNewer: 'Another device changed this grant: sign again',
  // A machine's refusal of a grant, its plain line from `grantVerdicts` when the code is a known one; the code is shown beside it
  grantRefusedBy: (machine: string, line: string | undefined) => (line === undefined ? `${machine} refused it: sign again` : `${machine} refused it: ${line}. Sign again`),
  // The machine's verdicts on a grant it was sent (mawsd's grant check), each in words
  grantVerdicts: {
    'not-held': 'it no longer holds the key this grant names',
    'other-machine': 'the grant names another machine',
    malformed: 'it read the grant as malformed',
    'bad-signature': 'the grant’s signature didn’t verify',
    revoked: 'the key that signed it is revoked',
    'not-listed': 'its org state doesn’t list the person, the machine or its key as the grant names them',
    'unknown-signer': 'its org state doesn’t take this Mac’s key as an owner’s',
    contested: 'its certificates disagree on its key',
  } as Record<string, string | undefined>,
  signAgain: 'Sign again…',
  rightsAsOf: (machine: string, when: string) => `${machine} didn’t answer: as of its last answer, ${when}`,
  rightsUnanswered: (machine: string) => `${machine} hasn’t answered yet: as this Mac issued them`,
  missingGrants: (count: number, machine: string) => `${count === 1 ? '1 grant this Mac issued is' : `${count} grants this Mac issued are`} missing on ${machine}`,
  regrant: 'Re-grant…',
  grantsDamaged: 'Grants can’t be signed on this Mac: its record of the grants it issued is damaged. Sign them from another device of the machine’s owner.',
  // A read of a machine's grants that main refused (`why`, its refusal's line) or that failed: nothing to sign against
  grantsUnread: (machine: string, why?: string) => [`${machine}’s grants can’t be read now.`, why].filter((part) => part !== undefined).join(' '),
  roots: 'Roots',
  rootHolder: (email: string, device: string, cls: string) => `${email} · device ${device} (${cls})`,
  unlistedRoot: 'no listed device',
  recovery: 'Recovery key',
  // The change sheet: what one change would sign, shown before Touch ID
  changeTitles: {
    'member.add': 'Add a person',
    'member.remove': (email: string) => `Remove ${email}?`,
    'member.role': (email: string, role: 'admin' | 'member') => `Make ${email} ${role === 'admin' ? 'an admin' : 'a member'}?`,
    'member.email': (email: string) => `Change ${email}’s email`,
    'device.remove': (email: string) => `Remove a device of ${email}?`,
    'root.add': (email: string) => `Make a device of ${email} a root?`,
    'machine.owners': (name: string) => `Change ${name}’s owners`,
    'machine.drop': (name: string) => `Drop ${name}?`,
    'delegation.renew': (prefix: string) => `Renew delegation ${prefix}`,
    'delegation.drop': (prefix: string) => `Drop delegation ${prefix}?`,
  },
  email: 'Email',
  newEmail: 'New email',
  role: 'Role',
  review: 'Review…',
  edit: 'Edit',
  composing: 'Composing the change…',
  changeIntro: 'One new org state carries this, signed with Touch ID:',
  changeWarning: (text: string) => `Warning: ${text}`,
  changeConfirm: 'Sign',
  previewRefused: {
    refused: 'The checks refuse this change. Nothing was signed:',
    stale: 'The org state changed while this was composed. Close and try again.',
    'not-root': 'This Mac isn’t a root of the org, so it signs no changes.',
    unmarked: 'This Mac’s keys can’t sign: make new keys first.',
    signing: 'The record of signed states is damaged.',
    invalid: 'The change couldn’t be composed.',
  },
  // The pairing sheet: the code once, then the device's fingerprint to compare, then the approval
  pairTitle: (email: string, you: boolean) => (you ? 'Pair a device of yours' : `Pair ${email}’s first device`),
  pairKind: 'Device',
  pairKinds: { 'native-mac': 'A Mac with MAWS', 'web-cards': 'A browser with a passkey' },
  pairYoursNote: 'This Mac endorses the new device in the same Touch ID that signs it.',
  pairFirstNote: 'Their first device joins without an endorsement, as the org allows for a member’s first device.',
  makeCode: 'Make a code',
  pairCodeNote: (time: string) => `Shown once, here only. Enter it on the new device before ${time}.`,
  copy: 'Copy',
  copied: 'Copied',
  pairWaiting: 'Waiting for the device to answer…',
  pairCodeGone: 'The code was shown once, when it was made. For a new one, cancel and pair again.',
  pairEntry: (device: string, cls: string, storage: string) => `Device ${device} · ${cls} · ${storage} keys`,
  pairCompare: 'Compare it with the new device’s screen. Approve only if the two match.',
  approve: 'Approve…',
  // Beside the approval (M4a's "Once the slot is written the proposal is durable"): what a cancel no longer withdraws.
  pairDurable: 'Once Touch ID is given and the signed state is kept, cancelling no longer withdraws it: it settles like any pending state, and Discard (Org › Pending) is the way back.',
  approved: (version: number) => `Paired. Signed version ${version}.`,
  pairProblems: {
    'two-entries': 'Two devices answered this code. Start over.',
    'entry-changed': 'The device’s entry changed after it was shown. Start over.',
    expired: 'The code expired. Start over.',
    'not-admin': 'The hub doesn’t take this Mac’s account as an admin.',
    'no-member': 'The hub lists no such member.',
  },
  pairGone: 'This pairing is no longer running.',
  startOver: 'Start over',
  pairRefusals: {
    'not-root': 'Only a root signs org changes.',
    'later-device': 'Their next device is paired from one of their own devices, a flow not built yet.',
    'no-member': 'The org state lists no such member.',
    busy: 'Another org attempt is running.',
    hub: 'This Mac isn’t connected to the hub. Sign in again to pair.',
  },
  // An approval's end: a pairing that ended while Touch ID was open reads apart from one that ended before it.
  pairEndedDuring: 'The pairing ended while Touch ID was open. Nothing was signed.',
  pairEndedBefore: 'The pairing ended, or its device changed, before Touch ID. Nothing was signed.',
  notApproved: 'Not approved',
  cancelPairing: 'Cancel pairing',
  close: 'Close',
  done: 'Done',
  // M4b: the change sheet's machine fields
  owners: 'Owners',
  ownersKinds: { org: 'The org (its admins)', people: 'People' },
  revokeKey: 'Its key may be compromised',
  revokeKeyNote: 'Its key is revoked rather than retired.',
  goToMachine: (name: string) => `Go to ${name}`,
  // M4b: the enrollment sheet: a name, the code once, then the machine's name, ref and key id to compare, then the approval
  enrollTitle: 'Enroll a machine',
  reenrollTitle: (name: string) => `Re-enroll ${name}`,
  machineName: 'Name',
  enrollNameNote: 'The name the org lists it by, bound to it for the life of the org.',
  reenrollNote: (name: string) => `${name} keeps its ref and its owners. The key it posts replaces its old one, which is retired.`,
  enrollRun: 'On the machine, run',
  enrollCommand: 'mawsd enroll',
  enrollPaste: 'and paste the code at its prompt, which hides it. Never pass the code as an argument. Add --replace while the machine is still enrolled.',
  enrollCodeNote: 'Shown once, here only.',
  enrollExpires: (time: string) => `The code works until ${time}.`,
  enrollWaiting: (name: string) => `Waiting for ${name} to post its key…`,
  enrollCodeGone: 'The code was shown once, when it was made. For a new one, cancel and enroll again.',
  enrollFields: { name: 'Name', ref: 'Ref', keyId: 'Key id' },
  enrollCompare: 'Compare these with mawsd keys --json on the machine. Approve only if all three match.',
  enrollApproved: (name: string, version: number) => `Enrolled ${name}. Signed version ${version}.`,
  enrollProblems: {
    expired: 'The enrollment expired before it was approved. Start over.',
    'not-yours': 'Another admin started this enrollment, and the hub answers only to them. Ask them to finish it, or Start over to enroll the machine yourself.',
    'unknown-enrollment': 'The hub no longer knows this enrollment. Start over.',
    'key-changed': 'Another key was posted after the one shown. Start over.',
    'machine-names': 'That name is bound to another machine for the life of the org. Start over with a different name.',
  },
  enrollSignedOut: 'The sign-in ended, so the enrollment stopped. Nothing was signed.',
  enrollGone: 'This enrollment is no longer running.',
  enrollSignInEnded: 'The sign-in this sheet opened under ended. Close it to enroll again.',
  enrollRefusals: {
    'not-root': 'This Mac can’t sign: enroll from an admin’s Mac that does.',
    'not-admin': 'Only an admin enrolls a machine.',
    busy: 'Another enrollment, pairing or sign-in is running.',
    hub: 'This Mac isn’t connected to the hub. Sign in again to enroll.',
    shape: 'A machine name is up to 63 letters, digits, dots, hyphens or underscores, starts with a letter or digit, and is not "hub" or "legacy".',
    'machine-name-taken': 'A machine of that name is listed: re-enroll it from its row.',
    'prefix-names-machine': 'That name starts with a delegation’s prefix, which is kept for the machines that delegation certifies. Choose a name outside it.',
    'certified-machine': 'A certified machine is enrolled again through its delegation.',
    'no-machine': 'The org no longer lists this machine. Close this sheet and enroll it as a new machine.',
    refused: 'The hub refused the enrollment. Try again; if it is refused again, sign in to the hub again under Org.',
    cancelled: 'The enrollment was cancelled before its code was shown.',
  },
  enrollEndedDuring: 'The enrollment ended while Touch ID was open. Nothing was signed.',
  enrollEndedBefore: 'The enrollment ended, or its key changed, before Touch ID. Nothing was signed.',
  notEnrolled: 'Not enrolled',
  cancelEnrollment: 'Cancel enrollment',
  // M4b: the grant sheet: a person, then the rights, one signed grant behind one Touch ID
  grantTitle: (machine: string) => `Rights on ${machine}`,
  grantPerson: 'Person',
  grantChoose: 'Choose a person',
  grantReading: (machine: string) => `Reading ${machine}’s grants…`,
  grantNoLonger: 'The person chosen is no longer offered here. Choose a person again.',
  grantRights: 'Rights',
  grantIntro: 'One signed grant at its next version, delivered to the machine. Touch ID shows it first.',
  grantNobody: 'Everyone in the org owns this machine, and owners hold every right.',
  grantWithdrawLine: (email: string, machine: string) => `With no rights, this withdraws every right ${email} holds on ${machine}.`,
  grantCantSign: (machine: string) => `This Mac can’t sign grants on ${machine} now.`,
  grantSave: 'Save…',
  grantWithdraw: 'Withdraw…',
  grantSaving: (machine: string) => `Bringing ${machine} up to date, then Touch ID shows the grant…`,
  saving: 'Saving…',
  granted: (version: number, machine: string) => `Signed grant version ${version}. ${machine} holds it.`,
  grantedPending: (version: number, machine: string) => `Signed grant version ${version}. Not yet on ${machine}: this Mac keeps sending it until ${machine} answers.`,
  grantedRefused: (version: number, machine: string, line: string | undefined) => `Signed grant version ${version}. ${line === undefined ? `${machine} refused it` : `${machine} refused it: ${line}`}. Sign again.`,
  // A grant left `sending` across a restart (main's `outcome-unknown`): no verdict of the machine's
  grantOutcomeUnknown: (machine: string) => `This Mac stopped before ${machine}’s answer came: sign again`,
  grantedOutcomeUnknown: (version: number, machine: string) => `Signed grant version ${version}. This Mac stopped before ${machine}’s answer came: sign again.`,
  grantedNotNewer: (version: number) => `Signed grant version ${version}. Another device changed this grant: sign again.`,
  grantRefusals: {
    'signed-out': 'This Mac isn’t signed in to the org. Sign in under Org, then try again.',
    damaged: 'This Mac’s record of the grants it issued is damaged and can’t be repaired here, so it signs no grant. Sign from another device of the machine’s owner (an admin’s, for a machine the org owns).',
    // U11a board 540: also refused after the machine answered, when its outcome couldn't be recorded: so it says nothing of a send
    storage: 'The grant couldn’t be saved on this Mac. Try again; if it keeps failing, check the disk’s free space.',
    busy: 'Another grant is being signed. Try again once it’s done.',
    invalid: 'The rights were sent wrongly (one was named twice). Close this sheet and choose them again.',
    'no-change': 'They hold these rights already.',
    ineligible: 'This Mac can’t sign this grant. Sign it from another device of the machine’s owner, or resolve:',
    'ledger-unread': 'The machine’s grants for this person couldn’t be read, so nothing was signed. Try again in a moment.',
    cancelled: 'Touch ID was cancelled.',
    refused: 'The signed grant didn’t verify against the org state held now. Nothing was kept or sent: sign again.',
    stale: 'What this would sign changed meanwhile. Nothing was kept or sent: sign again.',
    none: 'Nothing is missing on the machine now.',
  },
  // grantProblems' codes (apps/org-protocol/src/records.ts), each in words
  grantProblems: {
    malformed: 'the grant is malformed',
    'unknown-rights': 'a right isn’t one the org knows',
    'other-org': 'the machine is another org’s',
    'member-not-listed': 'the org state doesn’t list the person',
    'machine-contested': 'the machine’s certificates disagree on its key',
    'machine-not-listed': 'the org state doesn’t list the machine',
    'machine-key-not-current': 'the machine’s key isn’t its current one',
    'signer-not-owner': 'this Mac’s key isn’t an owner’s (an admin’s, for a machine the org owns)',
    'signer-revoked': 'this Mac’s key is revoked',
  },
  regrantTitle: (machine: string) => `Re-grant on ${machine}?`,
  regrantIntro: (machine: string) => `Each is signed again for ${machine}’s current key, under one Touch ID, and delivered:`,
  regrantConfirm: 'Re-grant',
  regranted: (count: number, machine: string) => `Signed ${count === 1 ? '1 grant' : `${count} grants`} again for ${machine}.`,
  // M4c: the Delegations section (a section of the Org group): each delegation, the hub's side of it, the stray hub keys,
  // a new delegation and where its code goes. Every refusal or failure line names its next step.
  delegations: 'Delegations',
  noDelegations: 'No delegations yet.',
  delegationId: (id: string) => `id ${id.slice(0, 8)}`,
  delegationStates: { unsent: 'unsent', dropped: 'dropped' },
  // "expires in 23 days", from the milliseconds left
  expiresIn: (ms: number) => {
    if (ms <= 0) return 'expired';
    const days = Math.floor(ms / 86_400_000);
    return days === 0 ? 'expires within a day' : `expires in ${days === 1 ? '1 day' : `${days} days`}`;
  },
  // the hub key's uses (null: the hub's side not read), against the delegation's cap (null: none)
  uses: (uses: number | null, cap: number | null) =>
    uses === null ? (cap === null ? 'no use cap' : `at most ${cap} uses`) : cap === null ? `used ${uses === 1 ? '1 time' : `${uses} times`}, no cap` : `used ${uses} of ${cap}`,
  certified: (machines: string) => `Certified: ${machines}`,
  noCertified: 'No certified machines yet',
  certifiedState: (name: string, live: boolean) => `${name} (${live ? 'live' : 'retired'})`,
  renew: 'Renew…',
  // A hub half the head says is left: the spec's words, then Retry, which calls the hub's route alone
  hubBehindRenew: (date: string) => `Renewed in the org state; the hub’s key still expires ${date}:`,
  hubNoRoute: 'Renewed in the org state; this hub can’t renew its key yet:',
  hubBehindRevoke: 'Dropped in the org state; the hub still lists its key as live:',
  hubExpires: (date: string) => `The hub’s key expires ${date}.`,
  hubUnread: 'Its hub key isn’t read yet.',
  hubNoKey: 'The hub lists no key for it, so it provisions nothing there: drop it and create a new delegation.',
  hubKeyRevoked: 'The hub’s key for it is revoked, so it provisions nothing: drop it and create a new delegation.',
  hubKeyExpired: (date: string) => `The hub’s key for it expired ${date} and is never revived: drop it and create a new delegation.`,
  // Why a hub half didn't finish (main's HUB_HALF_REASONS), each with its next step
  hubHalfReasons: {
    'no-route': 'This hub can’t renew its key yet: Retry once the hub is updated.',
    updating: 'The hub is updating: Retry in a moment.',
    ended: 'The hub’s key has ended and is never revived: drop this delegation and create a new one.',
    'not-renewed': 'The hub’s org state doesn’t hold the renewal yet: Retry in a moment.',
    'too-long': 'The hub refuses that expiry for now: Retry later.',
    hub: 'The hub wasn’t reached: Retry once it is.',
    refused: 'The hub refused it: Retry, and if it refuses again, see its answer:',
  },
  hubHalfNone: 'Nothing is left to do at the hub.',
  hubKeys: 'Hub keys',
  // A failed read of the hub's key list, with Retry beside it (a read now, `org.delegation.readKeys`)
  hubKeysFailed: (at: string | null) =>
    at === null
      ? 'The hub’s key list couldn’t be read, so each delegation’s hub key is unknown, not missing. Retry reads it again.'
      : `The hub’s key list couldn’t be read: each delegation’s hub key shows as of ${at}. Retry reads it again.`,
  hubKeysStillFailed: 'It still couldn’t be read: Retry once the hub answers.',
  // An unsent delegation: signed into the pending slot, its code not stored, so not published
  unsentLine: 'Signed, not published: its provisioning code isn’t stored yet.',
  writeAgain: 'Write the code again',
  writing: 'Writing the code…',
  writingTo: (where: string | null) => (where === null ? 'Writing the code…' : `Writing the code to ${where}…`),
  unsentDiscardOnly: 'This Mac no longer holds its key pair, so it can’t be published: discard it and create the delegation again.',
  stillUnsent: 'The code still isn’t stored: Write the code again, or discard it.',
  codeStored: (prefix: string, version: number, secretVersion: string, time: string) => `Published delegation ${prefix} in version ${version}. Its code is version ${secretVersion}, stored ${time}.`,
  notWritten: 'Not written',
  // "Write the code again"'s refusals (SignResult's reasons), each with its next step
  rewriteReasons: {
    'not-root': 'This Mac can’t sign now: sign in again, then write it again.',
    unmarked: 'This Mac’s keys can’t sign: make new keys, then discard it and create the delegation again.',
    signing: 'The record of signed states is damaged: reset it (Org › Problem).',
    cancelled: 'It was stopped: Write the code again.',
    pending: 'Another signed state is pending: settle it, then write it again.',
    invalid: 'It couldn’t be written: discard it and create the delegation again.',
    hub: 'The hub didn’t answer: write it again once it does.',
    busy: 'Its code is being written: wait for that to finish.',
    refused: 'Refused: discard it and create the delegation again.',
    stale: 'This Mac no longer holds its key pair: discard it and create the delegation again.',
    'secret-store': 'Its code has nowhere to go: fix what’s named, then write it again.',
    unsent: 'The code still isn’t stored: Write the code again, or discard it.',
  },
  discardDelegationTitle: (prefix: string) => `Discard the unsent delegation ${prefix}?`,
  discardDelegationBody: (version: number) => `Version ${version} was never sent, so nothing can show it as a fork. Discarding it also revokes the hub key minted for it. Create the delegation again afterwards.`,
  discardedDelegation: (version: number) => `Discarded version ${version}. Its hub key is revoked; if the hub didn’t take the revoke, the key shows under Stray hub keys, to revoke there.`,
  pendingUnsent: (version: number, prefix: string) => `Version ${version} holds delegation ${prefix}, not yet published: see Delegations.`,
  // Hub keys no delegation names: a create whose delegation was never signed
  strayKeys: 'Stray hub keys',
  strayNote: 'Hub keys that no delegation names, left by a create whose delegation was never signed.',
  stray: (label: string, prefix: string) => `${label} · ${prefix}`,
  minted: (ago: string) => `minted ${ago}`,
  justMinted: 'just minted',
  revokeStray: 'Revoke…',
  revokeStrayTitle: (label: string) => `Revoke the hub key “${label}”?`,
  revokeStrayBody: 'No delegation names this key. If a CLI delegation create or another admin’s create is still under way, it loses its key and fails, and has to be run again.',
  revokeStrayYoung: (ago: string) =>
    `This key was minted ${ago}: it is likely a create still under way, from the CLI or another admin. Revoking it now makes that create fail. Wait until it is 15 minutes old, unless you know that create was abandoned.`,
  revokeStrayConfirm: 'Revoke',
  notRevoked: 'Not revoked',
  // A new delegation
  newDelegation: 'New delegation',
  createAction: 'Create a delegation…',
  delegationsAdmins: 'An admin creates delegations from their Org page.',
  delegationsCantSign: 'This Mac can’t sign: create delegations from an admin’s Mac that does.',
  createNoDestination: 'Set the code destination below first.',
  createDamaged: 'Reset the code destination below first.',
  createWaits: 'A delegation is being created, in this window or another: Create once it’s done.',
  createPending: 'A signed state is pending: publish or discard it (Org › Pending) first.',
  created: (prefix: string, version: number, secret: { version: string; time: string } | null) =>
    secret === null ? `Created delegation ${prefix}. Signed version ${version}.` : `Created delegation ${prefix}. Signed version ${version}. Its code is version ${secret.version}, stored ${secret.time}.`,
  // The code's destination: main's own file, set once here
  destination: 'Code destination',
  destinationNote: 'A new delegation’s provisioning code is stored there as a new version of the Secret Manager secret, through this Mac’s gcloud signed in as the account. Devcloud’s next VM reads the latest version.',
  destinationFields: { project: 'Project', secret: 'Secret', account: 'Account' },
  destinationReading: 'Reading…',
  destinationInvalid: {
    project: 'A project id is 6 to 30 lowercase letters, digits and hyphens, from a letter: correct it, then Save.',
    secret: 'A secret id is up to 255 letters, digits, _ and -, not from a -: correct it, then Save.',
    account: 'The account is the gcloud account’s email: correct it, then Save.',
  },
  destinationPartial: 'Fill in all three, or clear all three to unset it, then Save.',
  save: 'Save',
  saved: 'Saved.',
  cleared: 'Cleared.',
  notSaved: 'Not saved',
  destinationWrite: {
    invalid: 'MAWS refused these values: correct them, then Save.',
    damaged: 'The destination’s file is damaged: Reset it, then Save.',
    io: 'The destination couldn’t be written: Save again.',
  },
  destinationDamaged: (why: string) => `The destination’s file is damaged (${why}): Reset it, then enter the destination again.`,
  resetDestinationTitle: 'Reset the code destination?',
  resetDestinationBody: 'MAWS removes the damaged file. Nothing else is lost: enter the project, secret and account again after.',
  // The create sheet: its fields, where its code goes, then one Touch ID; the code is never shown
  createTitle: 'Create a delegation',
  createFields: { label: 'Label', prefix: 'Prefix', ttl: 'Expires in', uses: 'Uses', owners: 'Owners' },
  days: 'days',
  createLabelNote: 'The hub key’s label: 1 to 100 characters.',
  createPrefixNote: 'The machines it provisions are named with this prefix.',
  createTtlBounds: (min: number, max: number) => `${min} to ${max} days.`,
  createUsesKinds: { none: 'No cap', cap: 'At most' },
  createUseCap: 'Use cap',
  createSheetNoDestination: 'No code destination is set: close this and set it under Delegations › Code destination.',
  createUsesBounds: (max: number) => `1 to ${max} machines.`,
  createDestination: (project: string, secret: string) => `The code goes to ${project}/${secret} as a new version. It is never shown here.`,
  createDevcloud: 'Devcloud uses it only if the profile’s [desk] delegation_id names this delegation.',
  createIntro: 'The hub mints its key, Touch ID signs the delegation, then its code is stored.',
  createConfirm: 'Create…',
  creating: 'Creating…',
  creatingLine: 'Minting its key, then Touch ID signs the delegation, then its code is stored…',
  notCreated: 'Not created',
  // A create's refusals (SignResult's reasons), each with its next step
  createReasons: {
    'not-root': 'This Mac can’t sign now: sign in again, then Create.',
    unmarked: 'This Mac’s keys can’t sign: make new keys first.',
    signing: 'The record of signed states is damaged: reset it (Org › Problem), then Create.',
    cancelled: 'Touch ID was cancelled, so nothing was signed: Create again when ready.',
    pending: 'A signed state is pending: publish or discard it (Org › Pending), then Create.',
    invalid: 'A value isn’t admitted: correct it, then Create again.',
    hub: 'The hub didn’t answer: Create again once it does.',
    busy: 'Another create or org attempt is running: Create again once it’s done.',
    refused: 'Refused, so nothing was signed: correct what’s named, then Create again.',
    stale: 'The org state changed meanwhile: Create again.',
    'secret-store': 'Its code has nowhere to go yet, so nothing was minted or signed: fix what’s named, then Create again.',
    unsent: 'Signed, but its code isn’t stored, so it isn’t published: Write the code again.',
  },
  createUnsentDiscard: 'This Mac can’t write it again: close this and Discard it from its row.',
  // Where a create stopped (main's `phase`), each with what is left to do
  phaseMinted: 'Nothing was signed. Any key it minted was revoked, or, if the hub didn’t take the revoke, it shows under Stray hub keys, to revoke there.',
  phaseHeld: (version: number | undefined) => `Signed${version === undefined ? '' : ` as version ${version}`}, not published: its provisioning code isn’t stored yet.`,
  phaseHeldStored: (version: number | undefined) => `Signed${version === undefined ? '' : ` as version ${version}`} and its code stored, but its publish was refused, so it stays unsent.`,
  heldWriteAgain: 'Write the code again, or close this and Discard it from its row.',
  heldDiscardOnly: 'Discard it, then create the delegation again.',
  phasePublished: (version: number | undefined) =>
    `Published${version === undefined ? '' : ` as version ${version}`}, its code stored. It settles as any pending state once the hub takes it (Org › Pending): nothing more to do here.`,
  phaseDiscarded: (stored: boolean) =>
    `Not published: its pending slot was discarded or replaced first, so nothing was published${stored ? '; its code’s version stays in the secret, unused' : ''}. Create the delegation again if it’s still wanted.`,
  createRunGone: 'This create is no longer the one this Mac runs (a Discard, another create or a sign-out since): nothing more to do here.',
  createSignInEnded: 'The sign-in this sheet opened under ended. Close it to create again.',
  // Renew: a new expiry in days from now, never past the hub's cap; the checks refuse the rest before Touch ID
  renewNow: (date: string) => `It expires ${date}.`,
  renewNew: (date: string) => `New expiry: ${date}.`,
  renewNotLater: (date: string) => `It expires ${date} already: choose a later expiry.`,
  renewPastCap: (max: number) => `At most ${max} days from now, the longest the hub keeps a key: choose fewer days.`,
} as const;
// P5 O8 M1 end
