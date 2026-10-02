// The Settings tab's words (C11 execution document, Interfaces "Settings tab"; mockup 06 vignette 04). Every row says
// where its value comes from and what MAWS will not touch.

export const SECTIONS = {
  engine: 'Engine',
  gateway: 'Gateway',
  keyboard: 'Keyboard',
  appearance: 'Appearance',
  notifications: 'Notifications',
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
  tested: (version: string) => `MAWS's fixtures and conformance tests were recorded on Claude Code ${version}`,
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
  nearLimit: 'Near-limit banner',
  nearLimitAt: (n: number) => `at ${n}%`,
  nearLimitHint: 'once per window, account-wide',
  on: 'on',
  off: 'off',
};
