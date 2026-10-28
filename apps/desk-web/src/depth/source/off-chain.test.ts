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
const byUuid = (rows: Row[], uuid: unknown) => rows.find((row): row is User => row.kind === 'user' && row.messageUuid === uuid);
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

  it('a prompt sent again edited from the same point repeats it: drawn once, the engine’s own notice or response between them or not', async () => {
    for (const between of ['nothing', 'notice', 'synthetic'] as const) {
      const c = new Chain();
      c.prompt('Write a poem about rivers.');
      c.answer('Rivers run.');
      const ended = c.end();
      const first = c.prompt('Write a poem about lakes.');
      const context = c.attachment();
      // A row the engine wrote itself starts the branch: its notice, or its response to no request, which reads nothing.
      const point =
        between === 'notice'
          ? c.row('system', { subtype: 'informational', content: 'Dropped a peer message: identical to the previous message from this sender.', isMeta: false, level: 'info' }, ended)
          : between === 'synthetic'
            ? c.synthetic(ended)
            : ended;
      c.prompt('Write a poem about lakes. Keep it short.', point);
      c.answer('Still as glass.');
      c.end();
      const { rows } = await drawn(c.rows, [first, context]);
      expect(bubbles(rows), between).toEqual(['Write a poem about rivers.', 'Write a poem about lakes. Keep it short.']);
      expect(user(rows, 'Write a poem about lakes. Keep it short.')).toMatchObject({ dropped: false });
    }
  });

  it('a prompt is repeated only by a typed prompt from its own point: an answer or another owner input between leaves it undone', async () => {
    for (const between of ['answer', 'steer'] as const) {
      const c = new Chain();
      c.prompt('Write a poem about rivers.');
      c.answer('Rivers run.');
      const ended = c.end();
      const first = c.prompt('Write a poem about lakes.');
      // From that point, before the next prompt: the owner's own words, or a message (no prompt) the session answered.
      if (between === 'steer') c.appended('use short lines', ended);
      else {
        c.inboxWake('[sminos bridge]\nA note was added to the conversation.', ended);
        c.answer('Noted.');
        c.end();
      }
      c.prompt('Write a poem about lakes. Keep it short.');
      c.answer('Still as glass.');
      c.end();
      const { rows } = await drawn(c.rows, [first]);
      expect(user(rows, 'Write a poem about lakes.'), between).toMatchObject({ dropped: true, messageUuid: first.uuid });
    }
  });

  it('a prompt of images alone is repeated by no other: one sent later from another point leaves it drawn as not read', async () => {
    const image = (data: string) => [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }];
    const c = new Chain();
    c.prompt('Summarize the log.');
    c.answer('It has 3 errors.');
    const ended = c.end();
    const lost = c.prompt(image('iVBORw0KGgo='));
    const context = c.attachment();
    // From that point, a message (no prompt) the session answered; then the owner went on from there.
    c.inboxWake('[sminos bridge]\nA note was added to the conversation.', ended);
    c.answer('Noted.');
    c.end();
    c.prompt('Now the tests.');
    c.answer('Running them.');
    c.end();
    const other = c.prompt(image('iVBORw0KGgoAAAANSUhEUg=='));
    c.answer('A chart of the runs.');
    c.end();
    const { rows } = await drawn(c.rows, [lost, context]);
    expect(byUuid(rows, lost.uuid)).toMatchObject({ dropped: true });
    expect(byUuid(rows, other.uuid)).toMatchObject({ dropped: false });
  });

  it('a steer or a delivery is repeated only by its words: sent again edited, its first wording still draws as not read', async () => {
    const c = new Chain();
    c.end();
    const abandoned = c.prompt('Fix the errors.');
    const steer = c.appended('use the split store');
    const delivery = c.delivery('d1e1d1e1', 'Run the suites.');
    c.prompt('Fix the errors.', c.rows[1]);
    c.answer('On it.');
    c.appended('use the split store, please');
    c.delivery('d2e2d2e2', 'Run the suites now.');
    c.answer('Done.');
    c.end();
    const { rows } = await drawn(c.rows, [abandoned, steer, delivery]);
    expect(user(rows, 'use the split store')).toMatchObject({ dropped: true, messageUuid: steer.uuid });
    expect(user(rows, 'Run the suites.')).toMatchObject({ dropped: true, messageUuid: delivery.uuid });
    expect(user(rows, 'Fix the errors.')).toMatchObject({ dropped: false });
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

  it('a steer with its own line (7.180.0 on) is the same owner input by its words: undone, it draws them as not read; sent again on the chain, it draws once', async () => {
    const c = new Chain();
    const ended = c.end();
    const abandoned = c.prompt('Fix the errors.');
    const undone = c.steer('use the split store');
    c.prompt('Fix the errors.', ended);
    c.answer('On it.');
    const kept = c.steer('mind the tests');
    c.answer('Minding them.');
    c.end();
    const lone = await drawn(c.rows, [abandoned, undone]);
    expect(bubbles(lone.rows)).toEqual(['use the split store', 'Fix the errors.', 'mind the tests']);
    expect(user(lone.rows, 'use the split store')).toMatchObject({ dropped: true, steer: false, messageUuid: undone.uuid });
    expect(user(lone.rows, 'mind the tests')).toMatchObject({ dropped: false, steer: true, messageUuid: kept.uuid });
    const again = new Chain();
    const end = again.end();
    const first = again.prompt('Fix the errors.');
    const lost = again.steer('use the split store');
    again.prompt('Fix the errors.', end);
    again.answer('On it.');
    again.steer('use the split store');
    again.answer('Using the split store.');
    again.end();
    const { rows } = await drawn(again.rows, [first, lost]);
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

  it('an Esc that a notice of the engine branched (#238’s restore): the prompt sent again edited and the delivery appended again draw once', async () => {
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
      expect(bubbles(drawnRows)).toEqual(['Write a story.', 'Write a 150-word poem about rivers. Use no tools. Keep it short.', 'Include the word PAPAYA in your reply.']);
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

  it('a delivery appended while a tool ran was read once the call’s result was answered: a /rewind takes it with its turn', async () => {
    const c = new Chain();
    c.prompt('Plan the migration.');
    c.answer('Three steps.');
    const point = c.end();
    const from = c.rows.length;
    c.prompt('Do step one.');
    const call = c.call('toolu_r1');
    // The bridge appends under the call's assistant; the result goes in beside it, and the next response under the result.
    c.delivery('5e551e17', 'Use the staging database.', call);
    c.mirror('delivered', '[sminos message from human id=5e551e17]\nUse the staging database.');
    c.result('toolu_r1', call);
    c.answer('Step one done on staging.');
    c.end();
    const undone = c.rows.slice(from);
    c.prompt('Do step one, carefully.', point);
    c.answer('Carefully done.');
    c.end();
    const { rows } = await drawn(c.rows, undone);
    expect(bubbles(rows)).toEqual(['Plan the migration.', 'Do step one, carefully.']);
    expect(answers(rows)).toEqual(['Three steps.', 'Carefully done.']);
  });

  it('a delivery appended while a tool ran, its turn undone before the call’s result was answered, draws as not read', async () => {
    const c = new Chain();
    c.prompt('Plan the migration.');
    c.answer('Three steps.');
    const point = c.end();
    const from = c.rows.length;
    c.prompt('Do step one.');
    const call = c.call('toolu_r2');
    const delivery = c.delivery('5e551e17', 'Use the staging database.', call);
    c.mirror('delivered', '[sminos message from human id=5e551e17]\nUse the staging database.');
    c.result('toolu_r2', call);
    const undone = c.rows.slice(from);
    c.prompt('Do step one, carefully.', point);
    c.answer('Carefully done.');
    c.end();
    const { rows } = await drawn(c.rows, undone);
    expect(bubbles(rows)).toEqual(['Plan the migration.', 'Use the staging database.', 'Do step one, carefully.']);
    expect(user(rows, 'Use the staging database.')).toMatchObject({ dropped: true, messageUuid: delivery.uuid });
  });

  // The to-human plugin's answer after a final message (MAWS's `isMadeUpFinalAnswer`) is written under the call's result
  // with no request: it read nothing, so a delivery the bridge appended while the message tool ran was never read.
  it('a delivery appended while a final message was sent, the plugin’s answer under the call’s result, draws as not read', async () => {
    const c = new Chain();
    c.prompt('Run the stages.');
    const call = c.assistant([{ type: 'tool_use', id: 'toolu_f1', name: 'mcp__to-human__message', input: { text: 'Both stages ran.', final: true } }]);
    const delivery = c.delivery('5e551e17', 'Use the staging database.', call);
    c.result('toolu_f1', call);
    c.row('assistant', { answeredWithoutRequest: true, message: { id: 'msg_hook_01Qx7Vb3Hn2KcR8t', role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'text', text: 'Message sent to the human.' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } } });
    c.end();
    const { rows } = await drawn(c.rows, [delivery]);
    expect(user(rows, 'Use the staging database.')).toMatchObject({ dropped: true, messageUuid: delivery.uuid });
    expect(answers(rows)).toEqual([]);
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
    // The prompts are each sent again from the same point (edited); the steers' words are repeated by no row on the chain.
    expect(bubbles(rows)).toEqual(['and hurry', 'Stop.']);
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

  it('a response that reads an undone input takes it out of the drawing, though no mark changed', async () => {
    const c = new Chain();
    c.prompt('Check both services.');
    const tool = (id: string) => ({ type: 'tool_use', id, name: 'Bash', input: { command: 'sleep 12', description: 'Wait' } });
    const call = c.assistant([tool('toolu_p1'), tool('toolu_p2')]);
    // The bridge appends under the call's assistant while the tools run. The first result goes in beside the first append;
    // the second append, under the call too, branches there and leaves the first behind (the plane's mark), though the
    // request after the second result reads them both.
    const first = c.delivery('5e551e17', 'Use the staging database.', call);
    const mirror = c.mirror('delivered', '[sminos message from human id=5e551e17]\nUse the staging database.');
    c.result('toolu_p1', call);
    c.delivery('6f662f28', 'Skip the cache.', call);
    c.mirror('delivered', '[sminos message from human id=6f662f28]\nSkip the cache.');
    const result = c.result('toolu_p2', call);
    const view = open();
    view.plane.send('snapshot', snapshot(c.rows, [first.uuid as string, mirror.uuid as string]));
    await settled();
    expect(user(view.drawnRows(), 'Use the staging database.')).toMatchObject({ dropped: true, messageUuid: first.uuid });
    const response = c.answer('Both are up; staging used, cache skipped.', result);
    view.plane.send('row', { row: response, agentId: null });
    await settled();
    expect(user(view.drawnRows(), 'Use the staging database.')).toBeUndefined();
    expect(view.drawnRows()).toEqual(await view.fresh(c.rows, [first, mirror]));
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

  it('a snapshot after an end whose marks disagree with the held ones replaces the held rows: a held turn a /rewind undid in the gap is not drawn, and pages back in off', async () => {
    const c = new Chain();
    c.prompt('Plan the migration.');
    c.answer('Three steps.');
    const point = c.end();
    const from = c.rows.length;
    c.prompt('Do step one.');
    c.answer('Step one done.');
    const turnEnd = c.end();
    const undone = c.rows.slice(from);
    const view = open();
    view.plane.send('snapshot', snapshot(c.rows, []));
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Plan the migration.', 'Do step one.']);
    view.plane.current.listener.end({ reason: 'machine-offline' });
    view.controller.resubscribe();
    // In the gap a /rewind undid the turn: the next prompt went in under the earlier point. The fresh snapshot's newest
    // rows overlap the held ones at the turn's last row, and it marks its own rows only.
    c.prompt('Do step one, carefully.', point);
    c.answer('Carefully done.');
    c.end();
    const split = c.rows.indexOf(turnEnd);
    view.plane.send('snapshot', snapshot(c.rows.slice(split), [turnEnd.uuid as string], true));
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Do step one, carefully.']);
    expect(answers(view.drawnRows())).toEqual(['Carefully done.']);
    expect(view.controller.state.getState().more).toBe(true);
    view.controller.loadOlder();
    expect(view.plane.current.asked).toEqual([{ before: turnEnd.uuid, limit: expect.any(Number) }]);
    const page = c.rows.slice(0, split);
    view.plane.send('rows', { rows: [...page].reverse(), before: turnEnd.uuid as string, more: false, offChain: undone.filter((row) => page.includes(row)).map((row) => row.uuid as string) });
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Plan the migration.', 'Do step one, carefully.']);
    expect(view.drawnRows()).toEqual(await view.fresh(c.rows, undone));
    view.close();
  });

  it('a snapshot after an interruption whose marks agree with the held ones is merged: the held older rows stay, their marks with them', async () => {
    const c = new Chain();
    c.prompt('Plan the migration.');
    c.answer('Three steps.');
    const point = c.end();
    const from = c.rows.length;
    c.prompt('Do step one.');
    c.answer('Step one done.');
    c.end();
    const undone = c.rows.slice(from);
    c.prompt('Do step one, carefully.', point); // a /rewind before the view opened: the turn above is off the chain
    c.answer('Carefully done.');
    const turnEnd = c.end();
    const view = open();
    view.plane.send('snapshot', snapshot(c.rows, undone.map((row) => row.uuid as string)));
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Plan the migration.', 'Do step one, carefully.']);
    view.plane.current.listener.interrupted();
    c.prompt('Now step two.');
    c.answer('Step two done.');
    c.end();
    // The fresh snapshot's newest rows overlap the held ones at the turn's last row, which both mark on the chain.
    view.plane.send('snapshot', snapshot(c.rows.slice(c.rows.indexOf(turnEnd)), [], true));
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Plan the migration.', 'Do step one, carefully.', 'Now step two.']);
    expect(view.drawnRows()).toEqual(await view.fresh(c.rows, undone));
    expect(view.controller.state.getState().more).toBe(false); // as held: nothing older to page back in
    view.controller.loadOlder();
    expect(view.plane.current.asked).toEqual([]);
    view.close();
  });

  it('a snapshot after an interruption that overlaps the held rows only at rows the chain does not carry replaces them: a response a /rewind undid in the gap is not drawn', async () => {
    const c = new Chain();
    const prompt = c.prompt('Name a colour.');
    const response = c.answer('Red.');
    const hook = (n: number) => c.row('progress', { data: { type: 'hook_progress', hookEvent: 'Stop', hookName: 'Stop', command: `notify ${n}` }, parentToolUseID: `toolu_h${n}`, toolUseID: `toolu_h${n}` });
    const progress = hook(1);
    hook(2);
    const view = open();
    view.plane.send('snapshot', snapshot(c.rows, []));
    await settled();
    expect(answers(view.drawnRows())).toEqual(['Red.']);
    view.plane.current.listener.interrupted();
    // In the gap a /rewind sent the prompt again edited, from before it: the prompt and its response are off the chain.
    // The fresh snapshot overlaps the held rows at the progress rows alone, which the producer never marks, so its marks
    // agree with the held ones there and say nothing of the response.
    c.prompt('Name a warm colour.', null);
    c.answer('Orange.');
    c.end();
    const split = c.rows.indexOf(progress);
    view.plane.send('snapshot', snapshot(c.rows.slice(split), [], true));
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Name a warm colour.']);
    expect(answers(view.drawnRows())).toEqual(['Orange.']);
    expect(view.controller.state.getState().more).toBe(true);
    view.controller.loadOlder();
    view.plane.send('rows', { rows: c.rows.slice(0, split).reverse(), before: progress.uuid as string, more: false, offChain: [prompt.uuid as string, response.uuid as string] });
    await settled();
    expect(view.drawnRows()).toEqual(await view.fresh(c.rows, [prompt, response]));
    expect(answers(view.drawnRows())).toEqual(['Orange.']);
    view.close();
  });

  it('a snapshot after an interruption that a branch from outside its window wrote under replaces the held rows, though its marks agree, the branch point held or older than every held row: an append the branch left draws as not read', async () => {
    for (const history of ['whole', 'paged'] as const) {
      const c = new Chain();
      c.prompt('Check both services.');
      const tool = (id: string) => ({ type: 'tool_use', id, name: 'Bash', input: { command: 'sleep 12', description: 'Wait' } });
      const call = c.assistant([tool('toolu_g1'), tool('toolu_g2')]);
      const first = c.delivery('5e551e17', 'Use the staging database.', call);
      const mirror = c.mirror('delivered', '[sminos message from human id=5e551e17]\nUse the staging database.');
      const result = c.result('toolu_g1', call);
      const view = open();
      // Paged, the first snapshot begins at the first append: the call is older than every held row.
      view.plane.send('snapshot', history === 'whole' ? snapshot(c.rows, []) : snapshot(c.rows.slice(c.rows.indexOf(first)), [], true));
      await settled();
      expect(user(view.drawnRows(), 'Use the staging database.'), history).toMatchObject({ dropped: false, messageUuid: first.uuid });
      view.plane.current.listener.interrupted();
      // In the gap the bridge appends again under the call while the second tool runs: the first append leaves the
      // chain, and the first result, whose call stays on it, stays. The fresh snapshot's window begins at that result,
      // which both mark on the chain, so the marks agree; only the second append's parent, the call, says the chain
      // forked outside it.
      c.delivery('6f662f28', 'Skip the cache.', call);
      c.mirror('delivered', '[sminos message from human id=6f662f28]\nSkip the cache.');
      c.result('toolu_g2', call);
      const split = c.rows.indexOf(result);
      view.plane.send('snapshot', snapshot(c.rows.slice(split), [], true));
      await settled();
      expect(user(view.drawnRows(), 'Use the staging database.'), history).toBeUndefined();
      expect(view.controller.state.getState().more, history).toBe(true);
      view.controller.loadOlder();
      view.plane.send('rows', { rows: c.rows.slice(0, split).reverse(), before: result.uuid as string, more: false, offChain: [first.uuid as string, mirror.uuid as string] });
      await settled();
      expect(user(view.drawnRows(), 'Use the staging database.'), history).toMatchObject({ dropped: true, messageUuid: first.uuid });
      expect(view.drawnRows(), history).toEqual(await view.fresh(c.rows, [first, mirror]));
      view.close();
    }
  });

  it('an older producer’s snapshot after an end continues the held rows where it overlaps them', async () => {
    const c = new Chain();
    c.prompt('Plan the migration.');
    c.answer('Three steps.');
    c.end();
    c.prompt('Do step one.');
    c.answer('Step one done.');
    const turnEnd = c.end();
    const view = open();
    view.plane.send('snapshot', snapshot(c.rows));
    await settled();
    view.plane.current.listener.end({ reason: 'machine-offline' });
    view.controller.resubscribe();
    c.prompt('Do step two.');
    c.answer('Step two done.');
    c.end();
    view.plane.send('snapshot', snapshot(c.rows.slice(c.rows.indexOf(turnEnd)), undefined, true));
    await settled();
    expect(bubbles(view.drawnRows())).toEqual(['Plan the migration.', 'Do step one.', 'Do step two.']);
    expect(view.drawnRows()).toEqual(await view.fresh(c.rows, []));
    // The held rows reach the start: nothing older to ask for.
    expect(view.controller.state.getState().more).toBe(false);
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
