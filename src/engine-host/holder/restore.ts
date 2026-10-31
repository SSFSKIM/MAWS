// The restore fold's reading half (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D24, D36,
// D42): an adopter reads the launch's whole journal, every file in order (a request outstanding across a rotation is
// found), synchronously, before it consumes a record of the session host's, and feeds each row to the session's readers
// through their restore entries (session.ts), which observe and emit nothing. Beside them this file keeps the
// outstanding set: what the old manager left unanswered, which the adopter disposes of once the ring's replay has caught
// up (Interfaces §D's table). It is fed every row from the journal's first through the replay, the live rows the
// barrier holds included, so a cancellation that arrives in the replay retires a request the journal left open.
//
// Outstanding: an engine request (`control_request` in) with neither our answer (`control_response` out) nor its
// cancellation (`control_cancel_request` in) naming it; less a `tools/call` its MCP client withdrew (`notifications/
// cancelled`, correlated here by server and JSON-RPC id, since the tool server's own correlation reads an in-memory map
// the adopter never filled, D42); less an ask the journal records as retired (`maws_ask_cancelled`). An async ask is
// answered `{status: 'asked'}` at once and waits for the human afterwards: one acknowledged and neither answered
// (`maws_ask_answered`) nor cancelled is an open async ask, restored as one. Our own requests (`control_request` out)
// with no `control_response` in are the outbound set. Nothing is identified by content beyond these ids.
import { closeSync, openSync, readSync } from 'node:fs';
import type { RequestId } from '@shared/graph/ids';
import { cancelledCallOf, readMcpMessage, toolCallOf } from '@shared/maws/rpc';
import type { ControlRequestFrame } from '@shared/wire/frames';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { JournalReader } from '../journal';

export interface OutstandingRequest {
  request: ControlRequestFrame;
  seq: number; // its row's
}

export interface Outstanding {
  inbound: OutstandingRequest[]; // in arrival order
  outbound: RequestId[];
  asyncAsks: { askId: string; request: ControlRequestFrame }[]; // the ask's own `tools/call`, whose input it is restored from
}

type Frame = Record<string, unknown> & { type?: unknown };

export class OutstandingSet {
  private readonly inbound = new Map<string, OutstandingRequest>();
  private readonly outbound = new Set<string>();
  private readonly asyncAsks = new Map<string, ControlRequestFrame>();

  observe(row: JournalRow): void {
    const frame = (row.frame ?? {}) as Frame;
    if (row.direction === 'meta') {
      if (frame.event === 'maws_ask_answered' || frame.event === 'maws_ask_cancelled') this.askRetired(String(frame.askId));
      return;
    }
    if (row.direction === 'in') {
      if (frame.type === 'control_request' && typeof frame.request_id === 'string') {
        const request = frame as unknown as ControlRequestFrame;
        this.inbound.set(frame.request_id, { request, seq: row.seq });
        const withdrawn = request.request.subtype === 'mcp_message' ? cancelledCallOf(readMcpMessage(request.request)) : null;
        if (withdrawn !== null) this.withdrawn(String((request.request as { server_name?: unknown }).server_name), withdrawn);
      } else if (frame.type === 'control_cancel_request' && typeof frame.request_id === 'string') {
        this.inbound.delete(frame.request_id);
      } else if (frame.type === 'control_response') {
        const id = (frame.response as { request_id?: unknown } | undefined)?.request_id;
        if (typeof id === 'string') this.outbound.delete(id);
      }
      return;
    }
    if (row.direction !== 'out') return;
    if (frame.type === 'control_request' && typeof frame.request_id === 'string') this.outbound.add(frame.request_id);
    else if (frame.type === 'control_response') {
      const response = (frame.response ?? {}) as { request_id?: unknown; response?: unknown };
      if (typeof response.request_id !== 'string') return;
      const answered = this.inbound.get(response.request_id);
      this.inbound.delete(response.request_id);
      const askId = answered ? asyncAskAcknowledged(answered.request, response.response) : null;
      if (askId !== null) this.asyncAsks.set(askId, answered!.request);
    }
  }

  result(): Outstanding {
    return {
      inbound: [...this.inbound.values()].sort((a, b) => a.seq - b.seq),
      outbound: [...this.outbound] as RequestId[],
      asyncAsks: [...this.asyncAsks].map(([askId, request]) => ({ askId, request })),
    };
  }

  // A `notifications/cancelled` naming the JSON-RPC id of a `tools/call` the same server was sent.
  private withdrawn(serverName: string, rpcId: string | number): void {
    for (const [requestId, { request }] of this.inbound) {
      const req = request.request as { subtype: string; server_name?: unknown; message?: { id?: unknown; method?: unknown } };
      if (req.subtype === 'mcp_message' && req.server_name === serverName && req.message?.method === 'tools/call' && req.message.id === rpcId) this.inbound.delete(requestId);
    }
  }

  // An ask answered (an async one's answers went as a steer) or cancelled: its async entry, and a blocking ask's call.
  private askRetired(askId: string): void {
    this.asyncAsks.delete(askId);
    for (const [requestId, { request }] of this.inbound) if (askIdOf(request) === askId) this.inbound.delete(requestId);
  }
}

// The ask a `tools/call` of `maws.ask` opens: its tool-use id, else its request id (tool-server/ask.ts).
export function askIdOf(request: ControlRequestFrame): string | null {
  const read = request.request.subtype === 'mcp_message' ? readMcpMessage(request.request) : null;
  if (read?.kind !== 'request' || read.method !== 'tools/call') return null;
  const call = toolCallOf(read.params);
  return call.name === 'ask' ? (call.toolUseId ?? request.request_id) : null;
}

// The askId an `ask` call's answer acknowledged (`{status: 'asked', askId}`: an async ask, open from then on), or null.
function asyncAskAcknowledged(request: ControlRequestFrame, response: unknown): string | null {
  if (askIdOf(request) === null) return null;
  const content = ((response as { mcp_response?: { result?: { content?: unknown } } } | undefined)?.mcp_response?.result?.content ?? []) as { type?: unknown; text?: unknown }[];
  const text = Array.isArray(content) ? content.find((block) => block.type === 'text')?.text : undefined;
  if (typeof text !== 'string') return null;
  try {
    const result = JSON.parse(text) as { status?: unknown; askId?: unknown };
    return result.status === 'asked' && typeof result.askId === 'string' ? result.askId : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The launch's rows

const CHUNK_BYTES = 1024 * 1024;

// Every row of the launch's journal, its base file then each rotation, read synchronously (the fold must finish before
// any record is consumed) a chunk at a time. A last line with no newline (a torn append the resumed writer has not
// truncated yet) is not a row.
export function* launchRows(dir: string, launchId: string): Generator<JournalRow> {
  const launch = JournalReader.launches(dir).find((l) => l.launchId === launchId);
  for (const file of launch?.files ?? []) yield* fileRows(file);
}

function* fileRows(path: string): Generator<JournalRow> {
  const fd = openSync(path, 'r');
  try {
    const chunk = Buffer.alloc(CHUNK_BYTES);
    let carry: Buffer[] = [];
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) return;
      let start = 0;
      for (;;) {
        const nl = chunk.indexOf(0x0a, start);
        if (nl < 0 || nl >= read) break;
        const line = carry.length > 0 ? Buffer.concat([...carry, chunk.subarray(start, nl)]) : chunk.subarray(start, nl);
        carry = [];
        start = nl + 1;
        if (line.length > 0) yield parseJournalRow(JSON.parse(line.toString('utf8')));
      }
      if (start < read) carry.push(Buffer.from(chunk.subarray(start, read)));
    }
  } finally {
    closeSync(fd);
  }
}

// The launch's `spawn` meta row (launch.ts spawnMeta), from which an adopter rebuilds the plan; null when none was written.
export interface SpawnRow { bin: string; args: string[]; envKeys: string[]; cwd: string; gateway: 'gateway' | 'direct'; engineVersion: string; launchId: string; sessionId: string }

export function spawnRowOf(rows: Iterable<JournalRow>): SpawnRow | null {
  for (const row of rows) {
    const f = row.frame as Partial<SpawnRow> & { event?: unknown };
    if (row.direction !== 'meta' || f.event !== 'spawn') continue;
    if (typeof f.bin !== 'string' || !Array.isArray(f.args) || !Array.isArray(f.envKeys) || typeof f.cwd !== 'string' || typeof f.launchId !== 'string' || typeof f.sessionId !== 'string') return null;
    return { bin: f.bin, args: f.args, envKeys: f.envKeys, cwd: f.cwd, gateway: f.gateway === 'gateway' ? 'gateway' : 'direct', engineVersion: String(f.engineVersion ?? ''), launchId: f.launchId, sessionId: f.sessionId };
  }
  return null;
}
