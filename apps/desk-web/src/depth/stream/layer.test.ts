import type { SessionBodies } from 'desk-hub/protocol';
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
    const entry = { turnId: 't1', agentId: null, step: 0, model: 'm', upTo: 6, blocks: [{ index: 0, kind: 'text', text: 'Reading.', upTo: 2 }, { index: 1, kind: 'tool', id: 'toolu_1', name: 'Read', text: '{"file_pa', upTo: 5 }] };
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

  it('clears everything', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'a'));
    layer.blockRow(blockRow(0, 1, 'r1'));
    layer.clear();
    expect(drawn(layer)).toEqual([]);
    expect([...layer.awaited()]).toEqual([]);
  });
});
