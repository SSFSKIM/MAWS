import type { SessionBodies, Streaming, StreamingBlock } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { StreamingLayer } from './layer';

const chunk = (step: number, chunkIndex: number, body: Record<string, unknown>, agentId: string | null = null): SessionBodies['chunk'] => ({
  turnId: 't1',
  agentId,
  step,
  chunkIndex,
  chunk: body as SessionBodies['chunk']['chunk'],
});
const text = (step: number, chunkIndex: number, index: number, piece: string, agentId: string | null = null) => chunk(step, chunkIndex, { kind: 'text', index, text: piece }, agentId);
const blockRow = (step: number, index: number, uuid: string): SessionBodies['block-row'] => ({ uuid, turnId: 't1', agentId: null, step, index });
const drawn = (layer: StreamingLayer, agentId: string | null = null) => layer.blocks(agentId).map((b) => [b.kind, b.text]);

describe('the streaming layer', () => {
  it('grows each content block of one response from its chunks, in the engine shapes of every kind', () => {
    const layer = new StreamingLayer();
    layer.chunk(chunk(0, 0, { kind: 'thinking', index: 0, text: 'Weigh ' }));
    layer.chunk(chunk(0, 1, { kind: 'thinking', index: 0, text: 'it.' }));
    layer.chunk(text(0, 2, 1, 'The answer '));
    layer.chunk(text(0, 3, 1, 'is two.'));
    layer.chunk(chunk(0, 4, { kind: 'tool', index: 2, id: 'toolu_1', name: 'Read' }));
    layer.chunk(chunk(0, 5, { kind: 'input', index: 2, json: '{"file_path":' }));
    layer.chunk(chunk(0, 6, { kind: 'input', index: 2, json: '"/a"}' }));
    layer.chunk(chunk(0, 7, { kind: 'stop', stopReason: 'tool_use', usage: null }));
    expect(drawn(layer)).toEqual([
      ['thinking', 'Weigh it.'],
      ['text', 'The answer is two.'],
      ['tool', '{"file_path":"/a"}'],
    ]);
    expect(layer.blocks(null)[2].toolName).toBe('Read');
  });

  it('keeps a block drawn after its block-row until the row it named lands, then drops that block alone', () => {
    const layer = new StreamingLayer();
    layer.chunk(chunk(0, 0, { kind: 'thinking', index: 0, text: 'Hm.' }));
    layer.chunk(text(0, 1, 1, 'Hello'));
    layer.blockRow(blockRow(0, 0, 'row-thinking'));
    expect(drawn(layer)).toEqual([
      ['thinking', 'Hm.'],
      ['text', 'Hello'],
    ]);
    expect([...layer.awaited()]).toEqual(['row-thinking']);
    expect(layer.settle('row-thinking')).toBe(true);
    expect(drawn(layer)).toEqual([['text', 'Hello']]);
    expect(layer.settle('row-thinking')).toBe(false);
  });

  it('settles a late row after chunks of later blocks have streamed, losing none of them', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'First.'));
    layer.blockRow(blockRow(0, 0, 'r0'));
    layer.chunk(text(0, 1, 1, 'Sec'));
    layer.chunk(text(0, 2, 1, 'ond.'));
    expect(drawn(layer)).toEqual([
      ['text', 'First.'],
      ['text', 'Second.'],
    ]);
    layer.settle('r0');
    expect(drawn(layer)).toEqual([['text', 'Second.']]);
  });

  it('ignores a chunk for a block whose block-row has arrived, and one for a block already settled', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'Done.'));
    layer.blockRow(blockRow(0, 0, 'r0'));
    expect(layer.chunk(text(0, 1, 0, ' stray'))).toBe(false);
    expect(drawn(layer)).toEqual([['text', 'Done.']]);
    layer.settle('r0');
    expect(layer.chunk(text(0, 2, 0, ' later'))).toBe(false);
    expect(drawn(layer)).toEqual([]);
  });

  it('a block-row for a block that never streamed here stops its later chunks from drawing', () => {
    const layer = new StreamingLayer();
    layer.blockRow(blockRow(0, 0, 'r0'));
    expect(layer.chunk(text(0, 3, 0, 'late'))).toBe(false);
    expect(drawn(layer)).toEqual([]);
  });

  it('takes a snapshot whole, and drops a chunk at or below its request watermark', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(5, 0, 0, 'stale'));
    layer.load([{ turnId: 't1', agentId: null, step: 0, upTo: 3, blocks: [{ index: 0, kind: 'thinking', text: 'Hm.', upTo: 1 }, { index: 1, kind: 'text', text: 'Hel', upTo: 3 }] }]);
    expect(drawn(layer)).toEqual([
      ['thinking', 'Hm.'],
      ['text', 'Hel'],
    ]);
    expect(layer.chunk(text(0, 3, 1, 'Hel'))).toBe(false); // in the snapshot already
    expect(layer.chunk(text(0, 2, 1, 'el'))).toBe(false);
    expect(layer.chunk(text(0, 4, 1, 'lo'))).toBe(true);
    expect(drawn(layer)).toEqual([
      ['thinking', 'Hm.'],
      ['text', 'Hello'],
    ]);
  });

  it('reads the request’s watermark from the entry, whatever its blocks say, and a tool call as its arguments’ text', () => {
    const layer = new StreamingLayer();
    const text: StreamingBlock = { index: 0, kind: 'text', text: 'Reading.', upTo: 2 };
    const tool: StreamingBlock = { index: 1, kind: 'tool', id: 'toolu_1', name: 'Read', text: '{"file_pa', upTo: 5 };
    const entry: Streaming = { turnId: 't1', agentId: null, step: 0, model: 'm', upTo: 6, blocks: [text, tool] };
    layer.load([entry, { turnId: 't1', agentId: null, step: 1, upTo: -1, blocks: [] }]);
    expect(layer.blocks(null).map((b) => [b.kind, b.text, b.toolName])).toEqual([
      ['text', 'Reading.', null],
      ['tool', '{"file_pa', 'Read'],
    ]);
    expect(layer.chunk(chunk(0, 6, { kind: 'input', index: 1, json: 'th"' }))).toBe(false); // at the watermark
    expect(layer.chunk(chunk(0, 7, { kind: 'input', index: 1, json: 'th":"/a"}' }))).toBe(true);
    expect(layer.blocks(null)[1].text).toBe('{"file_path":"/a"}');
  });

  it('drops a repeated live chunk', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'a'));
    expect(layer.chunk(text(0, 0, 0, 'a'))).toBe(false);
    expect(drawn(layer)).toEqual([['text', 'a']]);
  });

  it('keeps requests apart by turn, agent, and step, and serves each agent its own', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'main'));
    layer.chunk(text(0, 0, 0, 'sub', 'a7'));
    layer.chunk(text(1, 0, 0, 'next'));
    expect(drawn(layer)).toEqual([
      ['text', 'main'],
      ['text', 'next'],
    ]);
    expect(drawn(layer, 'a7')).toEqual([['text', 'sub']]);
  });

  it('a step that ends drops its blocks no block-row named, keeps those awaiting their row, and takes no more chunks', () => {
    const layer = new StreamingLayer();
    layer.chunk(chunk(0, 0, { kind: 'thinking', index: 0, text: 'Hm.' }));
    layer.chunk(text(0, 1, 1, 'Half an ans'));
    layer.chunk(text(0, 0, 0, 'Theirs.', 'a1'));
    layer.blockRow(blockRow(0, 0, 'r-thinking'));
    layer.stepEnd({ turnId: 't1', agentId: null, step: 0 });
    expect(drawn(layer)).toEqual([['thinking', 'Hm.']]);
    expect(drawn(layer, 'a1')).toEqual([['text', 'Theirs.']]); // another agent's step 0 goes on
    expect(layer.chunk(text(0, 2, 1, 'wer.'))).toBe(false);
    expect(layer.chunk(text(0, 3, 2, 'More.'))).toBe(false);
    layer.chunk(text(1, 0, 0, 'Next.'));
    layer.settle('r-thinking');
    expect(drawn(layer)).toEqual([['text', 'Next.']]);
  });

  it('resumes from a fresh snapshot over what it drew: the snapshot’s text, each block the same one, drawn once', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'Hel'));
    const block = layer.blocks(null)[0];
    // The gap: chunks 1 and 2 were lost; the fresh snapshot holds them, its watermark 2.
    layer.resume([{ turnId: 't1', agentId: null, step: 0, upTo: 2, blocks: [{ index: 0, kind: 'text', text: 'Hello, wo', upTo: 2 }] }], null, () => false);
    expect(drawn(layer)).toEqual([['text', 'Hello, wo']]);
    expect(layer.blocks(null)[0]).toBe(block);
    expect(layer.chunk(text(0, 2, 0, 'lo, wo'))).toBe(false); // sent again after the snapshot: at its watermark
    layer.chunk(text(0, 3, 0, 'rld.'));
    expect(drawn(layer)).toEqual([['text', 'Hello, world.']]);
  });

  it('keeps a block the fresh snapshot no longer streams until the row that settles it lands, and drops one whose step ended', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'Done in the gap'));
    layer.chunk(text(1, 0, 0, 'Named before it'));
    layer.blockRow(blockRow(1, 0, 'r-named'));
    layer.chunk(text(2, 0, 0, 'Aborted in the gap'));
    // Step 0's block was written in the gap (the snapshot brought `r-new` as its newest row); step 1's row was named and
    // is held; a new step streams.
    layer.resume([{ turnId: 't1', agentId: null, step: 3, upTo: 0, blocks: [{ index: 0, kind: 'text', text: 'New', upTo: 0 }] }], 'r-new', (uuid) => uuid === 'r-named');
    expect(drawn(layer)).toEqual([
      ['text', 'Done in the gap'],
      ['text', 'Named before it'],
      ['text', 'Aborted in the gap'],
      ['text', 'New'],
    ]);
    expect(layer.chunk(text(0, 1, 0, ' more'))).toBe(false); // a kept block takes no more chunks
    expect([...layer.awaited()].sort()).toEqual(['r-named', 'r-new']);
    layer.settle('r-new');
    expect(drawn(layer)).toEqual([
      ['text', 'Named before it'],
      ['text', 'New'],
    ]);
    layer.settle('r-named');
    expect(drawn(layer)).toEqual([['text', 'New']]);

    // With no row brought, a block the snapshot no longer streams ended with its step, and goes at once.
    const quiet = new StreamingLayer();
    quiet.chunk(text(0, 0, 0, 'Cut off'));
    quiet.resume([], null, () => false);
    expect(drawn(quiet)).toEqual([]);
  });

  it('drops what a fresh snapshot cut before a block-row still streams of the block that row named, and takes none of its later chunks', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'Settled'));
    layer.blockRow(blockRow(0, 0, 'r-settled'));
    layer.settle('r-settled');
    layer.chunk(text(0, 1, 1, 'Named'));
    layer.blockRow(blockRow(0, 1, 'r-named'));
    // The fresh snapshot was cut before both block-rows: it streams both blocks, partly.
    const blocks = [
      { index: 0, kind: 'text' as const, text: 'Sett', upTo: 0 },
      { index: 1, kind: 'text' as const, text: 'Nam', upTo: 1 },
    ];
    layer.resume([{ turnId: 't1', agentId: null, step: 0, upTo: 1, blocks }], null, (uuid) => uuid === 'r-settled' || uuid === 'r-named');
    // The settled block is not drawn beside its row; the named one stays as drawn, awaiting its row.
    expect(drawn(layer)).toEqual([['text', 'Named']]);
    expect(layer.chunk(text(0, 2, 0, 'led'))).toBe(false);
    expect(layer.chunk(text(0, 3, 1, 'd'))).toBe(false);
    expect([...layer.awaited()]).toEqual(['r-named']);
    layer.settle('r-named');
    expect(drawn(layer)).toEqual([]);
  });
});
