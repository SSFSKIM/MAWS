import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { EventId, MessageUuid, ParentToolUseId, SessionId, ToolUseId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { projectEvents, projectWire } from './wire-projection';

let seq = 0;
const row = (direction: JournalRow['direction'], frame: unknown): JournalRow => ({ seq: ++seq, direction, at: '2026-09-28T10:00:00.000Z', frame });
const assistant = (uuid: string, messageId: string, blocks: unknown[], parent: string | null = null) =>
  row('in', { type: 'assistant', uuid, parent_tool_use_id: parent, message: { id: messageId, content: blocks } });

describe('the wire projection reads the core of a conversation from raw frames', () => {
  it('numbers blocks within their API message, keeps the scope, and reads prompts, results and compactions', () => {
    const rows = [
      row('meta', { event: 'spawn' }),
      row('out', { type: 'user', uuid: 'u1', parent_tool_use_id: null, message: { role: 'user', content: 'hello' } }),
      assistant('a1', 'msg_1', [{ type: 'thinking', thinking: '' }]),
      assistant('a2', 'msg_1', [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: {} }]),
      assistant('c1', 'msg_c', [{ type: 'text', text: 'child' }], 'toolu_1'),
      row('in', { type: 'user', uuid: 'r1', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: true }] } }),
      row('in', { type: 'user', uuid: 'u1', isReplay: true, parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'hello' }] } }),
      row('in', { type: 'system', subtype: 'compact_boundary', uuid: 'b1', compact_metadata: { trigger: 'manual', pre_tokens: 1200 } }),
      row('in', { type: 'stream_event', event: { type: 'content_block_delta' } }),
    ];
    expect(projectWire(rows, { parentToolUseId: null })).toEqual({
      userMessages: [{ uuid: 'u1', text: 'hello' }],
      assistantBlocks: [
        { messageUuid: 'a1', index: 0, type: 'thinking' },
        { messageUuid: 'a2', index: 1, type: 'tool_use' },
      ],
      toolUses: [{ id: 'toolu_1', name: 'Agent' }],
      toolResults: [{ id: 'toolu_1', isError: true }],
      compactions: [{ trigger: 'manual', preTokens: 1200 }],
    });
    expect(projectWire(rows, { parentToolUseId: 'toolu_1' as ParentToolUseId }).assistantBlocks).toEqual([{ messageUuid: 'c1', index: 0, type: 'text' }]);
  });

  it('projects X1 events the same way, leaving out what the wire carries as something else', () => {
    const base = { sessionId: 'S' as SessionId, at: '2026-09-28T10:00:00.000Z', seq: null, agentId: null, parentToolUseId: null };
    const events: SessionEvent[] = [
      { ...base, id: 'u1' as EventId, kind: 'user.message', messageUuid: 'u1' as MessageUuid, content: [{ type: 'text', text: 'hello' }], isReplay: false, isSynthetic: false, origin: null, bash: null },
      // An engine-initiated task notification is a `system/task_notification` frame on the wire, not a user frame.
      { ...base, id: 'n1' as EventId, kind: 'user.message', messageUuid: 'n1' as MessageUuid, content: '<task-notification>…', isReplay: false, isSynthetic: false, origin: 'task-notification', bash: null },
      { ...base, id: 'a1' as EventId, kind: 'assistant.block.complete', messageUuid: 'a1' as MessageUuid, apiMessageId: null, blockIndex: 0, block: { type: 'thinking' }, model: null, supersedes: [], aborted: false, userMessageUuids: [] },
      { ...base, id: 't1' as EventId, kind: 'tool.use', toolUseId: 'toolu_1' as ToolUseId, toolName: 'Agent', input: {}, apiMessageId: null, messageUuid: 'a1' as MessageUuid },
    ] as SessionEvent[];
    expect(projectEvents(events)).toEqual({
      userMessages: [{ uuid: 'u1', text: 'hello' }],
      assistantBlocks: [{ messageUuid: 'a1', index: 0, type: 'thinking' }],
      toolUses: [{ id: 'toolu_1', name: 'Agent' }],
      toolResults: [],
      compactions: [],
    });
  });
});
