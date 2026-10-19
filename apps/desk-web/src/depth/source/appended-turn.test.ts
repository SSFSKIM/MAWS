// The turn a row the bridge appended belongs to (`appended-turn.ts`), through MAWS's own store, reducer and report, on
// rows in the shapes the engine and the bridge write them (`test/double/chain-rows.ts`, after doperpowers #238's probe
// runs): a steer or a delivery appended after its turn ended (the race with the turn's end; the owner's message after an
// Esc) opens the turn the bridge's wake starts, which closes; one appended into a running turn is that turn's; the
// bridge's mirror of either is not drawn.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { reportRows } from '../../../../../src/renderer/src/owner/report/project';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import { Chain, frame, SESSION, wakeAfterStop, wakeForNote } from '../../../test/double/chain-rows';
import { FakePlane, mount, settle } from '../../../test/double/fake-plane';
import { WAKE_SENDER, WAKE_TEXT } from './bridge-wake';
import { DeskTranscript, freshSource, subagentLookupOf } from './desk-transcript';

type User = Extract<Row, { kind: 'user' }>;

async function drawn(rows: JsonObject[], off: JsonObject[] = []) {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf([]), null, new Set(off.map((row) => row.uuid as string))), { agentId: null as never });
  const entry = store.getState().entries.fresh;
  const turns = entry.state.order.map((id) => entry.state.turns.get(id)!);
  return { rows: entry.rows, report: reportRows(entry.rows, entry.state, {}), entry, turns };
}
const user = (rows: Row[], text: string) => rows.find((row): row is User => row.kind === 'user' && row.text === text);
const notices = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'error' ? [row.text] : []));
/** The notices the store holds, folded turns' too: the bridge's mirror lines would be among them. */
const held = (entry: { state: { turns: Map<unknown, { events: { kind: string }[] }>; loose: { kind: string }[] } }) =>
  [...[...entry.state.turns.values()].flatMap((turn) => turn.events), ...entry.state.loose].flatMap((event) => (event.kind === 'notice.posted' ? [(event as unknown as { text: string }).text] : []));
const turnOf = (rows: Row[], text: string) => rows.find((row) => row.kind === 'assistant_text' && row.markdown === text)?.turnId;
const LINE = `${WAKE_SENDER}: ${WAKE_TEXT}`;

describe('a row the bridge appended while no turn ran', () => {
  // Under either plugin the bridge runs in: doperpowers before the roll, sminos after (doperpowers' sminos plugin design, §11).
  it.each(['doperpowers', 'sminos'] as const)('%s: a steer that lands after its turn’s end leaves that turn closed, waits as a prompt, and opens the turn the wake starts', async (plugin) => {
    const c = new Chain('c4a10000', plugin);
    c.prompt('List the files.');
    c.answer('Two files.');
    c.end();
    const steer = c.appended('use the split store');
    // Prompt, answer, `turn_duration`, appended steer: the turn stays closed, and nothing reads working.
    const before = await drawn(c.rows);
    expect(before.turns[0].state).toBe('closed');
    expect(before.rows.some((row) => row.kind === 'divider' && row.state === 'working')).toBe(false);
    expect(user(before.rows, 'use the split store')).toMatchObject({ steer: false, dropped: false });
    expect(user(before.rows, 'use the split store')!.pending).toBeUndefined();
    // The bridge wakes the session for it: the steer opens the turn that answers it, and the turn ends.
    c.mirror('steer', 'use the split store');
    c.userWake(wakeForNote);
    c.answer('Switching to the split store.');
    c.end();
    const { rows, report, turns, entry } = await drawn(c.rows);
    for (const drawnRows of [rows, report]) {
      const bubble = user(drawnRows, 'use the split store')!;
      expect(bubble).toMatchObject({ steer: false, dropped: false, messageUuid: steer.uuid });
      expect(bubble.pending).toBeUndefined();
      expect(bubble.turnId).toBe(turnOf(drawnRows, 'Switching to the split store.'));
      expect(notices(drawnRows)).toEqual([LINE]);
    }
    expect(turns.map((turn) => [turn.state, turn.accepted, turn.origin])).toEqual([
      ['closed', true, 'human'],
      ['closed', true, 'human'],
    ]);
    expect(entry.working).toBe(false);
    expect(held(entry)).toEqual([]); // the steer's mirror line is the terminal's
  });

  it('the owner’s message after an Esc (doperpowers #238) opens the wake’s turn: never waiting, no mirror, the turn ends', async () => {
    const c = new Chain();
    c.prompt('Run exactly this Bash command, then reply in one short sentence.');
    const call = c.call('toolu_e1');
    c.result('toolu_e1', call);
    c.marker(true);
    const delivery = c.delivery('c9f082da', 'Include the word LYCHEE in your reply.');
    c.mirror('delivered', `${frame('c9f082da')}\nInclude the word LYCHEE in your reply.`);
    c.inboxWake(wakeAfterStop([frame('c9f082da')]));
    c.assistant([{ type: 'thinking', thinking: 'The message asks for a word.', signature: 'sig' }]);
    c.answer('LYCHEE. The sleep command was interrupted before it ran.');
    c.end();
    const { rows, report, turns, entry } = await drawn(c.rows);
    for (const drawnRows of [rows, report]) {
      const bubble = user(drawnRows, 'Include the word LYCHEE in your reply.')!;
      expect(bubble).toMatchObject({ steer: false, dropped: false, messageUuid: delivery.uuid });
      expect(bubble.pending).toBeUndefined();
      expect(bubble.turnId).toBe(turnOf(drawnRows, 'LYCHEE. The sleep command was interrupted before it ran.'));
      expect(notices(drawnRows)).toEqual([LINE]);
    }
    // The mirror line is the terminal's: the bubble is drawn, the line is not.
    expect(held(entry)).toEqual([]);
    expect(turns.map((turn) => turn.state)).toEqual(['closed', 'closed']);
    expect(rows.flatMap((row) => (row.kind === 'divider' ? [row.state] : []))).toEqual(['stopped', 'completed']);
    expect(entry.working).toBe(false);
  });

  it('an Esc before the model answered (after-esc): the delivery lands in the wake’s turn once the abandoned prompt is off the chain', async () => {
    const c = new Chain();
    c.prompt('Write a poem about rivers.');
    c.answer('Rivers run.');
    const ended = c.end();
    const abandoned = c.prompt('Write a 150-word poem about lakes. Use no tools.');
    const context = c.attachment();
    // The Esc handed the prompt back; the bridge appended the owner's message under the same point, taking it off.
    const delivery = c.delivery('86dfd445', 'Include the word PEAR in your reply.', ended);
    c.mirror('delivered', `${frame('86dfd445')}\nInclude the word PEAR in your reply.`);
    c.inboxWake(wakeAfterStop([frame('86dfd445')]));
    c.answer('PEAR. The poem is waiting for you.');
    c.end();
    c.prompt('Write a 150-word poem about lakes. Use no tools. Keep it short.');
    c.answer('Still as glass at dawn.');
    c.end();
    const { rows, report, turns } = await drawn(c.rows, [abandoned, context]);
    for (const drawnRows of [rows, report]) {
      const bubble = user(drawnRows, 'Include the word PEAR in your reply.')!;
      expect(bubble).toMatchObject({ steer: false, dropped: false, messageUuid: delivery.uuid });
      expect(bubble.turnId).toBe(turnOf(drawnRows, 'PEAR. The poem is waiting for you.'));
      // The prompt the Esc undid, never sent again as it was, draws as not read; it opened no turn.
      expect(user(drawnRows, 'Write a 150-word poem about lakes. Use no tools.')).toMatchObject({ dropped: true, steer: false });
    }
    expect(turns.filter((turn) => turn.accepted).map((turn) => turn.state)).toEqual(['closed', 'closed', 'closed']);
    // Unmarked (an older producer), the delivery is the abandoned prompt's, as before.
    const unmarked = await drawn(c.rows);
    expect(user(unmarked.rows, 'Include the word PEAR in your reply.')).toMatchObject({ steer: true });
  });

  it('several rows appended after the turn: the first opens the wake’s turn, the rest are taken at its start', async () => {
    const c = new Chain();
    c.prompt('List the files.');
    c.answer('Two files.');
    c.end();
    c.appended('use the split store');
    c.delivery('aa11bb22', 'and run the suites');
    c.userWake(wakeForNote);
    c.answer('Done both.');
    c.end();
    const { rows, turns } = await drawn(c.rows);
    expect(user(rows, 'use the split store')).toMatchObject({ steer: false });
    expect(user(rows, 'and run the suites')).toMatchObject({ steer: true });
    expect(user(rows, 'and run the suites')!.turnId).toBe(user(rows, 'use the split store')!.turnId);
    expect(turns.map((turn) => turn.state)).toEqual(['closed', 'closed']);
  });

  it('a prompt typed before any wake takes the waiting row into its turn; none waits forever', async () => {
    const c = new Chain();
    c.prompt('List the files.');
    c.answer('Two files.');
    c.end();
    c.appended('use the split store');
    c.prompt('Now the tests.');
    c.answer('Tests pass.');
    c.end();
    const { rows, turns, entry } = await drawn(c.rows);
    expect(user(rows, 'use the split store')).toMatchObject({ steer: true });
    expect(user(rows, 'use the split store')!.turnId).toBe(user(rows, 'Now the tests.')!.turnId);
    expect(turns.map((turn) => turn.state)).toEqual(['closed', 'closed']);
    expect(entry.working).toBe(false);
  });
});

describe('a row the bridge appended into a running turn', () => {
  it('is that turn’s (Sent during this turn), its mirror not drawn (the busy path)', async () => {
    const c = new Chain();
    c.prompt('Run exactly this Bash command, then reply in one short sentence.');
    const call = c.call('toolu_b1');
    c.delivery('32cf2e17', 'Include the word KIWI in your reply.', call);
    c.mirror('delivered', `${frame('32cf2e17')}\nInclude the word KIWI in your reply.`);
    c.result('toolu_b1', call);
    c.answer('KIWI. The command ran.');
    c.end();
    const { rows, turns, entry } = await drawn(c.rows);
    expect(user(rows, 'Include the word KIWI in your reply.')).toMatchObject({ steer: true });
    expect(held(entry)).toEqual([]);
    expect(turns.map((turn) => turn.state)).toEqual(['closed']);
  });
});

describe('live, row by row', () => {
  it('draws the owner’s message after an Esc as a fresh load of the same rows does', async () => {
    const c = new Chain();
    c.prompt('Run exactly this Bash command, then reply in one short sentence.');
    const call = c.call('toolu_e2');
    c.result('toolu_e2', call);
    c.marker(true);
    const from = c.rows.length;
    c.delivery('c9f082da', 'Include the word LYCHEE in your reply.');
    c.mirror('delivered', `${frame('c9f082da')}\nInclude the word LYCHEE in your reply.`);
    c.inboxWake(wakeAfterStop([frame('c9f082da')]));
    c.answer('LYCHEE.');
    c.end();
    const plane = new FakePlane('proj');
    const store = createTranscriptStore();
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: SESSION, agentId: null }, store });
    controller.open();
    const unmount = mount(controller, store);
    plane.send('snapshot', { rows: c.rows.slice(0, from).reverse(), more: false, subagents: [], presence: { record: { status: 'busy' }, bridge: true } as never, streaming: [], offChain: [] });
    await settle();
    for (const row of c.rows.slice(from)) {
      plane.send('row', { row, agentId: null });
      await settle();
    }
    expect(store.getState().entries[controller.key].rows).toEqual((await drawn(c.rows)).rows);
    expect(store.getState().entries[controller.key].working).toBe(false);
    unmount();
    controller.close();
  });
});
