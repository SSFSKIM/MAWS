import { readFileSync } from 'node:fs';
import type { SessionBodies, SessionMessage, Streaming, StreamingBlock } from 'desk-hub/protocol';
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
    expect(layer.blocks(null)[2]).toMatchObject({ toolName: 'Read', toolUseId: 'toolu_1' });
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
    expect(layer.blocks(null).map((b) => [b.kind, b.text, b.toolName, b.toolUseId])).toEqual([
      ['text', 'Reading.', null, null],
      ['tool', '{"file_pa', 'Read', 'toolu_1'],
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

  it('a snapshot older than what it drew of a request truncates nothing: the request is kept as drawn, its watermark with it', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'Hel'));
    layer.chunk(text(0, 1, 0, 'lo, '));
    layer.chunk(text(0, 2, 0, 'wor'));
    const block = layer.blocks(null)[0];
    // A producer that went back: its snapshot holds the request only through chunk 0.
    layer.resume([{ turnId: 't1', agentId: null, step: 0, upTo: 0, blocks: [{ index: 0, kind: 'text', text: 'Hel', upTo: 0 }] }], null, () => false);
    expect(drawn(layer)).toEqual([['text', 'Hello, wor']]);
    expect(layer.blocks(null)[0]).toBe(block);
    expect(layer.chunk(text(0, 1, 0, 'lo, '))).toBe(false); // sent again after the older snapshot: drawn already
    expect(layer.chunk(text(0, 2, 0, 'wor'))).toBe(false);
    expect(layer.chunk(text(0, 3, 0, 'ld.'))).toBe(true);
    expect(drawn(layer)).toEqual([['text', 'Hello, world.']]);
  });

  it('a snapshot older than a whole block it drew changes nothing of the request: the block stays, and the replayed live part draws it once', () => {
    const layer = new StreamingLayer();
    layer.chunk(chunk(0, 0, { kind: 'thinking', index: 0, text: 'Hm.' }));
    layer.blockRow(blockRow(0, 0, 'r-thinking'));
    layer.settle('r-thinking');
    layer.chunk(text(0, 1, 1, 'Hel'));
    const block = layer.blocks(null)[0];
    // A producer that went back: its snapshot was cut before the thinking block's block-row and before the text block began.
    layer.resume([{ turnId: 't1', agentId: null, step: 0, upTo: 0, blocks: [{ index: 0, kind: 'thinking', text: 'Hm.', upTo: 0 }] }], null, () => true);
    expect(drawn(layer)).toEqual([['text', 'Hel']]);
    expect(layer.blocks(null)[0]).toBe(block);
    // The live part after the snapshot's cut, sent again.
    layer.blockRow(blockRow(0, 0, 'r-thinking'));
    expect(layer.chunk(text(0, 1, 1, 'Hel'))).toBe(false);
    expect(layer.chunk(text(0, 2, 1, 'lo'))).toBe(true);
    expect(drawn(layer)).toEqual([['text', 'Hello']]);
  });

  it('an ended request stays ended through a snapshot older than its step-end: what the step-end dropped is not drawn again, and its chunks are not taken', () => {
    const play = (layer: StreamingLayer) => {
      layer.chunk(text(0, 0, 0, 'Written.'));
      layer.blockRow(blockRow(0, 0, 'r0'));
      layer.chunk(text(0, 1, 1, 'Half an ans'));
      layer.stepEnd({ turnId: 't1', agentId: null, step: 0 });
      expect(drawn(layer)).toEqual([['text', 'Written.']]);
    };
    // The older snapshot still streams the aborted block.
    const layer = new StreamingLayer();
    play(layer);
    layer.resume([{ turnId: 't1', agentId: null, step: 0, upTo: 1, blocks: [{ index: 1, kind: 'text', text: 'Half an ans', upTo: 1 }] }], null, (uuid) => uuid === 'r0');
    expect(drawn(layer)).toEqual([['text', 'Written.']]);
    expect(layer.chunk(text(0, 2, 1, 'wer.'))).toBe(false);
    expect(drawn(layer)).toEqual([['text', 'Written.']]);
    layer.settle('r0');
    expect(drawn(layer)).toEqual([]);

    // A snapshot that no longer streams it: the request is still known as ended, so a chunk sent again opens nothing.
    const quiet = new StreamingLayer();
    play(quiet);
    quiet.resume([], null, (uuid) => uuid === 'r0');
    expect(quiet.chunk(text(0, 1, 1, 'Half an ans'))).toBe(false);
    expect(drawn(quiet)).toEqual([['text', 'Written.']]);
  });

  it('draws a block the fresh snapshot carries named across an empty-history reconnect, with the snapshot’s text, until its row lands', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'Hello'));
    layer.chunk(text(0, 1, 0, ' wor'));
    layer.blockRow(blockRow(0, 0, 'r-a'));
    const block = layer.blocks(null)[0];
    // The reconnect's history is empty (the row is not on disk yet): no row will land without coming live, none came.
    layer.resume([{ turnId: 't1', agentId: null, step: 0, upTo: 1, blocks: [{ index: 0, kind: 'text', text: 'Hello wor', upTo: 1, uuid: 'r-a', namedAt: 1 }] }], null, () => false);
    expect(layer.blocks(null).map((b) => [b.text, b.settledBy])).toEqual([['Hello wor', 'r-a']]);
    expect(layer.blocks(null)[0]).toBe(block);
    layer.blockRow(blockRow(0, 0, 'r-a')); // the plane's block-row after the snapshot: changes nothing
    expect(layer.chunk(text(0, 2, 0, 'ld'))).toBe(false);
    expect([...layer.awaited()]).toEqual(['r-a']);
    expect(layer.settle('r-a')).toBe(true);
    expect(drawn(layer)).toEqual([]);
    expect(layer.settle('r-a')).toBe(false);
  });

  it('a first snapshot’s named block takes no later chunk and settles when its row lands, before any block-row', () => {
    const layer = new StreamingLayer();
    layer.load([{ turnId: 't1', agentId: null, step: 0, upTo: 1, blocks: [{ index: 0, kind: 'thinking', text: 'Hm.', upTo: 0, uuid: 'r-t', namedAt: 1 }, { index: 1, kind: 'text', text: 'He', upTo: 1 }] }]);
    expect(layer.blocks(null).map((b) => [b.kind, b.text, b.settledBy])).toEqual([
      ['thinking', 'Hm.', 'r-t'],
      ['text', 'He', null],
    ]);
    expect(layer.chunk(chunk(0, 2, { kind: 'thinking', index: 0, text: ' More.' }))).toBe(false);
    expect(layer.chunk(text(0, 3, 1, 'llo'))).toBe(true);
    layer.stepEnd({ turnId: 't1', agentId: null, step: 0 });
    expect(drawn(layer)).toEqual([['thinking', 'Hm.']]); // the named block waits for its row; the unnamed one went
    layer.settle('r-t');
    expect(drawn(layer)).toEqual([]);
  });

  it('keeps a block the old subscription named that the fresh snapshot still carries unnamed, whether or not its row will land', () => {
    const layer = new StreamingLayer();
    layer.chunk(text(0, 0, 0, 'Named'));
    layer.blockRow(blockRow(0, 0, 'r-n'));
    // A snapshot cut before the block-row, its history empty: the block-row is replayed after it.
    layer.resume([{ turnId: 't1', agentId: null, step: 0, upTo: 0, blocks: [{ index: 0, kind: 'text', text: 'Named', upTo: 0 }] }], null, () => false);
    expect(layer.blocks(null).map((b) => [b.text, b.settledBy])).toEqual([['Named', 'r-n']]);
    layer.blockRow(blockRow(0, 0, 'r-n'));
    layer.settle('r-n');
    expect(drawn(layer)).toEqual([]);
  });

  describe('a block past the producer’s bound, streaming across a reconnect', () => {
    // A tool call's long input, its lines alike but for their numbers; the producer's catch-up copy is its last 65,536
    // characters, marked `truncated`.
    const TAIL = 65_536;
    const whole = Array.from({ length: 4000 }, (_, i) => `line ${i} of a long tool input\n`).join('');
    const tailOf = (text: string, upTo: number): Streaming[] => [{ turnId: 't1', agentId: null, step: 0, upTo, blocks: [{ index: 0, kind: 'text', text: text.slice(-TAIL), upTo, truncated: true }] }];
    const streamed = (...pieces: string[]) => {
      const layer = new StreamingLayer();
      pieces.forEach((piece, at) => layer.chunk(text(0, at, 0, piece)));
      return layer;
    };

    it('splices the fresh snapshot’s tail onto the text it drew, so the block stays whole and goes on from there', () => {
      expect(whole.length).toBeGreaterThan(TAIL + 40_000);
      const layer = streamed(whole.slice(0, 50_000), whole.slice(50_000, 90_000));
      const block = layer.blocks(null)[0];
      // The gap streamed chunk 2, less than the tail holds: the tail starts inside the text drawn.
      layer.resume(tailOf(whole.slice(0, 95_000), 2), null, () => false);
      expect(layer.blocks(null)[0]).toBe(block);
      expect(layer.blocks(null)[0].text).toBe(whole.slice(0, 95_000));
      expect(layer.chunk(text(0, 2, 0, whole.slice(90_000, 95_000)))).toBe(false); // sent again: at the watermark
      layer.chunk(text(0, 3, 0, whole.slice(95_000)));
      expect(layer.blocks(null)[0].text).toBe(whole);
    });

    it('keeps the text it drew when nothing streamed in the gap, the tail all of it already', () => {
      const layer = streamed(whole.slice(0, 50_000), whole.slice(50_000, 90_000));
      layer.resume(tailOf(whole.slice(0, 90_000), 1), null, () => false);
      expect(layer.blocks(null)[0].text).toBe(whole.slice(0, 90_000));
    });

    it('draws the tail alone when the gap streamed more than it holds, though its first characters repeat the end drawn', () => {
      // The text drawn ends with a line's end, and the tail starts with that line's end again: an overlap of chance.
      const drawnTo = whole.indexOf('line 100 ');
      const tailFrom = whole.indexOf(' of a long tool input\nline 1000 ');
      const layer = streamed(whole.slice(0, drawnTo));
      layer.resume(tailOf(whole.slice(0, tailFrom + TAIL), 1), null, () => false);
      expect(layer.blocks(null)[0].text).toBe(whole.slice(tailFrom, tailFrom + TAIL));
    });

    it('draws the tail alone when text that repeats overlaps the end drawn more than one way', () => {
      // The longest overlap joins after 65,533 characters, where the gap streamed 5,003: it would drop 5,000 of them.
      const layer = streamed('PREFIX:' + 'a'.repeat(90_000));
      const later = 'PREFIX:' + 'a'.repeat(95_000) + 'END';
      layer.resume(tailOf(later, 1), null, () => false);
      expect(layer.blocks(null)[0].text).toBe(later.slice(-TAIL));
    });
  });
});

/**
 * The parity fixture `dx4-stream.json`: a verbatim copy of doperpowers `sminos/tests/dx4-stream.json` at commit
 * `56b51fb8` (sha256 `95212196fa979990331ab7b191ef9957420e105b15411a99d7acb77775396558`), written by its
 * `dx4-stream.gen.py` and replayed there by the reference consumer (`dx4_consumer.py`), so the consumer and this layer
 * prove the same rule (the desk open-fast spec, section 9). Never edit it here: copy the new file over this one and
 * update the commit and the hash.
 *
 * Every sequence is replayed through the layer alone, the store's side from the fixture's replay keys: after each
 * message the rows it lists in `settle` land, and a resumed snapshot answers `lands` and `landing` from the step. A
 * message after the subscription's `end` is not applied (the project client closes the subscription at its end); the
 * one a planted `n` gap carries is (`n` is the project client's to check, not the layer's: it never reaches here out of
 * order). The `errors` and `inventory` keys are the consumer's, read from what reached the whole view, not the layer.
 */
type Drawn = { turnId: string; agentId: string | null; step: number; index: number; kind: string; text: string; settledBy: string | null };
type FixtureStep = { message: SessionMessage | 'resubscribe'; settle?: string[]; landing?: string | null; lands?: string[]; drawn: Record<string, Drawn[]> };
type Sequence = { name: string; agent: string | null; steps: FixtureStep[] };
const SEQUENCES = JSON.parse(readFileSync(new URL('./dx4-stream.json', import.meta.url), 'utf8')) as Sequence[];

/** The agents a sequence draws or streams for, `main` for the main loop. */
function agentsOf(sequence: Sequence): Set<string> {
  const agents = new Set<string>(['main']);
  for (const step of sequence.steps) {
    for (const agent of Object.keys(step.drawn)) agents.add(agent);
    if (step.message === 'resubscribe') continue;
    const body = step.message.body as { agentId?: string | null; streaming?: Streaming[] };
    if (typeof body.agentId === 'string') agents.add(body.agentId);
    for (const entry of body.streaming ?? []) if (entry.agentId !== null) agents.add(entry.agentId);
  }
  return agents;
}

function drawnOf(layer: StreamingLayer, agents: Set<string>): Record<string, Drawn[]> {
  const out: Record<string, Drawn[]> = {};
  for (const agent of agents) {
    const blocks = layer.blocks(agent === 'main' ? null : agent);
    if (blocks.length > 0) out[agent] = blocks.map(({ turnId, agentId, step, index, kind, text, settledBy }) => ({ turnId, agentId, step, index, kind, text, settledBy }));
  }
  return out;
}

describe('the streaming layer against the shared fixture (dx4-stream.json)', () => {
  it('holds every sequence §9 names', () => {
    expect(SEQUENCES.map((s) => s.name)).toEqual(expect.arrayContaining(['reconnect-empty-history-carries-the-named-block', 'reconnect-snapshot-no-longer-carries-the-block', 'reconnect-older-snapshot-changes-nothing']));
  });

  for (const sequence of SEQUENCES) {
    it(`draws what the fixture expects after every message: ${sequence.name}`, () => {
      const layer = new StreamingLayer();
      const agents = agentsOf(sequence);
      let served = false;
      let ended = false;
      sequence.steps.forEach((step, at) => {
        const { message } = step;
        if (message === 'resubscribe') ended = false;
        else if (!ended) {
          switch (message.kind) {
            case 'snapshot':
              if (served) layer.resume(message.body.streaming, step.landing ?? null, (uuid) => (step.lands ?? []).includes(uuid));
              else layer.load(message.body.streaming);
              served = true;
              break;
            case 'chunk':
              layer.chunk(message.body);
              break;
            case 'block-row':
              layer.blockRow(message.body);
              break;
            case 'step-end':
              layer.stepEnd(message.body);
              break;
            case 'end':
              ended = true;
              break;
            default:
              break; // rows, the store's: their landing is the step's `settle`
          }
        }
        for (const uuid of step.settle ?? []) layer.settle(uuid);
        expect(drawnOf(layer, agents), `after message ${at} (${message === 'resubscribe' ? message : message.kind})`).toEqual(step.drawn);
      });
    });
  }
});

