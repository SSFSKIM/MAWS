// The Settings tab's words (C11 execution document, Interfaces "Settings tab"; mockup 06 vignette 04). Every row says
// where its value comes from and what MAWS will not touch.
import { MAX_IDLE_MINUTES } from '@shared/ipc/schema/settings'; // E10

export const SECTIONS = {
  engine: 'Engine',
  gateway: 'Gateway',
  keyboard: 'Keyboard',
  voice: 'Voice', // E9
  appearance: 'Appearance',
  notifications: 'Notifications',
  browser: 'Browser', // E4a: Settings › Browser (settings version 11), last in the index
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
  when: 'When a session needs you',
  enabledLabel: 'Notify while MAWS is not focused',
  delivery: { os: 'macOS: allowed', fallback: 'macOS: not delivered · MAWS falls back to a dock bounce and a toast' },
  kinds: 'For',
  kind: {
    approvals: 'approvals',
    questions: 'questions',
    planReviews: 'plan reviews',
    errors: 'errors',
    heldPeerMessages: 'held peer messages',
  },
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
