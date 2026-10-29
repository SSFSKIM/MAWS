// Slash commands in a lane A transcript (P5 O9, the M10 sitting), through MAWS's own store and reducer, on rows in the
// shapes 2.1.312 wrote them in the sitting's transcript (`test-support/chain-rows.ts`): a command typed at the terminal
// is the person's bubble in a turn that ends where it starts, never a turn left working; the context a command the
// bridge ran gives the model (a `/rename`'s system reminder) is the model's alone, never the person's words. Each is
// read from a fresh load and as the rows arrive live.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../stores/transcript';
import type { Row } from '../../transcript/model/rows';
import { isBridgeRow } from '../conversation/delivery-frame';
import { Chain, renamed, SESSION } from '../test-support/chain-rows';
import { FakePlane, mount, settle } from '../test-support/fake-plane';
import { PlaneTranscript, freshSource, subagentLookupOf } from '../plane-transcript';
import { bridgeRowKind } from './bridge-rows';

type Drawn = { rows: Row[]; turns: Array<{ state: string }>; working: boolean };

async function fresh(rows: JsonObject[]): Promise<Drawn> {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf([])), { agentId: null as never });
  const entry = store.getState().entries.fresh;
  return { rows: entry.rows, turns: entry.state.order.map((id) => entry.state.turns.get(id)!), working: entry.working };
}

/** The rows as they arrive: a snapshot of the first `cut`, then each later one live. */
async function live(rows: JsonObject[], cut: number): Promise<Drawn> {
  const plane = new FakePlane('proj');
  const store = createTranscriptStore();
  const controller = new PlaneTranscript({ plane, sessionKey: 'mini/sess', target: { machine: 'mini', session: SESSION, agentId: null }, store });
  controller.open();
  const unmount = mount(controller, store);
  plane.send('snapshot', { rows: rows.slice(0, cut).toReversed(), more: false, subagents: [], streaming: [] } as never);
  await settle();
  for (const row of rows.slice(cut)) {
    plane.send('row', { row } as never);
    await settle();
  }
  await settle();
  const entry = store.getState().entries[controller.key];
  unmount();
  controller.close();
  return { rows: entry.rows, turns: entry.state.order.map((id) => entry.state.turns.get(id)!), working: entry.working };
}

const bubbles = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'user' ? [row.text] : []));
const workingDividers = (rows: Row[]) => rows.filter((row) => row.kind === 'divider' && row.state === 'working');

describe('a command typed at the terminal', () => {
  const sitting = () => {
    const c = new Chain('c4a10000', 'sminos');
    c.prompt('Rename master to main.');
    c.answer('Done.');
    c.end();
    const at = c.rows.length;
    c.terminalCommand('model', 'haiku', 'Set model to `Haiku 5.5` and saved as your default for new sessions');
    c.terminalCommand('effort', 'low', 'Set effort level to low (saved as your default for new sessions): Quick, straightforward implementation with minimal overhead');
    return { rows: c.rows, at };
  };

  it.each([
    ['a fresh load', (rows: JsonObject[]) => fresh(rows)],
    ['rows arriving live', (rows: JsonObject[], at: number) => live(rows, at)],
  ] as const)('%s: each is the person’s bubble in a turn that has ended, none working', async (_how, draw) => {
    const { rows, at } = sitting();
    const drawn = await draw(rows, at);
    expect(bubbles(drawn.rows)).toEqual(['Rename master to main.', '/model haiku', '/effort low']);
    expect(drawn.turns.map((turn) => turn.state)).toEqual(['closed', 'closed', 'closed']);
    expect(workingDividers(drawn.rows)).toEqual([]);
    expect(drawn.working).toBe(false);
  });
});

describe('the context a command the bridge ran gives the model', () => {
  const sitting = () => {
    const c = new Chain('c4a10000', 'sminos');
    c.prompt('Run a background shell.');
    c.answer('It runs.');
    c.end();
    const at = c.rows.length;
    const context = c.pluginCommand('rename', 'o9-remote', 'Session renamed to: o9-remote', renamed('o9-remote'));
    c.prompt('Spawn two subagents.');
    c.answer('Launched.');
    c.end();
    return { rows: c.rows, at, context };
  };

  it('is no row the bridge appended: neither a steer nor any of its kinds', () => {
    const { context } = sitting();
    expect(isBridgeRow(context)).toBe(false);
    expect(bridgeRowKind(context)).toBeNull();
    // The bridge's own appends keep their kinds: a steer the person sent stays one.
    const c = new Chain('c4a10000', 'sminos');
    expect(bridgeRowKind(c.steer('use the split store'))).toBe('steer');
  });

  it.each([
    ['a fresh load', (rows: JsonObject[]) => fresh(rows)],
    ['rows arriving live', (rows: JsonObject[], at: number) => live(rows, at)],
  ] as const)('%s: draws no bubble, in its own turn or the next', async (_how, draw) => {
    const { rows, at } = sitting();
    const drawn = await draw(rows, at);
    expect(bubbles(drawn.rows)).toEqual(['Run a background shell.', 'Spawn two subagents.']);
    expect(drawn.rows.some((row) => row.kind === 'user' && row.text.includes('The user named this session'))).toBe(false);
    expect(drawn.rows.flatMap((row) => (row.kind === 'local_command' ? [row.text] : []))).toEqual(['Session renamed to: o9-remote']);
  });
});
