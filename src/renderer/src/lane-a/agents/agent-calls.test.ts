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
