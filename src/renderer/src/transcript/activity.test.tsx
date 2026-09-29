// The activity projection and glyph exports C8's summary reads (Public surface, C8's ask): what each turn did whatever
// the reader disclosed, memoised per turn version, and the subagent glyphs as the rows show them.
import type { SessionEvent } from '@shared/graph/events';
import type { TaskId } from '@shared/graph/ids';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadJournal } from '../../../../test/support/fixtures';
import { journalToEvents } from './dev/replay-stub';
import { glyphFor, SUBAGENT_GLYPHS, SubagentGlyph, turnActivity, useTranscriptStore } from './index';
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

// One closed turn: three reads (one path twice) that merge into one read cell, an edit, two commands, one agent.
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
  b.text('m5', 0, 'Done.');
  b.end(['u1']);
  return b;
}

describe('turn activity', () => {
  it('lists what the turn did: every read path once (a merged read cell), the edits with their counts, the tools in first-seen order, the agents', async () => {
    const { activity } = await attached(work().events);
    const [turn] = activity();
    expect(turn).toMatchObject({ turnId: 'turn:u1', origin: 'human', state: 'closed', filesRead: ['/p/a.ts', '/p/b.ts'] });
    expect(turn.filesEdited).toEqual([expect.objectContaining({ path: '/p/a.ts', change: 'update', added: 2, removed: 1 })]);
    expect(turn.tools).toEqual([
      { name: 'Read', category: 'exploration', count: 3 },
      { name: 'Edit', category: 'files', count: 1 },
      { name: 'Bash', category: 'commands', count: 2 },
    ]);
    expect(turn.subagents).toEqual([expect.objectContaining({ taskId: 'agent-1', name: 'Look around', status: 'started', glyph: glyphFor(task('agent-1')) })]);
  });

  it('is the same whether the turn is collapsed, expanded, or a group in it collapsed: the same entry', async () => {
    const { key, activity } = await attached(work().events);
    const before = activity()[0];
    const store = useTranscriptStore.getState();
    store.toggleTurn(key, before.turnId); // open it (a closed turn rests collapsed)
    expect(useTranscriptStore.getState().rows(key).some((row) => row.kind === 'group')).toBe(true);
    expect(activity()[0]).toBe(before);
    const group = useTranscriptStore.getState().rows(key).find((row) => row.kind === 'group')!;
    store.toggleGroup(key, group.id);
    store.toggleGroup(key, group.id);
    expect(activity()[0]).toBe(before);
    store.toggleTurn(key, before.turnId); // collapsed again: the rows drop the work, the activity does not
    expect(useTranscriptStore.getState().rows(key).some((row) => row.kind === 'group' || row.kind === 'subagent')).toBe(false);
    expect(activity()[0]).toBe(before);
    expect(activity()).toBe(activity()); // a stable list for store selectors
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
    expect(activity()[1]).toMatchObject({ turnId: 'turn:u2', state: 'open', tools: [{ name: 'Bash', category: 'commands', count: 1 }] });

    const finish = builder('2026-09-28T11:00:05.000Z');
    finish.emit('subagent.finished', { taskId: task('agent-1'), status: 'failed', summary: null, outputFile: null, reason: null }, { id: 'finish' });
    push(finish.events);
    expect(activity()[0]).not.toBe(first);
    expect(activity()[0].subagents).toEqual([expect.objectContaining({ taskId: 'agent-1', status: 'finished_with_errors' })]);
  });

  it('excludes child-agent cells: pass1/subagent lists the parent’s agents, not their Read calls', async () => {
    const { activity } = await attached(journalToEvents(loadJournal('pass1', 'subagent')));
    const [human] = activity();
    expect(human.subagents.map((agent) => [agent.taskId, agent.status])).toEqual([
      ['ad286defbc77bc090', 'finished'],
      ['ae75ba6ce5d866acc', 'finished'],
    ]);
    expect(human.tools.map((tool) => tool.name)).not.toContain('Read');
    expect(human.filesRead).toEqual([]);
    expect(turnActivity(useTranscriptStore.getState().entries[Object.keys(useTranscriptStore.getState().entries)[0]].state)).toBe(activity());
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
