// Customize › Connectors' words (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Adding",
// "Signing in", "My items", "Failure handling"). Plain and literal: a state says only what MAWS observed.
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import { MCP_ENTRY_BOUNDS as BOUND } from '@shared/plugins/cli';

type Step = Exclude<ConnectorSignInChanged['state'], 'done' | 'failed' | 'cancelled'>;
type Reason = NonNullable<ConnectorSignInChanged['reason']>;

// A limit as §E writes it: the constant the check uses, with a comma between thousands (UX wave U11g, R11).
const limit = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const CONNECTORS = {
  tab: 'Connectors',
  configured: 'Configured on disk',
  none: 'No connectors yet', // the word cut (G261)
  live: 'Live in the attached session',
  noLive: 'Connection state and tools are unavailable without a running session in this project.',
  refresh: 'Refresh',
  search: 'Search connectors', // UX wave U11c: My items' search while Show is Connectors (the drawing's label, ruled point 7)
  remove: 'Remove',
  removeName: (name: string) => `Remove ${name}`,
  scopeOf: (scope: string) => `${scope} scope`,
  // the sheet
  addTitle: (name: string) => `Add ${name}?`,
  removeTitle: (name: string) => `Remove ${name}?`,
  name: 'Name',
  url: 'URL',
  instanceUrl: 'Your instance’s URL',
  pattern: (pattern: string) => `It must match ${pattern}`,
  urlChoice: 'Server',
  transport: 'Transport',
  transportName: { http: 'HTTP (streamable)', sse: 'SSE' } as const,
  noSignIn: 'No sign-in needed',
  signInAfter: 'After adding, sign in from Connectors › My items.',
  writes: 'Changes',
  takesEffect: 'Sessions started from now on load it; running sessions do not.',
  removesFrom: 'Running sessions keep it until they end.',
  exists: (scope: string, path: string) => `This name is already configured here (${scope} scope, ${path}).`,
  // field problems
  nameRequired: 'Enter a name.',
  nameRule: 'Use letters, digits, hyphens and underscores only.',
  urlRequired: 'Enter the server’s URL.',
  urlScheme: 'Enter an http or https URL.',
  urlPattern: (pattern: string) => `The URL must match ${pattern}`,
  urlUnchecked: 'This server’s URL pattern can’t be checked.',
  // what is configured here, which the name is checked against
  serversReading: 'Reading what is configured here…',
  serversFailed: (message: string) => `What is configured here couldn’t be read: ${message}`,
  serversPartial: 'Not every configuration here could be read, so the name can’t be checked against them.',
  // sign-in
  signIn: 'Sign in',
  signInName: (name: string) => `Sign in to ${name}`,
  cancel: 'Cancel',
  openSession: (place: string | null) => (place === null ? 'Open a session, then sign in' : `Open a session in ${place}, then sign in`),
  connected: 'Connected',
  needed: 'Sign in needed',
  noneNeeded: 'No sign-in needed',
  connecting: 'Connecting…',
  failed: (message: string | null) => (message ? `Failed: ${message}` : 'Failed'),
  status: (status: string) => status,
  shadowed: (scope: string) => `Shadowed by the ${scope} entry`,
  shadowedByMaws: (name: string) => `Shadowed by MAWS’s ${name} server`,
  step: {
    starting: 'Starting sign-in…',
    waiting_browser: 'Opening your browser…',
    waiting_callback: 'Finish signing in in your browser…',
    submitting: 'Finishing sign-in…',
    watching_status: 'Waiting for the server to connect…',
  } satisfies Record<Step, string>,
  alreadyConnected: 'Already connected in that session',
  signedIn: { here: 'Signed in · connected here', new_sessions: 'Signed in · available in new sessions' } as const,
  didntFinish: (why: string) => `Sign-in didn’t finish: ${why}`,
  reason: {
    no_session: 'no session is ready',
    timeout: 'the browser didn’t return within 5 minutes',
    denied: 'the sign-in was declined',
    engine: 'the engine refused it',
    session_exited: 'the session ended',
    other_entry: 'that session uses another entry of this name',
  } satisfies Record<Reason, string>,
  cancelled: 'cancelled',
  // UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, §E, §G): a plugin's connector's
  // row, and the lines that stand in its state's place
  fromPlugin: (plugin: string) => `from ${plugin}`,
  pluginNameUnread: 'Plugin name can’t be read', // the word cut (N136)
  sameAddressAs: (name: string) => `Not loaded: same address as ${name}`,
  pluginOff: 'Plugin turned off',
  collision: (plugins: readonly string[]) => `Supplied by more than one plugin (${plugins.join(', ')}). Turn the others off to sign in.`, // the word cut (N137)
  nameTooLong: 'Its name is too long to sign in from MAWS.',
  addressAtStart: 'Sign in from a chat’s Connectors dialog.', // the word cut (N138)
  notInAttached: 'Not in the attached session',
  otherPlugin: 'That session loaded this connector’s name from another plugin.',
  otherVersion: 'That session loaded another version of this plugin. Start a new session, then sign in.',
  absent: 'That session loaded no plugin that supplies this connector.', // the architect's ruling of 2026-11-16
  notReported: 'Send a message in that session, then sign in.',
  // UX wave U11g (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §E): a custom connector's sheet
  addCustom: 'Add custom connector…',
  customTitle: 'Add custom connector',
  type: 'Type',
  typeName: { http: 'Remote (HTTP)', sse: 'Remote (SSE)', stdio: 'Local command' } as const,
  headers: 'Request headers',
  command: 'Command',
  args: 'Arguments',
  env: 'Environment',
  addTo: 'Add to',
  allProjects: 'All projects',
  projectOnly: (project: string) => `${project} only`,
  projectShared: (project: string) => `${project}, shared in its .mcp.json`,
  // the one named place for the warning under "Add to" (R9)
  sharedFileWarning: 'This file is usually committed with the repository. Write a secret as ${NAME}, with a name of your own, and set NAME under env in ~/.claude/settings.json or in the environment Claude Code starts with.',
  sentEmpty: (name: string) => `Claude Code sends ${name} to a remote server as empty. Use a name of your own.`,
  argsAsTyped: 'Arguments are shown and saved as typed and are hidden nowhere. Put a secret in Environment.',
  rowNameMissing: { headers: 'Enter a name for this header.', env: 'Enter a name for this variable.' } as const,
  reserved: 'This name is reserved by Claude Code or by MAWS.',
  addHeader: 'Add header',
  addVariable: 'Add variable',
  removeRow: (label: string) => `Remove ${label}`,
  rowName: 'Name',
  rowValue: 'Value',
  commandRequired: 'Enter the command.',
  commandSpaces: 'Taken whole as the program to run, spaces included. Arguments go in Arguments.',
  argCount: (count: number) => (count === 1 ? '1 argument' : `${count} arguments`), // drawn only for one or more (the word cut, N145)
  emptyArg: '(empty)',
  argsOpenQuote: 'The arguments end inside a quote.',
  argsBackslash: 'The arguments end with a backslash.',
  rowNameRule: { headers: 'Use letters, digits and hyphens in a header name, without spaces.', env: 'Use letters, digits and underscores in a variable name, not starting with a digit.' } as const,
  rowDuplicate: { headers: (name: string) => `Two headers are named ${name}.`, env: (name: string) => `Two variables are named ${name}.` } as const,
  controlCharacter: 'This field can’t hold a line break or a control character.',
  // over a bound (R11): what is over, then the limit the check uses
  tooManyArgs: `Too many arguments. The limit is ${limit(BOUND.args)}.`,
  tooManyHeaders: `Too many headers. The limit is ${limit(BOUND.headers)}.`,
  tooManyVariables: `Too many variables. The limit is ${limit(BOUND.env)}.`,
  urlTooLong: `The URL is too long. The limit is ${limit(BOUND.url)} characters.`,
  commandTooLong: `The command is too long. The limit is ${limit(BOUND.command)} characters.`,
  argTooLong: (k: number) => `Argument ${k} is too long. The limit is ${limit(BOUND.arg)} characters.`,
  valueTooLong: `This value is too long. The limit is ${limit(BOUND.value)} characters.`,
  tooLarge: `This configuration is too large to add. The limit is ${limit(BOUND.json)} bytes.`,
  // Discover
  unavailable: 'Anthropic’s directory is unavailable.',
  retry: 'Retry',
  asksInstanceUrl: 'Asks for your instance’s URL',
} as const;
