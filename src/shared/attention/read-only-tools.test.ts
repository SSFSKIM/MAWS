import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../graph/events';
import { isReadOnlyRequest } from './read-only-tools';

const base = { id: 'e1', sessionId: 's1', at: '2026-09-28T10:00:00Z', seq: 1, agentId: null, parentToolUseId: null };
const permission = (toolName: string) =>
  ({
    ...base, kind: 'permission.requested', requestId: 'r1', toolUseId: 't1', toolName, displayName: null, input: {},
    description: null, decisionReasonType: null, suggestions: [], blockedPath: null,
  }) as unknown as SessionEvent;

describe('read-only tools', () => {
  it('lets a permission request for a read-only tool be answered outside the pane', () => {
    for (const tool of ['Read', 'Glob', 'Grep', 'WebFetch']) expect(isReadOnlyRequest(permission(tool)), tool).toBe(true);
  });

  it('never treats writes, shells, agents, MCP tools or unknown names as read-only', () => {
    for (const tool of ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Task', 'mcp__github__get_file', 'Readme']) {
      expect(isReadOnlyRequest(permission(tool)), tool).toBe(false);
    }
  });

  it('is false for no request and for other request kinds', () => {
    expect(isReadOnlyRequest(null)).toBe(false);
    const question = { ...base, kind: 'question.requested', requestId: 'r1', toolUseId: 't1', questions: [] } as unknown as SessionEvent;
    expect(isReadOnlyRequest(question)).toBe(false);
  });
});
