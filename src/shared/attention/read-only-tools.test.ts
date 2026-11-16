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

  // The branch panel's finding 4 (ruled 2026-11-15 (UTC), fail closed): the read-only offer would need the server's
  // identity, not its name, and no recording under spikes/protocol-probe/fixtures tells the web plugin's server from a
  // user's HTTP server named `web` (whose fetch tool is `mcp__web__fetch` too). So neither is offered outside the pane.
  it('does not let a fetch named mcp__web__fetch be answered outside the pane, a user’s HTTP server named web or the web plugin’s', () => {
    const fetchBy = (source: string) => ({ ...permission('mcp__web__fetch'), mcpServer: { name: 'web', source } }) as unknown as SessionEvent;
    expect(isReadOnlyRequest(fetchBy('user')), 'a user’s HTTP server named web').toBe(false);
    expect(isReadOnlyRequest(fetchBy('plugin')), 'one whose server says plugin').toBe(false);
    for (const [label, call] of webFetchCases()) expect(isReadOnlyRequest(permission(call.toolName)), label).toBe(false); // the recorded calls' name
    expect(isReadOnlyRequest(permission('WebFetch'))).toBe(true); // the engine's own fetch is unchanged
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
