// Hand-written X1 events for reducer tests: `ev(kind, overrides)` fills every required field of the kind with a neutral
// default and validates the result with `SessionEventSchema`, so a test never folds a shape production cannot emit.
import { SessionEventSchema, type EventKind, type SessionEvent } from '../../src/shared/graph/events';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null };

const DEFAULTS: Partial<Record<EventKind, Record<string, unknown>>> = {
  'session.state': { state: 'idle' },
  'turn.started': { userMessageUuid: null, origin: 'human' },
  'turn.ended': {
    result: 'success', isError: false, terminalReason: null, resultText: null, durationMs: 1, numTurns: 1, costUsd: 0, usage,
    permissionDenials: [], errors: [], userMessageUuids: [], origin: 'human', resultIndex: null, isEchoReceipt: false,
  },
  'assistant.block.delta': { apiMessageId: null, blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: '…', inputJsonDelta: null, userMessageUuid: null },
  'assistant.block.complete': {
    messageUuid: 'm1', apiMessageId: 'msg_1', blockIndex: 0, block: { type: 'text', text: '' }, model: 'claude', supersedes: null, aborted: false, userMessageUuids: [],
  },
  'user.message': { messageUuid: null, content: '', isReplay: false, isSynthetic: false, origin: null, bash: null },
  'tool.use': { toolUseId: 'toolu_1', toolName: 'Bash', input: {}, apiMessageId: null, messageUuid: null },
  'tool.result': { toolUseId: 'toolu_1', content: '', isError: false, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: null },
  'permission.requested': {
    requestId: 'req_1', toolUseId: 'toolu_1', toolName: 'Bash', displayName: null, input: {}, description: null, decisionReasonType: null, suggestions: [], blockedPath: null,
  },
  'permission.resolved': { requestId: 'req_1', toolUseId: 'toolu_1', behavior: 'allow', message: null, updatedInput: null, updatedPermissions: [], resolvedBy: 'user' },
  'question.requested': { requestId: 'req_1', toolUseId: 'toolu_1', questions: [] },
  'question.answered': { requestId: 'req_1', toolUseId: 'toolu_1', answers: {} },
  'subagent.started': { taskId: 'task_1', toolUseId: null, description: 'child', subagentType: null, isBackground: false, spawnDepth: 1, prompt: null },
  'subagent.finished': { taskId: 'task_1', status: 'completed', summary: null, outputFile: null, reason: null },
  'boundary.compaction': { trigger: 'auto', preTokens: 1, postTokens: null, logicalParentUuid: null, historical: false },
  'usage.sample': { costUsd: 0, usage, modelUsage: {}, source: 'result' },
  'context.sample': { totalTokens: 0, maxTokens: 1, percentage: 0, autoCompactThreshold: null, isAutoCompactEnabled: true, model: 'claude' },
  'session.reconnect': { phase: 'attempting', attempt: 1, maxAttempts: 1, trigger: 'user', reason: null },
  'process.exited': { code: 0, signal: null, reason: 'quit', lostAttentionCount: 0 },
};

let counter = 0;

export function ev(kind: EventKind, overrides: Record<string, unknown> = {}): SessionEvent {
  counter += 1;
  const base = { id: `ev-${counter}`, sessionId: 'sess-1', at: '2026-09-28T10:00:00.000Z', seq: counter, agentId: null, parentToolUseId: null };
  const defaults = DEFAULTS[kind];
  if (!defaults) throw new Error(`test/support/events: no defaults for ${kind}; add them`);
  return SessionEventSchema.parse({ ...base, kind, ...defaults, ...overrides });
}
