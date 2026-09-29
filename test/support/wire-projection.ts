// The core of a conversation, read two ways so they can be compared (C4 execution document, M5; acceptance item 5): from
// a probe journal's raw frames (`projectWire`) and from X1 events (`projectEvents`). A test helper, not a normaliser: it
// reads only what both a wire journal and a disk transcript carry — the prompts MAWS sent, assistant blocks (message uuid,
// index within the API message, block type), tool uses and results, compaction boundaries — attributed by scope
// (`parent_tool_use_id` on the wire; the parent conversation is null).
//
// What the two carry differently is left out on the event side: an engine-initiated task notification is a user record
// on disk but a `system/task_notification` frame on the wire, and a child agent's prompt is the parent's Agent tool
// input, never a user frame of its own.
import type { SessionEvent } from '@shared/graph/events';
import type { ParentToolUseId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';

export interface CoreProjection {
  userMessages: { uuid: string; text: string }[];
  assistantBlocks: { messageUuid: string; index: number; type: string }[];
  toolUses: { id: string; name: string }[];
  toolResults: { id: string; isError: boolean }[];
  compactions: { trigger: string | null; preTokens: number }[];
}

type Block = { type?: unknown; text?: unknown; id?: unknown; name?: unknown; tool_use_id?: unknown; is_error?: unknown };
interface Frame {
  type?: unknown;
  subtype?: unknown;
  uuid?: unknown;
  parent_tool_use_id?: unknown;
  message?: { id?: unknown; content?: unknown };
  compact_metadata?: { trigger?: unknown; pre_tokens?: unknown };
}

const empty = (): CoreProjection => ({ userMessages: [], assistantBlocks: [], toolUses: [], toolResults: [], compactions: [] });

// Prompt text: a string, or the text blocks joined.
function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts = (content as Block[]).filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text as string);
  return texts.length === 0 ? null : texts.join('\n');
}

export function projectWire(rows: JournalRow[], scope: { parentToolUseId: ParentToolUseId | null }): CoreProjection {
  const out = empty();
  const prompts = new Set<string>();
  const blocksPerMessage = new Map<string, number>(); // the wire sends one frame per block; its index is its order within the API message
  const prompt = (uuid: unknown, content: unknown) => {
    const text = textOf(content);
    if (typeof uuid !== 'string' || text === null || prompts.has(uuid)) return;
    prompts.add(uuid);
    out.userMessages.push({ uuid, text });
  };
  for (const { direction, frame: raw } of rows) {
    const frame = (raw ?? {}) as Frame;
    if ((frame.parent_tool_use_id ?? null) !== scope.parentToolUseId) continue;
    if (direction === 'out') {
      if (frame.type === 'user') prompt(frame.uuid, frame.message?.content);
      continue;
    }
    if (direction !== 'in') continue;
    if (frame.type === 'assistant' && Array.isArray(frame.message?.content)) {
      const messageId = String(frame.message.id);
      for (const block of frame.message.content as Block[]) {
        const index = blocksPerMessage.get(messageId) ?? 0;
        blocksPerMessage.set(messageId, index + 1);
        out.assistantBlocks.push({ messageUuid: String(frame.uuid), index, type: String(block.type) });
        if (block.type === 'tool_use') out.toolUses.push({ id: String(block.id), name: String(block.name) });
      }
    } else if (frame.type === 'user') {
      const content = frame.message?.content;
      const blocks = Array.isArray(content) ? (content as Block[]) : [];
      for (const block of blocks) if (block.type === 'tool_result') out.toolResults.push({ id: String(block.tool_use_id), isError: block.is_error === true });
      if (!blocks.some((block) => block.type === 'tool_result')) prompt(frame.uuid, content); // a replayed prompt
    } else if (frame.type === 'system' && frame.subtype === 'compact_boundary') {
      const meta = frame.compact_metadata ?? {};
      out.compactions.push({ trigger: typeof meta.trigger === 'string' ? meta.trigger : null, preTokens: typeof meta.pre_tokens === 'number' ? meta.pre_tokens : 0 });
    }
  }
  return out;
}

export function projectEvents(events: SessionEvent[]): CoreProjection {
  const out = empty();
  for (const event of events) {
    switch (event.kind) {
      case 'user.message': {
        const text = textOf(event.content);
        if (event.origin === 'task-notification' || event.agentId !== null || event.messageUuid === null || text === null) break;
        out.userMessages.push({ uuid: event.messageUuid, text });
        break;
      }
      case 'assistant.block.complete':
        out.assistantBlocks.push({ messageUuid: String(event.messageUuid), index: event.blockIndex, type: event.block.type });
        break;
      case 'tool.use':
        out.toolUses.push({ id: event.toolUseId, name: event.toolName });
        break;
      case 'tool.result':
        out.toolResults.push({ id: event.toolUseId, isError: event.isError });
        break;
      case 'boundary.compaction':
        out.compactions.push({ trigger: event.trigger, preTokens: event.preTokens });
        break;
      default:
        break;
    }
  }
  return out;
}
