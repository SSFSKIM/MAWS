import type { BrowserActivity } from '@shared/browser/activity'; // E13
import { describe, expect, it } from 'vitest';
import type { CellId, ToolCategory } from './rows';
import {
  ARTIFACT_CELL, bashFooter, BLOCKED, boundaryCopy, cellLabel, compactingLine, dividerCopy, dividerHead, HANDOVER_REINIT_COPY, lineCountsCopy, liveThinkingLabel, NOTICE, plural,
  commandLead, PENDING_CAPTION, processExitCopy, REACH, rewindLabel, SAFEGUARD_LINE, shellFooter, stoppedLabel, subagentDetail, subagentSentence, thinkingLabel, thinkingTier, thinkingWarmth, turnSummaryCopy, waitingLabel,
} from './copy';
import { rowsOf } from './derive';
import { applyEvents, createState } from './reduce';
import { builder } from './test-events';
import { browserActivityLine } from './copy'; // E13
import { agentListCopy, agentMessageCopy, ASK, askStateCopy, askStateWhy, BROWSER_ACTION, MESSAGE_LINE, peerMessageCopy, planBadge } from './copy'; // the word cut, M2 task 2

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
  // The word cut (T1, ruled; the architect's narrowing): no finished turn says it worked; a person's reads its duration
  // alone, the engine's and a peer's say who opened it (`Continued · 5s`, `Peer session · 5s`), and You stopped, Ended
  // for your message and Failed keep their words
  it('reads the duration alone, Continued ·, Peer session ·, You stopped and Failed with what the turn did, omitted when it did nothing', () => {
    expect(line({ state: 'completed', durationMs: 192_000, caption: 'Edited 2 files, ran 2 agents, ran 5 commands', counts: { added: 33, removed: 5 } })).toBe('3m 12s · Edited 2 files, ran 2 agents, ran 5 commands +33 −5');
    expect(line({ state: 'completed', durationMs: 5_000, caption: 'Ran a command' })).toBe('5s · Ran a command');
    expect(line({ state: 'completed', durationMs: 5_000 })).toBe('5s');
    expect(line({ state: 'completed', durationMs: 3_000, caption: 'Ran an agent' })).not.toContain('Worked for');
    expect(line({ state: 'completed', origin: 'engine', durationMs: 5_000, caption: 'Read 2 files' })).toBe('Continued · 5s · Read 2 files');
    expect(line({ state: 'completed', origin: 'peer', durationMs: 5_000, caption: 'Read 2 files' })).toBe('Peer session · 5s · Read 2 files');
    expect(line({ state: 'stopped', durationMs: 5_000, caption: 'Ran 3 commands (2 stopped)' })).toBe('You stopped after 5s · Ran 3 commands (2 stopped)');
    expect(line({ state: 'failed', durationMs: 5_000, caption: 'Ran a command (1 failed)' })).toBe('Failed after 5s · Ran a command (1 failed)');
    for (const text of [line({ state: 'completed', durationMs: 5_000, caption: 'Ran a command' }), line({ state: 'working', durationMs: 5_000 })]) expect(text).not.toContain('tool call');
  });

  it('reads a running turn’s lines so far after its verb, and a closed turn’s after its caption, a zero side left out', () => {
    expect(line({ state: 'working', durationMs: 72_000, counts: { added: 12, removed: 3 } })).toBe('Working for 1m 12s +12 −3');
    expect(line({ state: 'completed', durationMs: 5_000, caption: 'Created a file', counts: { added: 4, removed: 0 } })).toBe('5s · Created a file +4');
    expect(line({ state: 'completed', durationMs: 5_000, caption: 'Edited a file', counts: { added: 0, removed: 2 } })).toBe('5s · Edited a file −2');
    expect(lineCountsCopy({ added: 33, removed: 5 })).toBe('+33 −5');
    expect(lineCountsCopy(NONE)).toBe('');
    expect(dividerHead({ state: 'completed', origin: 'human', durationMs: 5_000, caption: 'Edited a file' })).toBe('5s · Edited a file');
  });

  // The word cut (T2, "Seen on the scratch build"): a caption folded to `+N` is kept apart from the lines that follow it,
  // so the fold's count does not read as one of them
  it('separates a folded caption’s `+N` from the turn’s lines; an unfolded caption keeps its lines beside it', () => {
    expect(line({ state: 'completed', durationMs: 3_000, caption: 'Edited 3 files, ran 2 commands, +6', fold: 6, counts: { added: 4, removed: 2 } })).toBe('3s · Edited 3 files, ran 2 commands, +6 · +4 −2');
    expect(line({ state: 'completed', durationMs: 3_000, caption: 'Edited 3 files, ran 2 commands, +6', fold: 6 })).toBe('3s · Edited 3 files, ran 2 commands, +6');
    expect(line({ state: 'completed', durationMs: 3_000, caption: 'Edited a file, ran a command', counts: { added: 4, removed: 2 } })).toBe('3s · Edited a file, ran a command +4 −2');
    // the fold is the caption's data: a file whose name ends like a count is no fold (fix round 1)
    expect(line({ state: 'completed', durationMs: 3_000, caption: 'Edited notes, +6', counts: { added: 4, removed: 2 } })).toBe('3s · Edited notes, +6 +4 −2');
  });

  // UX wave U2 (l2-transcript-04; C2): a turn the answer to an asynchronous question opened is the person's
  it('reads a turn an answer opened as the person’s, its duration alone, whatever its origin; every other opener keeps who opened it', () => {
    expect(line({ state: 'completed', origin: 'engine', opener: { class: 'answer' }, durationMs: 5_000, caption: 'Ran a command' })).toBe('5s · Ran a command');
    expect(line({ state: 'completed', origin: 'engine', opener: { class: 'subagent' }, durationMs: 5_000, caption: 'Ran a command' })).toBe('Continued · 5s · Ran a command');
    expect(line({ state: 'completed', origin: 'peer', opener: { class: 'peer' }, durationMs: 5_000, caption: 'Ran a command' })).toBe('Peer session · 5s · Ran a command');
  });

  // E11 (W-C): a turn its engine process ended (a crash, or a supervisor's death) is not the reader's stop
  it('reads a crash-closed turn in the engine’s words, and keeps You stopped for a stop', () => {
    expect(line({ state: 'stopped', cause: 'crash', durationMs: 5_000, caption: 'Ran 4 commands' })).toBe('Stopped after 5s (engine process exited) · Ran 4 commands');
    expect(line({ state: 'stopped', cause: null, durationMs: 5_000 })).toBe('You stopped after 5s');
    expect(turnSummaryCopy({ state: 'stopped', cause: 'crash', origin: 'human', durationMs: 5_000, model: 'haiku', parts: [], denied: [], safeguard: NO_SAFEGUARD, costUsd: null, tokens: null })).toBe('Stopped after 5s (engine process exited) on haiku');
  });

  // UX wave U4a (Interfaces B) and U2 (O-15), at the chain merge: a turn a message sent now ended reads U4a's verb and
  // then what it did, its lines and its counts, as every other closed turn does; a sent-now end with no work reads the verb
  it('reads a turn a message sent now ended as “Ended for your message after …” with what it did after it', () => {
    expect(line({ state: 'stopped', cause: 'message', durationMs: 13_000, caption: 'Read plan.md, ran a command', counts: { added: 3, removed: 1 }, denied: 1 })).toBe('Ended for your message after 13s · Read plan.md, ran a command +3 −1 · 1 denied');
    expect(line({ state: 'stopped', cause: 'message', durationMs: 13_000 })).toBe('Ended for your message after 13s');
  });

  it('suffixes the denied and auto-denied counts', () => {
    expect(line({ state: 'completed', durationMs: 134_000, caption: 'Ran 12 commands', denied: 1 })).toBe('2m 14s · Ran 12 commands · 1 denied');
    expect(line({ state: 'completed', durationMs: 134_000, caption: 'Ran 12 commands', counts: { added: 1, removed: 1 }, denied: 1, autoDenied: 2 })).toBe('2m 14s · Ran 12 commands +1 −1 · 1 denied · 2 auto-denied');
  });

  // UX wave U2 (O-15): the popover lists every part, uncapped; the count of subagents goes, the agent part says it. The
  // word cut (T1) shortens the turn's line only: the popover is where its words wait
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
    // UX wave U1c (Interfaces §A): a blocked row's "again" and "· approved", for a call auto mode blocked alone
    expect(cellLabel({ kind: 'denied', subject: 'rm -rf', disposition: 'auto_denied', denialKind: 'automode-blocked', reason: null })).toBe('Auto mode blocked: `rm -rf`');
    expect(cellLabel({ kind: 'denied', subject: 'rm -rf', disposition: 'auto_denied', denialKind: 'automode-blocked', reason: null, approved: true })).toBe('Auto mode blocked: `rm -rf` · approved');
    expect(cellLabel({ kind: 'denied', subject: 'rm -rf', disposition: 'auto_denied', denialKind: 'automode-blocked', reason: null, again: true })).toBe('Auto mode blocked again: `rm -rf`');
    expect(cellLabel({ kind: 'denied', subject: 'rm -rf', disposition: 'auto_denied', denialKind: 'automode-blocked', reason: 'destructive', again: true, approved: true })).toBe('Auto mode blocked again: `rm -rf` · destructive · approved');
    expect(cellLabel({ kind: 'denied', subject: 'git push', disposition: 'denied', denialKind: 'permission-rule', reason: null, again: true, approved: true })).toBe('Denied: `git push`');
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
    expect(cellLabel({ kind: 'generic', toolName: 'mcp__web__fetch', category: 'web', detail: 'example.com' })).toBe('Fetched example.com'); // UX wave U3b, M5: the web plugin's fetch, before the MCP form
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

  // The word cut (T37): the effort is the model chip's, so the label is the tier and the elapsed time
  it('a streaming block’s label is its tier and the elapsed time, with no effort', () => {
    expect(liveThinkingLabel(4_000)).toBe('Thinking · 4s');
    expect(liveThinkingLabel(34_000)).toBe('Thinking some more · 34s');
    expect(liveThinkingLabel(75_000)).toBe('Deep in thought · 1m 15s');
    expect(liveThinkingLabel(12_000)).toBe('Still thinking · 12s');
  });

  // The word cut (T22, T66): exit 0 is the normal state, so a successful command shows its time alone; a failure keeps it
  it('a shell call’s footer names a non-zero exit only, and a ! command’s footer is drawn only for one', () => {
    expect(shellFooter('done', 0, 3_000)).toBe('3s');
    expect(shellFooter('done', null, 3_000)).toBe('3s');
    expect(shellFooter('error', 1, 3_000)).toBe('✕ Exit code 1 · 3s');
    expect(shellFooter('error', null, 3_000)).toBe('Failed · 3s');
    expect(shellFooter('stopped', null, 3_000)).toBe('Stopped after 3s');
    expect(bashFooter(0)).toBe('');
    expect(bashFooter(null)).toBe('');
    expect(bashFooter(2)).toBe('exit 2');
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
  it('grouped sentences: the names with no verb while they work and once finished; errors, a stop and an exit keep their words (the word cut, T86, N104)', () => {
    expect(subagentSentence(['A'], 'started')).toBe('A');
    expect(subagentSentence(['A', 'B'], 'started')).toBe('A and B');
    expect(subagentSentence(['A', 'B', 'C'], 'started')).toBe('A, B and C');
    expect(subagentSentence(['A', 'B', 'C', 'D', 'E'], 'started')).toBe('A, B and 3 more');
    expect(subagentSentence(['A'], 'working')).toBe('A');
    expect(subagentSentence(['A'], 'finished')).toBe('A');
    expect(subagentSentence(['A', 'B'], 'finished_with_errors')).toBe('A and B · with errors');
    expect(subagentSentence(['A'], 'stopped')).toBe('A · stopped');
    // UX wave U3b, M5 (decision 19): agents that ended with their session's process, in U8's words for the same fact
    expect(subagentSentence(['A'], 'exited')).toBe('A ended with the session');
    expect(subagentSentence(['A', 'B', 'C', 'D', 'E'], 'exited')).toBe('A, B and 3 more ended with the session');
  });

  it('what a working agent is doing, and for how long, for its pointing (T87)', () => {
    expect(subagentDetail('Explore', 'Grep', 72_000)).toBe('Explore · Grep · 1m 12s');
    expect(subagentDetail('Explore', null, 3_000)).toBe('Explore · 3s');
  });

  it('boundaries', () => {
    // The word cut (T48, T49, T50, T52): the figures and the count stay, the words around them shorten
    expect(boundaryCopy({ kind: 'compaction', preTokens: 160_000, postTokens: 24_000, trigger: 'auto', historical: false })).toBe('Compacted · 160k → 24k');
    expect(boundaryCopy({ kind: 'compaction', preTokens: 160_000, postTokens: 24_000, trigger: 'manual', historical: true })).toBe('Compacted · 160k → 24k');
    expect(boundaryCopy({ kind: 'compaction', preTokens: 160_000, postTokens: null, trigger: 'auto', historical: false })).toBe('Compacted · 160k → ?');
    expect(boundaryCopy({ kind: 'reset', trigger: 'plan_approved' })).toBe('Reset after plan approval');
    expect(boundaryCopy({ kind: 'reset', trigger: 'plan_approval' })).toBe('Reset after plan approval');
    expect(boundaryCopy({ kind: 'reset', trigger: 'clear' })).toBe('Cleared');
    expect(boundaryCopy({ kind: 'reset', trigger: 'cleared' })).toBe('Cleared');
    expect(boundaryCopy({ kind: 'reset', trigger: null })).toBe('Reset');
    expect(boundaryCopy({ kind: 'reset', trigger: 'fresh_session' })).toBe('Reset · fresh_session');
    expect(boundaryCopy({ kind: 'retraction', reason: 'transcript_branch', fallbackModel: null })).toBe('Continued from an earlier point');
    expect(boundaryCopy({ kind: 'retraction', reason: 'refusal', fallbackModel: 'claude-sonnet-5' })).toBe('Response retracted · refusal · switched to claude-sonnet-5');
    expect(boundaryCopy({ kind: 'rewind', hiddenRows: 3, revealed: false })).toBe('Rewound · 3 hidden · Show');
    expect(boundaryCopy({ kind: 'rewind', hiddenRows: 4, revealed: true })).toBe('Rewound · 4 hidden · Hide');
    expect(rewindLabel(1)).toBe('Rewound · 1 hidden');
  });

  // The word cut (T57, T59, T64, T68, T70, T114, N100, N101, N117, T17): the lines and notices in a person's words
  it('notices, a release, a jump’s bar, a blocked call’s line, the compaction’s row and an artifact’s screenshot', () => {
    expect(processExitCopy('budget', 0)).toBe('Paused to save memory · send to resume');
    expect(processExitCopy('idle', 0)).toBe('Paused while idle · send to resume');
    expect(HANDOVER_REINIT_COPY).toBe('Resumed after the update');
    expect(NOTICE.schedule('Check the nightly build')).toBe('Scheduled · Check the nightly build');
    expect(NOTICE.schedule(null)).toBe('Scheduled');
    expect(NOTICE.wake).toBe('Woken to read a message');
    expect(REACH.loading(0.4)).toBe('Finding the message · 40%');
    expect(REACH.loading(null)).toBe('Finding the message…');
    expect(BLOCKED.always.command).toBe('A rule always denies this command. Change the rule or the mode to run it.');
    expect(BLOCKED.always.call).toBe('A rule always denies this call. Change the rule or the mode to run it.');
    expect(compactingLine('')).toBe('Compacting…');
    expect(compactingLine('12s')).toBe('Compacting… 12s');
    const shots = [{ title: 'Q3 plan', version: 3, width: 1280, height: 800 }, { title: 'Q3 plan', revision: 2, width: 1280, height: 800 }]; // as the call's result reads
    for (const shot of shots) expect(ARTIFACT_CELL.screenshot(shot, 'a1')).toBe('Screenshot of Q3 plan');
    expect(ARTIFACT_CELL.screenshot(null, 'a1')).toBe('Screenshot of a1');
  });

  // The word cut's `stays` rows (Acceptance 3: what was to stay, stayed): T11, T13, T15, T34, T36, T41, N99, N118
  it('keeps the words the cut leaves as they read', () => {
    expect(cellLabel({ kind: 'edit', path: 'src/app/main.ts', change: 'update', added: 3, removed: 1 })).toBe('Edited src/app/main.ts +3 −1');
    expect(cellLabel({ kind: 'moved', name: 'pnpm dev', durationMs: 12_000 })).toBe('Moved `pnpm dev` to the background after 12s');
    expect(cellLabel({ kind: 'denied', subject: 'rm -rf build', disposition: 'auto_denied', denialKind: 'automode-blocked', reason: null, again: true, approved: true })).toBe('Auto mode blocked again: `rm -rf build` · approved');
    expect(SAFEGUARD_LINE.not_flagged).toBe('Auto mode · reviewed · not flagged');
    expect(thinkingLabel(false, 14_000)).toBe('Thought for 14s');
    expect(PENDING_CAPTION.next).toBe('Sends at the next step');
    expect(commandLead({ command: 'cost' })).toBe('/cost · ');
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

// The word cut, M2 task 2: the agents' lines and listings, the plan's badge, the question capsule and a browser action.
describe('the agents’ and the requests’ words', () => {
  it('a message line is the party and the preview; its direction is the arrow its view leads with, and its old words are its accessible lead (T73)', () => {
    expect(agentMessageCopy('from_child', 'reviewer', 'The migration is safe to run')).toBe('reviewer: The migration is safe to run');
    expect(agentMessageCopy('to_child', 'reviewer', 'go')).toBe('reviewer: go');
    expect(agentMessageCopy('between', null, 'hi')).toBe('parent: hi');
    expect(peerMessageCopy.inbound('reviewer', 'hi')).toBe('@reviewer: hi');
    expect(peerMessageCopy.outbound('reviewer', 'hi')).toBe('@reviewer: hi');
    expect(peerMessageCopy.report('Explore', 'all done')).toBe('Report from Explore: all done'); // keeps its words and the › mark
    expect(MESSAGE_LINE).toMatchObject({ from: '←', to: '→', mark: '›', named: { from: 'Message from', to: 'Sent to' } });
  });

  it('a listing still out reads Listing agents…; one never answered keeps its words; a read one is counted (T81, T85)', () => {
    expect(agentListCopy.pending).toBe('Listing agents…');
    expect(agentListCopy.neverAnswered).toBe('Listing the agents was never answered');
    expect(agentListCopy.listed(9)).toBe('Listed 9 agents');
    expect(agentListCopy.listed(1)).toBe('Listed 1 agent');
  });

  it('a decided plan’s badge (T90)', () => {
    expect(planBadge('implement', null)).toBe('Approved');
    expect(planBadge('clear_and_implement', null)).toBe('Approved, context cleared');
    expect(planBadge('keep_planning', 'tighten step 2')).toBe('Kept planning: tighten step 2');
    expect(planBadge('keep_planning', null)).toBe('Kept planning');
  });

  it('the capsule’s count, its heading with no title, and a cancelled one’s word with its why apart (T93, T94, T97)', () => {
    expect(ASK.count(3)).toBe('3 questions');
    expect(ASK.count(1)).toBe('1 question');
    const cancelled = { state: 'cancelled' as const, error: null, cancelReason: 'withdrawn' };
    expect(askStateCopy(cancelled)).toBe('Cancelled');
    expect(askStateWhy(cancelled)).toBe('The turn was interrupted');
    expect(askStateCopy({ ...cancelled, cancelReason: null })).toBe('Cancelled');
    expect(askStateWhy({ ...cancelled, cancelReason: null })).toBe('The session ended');
    expect(askStateWhy({ state: 'answered', error: null, cancelReason: null })).toBeNull();
    expect(askStateCopy({ state: 'answered', error: null, cancelReason: null })).toBe('Answered'); // T96 stays
    expect(askStateCopy({ state: 'pending', error: null, cancelReason: null })).toBe('Waiting for you');
    expect(askStateCopy({ state: 'asked', error: null, cancelReason: null })).toBe('Asked, answer when ready'); // T95 stays
  });

  it('a browser action the interrupt stopped reads Cancelled (T107)', () => {
    expect(BROWSER_ACTION.cancelled).toBe('Cancelled');
  });
});
