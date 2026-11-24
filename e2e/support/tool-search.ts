// A deferred `maws` tool, read off a live session's journal (the tool-choice plan's M6, A12;
// docs/doperpowers/plans/2026-11-23-tool-choice.md): under tool search the engine sends the model a deferred tool's name
// alone, and the model loads its definition with the engine's ToolSearch, whose answer is a tool result of
// `tool_reference` blocks naming what it loaded (P4-R7's probe, `p4/p4-r7-loss-dialog`). Since board ticket 420
// every `maws` tool but `ask` is deferred, so a session's first edit goes through a search first; a tool listed up front
// is called with none. Held to recordings of both in test/support/tool-search.test.ts.
import type { JournalRow } from '@shared/wire/journal';

type Block = { type?: string; tool_name?: string; content?: unknown };

// Each ToolSearch answer the engine wrote into the conversation: the seq of the user frame carrying it, and the tools its
// `tool_reference` blocks loaded, by their full names (`mcp__maws__<name>`).
export function toolSearchLoads(rows: JournalRow[]): { seq: number; tools: string[] }[] {
  return rows.flatMap((row) => {
    const frame = row.frame as { type?: string; message?: { content?: unknown } };
    if (row.direction !== 'in' || frame.type !== 'user' || !Array.isArray(frame.message?.content)) return [];
    const tools = (frame.message.content as Block[]).flatMap((block) =>
      block.type === 'tool_result' && Array.isArray(block.content) ? (block.content as Block[]).flatMap((part) => (part.type === 'tool_reference' && typeof part.tool_name === 'string' ? [part.tool_name] : [])) : [],
    );
    return tools.length > 0 ? [{ seq: row.seq, tools }] : [];
  });
}

// The engine's first `tools/call` of the `maws` tool `name`, and the search that loaded it before that call (null where
// none did: the tool was listed whole, or a search came only after). A deferred tool's first use reads
// `{ loadSeq: <n>, callSeq: <m> }` with n < m.
export function throughToolSearch(rows: JournalRow[], name: string): { loadSeq: number | null; callSeq: number | null } {
  const call = rows.find((row) => {
    const frame = row.frame as { type?: string; request?: { subtype?: string; server_name?: string; message?: { method?: string; params?: { name?: string } } } };
    const request = frame.request;
    return row.direction === 'in' && frame.type === 'control_request' && request?.subtype === 'mcp_message' && request.server_name === 'maws' && request.message?.method === 'tools/call' && request.message.params?.name === name;
  });
  if (call === undefined) return { loadSeq: null, callSeq: null };
  const load = toolSearchLoads(rows).find((searched) => searched.seq < call.seq && searched.tools.includes(`mcp__maws__${name}`));
  return { loadSeq: load?.seq ?? null, callSeq: call.seq };
}
