// Streaming in the report (DC9's M3; the composite's §9.1, "Streaming in the report"): a main-loop block still streaming
// belongs to the turn of the latest row, and the report's projection (MAWS's `reportRows`, as `Transcript` runs it with
// the owner lane on) reads its mark from its text, so a marked response folds its turn and shows while it streams; an
// unmarked one in a marked turn stays inside the record; and a block's live row is gone once the row its `block-row`
// named is in the store — never drawn beside it.
import type { JsonObject, SubagentMeta } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { liveMarkedRowIds, reportRows } from '../../../../../src/renderer/src/owner/report/project';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { withQueueTail } from '../../../../../src/renderer/src/transcript/model/derive';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import { FakePlane, mount, settle } from '../../../test/double/fake-plane';
import { readRecording, scriptOf } from '../../../test/double/session-stream';
import { DeskTranscript, freshSource, subagentLookupOf } from '../source/desk-transcript';
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
  store.getState().setOwnerLane(KEY, true);
  return store;
}

/** The rows the session view's report draws: the store's, the stream's after them, through MAWS's projection. */
function report(store: Store, blocks: readonly StreamBlock[], key = KEY): Row[] {
  const entry = store.getState().entries[key]!;
  const tail = streamingRows(blocks, since, { turn: latestTurn(entry.rows) });
  return reportRows(withQueueTail(entry.rows, new Set(), tail), entry.state, entry.state.ui, liveMarkedRowIds(entry.state));
}

const record = (rows: readonly Row[]) => rows.filter((row) => row.kind === 'owner_record');
const streamed = (rows: readonly Row[]) => rows.filter((row) => row.id.startsWith('desk-stream:'));
const texts = (rows: readonly Row[]) => rows.flatMap((row) => (row.kind === 'assistant_text' ? [row.markdown] : []));

describe('streaming in the report', () => {
  it.each(['<message>\nBoth started; I will repo', '<message>\nBoth started; I will report.</message>'])('a marked block folds its turn before its first row is written, keeping its authored text: %s', async (text) => {
    const store = await storeOf(FIRST_TURN);
    const before = report(store, []);
    expect(record(before)).toEqual([]); // no mark yet: the turn draws whole
    expect(texts(before).some((text) => text.startsWith('Both subagents are running'))).toBe(true);

    const rows = report(store, [block(0, text)]);
    const turn = latestTurn(store.getState().entries[KEY]!.rows);
    expect(record(rows)).toMatchObject([{ turnId: turn, open: false, working: true }]);
    expect(streamed(rows)).toMatchObject([{ kind: 'assistant_text', turnId: turn, markdown: text, live: true }]); // folding never repairs the display
    expect(texts(rows).some((text) => text.startsWith('Both subagents are running'))).toBe(false); // folded into the record
    expect(rows.filter((row) => row.kind === 'subagent')).toEqual([]); // so are the Agent calls
    expect(rows.findIndex((row) => row.kind === 'owner_record')).toBe(rows.findIndex((row) => row.kind === 'user') + 1); // right after its prompt
  });

  it('a partial opening tag stays literal without folding its turn before a mark arrives', async () => {
    const store = await storeOf(FIRST_TURN);
    const rows = report(store, [block(0, '<mess')]);
    expect(record(rows)).toEqual([]);
    expect(streamed(rows)).toMatchObject([{ kind: 'assistant_text', markdown: '<mess', live: true }]);
    expect(texts(rows).some((text) => text.startsWith('Both subagents are running'))).toBe(true);
  });

  it("a message tool's call folds its turn as a mark does, its message in view as it streams", async () => {
    const store = await storeOf(FIRST_TURN);
    const message: StreamBlock = { ...block(0, '{"text": "Both started; I will repo', 'tool'), toolName: 'mcp__to-human__message', toolUseId: 'toolu_streamed' };
    const rows = report(store, [message]);
    const turn = latestTurn(store.getState().entries[KEY]!.rows);
    expect(record(rows)).toMatchObject([{ turnId: turn, open: false, working: true }]);
    expect(streamed(rows)).toMatchObject([{ kind: 'to_human', turnId: turn, toolUseId: 'toolu_streamed', text: 'Both started; I will repo' }]);
    expect(texts(rows).some((text) => text.startsWith('Both subagents are running'))).toBe(false); // folded into the record
  });

  it('unmarked streaming text later in an already-marked turn stays inside the record, and shows once it is opened', async () => {
    const store = await storeOf([...FIRST_TURN, marked('marked-row', '<message>Both started.</message>')]);
    const closed = report(store, [block(1, 'Checking the second file now')]);
    expect(record(closed)).toHaveLength(1);
    expect(streamed(closed)).toEqual([]);
    expect(texts(closed)).toContain('<message>Both started.</message>');

    store.getState().toggleReportRecord(KEY, record(closed)[0].turnId!);
    expect(streamed(report(store, [block(1, 'Checking the second file now')]))).toHaveLength(1);
  });

  it('an unmarked turn draws its streaming text whole, as MAWS draws a turn the model did not mark', async () => {
    const store = await storeOf(FIRST_TURN);
    const rows = report(store, [block(0, 'Still looking at the files'), block(1, '', 'thinking')]);
    expect(record(rows)).toEqual([]);
    expect(streamed(rows).map((row) => row.kind)).toEqual(['assistant_text', 'thinking']);
  });

  it("the live row is gone once the row its block-row named lands, with no double", async () => {
    const plane = new FakePlane('proj', metas);
    const store = createTranscriptStore();
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: 'sess-1', agentId: null }, store });
    controller.open();
    const unmount = mount(controller, store);
    const script = scriptOf(recording.session, null);
    const answer = recording.session.find((row) => JSON.stringify(row.message ?? {}).includes('<message>'))!;
    const named = script.findIndex((item) => item.kind === 'block-row' && item.body.uuid === answer.uuid);
    plane.snapshot(script, 0);
    await settle();
    store.getState().setOwnerLane(controller.key, true);
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
