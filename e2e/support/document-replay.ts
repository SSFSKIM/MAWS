// P3-B (M7): a recorded `maws` session replayed with its `maws` tool calls made the calls a document case needs, so the
// host's real tool server answers document tools in the product app (C3's replay transport answers nothing itself; it
// matches a `control_response` by request id and behaviour). The recording is left as it was recorded (the conformance
// suite and the transcript snapshots read it); the copy is written under `test-results/replays/`, as A's
// `asPublishReplay` writes its own, and answered as a path relative to the repository, as `replay` takes a fixture.
//
// The k-th `mcp__maws__*` tool use of the recording becomes `calls[k]` in every frame that carries it: the stream's block
// start and its input deltas (the first delta the whole input, the rest empty), the assistant's tool use, the permission
// request, and the engine's `tools/call` (its name and arguments). The engine's recorded tool results are left as
// recorded: the model's words are never asserted, only the host's answers in the journal.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './launch';
import { fixtureRows, type Frame } from './maws-tools';

export interface DocumentCall {
  name: string; // the `maws` tool, without its `mcp__maws__` prefix
  input: Record<string, unknown>;
}

const titleOf = (name: string) =>
  name
    .split('_')
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join(' ');

export function asDocumentReplay(fixture: string, calls: DocumentCall[], label: string): string {
  const order: string[] = []; // the recording's maws tool-use ids in order
  const callOf = (toolUseId: unknown): DocumentCall | undefined => {
    if (typeof toolUseId !== 'string') return undefined;
    const at = order.indexOf(toolUseId);
    return at < 0 ? undefined : calls[at];
  };
  const open = new Map<number, { call: DocumentCall; deltas: number }>(); // stream block index → its call
  const rows = fixtureRows(fixture).map((row) => {
    const frame = structuredClone(row.frame) as Frame;
    const event = (frame as { event?: { type?: string; index?: number; content_block?: { id?: string; name?: string }; delta?: { type?: string; partial_json?: string } } }).event;
    if (frame.type === 'stream_event' && event) {
      const block = event.content_block;
      if (event.type === 'content_block_start' && block?.name?.startsWith('mcp__maws__') && block.id) {
        if (!order.includes(block.id)) order.push(block.id);
        const call = callOf(block.id);
        if (call) {
          block.name = `mcp__maws__${call.name}`;
          open.set(event.index!, { call, deltas: 0 });
        }
      } else if (event.type === 'content_block_stop') open.delete(event.index!);
      else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
        const entry = open.get(event.index!);
        if (entry) event.delta.partial_json = entry.deltas++ === 0 ? JSON.stringify(entry.call.input) : '';
      }
    }
    if (frame.type === 'assistant') {
      for (const part of ((frame.message as { content?: unknown[] }).content ?? []) as { type?: string; id?: string; name?: string; input?: unknown }[]) {
        if (part.type !== 'tool_use' || !part.name?.startsWith('mcp__maws__')) continue;
        if (part.id && !order.includes(part.id)) order.push(part.id);
        const call = callOf(part.id);
        if (call) Object.assign(part, { name: `mcp__maws__${call.name}`, input: call.input });
      }
    }
    if (frame.type === 'control_request') {
      const request = frame.request as { subtype?: string; tool_use_id?: string; tool_name?: string; message?: { method?: string; params?: { name?: string; arguments?: unknown; _meta?: Record<string, unknown> } } };
      if (request.subtype === 'can_use_tool') {
        const call = callOf(request.tool_use_id);
        if (call) Object.assign(request, { tool_name: `mcp__maws__${call.name}`, display_name: titleOf(call.name), input: call.input, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: `mcp__maws__${call.name}` }], behavior: 'allow', destination: 'localSettings' }] });
      } else if (request.subtype === 'mcp_message' && request.message?.method === 'tools/call') {
        const params = request.message.params!;
        const call = callOf(params._meta?.['claudecode/toolUseId']);
        if (call) Object.assign(params, { name: call.name, arguments: call.input });
      }
    }
    return { ...row, frame };
  });
  if (order.length !== calls.length) throw new Error(`${fixture} has ${order.length} maws tool uses; ${calls.length} calls were given`);
  const relative = join('test-results', 'replays', `${fixture.split('/').at(-1)!.replace(/\.jsonl$/, '')}.${label}.jsonl`);
  mkdirSync(join(REPO_ROOT, 'test-results', 'replays'), { recursive: true });
  writeFileSync(join(REPO_ROOT, relative), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return relative;
}
