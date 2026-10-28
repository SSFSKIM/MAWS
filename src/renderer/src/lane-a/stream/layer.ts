// The streaming layer over a transcript (the DC6 plan's M1 decision, "Settling without a message id"): the text of each
// model request still streaming, per content block, kept apart from MAWS's transcript store. DX4's chunks carry no API
// message id, and MAWS's reducer pairs a streaming block with its completed row only by that id, so streamed text never
// enters the reducer: it lives here until the row its `block-row` named lands in the store, and is dropped then. The
// store's rows are therefore exactly what the transcript's rows say, and a block's partial text and its row are never
// drawn together.
//
// A request is `(turnId, agentId, step)`; a block is its content block `index`. A chunk at or below the request's
// watermark (the last chunk its text includes: the snapshot's `upTo`, then each chunk applied) is already in the text;
// a chunk for a block whose `block-row` has arrived is ignored, since its row holds the block whole. A request's
// `step-end` drops its blocks no `block-row` named, so no partial text outlives its request. A snapshot carries a block
// named before it with that row's `uuid` (the desk open-fast spec, section 9: the producer keeps a named block's text
// until its step ends, since its row reaches the transcript only then): the layer draws it named, as if its `block-row`
// had come, and draws it on through a reconnect whose fresh snapshot carries it.
//
// A snapshot's copy of a block past the producer's bound is its tail (`truncated`, the open-fast spec's section 7: the
// last 65,536 characters; chunks stay whole). A first snapshot can draw only that tail. A reconnect's fresh copy of a
// block drawn before is spliced onto the text drawn where the two overlap, so a block streaming across a reconnect stays
// whole (`spliced`).
import type { BlockRow, JsonObject, SessionBodies, Streaming } from 'desk-hub/protocol';
import type { StepEnd } from 'desk-hub/protocol';

export type BlockKind = 'text' | 'thinking' | 'tool';

export type StreamBlock = {
  turnId: string;
  agentId: string | null;
  step: number;
  index: number;
  kind: BlockKind;
  /** The text so far: the visible text, the thinking, or a tool call's input JSON as it arrives. */
  text: string;
  /** A tool call's name, from its `tool` chunk. */
  toolName: string | null;
  /** A tool call's id (its `tool_use_id`), from its `tool` chunk. */
  toolUseId: string | null;
  /** The row the engine wrote for this block (its `block-row`), once named; the block is drawn until that row lands. */
  settledBy: string | null;
};

type Request = {
  turnId: string;
  agentId: string | null;
  step: number;
  /** The last chunk the request's text includes. */
  upTo: number;
  blocks: Map<number, StreamBlock>;
  /** Blocks whose `block-row` has arrived: their later chunks are ignored. */
  named: Set<number>;
  /** The request's `step-end` has arrived: it takes no more chunks. */
  ended: boolean;
  /** Blocks a snapshot carried cut to their tail (`truncated`): what streamed before the tail is not in their text. */
  tails: Set<number>;
};

/**
 * The shortest overlap `spliced` joins at. A shorter one may be chance — text that repeats a line's end, or a lone
 * character — where the gap streamed as much as the tail holds, or nearly, and nothing drawn overlaps it. A second
 * overlap this long leaves which one the gap streamed unknown, so `spliced` joins only where there is one alone.
 */
const SPLICE_MIN = 256;

/**
 * `drawn`, a block's text as drawn before a reconnect, with `tail`, the fresh snapshot's copy of the block cut to its
 * last characters, spliced on: the text from `drawn`'s start through the snapshot's cut. `drawn` runs from the block's
 * start, or from a tail an earlier snapshot gave, to a point the tail's watermark has passed, so where the gap streamed
 * less than the tail holds the tail starts inside `drawn`, its first characters `drawn`'s last. They join at that
 * overlap when it is the only one of SPLICE_MIN characters or more. Null otherwise, and the tail alone is drawn: with
 * none, the gap streamed past what `drawn` reaches, or may have; with more than one, as text that repeats can give,
 * which one the gap streamed is unknown, and the longest can drop what it streamed.
 */
function spliced(drawn: string, tail: string): string | null {
  // The longest prefix of `tail` that ends `drawn`, by Knuth–Morris–Pratt: the tail's failure function, then `drawn`'s
  // last `tail.length` characters run through it. Linear in the tail, so a 64 KiB tail costs nothing noticeable.
  const n = tail.length;
  if (n < SPLICE_MIN || drawn.length < SPLICE_MIN) return null;
  const fail = new Int32Array(n);
  for (let i = 1, k = 0; i < n; i++) {
    while (k > 0 && tail.charCodeAt(i) !== tail.charCodeAt(k)) k = fail[k - 1];
    if (tail.charCodeAt(i) === tail.charCodeAt(k)) k++;
    fail[i] = k;
  }
  let k = 0;
  for (let i = Math.max(0, drawn.length - n); i < drawn.length; i++) {
    while (k > 0 && drawn.charCodeAt(i) !== tail.charCodeAt(k)) k = fail[k - 1];
    if (drawn.charCodeAt(i) === tail.charCodeAt(k)) k++;
  }
  // Every shorter overlap is a border of `tail`'s first `k` characters, so the next longest is `fail[k - 1]`.
  return k >= SPLICE_MIN && fail[k - 1] < SPLICE_MIN ? drawn + tail.slice(k) : null;
}

const requestKey = (turnId: string, agentId: string | null, step: number) => `${turnId}\u0000${agentId ?? ''}\u0000${step}`;

/** DX4 names a block's kind as the bridge does (text, thinking, a tool call's input). */
function kindOf(name: unknown): BlockKind {
  if (name === 'text') return 'text';
  if (name === 'thinking') return 'thinking';
  return 'tool';
}

/**
 * One snapshot `streaming` entry read, in the one place its shape is read (DX4 as aligned at composite 8f7e09d3:
 * `{turnId, agentId, step, model?, upTo, blocks: [{index, kind, text, upTo, id?, name?, uuid?, namedAt?, truncated?}]}`).
 * `chunkIndex` counts across the whole request, so the entry's `upTo` is the watermark; a block's own `upTo` is
 * informational. A tool call's block carries `id` and `name`, its `text` the arguments' JSON as far as it has streamed,
 * never parsed here. A block named before the snapshot carries its row's `uuid` (`settledBy` here; a uuid that is not a
 * string is none); `truncated` says its text is the block's tail; `namedAt` is passed over. An entry with no blocks
 * gives nothing to draw.
 */
function snapshotEntry(entry: Streaming): { upTo: number; blocks: Array<{ block: Pick<StreamBlock, 'index' | 'kind' | 'text' | 'toolName' | 'toolUseId' | 'settledBy'>; tail: boolean }> } {
  const raw: JsonObject[] = Array.isArray(entry.blocks) ? (entry.blocks as JsonObject[]) : [];
  const blocks = raw
    .filter((block) => typeof block.index === 'number')
    .map((block) => ({
      block: {
        index: block.index as number,
        kind: kindOf(block.kind),
        text: typeof block.text === 'string' ? block.text : '',
        toolName: typeof block.name === 'string' ? block.name : null,
        toolUseId: typeof block.id === 'string' ? block.id : null,
        settledBy: typeof block.uuid === 'string' ? block.uuid : null,
      },
      tail: block.truncated === true,
    }));
  return { upTo: typeof entry.upTo === 'number' ? entry.upTo : -1, blocks };
}

export class StreamingLayer {
  private requests = new Map<string, Request>();

  /**
   * Replaces everything with a snapshot's `streaming`: each request's blocks with its `upTo`. A block the snapshot carries
   * named (its `uuid`) is drawn as one whose `block-row` came: it takes no later chunk and settles when that row lands,
   * whether or not a `block-row` follows (the plane sends one; it changes nothing).
   */
  load(streaming: readonly Streaming[]): void {
    this.requests = new Map();
    for (const entry of streaming) {
      const request = this.request(entry.turnId, entry.agentId, entry.step);
      const { upTo, blocks } = snapshotEntry(entry);
      request.upTo = upTo;
      for (const { block, tail } of blocks) {
        request.blocks.set(block.index, { turnId: entry.turnId, agentId: entry.agentId, step: entry.step, ...block });
        if (block.settledBy !== null) request.named.add(block.index);
        if (tail) request.tails.add(block.index);
      }
    }
  }

  /**
   * A fresh snapshot's `streaming` after a disruption, over what was drawn before it. A block the snapshot carries is
   * drawn from it, named or not, as `load` draws it, a block drawn before keeping its identity (its live label's clock
   * goes on): its text the snapshot's, or, for a block the old subscription had named, the text drawn (its `block-row`
   * came once the block was whole, so no copy holds more of it, and a copy cut before that holds less), or, for a block
   * still streaming that the snapshot carries cut to its tail (`truncated`), that tail spliced onto the text drawn
   * where the two overlap, so the block stays whole (`spliced`; the tail alone where they do not, or overlap more than
   * one way); named by the
   * snapshot's `uuid` when it carries one, else by what named it before (a snapshot cut before a `block-row` the old
   * subscription delivered carries the block unnamed, and that `block-row` follows it). So a block named and carried
   * across an empty-history reconnect — its row not yet on disk, none landing — stays drawn until its row lands.
   *
   * A block drawn before that the snapshot no longer streams had its row written, or its step ended, while the
   * subscription was down: it stays drawn, taking no more chunks, until the row its `block-row` named lands, or, when
   * none was named in time, until `landing` does (the newest row the snapshot brought, in the store once the transcript
   * rebuilt from the snapshot is installed), so a block never leaves before its row is drawn. With neither, its step
   * ended, and it goes. `lands` says whether a named row will land without a page (one held now, or one still to come
   * live); a block whose named row will not waits for `landing` instead, so it is never left drawn for a row that may
   * never come. A block the old subscription named and already settled (its row landed) is not drawn again from a copy
   * the snapshot carries unnamed: that copy was cut before the `block-row`, beside a row already drawn. Every block the
   * old subscription named takes no more chunks.
   *
   * A snapshot whose watermark for a request is below the drawn one (a producer that went back) is older than what was
   * drawn of it, and changes nothing of that request, which keeps its blocks, the blocks named, its end and its watermark
   * whole; the live part after the snapshot's cut replays the rest, the chunks the drawing holds dropped at the
   * watermark, the later ones appended, `block-row` and `step-end` arriving as they do live. Otherwise too an ended
   * request stays ended, whether or not the snapshot still streams it: the blocks its `step-end` dropped are not drawn
   * again from the snapshot's copy, and it takes no more chunks.
   */
  resume(streaming: readonly Streaming[], landing: string | null, lands: (uuid: string) => boolean): void {
    const before = this.requests;
    this.load(streaming);
    const loaded = this.requests;
    this.requests = new Map();
    // The requests in the order they first appeared: those drawn before, then those the gap started.
    for (const [key, old] of before) {
      const snapshot = loaded.get(key);
      if (snapshot && old.upTo > snapshot.upTo) {
        this.requests.set(key, old);
        continue;
      }
      // An ended request is kept where the snapshot no longer streams it, so it still takes no chunk.
      const request = snapshot ?? (old.ended ? this.request(old.turnId, old.agentId, old.step) : undefined);
      if (request) {
        for (const index of old.named) {
          if (!old.blocks.has(index) && request.blocks.get(index)?.settledBy === null) request.blocks.delete(index);
          request.named.add(index);
        }
        if (old.ended) {
          request.ended = true;
          request.blocks.clear(); // the snapshot's copies of the blocks the step-end dropped
        }
      }
      for (const [index, block] of old.blocks) {
        const fresh = request?.blocks.get(index);
        if (fresh) {
          const text = old.named.has(index) ? block.text : request!.tails.has(index) ? (spliced(block.text, fresh.text) ?? fresh.text) : fresh.text;
          request!.blocks.set(index, Object.assign(block, { kind: fresh.kind, text, toolName: fresh.toolName, toolUseId: fresh.toolUseId, settledBy: fresh.settledBy ?? block.settledBy }));
          continue;
        }
        const settledBy = block.settledBy !== null && lands(block.settledBy) ? block.settledBy : landing;
        if (settledBy === null) continue;
        const into = request ?? this.request(old.turnId, old.agentId, old.step);
        into.named.add(index);
        into.blocks.set(index, Object.assign(block, { settledBy }));
      }
      if (request) this.requests.set(key, request);
    }
    for (const [key, request] of loaded) if (!this.requests.has(key)) this.requests.set(key, request);
  }

  /** Applies one live chunk; true when it changed what is drawn. */
  chunk(body: SessionBodies['chunk']): boolean {
    const request = this.request(body.turnId, body.agentId, body.step);
    if (request.ended || body.chunkIndex <= request.upTo) return false;
    request.upTo = body.chunkIndex;
    const chunk: JsonObject = body.chunk;
    const index = chunk.index;
    if (typeof index !== 'number' || request.named.has(index)) return false;
    const existing = request.blocks.get(index);
    const block = (kind: BlockKind): StreamBlock => {
      if (existing) return existing;
      const fresh: StreamBlock = { turnId: body.turnId, agentId: body.agentId, step: body.step, index, kind, text: '', toolName: null, toolUseId: null, settledBy: null };
      request.blocks.set(index, fresh);
      return fresh;
    };
    switch (chunk.kind) {
      case 'text':
      case 'thinking':
        block(chunk.kind).text += typeof chunk.text === 'string' ? chunk.text : '';
        return true;
      case 'tool': {
        const tool = block('tool');
        tool.toolName = typeof chunk.name === 'string' ? chunk.name : tool.toolName;
        tool.toolUseId = typeof chunk.id === 'string' ? chunk.id : tool.toolUseId;
        return true;
      }
      case 'input':
        block('tool').text += typeof chunk.json === 'string' ? chunk.json : '';
        return true;
      default:
        return false; // `stop`, and any kind this layer does not draw
    }
  }

  /** The engine wrote block `index`'s row: the block stays drawn until that row lands, and takes no more chunks. */
  blockRow(body: BlockRow): void {
    const request = this.request(body.turnId, body.agentId, body.step);
    request.named.add(body.index);
    const block = request.blocks.get(body.index);
    if (block) block.settledBy = body.uuid;
  }

  /**
   * The request ended (DX4 `step-end`, after every `block-row` of the step): a block no `block-row` named never gets
   * one — the response was aborted or its turn cut it off — so its partial text is dropped; a named block stays drawn
   * until its row lands. True when any was dropped.
   */
  stepEnd(body: StepEnd): boolean {
    const request = this.request(body.turnId, body.agentId, body.step);
    request.ended = true;
    let changed = false;
    for (const [index, block] of request.blocks) {
      if (block.settledBy !== null) continue;
      request.blocks.delete(index);
      changed = true;
    }
    return changed;
  }

  /** The row `uuid` landed in the store: the blocks it settles are dropped. True when any was. */
  settle(uuid: string): boolean {
    let changed = false;
    for (const request of this.requests.values()) {
      for (const [index, block] of request.blocks) {
        if (block.settledBy !== uuid) continue;
        request.blocks.delete(index);
        changed = true;
      }
    }
    return changed;
  }

  /** The rows named by a `block-row` whose blocks are still drawn. */
  awaited(): Set<string> {
    const uuids = new Set<string>();
    for (const request of this.requests.values()) for (const block of request.blocks.values()) if (block.settledBy !== null) uuids.add(block.settledBy);
    return uuids;
  }

  /** One agent's blocks, in the order they are drawn: requests as they first appeared, blocks by index. */
  blocks(agentId: string | null): StreamBlock[] {
    const out: StreamBlock[] = [];
    for (const request of this.requests.values()) {
      if (request.agentId !== agentId) continue;
      out.push(...[...request.blocks.values()].sort((a, b) => a.index - b.index));
    }
    return out;
  }

  private request(turnId: string, agentId: string | null, step: number): Request {
    const key = requestKey(turnId, agentId, step);
    let request = this.requests.get(key);
    if (!request) this.requests.set(key, (request = { turnId, agentId, step, upTo: -1, blocks: new Map(), named: new Set(), ended: false, tails: new Set() }));
    return request;
  }
}
