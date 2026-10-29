// The `Agent` calls of a lane A transcript (P5 O9, the M10 sitting), through MAWS's own store and reducer. A terminal
// session's engine runs an agent in the background, so the turn that started it ends at once while it works; the row of
// its call stays in view until every agent it names has ended, as a turn still running keeps it, then folds with the
// turn's other work.
import type { JsonObject, SubagentMeta } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../stores/transcript';
import type { Row } from '../../transcript/model/rows';
import { backgroundAgent, Chain, SESSION } from '../test-support/chain-rows';
import { freshSource, subagentLookupOf } from '../plane-transcript';
import { rowsOf } from '../../transcript/model/derive';
import { applyEvents, createState, withUi, type TranscriptState } from '../../transcript/model/reduce';
import { rowId } from '../../transcript/model/keys';
import { builder, task, tool, uuid } from '../../transcript/model/test-events';

async function drawn(rows: JsonObject[], metas: SubagentMeta[]): Promise<Row[]> {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf(metas)), { agentId: null as never });
  return store.getState().entries.fresh.rows;
}

const agentRows = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'subagent' ? [[row.agents.map((ref) => ref.name), row.status]] : []));

describe('a turn that started agents in the background', () => {
  const fanOut = () => {
    const c = new Chain('c4a10000', 'sminos');
    c.prompt('Spawn two subagents.');
    c.backgroundAgentCall('toolu_a', 'agent-a', 'Branch A');
    c.backgroundAgentCall('toolu_b', 'agent-b', 'Branch B');
    c.answer('I launched both.');
    c.end();
    return c;
  };
  const metas = [backgroundAgent('agent-a', 'toolu_a', 'Branch A'), backgroundAgent('agent-b', 'toolu_b', 'Branch B')];

  it('ended while they work: the row of each call stays in view under the folded turn', async () => {
    const rows = await drawn(fanOut().rows, metas);
    const turn = rows.find((row) => row.kind === 'user' && row.text === 'Spawn two subagents.')!.turnId;
    expect(rows.find((row) => row.kind === 'divider' && row.turnId === turn)).toMatchObject({ state: 'completed', expanded: false });
    expect(agentRows(rows)).toEqual([[['Branch A'], 'started'], [['Branch B'], 'started']]);
  });

  it('one ended: only the other’s row stays; both ended: both fold with the turn', async () => {
    const c = fanOut();
    c.agentEnded('agent-a', 'toolu_a');
    c.answer('Branch A is done.');
    c.end();
    expect(agentRows(await drawn(c.rows, metas))).toEqual([[['Branch B'], 'started']]);
    c.agentEnded('agent-b', 'toolu_b', 'killed');
    c.answer('Branch B was stopped.');
    c.end();
    expect(agentRows(await drawn(c.rows, metas))).toEqual([]);
  });
});

// The review of the fix above: a session's process exiting ends the agents it ran, though no finish of theirs comes
// (lane B's crash or kill, which the normaliser reports as `process.exited` alone). Their call's row folds with its
// turn, reading stopped; an ordinary end of the turn ends no agent. Through MAWS's reducer, each arrival its own batch.
describe('an Agent call whose session’s process exits', () => {
  const started = () => {
    const b = builder();
    b.turn('u1', 'Spawn an agent.');
    b.toolUse('a1', 'Agent', { description: 'Survey', prompt: 'p' }, 'm1', 0);
    b.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('a1'), description: 'Survey', subagentType: null, isBackground: true, spawnDepth: 1, prompt: null });
    b.emit('subagent.progress', { taskId: task('k1'), description: 'Survey', usage: { totalTokens: 1, toolUses: 1, durationMs: 1 }, lastToolName: 'Read', summary: null });
    return b;
  };
  const shown = (state: TranscriptState) => rowsOf(state).flatMap((row) => (row.kind === 'subagent' ? [row.status] : []));
  const expanded = (state: TranscriptState) =>
    rowsOf({ ...state, memo: new Map(), ui: { ...state.ui, expandedTurns: new Set(state.order), collapsedTurns: new Set(), version: -1 } }).flatMap((row) => (row.kind === 'subagent' ? [row.status] : []));
  const exit = (at: number, reason: 'crash' | 'stop') => {
    const b = builder(new Date(at).toISOString());
    b.emit('process.exited', { code: null, signal: reason === 'crash' ? 'SIGKILL' : null, reason, lostAttentionCount: 0, budget: null }, { id: `exit-${reason}` });
    return b.events;
  };

  it('ended with its turn while the agent works: the row stays in view; the process then crashing folds it, stopped', () => {
    const b = started();
    b.end(['u1']);
    let state = applyEvents(createState(null, null), b.events);
    expect(shown(state)).toEqual(['working']);
    state = applyEvents(state, exit(b.at + 1_000, 'crash'));
    expect(shown(state)).toEqual([]);
    expect(expanded(state)).toEqual(['stopped']);
  });

  it('a turn the process exit closes: its working agent reads stopped and folds with it', () => {
    const b = started();
    let state = applyEvents(createState(null, null), b.events);
    state = applyEvents(state, exit(b.at + 1_000, 'stop'));
    expect(shown(state)).toEqual([]);
    expect(expanded(state)).toEqual(['stopped']);
  });

  it('in a branch a rewind hid, shown revealed: the process then exiting folds its row too', () => {
    const b = started();
    b.end(['u1']);
    b.turn('u2', 'Go on.');
    b.end(['u2']);
    const rewind = b.emit('boundary.rewind', { targetMessageUuid: uuid('u1'), precedingAssistantUuid: null, prefillText: 'Spawn an agent.' });
    b.turn('u3', 'Something else.');
    b.end(['u3']);
    const hidden = applyEvents(createState(null, null), b.events);
    const revealed = withUi(hidden, { ...hidden.ui, revealedBoundaries: new Set([rowId.boundary(rewind.id)]), global: hidden.ui.global + 1, version: hidden.ui.version + 1 }); // as the store's toggleBoundary
    expect(shown(revealed)).toEqual(['working']); // the hidden turn's rows, derived and kept
    expect(shown(applyEvents(revealed, exit(b.at + 1_000, 'crash')))).toEqual([]);
  });

  it('an exit before the call (an earlier process’s) ends none of its agents', () => {
    const earlier = exit(Date.parse('2026-09-28T09:00:00.000Z'), 'stop');
    const b = started();
    b.end(['u1']);
    const state = applyEvents(applyEvents(createState(null, null), earlier), b.events);
    expect(shown(state)).toEqual(['working']);
  });
});

