// The record line's words where MAWS draws the to-human view (UX wave U2b; the execution document, Interfaces §M, "The
// label's rule"; decision 27): a call's line by the mod's own table, tool by tool and cut for cut (`lineOf`, with
// `lineFor` and `oneLine`, folds.tsx 140 to 195 at the mod's e511aad9); the live half of `labelFor` (526), as MAWS
// reads a stretch live; and what `recordLabel` reads of the two. Every input is invented.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { StoredRun } from '@shared/owner/folds';
import type { TurnState } from '../../transcript/model/reduce';
import type { Row, TurnId } from '../../transcript/model/rows';
import { lineOf, liveLine, recordLabel, runOf } from './label';
import { stretchesOf } from './mirror';

describe('lineOf: a call as one line, the mod’s table', () => {
  it.each<[string, string, unknown, string]>([
    ['a command reads its description', 'Bash', { command: 'pnpm test', description: 'Run the unit suite' }, 'Run the unit suite'],
    ['a command with no description reads its first line, trimmed', 'Bash', { command: '  git status\ngit diff' }, 'git status'],
    ['a command with a blank description reads its command', 'Bash', { command: 'ls', description: '   ' }, 'ls'],
    ['a read reads the file’s name', 'Read', { file_path: '/repo/src/notes.md' }, 'Read notes.md'],
    ['an edit reads the file’s name', 'Edit', { file_path: 'C:\\repo\\parse.ts' }, 'Edit parse.ts'],
    ['a write reads the file’s name', 'Write', { file_path: '/repo/out/' }, 'Write out'],
    ['a notebook’s edit reads as an edit', 'NotebookEdit', { notebook_path: '/repo/study.ipynb' }, 'Edit study.ipynb'],
    ['a search by content reads its pattern', 'Grep', { pattern: 'TODO' }, 'Search "TODO"'],
    ['a search by name reads its pattern', 'Glob', { pattern: '**/*.md' }, 'Search "**/*.md"'],
    ['a message to an agent, with its summary', 'SendMessage', { to: 'reviewer', summary: 'the plan is ready' }, 'Message to reviewer: the plan is ready'],
    ['a message to an agent, with none', 'SendMessage', { to: 'reviewer' }, 'Message to reviewer'],
    ['a skill reads its name', 'Skill', { skill: 'release-notes' }, 'Skill release-notes'],
    ['a tool search reads its query', 'ToolSearch', { query: 'calendar' }, 'Tool search "calendar"'],
    ['a server’s tool reads its server and tool', 'mcp__notes__append_line', { line: 'x' }, 'notes: append_line'],
    ['any other tool reads its name', 'WebFetch', { url: 'https://example.com' }, 'WebFetch'],
    ['a tool whose input lacks what its line is made of reads its name', 'Read', { offset: 3 }, 'Read'],
    ['an input that is no object reads the name', 'Grep', 'TODO', 'Grep'],
  ])('%s', (_name, tool, input, line) => {
    expect(lineOf(tool, input)).toBe(line);
  });

  it('is one line: a newline and the spaces around it become one space', () => {
    expect(lineOf('Bash', { description: 'Build the site \n\n  then check its links' })).toBe('Build the site then check its links');
  });

  it('is cut past 120 characters with “…”, between code points', () => {
    const long = `${'a'.repeat(118)}😀😀😀`;
    const line = lineOf('Bash', { description: long });
    expect(Array.from(line)).toHaveLength(120);
    expect(line).toBe(`${'a'.repeat(118)}😀…`);
    expect(lineOf('Bash', { description: 'b'.repeat(120) })).toBe('b'.repeat(120));
  });
});

// A stretch of hand-built rows over one turn whose events hold the calls (their inputs and results).
const T = 'turn:label' as TurnId;
const AT = '2026-11-16T10:00:00.000Z';
type Call = { id: string; description: string; done: boolean };
function scene(parts: (Call | 'note' | 'message' | 'prompt')[]) {
  const events: SessionEvent[] = [];
  const rows = parts.map((part, i): Row => {
    if (part === 'prompt') return { id: `user:${i}`, turnId: T, at: AT, kind: 'user', messageUuid: `u${i}`, text: 'Go on.', steer: false } as unknown as Row;
    if (part === 'message') return { id: `text:m${i}:0`, turnId: T, at: AT, kind: 'assistant_text', messageUuid: `m${i}`, blockIndex: 0, markdown: '<message>Done.</message>', live: false, phase: 'answer', model: null } as unknown as Row;
    if (part === 'note') return { id: `text:n${i}:0`, turnId: T, at: AT, kind: 'assistant_text', messageUuid: `n${i}`, blockIndex: 0, markdown: 'Checking.', live: false, phase: 'commentary', model: null } as unknown as Row;
    events.push({ id: `use-${part.id}`, kind: 'tool.use', toolUseId: part.id, toolName: 'Bash', input: { command: 'true', description: part.description }, apiMessageId: null, messageUuid: null } as unknown as SessionEvent);
    if (part.done) events.push({ id: `result-${part.id}`, kind: 'tool.result', toolUseId: part.id, content: 'ok', isError: false } as unknown as SessionEvent);
    return { id: `cell:${part.id}`, turnId: T, at: AT, kind: 'cell', toolUseId: part.id, toolName: 'Bash', status: part.done ? 'done' : 'running', background: false } as unknown as Row;
  });
  const turns = new Map([[T, { id: T, events, live: new Map() } as unknown as TurnState]]);
  return { rows, turns, stretches: stretchesOf(rows) };
}
const run = (first: string, last: string, summary: string): StoredRun => ({ first, last, summary });

describe('liveLine: the live half of the mod’s labelFor', () => {
  it('a stretch with a call that has no result is live and reads its newest call', () => {
    const { stretches, turns } = scene(['prompt', { id: 'a', description: 'Read the logs', done: true }, { id: 'b', description: 'Run the build', done: false }, 'message']);
    expect(liveLine(stretches[0]!, undefined, false, false, turns)).toBe('Run the build');
  });

  it('the rows’ last stretch while the session’s turn runs is live, every call answered or not', () => {
    const { stretches, turns } = scene(['prompt', { id: 'a', description: 'Read the logs', done: true }, { id: 'b', description: 'Count the lines', done: true }]);
    expect(liveLine(stretches[0]!, undefined, true, true, turns)).toBe('Count the lines');
    expect(liveLine(stretches[0]!, undefined, true, false, turns)).toBeUndefined(); // the turn ended: not live
    expect(liveLine(stretches[0]!, undefined, false, true, turns)).toBeUndefined(); // not the last stretch: not live
  });

  it('with a stored run, reads the newest call after the row its last names; with none after it, nothing (the summary reads on)', () => {
    const { stretches, turns } = scene(['prompt', { id: 'a', description: 'Read the settings', done: true }, { id: 'b', description: 'Run the linter', done: false }]);
    expect(liveLine(stretches[0]!, run('a', 'a', 'Read the settings file'), true, true, turns)).toBe('Run the linter');
    expect(liveLine(stretches[0]!, run('a', 'b', 'Read the settings and linted'), true, true, turns)).toBeUndefined();
  });

  it('a note after the stored run’s last is no call: the summary reads on', () => {
    const { stretches, turns } = scene(['prompt', { id: 'a', description: 'Read server.log', done: true }, 'note']);
    expect(liveLine(stretches[0]!, run('a', 'a', 'Checked the logs'), true, true, turns)).toBeUndefined();
  });

  it('a live stretch with no call has no line', () => {
    const { stretches, turns } = scene(['prompt', 'note', 'note']);
    expect(liveLine(stretches[0]!, undefined, true, true, turns)).toBeUndefined();
  });
});

describe('recordLabel: the live line if the stretch is live and has one; else the stored summary; else nothing', () => {
  it('reads the live line over the summary, the summary once the stretch settles, and nothing with neither', () => {
    const growing = scene(['prompt', { id: 'a', description: 'Read the settings', done: true }, { id: 'b', description: 'Run the linter', done: false }]);
    const labels = { stored: [run('a', 'a', 'Read the settings file')], running: true, turns: growing.turns };
    expect(recordLabel(growing.stretches[0]!, growing.rows, labels, true)).toBe('Run the linter');
    const settled = scene(['prompt', { id: 'a', description: 'Read the settings', done: true }, { id: 'b', description: 'Run the linter', done: true }, 'message']);
    expect(recordLabel(settled.stretches[0]!, settled.rows, { stored: [run('a', 'b', 'Read the settings and linted')], running: false, turns: settled.turns }, false)).toBe('Read the settings and linted');
    expect(recordLabel(settled.stretches[0]!, settled.rows, { stored: [], running: false, turns: settled.turns }, false)).toBeUndefined();
  });

  it('reads a stored summary with no switch among its inputs: a summary made before the switch went off stays (card 11, “Only new folds”)', () => {
    const settled = scene(['prompt', { id: 'a', description: 'Fix the parser', done: true }, 'message']);
    const labels = { stored: [run('a', 'a', 'Fixed the date parser; 212 tests pass')], running: false, turns: settled.turns };
    expect(recordLabel(settled.stretches[0]!, settled.rows, labels, false)).toBe('Fixed the date parser; 212 tests pass');
  });
});

describe('runOf: §M’s one rule, and nothing more', () => {
  it('has no fallback on one bound: a run whose first row is not held reads no run, whatever its last', () => {
    const { stretches, rows, turns } = scene(['prompt', { id: 'b', description: 'Check the links', done: true }, 'message']);
    expect(runOf(stretches[0]!, rows, [run('a', 'b', 'Built the site and checked its links')], turns)).toBeUndefined();
  });

  it('of the runs that hold the line’s row, the newest; else the run that begins nearest after it, the earlier in the file on a tie', () => {
    const { stretches, rows, turns } = scene(['prompt', 'note', { id: 'a', description: 'Read the notes', done: true }, { id: 'b', description: 'Fix a link', done: true }, { id: 'c', description: 'Check the links', done: true }, 'message']);
    const stretch = stretches[0]!;
    // the stretch's first row is the note, n1
    expect(runOf(stretch, rows, [run('n1', 'c', 'older and wider'), run('n1', 'a', 'newer and narrower')], turns)?.summary).toBe('newer and narrower');
    expect(runOf(stretch, rows, [run('n1', 'a', 'older'), run('n1', 'c', 'newer')], turns)?.summary).toBe('newer');
    expect(runOf(stretch, rows, [run('c', 'c', 'nearest but later in the file is not nearest'), run('b', 'c', 'begins at b'), run('b', 'b', 'also at b, later in the file')], turns)?.summary).toBe('begins at b');
    expect(runOf(stretch, rows, [run('b', 'a', 'bounds the wrong way round: holds no row, begins at b')], turns)?.summary).toBe('bounds the wrong way round: holds no row, begins at b');
  });

  it('compares a row’s uuid by its first 24 characters and any other id whole (the mod’s rowKey)', () => {
    const { stretches, rows, turns } = scene(['prompt', { id: 'toolu_a', description: 'Read cache.ts', done: true }, 'message']);
    expect(runOf(stretches[0]!, rows, [run('toolu_', 'toolu_a', 'A prefix of a call’s id is not its id')], turns)).toBeUndefined();
    const text = { id: 'text:x:0', turnId: T, at: AT, kind: 'assistant_text', messageUuid: 'c0ffee00-1111-4222-8333-000000000001', blockIndex: 0, markdown: 'Looking.', live: false, phase: 'commentary', model: null } as unknown as Row;
    const withText = [rows[0]!, text, ...rows.slice(1)];
    expect(runOf(stretchesOf(withText)[0]!, withText, [run('c0ffee00-1111-4222-8333-444444444444', 'toolu_a', 'Looked up the cache settings')], turns)?.summary).toBe('Looked up the cache settings');
  });
});
