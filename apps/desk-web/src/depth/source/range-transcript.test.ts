// The `transcript` slot's transcript: the main thread through the same adapter, drawing only one fold's range under a
// store key of its own. Proved as data against a fresh load of exactly the rows the range holds.
import type { JsonObject, SubagentMeta } from 'desk-hub/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import { FakePlane, mount, settle } from '../../../test/double/fake-plane';
import { readRecording, scriptOf, type LiveItem } from '../../../test/double/session-stream';
import { DeskTranscript, freshSource, subagentLookupOf } from './desk-transcript';
import { rowsInRange, type Range } from './range';

const recording = readRecording();
const metas: SubagentMeta[] = recording.subagents.map(({ agentId, meta }) => ({ agentId, meta }));
const TARGET = { machine: 'mini', session: 'sess-1', agentId: null };

// The fixture with row 16 marked in part: a `<message>` span, then working-record text in the same row.
const rows: JsonObject[] = recording.session.map((row, i) =>
  i === 16 ? { ...row, message: { ...(row.message as JsonObject), content: [{ type: 'text', text: "<message>The kettle report is in.</message> I'm still waiting on the words.txt report." }] } } : row,
);
const FIRST = `${String(rows[16].uuid)}#0`;
const LAST = `${String(rows[21].uuid)}#0`;
const rowsOf = (script: LiveItem[]) => script.flatMap((item) => (item.kind === 'row' ? [item.body.row] : []));

async function freshRows(held: readonly JsonObject[]): Promise<Row[]> {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(held, TARGET.session, subagentLookupOf(metas)), { agentId: null });
  return store.getState().entries.fresh.rows;
}

describe('a fold of the working record', () => {
  const opened: Array<() => void> = [];
  afterEach(() => opened.splice(0).forEach((close) => close()));

  function open(range: Range) {
    const plane = new FakePlane('proj', metas);
    const store = createTranscriptStore();
    const controller = new DeskTranscript({ plane, project: 'proj', target: TARGET, store, range });
    controller.open();
    const unmount = mount(controller, store);
    opened.push(() => (unmount(), controller.close()));
    const drawn = () => store.getState().entries[controller.key]?.rows ?? [];
    return { plane, controller, drawn };
  }

  it('between two messages: the unmarked text after the first, the rows between, under a key of its own', async () => {
    const { plane, controller, drawn } = open({ from: FIRST, to: LAST });
    expect(controller.key).toBe(`desk:proj:sess-1#range:${FIRST}:${LAST}`);
    const script = scriptOf(rows, null);
    plane.snapshot(script, script.length);
    await settle();
    await settle();
    expect(controller.state.getState().bounds).toEqual({ from: 'found', to: 'found' });
    const inRange = rowsInRange(rows as Array<JsonObject & { uuid: string }>, { from: FIRST, to: LAST }).rows;
    expect(inRange[0].uuid).toBe(rows[16].uuid);
    expect(drawn()).toEqual(await freshRows(inRange));
    const text = JSON.stringify(drawn());
    expect(text).toContain("I'm still waiting on the words.txt report.");
    expect(text).not.toContain('The kettle report is in.');
    expect(text).not.toContain('Both subagents reported back');
  });

  it("a live session's last fold draws the rows and the stream that arrive after its last item", async () => {
    const { plane, controller, drawn } = open({ from: FIRST, to: null });
    const script = scriptOf(rows, null, { lateRows: true });
    const cut = script.findIndex((item) => item.kind === 'row' && item.body.row.uuid === rows[17].uuid) + 1;
    plane.snapshot(script, cut);
    await settle();
    await settle();
    const source = controller.state.getState().source;
    let streamed = false;
    for (const item of script.slice(cut)) {
      plane.play([item]);
      await settle();
      streamed ||= controller.state.getState().streaming.some((block) => block.text.includes('Both subagents'));
    }
    expect(streamed).toBe(true);
    expect(controller.state.getState().source).toBe(source); // each arriving row continued what was drawn
    expect(controller.state.getState().streaming).toEqual([]);
    expect(controller.state.getState().bounds).toEqual({ from: 'found', to: 'open' });
    expect(drawn()).toEqual(await freshRows(rowsInRange(rowsOf(script) as Array<JsonObject & { uuid: string }>, { from: FIRST, to: null }).rows));
    expect(JSON.stringify(drawn())).toContain('Both subagents reported back');
  });

  it('a fold already closed draws nothing that arrives after its end, and settles a stream it does not draw', async () => {
    const { plane, controller, drawn } = open({ from: null, to: FIRST });
    const script = scriptOf(rows, null);
    const cut = script.findIndex((item) => item.kind === 'row' && item.body.row.uuid === rows[17].uuid) + 1;
    plane.snapshot(script, cut);
    await settle();
    await settle();
    const before = drawn();
    for (const item of script.slice(cut)) {
      plane.play([item]);
      await settle();
    }
    expect(drawn()).toEqual(before);
    expect(controller.state.getState().streaming).toEqual([]);
    expect(JSON.stringify(drawn())).not.toContain('The kettle report is in.');
    expect(JSON.stringify(drawn())).toContain('Think briefly first'); // the open start: the transcript's first prompt
  });

  it('says a bound is missing while the held rows do not reach it', async () => {
    const { plane, controller } = open({ from: FIRST, to: LAST });
    const script = scriptOf(rows, null);
    plane.snapshot(script, script.length, 4); // the newest four rows only; older ones are paged in
    await settle();
    expect(controller.state.getState()).toMatchObject({ bounds: { from: 'missing', to: 'found' }, more: true });
  });
});
