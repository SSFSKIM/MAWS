import { describe, expect, it } from 'vitest';
import type { CellId, ToolCategory } from './rows';
import {
  activeGroupLabel, boundaryCopy, cellLabel, dividerCopy, groupSummary, plural, subagentSentence, thinkingLabel, turnSummaryCopy, type GroupPhraseInput,
} from './copy';

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
    expect(cellLabel({ kind: 'generic', toolName: 'SendUserFile', category: 'other', detail: 'report.pdf' })).toBe('Sent report.pdf');
    expect(cellLabel({ kind: 'generic', toolName: 'TodoWrite', category: 'other' })).toBe('Used TodoWrite');
  });

  it('thinking', () => {
    expect(thinkingLabel(true, null)).toBe('Thinking');
    expect(thinkingLabel(false, 12_000)).toBe('Thought for 12s');
    expect(thinkingLabel(false, null)).toBe('Thought'); // never streamed: no duration to show
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
