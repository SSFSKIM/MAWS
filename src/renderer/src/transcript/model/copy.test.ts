import type { BrowserActivity } from '@shared/browser/activity'; // E13
import { describe, expect, it } from 'vitest';
import type { CellId, ToolCategory } from './rows';
import {
  activeGroupLabel, boundaryCopy, cellLabel, dividerCopy, groupSummary, liveThinkingLabel, plural, subagentSentence, thinkingLabel, thinkingTier, thinkingWarmth, turnSummaryCopy, type GroupPhraseInput,
} from './copy';
import { browserActivityLine } from './copy'; // E13

const cell = (id: string) => id as CellId;

describe('divider and summary copy', () => {
  it('reads Working under a second and Working for {t} after', () => {
    expect(dividerCopy({ state: 'working', origin: 'human', durationMs: 400, toolCalls: 0, denied: 0, autoDenied: 0 })).toBe('Working');
    expect(dividerCopy({ state: 'working', origin: 'human', durationMs: 134_000, toolCalls: 3, denied: 0, autoDenied: 0 })).toBe('Working for 2m 14s');
  });

  it('reads Worked, Continued, You stopped and Failed with the tool-call count, pluralised, omitted at zero', () => {
    expect(dividerCopy({ state: 'completed', origin: 'human', durationMs: 134_000, toolCalls: 12, denied: 0, autoDenied: 0 })).toBe('Worked for 2m 14s · 12 tool calls');
    expect(dividerCopy({ state: 'completed', origin: 'human', durationMs: 5_000, toolCalls: 1, denied: 0, autoDenied: 0 })).toBe('Worked for 5s · 1 tool call');
    expect(dividerCopy({ state: 'completed', origin: 'human', durationMs: 5_000, toolCalls: 0, denied: 0, autoDenied: 0 })).toBe('Worked for 5s');
    expect(dividerCopy({ state: 'completed', origin: 'engine', durationMs: 5_000, toolCalls: 2, denied: 0, autoDenied: 0 })).toBe('Continued for 5s · 2 tool calls');
    expect(dividerCopy({ state: 'stopped', origin: 'human', durationMs: 5_000, toolCalls: 4, denied: 0, autoDenied: 0 })).toBe('You stopped after 5s · 4 tool calls');
    expect(dividerCopy({ state: 'failed', origin: 'human', durationMs: 5_000, toolCalls: 1, denied: 0, autoDenied: 0 })).toBe('Failed after 5s · 1 tool call');
  });

  // E11 (W-C): a turn its engine process ended (a crash, or a supervisor's death) is not the reader's stop
  it('reads a crash-closed turn in the engine’s words, and keeps You stopped for a stop', () => {
    expect(dividerCopy({ state: 'stopped', cause: 'crash', origin: 'human', durationMs: 5_000, toolCalls: 4, denied: 0, autoDenied: 0 })).toBe('Stopped after 5s (engine process exited) · 4 tool calls');
    expect(dividerCopy({ state: 'stopped', cause: null, origin: 'human', durationMs: 5_000, toolCalls: 0, denied: 0, autoDenied: 0 })).toBe('You stopped after 5s');
    expect(turnSummaryCopy({ state: 'stopped', cause: 'crash', origin: 'human', durationMs: 5_000, toolCalls: 0, model: 'haiku', phrases: '', denied: [], safeguard: { reviewed: 0, flagged: 0, notEvaluated: 0 }, costUsd: null, tokens: null, childAgents: 0 })).toBe('Stopped after 5s (engine process exited) on haiku');
  });

  it('suffixes the denied and auto-denied counts', () => {
    expect(dividerCopy({ state: 'completed', origin: 'human', durationMs: 134_000, toolCalls: 12, denied: 1, autoDenied: 0 })).toBe('Worked for 2m 14s · 12 tool calls · 1 denied');
    expect(dividerCopy({ state: 'completed', origin: 'human', durationMs: 134_000, toolCalls: 12, denied: 1, autoDenied: 2 })).toBe('Worked for 2m 14s · 12 tool calls · 1 denied · 2 auto-denied');
  });

  it('composes the summary popover, omitting zero and unknown segments', () => {
    const summary = turnSummaryCopy({
      state: 'completed', origin: 'human', durationMs: 134_000, model: 'claude-opus-5-5', toolCalls: 12, phrases: 'Edited 3 files, ran 2 commands',
      denied: [{ kind: 'permission-rule' }], safeguard: { reviewed: 4, flagged: 1, notEvaluated: 8 }, costUsd: 0.1234, tokens: 12_345, childAgents: 2,
    });
    expect(summary).toBe('Worked for 2m 14s on claude-opus-5-5 · 12 tool calls: Edited 3 files, ran 2 commands · 1 denied (permission-rule) · Auto mode reviewed 4 actions, 1 flagged · $0.12 · 12,345 tokens · 2 subagents');
    expect(turnSummaryCopy({ state: 'completed', origin: 'engine', durationMs: 5_000, model: null, toolCalls: 0, phrases: '', denied: [], safeguard: { reviewed: 0, flagged: 0, notEvaluated: 0 }, costUsd: null, tokens: null, childAgents: 0 }))
      .toBe('Continued for 5s');
  });
});

describe('group phrases', () => {
  const input = (partial: Partial<GroupPhraseInput>): GroupPhraseInput => ({
    mcpServers: [], skills: [], toolsLoaded: 0, editedFiles: [], readFiles: [], searches: [], commands: [], webQueries: [], fetchedHosts: [], other: 0, ...partial,
  });

  it('phrases in category order, joined by commas, first letter capitalised', () => {
    expect(groupSummary(input({ editedFiles: ['a.ts', 'b.ts', 'c.ts'], commands: ['pnpm test', 'pnpm lint'] }))).toBe('Edited 3 files, ran 2 commands');
    expect(groupSummary(input({ readFiles: ['src/a.ts', 'src/b.ts'], searches: ['useSidebarDrag'], mcpServers: ['docs'] }))).toBe('Used docs, read 2 files, searched for `useSidebarDrag`');
  });

  it('names a single file, command, host or skill', () => {
    expect(groupSummary(input({ editedFiles: ['src/useSidebarDrag.ts'] }))).toBe('Edited useSidebarDrag.ts');
    expect(groupSummary(input({ readFiles: ['src/app.ts'] }))).toBe('Read app.ts');
    expect(groupSummary(input({ commands: ['pnpm test'] }))).toBe('Ran `pnpm test`');
    expect(groupSummary(input({ fetchedHosts: ['example.com'] }))).toBe('Fetched example.com');
    expect(groupSummary(input({ fetchedHosts: ['a.com', 'b.com'] }))).toBe('Fetched 2 pages');
    expect(groupSummary(input({ webQueries: ['tanstack virtual chat'] }))).toBe('Searched the web for tanstack virtual chat');
    expect(groupSummary(input({ skills: ['test-driven-development'] }))).toBe('Loaded test-driven-development skill');
    expect(groupSummary(input({ skills: ['a', 'b'] }))).toBe('Loaded 2 skills');
    expect(groupSummary(input({ toolsLoaded: 3 }))).toBe('Loaded 3 tools');
  });

  it('names up to three MCP servers, else counts sources', () => {
    expect(groupSummary(input({ mcpServers: ['a', 'b', 'c'] }))).toBe('Used a, b and c');
    expect(groupSummary(input({ mcpServers: ['a', 'b', 'c', 'd'] }))).toBe('Used 4 sources');
  });

  it('phrases other only when it is the sole category, and falls back to Worked', () => {
    expect(groupSummary(input({ other: 2 }))).toBe('Used 2 tools');
    expect(groupSummary(input({ other: 2, commands: ['ls'] }))).toBe('Ran `ls`');
    expect(groupSummary(input({}))).toBe('Worked');
  });

  it('labels an active group by what is running, else Thinking', () => {
    expect(activeGroupLabel({ toolName: 'Bash', input: { command: 'pnpm test' }, elapsedMs: 3_000 })).toBe('Running `pnpm test` for 3s');
    expect(activeGroupLabel({ toolName: 'Read', input: { file_path: '/x/y.ts' }, elapsedMs: 0 })).toBe('Reading y.ts');
    expect(activeGroupLabel({ toolName: 'Edit', input: { file_path: '/x/y.ts' }, elapsedMs: 0 })).toBe('Editing y.ts');
    expect(activeGroupLabel({ toolName: 'Grep', input: { pattern: 'TODO' }, elapsedMs: 0 })).toBe('Searching for `TODO`');
    expect(activeGroupLabel({ toolName: 'WebFetch', input: { url: 'https://example.com/docs' }, elapsedMs: 0 })).toBe('Fetching example.com');
    expect(activeGroupLabel({ toolName: 'mcp__docs__search', input: {}, elapsedMs: 0 })).toBe('Using docs');
    expect(activeGroupLabel({ toolName: 'Skill', input: { skill: 'tdd' }, elapsedMs: 0 })).toBe('Loading tdd');
    expect(activeGroupLabel(null)).toBe('Thinking');
  });
});

describe('cell lines', () => {
  it('shell states', () => {
    expect(cellLabel({ kind: 'shell', command: 'pnpm test', status: 'done', durationMs: 4_000, background: false })).toBe('Ran `pnpm test` in 4s');
    expect(cellLabel({ kind: 'shell', command: 'pnpm test', status: 'error', durationMs: 4_000, background: false })).toBe('Failed `pnpm test` in 4s');
    expect(cellLabel({ kind: 'shell', command: 'pnpm test', status: 'stopped', durationMs: 4_000, background: false })).toBe('Stopped `pnpm test` after 4s');
    expect(cellLabel({ kind: 'shell', command: 'sleep 30', status: 'running', durationMs: 4_000, background: true })).toBe('Started `sleep 30` in the background');
    expect(cellLabel({ kind: 'shell', command: 'sleep 30', status: 'running', durationMs: 4_000, background: false })).toBe('Running `sleep 30` for 4s');
  });

  it('edit, read and the merged read', () => {
    expect(cellLabel({ kind: 'edit', path: 'src/a.ts', change: 'update', added: 3, removed: 1 })).toBe('Edited src/a.ts +3 −1');
    expect(cellLabel({ kind: 'edit', path: 'src/a.ts', change: 'create', added: 3, removed: 0 })).toBe('Created src/a.ts');
    expect(cellLabel({ kind: 'edit', path: 'src/a.ts', change: 'delete', added: 0, removed: 3 })).toBe('Deleted src/a.ts');
    expect(cellLabel({ kind: 'read', paths: ['src/a.ts'] })).toBe('Read src/a.ts');
    expect(cellLabel({ kind: 'read', paths: ['a', 'b', 'c'] })).toBe('Read 3 files');
  });

  it('denied and stopped lines by disposition', () => {
    expect(cellLabel({ kind: 'denied', subject: 'git push', disposition: 'denied', denialKind: 'user-rejected', reason: 'Not now' })).toBe('Denied: `git push` · Not now');
    expect(cellLabel({ kind: 'denied', subject: 'git push', disposition: 'denied', denialKind: 'permission-rule', reason: null })).toBe('Denied: `git push`');
    expect(cellLabel({ kind: 'denied', subject: 'rm -rf', disposition: 'auto_denied', denialKind: 'automode-blocked', reason: 'destructive' })).toBe('Auto mode blocked: `rm -rf` · destructive');
    expect(cellLabel({ kind: 'denied', subject: 'rm -rf', disposition: 'auto_denied', denialKind: 'automode-parsing-error', reason: 'x' })).toBe('Auto mode blocked: `rm -rf` · review unreadable');
    expect(cellLabel({ kind: 'denied', subject: 'ls', disposition: 'stopped', denialKind: 'user-rejected', reason: 'x' })).toBe('Stopped: `ls`');
    expect(cellLabel({ kind: 'denied', subject: 'ls', disposition: 'stopped', denialKind: 'automode-unavailable', reason: 'x' })).toBe('Stopped: `ls` · auto mode unavailable');
  });

  it('other cells', () => {
    expect(cellLabel({ kind: 'generic', toolName: 'mcp__docs__search', category: 'mcp' as ToolCategory })).toBe('Used docs');
    expect(cellLabel({ kind: 'generic', toolName: 'Skill', category: 'skills', detail: 'tdd' })).toBe('Loaded tdd skill');
    expect(cellLabel({ kind: 'generic', toolName: 'ToolSearch', category: 'skills', detail: '2' })).toBe('Loaded 2 tools');
    expect(cellLabel({ kind: 'generic', toolName: 'Grep', category: 'exploration', detail: 'TODO', scope: 'src' })).toBe('Searched for `TODO` in src');
    expect(cellLabel({ kind: 'generic', toolName: 'WebFetch', category: 'web', detail: 'example.com' })).toBe('Fetched example.com');
    expect(cellLabel({ kind: 'generic', toolName: 'WebSearch', category: 'web', detail: 'q' })).toBe('Searched the web for q');
    expect(cellLabel({ kind: 'generic', toolName: 'EnterPlanMode', category: 'other' })).toBe('Entered plan mode');
    expect(cellLabel({ kind: 'generic', toolName: 'EnterWorktree', category: 'other', detail: '/tmp/wt' })).toBe('Entered worktree /tmp/wt');
    expect(cellLabel({ kind: 'generic', toolName: 'TodoWrite', category: 'other' })).toBe('Used TodoWrite');
  });

  it('thinking', () => {
    expect(thinkingLabel(true, null)).toBe('Thinking');
    expect(thinkingLabel(false, 12_000)).toBe('Thought for 12s');
    expect(thinkingLabel(false, null)).toBe('Thought'); // never streamed: no duration to show
  });

  // W8 (T1): the CLI's tiers at 10, 20, 30 and 45 s, each from its threshold on.
  it('a streaming block’s tier by its elapsed time', () => {
    const at = (seconds: number) => thinkingTier(seconds * 1000);
    expect([0, 9.999, 10, 19.999, 20, 29.999, 30, 44.999, 45, 600].map(at)).toEqual([
      'Thinking', 'Thinking', 'Still thinking', 'Still thinking', 'Thinking more', 'Thinking more', 'Thinking some more', 'Thinking some more', 'Deep in thought', 'Deep in thought',
    ]);
  });

  it('a streaming block’s label names the effort when known and the elapsed time', () => {
    expect(liveThinkingLabel(4_000, 'xhigh')).toBe('Thinking with xhigh effort · 4s');
    expect(liveThinkingLabel(47_500, 'high')).toBe('Deep in thought with high effort · 47s');
    expect(liveThinkingLabel(75_000, null)).toBe('Deep in thought · 1m 15s');
    expect(liveThinkingLabel(12_000, '')).toBe('Still thinking · 12s');
  });

  it('warms to the warning colour between 10 and 20 s, in eighths', () => {
    expect([0, 10_000, 11_250, 12_000, 15_000, 19_000, 20_000, 60_000].map(thinkingWarmth)).toEqual([0, 0, 0.125, 0.25, 0.5, 0.875, 1, 1]);
  });
});

describe('subagent and boundary copy', () => {
  it('grouped sentences', () => {
    expect(subagentSentence(['A'], 'started')).toBe('A started working');
    expect(subagentSentence(['A', 'B'], 'started')).toBe('A and B started working');
    expect(subagentSentence(['A', 'B', 'C'], 'started')).toBe('A, B and C started working');
    expect(subagentSentence(['A', 'B', 'C', 'D', 'E'], 'started')).toBe('A, B and 3 more started working');
    expect(subagentSentence(['A'], 'finished')).toBe('A finished');
    expect(subagentSentence(['A', 'B'], 'finished_with_errors')).toBe('A and B finished with errors');
    expect(subagentSentence(['A'], 'stopped')).toBe('A was stopped');
    expect(subagentSentence(['A'], 'working')).toBe('A started working');
  });

  it('boundaries', () => {
    expect(boundaryCopy({ kind: 'compaction', preTokens: 160_000, postTokens: 24_000, trigger: 'auto', historical: false })).toBe('Context compacted · 160k → 24k tokens · auto');
    expect(boundaryCopy({ kind: 'compaction', preTokens: 160_000, postTokens: 24_000, trigger: 'manual', historical: true })).toBe('Compacted earlier · 160k → 24k');
    expect(boundaryCopy({ kind: 'reset', trigger: 'plan_approved' })).toBe('Conversation reset · after plan approval');
    expect(boundaryCopy({ kind: 'reset', trigger: 'clear' })).toBe('Conversation reset · cleared');
    expect(boundaryCopy({ kind: 'reset', trigger: 'fresh_session' })).toBe('Conversation reset · fresh_session');
    expect(boundaryCopy({ kind: 'retraction', reason: 'transcript_branch', fallbackModel: null })).toBe('Conversation continued from an earlier point');
    expect(boundaryCopy({ kind: 'retraction', reason: 'refusal', fallbackModel: 'claude-sonnet-5' })).toBe('Response retracted · refusal · switched to claude-sonnet-5');
    expect(boundaryCopy({ kind: 'rewind', hiddenRows: 4, revealed: false })).toBe('Rewound to here · 4 messages hidden · Show');
    expect(boundaryCopy({ kind: 'rewind', hiddenRows: 4, revealed: true })).toBe('Rewound to here · 4 messages hidden · Hide');
  });

  it('pluralises', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(3, 'file')).toBe('3 files');
    expect(cell('x')).toBe('x');
  });
});

// E13 (the in-app browser spec of 2026-10-08, "Action rows"): what an agent did through cua, one line per activity, in
// the browser action row's words. Page strings are shown as given (plain text), cut; typed text is only ever a count.
describe('browser activity lines', () => {
  it.each<[string, BrowserActivity, string]>([
    ['navigated', { kind: 'navigated', url: 'https://example.com/form?q=1', title: 'Form' }, 'Navigated to example.com'],
    ['navigated, port', { kind: 'navigated', url: 'http://127.0.0.1:17391/features.html', title: '' }, 'Navigated to 127.0.0.1:17391'],
    ['navigated, not http', { kind: 'navigated', url: 'about:blank', title: '' }, 'Navigated to about:blank'],
    ['navigated, long data url', { kind: 'navigated', url: `data:text/html,${'x'.repeat(100)}`, title: '' }, `Navigated to data:text/html,${'x'.repeat(44)}…`],
    ['clicked', { kind: 'clicked', x: 120, y: 48, label: 'button Submit' }, 'Clicked button Submit'],
    ['clicked, no label', { kind: 'clicked', x: 120.4, y: 47.6, label: null }, 'Clicked at 120, 48'],
    ['typed one', { kind: 'typed', chars: 1 }, 'Typed 1 character'],
    ['typed many', { kind: 'typed', chars: 12 }, 'Typed 12 characters'],
    ['key', { kind: 'key', key: 'Enter' }, 'Pressed Enter'],
    ['screenshot', { kind: 'screenshot' }, 'Screenshot'],
    ['download', { kind: 'download', filename: 'cua-report.pdf', state: 'complete' }, 'Downloaded cua-report.pdf'],
    ['download failed', { kind: 'download', filename: 'cua-report.pdf', state: 'interrupted' }, 'Download failed: cua-report.pdf'],
    ['download cancelled', { kind: 'download', filename: 'cua-report.pdf', state: 'cancelled' }, 'Download cancelled: cua-report.pdf'],
    ['alert', { kind: 'dialog', type: 'alert', excerpt: 'Saved!', answered: 'accepted' }, 'Alert "Saved!" closed'],
    ['alert, default', { kind: 'dialog', type: 'alert', excerpt: 'Saved!', answered: 'default' }, 'Alert "Saved!" answered by default after 30 s'],
    ['confirm accepted', { kind: 'dialog', type: 'confirm', excerpt: 'Delete it?', answered: 'accepted' }, 'Confirm "Delete it?" accepted'],
    ['confirm dismissed', { kind: 'dialog', type: 'confirm', excerpt: 'Delete it?', answered: 'dismissed' }, 'Confirm "Delete it?" dismissed'],
    ['confirm, default', { kind: 'dialog', type: 'confirm', excerpt: 'Delete it?', answered: 'default' }, 'Confirm "Delete it?" answered by default after 30 s'],
    ['confirm, no text, lines folded', { kind: 'dialog', type: 'confirm', excerpt: '', answered: 'accepted' }, 'Confirm accepted'],
    ['dialog, multiline', { kind: 'dialog', type: 'alert', excerpt: 'Line one\n  line two', answered: 'dismissed' }, 'Alert "Line one line two" closed'],
    ['tab opened', { kind: 'tabOpened', url: 'https://example.com/' }, 'Opened a tab at example.com'],
    ['tab opened blank', { kind: 'tabOpened', url: 'about:blank' }, 'Opened a tab'],
    ['tab closed', { kind: 'tabClosed', url: 'https://example.com/a' }, 'Closed the tab at example.com'],
    ['tab closed blank', { kind: 'tabClosed', url: '' }, 'Closed a tab'],
  ])('%s', (_name, activity, expected) => {
    expect(browserActivityLine(activity)).toBe(expected);
  });

  it('cuts a long label', () => {
    expect(browserActivityLine({ kind: 'clicked', x: 0, y: 0, label: `link ${'y'.repeat(35)}` })).toBe(`Clicked link ${'y'.repeat(35)}`);
    expect(browserActivityLine({ kind: 'dialog', type: 'alert', excerpt: 'z'.repeat(200), answered: 'accepted' })).toBe(`Alert "${'z'.repeat(59)}…" closed`);
  });
});
