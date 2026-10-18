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
// `step-end` drops its blocks no `block-row` named, so no partial text outlives its request.
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
};

const requestKey = (turnId: string, agentId: string | null, step: number) => `${turnId}\u0000${agentId ?? ''}\u0000${step}`;

/** DX4 names a block's kind as the bridge does (text, thinking, a tool call's input). */
function kindOf(name: unknown): BlockKind {
  if (name === 'text') return 'text';
  if (name === 'thinking') return 'thinking';
  return 'tool';
}

/**
 * One snapshot `streaming` entry read, in the one place its shape is read (DX4 as aligned at composite 8f7e09d3:
 * `{turnId, agentId, step, model?, upTo, blocks: [{index, kind, text, upTo, id?, name?}]}`). `chunkIndex` counts across
 * the whole request, so the entry's `upTo` is the watermark; a block's own `upTo` is informational. A tool call's block
 * carries `id` and `name`, its `text` the arguments' JSON as far as it has streamed, never parsed here. An entry with no
 * blocks gives nothing to draw.
 */
function snapshotEntry(entry: Streaming): { upTo: number; blocks: Array<Pick<StreamBlock, 'index' | 'kind' | 'text' | 'toolName'>> } {
  const raw: JsonObject[] = Array.isArray(entry.blocks) ? (entry.blocks as JsonObject[]) : [];
  const blocks = raw
    .filter((block) => typeof block.index === 'number')
    .map((block) => ({ index: block.index as number, kind: kindOf(block.kind), text: typeof block.text === 'string' ? block.text : '', toolName: typeof block.name === 'string' ? block.name : null }));
  return { upTo: typeof entry.upTo === 'number' ? entry.upTo : -1, blocks };
}

export class StreamingLayer {
  private requests = new Map<string, Request>();

  /** Replaces everything with a snapshot's `streaming`: the blocks still without a `block-row`, each with its `upTo`. */
  load(streaming: readonly Streaming[]): void {
    this.requests = new Map();
    for (const entry of streaming) {
      const request = this.request(entry.turnId, entry.agentId, entry.step);
      const { upTo, blocks } = snapshotEntry(entry);
      request.upTo = upTo;
      for (const block of blocks) request.blocks.set(block.index, { turnId: entry.turnId, agentId: entry.agentId, step: entry.step, settledBy: null, ...block });
    }
  }

  /**
   * A fresh snapshot's `streaming` after a disruption, over what was drawn before it. What the snapshot streams replaces
   * what was drawn, as `load` does, a block drawn before keeping its identity (its live label's clock goes on). A block
   * drawn before that the snapshot no longer streams had its row written, or its step ended, while the subscription was
   * down: it stays drawn, taking no more chunks, until the row its `block-row` named lands, or, when none was named in
   * time, until `landing` does (the newest row the snapshot brought, in the store once the transcript rebuilt from the
   * snapshot is installed), so a block never leaves before its row is drawn. With neither, its step ended, and it goes.
   * A snapshot cut before a `block-row` the old subscription delivered still streams the block that row named: its copy
   * is dropped, and the block takes no more chunks, whether it was settled already or is still drawn awaiting its row.
   * `held` says whether a named row is among the rows held now.
   */
  resume(streaming: readonly Streaming[], landing: string | null, held: (uuid: string) => boolean): void {
    const before = this.requests;
    this.load(streaming);
    const loaded = this.requests;
    this.requests = new Map();
    // The requests in the order they first appeared: those drawn before, then those the gap started.
    for (const [key, old] of before) {
      const request = loaded.get(key);
      if (request) {
        for (const index of old.named) {
          request.blocks.delete(index);
          request.named.add(index);
        }
      }
      for (const [index, block] of old.blocks) {
        const fresh = request?.blocks.get(index);
        if (fresh) {
          request!.blocks.set(index, Object.assign(block, { kind: fresh.kind, text: fresh.text, toolName: fresh.toolName, settledBy: null }));
          continue;
        }
        const settledBy = block.settledBy !== null && held(block.settledBy) ? block.settledBy : landing;
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
      const fresh: StreamBlock = { turnId: body.turnId, agentId: body.agentId, step: body.step, index, kind, text: '', toolName: null, settledBy: null };
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
    if (!request) this.requests.set(key, (request = { turnId, agentId, step, upTo: -1, blocks: new Map(), named: new Set(), ended: false }));
    return request;
  }
}
