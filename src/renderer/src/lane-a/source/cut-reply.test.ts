// The sminos bridge's row of a reply an interrupt cut off (sminos 1.27.16; `@shared/lane-a/interrupt-cut`), through
// MAWS's own store and reducer, on the row in both shapes the desk track sent (`test-support/chain-rows.ts`): never the
// owner's steer or any bubble; one cut-off part in the turn it cut, marked cut off, never the reply, whether the view is
// rebuilt from the transcript or kept what the stream showed; the tail-only shape saying it starts partway through; and
// without the row, the kept cut as before.
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../stores/transcript';
import type { TranscriptState } from '../../transcript/model/reduce';
import type { Row, RowId } from '../../transcript/model/rows';
import { placeCuts, type Cut } from '../stream/overlay';
import { Chain, SESSION } from '../test-support/chain-rows';
import { FakePlane, mount, settle } from '../test-support/fake-plane';
import { PlaneTranscript, freshSource, subagentLookupOf } from '../plane-transcript';
import { bridgeRowKind } from './bridge-rows';

const CUT = '1, 2, 3, 4\n\n5, 6';

/** A turn the bridge's interrupt cut while it streamed text: the prompt, a thinking row, the marker, the note, the row. */
function interrupted(partway = false) {
  const c = new Chain('c4a10000', 'sminos');
  const prompt = c.prompt('Count to 2000, one line each.');
  c.assistant([{ type: 'thinking', thinking: 'Counting.', signature: 'sig' }]);
  const marker = c.appended('[Request interrupted by user]');
  c.appended('The interrupt came from the desk.');
  const row = c.cutReply(CUT, partway);
  return { c, prompt, marker, row };
}

async function load(rows: JsonObject[]): Promise<{ rows: Row[]; state: TranscriptState }> {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, SESSION, subagentLookupOf([])), { agentId: null as never });
  const entry = store.getState().entries.fresh;
  return { rows: entry.rows, state: entry.state };
}

const cuts = (rows: Row[]) => rows.filter((row): row is Extract<Row, { kind: 'assistant_text' }> => row.kind === 'assistant_text' && row.cut === true);
/** What the live view kept from the stream at the step's end: the same words, in no turn yet. */
const kept = (at: number): Cut => ({ at, rows: [{ id: 'desk-stream:t1:main:0:1' as RowId, turnId: null, at: new Date(at).toISOString(), kind: 'assistant_text', messageUuid: null, blockIndex: 1, markdown: CUT, live: false, phase: 'commentary', model: null, cut: true }] });

describe('the bridge’s row of a reply an interrupt cut off', () => {
  it('is its own kind, never a steer, in either shape; and draws no bubble', async () => {
    for (const partway of [false, true]) {
      const { c, row } = interrupted(partway);
      expect(bridgeRowKind(row)).toBe('cut-reply');
      const { rows } = await load(c.rows);
      expect(rows.flatMap((r) => (r.kind === 'user' ? [r.text] : []))).toEqual(['Count to 2000, one line each.']);
    }
  });

  it('rebuilt from the transcript: one cut-off part, in the turn it cut, never the reply', async () => {
    const { c, prompt } = interrupted();
    const { rows } = await load(c.rows);
    const turn = rows.find((r) => r.kind === 'user')!.turnId;
    expect(cuts(rows)).toEqual([expect.objectContaining({ markdown: CUT, turnId: turn, phase: 'commentary', live: false })]);
    expect(cuts(rows)[0].partway).toBeUndefined();
    expect(rows.some((r) => r.kind === 'assistant_text' && r.cut !== true && r.markdown.includes('1, 2, 3'))).toBe(false);
    expect(turn).toContain(prompt.uuid as string);
  });

  it('live: the cut the stream kept leaves once the store holds the row, so the turn draws one cut-off part, as rebuilt', async () => {
    const { c, marker } = interrupted();
    const at = Date.parse(marker.timestamp as string); // the step's end, just before the bridge's rows
    const { rows, state } = await load(c.rows);
    expect(placeCuts(state, [kept(at)])).toEqual([]);
    expect(cuts(rows)).toHaveLength(1);
    // Before the row lands, the kept cut is all there is.
    const before = await load(c.rows.slice(0, -1));
    expect(placeCuts(before.state, [kept(at)]).map((r) => r.id)).toEqual(['desk-stream:t1:main:0:1']);
    expect(cuts(before.rows)).toEqual([]);
  });

  it('live, its rows arriving one at a time: the row lands in the turn the marker closed, drawn there once', async () => {
    const { c } = interrupted();
    const plane = new FakePlane('proj');
    const store = createTranscriptStore();
    const controller = new PlaneTranscript({ plane, sessionKey: 'mini/sess', target: { machine: 'mini', session: SESSION, agentId: null }, store });
    controller.open();
    const unmount = mount(controller, store);
    plane.send('snapshot', { rows: c.rows.slice(0, 2).toReversed(), more: false, subagents: [], streaming: [] } as never);
    await settle();
    for (const row of c.rows.slice(2)) {
      plane.send('row', { row } as never);
      await settle();
    }
    const entry = store.getState().entries[controller.key];
    unmount();
    controller.close();
    const turn = entry.rows.find((r) => r.kind === 'user')!.turnId;
    expect(cuts(entry.rows)).toEqual([expect.objectContaining({ markdown: CUT, turnId: turn })]);
    expect(placeCuts(entry.state, [kept(Date.parse(c.rows[2].timestamp as string))])).toEqual([]);
  });

  it('a window starting at the marker, its turn not loaded: the row still draws its cut-off part, in no turn', async () => {
    const { c, marker } = interrupted();
    const { rows, state } = await load(c.rows.slice(2));
    expect(cuts(rows)).toEqual([expect.objectContaining({ markdown: CUT, turnId: null })]);
    expect(rows.some((r) => r.kind === 'user')).toBe(false);
    expect(placeCuts(state, [kept(Date.parse(marker.timestamp as string))])).toEqual([]);
  });

  it('the bridge’s terminal mirror of the interrupt draws without the reply, which its row draws', async () => {
    const { c } = interrupted();
    c.row('system', { subtype: 'informational', content: 'sminos: interrupt: [Request interrupted by user] The interrupt came from the desk. The reply it cut off: 1, 2, 3, 4 5, 6', isMeta: false, level: 'notice' });
    const { rows } = await load(c.rows);
    expect(rows.flatMap((r) => (r.kind === 'error' ? [r.text] : []))).toEqual(['sminos: interrupt: [Request interrupted by user] The interrupt came from the desk.']);
    expect(cuts(rows)).toHaveLength(1);
  });

  it('a row written after another turn started confirms no earlier cut', async () => {
    const c = new Chain('c4a10000', 'sminos');
    c.prompt('Count.');
    const marker = c.appended('[Request interrupted by user]');
    c.prompt('Count again.');
    c.cutReply(CUT);
    const { state } = await load(c.rows);
    expect(placeCuts(state, [kept(Date.parse(marker.timestamp as string))])).toHaveLength(1);
  });

  it('the tail-only shape says its text starts partway through', async () => {
    const { c } = interrupted(true);
    const { rows } = await load(c.rows);
    expect(cuts(rows)).toEqual([expect.objectContaining({ markdown: CUT, partway: true })]);
  });

  it('without the row (a bridge before 1.27.16), the cut the stream kept stays, placed as before', async () => {
    const c = new Chain('c4a10000', 'sminos');
    c.prompt('Count to 2000, one line each.');
    const marker = c.appended('[Request interrupted by user]');
    c.appended('The interrupt came from the desk.');
    const at = Date.parse(marker.timestamp as string);
    const { state } = await load(c.rows);
    expect(placeCuts(state, [kept(at)])).toEqual(kept(at).rows); // no later turn yet: in no turn, last
    c.prompt('Go on.');
    const later = await load(c.rows);
    expect(placeCuts(later.state, [kept(at)]).map((r) => r.turnId)).toEqual([later.rows.find((r) => r.kind === 'user')!.turnId]);
  });
});
