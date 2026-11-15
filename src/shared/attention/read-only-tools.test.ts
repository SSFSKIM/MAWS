import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../graph/events';
import { webFetchCases } from '../../../test/support/web-fetch-recorded';
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

  // UX wave U3b, M5 (acceptance 12): the web plugin's fetch is read-only as WebFetch is, so a hover card or a
  // notification can allow it in one click
  it('lets the web plugin’s fetch be answered outside the pane, as WebFetch', () => {
    for (const [label, call] of webFetchCases()) expect(isReadOnlyRequest(permission(call.toolName)), label).toBe(true);
    for (const tool of ['mcp__web__search', 'mcp__docs__fetch']) expect(isReadOnlyRequest(permission(tool)), tool).toBe(false);
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
