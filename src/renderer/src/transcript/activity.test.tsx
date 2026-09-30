// The activity projection and glyph exports C8's summary reads (Public surface, C8's ask): what each turn did whatever
// the reader disclosed, memoised per turn version, and the subagent glyphs as the rows show them.
import type { SessionEvent } from '@shared/graph/events';
import type { TaskId } from '@shared/graph/ids';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadJournal, loadSyntheticJournal } from '../../../../test/support/fixtures';
import { journalToEvents } from './dev/journal';
import { glyphFor, SUBAGENT_GLYPHS, SubagentGlyph, turnActivity, useTranscriptStore } from './index';
import { turnDerivations } from './model/derive';
import { api, BASH_RESULT, builder, parent, task, tool, uuid } from './model/test-events';
import type { TranscriptSource } from './source/types';

let keys = 0;
async function attached(events: SessionEvent[]) {
  const key = `activity-${++keys}`;
  let push: (batch: SessionEvent[]) => void = () => {};
  const source: TranscriptSource = {
    subscribe(listener) {
      push = listener;
      return () => {};
    },
    snapshot: () => Promise.resolve(events),
  };
  await useTranscriptStore.getState().attach(key, source);
  return { key, push: (batch: SessionEvent[]) => push(batch), activity: () => useTranscriptStore.getState().activity(key) };
}

afterEach(() => {
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
});

// One closed turn: three reads (one path twice) that merge into one read cell, an edit, two commands, one agent, a
// fetch and an MCP call.
function work() {
  const b = builder();
  b.turn('u1');
  b.toolUse('r1', 'Read', { file_path: '/p/a.ts' }, 'm1', 0);
  b.result('r1', 'a');
  b.toolUse('r2', 'Read', { file_path: '/p/b.ts' }, 'm1', 1);
  b.result('r2', 'b');
  b.toolUse('r3', 'Read', { file_path: '/p/a.ts' }, 'm1', 2);
  b.result('r3', 'a');
  b.toolUse('e1', 'Edit', { file_path: '/p/a.ts', old_string: 'a', new_string: 'b\nc' }, 'm2', 0);
  b.result('e1', 'ok');
  b.toolUse('b1', 'Bash', { command: 'pnpm test' }, 'm3', 0);
  b.result('b1', 'ok', { structured: BASH_RESULT('ok') });
  b.toolUse('b2', 'Bash', { command: 'pnpm lint' }, 'm3', 1);
  b.result('b2', 'ok', { structured: BASH_RESULT('ok') });
  b.toolUse('a1', 'Agent', { description: 'Look around', prompt: 'look' }, 'm4', 0);
  b.emit('subagent.started', { taskId: task('agent-1'), toolUseId: tool('a1'), description: 'Look around', subagentType: 'general-purpose', isBackground: true, spawnDepth: 1, prompt: 'look' });
  b.toolUse('w1', 'WebFetch', { url: 'https://example.com/docs', prompt: 'summarise' }, 'm6', 0);
  b.result('w1', 'docs');
  b.toolUse('p1', 'mcp__linear__get_issue', { id: 'ENG-1' }, 'm7', 0);
  b.result('p1', 'issue');
  b.text('m5', 0, 'Done.');
  b.end(['u1']);
  return b;
}

describe('turn activity', () => {
  it('lists what the turn did, one entry per use: files read and edited (with the edit cell’s detail), tools with their url and MCP names, the agents', async () => {
    const b = work();
    const { activity } = await attached(b.events);
    const [turn] = activity();
    expect(turn).toMatchObject({ turnId: 'turn:u1', origin: 'human', state: 'closed', startedAt: b.events[0].at, endedAt: b.events.at(-1)!.at });
    expect(turn.files.map(({ path, use }) => [path, use])).toEqual([
      ['/p/a.ts', 'read'],
      ['/p/b.ts', 'read'],
      ['/p/a.ts', 'read'],
      ['/p/a.ts', 'edited'],
    ]);
    expect(turn.files.slice(0, 3).map((file) => file.edit)).toEqual([null, null, null]);
    expect(turn.files[3].edit).toMatchObject({ kind: 'edit', filePath: '/p/a.ts', change: 'update', added: 2, removed: 1 });
    expect(turn.files[3].at).toBe(b.events.find((event) => event.kind === 'tool.use' && event.toolUseId === 'e1')!.at);
    expect(turn.tools.map(({ name, category, url, mcp }) => [name, category, url, mcp])).toEqual([
      ['Read', 'exploration', null, null],
      ['Read', 'exploration', null, null],
      ['Read', 'exploration', null, null],
      ['Edit', 'files', null, null],
      ['Bash', 'commands', null, null],
      ['Bash', 'commands', null, null],
      ['WebFetch', 'web', 'https://example.com/docs', null],
      ['mcp__linear__get_issue', 'mcp', null, { server: 'linear', tool: 'get_issue' }],
    ]);
    expect(turn.subagents).toEqual([expect.objectContaining({ taskId: 'agent-1', name: 'Look around', status: 'started', glyph: glyphFor(task('agent-1')) })]);
  });

  // C8c (M6): the projection's edited set equals the receipt's file list, so a child agent's completed edit, which the
  // receipt attributes to the turn, is an edited file of the turn with its own edit detail.
  it('lists a child agent’s completed edit as an edited file of the turn, with its edit detail, expanded or collapsed', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('a1', 'Agent', { description: 'Fix it', prompt: 'fix' }, 'm1', 0);
    b.emit('subagent.started', { taskId: task('agent-1'), toolUseId: tool('a1'), description: 'Fix it', subagentType: 'general-purpose', isBackground: false, spawnDepth: 1, prompt: 'fix' });
    const child = { parentToolUseId: parent('a1') };
    b.emit('tool.use', { toolUseId: tool('c1'), toolName: 'Edit', input: { file_path: '/p/child.ts', old_string: 'a', new_string: 'b' }, apiMessageId: api('mc'), messageUuid: uuid('mc-u0') }, child);
    const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] };
    b.emit('tool.result', { toolUseId: tool('c1'), content: 'ok' as never, isError: false, structured: { filePath: '/p/child.ts', structuredPatch: [hunk], userModified: false }, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: uuid('c1-result') }, child);
    b.emit('tool.use', { toolUseId: tool('c2'), toolName: 'Edit', input: { file_path: '/p/refused.ts', old_string: 'a', new_string: 'b' }, apiMessageId: api('mc'), messageUuid: uuid('mc-u1') }, child);
    b.emit('tool.result', { toolUseId: tool('c2'), content: 'no' as never, isError: true, structured: null, spillPath: null, denial: 'permission-rule', safeguard: 'not_evaluated', messageUuid: uuid('c2-result') }, child);
    b.emit('subagent.finished', { taskId: task('agent-1'), status: 'completed', summary: 'done', outputFile: null, reason: null });
    b.text('m2', 0, 'Done.');
    b.end(['u1']);
    const { key, activity } = await attached(b.events);
    const collapsed = activity();
    const receipt = useTranscriptStore.getState().rows(key).find((row) => row.kind === 'receipt');
    expect(receipt?.kind === 'receipt' && receipt.files.map((file) => file.path)).toEqual(['/p/child.ts']);
    expect(collapsed[0].files).toEqual([
      { path: '/p/child.ts', use: 'edited', at: b.events.find((event) => event.kind === 'tool.use' && event.toolUseId === 'c1')!.at, edit: { kind: 'edit', filePath: '/p/child.ts', change: 'update', hunks: [hunk], added: 1, removed: 1 } },
    ]);
    const snapshot = JSON.parse(JSON.stringify(collapsed));
    useTranscriptStore.getState().expandAll(key, { cells: true });
    expect(JSON.parse(JSON.stringify(activity()))).toEqual(snapshot);
  });

  it('a refused or failed call touched no file: it is a tool use, not a file entry', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('e1', 'Edit', { file_path: '/p/a.ts', old_string: 'a', new_string: 'b' }, 'm1', 0);
    b.result('e1', 'denied', { isError: true, denial: 'permission-rule' });
    b.toolUse('r1', 'Read', { file_path: '/p/missing.ts' }, 'm2', 0);
    b.result('r1', 'File does not exist.', { isError: true });
    b.end(['u1']);
    const { activity } = await attached(b.events);
    expect(activity()[0].files).toEqual([]);
    expect(activity()[0].tools.map((tool) => tool.name)).toEqual(['Edit', 'Read']);
  });

  it('a fixture’s projection is identical with every turn expanded and with every turn collapsed, edits included', async () => {
    const { key, activity } = await attached(journalToEvents(loadSyntheticJournal('edit-and-receipt')));
    const collapsed = activity();
    const snapshot = JSON.parse(JSON.stringify(collapsed));
    expect(collapsed.flatMap((turn) => turn.files).some((file) => file.edit !== null)).toBe(true);
    useTranscriptStore.getState().expandAll(key, { cells: true });
    expect(useTranscriptStore.getState().rows(key).some((row) => row.kind === 'group' || row.kind === 'cell')).toBe(true);
    expect(activity()).toBe(collapsed); // a ui change recomputes nothing
    expect(JSON.parse(JSON.stringify(activity()))).toEqual(snapshot);
    for (const turn of useTranscriptStore.getState().entries[key].state.order) useTranscriptStore.getState().toggleTurn(key, turn);
    expect(useTranscriptStore.getState().rows(key).some((row) => row.kind === 'group' || row.kind === 'cell')).toBe(false);
    expect(activity()).toBe(collapsed);
  });

  // Whole-branch review: every delta batch clones the open turn without changing its version, so an entry keyed on
  // the TurnState reference churned C8a's summary at the delta rate.
  it('keeps a streaming turn’s entry, and the list, through deltas that change no version', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('b1', 'Bash', { command: 'ls' }, 'm1', 0);
    const delta = (id: string, piece: string) =>
      b.emit('assistant.block.delta', { apiMessageId: api('m2'), blockIndex: 0, blockType: 'text', textDelta: piece, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null }, { id });
    delta('d1', 'Str');
    const { push, activity } = await attached(b.events);
    const first = activity();
    push([delta('d2', 'eam')]);
    expect(activity()[0]).toBe(first[0]);
    push([delta('d3', 'ing')]);
    expect(activity()[0]).toBe(first[0]);
    expect(activity()).toBe(first);
  });

  it('keeps an unchanged turn’s entry when another turn changes, and a child’s status turns terminal with its finish', async () => {
    const b = work();
    const { push, activity } = await attached(b.events);
    const first = activity()[0];
    const later = builder('2026-09-28T11:00:00.000Z');
    later.turn('u2');
    later.toolUse('b9', 'Bash', { command: 'ls' }, 'm9', 0);
    push(later.events.map((event) => ({ ...event, id: `later-${event.id}` as never })));
    expect(activity()).toHaveLength(2);
    expect(activity()[0]).toBe(first);
    expect(activity()[1]).toMatchObject({ turnId: 'turn:u2', state: 'open', endedAt: null, tools: [expect.objectContaining({ name: 'Bash', category: 'commands' })] });

    const finish = builder('2026-09-28T11:00:05.000Z');
    finish.emit('subagent.finished', { taskId: task('agent-1'), status: 'failed', summary: null, outputFile: null, reason: null }, { id: 'finish' });
    push(finish.events);
    expect(activity()[0]).not.toBe(first);
    expect(activity()[0].subagents).toEqual([expect.objectContaining({ taskId: 'agent-1', status: 'finished_with_errors' })]);
  });

  it('keeps each call of a merged read cell under its own tool name', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('r1', 'Read', { file_path: '/p/a.ts' }, 'm1', 0);
    b.result('r1', 'a');
    b.toolUse('l1', 'LS', { path: '/p' }, 'm1', 1);
    b.result('l1', 'a.ts\nb.ts');
    b.toolUse('n1', 'NotebookRead', { notebook_path: '/p/n.ipynb' }, 'm1', 2);
    b.result('n1', '{}');
    b.toolUse('r2', 'Read', { file_path: '/p/b.ts' }, 'm1', 3);
    b.result('r2', 'b');
    b.text('m2', 0, 'Done.');
    b.end(['u1']);
    const { activity } = await attached(b.events);
    expect(activity()[0].tools.map((tool) => tool.name)).toEqual(['Read', 'LS', 'NotebookRead', 'Read']);
    expect(activity()[0].files.map((file) => file.path)).toEqual(['/p/a.ts', '/p/n.ipynb', '/p/b.ts']);
  });

  it('lists no search scope as a file: Grep, Glob and LS name directories, so only the file reads count', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('g1', 'Grep', { pattern: 'x', path: 'src' }, 'm1', 0);
    b.result('g1', 'src/a.ts');
    b.toolUse('g2', 'Glob', { pattern: '**/*.ts', path: '/p/src' }, 'm1', 1);
    b.result('g2', '/p/src/a.ts');
    b.toolUse('l1', 'LS', { path: '/p' }, 'm1', 2);
    b.result('l1', 'src');
    b.toolUse('r1', 'Read', { file_path: '/p/src/a.ts' }, 'm1', 3);
    b.result('r1', 'a');
    b.text('m2', 0, 'Done.');
    b.end(['u1']);
    const { activity } = await attached(b.events);
    expect(activity()[0].tools.map((tool) => tool.name)).toEqual(['Grep', 'Glob', 'LS', 'Read']);
    expect(activity()[0].files.map(({ path, use }) => [path, use])).toEqual([['/p/src/a.ts', 'read']]);
  });

  it('counts a Grep whose result shows its path was a single file as a read of that file, and no directory scope', async () => {
    // The structured results are 2.1.283's Grep `data` shapes (files_with_matches, count, content); filenames are
    // cwd-relative, and a file target's content lines carry no path prefix.
    const b = builder();
    b.turn('u1');
    const grep = (id: string, input: Record<string, unknown>, structured: Record<string, unknown>) => {
      b.toolUse(id, 'Grep', { pattern: 'x', ...input }, 'm1', 0);
      b.result(id, 'r', { structured });
    };
    grep('f1', { path: '/p/src/a.ts' }, { mode: 'files_with_matches', filenames: ['src/a.ts'], numFiles: 1 });
    grep('f2', { path: '/p/src' }, { mode: 'files_with_matches', filenames: ['src/b.ts'], numFiles: 1 });
    grep('f3', { path: 'lib' }, { mode: 'files_with_matches', filenames: ['lib/x/lib'], numFiles: 1 });
    grep('c1', { path: 'src/c.ts', output_mode: 'count' }, { mode: 'count', numFiles: 1, filenames: [], content: 'src/c.ts:3', numMatches: 3 });
    grep('c2', { path: 'src', output_mode: 'count' }, { mode: 'count', numFiles: 1, filenames: [], content: 'src/c.ts:3', numMatches: 3 });
    grep('n1', { path: '/p/src/d.ts', output_mode: 'content', '-C': 1 }, { mode: 'content', numFiles: 0, filenames: [], content: '4-a\n5:x\n6-b\n--\n9:x', numLines: 5 });
    grep('n2', { path: '/p/src', output_mode: 'content' }, { mode: 'content', numFiles: 0, filenames: [], content: 'src/d.ts:5:x', numLines: 1 });
    grep('n3', { path: '/p/src/e.ts', output_mode: 'content', '-n': false }, { mode: 'content', numFiles: 0, filenames: [], content: 'x', numLines: 1 });
    grep('z1', { path: '/p/src/f.ts' }, { mode: 'files_with_matches', filenames: [], numFiles: 0 });
    b.toolUse('e1', 'Grep', { pattern: 'x', path: '/p/src/g.ts' }, 'm1', 0);
    b.result('e1', 'boom', { isError: true, structured: { mode: 'files_with_matches', filenames: ['/p/src/g.ts'], numFiles: 1 } });
    b.text('m2', 0, 'Done.');
    b.end(['u1']);
    const { activity } = await attached(b.events);
    expect(activity()[0].files.map(({ path, use }) => [path, use])).toEqual([
      ['/p/src/a.ts', 'read'],
      ['src/c.ts', 'read'],
      ['/p/src/d.ts', 'read'],
    ]);
  });

  it('reads the per-turn derivation the rows already made: no second derivation, the same entry while the turn is unchanged', async () => {
    const { key, activity } = await attached(work().events);
    useTranscriptStore.getState().rows(key); // the store derived the rows when the batch applied
    const before = turnDerivations.count;
    const first = activity()[0];
    expect(turnDerivations.count).toBe(before);
    useTranscriptStore.getState().toggleTurn(key, first.turnId); // a ui change re-derives the turn's rows...
    expect(activity()[0]).toBe(first); // ...and the entry stays
  });

  it('excludes child-agent cells: pass1/subagent lists the parent’s agents, not their Read calls', async () => {
    const { key, activity } = await attached(journalToEvents(loadJournal('pass1', 'subagent')));
    const [human] = activity();
    expect(human.subagents.map((agent) => [agent.taskId, agent.status])).toEqual([
      ['ad286defbc77bc090', 'finished'],
      ['ae75ba6ce5d866acc', 'finished'],
    ]);
    expect(human.tools.map((tool) => tool.name)).not.toContain('Read');
    expect(human.files).toEqual([]);
    expect(turnActivity(useTranscriptStore.getState().entries[key].state)).toBe(activity());
  });

  it('is empty for a key with no entry', () => {
    expect(useTranscriptStore.getState().activity('no-such-key')).toEqual([]);
  });
});

describe('subagent glyphs', () => {
  it('are the eight marks, chosen by the task id’s hash, rendered as the row renders them', () => {
    expect(SUBAGENT_GLYPHS).toHaveLength(8);
    const id = 'ad286defbc77bc090' as TaskId;
    expect(glyphFor(id)).toBe(glyphFor(id));
    expect(glyphFor(id)).toBeGreaterThanOrEqual(0);
    expect(glyphFor(id)).toBeLessThan(8);
    const view = render(
      <SubagentGlyph agent={{ taskId: id, agentId: null, toolUseId: null, name: 'One', glyph: glyphFor(id), kind: 'agent', subagentType: null }} className="summary-glyph" />,
    );
    expect(view.container.querySelector('.summary-glyph')?.textContent).toBe(SUBAGENT_GLYPHS[glyphFor(id)]);
  });
});
