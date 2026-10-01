// The accounts' words (C11 execution document, Interfaces "Accounts tab"; mockup 06 vignette 01), shown since W6 in the
// top bar's usage popover, the Accounts tab having retired into it. ClaudeUsage owns sign-in, reconnect and removal
// (D-19).

export const ACCOUNTS = {
  openClaudeUsage: 'Open ClaudeUsage ↗',
  waiting: 'Waiting for ClaudeUsage…',
  unavailable: 'ClaudeUsage is not installed or has no data',
  install: 'Install ClaudeUsage',
  openPlain: 'Open ClaudeUsage',
  refresh: 'Refresh',
  empty: 'ClaudeUsage has no accounts yet',
  reading: 'Reading ClaudeUsage…',
};

export const ROUTING = {
  here: 'Routing here',
  why: {
    manual: 'chosen in ClaudeUsage',
    weekly_resets_soonest: 'weekly resets soonest of the usable accounts',
    relay_choice: 'chosen by the relay',
  },
};

export const STATE = {
  needsReauth: 'Needs reauthentication · the relay skips it until it is reconnected; readings are last known',
  noReadings: 'No readings yet',
  resetPassed: (name: string) => `${name} · no reading since the window reset`,
};

export const savedSessions = (n: number) => (n === 1 ? '1 saved session' : `${n} saved sessions`);

export const RELAY = {
  listening: (hostPort: string, checked: string, latencyMs: number | null) =>
    `Relay listening on ${hostPort} · checked ${checked}${latencyMs === null ? '' : ` · ${Math.round(latencyMs)} ms`}`,
  down: (error: string | null) => `Relay not answering${error ? ` · ${error}` : ''}`,
  unchecked: 'Relay not checked yet',
};

// ClaudeUsage's repository, whose README says how to install it (the Accounts tab's `Install ClaudeUsage`).
export const CLAUDE_USAGE_README_URL = 'https://github.com/SSFSKIM/claude-usage-menubar#readme';

// W6 start: the top bar's usage pill and its popover, a copy of ClaudeUsage's panel (PanelView.swift, E1). The four
// account actions run through ClaudeUsage's control route, and render disabled under one hint while it does not answer
// (`usage/controls.ts`).
export const USAGE = {
  pill: (percent: number, limit: string, account: string) => `Usage · ${limit} ${percent}% · ${account}`,
  pillNoReading: (account: string) => `Usage · no readings yet for ${account}`,
  pillNoData: 'Usage · ClaudeUsage has no data',
  title: 'Claude Usage',
  updated: (ago: string) => `updated ${ago}`,
  note: 'Usage includes all machines. Activity below is from this Mac.',
  controlsUnavailable: "Routing controls arrive when ClaudeUsage exposes its control route; use ClaudeUsage's own panel for now",
  route: 'Route requests here',
  reconnect: 'Reconnect…',
  remove: 'Remove account…',
  add: 'Add account…',
  addHint: 'Signs in without changing what this Mac is using.',
  codexTitle: 'Codex accounts',
  codexNote: 'Used by GPT models routed through this app.',
  codexEmpty: 'No Codex accounts connected.',
  codexLimits: "Limits show in ClaudeUsage's own panel",
  routingToggle: 'Route Claude Code through this app',
  routingToggleHint: "ClaudeUsage's own panel changes this",
  // W6 route executor start: the actions through ClaudeUsage's control route (`usage/controls.ts`)
  controlsBadToken: "ClaudeUsage's control token could not be read",
  controlsStarting: 'ClaudeUsage is still starting',
  routeNotReady: "Route requests here needs ClaudeUsage's “Route Claude Code through this app”, which its own panel turns on",
  routeConfirm: { title: (email: string) => `Route requests to ${email}?`, body: 'Existing sessions move at their next request, which rebuilds their prompt cache.' },
  // ClaudeUsage's own confirm (PanelView.swift `confirmingRemoval`), naming ClaudeUsage where its panel says "this app"
  removeConfirm: {
    title: (email: string) => `Remove ${email} from this Mac?`,
    body: "Removes ClaudeUsage's saved sign-in and stops routing new requests to this account. Your Claude subscription and other machines are unchanged. To add it again, sign in again.",
    label: 'Remove account',
  },
  signInAdd: "ClaudeUsage's sign-in sheet opens to add an account; finish signing in there",
  signInReconnect: (email: string) => `ClaudeUsage's sign-in sheet opens to reconnect ${email}; finish signing in there`,
  // W6 route executor end
};

// ClaudeUsage's serving chip (PanelView.swift `ServingChip`): what the account served in the relay's last ten minutes.
export const serving = (requests: number, cacheHitRatio: number | null, ago: string) =>
  [requests === 1 ? '1 request' : `${requests} requests`, ...(cacheHitRatio === null ? [] : [`${Math.round(cacheHitRatio * 100)}% cached`]), ago].join(' · ');

// The relay's health line (PanelView.swift `GatewayHealthText`).
export const HEALTH = {
  line: (body: string) => `Last 10 min: ${body}`,
  responseStart: (p50: string, p95: string) => `response start median ${p50}, p95 ${p95}`,
  noErrors: 'no errors',
};
// W6 end
