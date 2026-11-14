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

// ---- What two waiting sessions wait on ----------------------------------------------------------------------------
// Invented, like everything above. An experiment decides where each is answered and how much of it shows at rest.

/** One choice the agent offers: a short label, and the sentence that says what choosing it means. */
export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  ask: string;
  /** More than one option may be chosen. */
  multi: boolean;
  options: QuestionOption[];
}

/** What "Billing webhook audit" asked. The person may always answer in their own words instead of choosing. */
export const question = {
  session: 'Billing webhook audit',
  waited: '14m',
  questions: [
    {
      ask: 'Which events should retry?',
      multi: true,
      options: [
        { label: 'Failed payments', description: 'The customer may fix the card, so a later try can succeed.' },
        { label: 'Plan changes', description: 'Safe to repeat: the handler writes the same row each time.' },
        { label: 'Refunds', description: 'Not safe to repeat without a check: money could move twice.' },
      ],
    },
    {
      ask: 'How long should a retry keep trying?',
      multi: false,
      options: [
        { label: 'One day', description: 'Five tries with growing gaps. Covers a short outage.' },
        { label: 'Three days', description: 'The same window the payment provider uses for its own.' },
      ],
    },
  ] as Question[],
};

/** The plan "Offline sync design" wants approved before it acts. The person approves it, or sends it back with a comment. */
export const plan = {
  session: 'Offline sync design',
  title: 'Offline sync for notes',
  waited: '26m',
  paragraphs: [
    'Every edit goes to a queue on the device first and is sent when the connection returns. Each note carries a version, so a stale edit can be told from a fresh one.',
    'Two people editing one note offline is the hard case. Both edits are kept and the second writer is asked to choose; nothing is merged silently.',
  ],
  steps: [
    'Write every edit to a queue on the device',
    'Send the queue in order when the connection returns',
    'Give each note a version and refuse stale writes',
    'Show both versions when two edits collide',
    'Cover the queue and the collision with tests',
  ],
  /** What a person might write when sending it back. */
  comment: 'Leave collisions for a second pass. Ship the queue first.',
};

// ---- The three sessions that wait, as they read when opened -----------------------------------------------------
// Invented. Each holds enough of its own transcript for what it waits on to stand where it would really stand; what
// it waits on is `approval`, `question` and `plan` above.

export const sessionTranscripts: Record<string, TranscriptItem[]> = {
  // "Fix flaky upload test": wants to push.
  s2: [
    { kind: 'user', text: 'The upload test fails about one run in twenty on CI and never on my machine. Find out why and fix it.' },
    { kind: 'thought', seconds: 6, summary: 'Looked for what differs between a slow runner and a fast one' },
    {
      kind: 'tools',
      summary: 'Read 4 files, ran the test 20 times',
      seconds: 96,
      calls: [
        { tool: 'Read', target: 'test/upload/large-file.test.ts' },
        { tool: 'Read', target: 'src/upload/client.ts' },
        { tool: 'Grep', target: 'waitForConfirm', detail: 'no matches' },
        { tool: 'Bash', target: 'pnpm vitest run test/upload --repeat 20', detail: '1 of 20 failed' },
      ],
    },
    {
      kind: 'assistant',
      paragraphs: [
        'The test uploads a 5 MB file and asserts as soon as the request returns, but the storage client confirms the write a moment later. On a slow runner the assertion wins that race.',
        'The client now waits for the confirmation and tries once more if it times out. The same test ran 200 times without a failure.',
      ],
    },
    {
      kind: 'edit',
      file: 'src/upload/client.ts',
      added: 6,
      removed: 2,
      lines: [
        { sign: ' ', text: 'export async function upload(file: Blob, to: string) {' },
        { sign: '-', text: '  const res = await put(to, file);' },
        { sign: '-', text: '  return res.id;' },
        { sign: '+', text: '  const res = await put(to, file);' },
        { sign: '+', text: '  const done = await confirmed(res.id, { within: 4000 });' },
        { sign: '+', text: '  if (!done) return upload(file, to);' },
        { sign: '+', text: '  return res.id;' },
        { sign: ' ', text: '}' },
      ],
    },
    {
      kind: 'tools',
      summary: 'Ran 2 commands',
      seconds: 212,
      calls: [
        { tool: 'Bash', target: 'pnpm vitest run test/upload --repeat 200', detail: '200 passed' },
        { tool: 'Bash', target: 'git commit -am "Wait for the storage confirmation"', detail: '2 commits ahead' },
      ],
    },
    { kind: 'assistant', paragraphs: ['Both commits are local. Pushing the branch opens it for review.'] },
  ],
  // "Billing webhook audit": asked a question.
  s3: [
    { kind: 'user', text: 'Audit the billing webhooks. Which events do we handle, and what happens when a handler fails?' },
    {
      kind: 'tools',
      summary: 'Read 9 files, searched 5 times',
      seconds: 74,
      calls: [
        { tool: 'Grep', target: 'on("invoice.', detail: '4 matches in 2 files' },
        { tool: 'Read', target: 'src/billing/webhooks.ts' },
        { tool: 'Read', target: 'src/billing/handlers/refund.ts' },
        { tool: 'Grep', target: 'catch (', detail: '11 matches in 6 files' },
      ],
    },
    {
      kind: 'assistant',
      paragraphs: [
        'Seven events are handled. None of them is retried: a handler that throws is logged and the event is gone, although the payment provider would send it again if we answered with an error.',
        'Retrying is only safe where a handler can run twice without harm, so before I add it I need two decisions from you.',
      ],
    },
  ],
  // "Offline sync design": a plan waits. The plan itself is `plan`; the transcript ends with it.
  s5: [
    { kind: 'user', text: 'Design offline sync for notes. Give me a plan first; do not write code yet.' },
    { kind: 'thought', seconds: 14, summary: 'Weighed merging text against keeping both edits' },
    {
      kind: 'tools',
      summary: 'Read 12 files, searched 4 times',
      seconds: 118,
      calls: [
        { tool: 'Read', target: 'app/notes/store.ts' },
        { tool: 'Read', target: 'app/notes/editor.tsx' },
        { tool: 'Grep', target: 'updatedAt', detail: '23 matches in 8 files' },
        { tool: 'Read', target: 'server/notes/routes.ts' },
      ],
    },
  ],
};

/** The side column of each waiting session: only what that session has. */
export const sessionOverviews: Record<string, Pick<typeof overview, 'branch' | 'added' | 'removed' | 'files' | 'agents' | 'background' | 'todos'>> = {
  s2: {
    branch: 'fix/upload-retry',
    added: 15,
    removed: 3,
    files: [
      { path: 'src/upload/client.ts', added: 6, removed: 2 },
      { path: 'test/upload/large-file.test.ts', added: 9, removed: 1 },
    ],
    agents: [],
    background: [],
    todos: [
      { text: 'Find why the upload test fails on CI', done: true },
      { text: 'Wait for the storage confirmation', done: true },
      { text: 'Push the branch', done: false, current: true },
    ],
  },
  s3: {
    branch: '',
    added: 0,
    removed: 0,
    files: [],
    agents: [],
    background: [],
    todos: [
      { text: 'List the events that are handled', done: true },
      { text: 'Find what happens when a handler fails', done: true },
      { text: 'Add retries where they are safe', done: false },
    ],
  },
  s5: {
    branch: '',
    added: 0,
    removed: 0,
    files: [],
    agents: [],
    background: [],
    // Until the plan is approved its steps are not a to-do list; what the session has done so far is.
    todos: [
      { text: 'Read how notes are stored and edited', done: true },
      { text: 'Decide what happens when two edits meet', done: true },
      { text: 'Agree the plan', done: false, current: true },
    ],
  },
};

// ---- The Overview: every live or unread session, across projects ---------------------------------------------------
// Invented. The four projects above with more sessions in the ones the pane keeps closed, and two more projects. The
// pane's open projects read exactly as they do in `projects`; only what was folded away has grown.

const more: Record<string, Session[]> = {
  kiln: [
    { id: 's9', title: 'Firing schedule export', state: 'running', line: 'Writing the CSV exporter', age: '4m', branch: 'feat/schedule-export' },
    { id: 's10', title: 'Kiln log parser', state: 'unread', line: 'Parses all three controller formats', age: '35m' },
  ],
  dotfiles: [{ id: 's11', title: 'Zsh startup time', state: 'unread', line: 'Startup is down from 410 ms to 95 ms', age: '2h' }],
};

export const fleet: Project[] = [
  ...projects.map((p) => ({ ...p, sessions: [...p.sessions, ...(more[p.id] ?? [])] })),
  {
    id: 'press',
    name: 'press-site',
    open: false,
    sessions: [
      { id: 's12', title: 'Image pipeline', state: 'running', line: 'Resizing 318 photographs', age: '12m', branch: 'feat/responsive-images', machine: 'studio' },
      { id: 's13', title: 'Dark mode pass', state: 'running', line: 'Checking contrast on the article page', age: '2m' },
      { id: 's14', title: 'RSS feed', state: 'unread', line: 'The feed validates, with 42 entries', age: '50m' },
      { id: 's15', title: 'Broken link sweep', state: 'idle', line: 'Fixed 17 links', age: '5h' },
      { id: 's16', title: 'Contact form spam', state: 'running', line: 'Reading last month\'s submissions', age: '1m' },
    ],
  },
  {
    id: 'ledger',
    name: 'ledger',
    open: false,
    sessions: [
      { id: 's17', title: 'Invoice layout', state: 'running', line: 'Rendering 12 sample invoices', age: '6m', machine: 'studio' },
      { id: 's18', title: 'Currency rounding', state: 'running', line: 'Running the property tests', age: '9m', branch: 'fix/half-even' },
      { id: 's19', title: 'Year-end export', state: 'idle', line: 'Exported 2,318 entries', age: '1d' },
      { id: 's20', title: 'Bank feed import', state: 'idle', line: 'Matched 96% of the rows', age: '6h' },
    ],
  },
];

// ---- Files, whole ---------------------------------------------------------------------------------------------------
// Invented. A file a session changed, as it reads now, with what the session did to it: every line of the file, and
// the lines that were taken out where they stood. The first character of a line is its sign. The counts agree with
// `overview.files` and `sessionOverviews`; the passages a transcript shows are passages of these.

export interface FileBody {
  path: string;
  /** The session that changed it. */
  session: string;
  lines: DiffLine[];
}

const whole = (text: string): DiffLine[] =>
  text
    .split('\n')
    .slice(1, -1)
    .map((l) => ({ sign: (l[0] ?? ' ') as DiffLine['sign'], text: l.slice(1) }));

export const fileBodies: FileBody[] = [
  {
    path: 'src/limits/bucket.ts',
    session: 's1',
    lines: whole(`
+// A token bucket per key. Tokens come back at a steady rate up to a burst
+// size, and a request spends one. The bucket lives in Redis as a hash.
+import { redis } from '../redis';
+import { shapeOf } from './keys';
+import type { Rule } from './rules';
+
+/** What a bucket holds between two requests. */
+export interface Bucket {
+  tokens: number;
+  filledAt: number;
+}
+
+const FIELDS = ['tokens', 'filledAt'] as const;
+
+/** A key that was never written is a full bucket. */
+function fresh(rule: Rule, now: number): Bucket {
+  return { tokens: rule.burst, filledAt: now };
+}
+
+/** What a fixed-window counter is worth: the quota it had not yet spent. */
+async function fromCounter(key: string, rule: Rule, now: number) {
+  const spent = Number(await redis.get(key));
+  return { tokens: Math.max(0, rule.burst - spent), filledAt: now };
+}
+
+export async function readBucket(key: string, rule: Rule): Promise<Bucket> {
+  const now = Date.now();
+  if ((await shapeOf(key)) === 'counter') return fromCounter(key, rule, now);
+  const [tokens, filledAt] = await redis.hmget(key, ...FIELDS);
+  if (tokens === null || filledAt === null) return fresh(rule, now);
+  return { tokens: Number(tokens), filledAt: Number(filledAt) };
+}
+
+export async function writeBucket(key: string, bucket: Bucket, ttl: number) {
+  await redis.multi().del(key).hset(key, bucket).expire(key, ttl).exec();
+}
+
+export async function take(key: string, rule: Rule, now = Date.now()) {
+  const { tokens, filledAt } = await readBucket(key, rule);
+  const refill = ((now - filledAt) / 1000) * rule.perSecond;
+  const next = Math.min(rule.burst, tokens + refill) - 1;
+  if (next < 0) return { allowed: false, retryAfter: -next / rule.perSecond };
+  await writeBucket(key, { tokens: next, filledAt: now }, rule.ttl);
+  return { allowed: true, remaining: Math.floor(next) };
+}
+
+/** Seconds until one token is back, for the Retry-After header. */
+export const waitFor = (rule: Rule) => Math.ceil(1 / rule.perSecond);
`),
  },
  {
    path: 'src/limits/keys.ts',
    session: 's1',
    lines: whole(`
 // Names of the Redis keys the limiter writes. A name never changes: during a
 // rollout old and new code read the same keys at once.
 import { createHash } from 'node:crypto';
-import { scanPage } from '../redis';
+import { redis, scanPage } from '../redis';
 
 const PREFIX = 'rl';
-export const WINDOW_SECONDS = 60;
 
 /** Who is calling: an API key when there is one, else the address. */
 export interface Caller {
   apiKey?: string;
   address: string;
 }
 
+/** A key written before the token bucket holds a counter; after it, a hash. */
+export type Shape = 'counter' | 'bucket' | 'none';
+
 function digest(value: string): string {
   return createHash('sha256').update(value).digest('hex').slice(0, 16);
 }
 
 export function callerId(caller: Caller): string {
   if (caller.apiKey) return 'k:' + digest(caller.apiKey);
   return 'a:' + caller.address;
 }
 
 /** Routes that differ only by an id share one limit. */
 export function normalise(route: string): string {
   return route
     .toLowerCase()
     .replace(/\\/\\d+(?=\\/|$)/g, '/:id')
     .replace(/\\/+$/, '');
 }
 
 /** rl:<route>:<caller>, the name every limiter uses. */
 export function keyFor(route: string, caller: Caller): string {
   return [PREFIX, normalise(route), callerId(caller)].join(':');
 }
 
 /** Every key of one caller, for the admin page that clears a limit. */
 export function patternFor(caller: Caller): string {
   return [PREFIX, '*', callerId(caller)].join(':');
 }
 
 export function parse(key: string): { route: string; caller: string } | null {
   const [prefix, route, ...caller] = key.split(':');
   if (prefix !== PREFIX || !route || caller.length === 0) return null;
   return { route, caller: caller.join(':') };
 }
 
+export async function shapeOf(key: string): Promise<Shape> {
+  const type = await redis.type(key);
+  return type === 'string' ? 'counter' : type === 'hash' ? 'bucket' : 'none';
+}
+
 /** Keys are listed in pages, so a scan never holds Redis for long. */
 export async function* scan(pattern: string, page = 200) {
   let cursor = '0';
   do {
     const [next, keys] = await scanPage(cursor, pattern, page);
     cursor = next;
     yield* keys;
   } while (cursor !== '0');
 }
`),
  },
  {
    path: 'src/limits/index.ts',
    session: 's1',
    lines: whole(`
 // The limiter as the routes see it: one call per request.
 import type { Request } from '../http';
-import { keyFor, WINDOW_SECONDS } from './keys';
-import { redis } from '../redis';
+import { take } from './bucket';
+import { keyFor } from './keys';
 import { ruleFor } from './rules';
 
 export interface Verdict {
   allowed: boolean;
   /** Seconds to wait, when the request is refused. */
   retryAfter?: number;
 }
 
 export async function limitFor(req: Request): Promise<Verdict> {
   const rule = ruleFor(req.route);
   if (!rule) return { allowed: true };
   const key = keyFor(req.route, req.caller);
-  const count = await redis.incr(key);
-  if (count === 1) await redis.expire(key, WINDOW_SECONDS);
-  if (count <= rule.perMinute) return { allowed: true };
-  const left = await redis.ttl(key);
-  return { allowed: false, retryAfter: Math.max(1, left) };
+  // One token a request; the bucket fills again between them.
+  const { allowed, retryAfter } = await take(key, rule);
+  if (allowed) return { allowed };
+  return { allowed, retryAfter: Math.ceil(retryAfter ?? 1) };
 }
 
-export async function usedBy(req: Request): Promise<number> {
-  return Number(await redis.get(keyFor(req.route, req.caller))) || 0;
-}
-
 
 export { ruleFor } from './rules';
`),
  },
  {
    path: 'src/upload/client.ts',
    session: 's2',
    lines: whole(`
 // Uploads a file to storage and answers with its id.
 import { put } from './storage';
+import { confirmed } from './storage';
 
 const LIMIT = 50 * 1024 * 1024;
 
 export class TooLarge extends Error {
   constructor(readonly size: number) {
     super('file is larger than the upload limit');
   }
 }
 
 export function check(file: Blob) {
   if (file.size > LIMIT) throw new TooLarge(file.size);
 }
 
+/** Storage confirms a write a moment after the request returns. */
 export async function upload(file: Blob, to: string) {
-  const res = await put(to, file);
-  return res.id;
+  const res = await put(to, file);
+  const done = await confirmed(res.id, { within: 4000 });
+  if (!done) return upload(file, to);
+  return res.id;
 }
 
 export async function uploadAll(files: Blob[], to: string) {
   const ids: string[] = [];
   for (const file of files) {
     check(file);
     ids.push(await upload(file, to));
   }
   return ids;
 }
`),
  },
];
