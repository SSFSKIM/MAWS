// The question sheet's receipts from the raw rows to the drawn row (docs/doperpowers/plans/2026-11-23-question-sheet-c3-
// maws-app.md, M5's decisions and proofs; §I). The synthetic transcripts (test/fixtures/sheet/transcripts/) are made from
// the pin's own envelopes and on the carriers' recorded shapes (spikes/protocol-probe/fixtures/uxwave/u3-hookctx and
// u3-sminos-r1-terminal: a hook's context on a tool's result and on a prompt, a prompt the plugin submitted inside the
// engine's framing; spikes/protocol-probe/fixtures/qsheet/qsheet-t-block.ndjson for the envelope in a hook's context),
// with invented ids and words. Each goes through the file reader (`ChainFollower` over `backfill.ts`), and the plugin's
// prompt also as frames (its `.journal.jsonl`) through the live normaliser, then through the reducer and the derivation to the rows: a test
// that started at an event it built would pass with both producers still dropping the sheet's entry. It lives beside the
// other routes' test, whose graph is the renderer's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from '@testing-library/react';
import type { JsonObject } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SheetModel, SheetSummary } from '@shared/sheet/model';
import { receiptOf } from '@shared/sheet/words';
import { parseJournalRow } from '@shared/wire/journal';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { TEST_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { at } from '../../../../test/support/machine';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { resetSheetStore, useSheets } from '../stores/sheet';
import { journalToEvents } from '../transcript/dev/journal';
import { rowsOf, withAllExpanded } from '../transcript/model/derive';
import { applyEvents, createState } from '../transcript/model/reduce';
import type { Row } from '../transcript/model/rows';
import { serializeRows } from '../transcript/model/serialize';
import { builder, uuid, type Builder } from '../transcript/model/test-events';
import { renderRow } from '../transcript/view/rows/test-support';

const SESSION = '5eed0000-0000-4000-8000-0000000000c3';
const TRANSCRIPTS = join(TEST_FIXTURE_DIR, 'sheet/transcripts');
const SNAPSHOTS = join(__dirname, '../../../../test/snapshots/transcript/sheet');
const text = (name: string) => readFileSync(join(TRANSCRIPTS, `${name}.jsonl`), 'utf8');
const rowsIn = (name: string): JsonObject[] => text(name).split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject);

/** The file route: the chain follower over the file's bytes, as `session.events` answers for a session nobody holds. */
async function fromFile(name: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text(name)), SESSION as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}

/**
 * The live route: the transcript's journal, the same rows as the frames a session MAWS runs exchanges (the shapes of
 * u3-sminos-r1-bridge's journal, seq 49 to 65): the person's prompt goes out and its turn starts, the engine's rows come
 * in, a turn's end is its result, and the plugin's prompt comes in as a replayed `user` frame of the turn it starts while
 * the session is idle. A hook's added context reaches the file and has no frame of its own on the live wire.
 */
const fromJournal = (name: string): SessionEvent[] => journalToEvents(rowsIn(`${name}.journal`).map(parseJournalRow));

const drawn = (events: SessionEvent[]): Row[] => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
type SheetRowData = Extract<Row, { kind: 'sheet' }>;
const sheetRows = (rows: Row[]) => rows.filter((row): row is SheetRowData => row.kind === 'sheet');
/** Each sheet row's lines as they read: the id (or entry), and the receipt, the line's word, or the sentence. */
const readings = (rows: Row[]) =>
  sheetRows(rows).map((row) => row.lines.map((line) => `${line.id ?? line.entry} ${line.place === 'revised_below' ? 'Revised below' : line.outcome === null ? '…' : line.outcome.how === 'answered' ? `→ ${line.outcome.receipt}` : line.outcome.how}`));
const users = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'user' ? [row.text.split('\n', 1)[0]] : []));
const answerNotices = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'notice' && row.class === 'answer' ? [row.text] : []));

const ASKING = ['Set up the sign-in page for the ferry booking site.', 'Passkeys are in scope too, and leave the button colour to me.'];
const DELIVERED = [['q7 Revised below', 'q8 → Nothing waiting for you.', 'q9 dismissed', 'q10 withdrawn'], ['q7 → OAuth, Passkeys'], []];

describe('a delivery fills the receipts on each carrier, and draws no bubble', () => {
  for (const [name, prompts] of [['main-plugin-prompt', []], ['main-tool-context', ['Run the checks.']], ['main-prompt-context', ['Carry on with the page.']]] as const) {
    it(`${name}, by the file`, async () => {
      const rows = drawn(await fromFile(name));
      expect(readings(rows)).toEqual(DELIVERED);
      expect(users(rows)).toEqual([...ASKING, ...prompts]); // the envelope is no one's bubble
      expect(answerNotices(rows)).toEqual(['answered: q7, q8, q12; dismissed q9, q11']);
      await expect(`${serializeRows(sheetRows(rows))}\n`).toMatchFileSnapshot(join(SNAPSHOTS, 'delivered.md')); // one drawing, whichever carrier
    });
  }

  it('main-plugin-prompt, live: the plugin’s prompt as frames through the normaliser draws the same', () => {
    const rows = drawn(fromJournal('main-plugin-prompt'));
    expect(readings(rows)).toEqual(DELIVERED);
    expect(users(rows)).toEqual(ASKING);
    expect(answerNotices(rows)).toEqual(['answered: q7, q8, q12; dismissed q9, q11']);
  });

  it('before the delivery the lines are the questions; an envelope a person typed fills nothing and is their bubble', async () => {
    const rows = drawn(await fromFile('main-typed'));
    expect(readings(rows)).toEqual([['q7 Revised below', 'q8 …', 'q9 …', 'q10 withdrawn'], ['q7 …'], []]);
    expect(users(rows)).toEqual([...ASKING, '[sheet v1] The human answered questions on your sheet.']);
    expect(answerNotices(rows)).toEqual([]);
    const live = drawn(fromJournal('main-typed'));
    expect(readings(live)).toEqual(readings(rows));
  });
});

// The record of the pin's terminal example holds the outcomes this delivery's block carries (its `closed`: q7's
// "OAuth, Passkeys" at revision 2, q8's text, q9's dismissal), written by sminos; the transcript's own receipts are the
// block's places among the options the transcript holds. A line reads the same from either.
describe('a receipt reads the same from the block and from the record', () => {
  const APP = at('app-sheet-c3' as AppSessionId);
  const RECORD = join(TEST_FIXTURE_DIR, 'sheet/set/examples/terminal/input/sheet/5eed0000-0000-4000-8000-0000000000e1/state.json');
  beforeEach(resetSheetStore);
  afterEach(cleanup);
  const lineText = () => [...document.querySelectorAll<HTMLElement>('[data-sheet-line]')].map((el) => [...el.children].map((cell) => cell.textContent).filter((t) => t !== '').join(' | '));
  // all of a transcript's rows mounted together, as the list mounts them: the last row to unmount forgets the model
  const drawnLines = (rows: SheetRowData[]) => {
    for (const row of rows) renderRow(row, { storeKey: APP });
    const lines = lineText();
    cleanup();
    return lines;
  };

  it('main-typed under the record’s closed, as main-plugin-prompt with no record', async () => {
    const fromBlock = drawnLines(sheetRows(drawn(await fromFile('main-plugin-prompt'))));
    const closed = (JSON.parse(readFileSync(RECORD, 'utf8')) as { closed: SheetModel['closed'] }).closed;
    const summary: SheetSummary = { session: SESSION, appSessionId: APP, title: null, live: true, seq: 9, open: 0, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false };
    useSheets.setState({ summaries: new Map([[SESSION, summary]]), models: new Map([[SESSION, { v: 1, session: SESSION, seq: 9, open: [], hidden: [], sent: [], pending: [], closed }]]) });
    const fromRecord = drawnLines(sheetRows(drawn(await fromFile('main-typed'))));
    expect(fromRecord).toEqual(fromBlock);
    expect(fromBlock).toEqual(['q7 | Auth method | Revised below', 'q8 | Empty state | → Nothing waiting for you.', 'q9 | Export | → Dismissed', 'q10 | Button | → Withdrawn', 'q7 | Auth method | → OAuth, Passkeys']);
  });
  // The fix round's finding 5: a typed answer that opens with spaces. The record keeps the text's first 80 characters
  // as its receipt (C2's I2, `receiptOf`); the transcript's block holds the whole text. The line stays answered from
  // either, and reads the same.
  it('an answer that opens with eighty spaces reads answered, the same from the block and from the record', () => {
    const text = `${' '.repeat(80)}From the first of November.`;
    const asking = (b: Builder) => {
      b.turn('u-ask', 'Set the season.');
      b.toolUse('toolu_01SheetSeason0001', 'mcp__sminos__AskUserQuestion', { ask: [{ question: 'What are the first and last days of the winter season?', header: 'Season dates' }] });
      b.result('toolu_01SheetSeason0001', 'Added q6.');
      b.end(['u-ask']);
    };
    const withBlock = builder();
    asking(withBlock);
    withBlock.emit('turn.started', { userMessageUuid: uuid('u-delivery'), origin: 'task-notification' });
    withBlock.emit('user.message', { messageUuid: uuid('u-delivery'), content: '', isReplay: false, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [{ class: 'sheet', deliveries: [{ v: 1, keys: ['page-00000010'], answered: [{ id: 'q6', revision: 1, picks: [], text, images: [] }], dismissed: [] }] }] });
    withBlock.end([], { origin: 'task-notification' });
    const bare = builder();
    asking(bare);
    const fromBlock = drawnLines(sheetRows(drawn(withBlock.events)));
    const summary: SheetSummary = { session: SESSION, appSessionId: APP, title: null, live: true, seq: 2, open: 0, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false };
    useSheets.setState({ summaries: new Map([[SESSION, summary]]), models: new Map([[SESSION, { v: 1, session: SESSION, seq: 2, open: [], hidden: [], sent: [], pending: [], closed: { q6: { how: 'answered', receipt: receiptOf([], text), places: [], at: '2026-11-23T09:05:00.000Z', revision: 1, asker: 'main' } } }]]) });
    const fromRecord = drawnLines(sheetRows(drawn(bare.events)));
    expect(fromBlock).toEqual([`q6 | Season dates | → ${' '.repeat(80)}`]);
    expect(fromRecord).toEqual(fromBlock);
  });
});

// S8's edge. A running subagent's answer is its coordinator's message in its own history, not read here: the message
// draws as any coordinator's message does, and the row's outcome comes from the record while the record lives. An ended
// subagent's answer goes to the parent (the pin's terminal example: the reviewer a1b2c3's q12), so the child's history
// holds the question and the parent's the answer; once the record is gone the child's row shows its question and no
// receipt, stated and not repaired.
describe('a subagent’s transcript', () => {
  const APP = at('app-sheet-c3' as AppSessionId);
  const summary: SheetSummary = { session: SESSION, appSessionId: APP, title: null, live: false, seq: 4, open: 0, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false };
  const closed = (receipt: string, agentId: string) => ({ how: 'answered' as const, receipt, places: [1], at: '2026-11-23T09:05:00.000Z', revision: 1, asker: { agentId } as never });
  const withRecord = (closedById: SheetModel['closed']) =>
    useSheets.setState({ summaries: new Map([[SESSION, summary]]), models: new Map([[SESSION, { v: 1, session: SESSION, seq: 4, open: [], hidden: [], sent: [], pending: [], closed: closedById }]]) });
  beforeEach(resetSheetStore);
  afterEach(cleanup);
  const lineText = () => [...document.querySelectorAll<HTMLElement>('[data-sheet-line]')].map((el) => [...el.children].map((cell) => cell.textContent).filter((t) => t !== '').join(' | '));
  const shown = (row: SheetRowData, agent: string) => {
    renderRow(row, { storeKey: `${APP}:${agent}` });
    const lines = lineText();
    cleanup();
    return lines;
  };

  it('a running one: its own call’s row, the coordinator’s message drawn as a message and read for nothing; the record’s receipt while it lives', async () => {
    const rows = drawn(await fromFile('subagent-a7c0ffee'));
    expect(readings(rows)).toEqual([['q3 …']]);
    expect(answerNotices(rows)).toEqual([]);
    expect(users(rows), 'the coordinator’s message, as a message').toEqual(['Review the cache layer and ask what you need on the sheet.', 'From the human, through the question tool, not from your coordinator: answers to questions you put on the sheet.']);
    const row = sheetRows(rows)[0]!;
    withRecord({ q3: closed('Yes', 'a7c0ffee') });
    expect(shown(row, 'a7c0ffee')).toEqual(['q3 | Cache key | → Yes']);
    resetSheetStore();
    expect(shown(row, 'a7c0ffee')).toEqual(['q3 | Cache key | Should the cache key include the locale?']);
  });

  it('an ended one: the question in the child’s row, its answer in the parent’s turn; the record’s receipt while it lives, none once it is gone', async () => {
    const parent = drawn(await fromFile('main-plugin-prompt'));
    expect(answerNotices(parent), 'the answer reached the parent').toEqual(['answered: q7, q8, q12; dismissed q9, q11']);
    expect(readings(parent).flat().some((line) => line.startsWith('q12 ')), 'no row of the parent’s holds the child’s question').toBe(false);
    const child = drawn(await fromFile('subagent-a1b2c3'));
    expect(readings(child)).toEqual([['q12 …']]);
    expect(answerNotices(child)).toEqual([]);
    const row = sheetRows(child)[0]!;
    withRecord({ q12: closed('Yes', 'a1b2c3') });
    expect(shown(row, 'a1b2c3')).toEqual(['q12 | Migration | → Yes']);
    resetSheetStore();
    expect(shown(row, 'a1b2c3')).toEqual(['q12 | Migration | Ship the migration today?']);
  });
});
