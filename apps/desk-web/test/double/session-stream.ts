// The session plane's live part, synthesized from a recorded transcript (the DC6 plan's Decision Log, "The double's
// fixture"): a plain recording carries no bridge stream, so each assistant row's content block is played as DX5
// `turn.step` chunks in the engine's own shapes, then the block's `block-row`, then the row (DX4's order), and every
// other row is played as it is. A cut anywhere in that script gives the snapshot a producer would take there: the rows
// already written (newest first) and, per model request still streaming, the blocks without a `block-row` yet with the
// text of their chunks up to the cut and its `upTo`. Used by the unit suites and by the browser suites' double.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject, SessionBodies, SessionPresence, Streaming, StreamingBlock, SubagentMeta } from 'desk-hub/protocol';

export type Recording = { session: JsonObject[]; subagents: Array<SubagentMeta & { rows: JsonObject[] }> };

export const RECORDING_DIR = join(import.meta.dirname, '..', 'fixtures', 'depth');

const jsonl = (path: string): JsonObject[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as JsonObject);

/** The scrubbed recording: the main transcript's rows and each subagent's meta and rows, oldest first. */
export function readRecording(dir = RECORDING_DIR): Recording {
  const subDir = join(dir, 'subagents');
  const subagents = readdirSync(subDir)
    .filter((name) => name.endsWith('.meta.json'))
    .sort()
    .map((name) => {
      const agentId = name.slice('agent-'.length, -'.meta.json'.length);
      return { agentId, meta: JSON.parse(readFileSync(join(subDir, name), 'utf8')) as JsonObject, rows: jsonl(join(subDir, `agent-${agentId}.jsonl`)) };
    });
  return { session: jsonl(join(dir, 'session.jsonl')), subagents };
}

export type LiveItem =
  | { kind: 'row'; body: SessionBodies['row'] }
  | { kind: 'chunk'; body: SessionBodies['chunk'] }
  | { kind: 'block-row'; body: SessionBodies['block-row'] };

export type ScriptOptions = {
  /** Characters per text, thinking, or input chunk. */
  piece?: number;
  /**
   * Each block's row arrives after the first chunks of the next block of the same response (the engine flushes its
   * transcript every 100 ms, so a settling row can trail the stream), instead of right after its `block-row`.
   */
  lateRows?: boolean;
  /** After the n-th `block-row` of the script (from 0), one more chunk for that block: a straggler the browser ignores. */
  strayAfterBlockRow?: number;
};

/** The text a straggler chunk carries, so a suite can say it is never drawn. */
export const STRAY = '⁣STRAY-CHUNK';

const contentOf = (row: JsonObject): JsonObject[] => {
  const message = row.message as JsonObject | undefined;
  return Array.isArray(message?.content) ? (message.content as JsonObject[]) : [];
};

const pieces = (text: string, size: number): string[] => {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
};

/** The chunks that stream one content block, in the engine's `turn.step` chunk shapes (DX5). */
function chunksOfBlock(block: JsonObject, index: number, size: number): JsonObject[] {
  switch (block.type) {
    case 'text':
      return pieces(String(block.text ?? ''), size).map((text) => ({ kind: 'text', index, text }));
    case 'thinking':
      return pieces(String(block.thinking ?? ''), size).map((text) => ({ kind: 'thinking', index, text }));
    case 'tool_use':
      return [{ kind: 'tool', index, id: String(block.id), name: String(block.name) }, ...pieces(JSON.stringify(block.input ?? {}), size).map((json) => ({ kind: 'input', index, json }))];
    default:
      return [];
  }
}

const startsTurn = (row: JsonObject) => row.type === 'user' && typeof (row.message as JsonObject | undefined)?.content === 'string';

/**
 * The live script of one transcript, oldest first: each assistant row as chunks, `block-row`, row; every other row as
 * itself. Turns begin at each user row with a prompt's string content (`turn-<n>`); a request (step) is one API
 * message id within its turn; a content block's index is the row's `apiBlockIndex`.
 */
export function scriptOf(rows: JsonObject[], agentId: string | null, options: ScriptOptions = {}): LiveItem[] {
  const size = options.piece ?? 9;
  const items: LiveItem[] = [];
  let turn = -1;
  let turnId = 'turn-0';
  let step = -1;
  let message: string | null = null;
  let chunkIndex = 0;
  let blockRows = 0;
  let late: LiveItem | null = null; // a row held back until the next block of its response has begun
  const flushLate = () => {
    if (late) items.push(late);
    late = null;
  };
  for (const row of rows) {
    const id = (row.message as JsonObject | undefined)?.id;
    if (row.type === 'assistant' && typeof id === 'string') {
      if (id !== message) {
        flushLate();
        if (message !== null) items.push({ kind: 'chunk', body: { turnId, agentId, step, chunkIndex: chunkIndex++, chunk: { kind: 'stop', stopReason: 'end_turn', usage: null } } });
        message = id;
        step += 1;
        chunkIndex = 0;
      }
      const index = typeof row.apiBlockIndex === 'number' ? row.apiBlockIndex : 0;
      const chunks = contentOf(row).flatMap((block, i) => chunksOfBlock(block, index + i, size));
      chunks.forEach((chunk, i) => {
        items.push({ kind: 'chunk', body: { turnId, agentId, step, chunkIndex: chunkIndex++, chunk } });
        if (i === 0) flushLate(); // the previous block's row trails the first chunk of this one
      });
      // A block that streams as none of the three kinds (a server tool's) gets no `block-row`: its row settles nothing.
      if (chunks.length > 0) items.push({ kind: 'block-row', body: { uuid: String(row.uuid), turnId, agentId, step, index } });
      if (chunks.length > 0 && blockRows++ === options.strayAfterBlockRow) {
        items.push({ kind: 'chunk', body: { turnId, agentId, step, chunkIndex: chunkIndex++, chunk: { kind: 'text', index, text: STRAY } } });
      }
      const item: LiveItem = { kind: 'row', body: { row, agentId } };
      if (options.lateRows) {
        flushLate();
        late = item;
      } else items.push(item);
      continue;
    }
    flushLate();
    if (message !== null) {
      items.push({ kind: 'chunk', body: { turnId, agentId, step, chunkIndex: chunkIndex++, chunk: { kind: 'stop', stopReason: 'end_turn', usage: null } } });
      message = null;
    }
    if (startsTurn(row)) {
      turn += 1;
      turnId = `turn-${turn}`;
      step = -1;
    }
    items.push({ kind: 'row', body: { row, agentId } });
  }
  flushLate();
  return items;
}

const blockKind = (chunk: JsonObject): 'text' | 'thinking' | 'tool' | null =>
  chunk.kind === 'text' ? 'text' : chunk.kind === 'thinking' ? 'thinking' : chunk.kind === 'tool' || chunk.kind === 'input' ? 'tool' : null;

/**
 * The snapshot a producer takes after the first `cut` items of the script: every row played so far, newest first
 * (`limit` of them at most, `more` saying whether older ones exist), and each request still streaming with its blocks
 * that have no `block-row` yet, their text through the cut and `upTo` the index of the last chunk it includes.
 */
export function snapshotAt(script: LiveItem[], cut: number, extra: { subagents?: SubagentMeta[]; presence?: SessionPresence; limit?: number } = {}): SessionBodies['snapshot'] {
  const played = script.slice(0, cut);
  const rows = played.filter((item): item is Extract<LiveItem, { kind: 'row' }> => item.kind === 'row').map((item) => item.body.row);
  const limit = extra.limit ?? rows.length;
  const messages = new Map<string, Streaming>();
  const settled = new Set<string>();
  for (const item of played) {
    if (item.kind === 'block-row') settled.add(`${item.body.turnId}|${item.body.agentId}|${item.body.step}|${item.body.index}`);
    if (item.kind !== 'chunk') continue;
    const { turnId, agentId, step, chunkIndex, chunk } = item.body;
    const kind = blockKind(chunk);
    const key = `${turnId}|${agentId}|${step}`;
    if (kind === null || typeof chunk.index !== 'number') continue;
    if (settled.has(`${key}|${chunk.index}`)) continue; // a straggler after the block's row was named
    let message = messages.get(key);
    if (!message) messages.set(key, (message = { turnId, agentId, step, model: 'claude-sonnet-5-5', upTo: -1, blocks: [] }));
    let block = message.blocks.find((b) => b.index === chunk.index);
    if (!block) message.blocks.push((block = { index: chunk.index, kind, text: '', upTo: -1 } as StreamingBlock));
    if (chunk.kind === 'tool') Object.assign(block, { id: chunk.id, name: chunk.name });
    block.text += String(chunk.text ?? chunk.json ?? '');
    block.upTo = chunkIndex;
    message.upTo = chunkIndex; // the request's watermark (DX4 at composite 8f7e09d3); a block's own is informational
  }
  const streaming = [...messages.values()]
    .map((m) => ({ ...m, blocks: m.blocks.filter((b) => !settled.has(`${m.turnId}|${m.agentId}|${m.step}|${b.index}`)) }))
    .filter((m) => m.blocks.length > 0);
  return {
    rows: rows.slice(-limit).reverse(),
    more: rows.length > limit,
    subagents: extra.subagents ?? [],
    presence: extra.presence ?? { record: { status: 'busy' }, bridge: true },
    streaming,
  };
}

/** Older rows before `before` (a row uuid), newest first, as a `rows` answer would carry them. */
export function rowsBefore(script: LiveItem[], cut: number, before: string, limit: number): SessionBodies['rows'] {
  const rows = script.slice(0, cut).filter((item): item is Extract<LiveItem, { kind: 'row' }> => item.kind === 'row').map((item) => item.body.row);
  const at = rows.findIndex((row) => row.uuid === before);
  const older = at < 0 ? [] : rows.slice(0, at);
  return { rows: older.slice(-limit).reverse(), before, more: older.length > limit };
}
