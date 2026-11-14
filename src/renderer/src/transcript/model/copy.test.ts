import type { BrowserActivity } from '@shared/browser/activity'; // E13
import { describe, expect, it } from 'vitest';
import type { CellId, ToolCategory } from './rows';
import {
  boundaryCopy, cellLabel, dividerCopy, dividerHead, lineCountsCopy, liveThinkingLabel, plural, stoppedLabel, subagentSentence, thinkingLabel, thinkingTier, thinkingWarmth, turnSummaryCopy,
  waitingLabel,
} from './copy';
import { rowsOf } from './derive';
import { applyEvents, createState } from './reduce';
import { builder } from './test-events';
import { browserActivityLine } from './copy'; // E13

const cell = (id: string) => id as CellId;
const NONE = { added: 0, removed: 0 };
const line = (input: Partial<Parameters<typeof dividerCopy>[0]> & Pick<Parameters<typeof dividerCopy>[0], 'state' | 'durationMs'>) =>
  dividerCopy({ origin: 'human', caption: '', counts: NONE, denied: 0, autoDenied: 0, ...input });
const NO_SAFEGUARD = { reviewed: 0, flagged: 0, notEvaluated: 0 };

describe('divider and summary copy', () => {
  it('reads Working under a second and Working for {t} after, with no caption', () => {
    expect(line({ state: 'working', durationMs: 400 })).toBe('Working');
    expect(line({ state: 'working', durationMs: 134_000, caption: 'Ran 3 commands' })).toBe('Working for 2m 14s');
  });

  // UX wave U2 (O-15; acceptance 7): the turn's line says what the turn did, in the caption's words; no count of calls
  it('reads Worked, Continued, You stopped and Failed with what the turn did, omitted when it did nothing', () => {
    expect(line({ state: 'completed', durationMs: 192_000, caption: 'Edited 2 files, ran 2 agents, ran 5 commands', counts: { added: 33, removed: 5 } })).toBe('Worked for 3m 12s · Edited 2 files, ran 2 agents, ran 5 commands +33 −5');
    expect(line({ state: 'completed', durationMs: 5_000, caption: 'Ran a command' })).toBe('Worked for 5s · Ran a command');
    expect(line({ state: 'completed', durationMs: 5_000 })).toBe('Worked for 5s');
    expect(line({ state: 'completed', origin: 'engine', durationMs: 5_000, caption: 'Read 2 files' })).toBe('Continued for 5s · Read 2 files');
    expect(line({ state: 'completed', origin: 'peer', durationMs: 5_000, caption: 'Read 2 files' })).toBe('Peer session worked for 5s · Read 2 files');
    expect(line({ state: 'stopped', durationMs: 5_000, caption: 'Ran 3 commands (2 stopped)' })).toBe('You stopped after 5s · Ran 3 commands (2 stopped)');
    expect(line({ state: 'failed', durationMs: 5_000, caption: 'Ran a command (1 failed)' })).toBe('Failed after 5s · Ran a command (1 failed)');
    for (const text of [line({ state: 'completed', durationMs: 5_000, caption: 'Ran a command' }), line({ state: 'working', durationMs: 5_000 })]) expect(text).not.toContain('tool call');
  });

  it('reads a running turn’s lines so far after its verb, and a closed turn’s after its caption, a zero side left out', () => {
    expect(line({ state: 'working', durationMs: 72_000, counts: { added: 12, removed: 3 } })).toBe('Working for 1m 12s +12 −3');
    expect(line({ state: 'completed', durationMs: 5_000, caption: 'Created a file', counts: { added: 4, removed: 0 } })).toBe('Worked for 5s · Created a file +4');
    expect(line({ state: 'completed', durationMs: 5_000, caption: 'Edited a file', counts: { added: 0, removed: 2 } })).toBe('Worked for 5s · Edited a file −2');
    expect(lineCountsCopy({ added: 33, removed: 5 })).toBe('+33 −5');
    expect(lineCountsCopy(NONE)).toBe('');
    expect(dividerHead({ state: 'completed', origin: 'human', durationMs: 5_000, caption: 'Edited a file' })).toBe('Worked for 5s · Edited a file');
  });

  // UX wave U2 (l2-transcript-04; C2): a turn the answer to an asynchronous question opened is the person's
  it('reads Worked for a turn an answer opened, whatever its origin; every other opener keeps the origin’s verb', () => {
    expect(line({ state: 'completed', origin: 'engine', opener: { class: 'answer' }, durationMs: 5_000, caption: 'Ran a command' })).toBe('Worked for 5s · Ran a command');
    expect(line({ state: 'completed', origin: 'engine', opener: { class: 'subagent' }, durationMs: 5_000, caption: 'Ran a command' })).toBe('Continued for 5s · Ran a command');
    expect(line({ state: 'completed', origin: 'peer', opener: { class: 'peer' }, durationMs: 5_000, caption: 'Ran a command' })).toBe('Peer session worked for 5s · Ran a command');
  });

  // E11 (W-C): a turn its engine process ended (a crash, or a supervisor's death) is not the reader's stop
  it('reads a crash-closed turn in the engine’s words, and keeps You stopped for a stop', () => {
    expect(line({ state: 'stopped', cause: 'crash', durationMs: 5_000, caption: 'Ran 4 commands' })).toBe('Stopped after 5s (engine process exited) · Ran 4 commands');
    expect(line({ state: 'stopped', cause: null, durationMs: 5_000 })).toBe('You stopped after 5s');
    expect(turnSummaryCopy({ state: 'stopped', cause: 'crash', origin: 'human', durationMs: 5_000, model: 'haiku', parts: [], denied: [], safeguard: NO_SAFEGUARD, costUsd: null, tokens: null })).toBe('Stopped after 5s (engine process exited) on haiku');
  });

  it('suffixes the denied and auto-denied counts', () => {
    expect(line({ state: 'completed', durationMs: 134_000, caption: 'Ran 12 commands', denied: 1 })).toBe('Worked for 2m 14s · Ran 12 commands · 1 denied');
    expect(line({ state: 'completed', durationMs: 134_000, caption: 'Ran 12 commands', counts: { added: 1, removed: 1 }, denied: 1, autoDenied: 2 })).toBe('Worked for 2m 14s · Ran 12 commands +1 −1 · 1 denied · 2 auto-denied');
  });

  // UX wave U2 (O-15): the popover lists every part, uncapped; the count of subagents goes, the agent part says it
  it('composes the summary popover, omitting zero and unknown segments', () => {
    const summary = turnSummaryCopy({
      state: 'completed', origin: 'human', durationMs: 134_000, model: 'claude-opus-5-5', parts: ['edited 3 files', 'ran 2 agents', 'ran 2 commands', 'read a file', 'searched code', 'updated todos'],
      denied: [{ kind: 'permission-rule' }], safeguard: { reviewed: 4, flagged: 1, notEvaluated: 8 }, costUsd: 0.1234, tokens: 12_345,
    });
    expect(summary).toBe('Worked for 2m 14s on claude-opus-5-5 · Edited 3 files, ran 2 agents, ran 2 commands, read a file, searched code, updated todos · 1 denied (permission-rule) · Auto mode reviewed 4 actions, 1 flagged · $0.12 · 12,345 tokens');
    expect(summary).not.toContain('tool call');
    expect(turnSummaryCopy({ state: 'completed', origin: 'engine', durationMs: 5_000, model: null, parts: [], denied: [], safeguard: NO_SAFEGUARD, costUsd: null, tokens: null })).toBe('Continued for 5s');
    expect(turnSummaryCopy({ state: 'completed', origin: 'engine', opener: { class: 'answer' }, durationMs: 5_000, model: null, parts: ['ran a command'], denied: [], safeguard: NO_SAFEGUARD, costUsd: null, tokens: null })).toBe('Worked for 5s · Ran a command');
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
    expect(cellLabel({ kind: 'edit', path: 'src/a.ts', change: 'create', added: 3, removed: 0 })).toBe('Created src/a.ts +3 −0');
    expect(cellLabel({ kind: 'edit', path: 'src/a.ts', change: 'delete', added: 0, removed: 3 })).toBe('Deleted src/a.ts +0 −3');
    expect(cellLabel({ kind: 'read', paths: ['src/a.ts'] })).toBe('Read a.ts');
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

  // UX wave U2 (decision 23, R2): one form for every stopped call, with no duration
  it('the stopped form: the subject in code marks, a shell description as written', () => {
    expect(stoppedLabel('pnpm test', true)).toBe('Stopped: `pnpm test`');
    expect(stoppedLabel('Run the tests', false)).toBe('Stopped: Run the tests');
  });

  it('other cells', () => {
    expect(cellLabel({ kind: 'generic', toolName: 'mcp__docs__search', category: 'mcp' as ToolCategory })).toBe('Used docs · search');
    // UX wave U12a: the computer-use plugin's call reads as what it is, under both names the engine gives its tool
    expect(cellLabel({ kind: 'generic', toolName: 'mcp__plugin_cua_cua_repl__js', category: 'mcp' as ToolCategory })).toBe('Used computer use');
    expect(cellLabel({ kind: 'generic', toolName: 'mcp__cua_repl__js', category: 'mcp' as ToolCategory })).toBe('Used computer use');
    expect(cellLabel({ kind: 'generic', toolName: 'mcp__plugin_cua_cua_repl__js_reset', category: 'mcp' as ToolCategory })).toBe('Used plugin_cua_cua_repl · js_reset');
    expect(cellLabel({ kind: 'generic', toolName: 'Skill', category: 'skills', detail: 'tdd' })).toBe('Ran /tdd'); // UX wave U2 (decision 5): the row's words, once the view's
    expect(cellLabel({ kind: 'generic', toolName: 'Skill', category: 'skills', detail: '/release-notes' })).toBe('Ran /release-notes');
    expect(cellLabel({ kind: 'generic', toolName: 'Skill', category: 'skills', detail: null })).toBe('Ran a skill');
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
    // P5 O7 M10's follow-up: under a second a figure says nothing ("0s"), as the divider's Working reads
    expect(thinkingLabel(false, 0)).toBe('Thought');
    expect(thinkingLabel(false, 999)).toBe('Thought');
    expect(thinkingLabel(false, 1000)).toBe('Thought for 1s');
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

// UX wave U2 (the U2a document, Interfaces §E; l4-approvals-04's words): what a call reads while it waits for approval
describe('the waiting label', () => {
  const callOf = (name: string, input: Record<string, unknown>) => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', name, input);
    const row = rowsOf(applyEvents(createState(null, null), b.events)).find((r) => r.kind === 'group');
    return row?.kind === 'group' ? row.cells[0] : (() => { throw new Error('no run'); })();
  };

  it('a shell call reads its command’s first line in code marks, a file change its file’s name, any other call its tool’s name', () => {
    expect(waitingLabel(callOf('Bash', { command: 'pnpm test\npnpm lint', description: 'Run the checks' }))).toBe('Waiting for approval: `pnpm test`');
    expect(waitingLabel(callOf('Edit', { file_path: '/w/src/app.ts', old_string: 'a', new_string: 'b' }))).toBe('Waiting for approval: app.ts');
    expect(waitingLabel(callOf('Write', { file_path: '/w/notes.md', content: 'x' }))).toBe('Waiting for approval: notes.md');
    expect(waitingLabel(callOf('WebFetch', { url: 'https://example.com', prompt: 'read' }))).toBe('Waiting for approval: WebFetch');
    expect(waitingLabel(callOf('mcp__github__create_issue', { title: 'x' }))).toBe('Waiting for approval: github · create_issue');
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
