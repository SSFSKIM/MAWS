// @vitest-environment happy-dom
// The conversation the engine holds after an Esc's or a /rewind's branch (`off-chain.ts`): through MAWS's own store,
// reducer and projection (the report the session view draws), with the rows the machine marks off the live chain. A row
// off the chain is not drawn; an owner input the session never read and nobody sent again is drawn in place as undone,
// never as sent or read; an older producer's rows, which carry no marks, draw as before. Live, the marks arrive on the
// messages that carry them and the drawing follows them as a fresh load of the same rows and marks draws them.
import { cleanup, screen } from '@testing-library/react';
import type { JsonObject, SessionBodies } from 'desk-hub/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { reportRows } from '../../../../../src/renderer/src/owner/report/project';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import { renderRow } from '../../../../../src/renderer/src/transcript/view/rows/test-support';
import { NO_ACTIONS } from '../../../../../src/renderer/src/transcript/view/context';
import { Chain, SESSION } from '../../../test/double/chain-rows';
import { FakePlane, mount, settle } from '../../../test/double/fake-plane';
import { DESK_ACTIONS } from '../view/actions';
import { DeskTranscript, freshSource, subagentLookupOf } from './desk-transcript';
import { UNDONE } from './off-chain';

afterEach(cleanup);

type User = Extract<Row, { kind: 'user' }>;

/** What the session view draws of `rows` with `off` marked: MAWS's rows, its report over them, and the store's turns. */
async function drawn(rows: JsonObject[], off: JsonObject[] = []) {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf([]), null, new Set(off.map((row) => row.uuid as string))), { agentId: null as never });
  const entry = store.getState().entries.fresh;
  return { rows: entry.rows, report: reportRows(entry.rows, entry.state, {}), entry };
}
const bubbles = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'user' ? [row.text] : []));
const user = (rows: Row[], text: string) => rows.find((row): row is User => row.kind === 'user' && row.text === text);
const answers = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'assistant_text' ? [row.markdown] : []));

describe('the rows off the live chain', () => {
  it('draws a prompt sent again as it was after an Esc once: the first copy and its attachment are off the chain', async () => {
    const c = new Chain();
    c.prompt('List the files.');
    c.attachment();
    c.answer('Two files.');
    const ended = c.end();
    const first = c.prompt('Now the tests.');
    const context = c.attachment();
    // The Esc handed it back before the model answered; sent again, it goes in under the same point.
    c.prompt('Now the tests.', ended);
    c.attachment();
    c.answer('Running them.');
    c.end();
    const { rows, report, entry } = await drawn(c.rows, [first, context]);
    expect(bubbles(rows)).toEqual(['List the files.', 'Now the tests.']);
    expect(bubbles(report)).toEqual(['List the files.', 'Now the tests.']);
    expect(entry.state.order.map((id) => entry.state.turns.get(id)!.state)).toEqual(['closed', 'closed']);
    // Unmarked (an older producer), both copies draw, as before.
    expect(bubbles((await drawn(c.rows)).rows)).toEqual(['List the files.', 'Now the tests.', 'Now the tests.']);
  });

  it('a prompt sent again edited is no repeat: its first wording draws as undone, the engine’s own notice between them or not', async () => {
    for (const notice of [false, true]) {
      const c = new Chain();
      c.prompt('Write a poem about rivers.');
      c.answer('Rivers run.');
      const ended = c.end();
      const first = c.prompt('Write a poem about lakes.');
      const context = c.attachment();
      const point = notice ? c.row('system', { subtype: 'informational', content: 'Dropped a peer message: identical to the previous message from this sender.', isMeta: false, level: 'info' }, ended) : ended;
      c.prompt('Write a poem about lakes. Keep it short.', point);
      c.answer('Still as glass.');
      c.end();
      const { rows } = await drawn(c.rows, [first, context]);
      expect(bubbles(rows), `notice ${notice}`).toEqual(['Write a poem about rivers.', 'Write a poem about lakes.', 'Write a poem about lakes. Keep it short.']);
      expect(user(rows, 'Write a poem about lakes.')).toMatchObject({ dropped: true, messageUuid: first.uuid });
      expect(user(rows, 'Write a poem about lakes. Keep it short.')).toMatchObject({ dropped: false });
    }
  });

  it('a steer that went off the chain and is repeated by no row on it draws as not read, never as delivered', async () => {
    const c = new Chain();
    c.prompt('Summarize the log.');
    c.answer('It has 3 errors.');
    const ended = c.end();
    const abandoned = c.prompt('Fix the errors.');
    const context = c.attachment();
    const steer = c.appended('use the split store');
    // The Esc handed the prompt back before the model answered; the owner sent it again, and the steer stayed behind.
    c.prompt('Fix the errors.', ended);
    c.answer('Fixed.');
    c.end();
    const { rows, report } = await drawn(c.rows, [abandoned, context, steer]);
    for (const drawnRows of [rows, report]) {
      expect(bubbles(drawnRows)).toEqual(['Summarize the log.', 'use the split store', 'Fix the errors.']);
      const undone = user(drawnRows, 'use the split store')!;
      // MAWS's dropped prompt: no turn of its own ran, nothing waits, it is no steer the turn took.
      expect(undone).toMatchObject({ dropped: true, steer: false, messageUuid: steer.uuid });
      expect(undone.pending).toBeUndefined();
    }
    // Drawn on the desk, it says it was not read, dimmed, and nothing says it was sent or delivered.
    const view = renderRow(user(report, 'use the split store')!, { actions: { ...NO_ACTIONS, ...DESK_ACTIONS } });
    expect(screen.getByText(UNDONE)).toBeDefined();
    expect(view.container.querySelector('[data-dropped]')).not.toBeNull();
    expect(view.container.textContent).not.toMatch(/Sent during this turn|Sends at the next step|Not sent|Delivered|Sent to Claude/);
    // No turn reads working: the undone steer opened none, and the turns that ran ended.
    const { entry } = await drawn(c.rows, [abandoned, context, steer]);
    expect([...entry.state.turns.values()].every((turn) => turn.state === 'closed')).toBe(true);
    expect(entry.working).toBe(false);
  });

  it('a steer under an undone turn that the owner sent again on the chain is not drawn twice', async () => {
    const c = new Chain();
    const ended = c.end();
    const abandoned = c.prompt('Fix the errors.');
    const steer = c.appended('use the split store');
    c.prompt('Fix the errors.', ended);
    c.answer('On it.');
    c.appended('use the split store');
    c.answer('Using the split store.');
    c.end();
    const { rows } = await drawn(c.rows, [abandoned, steer]);
    expect(bubbles(rows)).toEqual(['Fix the errors.', 'use the split store']);
    expect(user(rows, 'use the split store')).toMatchObject({ dropped: false, steer: true });
  });

  it('a delivery the bridge appended again after an Esc is drawn once, the copy the engine read; one never appended again draws as not read', async () => {
    const c = new Chain();
    const ended = c.end();
    const abandoned = c.prompt('Now the tests.');
    const first = c.delivery('5e551e17', 'Run the suites.');
    const mirror = c.mirror('delivered', `[sminos message from human id=5e551e17]\nRun the suites.`);
    c.prompt('Now the tests.', ended);
    const again = c.delivery('5e551e17', 'Run the suites.');
    c.answer('Running them.');
    c.end();
    const marked = await drawn(c.rows, [abandoned, first, mirror]);
    expect(bubbles(marked.rows)).toEqual(['Now the tests.', 'Run the suites.']);
    expect(user(marked.rows, 'Run the suites.')).toMatchObject({ messageUuid: again.uuid, dropped: false });
    // The bridge never appended it again: its words stay, as not read.
    const once = c.rows.filter((row) => row !== again);
    const undone = await drawn(once, [abandoned, first, mirror]);
    expect(bubbles(undone.rows)).toEqual(['Run the suites.', 'Now the tests.']);
    expect(user(undone.rows, 'Run the suites.')).toMatchObject({ messageUuid: first.uuid, dropped: true });
  });

  it('an Esc that a notice of the engine branched (#238’s restore): the prompt draws as undone, the delivery appended again once', async () => {
    const c = new Chain();
    c.prompt('Write a story.');
    c.answer('Once upon a time.');
    const ended = c.end();
    const abandoned = c.prompt('Write a 150-word poem about rivers. Use no tools.');
    const context = c.attachment();
    const first = c.delivery('probe1', 'Include the word PAPAYA in your reply.');
    const mirror = c.mirror('delivered', `[sminos message from human id=probe1]\nInclude the word PAPAYA in your reply.`);
    // The engine's notice, written under the turn's end, starts the branch that leaves the four behind (the plane's mark).
    c.row('system', { subtype: 'informational', content: 'Dropped a peer message from @sminos-bridge (unknown): identical to the previous message from this sender.', isMeta: false, level: 'info' }, ended);
    c.prompt('Write a 150-word poem about rivers. Use no tools. Keep it short.');
    c.attachment();
    const again = c.delivery('probe1', 'Include the word PAPAYA in your reply.');
    c.mirror('delivered', `[sminos message from human id=probe1]\nInclude the word PAPAYA in your reply.`);
    c.answer('Rivers never stop to rest.');
    c.end();
    c.userWake('[sminos bridge]\nA message for you was added to the conversation while you were finishing your answer.\nUnread: [sminos message from human id=probe1]');
    c.answer('PAPAYA.');
    c.end();
    const { rows, report, entry } = await drawn(c.rows, [abandoned, context, first, mirror]);
    for (const drawnRows of [rows, report]) {
      expect(bubbles(drawnRows)).toEqual(['Write a story.', 'Write a 150-word poem about rivers. Use no tools.', 'Write a 150-word poem about rivers. Use no tools. Keep it short.', 'Include the word PAPAYA in your reply.']);
      expect(user(drawnRows, 'Write a 150-word poem about rivers. Use no tools.')).toMatchObject({ dropped: true });
      expect(user(drawnRows, 'Include the word PAPAYA in your reply.')).toMatchObject({ messageUuid: again.uuid, steer: true, dropped: false });
    }
    // Neither mirror line is held as a notice: the bubbles are drawn, the lines are the terminal's.
    expect([...entry.state.turns.values()].flatMap((turn) => turn.events).some((event) => event.kind === 'notice.posted' && event.text.startsWith('doperpowers:'))).toBe(false);
    expect([...entry.state.turns.values()].every((turn) => turn.state === 'closed')).toBe(true);
    expect(entry.working).toBe(false);
  });

  it('turns a /rewind undid go whole: the prompts the model answered are not drawn as unread', async () => {
    const c = new Chain();
    c.prompt('Plan the migration.');
    c.answer('Three steps.');
    const point = c.end();
    const from = c.rows.length;
    c.prompt('Do step one.');
    c.answer('Step one done.');
    c.end();
    c.prompt('Do step two.');
    c.answer('Step two done.');
    c.end();
    const undone = c.rows.slice(from);
    c.prompt('Do step one, carefully.', point);
    c.answer('Carefully done.');
    c.end();
    const { rows } = await drawn(c.rows, undone);
    expect(bubbles(rows)).toEqual(['Plan the migration.', 'Do step one, carefully.']);
    expect(answers(rows)).toEqual(['Three steps.', 'Carefully done.']);
  });

  it('a response the engine dropped when a message reached its turn is not drawn; the message and the turn go on', async () => {
    const c = new Chain();
    c.prompt('Explain the bug.');
    const call = c.call('toolu_d1');
    const result = c.result('toolu_d1', call);
    const dropped = c.answer('The bug is in the');
    const steer = c.appended('also check the tests', result);
    c.answer('Checked the tests too: the bug is in the parser.');
    c.end();
    const { rows } = await drawn(c.rows, [dropped]);
    expect(answers(rows)).toEqual(['Checked the tests too: the bug is in the parser.']);
    expect(user(rows, 'also check the tests')).toMatchObject({ steer: true, dropped: false, messageUuid: steer.uuid });
  });

  it('of undone inputs with the same words, the last is drawn', async () => {
    const c = new Chain();
    const ended = c.end();
    const p1 = c.prompt('Go.');
    const s1 = c.appended('and hurry');
    const p2 = c.prompt('Go now.', ended);
    const s2 = c.appended('and hurry');
    c.prompt('Stop.', ended);
    c.answer('Stopped.');
    c.end();
    const { rows } = await drawn(c.rows, [p1, s1, p2, s2]);
    expect(bubbles(rows)).toEqual(['Go.', 'Go now.', 'and hurry', 'Stop.']);
    expect(user(rows, 'and hurry')?.messageUuid).toBe(s2.uuid);
  });
});

describe('the marks as the subscription carries them', () => {
  const settled = async () => {
    await settle();
    await settle();
  };
  const snapshot = (rows: JsonObject[], offChain?: string[], more = false): SessionBodies['snapshot'] => ({
    rows: [...rows].reverse(),
    more,
    subagents: [],
    presence: { record: { status: 'busy' }, bridge: true } as never,
    streaming: [],
    ...(offChain && { offChain }),
  });

  function open() {
    const plane = new FakePlane('proj');
    const store = createTranscriptStore();
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: SESSION, agentId: null }, store });
    controller.open();
    const unmount = mount(controller, store);
    const fresh = async (rows: JsonObject[], off: JsonObject[]) => (await drawn(rows, off)).rows;
    return { plane, store, controller, drawnRows: () => store.getState().entries[controller.key].rows, fresh, close: () => (unmount(), controller.close()) };
  }

  it('a row whose write took held rows off the chain draws them as a fresh load of the same marks does', async () => {
    const c = new Chain();
    c.prompt('Summarize the log.');
    c.answer('It has 3 errors.');
    const ended = c.end();
    const abandoned = c.prompt('Fix the errors.');
    const context = c.attachment();
    const steer = c.appended('use the split store');
    const view = open();
    view.plane.send('snapshot', snapshot(c.rows, []));
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Summarize the log.', 'Fix the errors.', 'use the split store']);
    // The prompt sent again goes in under the turn's end: its write leaves the abandoned branch.
    const again = c.prompt('Fix the errors.', ended);
    view.plane.send('row', { row: again, agentId: null, offChain: [abandoned.uuid as string, context.uuid as string, steer.uuid as string] });
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Summarize the log.', 'use the split store', 'Fix the errors.']);
    const from = c.rows.length;
    c.answer('Fixed.');
    c.end();
    for (const row of c.rows.slice(from)) view.plane.send('row', { row, agentId: null });
    await settled();
    expect(view.drawnRows()).toEqual(await view.fresh(c.rows, [abandoned, context, steer]));
    view.close();
  });

  it('an undone input leaves the drawing when the owner sends its words again on the chain', async () => {
    const c = new Chain();
    const ended = c.end();
    const abandoned = c.prompt('Fix the errors.');
    const steer = c.appended('use the split store');
    const again = c.prompt('Fix the errors.', ended);
    const view = open();
    view.plane.send('snapshot', snapshot(c.rows, [abandoned.uuid as string, steer.uuid as string]));
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['use the split store', 'Fix the errors.']);
    expect(user(view.drawnRows(), 'use the split store')?.dropped).toBe(true);
    const repeat = c.appended('use the split store', again);
    view.plane.send('row', { row: repeat, agentId: null });
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Fix the errors.', 'use the split store']);
    expect(user(view.drawnRows(), 'use the split store')).toMatchObject({ messageUuid: repeat.uuid, dropped: false });
    expect(view.drawnRows()).toEqual(await view.fresh(c.rows, [abandoned, steer]));
    view.close();
  });

  it('a row written off the chain is not drawn as it arrives, and a row put back on is drawn again', async () => {
    const c = new Chain();
    c.prompt('Explain the bug.');
    const call = c.call('toolu_l1');
    const result = c.result('toolu_l1', call);
    const view = open();
    view.plane.send('snapshot', snapshot(c.rows, []));
    await settled();
    const dropped = c.answer('The bug is in the');
    view.plane.send('row', { row: dropped, agentId: null, offChain: [dropped.uuid as string] });
    await settled();
    expect(answers(view.drawnRows())).toEqual([]);
    const steer = c.appended('also check the tests', result);
    view.plane.send('row', { row: steer, agentId: null });
    await settled();
    const back = c.answer('Checked.', dropped);
    view.plane.send('row', { row: back, agentId: null, onChain: [dropped.uuid as string] });
    await settled();
    expect(answers(view.drawnRows())).toEqual(['The bug is in the', 'Checked.']);
    view.close();
  });

  it('an older page carries its own rows’ marks; a mark that named a row not held yet is the page’s to say', async () => {
    const c = new Chain();
    c.prompt('Summarize the log.');
    c.answer('It has 3 errors.');
    const ended = c.end();
    const abandoned = c.prompt('Fix the errors.');
    const steer = c.appended('use the split store');
    const again = c.prompt('Fix the errors.', ended);
    c.answer('Fixed.');
    c.end();
    const view = open();
    const split = c.rows.indexOf(again);
    view.plane.send('snapshot', snapshot(c.rows.slice(split), [], true));
    await settled();
    view.controller.loadOlder();
    view.plane.send('rows', { rows: c.rows.slice(0, split).reverse(), before: again.uuid as string, more: false, offChain: [abandoned.uuid as string, steer.uuid as string] });
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Summarize the log.', 'use the split store', 'Fix the errors.']);
    expect(view.drawnRows()).toEqual(await view.fresh(c.rows, [abandoned, steer]));
    view.close();
  });

  it('an older producer marks nothing: every held row draws, a delivery appended again once, as before', async () => {
    const c = new Chain();
    const ended = c.end();
    c.prompt('Now the tests.');
    c.delivery('5e551e17', 'Run the suites.');
    c.prompt('Now the tests.', ended);
    const again = c.delivery('5e551e17', 'Run the suites.');
    const view = open();
    view.plane.send('snapshot', snapshot(c.rows));
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Now the tests.', 'Now the tests.', 'Run the suites.']);
    expect(user(view.drawnRows(), 'Run the suites.')?.messageUuid).toBe(again.uuid);
    view.close();
  });
});
