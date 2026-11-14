// Invented content shared by every experiment, so that two experiments differ in design and never in what they show.
// Nothing here comes from a real session, project or machine.

export type SessionState =
  | 'running' // a turn is in flight
  | 'approval' // waiting for the person to approve a tool call
  | 'question' // the agent asked the person something
  | 'plan' // a plan waits for review
  | 'unread' // finished; the person has not looked yet
  | 'idle'; // finished and seen

export interface Session {
  id: string;
  title: string;
  state: SessionState;
  /** One short line: what it is doing now, or what it needs. */
  line: string;
  /** Compact age, as a sidebar shows it. */
  age: string;
  branch?: string;
  /** Another machine's name when the session does not run on this Mac. */
  machine?: string;
  pinned?: boolean;
}

export interface Project {
  id: string;
  name: string;
  open: boolean;
  sessions: Session[];
}

export const projects: Project[] = [
  {
    id: 'atlas',
    name: 'atlas-api',
    open: true,
    sessions: [
      { id: 's1', title: 'Rate limiter rewrite', state: 'running', line: 'Running the integration suite', age: 'now', branch: 'feat/token-bucket' },
      { id: 's2', title: 'Fix flaky upload test', state: 'approval', line: 'Wants to push fix/upload-retry', age: '8m', branch: 'fix/upload-retry' },
      { id: 's3', title: 'Billing webhook audit', state: 'question', line: 'Which events should retry?', age: '14m' },
      { id: 's4', title: 'Trim the Docker image', state: 'unread', line: 'Image is 212 MB smaller', age: '1h', branch: 'chore/slim-image' },
    ],
  },
  {
    id: 'field',
    name: 'field-notes',
    open: true,
    sessions: [
      { id: 's5', title: 'Offline sync design', state: 'plan', line: 'Plan is ready for review', age: '26m', machine: 'studio' },
      { id: 's6', title: 'Map tile caching', state: 'idle', line: 'Merged in pull request 48', age: '3h' },
      { id: 's7', title: 'Onboarding copy pass', state: 'idle', line: 'Seven screens reworded', age: '1d' },
    ],
  },
  { id: 'kiln', name: 'kiln', open: false, sessions: [{ id: 's8', title: 'Glaze recipe importer', state: 'idle', line: 'Imports 1,204 recipes', age: '2d' }] },
  { id: 'dotfiles', name: 'dotfiles', open: false, sessions: [] },
];

export const pinned: Session[] = [
  { id: 'p1', title: 'Weekly release notes', state: 'idle', line: 'Draft for the week of 9 November', age: '2d', pinned: true },
];

/** The destinations at the top of the sidebar. */
export const destinations = [
  { id: 'new', label: 'New chat', icon: 'compose', shortcut: '⌘N' },
  { id: 'overview', label: 'Overview', icon: 'grid', shortcut: '⌘0' },
  { id: 'artifacts', label: 'Artifacts', icon: 'shapes' },
  { id: 'customize', label: 'Customize', icon: 'sliders' },
] as const;

/** Open tabs of the window. The first is the session on screen. */
export const tabs = [
  { id: 's1', title: 'Rate limiter rewrite', kind: 'session', state: 'running' as SessionState, active: true },
  { id: 'f1', title: 'bucket.ts', kind: 'file' },
  { id: 's2', title: 'Fix flaky upload test', kind: 'session', state: 'approval' as SessionState },
  { id: 's5', title: 'Offline sync design', kind: 'session', state: 'plan' as SessionState },
];

export type TranscriptItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; paragraphs: string[] }
  | { kind: 'thought'; seconds: number; summary: string }
  /** A folded run of tool calls: one line when closed, the calls when open. */
  | { kind: 'tools'; summary: string; seconds: number; calls: ToolCall[] }
  | { kind: 'edit'; file: string; added: number; removed: number; lines: DiffLine[] }
  | { kind: 'running'; command: string; seconds: number; tail: string[] }
  | { kind: 'agents'; names: string[]; line: string };

export interface ToolCall {
  tool: 'Read' | 'Grep' | 'Bash' | 'Edit' | 'Write';
  target: string;
  detail?: string;
}

export interface DiffLine {
  sign: ' ' | '+' | '-';
  text: string;
}

/** The session on screen: "Rate limiter rewrite" in atlas-api. */
export const transcript: TranscriptItem[] = [
  { kind: 'user', text: 'The fixed-window limiter lets bursts through at the window edge. Replace it with a token bucket, keep the Redis keys compatible, and prove it with the integration suite.' },
  { kind: 'thought', seconds: 9, summary: 'Checked how the current limiter stores its counters' },
  {
    kind: 'tools',
    summary: 'Read 6 files, searched 3 times',
    seconds: 41,
    calls: [
      { tool: 'Read', target: 'src/limits/window.ts' },
      { tool: 'Read', target: 'src/limits/keys.ts' },
      { tool: 'Grep', target: 'limitFor(', detail: '14 matches in 9 files' },
      { tool: 'Read', target: 'test/limits/window.test.ts' },
      { tool: 'Bash', target: 'redis-cli --scan --pattern "rl:*" | head', detail: '5 keys' },
    ],
  },
  {
    kind: 'assistant',
    paragraphs: [
      'The fixed window resets every minute, so a client can spend a full quota in the last second of one window and again in the first second of the next. A token bucket removes that edge: each key holds a token count and the time it was last filled, and a request spends one token after the bucket is topped up for the time that passed.',
      'The key names stay the same. The value changes from a counter to a two-field hash, so I read both shapes for one release and write only the new one.',
    ],
  },
  {
    kind: 'edit',
    file: 'src/limits/bucket.ts',
    added: 48,
    removed: 0,
    lines: [
      { sign: '+', text: 'export async function take(key: string, rule: Rule, now = Date.now()) {' },
      { sign: '+', text: '  const { tokens, filledAt } = await readBucket(key, rule);' },
      { sign: '+', text: '  const refill = ((now - filledAt) / 1000) * rule.perSecond;' },
      { sign: '+', text: '  const next = Math.min(rule.burst, tokens + refill) - 1;' },
      { sign: '+', text: '  if (next < 0) return { allowed: false, retryAfter: -next / rule.perSecond };' },
      { sign: '+', text: '  await writeBucket(key, { tokens: next, filledAt: now }, rule.ttl);' },
      { sign: '+', text: '  return { allowed: true, remaining: Math.floor(next) };' },
      { sign: '+', text: '}' },
    ],
  },
  { kind: 'tools', summary: 'Edited 3 files, ran 2 commands', seconds: 58, calls: [
      { tool: 'Edit', target: 'src/limits/index.ts', detail: '+6 −11' },
      { tool: 'Edit', target: 'src/limits/keys.ts', detail: '+9 −2' },
      { tool: 'Write', target: 'test/limits/bucket.test.ts', detail: '+132' },
      { tool: 'Bash', target: 'pnpm vitest run test/limits', detail: '31 passed' },
      { tool: 'Bash', target: 'pnpm tsc --noEmit', detail: 'no errors' },
    ] },
  { kind: 'user', text: 'Good. Also check what happens to keys written by the old code during the rollout.' },
  { kind: 'agents', names: ['Key migration check', 'Load profile'], line: 'started working' },
  { kind: 'assistant', paragraphs: ['Unit tests pass. I am running the integration suite against a local Redis now; it replays the burst pattern from the incident on 3 November.'] },
  { kind: 'running', command: 'pnpm test:integration --grep limiter', seconds: 73, tail: ['✓ refills at the configured rate (412 ms)', '✓ reads a fixed-window counter written before the change (38 ms)', '◌ holds a burst of 200 requests to the bucket size'] },
];

/** What the composer shows around the text field. */
export const composer = {
  placeholder: 'Reply, or ask for a change',
  queued: 'also add a metric for rejected requests',
  model: 'Opus 5.5',
  effort: 'High',
  mode: 'Auto',
  folder: 'atlas-api',
  branch: 'feat/token-bucket',
  context: 0.41, // share of the context window in use
};

/** The approval the session "Fix flaky upload test" waits on. */
export const approval = {
  session: 'Fix flaky upload test',
  title: 'Push the upload retry fix',
  command: 'git push origin fix/upload-retry',
  why: 'Sends 2 local commits to the remote repository.',
  waited: '8m',
};

/** The side column beside the transcript. */
export const overview = {
  branch: 'feat/token-bucket',
  added: 195,
  removed: 13,
  files: [
    { path: 'src/limits/bucket.ts', added: 48, removed: 0 },
    { path: 'src/limits/index.ts', added: 6, removed: 11 },
    { path: 'src/limits/keys.ts', added: 9, removed: 2 },
    { path: 'test/limits/bucket.test.ts', added: 132, removed: 0 },
  ],
  pullRequest: null as null | { number: number; title: string },
  agents: [
    { name: 'Key migration check', state: 'running' as const, line: 'Reading keys.ts' },
    { name: 'Load profile', state: 'running' as const, line: 'Replaying 3 November traffic' },
    { name: 'Changelog entry', state: 'done' as const, line: 'Wrote 4 lines' },
  ],
  background: [{ label: 'pnpm test:integration', line: '1m 13s' }],
  todos: [
    { text: 'Replace the fixed window with a token bucket', done: true },
    { text: 'Read both key shapes for one release', done: true },
    { text: 'Run the integration suite', done: false, current: true },
    { text: 'Add a metric for rejected requests', done: false },
  ],
};

// ---- Settings -------------------------------------------------------------------------------------------------
// `help` is the explanation the app prints under a setting today. An experiment decides how much of it is on
// screen at rest, how much appears on hover or on expanding, and how much is cut.

export type SettingControl =
  | { type: 'switch'; on: boolean }
  | { type: 'segmented'; options: string[]; value: string }
  | { type: 'select'; options: string[]; value: string }
  | { type: 'text'; value: string; placeholder?: string; mono?: boolean }
  | { type: 'path'; value: string; badge?: string; action?: string }
  | { type: 'button'; label: string }
  | { type: 'checks'; items: { label: string; on: boolean; note?: string }[] }
  | { type: 'switches'; items: { label: string; on: boolean }[] };

export interface Setting {
  label: string;
  control: SettingControl;
  help?: string;
}

export interface SettingsSection {
  id: string;
  title: string;
  settings: Setting[];
}

export const settingsSections: SettingsSection[] = [
  {
    id: 'engine',
    title: 'Engine',
    settings: [
      { label: 'Claude Code', control: { type: 'path', value: '~/.local/share/claude/versions/2.1.319', badge: '2.1.319', action: 'Change…' }, help: 'New sessions start on your installed Claude Code, found again at every launch. Running sessions keep the version they started on.' },
      { label: 'Update', control: { type: 'button', label: 'Update Claude Code…' }, help: 'Runs the update in a terminal tab. New sessions start on the new version; running sessions keep theirs.' },
      { label: 'Config folder', control: { type: 'path', value: '~/.claude', badge: 'read-only' }, help: 'Claude Code owns transcripts, settings and trust. The app reads them and keeps its own index elsewhere.' },
      { label: 'Plugins in sessions', control: { type: 'switches', items: [
          { label: 'ci-kit', on: true }, { label: 'designer', on: true }, { label: 'devcloud', on: true }, { label: 'eli5', on: true }, { label: 'exa-deep-research', on: false }, { label: 'ptc', on: true },
        ] }, help: 'The plugins your Claude Code settings turn on. Switch one off to keep it out of the sessions this app starts; your own settings files are never changed.' },
      { label: 'Hooks in sessions', control: { type: 'segmented', options: ['Yours', 'None'], value: 'Yours' }, help: 'None turns off every hook from your settings and your plugins in this app\'s sessions. A change applies at a session\'s next launch.' },
      { label: 'MCP servers', control: { type: 'text', value: '', placeholder: 'https://…/mcp', mono: true }, help: 'Loaded by every session this app starts, never by a terminal session.' },
    ],
  },
  {
    id: 'appearance',
    title: 'Appearance',
    settings: [
      { label: 'Theme', control: { type: 'segmented', options: ['Light', 'Dark', 'System'], value: 'System' } },
      { label: 'Transcript width', control: { type: 'segmented', options: ['Narrow', 'Medium', 'Wide'], value: 'Narrow' }, help: 'Maximum width of the transcript and composer columns.' },
      { label: 'Monospace font', control: { type: 'text', value: '', placeholder: 'SF Mono' }, help: 'Name a Nerd Font to draw prompt glyphs in the terminal.' },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    settings: [
      { label: 'Messages to you', control: { type: 'switch', on: true }, help: 'Agents send you messages and ask questions you answer in place, and a session reads as their report.' },
      { label: 'When a session finishes or needs you', control: { type: 'switch', on: true }, help: 'Only when you are not looking at that session.' },
      { label: 'Notify for', control: { type: 'checks', items: [
          { label: 'Turn finished', on: true }, { label: 'Approvals', on: true }, { label: 'Questions', on: true }, { label: 'Plan reviews', on: true }, { label: 'Errors', on: true }, { label: 'Must-read messages', on: true },
        ] } },
      { label: 'Sound', control: { type: 'switch', on: false } },
    ],
  },
  {
    id: 'sessions',
    title: 'Sessions',
    settings: [
      { label: 'Archive sessions inactive for', control: { type: 'select', options: ['Never', '3 days', '1 week', '1 month'], value: 'Never' }, help: 'Pinned, running and waiting sessions stay, as do worktrees with uncommitted changes. Archived sessions can be restored from the sidebar.' },
    ],
  },
  {
    id: 'browser',
    title: 'Browser',
    settings: [
      { label: 'Profile', control: { type: 'select', options: ['Personal', 'Work'], value: 'Personal' }, help: 'Applies to tabs opened from now on.' },
      { label: 'Bookmarks bar', control: { type: 'switch', on: true }, help: 'An imported profile\'s bookmarks, under the address bar.' },
      { label: 'Search engine', control: { type: 'text', value: 'https://www.google.com/search?q=%s', mono: true }, help: 'Use %s for the search text.' },
      { label: 'Links that open a new window', control: { type: 'segmented', options: ['In the app', 'In the system browser'], value: 'In the app' } },
    ],
  },
];

export const settingsNav = ['Engine', 'Gateway', 'Keyboard', 'Voice', 'Appearance', 'Notifications', 'Sessions', 'Browser', 'Artifacts', 'Org'];

/** Usage, as the sidebar footer shows it. */
export const usage = { fiveHour: 0.74, week: 0.82, resetsIn: '2h 37m' };
