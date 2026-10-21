// The adapter against the recorded session (the DC6 plan's M1 proofs, as data): MAWS's own store and reducer, the DX8
// plane faked in-process, the live part synthesized from the recording's rows. After every message the drawn state
// is checked for no gap and no duplicated text; at the end the store's rows equal the rows a fresh load of the same
// point gives.
import type { JsonObject, SessionBodies, SubagentMeta } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import { FakePlane, mount, settle } from '../../../test/double/fake-plane';
import { readRecording, rowsBefore, scriptOf, snapshotAt, STRAY, type LiveItem } from '../../../test/double/session-stream';
import type { SessionTarget } from '../../shell/session-plane';
import type { StepEnd } from 'desk-hub/protocol';
import { DeskTranscript, freshSource, subagentLookupOf } from './desk-transcript';

const PROJECT = 'proj';
const TARGET: SessionTarget = { machine: 'mini', session: 'sess-1', agentId: null };
const recording = readRecording();
const metas: SubagentMeta[] = recording.subagents.map(({ agentId, meta }) => ({ agentId, meta }));

/** The rows a fresh load of these transcript rows draws: a new store over one snapshot of them. */
async function freshRows(rows: readonly SessionBodies['row']['row'][]): Promise<Row[]> {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, TARGET.session, subagentLookupOf(metas)), { agentId: null });
  return store.getState().entries.fresh.rows;
}

const rowsOf = (script: LiveItem[], cut = script.length) => script.slice(0, cut).flatMap((item) => (item.kind === 'row' ? [item.body.row] : []));
/** The script index of the `step-end` of the one step a block of which streamed and was never named by a `block-row`. */
function cutStepEnd(script: LiveItem[]): number {
  const key = (b: { turnId: string; step: number }, index?: unknown) => `${b.turnId}|${b.step}|${index ?? ''}`;
  const named = new Set(script.flatMap((item) => (item.kind === 'block-row' ? [key(item.body, item.body.index)] : [])));
  const cut = script.find((item) => item.kind === 'chunk' && typeof item.body.chunk.index === 'number' && !named.has(key(item.body, item.body.chunk.index)));
  if (!cut || cut.kind !== 'chunk') throw new Error('no cut block in the script');
  const at = script.findIndex((item) => item.kind === 'step-end' && key(item.body) === key(cut.body));
  if (at < 0) throw new Error('the cut step has no step-end');
  return at;
}

const textOfRows =(rows: Row[]) => rows.flatMap((row) => (row.kind === 'assistant_text' ? [row.markdown] : row.kind === 'thinking' ? [row.text] : []));

describe('the main transcript through the session plane', () => {
  let plane: FakePlane;
  let store: ReturnType<typeof createTranscriptStore>;
  let controller: DeskTranscript;
  let unmount: () => void;
  // Every block a block-row named that streamed text, by its row: until that row is in the store, its text is drawn
  // here; once it is, it is not (no gap, no duplicate).
  let streamed: Map<string, string>;

  const seen = (uuid: string) => store.getState().entries[controller.key]?.state.seen.has(uuid as never) ?? false;
  const drawnBy = (uuid: string) => controller.state.getState().streaming.some((b) => b.settledBy === uuid);
  const drawnText = () => controller.state.getState().streaming.map((b) => b.text);

  function check(): void {
    for (const [uuid] of streamed) {
      if (store.getState().entries[controller.key]?.phase !== 'live') continue;
      expect(seen(uuid) !== drawnBy(uuid), `row ${uuid}: in the store ${seen(uuid)}, drawn as streaming ${drawnBy(uuid)}`).toBe(true);
    }
    for (const text of drawnText()) expect(text).not.toContain(STRAY);
  }

  async function step(items: LiveItem[]): Promise<void> {
    for (const item of items) {
      if (item.kind === 'block-row') {
        const { turnId, step: request, index } = item.body;
        const block = controller.state.getState().streaming.find((b) => b.turnId === turnId && b.step === request && b.index === index);
        if (block && block.text !== '') streamed.set(item.body.uuid, block.text);
      }
      plane.play([item]);
      await settle();
      check();
    }
  }

  beforeEach(() => {
    plane = new FakePlane(PROJECT, metas);
    store = createTranscriptStore();
    controller = new DeskTranscript({ plane, project: PROJECT, target: TARGET, store });
    controller.open();
    unmount = mount(controller, store);
    streamed = new Map();
  });

  afterEach(() => {
    unmount();
    controller.close();
  });

  it('draws a response streaming per block and settles it into the rows a fresh load draws', async () => {
    const script = scriptOf(recording.session, null, { lateRows: true, strayAfterBlockRow: 1 });
    const firstChunk = script.findIndex((item) => item.kind === 'chunk');
    plane.snapshot(script, firstChunk);
    await settle();
    expect(controller.state.getState().phase).toBe('live');
    await step(script.slice(firstChunk));
    expect(streamed.size).toBeGreaterThanOrEqual(5); // tool use, text, thinking, text, text
    expect(controller.state.getState().streaming).toEqual([]);
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('a thinking, a text, and a tool-use block of one response stream and settle, each by its own row', async () => {
    const response = recording.session.find((row) => row.type === 'assistant' && (row.message as { content: Array<{ type: string }> }).content[0].type === 'thinking')!;
    const id = (response.message as { id: string }).id;
    const blocks = recording.session.filter((row) => row.type === 'assistant' && (row.message as { id: string }).id === id);
    const tool = { ...blocks[1], uuid: 'synth-tool', apiBlockIndex: 2, message: { ...(blocks[1].message as object), content: [{ type: 'tool_use', id: 'toolu_synth', name: 'Read', input: { file_path: '/work/demo/notes.md' } }] } };
    const rows = recording.session.slice(0, recording.session.indexOf(blocks[1]) + 1).concat([tool as never]);
    const script = scriptOf(rows, null, { lateRows: true });
    const start = script.findIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'thinking');
    plane.snapshot(script, start);
    await settle();
    await step(script.slice(start));
    expect([...streamed.keys()]).toEqual([blocks[0].uuid, blocks[1].uuid, 'synth-tool']);
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rows));
  });

  it('a server tool’s row, which no block-row names, is drawn as it lands and settles nothing', async () => {
    const answer = recording.session.findLast((row) => row.type === 'assistant')!;
    const message = answer.message as { id: string; content: unknown[] };
    const server = { ...answer, uuid: 'synth-server', apiBlockIndex: 0, message: { ...message, content: [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'advisor', input: {} }] } };
    const text = { ...answer, apiBlockIndex: 1 };
    const rows = [...recording.session.slice(0, recording.session.indexOf(answer)), server as never, text as never];
    const script = scriptOf(rows, null);
    expect(script.filter((item) => item.kind === 'block-row' && item.body.uuid === 'synth-server')).toEqual([]);
    plane.snapshot(script, 0);
    await settle();
    await step(script);
    expect(streamed.has(String(answer.uuid))).toBe(true);
    expect(controller.state.getState().streaming).toEqual([]);
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rows));
  });

  // P4-R7: MAWS reads its own message tool alone; the desk reads the to-human plugin's too (`../message-tools`), the
  // sessions it shows messaging their owner through it, so the source it hands MAWS's store names both.
  it('draws an accepted call of a message tool, MAWS’s or the to-human plugin’s, as the message it sends, as a fresh load does', async () => {
    const answer = recording.session.findLast((row) => row.type === 'assistant')!;
    const result = recording.session.find((row) => row.type === 'user' && JSON.stringify(row.message).includes('"tool_result"'))!;
    const before = recording.session.slice(0, recording.session.indexOf(answer));
    const sent = (id: string, name: string, text: string, parent: string): JsonObject[] => [
      { ...answer, uuid: `call-${id}`, parentUuid: parent, apiBlockIndex: 0, message: { ...(answer.message as JsonObject), id: `msg_${id}`, content: [{ type: 'tool_use', id, name, input: { text } }] } },
      { ...result, uuid: `sent-${id}`, parentUuid: `call-${id}`, sourceToolAssistantUUID: `call-${id}`, toolUseResult: [{ type: 'text', text: 'sent' }], message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'sent' }] }] } },
    ];
    const rows = [
      ...before,
      ...sent('toolu_maws', 'mcp__maws__message', 'Stage 1 is done.', String(before.at(-1)!.uuid)),
      ...sent('toolu_plugin', 'mcp__to-human__message', 'Stage 2 is done.', 'sent-toolu_maws'),
      { ...answer, parentUuid: 'sent-toolu_plugin' },
    ] as SessionBodies['row']['row'][];
    const script = scriptOf(rows, null);
    plane.snapshot(script, 0);
    await settle();
    await step(script);
    const drawn = store.getState().entries[controller.key].rows;
    expect(drawn.flatMap((row) => (row.kind === 'to_human' ? [[row.toolUseId, row.text, row.pending]] : []))).toEqual([['toolu_maws', 'Stage 1 is done.', false], ['toolu_plugin', 'Stage 2 is done.', false]]);
    expect(drawn).toEqual(await freshRows(rows));
  });

  it('a reconnect in the middle of a response keeps what was drawn, merges the fresh snapshot, and ends with no gap and no duplicated text', async () => {
    const script = scriptOf(recording.session, null);
    const lastText = script.findLastIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text');
    const middle = lastText - 3;
    plane.snapshot(script, 0);
    await settle();
    await step(script.slice(0, middle));
    const drawn = drawnText();
    const drawnRows = store.getState().entries[controller.key].rows;
    const block = controller.state.getState().streaming.at(-1);
    expect(drawn.join('')).not.toBe('');
    plane.current.listener.interrupted();
    await settle();
    expect(controller.state.getState().phase).toBe('reconnecting');
    expect(drawnText()).toEqual(drawn);
    expect(store.getState().entries[controller.key].rows).toBe(drawnRows); // nothing in the store moved
    plane.snapshot(script, middle + 1); // the fresh snapshot, one chunk further on
    expect(store.getState().entries[controller.key].rows).toBe(drawnRows); // staged: the old rows stay until the new state is whole
    await settle();
    expect(store.getState().entries[controller.key].rows.map((row) => row.id)).toEqual(drawnRows.map((row) => row.id));
    expect(controller.state.getState().streaming.at(-1)).toBe(block); // the same block, one chunk further on
    await step(script.slice(middle + 1));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
    expect(textOfRows(store.getState().entries[controller.key].rows).filter((t) => t.includes('Both subagents reported back'))).toHaveLength(1);
  });

  it('a hub restart loses what was in flight; the fresh snapshot holds it, and the live part goes on from there', async () => {
    const script = scriptOf(recording.session, null, { lateRows: true });
    const firstChunk = script.findIndex((item) => item.kind === 'chunk');
    plane.snapshot(script, firstChunk);
    await settle();
    const dropped = firstChunk + 6;
    await step(script.slice(firstChunk, dropped));
    plane.current.listener.interrupted(); // the socket dropped with the hub; items up to `lost` never arrive
    const lost = dropped + 5;
    plane.snapshot(script, lost);
    await settle();
    await step(script.slice(lost));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('a chunk that arrives while the snapshot is built is in the snapshot already and drawn once', async () => {
    const script = scriptOf(recording.session, null);
    const lastText = script.findLastIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text');
    const cut = lastText - 2;
    plane.snapshot(script, cut);
    await settle();
    const before = drawnText().join('');
    plane.play(script.slice(cut - 2, cut)); // two chunks the producer had already put in the snapshot
    await settle();
    expect(drawnText().join('')).toBe(before);
    await step(script.slice(cut));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('pages older rows in when asked, splitting a turn and a tool call from its result, while chunks keep arriving', async () => {
    const script = scriptOf(recording.session, null);
    const toolUse = recording.session.find((row) => row.type === 'assistant' && (row.message as { content: Array<{ type: string }> }).content[0].type === 'tool_use')!;
    const callId = (toolUse.message as { content: Array<{ id: string }> }).content[0].id;
    const result = recording.session.find((row) => row.type === 'user' && Array.isArray((row.message as { content: unknown }).content) && (row.message as { content: Array<{ tool_use_id?: string }> }).content[0].tool_use_id === callId)!;
    const cut = script.findLastIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text') - 4;
    const played = rowsOf(script, cut);
    const limit = played.length - played.indexOf(result); // the snapshot starts at the result; its call is older
    plane.snapshot(script, cut, limit);
    await settle();
    expect(controller.state.getState().more).toBe(true);
    const rowsBeforePage = store.getState().entries[controller.key].rows;
    expect(rowsBeforePage.some((row) => row.kind === 'user' && row.text.includes('Think briefly first'))).toBe(false);

    controller.loadOlder();
    expect(plane.current.asked).toEqual([{ before: result.uuid, limit: expect.any(Number) }]);
    await step(script.slice(cut, cut + 2)); // live chunks while the page is on its way
    const page = rowsBefore(script, cut, String(result.uuid), 3); // one page that ends inside the turn
    plane.send('rows', page);
    await settle();
    check();
    expect(controller.state.getState().more).toBe(true);
    controller.loadOlder();
    await step(script.slice(cut + 2, cut + 3));
    plane.send('rows', rowsBefore(script, cut, String(page.rows.at(-1)!.uuid), 100));
    await settle();
    expect(controller.state.getState().more).toBe(false);
    controller.loadOlder(); // nothing older: nothing asked
    expect(plane.current.asked).toHaveLength(2);
    await step(script.slice(cut + 3));
    const rows = store.getState().entries[controller.key].rows;
    expect(rows).toEqual(await freshRows(rowsOf(script)));
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  /** Rows as the plane sends them (newest first) with the oldest one carried again, newer than its first place. */
  const withOldestTwice = <R,>(rows: readonly R[]): R[] => [...rows.slice(0, -2), rows.at(-1)!, ...rows.slice(-2)];

  it('holds a row an older page carries twice once, at its oldest place', async () => {
    const script = scriptOf(recording.session, null);
    const cut = script.findLastIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text') - 4;
    const played = rowsOf(script, cut);
    plane.snapshot(script, cut, 3);
    await settle();
    controller.loadOlder();
    const page = rowsBefore(script, cut, String(played.at(-3)!.uuid), 100);
    expect(page.more).toBe(false);
    plane.send('rows', { ...page, rows: withOldestTwice(page.rows) });
    await settle();
    expect(controller.heldRows().map((row) => row.uuid)).toEqual(played.map((row) => row.uuid));
    await step(script.slice(cut));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('holds a row a snapshot carries twice once, at its oldest place', async () => {
    const script = scriptOf(recording.session, null);
    const cut = script.findLastIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text') - 4;
    const body = snapshotAt(script, cut, { subagents: metas });
    plane.send('snapshot', { ...body, rows: withOldestTwice(body.rows) });
    await settle();
    expect(controller.heldRows().map((row) => row.uuid)).toEqual(rowsOf(script, cut).map((row) => row.uuid));
    await step(script.slice(cut));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('an end keeps what was drawn, says why, and a new subscription takes up from a fresh snapshot', async () => {
    const script = scriptOf(recording.session, null);
    const middle = script.findLastIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text') - 2;
    plane.snapshot(script, 0);
    await settle();
    await step(script.slice(0, middle));
    const drawnRows = store.getState().entries[controller.key].rows;
    const drawn = drawnText();
    plane.current.listener.end({ reason: 'machine-offline' });
    await settle();
    expect(controller.state.getState()).toMatchObject({ phase: 'ended', ended: { reason: 'machine-offline' } });
    expect(store.getState().entries[controller.key].rows).toBe(drawnRows);
    expect(drawnText()).toEqual(drawn);

    controller.resubscribe();
    expect(plane.subs).toHaveLength(2);
    const later = middle + 4;
    plane.snapshot(script, later);
    await settle();
    expect(controller.state.getState().phase).toBe('live');
    await step(script.slice(later));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('draws only its own agent’s streaming: a subagent’s chunks on the main subscription are not the main thread’s', async () => {
    const script = scriptOf(recording.session, null);
    plane.snapshot(script, 0);
    await settle();
    plane.send('chunk', { turnId: 'sub-turn', agentId: recording.subagents[0].agentId, step: 0, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'sub says' } });
    await settle();
    expect(drawnText()).toEqual([]);
  });

  it('a transcript empty at its first snapshot, ended, then subscribed again, draws the rows the fresh snapshot holds', async () => {
    const script = scriptOf(recording.session, null);
    plane.snapshot(script, 0);
    await settle();
    plane.current.listener.end({ reason: 'machine-offline' });
    controller.resubscribe();
    plane.snapshot(script, script.length);
    await settle();
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('a subagent’s block-row on the main subscription settles its block at once: its row never comes here', async () => {
    const script = scriptOf(recording.session, null);
    plane.snapshot(script, 0);
    await settle();
    const agentId = recording.subagents[0].agentId;
    plane.send('chunk', { turnId: 'sub-turn', agentId, step: 0, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'sub says' } });
    expect(controller.streamingOf(agentId).map((b) => b.text)).toEqual(['sub says']);
    plane.send('block-row', { uuid: 'sub-row', turnId: 'sub-turn', agentId, step: 0, index: 0 });
    expect(controller.streamingOf(agentId)).toEqual([]);
    // The main loop's own block waits for its row.
    plane.send('chunk', { turnId: 'main-turn', agentId: null, step: 0, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'main says' } });
    plane.send('block-row', { uuid: 'main-row', turnId: 'main-turn', agentId: null, step: 0, index: 0 });
    expect(controller.streamingOf(null).map((b) => b.text)).toEqual(['main says']);
  });

  it('a subscription that ends before its snapshot, and is taken up again, reads as reconnecting until the snapshot', async () => {
    plane.current.listener.interrupted(); // the shell's answer to an `end {discontinuity}` at n 0: interrupted, then subscribed again
    expect(controller.state.getState().phase).toBe('reconnecting');
    const script = scriptOf(recording.session, null);
    plane.snapshot(script, script.length);
    await settle();
    expect(controller.state.getState().phase).toBe('live');
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('subagent metadata delivered live reaches rows mapped after it, as a fresh load with it maps them', async () => {
    const script = scriptOf(recording.session, null);
    plane.current.n = 0;
    plane.send('snapshot', snapshotAt(script, 0, { subagents: [] }));
    await settle();
    plane.send('subagents', { subagents: metas });
    await step(script);
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('subagent metadata arriving after the rows that name its agents reconciles them', async () => {
    const script = scriptOf(recording.session, null);
    plane.current.n = 0;
    plane.send('snapshot', snapshotAt(script, 0, { subagents: [] }));
    await settle();
    await step(script);
    plane.send('subagents', { subagents: metas });
    await settle();
    await settle();
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('an interruption between an older page and the attachment of its rebuilt source keeps what was drawn, the page included', async () => {
    const script = scriptOf(recording.session, null);
    const cut = script.length - 4;
    plane.snapshot(script, cut, 6);
    await settle();
    const before = store.getState().entries[controller.key].rows;
    expect(before.length).toBeGreaterThan(0);
    controller.loadOlder();
    plane.send('rows', rowsBefore(script, cut, String(plane.current.asked[0].before), 100)); // a new source, not yet attached
    plane.current.listener.interrupted(); // before the view's effect attaches it
    expect(store.getState().entries[controller.key].rows).toBe(before);
    await settle();
    await settle();
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script, cut))); // the page drawn
    expect(controller.state.getState()).toMatchObject({ phase: 'reconnecting', more: false });
    plane.snapshot(script, cut, 6); // the newest rows again: merged, the page kept
    await settle();
    await settle();
    expect(controller.state.getState()).toMatchObject({ phase: 'live', more: false });
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script, cut)));
    await step(script.slice(cut));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('asks for an older page only once the fresh snapshot is in, again for one the interruption lost', async () => {
    const script = scriptOf(recording.session, null);
    const cut = script.length - 4;
    plane.snapshot(script, cut, 6);
    await settle();
    controller.loadOlder();
    expect(plane.current.asked).toHaveLength(1);
    expect(controller.state.getState().loadingOlder).toBe(true);
    plane.current.listener.interrupted(); // the page goes down with the subscription
    expect(controller.state.getState().loadingOlder).toBe(false);
    controller.loadOlder(); // the hub would drop it on a subscription it has not served
    expect(plane.current.asked).toHaveLength(1);
    expect(controller.state.getState().loadingOlder).toBe(false);
    plane.snapshot(script, cut, 6);
    await settle();
    controller.loadOlder();
    expect(plane.current.asked).toHaveLength(2);
    plane.send('rows', rowsBefore(script, cut, String(plane.current.asked[1].before), 100));
    await settle();
    await settle();
    expect(controller.state.getState()).toMatchObject({ more: false, loadingOlder: false });
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script, cut)));
  });

  it('keeps a held row newer than the fresh snapshot’s newest; the live part sends it again, and it is drawn once', async () => {
    const script = scriptOf(recording.session, null);
    const rowAt = (n: number) => script.findIndex((item) => item.kind === 'row' && item.body.row.uuid === rowsOf(script)[n].uuid);
    const held = rowAt(20) + 1;
    plane.snapshot(script, 0);
    await settle();
    await step(script.slice(0, held));
    const drawnRows = store.getState().entries[controller.key].rows;
    plane.current.listener.interrupted();
    const cut = rowAt(18); // the new subscription's cut is older than what the old one delivered
    plane.snapshot(script, cut, 5);
    await settle();
    await settle();
    expect(controller.state.getState().more).toBe(false); // as held: the rows reach the start
    expect(store.getState().entries[controller.key].rows.map((row) => row.id)).toEqual(drawnRows.map((row) => row.id));
    await step(script.slice(cut, held).filter((item) => item.kind === 'row')); // rows 18 to 20 again
    expect(store.getState().entries[controller.key].rows.map((row) => row.id)).toEqual(drawnRows.map((row) => row.id));
    await step(script.slice(held));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('a fresh snapshot that overlaps nothing held replaces the held rows, staged: the store never draws none', async () => {
    const script = scriptOf(recording.session, null);
    const early = script.findIndex((item) => item.kind === 'row' && item.body.row.uuid === rowsOf(script)[8].uuid) + 1;
    plane.snapshot(script, early);
    await settle();
    const counts: number[] = [];
    const off = store.subscribe((s) => counts.push(s.entries[controller.key]?.rows.length ?? 0));
    plane.current.listener.interrupted();
    plane.snapshot(script, script.length, 4); // much later: its oldest row is newer than every held one
    await settle();
    await settle();
    off();
    expect(counts.length).toBeGreaterThan(0);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(controller.state.getState().more).toBe(true);
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script).slice(-4)));
  });

  it('a block written while the subscription was down stays drawn until its row lands: no gap, drawn once', async () => {
    const script = scriptOf(recording.session, null);
    const named = script.findLastIndex((item) => item.kind === 'block-row');
    const { uuid } = script[named].body as { uuid: string };
    const landed = script.findIndex((item) => item.kind === 'row' && item.body.row.uuid === uuid);
    plane.snapshot(script, 0);
    await settle();
    await step(script.slice(0, named)); // the block's text has streamed; its block-row and row come in the gap
    const partial = controller.state.getState().streaming.find((b) => b.settledBy === null && b.text !== '')!;
    expect(partial).toBeDefined();
    plane.current.listener.interrupted();
    plane.snapshot(script, landed + 1);
    expect(seen(uuid)).toBe(false);
    expect(controller.state.getState().streaming).toContain(partial); // still drawn: its row is not in the store yet
    await settle();
    await settle();
    expect(seen(uuid)).toBe(true);
    expect(controller.state.getState().streaming).not.toContain(partial);
    await step(script.slice(landed + 1));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('a block named before the interruption, its row not yet in, keeps waiting for that row through a fresh snapshot cut before it', async () => {
    // A row trails its block-row (the engine flushes its transcript every 100 ms): the interruption, and the fresh
    // snapshot's cut, fall between them, so the row comes in the live part and the snapshot brings no row.
    const script = scriptOf(recording.session, null);
    const named = script.findIndex((item) => item.kind === 'block-row');
    const { uuid } = script[named].body as { uuid: string };
    plane.snapshot(script, 0);
    await settle();
    await step(script.slice(0, named + 1));
    expect(drawnBy(uuid)).toBe(true);
    plane.current.listener.interrupted();
    plane.snapshot(script, named + 1);
    await settle();
    await settle();
    expect(drawnBy(uuid)).toBe(true); // still drawn: its row is not in the store yet
    check();
    await step(script.slice(named + 1));
    expect(seen(uuid)).toBe(true);
    expect(drawnBy(uuid)).toBe(false);
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  // The fixture's main transcript: row 15 is a response's thinking block and row 16 its text; row 21 is the last
  // response of a turn, and row 23 starts the next.
  it('an aborted response drops its partial text at its step-end and keeps what was written', async () => {
    const script = scriptOf(recording.session, null, { stepEnds: true, cutOff: 16 });
    const ended = cutStepEnd(script);
    expect(script.some((item, i) => i < ended && item.kind === 'block-row' && item.body.turnId === (script[ended].body as StepEnd).turnId)).toBe(true); // the step's thinking was written
    const firstChunk = script.findIndex((item) => item.kind === 'chunk');
    plane.snapshot(script, firstChunk);
    await settle();
    await step(script.slice(firstChunk, ended));
    const partial = controller.state.getState().streaming.filter((b) => b.kind === 'text' && b.settledBy === null);
    expect(partial).toHaveLength(1);
    expect(partial[0].text.length).toBeGreaterThan(0);
    await step(script.slice(ended, ended + 1));
    expect(controller.state.getState().streaming.filter((b) => b.settledBy === null)).toEqual([]);
    await step(script.slice(ended + 1));
    expect(controller.state.getState().streaming).toEqual([]);
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
    // A snapshot taken after the step ended holds none of its partial text either.
    const late = new DeskTranscript({ plane, project: PROJECT, target: TARGET, store: createTranscriptStore() });
    late.open();
    plane.snapshot(script, ended + 1);
    expect(late.state.getState().streaming).toEqual([]);
    late.close();
  });

  it('a turn cut off mid-step drops the step’s partial text, ignores its stragglers, and the next turn draws on', async () => {
    const script = scriptOf(recording.session, null, { stepEnds: true, cutOff: 21 });
    const ended = cutStepEnd(script);
    const cut = script[ended].body as StepEnd;
    const firstChunk = script.findIndex((item) => item.kind === 'chunk');
    plane.snapshot(script, firstChunk);
    await settle();
    await step(script.slice(firstChunk, ended));
    expect(controller.state.getState().streaming.some((b) => b.turnId === cut.turnId && b.step === cut.step && b.settledBy === null)).toBe(true);
    await step(script.slice(ended, ended + 1));
    expect(controller.state.getState().streaming).toEqual([]);
    plane.send('chunk', { ...cut, chunkIndex: 999, chunk: { kind: 'text', index: 0, text: STRAY } });
    await settle();
    expect(controller.state.getState().streaming).toEqual([]);
    await step(script.slice(ended + 1));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rowsOf(script)));
  });

  it('a block-row that arrives after its step ended names nothing drawn; its row is then drawn once', async () => {
    // The bridge holds a step's end until its notices are posted, for at most a second (DC2's walk, composite
    // 2038124c): past that, the step's end can come first.
    const script = scriptOf(recording.session, null, { stepEnds: true, cutOff: 16 });
    const ended = cutStepEnd(script);
    const cut = script[ended].body as StepEnd;
    const row = recording.session[16];
    const firstChunk = script.findIndex((item) => item.kind === 'chunk');
    plane.snapshot(script, firstChunk);
    await settle();
    await step(script.slice(firstChunk, ended + 1));
    expect(controller.state.getState().streaming).toEqual([]);
    await step([
      { kind: 'block-row', body: { uuid: String(row.uuid), turnId: cut.turnId, agentId: null, step: cut.step, index: Number(row.apiBlockIndex) } },
      { kind: 'row', body: { row, agentId: null } },
    ]);
    expect(controller.state.getState().streaming).toEqual([]);
    await step(script.slice(ended + 1));
    expect(controller.state.getState().streaming).toEqual([]);
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(recording.session));
  });

  it('a turn its own subagent’s hand-back opens is the session’s own, continued, not a peer session’s', async () => {
    // Rows 13 and 19 are the two subagents' hand-backs (`<agent-message from=…>`, the peer origin), each of which opens
    // a turn the session runs on its own; MAWS reads the engine's origin as "Continued for …".
    plane.snapshot(scriptOf(recording.session, null), Number.MAX_SAFE_INTEGER);
    await settle();
    await settle();
    const dividers = store.getState().entries[controller.key].rows.filter((row) => row.kind === 'divider');
    const handback = (uuid: unknown) => dividers.find((row) => row.turnId !== null && store.getState().entries[controller.key].state.turns.get(row.turnId)?.events.some((e) => 'messageUuid' in e && e.messageUuid === uuid));
    for (const at of [13, 19]) expect(handback(recording.session[at].uuid)?.origin, `row ${at}'s turn`).toBe('engine');
    expect(dividers.map((row) => row.origin)).not.toContain('peer');
  });

  it('draws a delivery the bridge appended again after an Esc once: the copy drawn leaves as the one the engine read lands', async () => {
    // An Esc before the model answered left the first copy on a dead branch (the owner's prompt sent again went in under
    // the same parent), and the bridge appended the delivery again (doperpowers #233), the same text.
    const last = recording.session.at(-1)!;
    const id = (n: number) => `e5c0e5c0-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const at = (second: number) => `2027-01-01T00:00:${String(second).padStart(2, '0')}.000Z`;
    const base = (n: number, parent: string, second: number) => ({ uuid: id(n), parentUuid: parent, timestamp: at(second), sessionId: TARGET.session, isSidechain: false });
    const prompt = (n: number, second: number) => ({ ...base(n, String(last.uuid), second), type: 'user', origin: { kind: 'human' }, promptId: `p${n}`, message: { role: 'user', content: 'Now the tests.' } });
    const delivery = (n: number, parent: number, second: number) => ({ ...base(n, id(parent), second), type: 'user', isMeta: true, origin: { kind: 'plugin', name: 'doperpowers' }, message: { role: 'user', content: [{ type: 'text', text: '[sminos message from human id=5e551e17]\nRun the suites.' }] } });
    const rows: JsonObject[] = [
      ...recording.session,
      prompt(1, 10),
      delivery(2, 1, 11),
      { ...base(3, id(2), 12), type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
      prompt(4, 13),
      delivery(5, 4, 14),
      { ...base(6, id(5), 15), type: 'assistant', message: { id: 'msg_esc_reply', role: 'assistant', model: 'claude-opus-5-5', type: 'message', content: [{ type: 'text', text: 'Running them.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
    ];
    const script = scriptOf(rows, null);
    const rowAt = (n: number) => script.findIndex((item) => item.kind === 'row' && item.body.row.uuid === id(n));
    const deliveries = () => store.getState().entries[controller.key].rows.flatMap((row) => (row.kind === 'user' && row.text === 'Run the suites.' ? [row.messageUuid] : []));
    plane.snapshot(script, rowAt(1));
    await settle();
    await step(script.slice(rowAt(1), rowAt(5)));
    expect(deliveries()).toEqual([id(2)]);
    await step(script.slice(rowAt(5), rowAt(5) + 1));
    await settle(); // the rebuilt source, attached
    expect(deliveries()).toEqual([id(5)]);
    await step(script.slice(rowAt(5) + 1));
    expect(store.getState().entries[controller.key].rows).toEqual(await freshRows(rows));
  });

  it('closes its subscription when closed', () => {
    controller.close();
    expect(plane.current.closed).toBe(true);
  });
});
