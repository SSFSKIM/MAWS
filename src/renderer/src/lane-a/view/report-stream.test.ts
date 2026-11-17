// Streaming in the to-human view (DC9's M3; the composite's §9.1, "Streaming in the report"; UX wave U2b, the mirror):
// a main-loop block still streaming belongs to the turn of the latest row, and its mark is read from its text, so a
// marked response puts the view in force (as `Transcript` tells the store before paint) and shows while it streams,
// the work before it folded under one record line; unmarked streaming text after a message is a stretch of its own,
// in its record until opened; and a block's live row is gone once the row its `block-row` named is in the store —
// never drawn beside it.
import type { JsonObject, SubagentMeta } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { holdsMessage, liveMarkedRowIds, liveMarksOf, mirrorRows, mirrorsView } from '../../owner/view/mirror';
import { createTranscriptStore } from '../../stores/transcript';
import { withQueueTail } from '../../transcript/model/derive';
import type { Row } from '../../transcript/model/rows';
import { FakePlane, mount, settle } from '../test-support/fake-plane';
import { readRecording, scriptOf } from '../test-support/session-stream';
import { PlaneTranscript, freshSource, subagentLookupOf } from '../plane-transcript';
import type { StreamBlock } from '../stream/layer';
import { latestTurn, streamingRows } from './streaming-rows';

const recording = readRecording();
const metas: SubagentMeta[] = recording.subagents.map(({ agentId, meta }) => ({ agentId, meta }));
const since = () => '2026-10-15T00:00:00.000Z';
const KEY = 'k';
type Store = ReturnType<typeof createTranscriptStore>;

/** The recording's first turn, still open: its prompt, the two `Agent` calls and their results, an unmarked answer. */
const FIRST_TURN = recording.session.slice(0, 12);
const block = (index: number, text: string, kind: StreamBlock['kind'] = 'text'): StreamBlock => ({ turnId: 'bridge-turn', agentId: null, step: 3, index, kind, text, toolName: null, toolUseId: null, settledBy: null });
const marked = (uuid: string, text: string): JsonObject => ({
  ...recording.session[11],
  uuid,
  parentUuid: String(recording.session[11].uuid),
  message: { ...(recording.session[11].message as JsonObject), id: 'msg_marked', content: [{ type: 'text', text }] },
});

async function storeOf(rows: readonly JsonObject[]): Promise<Store> {
  const store = createTranscriptStore();
  await store.getState().attach(KEY, freshSource(rows, 'sess-1', subagentLookupOf(metas)), { agentId: null });
  store.getState().setToHumanView(KEY, { lane: true, tailMessage: false });
  return store;
}

/**
 * The rows the session view draws: the store's, the stream's after them, mirrored while the view is in force; whether
 * the stream holds a message is told to the store first, as `Transcript` tells it before paint.
 */
function report(store: Store, blocks: readonly StreamBlock[], key = KEY): Row[] {
  const tail = streamingRows(blocks, since, { turn: latestTurn(store.getState().entries[key]!.rows) });
  store.getState().setToHumanView(key, { lane: true, tailMessage: holdsMessage(tail) });
  const entry = store.getState().entries[key]!;
  const queued = withQueueTail(entry.rows, new Set(), tail);
  return mirrorsView(entry.state.ui) ? mirrorRows(queued, entry.state.ui, liveMarksOf(liveMarkedRowIds(entry.state), tail)) : queued;
}

const record = (rows: readonly Row[]) => rows.filter((row): row is Extract<Row, { kind: 'record_fold' }> => row.kind === 'record_fold');
const streamed = (rows: readonly Row[]) => rows.filter((row) => row.id.startsWith('desk-stream:'));
const texts = (rows: readonly Row[]) => rows.flatMap((row) => (row.kind === 'assistant_text' ? [row.markdown] : []));

describe('streaming in the report', () => {
  it.each(['<message>\nBoth started; I will repo', '<message>\nBoth started; I will report.</message>'])('a marked block puts the view in force before its first row is written, keeping its authored text: %s', async (text) => {
    const store = await storeOf(FIRST_TURN);
    const before = report(store, []);
    expect(record(before)).toEqual([]); // no message yet: the plain transcript
    expect(texts(before).some((text) => text.startsWith('Both subagents are running'))).toBe(true);

    const rows = report(store, [block(0, text)]);
    const turn = latestTurn(store.getState().entries[KEY]!.rows);
    expect(record(rows)).toMatchObject([{ open: false }]);
    expect(streamed(rows)).toMatchObject([{ kind: 'assistant_text', turnId: turn, markdown: text, live: true }]); // folding never repairs the display
    expect(texts(rows).some((text) => text.startsWith('Both subagents are running'))).toBe(false); // folded into the record
    expect(rows.filter((row) => row.kind === 'subagent').length).toBeGreaterThan(0); // the spawns stay (`isSpawn`)
    expect(rows.findIndex((row) => row.kind === 'record_fold')).toBe(rows.findIndex((row) => row.id.startsWith('desk-stream:')) - 1); // the record, then the message
  });

  it('a partial opening tag stays literal without putting the view in force', async () => {
    const store = await storeOf(FIRST_TURN);
    const rows = report(store, [block(0, '<mess')]);
    expect(record(rows)).toEqual([]);
    expect(streamed(rows)).toMatchObject([{ kind: 'assistant_text', markdown: '<mess', live: true }]);
    expect(texts(rows).some((text) => text.startsWith('Both subagents are running'))).toBe(true);
  });

  it("a message tool's call puts the view in force as a mark does, its message in view as it streams", async () => {
    const store = await storeOf(FIRST_TURN);
    const message: StreamBlock = { ...block(0, '{"text": "Both started; I will repo', 'tool'), toolName: 'mcp__to-human__message', toolUseId: 'toolu_streamed' };
    const rows = report(store, [message]);
    const turn = latestTurn(store.getState().entries[KEY]!.rows);
    expect(record(rows)).toMatchObject([{ open: false }]);
    expect(streamed(rows)).toMatchObject([{ kind: 'to_human', turnId: turn, toolUseId: 'toolu_streamed', text: 'Both started; I will repo' }]);
    expect(texts(rows).some((text) => text.startsWith('Both subagents are running'))).toBe(false); // folded into the record
  });

  it('unmarked streaming text after a message is a stretch of its own, inside its record, and shows once it is opened', async () => {
    const store = await storeOf([...FIRST_TURN, marked('marked-row', '<message>Both started.</message>')]);
    const closed = report(store, [block(1, 'Checking the second file now')]);
    expect(record(closed)).toHaveLength(2); // the work before the message, and the text after it
    expect(streamed(closed)).toEqual([]);
    expect(texts(closed)).toContain('<message>Both started.</message>');

    store.getState().toggleStretch(KEY, record(closed)[1].stretch);
    expect(streamed(report(store, [block(1, 'Checking the second file now')]))).toHaveLength(1);
  });

  it('a session with no message draws its streaming text whole, as MAWS draws a turn the model did not mark', async () => {
    const store = await storeOf(FIRST_TURN);
    const rows = report(store, [block(0, 'Still looking at the files'), block(1, '', 'thinking')]);
    expect(record(rows)).toEqual([]);
    expect(streamed(rows).map((row) => row.kind)).toEqual(['assistant_text', 'thinking']);
  });

  it("the live row is gone once the row its block-row named lands, with no double", async () => {
    const plane = new FakePlane('proj', metas);
    const store = createTranscriptStore();
    const controller = new PlaneTranscript({ plane, sessionKey: 'mini/sess-1', target: { machine: 'mini', session: 'sess-1', agentId: null }, store });
    controller.open();
    const unmount = mount(controller, store);
    const script = scriptOf(recording.session, null);
    const answer = recording.session.find((row) => JSON.stringify(row.message ?? {}).includes('<message>'))!;
    const named = script.findIndex((item) => item.kind === 'block-row' && item.body.uuid === answer.uuid);
    plane.snapshot(script, 0);
    await settle();
    store.getState().setToHumanView(controller.key, { lane: true, tailMessage: false });
    const view = () => report(store, controller.state.getState().streaming, controller.key);
    // The answer's drawings: its live row while it streams, its own row once written.
    const answers = (rows: readonly Row[]) => rows.filter((row) => row.kind === 'assistant_text' && (row.id.startsWith('desk-stream:') || row.messageUuid === answer.uuid)).length;

    plane.play(script.slice(0, named - 2)); // into the answer's stream: its text, not yet its block-row
    await settle();
    expect(streamed(view())).toMatchObject([{ kind: 'assistant_text', turnId: latestTurn(store.getState().entries[controller.key]!.rows) }]);
    expect(answers(view())).toBe(1);

    plane.play(script.slice(named - 2, named + 1)); // the block-row: still drawn live until its row lands
    await settle();
    expect(answers(view())).toBe(1);
    const row = script.findIndex((item, i) => i > named && item.kind === 'row' && item.body.row.uuid === answer.uuid);
    plane.play(script.slice(named + 1, row + 1));
    await settle();
    expect(streamed(view())).toEqual([]);
    expect(answers(view())).toBe(1); // the row, once
    unmount();
    controller.close();
  });
});
