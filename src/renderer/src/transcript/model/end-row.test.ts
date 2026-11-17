// UX wave U1b (the U1b document, Interfaces §C): the end row's reserved request id names the transcript it ends. It
// round-trips any session id and agent id, and no request id the engine (a UUID) or a bridge (a tool-use id) makes, nor
// desk web's own tail rows, reads as one. Every id is invented.
import { describe, expect, it } from 'vitest';
import type { AgentId, AppSessionId, RequestId } from '@shared/graph/ids';
import { END_ROW, endRequestId, endRequestOf } from './keys';

describe('the end row’s request id', () => {
  it('round-trips a session id and an agent id, whatever they hold', () => {
    const sessions = ['app-1', 'machine-a/app-2', 'a:b/c%d e', 'ünïcode/✓'] as AppSessionId[];
    const agents = [null, 'agent-1', 'a/b:c', ''] as (AgentId | null)[];
    for (const appSessionId of sessions) for (const agentId of agents) expect(endRequestOf(endRequestId(appSessionId, agentId))).toEqual({ appSessionId, agentId });
    expect(endRequestId('app-1' as AppSessionId, null)).not.toBe(endRequestId('app-1' as AppSessionId, '' as AgentId));
  });

  it('is no id the engine, a bridge or desk web makes', () => {
    for (const id of ['7b1f4c1e-2a7d-4f0e-9c3b-3f1d2e6a9b10', 'toolu_01AbCdEf', 'req-perm', 'desk-tail:end', 'desk-tail:request:k', '', 'maws-transcript-end:', 'maws-transcript-end:%E0%A4%A']) {
      expect(endRequestOf(id as RequestId)).toBeNull();
    }
    expect(END_ROW).toBe('request-end');
  });
});
