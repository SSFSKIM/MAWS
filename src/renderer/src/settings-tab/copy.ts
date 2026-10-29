// The Settings tab's words (C11 execution document, Interfaces "Settings tab"; mockup 06 vignette 04). Every row says
// where its value comes from and what MAWS will not touch.
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
} as const;

export const INDEX = {
  title: 'Settings',
  footer: "Stored in MAWS's own Application Support folder. Nothing here writes into ~/.claude.",
  writeFailed: (why: string) => `The setting was not saved · ${why}`,
  reading: 'Reading settings…',
};

export const ENGINE = {
  // W13 (charter D-1 as amended 2026-10-01): the installed Claude Code by default, never refused for its version
  binary: 'Binary',
  change: 'Change…',
  useInstalled: 'Use installed',
  binaryNote: "New sessions start on your installed Claude Code (~/.local/bin/claude, else claude on your shell's PATH), found again at every launch. Running sessions keep the binary they started on.",
  binaryChosenNote: 'New sessions start on the binary you chose. Running sessions keep the binary they started on.',
  tested: (version: string) => `MAWS was verified against Claude Code ${version}`, // E11 2.8: the release E11's live sittings ran, as the compat notice words it
  binaryReading: 'Reading the binary…',
  update: 'Update',
  updateAction: 'Update Claude Code…',
  updateNote: 'Runs claude update in a terminal tab. New sessions start on the new version; running sessions keep theirs.',
  updateChosenNote: 'Runs claude update in a terminal tab. New sessions stay on the binary you chose until Use installed.',
  configHome: 'Config home',
  readOnly: 'read-only to MAWS',
  configHomeNote: 'The engine owns transcripts, settings and trust. MAWS reads them and keeps its own index elsewhere.',
  // R1 (charter D-9 as amended 2026-10-01): what MAWS honours of a plugin, information only
  plugins: 'Plugins',
  pluginsNote: 'Plugin hooks run in MAWS sessions as in the terminal; their toasts, status lines and log lines show in the session, their panes and bands not yet.',
  subagent: 'Subagent model',
  subagentPlaceholder: 'inherit', // W3: the engine's own word for no override (each agent's model, else the session's)
  subagentNote: 'Sets CLAUDE_CODE_SUBAGENT_MODEL per launch for new sessions; Session info shows what a session actually got.',
  // W3 (charter D-18 as amended 2026-10-01)
  autoFallback: 'When auto mode is unavailable',
  autoFallbackNote: "Some models (Haiku), fast mode and auto mode's circuit breaker refuse auto. MAWS then sets this mode for the session and says so; the next resume asks for auto again.",
};

// P4-A2 start: Settings › Engine, the launch profile every session MAWS launches runs under (settings version 17)
export const LAUNCH_PROFILE = {
  plugins: 'Plugins in sessions',
  pluginsNote: 'The plugins your Claude Code settings turn on, as a terminal session loads them. Switch one off to keep it out of the sessions MAWS starts, forks and resumes; your own settings files are never changed.',
  pluginsReading: 'Reading your plugins…',
  pluginsNone: 'Your settings turn on no plugins.',
  pluginOn: (id: string) => `Load ${id} in MAWS sessions`,
  hooks: 'Hooks in sessions',
  hooksNote: "None turns off every hook from your settings and your plugins in MAWS's sessions, the to-human plugin's included, so they run without MAWS's report. Each change on this page applies at a session's next launch, never to a terminal session.", // P4-R7z: the plugin's message tool needs its hooks
  hooksYours: 'Yours',
  hooksNone: 'None',
};
// P4-A2 end

// P4-R8 start: Settings › Engine › MCP servers (settings version 16)
export const MCP_SERVERS = {
  label: 'MCP servers',
  note: "Loaded by every session MAWS starts, forks or resumes, never by a terminal session. An entry wins over a server of the same name in your own or a project's config, and a Claude Code sign-in for an HTTP server of the same name and URL without custom headers carries over. A change applies at each session's next launch.",
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

// C12 start: the memory budget's rows in Settings › Engine (C12 execution document, "Surfaces of the budget")
export const BUDGET_SETTINGS = {
  // W7 start: the switch (settings version 7); off hides the rows below it
  enabled: 'Memory budget',
  enabledLabel: 'Release idle sessions to stay under a memory limit',
  offNote: 'Off · engine processes never exit on their own; only archive, quit or a stop ends one. Session info still shows the memory they use.',
  limit: 'Limit',
  // W7 end
  budget: 'Memory budget', // the limit's field
  placeholder: 'default',
  defaultNote: (limit: string | null) => `Default · 25% of physical memory${limit === null ? '' : ` (${limit})`}. Past it, MAWS releases the least recently used idle session; Send resumes it.`,
  setNote: 'Default · 25% of physical memory. Past it, MAWS releases the least recently used idle session; Send resumes it.',
  useDefault: 'Use default',
  invalid: 'Enter the memory budget in GB, at least 0.5',
  stateful: 'Stateful MCP servers',
  statefulNote: 'Servers whose state is lost when their process ends: a session connected to one is never released. Names match exactly; the field suggests those live sessions report.',
  addServer: 'Add a stateful MCP server',
  addPlaceholder: 'server name',
  remove: (name: string) => `Remove ${name}`,
};

// C12 end

// E10 start: Settings › Engine › Background supervisor (E10 execution document, §Design 11; settings version 10)
const sessions = (n: number) => (n === 0 ? 'no sessions' : `${n} ${n === 1 ? 'session' : 'sessions'}`);
// The idle time as the supervisor holds it: whole minutes from the setting, seconds under the e2e seam
const idleSpan = (ms: number) => (ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`);
export const SUPERVISOR = {
  title: 'Background supervisor',
  status: 'Status',
  reading: 'Reading…',
  running: (since: string, pid: number, live: number, exit: string) => `Running since ${since} · pid ${pid} · ${sessions(live)} · ${exit}`,
  exitsAfter: (idleExitMs: number) => `exits ${idleSpan(idleExitMs)} after the last session ends`,
  exitsNever: 'never exits on its own',
  exitsWithLast: 'exits when its last session ends', // exit-when-idle armed (an update, or the incompatible wait)
  inApp: (pid: number, live: number) => `Runs inside MAWS · pid ${pid} · ${sessions(live)} · stops when MAWS quits`, // MAWS_HOST_MODE=utility
  starting: 'Starting',
  restarting: 'Restarting',
  notRunning: 'Not running',
  heldLock: 'Not running · another supervisor holds its lock and does not answer',
  waiting: (live: number) => `Waiting · the previous version's supervisor still runs ${sessions(live)}; MAWS moves to a new one when they become idle`,
  waitingNote: "This version of MAWS cannot use it. Restart now stops those sessions and starts this version's supervisor; Send resumes each from its transcript.",
  restartNow: 'Restart now',
  statusNote: 'Sessions run in this background process, so they can keep running after MAWS quits.',
  idle: 'Exit when idle',
  idleField: 'Minutes before the supervisor exits when idle',
  idleNever: 'never', // the empty field's placeholder
  idleUnit: 'min',
  idleNote: (minutes: number) => `With MAWS closed, the supervisor exits ${minutes} min after its last session ends, and a kept session idle that long is stopped (Send resumes it). Empty means never.`,
  idleNeverNote: 'Never · the supervisor keeps running after its last session ends, even with MAWS closed.',
  idleInvalid: `Enter whole minutes from 1 to ${MAX_IDLE_MINUTES}, or leave the field empty for never`,
  quitDefault: 'When quitting with work in flight',
  quitKeep: 'Keep sessions running',
  quitStop: 'Stop them',
  quitNote: "The quit question's default answer. It asks only while a session is mid-turn or has work in flight; otherwise quitting stops every session.",
  stopAll: 'Stop all',
  stopAllAction: 'Stop all sessions and the supervisor…',
  stopAllNote: 'Every session stops; Send resumes it from its transcript. A fresh supervisor starts in its place.',
  confirm: (live: number) => (live === 0 ? 'No session is running. Stop the supervisor and start a fresh one?' : `Stop ${sessions(live)} and the supervisor?`),
  confirmAction: 'Stop all',
  cancel: 'Cancel',
  stopping: 'Stopping…',
  stopFailed: (why: string) => `The supervisor was not stopped · ${why}`,
  // P5 O2 M7: the shape's switch, applied at the next launch, and the machine daemon's line
  shape: 'Run sessions under the machine daemon',
  shapeNote: 'Applies at the next launch. Sessions and terminals then run under mawsd, which keeps them running when MAWS quits.',
  shapeLeaving: 'MAWS stops using the machine daemon when it opens again; this launch keeps running under it.',
  shapeJoining: 'MAWS runs its sessions under the machine daemon when it opens again.',
  daemon: 'Machine daemon',
  daemonLine: (kind: 'unit' | 'private', pid: number, machine: string) => `${kind === 'unit' ? 'At login' : 'This profile only'} · pid ${pid} · machine ${machine}`,
  daemonConnecting: 'Connecting',
  daemonUnavailable: (why: string) => `Not in use this launch · ${why}`,
  daemonEmbedded: 'Not in use · MAWS runs its sessions itself',
};
// E10 end

export const GATEWAY = {
  defaultRoute: 'Default route',
  routes: { gateway: 'ClaudeUsage relay', direct: 'Direct' },
  defaultRouteNote: 'New sessions start on this route; a session can be switched from its Session info.', // W2: no status line
  policy: 'Relay unreachable at launch',
  policies: { ask: 'Ask each time', wait: 'Wait for the relay', direct: 'Run direct' },
  policyDirectNote: 'A session on a gateway model (claude/…) is asked instead: Direct cannot serve it.',
  offerDirect: 'Per-session Direct',
  offerDirectLabel: 'Offer "Switch to Direct…" in Session info', // W2: no status line
  offerDirectNote: "The relay card's Run direct stays either way: Direct is the fallback when the relay is unreachable.",
  directLogin: 'Direct login',
  directLoginKnown: (login: string, email: string | null) => ["engine's own", login, email].filter(Boolean).join(' · '),
  directLoginUnknown: 'unknown until a Direct session runs',
  directLoginNote: "Only Direct sessions use it. MAWS never stores a token; ClaudeUsage holds the relay's accounts.",
  signIn: 'Sign in: run claude /login in a terminal',
  signInCommand: 'claude /login',
  copy: 'Copy',
  copied: 'Copied',
  relay: 'Relay',
  openClaudeUsage: 'Open ClaudeUsage',
};

export const KEYBOARD = {
  hint: 'all bindings editable · ⇧Tab cycles permission mode as in the terminal',
  change: 'Change',
  recording: 'Press keys… esc cancels',
  was: (display: string) => `Was ${display}`,
  unbound: 'Unbound',
  conflict: (title: string) => `Already bound to ${title} · unbind it first`,
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
  shortcutNote: "Click the microphone in the composer's toolbar to start dictating and again to stop. A shortcut, once bound, dictates into the focused composer while you hold it.",
  language: 'Language',
  system: (locale: string | null) => (locale === null ? 'System' : `System (${locale})`),
  noOnDeviceMark: 'no on-device model',
  languageNote: "Dictation runs on this Mac through Apple's speech recognition; MAWS stores no audio and no transcript.",
  helper: 'Helper',
  helperFound: 'Found at',
  helperMissing: 'Not found at',
  helperBuild: 'run pnpm build:helper',
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
  monoFontNote: 'Name a Nerd Font to draw prompt glyphs in the terminal',
  // W2: Claude Desktop's setting, in its words
  transcriptWidth: 'Transcript width',
  transcriptWidths: { 768: 'Narrow', 960: 'Medium', 1280: 'Wide' },
  transcriptWidthNote: 'Maximum width of the transcript and composer columns',
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
    note: 'Agents send you messages and ask questions you answer in place, and a session reads as their report. The view follows at once; the instructions, the next time each session starts.',
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
  profileNote: 'Applies to tabs opened from now on. The address bar shows which profile a tab browses with.',
  search: 'Search engine',
  searchNote: 'Use %s for the search text',
  searchInvalid: 'Enter an http or https address with %s where the search text goes',
  useDefault: 'Use default',
  links: 'Links that open a new window',
  linkTargets: { 'in-app': 'In MAWS', external: 'In the system browser' },
  linksNote: 'In MAWS, such a link opens as a new tab of the same session.',
  // cua #90: settings 12's switch
  bookmarksBar: 'Bookmarks bar',
  bookmarksBarLabel: 'Show the bookmarks bar',
  bookmarksBarNote: 'An imported profile’s Chrome bookmarks, under the address bar. ⌘⇧B in the browser.',
  // E4b start: the imported Chrome profiles (E4b execution document, Design §11; Decision Log 35)
  chromeProfile: 'Chrome profile',
  import: 'Import a Chrome profile…',
  importNote: 'A one-time copy of its history, cookies and extensions. Chrome is never changed.',
  importing: (step: string) => `Import running · ${step}`,
  show: 'Show',
  lastImport: (outcome: 'cancelled' | 'failed') => (outcome === 'cancelled' ? 'The last import was cancelled' : 'The last import failed'),
  importedOn: (date: string) => `Imported ${date}`,
  showReport: 'Show report',
  remove: 'Remove imported profile',
  extensions: 'Extensions',
  walletOff: 'Wallet extensions start off',
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
  exportAuthorNote: (fallback: string) => `Name on your DOCX comments. When blank, use “${fallback}”. Agent comments keep their session name.`,
  suggestedAuthor: (name: string) => `Use ${name}`,
  defaultSystem: 'Default design system',
  house: 'House system',
  defaultSystemNote: 'Documents, decks and designs that name no system of their own, in no Space with a default, use it. The house system is MAWS.',
  missing: 'A deleted system · the house system applies', // the owner's default: the chain's next link is the house
  missingSpace: 'A deleted system · the next default applies', // a Space's: yours first, then the house
  bySpace: 'By Space',
  bySpaceNote: 'A Space’s default comes before yours.',
  noSpaces: 'No Spaces yet. A Space can have its own default design system.',
  useMine: 'Use my default',
  spaceSystem: (space: string) => `Design system for ${space}`,
  reading: 'Reading design systems…',
  readFailed: (why: string) => `Could not read the design systems · ${why}`,
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
  enroll: 'Enroll a machine',
  enrollCommand: 'deployment admin enroll <name>',
  enrollNote: 'Enrolling from this page comes later.',
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
} as const;
// P5 O8 M1 end
