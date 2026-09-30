// The Accounts tab's words (C11 execution document, Interfaces "Accounts tab"; mockup 06 vignette 01). ClaudeUsage owns
// sign-in, reconnect and removal (D-19): every action here is a hand-off that names ClaudeUsage.

export const ACCOUNTS = {
  title: 'Accounts',
  readFrom: (ago: string) => `read from ClaudeUsage · updated ${ago}`,
  openClaudeUsage: 'Open ClaudeUsage ↗',
  note: 'The relay picks the account whose weekly window resets soonest; a manual choice in ClaudeUsage wins while it is usable.',
  addAccount: 'Add account in ClaudeUsage ↗',
  addHint: 'Signs in without changing what this Mac is using',
  reconnect: 'Reconnect in ClaudeUsage ↗',
  remove: 'Remove in ClaudeUsage ↗',
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
