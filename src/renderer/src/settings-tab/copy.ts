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
  binary: 'Binary',
  change: 'Change…',
  useDefault: 'Use default',
  binaryNote: 'Absolute path, never resolved through PATH. Verified at every launch.',
  binaryMismatch: 'does not match the pinned version · sessions will refuse to start until you re-pin',
  binaryReading: 'Reading the binary…',
  pinned: 'Pinned version',
  matches: 'matches binary',
  reports: (version: string) => `binary reports ${version}`,
  noVersion: 'binary did not report a version',
  repin: 'Re-pin…',
  pinnedNote: 'Each session records the version it ran on.',
  repinTitle: (version: string) => `Re-pin the engine to ${version}?`,
  repinBody: (from: string, to: string) =>
    `The pin moves from ${from} to ${to}, and sessions start on ${to}. Upgrading the engine is a deliberate re-probe: the fixtures and conformance tests were recorded on 2.1.283.`,
  repinConfirm: (version: string) => `Re-pin to ${version}`,
  cancel: 'Cancel',
  configHome: 'Config home',
  readOnly: 'read-only to MAWS',
  configHomeNote: 'The engine owns transcripts, settings and trust. MAWS reads them and keeps its own index elsewhere.',
  subagent: 'Subagent model',
  subagentPlaceholder: 'engine default',
  subagentNote: 'Sets CLAUDE_CODE_SUBAGENT_MODEL per launch for new sessions; Session info shows what a session actually got.',
};

export const GATEWAY = {
  hint: 'D-19',
  defaultRoute: 'Default route',
  routes: { gateway: 'ClaudeUsage relay', direct: 'Direct' },
  defaultRouteNote: 'New sessions start on this route; a session can be switched from its status line.',
  policy: 'Relay unreachable at launch',
  policies: { ask: 'Ask each time', wait: 'Wait for the relay', direct: 'Run direct' },
  policyDirectNote: 'A session on a gateway model (claude/…) is asked instead: Direct cannot serve it.',
  offerDirect: 'Per-session Direct',
  offerDirectLabel: 'Offer "Switch to Direct…" in the status line',
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
