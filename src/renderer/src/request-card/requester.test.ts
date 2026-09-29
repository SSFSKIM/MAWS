import { describe, expect, it } from 'vitest';
import type { AgentId } from '@shared/graph/ids';
import type { Row } from '../transcript';
import { requesterName } from './requester';

const subagentRow = { kind: 'subagent', id: 'sub:1', turnId: null, at: '', agents: [{ taskId: 't1', agentId: 'agent-7', toolUseId: 'toolu_a', name: 'Explore', glyph: 0, kind: 'agent', subagentType: 'Explore' }], sentence: '', status: 'working', overflow: 0 } as unknown as Row;

describe('the requester a permission card names', () => {
  it('is the main session without an agent id, the subagent by name from the transcript, else a subagent', () => {
    expect(requesterName([subagentRow], null)).toBe('Main session');
    expect(requesterName([subagentRow], 'agent-7' as AgentId)).toBe('Explore');
    expect(requesterName([subagentRow], 'agent-9' as AgentId)).toBe('A subagent');
    expect(requesterName([], 'agent-7' as AgentId)).toBe('A subagent');
  });
});
