// Every sentence of the Session info tool (C11 execution document, Interfaces "Session info tool"; mockup 06 vignette 03).
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M3): where a value came from is its tooltip, not a
// note at rest (T253, P162); the lane reads in a word, its sentence the tooltip (T254).

import type { PermissionMode } from '@shared/graph/enums';
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import type { ControlKey } from '../../session/controls/types'; // P5 O9 M5
import { MAWS_TOOLS } from '../../settings-tab/copy'; // board ticket 421: the groups' and the question tools' words

export const LANE = {
  off: (mode: PermissionMode) => `Auto mode is off · ${PERMISSION_MODE_LABELS[mode]}`,
  observed: (account: string) => `Local · Sonnet 5 through ${account} · counted as usage · the engine's notice is in the transcript`,
  someAccount: 'the routing account',
  expectedGateway: 'Local (expected) · a GPT route carries no Anthropic verdict',
  expectedFast: 'Local (expected) · fast mode is on',
  expectedDisabled: 'Local (expected) · the server lane is disabled for this session',
  server: 'Server · reviews ride on the main request · no charge · model chosen server-side',
  unknown: 'Not read yet',
  // the row's value, the lane in a word (T254); a refusal and `unknown` keep their words
  short: { server: 'Server', local: 'Local', off: 'Off' },
  reviews: (evaluated: number, flagged: number) => `${evaluated} reviewed · ${flagged} flagged`, // T255
};

export const INFO = {
  title: 'Session info',
  noSession: 'Open a session to see its details',
  sections: { engine: 'Engine', model: 'Model', gateway: 'Gateway', permissions: 'Permissions', usage: 'Usage' /* T249 */, hooks: 'Hooks and MCP' },
  // Engine
  version: 'Version',
  binary: 'Binary',
  sessionId: 'Session id',
  plugins: 'Plugins', // P2-A: the loaded plugins the engine last reported, while no process is live
  pluginsLoaded: (n: number) => `${n} loaded`,
  // W7: who holds the session (the glyph's derivation, attention/derive.ts)
  heldBy: 'Held by',
  heldByMaws: 'MAWS',
  heldByNone: 'No process',
  contested: (other: string) => `MAWS and ${other}`,
  contestedNote: 'Contested: MAWS yields once the other process writes',
  readOnly: 'Read-only here',
  // P5 O9 M5 (the owner's Q1 and Q2): a terminal session MAWS drives through its bridge, and the controls it can't reach
  bridged: 'Driven through sminos’s bridge',
  unavailableTitle: 'Not available here',
  unavailableCount: (n: number) => `${n} not available`, // the word cut (T266): the folded group's bare count's meaning
  // every control the port names (ControlKey), each listed with its reason when unreachable
  control: {
    send: 'Send',
    interrupt: 'Stop the running turn',
    answer: 'Answer a request',
    decide: 'Answer a permission request',
    'decide.scope': 'Allow for the session or project',
    'decide.interrupt': 'Deny and interrupt',
    'decide.addDirectory': 'Allow and add a directory',
    model: 'Model and effort',
    mode: 'Permission mode',
    command: 'Slash commands',
    btw: 'Side question',
    compact: 'Compact',
    'mcp.enable': 'Enable an MCP server',
    'mcp.disable': 'Disable an MCP server',
    'mcp.reconnect': 'Reconnect an MCP server',
    'stop-agent': 'Stop a subagent',
    tell: 'Message a subagent',
    'stop-task': 'Stop a background shell',
    media: 'Attachments',
    queue: 'Queue',
    rewind: 'Rewind',
    forget: 'Forget a message',
    'rewind-files': 'Roll back files',
    'elicitation.answer': 'Answer a form',
    'subagent-rows': 'Subagent rows',
    'take-over': 'Take over in MAWS',
    reopen: 'Reopen',
  } satisfies Record<ControlKey, string>,
  // Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, §H): the set of MAWS's tools a running session
  // started with, in Settings › Sessions' words
  mawsTools: MAWS_TOOLS.tools,
  mawsToolsNone: 'None',
  questionTool: MAWS_TOOLS.question,
  processTree: 'Process tree',
  tree: (tree: string, own: string | null) => (own === null ? tree : `${tree} · own ${own}`),
  // Model
  main: 'Main',
  subagents: 'Subagents',
  subagentChosen: 'CLAUDE_CODE_SUBAGENT_MODEL, chosen at launch',
  subagentsInherit: "each agent's own, else Main", // W3: no CLAUDE_CODE_SUBAGENT_MODEL (the engine's precedence, SPEC 18)
  effort: 'Effort', // P2-A: the engine's last reported effort, while no process is live
  outputStyle: 'Output style', // P2-A: the engine's last reported output style, while no process is live
  overrides: 'Overrides',
  passedThrough: 'passed through from your shell',
  // Gateway
  route: 'Route',
  // T256: the route and what it names, the words that repeat it cut
  routed: (baseUrl: string) => `Gateway · ${baseUrl}`,
  direct: 'Direct',
  directLogin: (login: string) => `Direct · ${login}`,
  engineLogin: "the engine's own login", // who a Direct session's local lane is counted against, in the lane's sentence
  unverified: 'Route unverified', // T258: with no note until it is checked; a mismatch says why
  mismatch: (mode: string) => `the engine's base URL does not match the ${mode === 'direct' ? 'direct' : 'gateway'} route it was launched on`,
  account: 'Account',
  toolSearch: 'Tool search',
  toolSearchOn: 'on', // P163
  toolSearchOff: 'off',
  login: 'Login',
  organization: 'Organization',
  email: 'Email',
  pinnedHere: 'pinned', // T259
  routingNow: 'routing now',
  noAccount: 'no account yet',
  // Permissions
  mode: 'Mode',
  effectiveNote: 'effective, from the init frame',
  lane: 'Auto-mode lane',
  rules: 'Rules',
  ruleCounts: (allow: number, ask: number, deny: number, grants: number) => `${allow} allow · ${ask} ask · ${deny} deny · ${grants} session grant${grants === 1 ? '' : 's'}`,
  grantsOnly: (grants: number) => `${grants} session grant${grants === 1 ? '' : 's'}`, // T258: until the rules are read
  openPermissions: '/permissions',
  // Usage (P176: the context and the usage windows are the context ring's and the usage displays', not repeated here)
  pace: 'Pace', // W2: the usage popover's pace line, here since the status line is gone
  cost: 'Cost',
  costLine: (total: string, since: string) => `${total} · ${since} new`, // T264
  // Hooks and MCP
  hooks: 'Hooks',
  hookCounts: (settings: number, plugin: number) => `${settings} settings hook${settings === 1 ? '' : 's'} · ${plugin} plugin hook${plugin === 1 ? '' : 's'}`,
  mcp: 'MCP',
  mcpConnected: (n: number) => `${n} connected`,
  failed: (name: string, error: string | null) => (error ? `${name} failed · ${error}` : `${name} failed`),
  unread: 'not read',
  none: '—',
};
