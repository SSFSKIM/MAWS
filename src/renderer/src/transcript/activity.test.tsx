// The activity projection and glyph exports C8's summary reads (Public surface, C8's ask): what each turn did whatever
// the reader disclosed, memoised per turn version, and the subagent glyphs as the rows show them.
import type { SessionEvent } from '@shared/graph/events';
import type { TaskId } from '@shared/graph/ids';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadJournal, loadSyntheticJournal } from '../../../../test/support/fixtures';
import { journalToEvents } from './dev/replay-stub';
import { glyphFor, SUBAGENT_GLYPHS, SubagentGlyph, turnActivity, useTranscriptStore } from './index';
import { turnDerivations } from './model/derive';
import { BASH_RESULT, builder, task, tool } from './model/test-events';
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
    expect(activity()[0].files.map((file) => file.path)).toEqual(['/p/a.ts', '/p', '/p/n.ipynb', '/p/b.ts']);
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
